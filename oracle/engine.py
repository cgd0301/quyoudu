"""Top-level deterministic evaluation and operation orchestration."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .candidates import (
    CandidateEvaluation,
    OptimizationResult,
    evaluate_candidates,
)
from .confirmation import apply_confirmation, suggest_confirmation
from .costs import CostComputation, compute_cost
from .daily import compute_daily_reference
from .holt import compute_forecasts
from .ops import Runtime, apply_direct_operation, schema_safe_case
from .result import money, result_skeleton
from .schema import validate_case, validate_ops, validate_result
from .scenarios import ScenarioComputation, build_scenarios
from .settlement import alternate_quote_indexes
from .snapshot import initial_state, snapshot_wire
from .states import state_wire, underlying_plan_state
from .timeline import TimelineRun, candidate_timeline_events, run_timeline
from .validation import issue, validate_semantics


def _calculation_case(
    case: dict[str, Any], input_issues: list[dict[str, Any]]
) -> dict[str, Any]:
    working = deepcopy(case)
    if any(item["code"] == "AS_OF_FORMAT" for item in input_issues):
        working["snapshot"]["as_of"] = "2026-09-01T09:00:00+08:00"
        working["snapshot"]["cash_as_of"] = "2026-09-01T09:00:00+08:00"
    return working


def _candidate_local_issue(case: dict[str, Any], item: dict[str, Any]) -> bool:
    refs = set(item["refs"])
    candidate_ids = {candidate["candidate_id"] for candidate in case["candidates"]}
    series_ids = {row["series_id"] for row in case["price_series"]}
    return bool(refs & (candidate_ids | series_ids))


def _nonblocking_unknown_inflow_issue(
    case: dict[str, Any], item: dict[str, Any]
) -> bool:
    if item["code"] != "MISSING_KEY_INFO":
        return False
    refs = set(item["refs"])
    return any(
        event["event_id"] in refs
        and event["event_kind"] in {"INCOME", "RETURN"}
        and event["event_status"] == "EXPECTED"
        and not event.get("in_snapshot")
        and (
            event.get("amount") is None
            or event.get("expected_at") is None
        )
        for event in case["events"]
    )


def _relevant_input_issues(
    case: dict[str, Any],
    items: list[dict[str, Any]],
    candidate: CandidateEvaluation | None,
) -> list[dict[str, Any]]:
    if candidate is None:
        relevant = [
            item for item in items if not _candidate_local_issue(case, item)
        ]
    else:
        candidate_id = candidate.candidate["candidate_id"]
        relevant = [
            item
            for item in items
            if not _candidate_local_issue(case, item)
            or candidate_id in item["refs"]
        ]
    return [
        item
        for item in relevant
        if not _nonblocking_unknown_inflow_issue(case, item)
    ]


def _base_future_goal_events(case: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        deepcopy(event)
        for event in case["events"]
        if event["event_kind"] == "GOAL_PAYMENT"
        and not event["in_snapshot"]
        and event.get("amount") is not None
        and event.get("expected_at") is not None
    ]


def _base_pending_ids(case: dict[str, Any]) -> list[str]:
    paid_or_scheduled = {
        event.get("cost_item_id")
        for event in case["events"]
        if event["event_kind"] == "GOAL_PAYMENT"
        and event.get("amount") is not None
        and event.get("cost_item_id")
    }
    return [
        item["cost_item_id"]
        for item in case["cost_items"]
        if item["necessary"]
        and item["amount_status"] not in {"NOT_APPLICABLE", "CONFIRMED_FREE"}
        and item["cost_item_id"] not in paid_or_scheduled
    ]


def _find_evaluation(
    optimization: OptimizationResult, candidate_id: str | None
) -> CandidateEvaluation | None:
    if candidate_id is None:
        return None
    return next(
        (
            evaluation
            for evaluation in optimization.evaluations
            if evaluation.candidate["candidate_id"] == candidate_id
        ),
        None,
    )


def _relevant_candidate(
    runtime: Runtime,
    optimization: OptimizationResult,
    calculation_case: dict[str, Any],
    forecast_lookup: dict[tuple[str, str, str, str], dict[str, Any]],
    *,
    shared_input_incomplete: bool,
) -> CandidateEvaluation | None:
    confirmed = runtime.case.get("confirmed_plan")
    if confirmed is not None:
        if runtime.confirmed_candidate_data is not None:
            formal_case = deepcopy(calculation_case)
            formal_case["candidates"] = [deepcopy(runtime.confirmed_candidate_data)]
            formal_case["forecast_confirmations"] = deepcopy(
                runtime.confirmed_forecast_confirmations
            )
            formal = evaluate_candidates(
                formal_case,
                forecast_lookup={},
                shared_input_incomplete=shared_input_incomplete,
            )
            return formal.evaluations[0] if formal.evaluations else None
        return _find_evaluation(optimization, confirmed["candidate_id"])
    if runtime.selected_candidate_id is not None:
        return _find_evaluation(optimization, runtime.selected_candidate_id)
    return None


def _relevant_timeline_cost(
    runtime: Runtime,
    candidate: CandidateEvaluation | None,
    calculation_case: dict[str, Any],
) -> tuple[TimelineRun, CostComputation]:
    cancelled = runtime.decision == "CANCELLED"
    if candidate is not None:
        if cancelled:
            plan_events = candidate_timeline_events(
                calculation_case,
                candidate.candidate,
                candidate.item_amounts,
                returns_override=candidate.returns,
                cancelled=True,
            )
            timeline = run_timeline(
                calculation_case,
                plan_events,
                candidate=candidate.candidate,
                cancelled=True,
            )
            surviving = [
                event
                for event in [*_base_future_goal_events(calculation_case), *plan_events]
                if event.get("cancellable") is not True
            ]
            cost = compute_cost(calculation_case, surviving, candidate.returns, [])
            return timeline, cost
        timeline = candidate.timeline
        if timeline is None:
            timeline = run_timeline(
                calculation_case,
                candidate.plan_events,
                candidate=candidate.candidate,
                cancelled=cancelled,
            )
        return timeline, candidate.cost
    base_events = _base_future_goal_events(calculation_case)
    timeline = run_timeline(calculation_case, [], cancelled=cancelled)
    cost = compute_cost(
        calculation_case,
        base_events,
        [],
        _base_pending_ids(calculation_case),
    )
    return timeline, cost


def _dependencies(
    case: dict[str, Any], candidate: CandidateEvaluation | None
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for event in case["events"]:
        if (
            event["event_kind"] == "INCOME"
            and event["event_status"] == "EXPECTED"
            and event.get("amount") is not None
            and event.get("expected_at") is not None
            and not event.get("trigger_condition")
        ):
            result.append(
                {
                    "kind": "EXPECTED_INCOME",
                    "refs": [event["event_id"]],
                    "amount": money(
                        event["amount"],
                        event_ids=[event["event_id"]],
                        rules=["R005", "D41"],
                    ),
                    "at": event["expected_at"],
                }
            )
    if candidate is not None:
        result.extend(deepcopy(candidate.dependencies))
        for returned in candidate.returns:
            if returned.get("trigger_condition") and returned.get("amount") is not None:
                result.append(
                    {
                        "kind": "EXPECTED_RETURN",
                        "refs": [returned["event_id"]],
                        "amount": money(
                            returned["amount"],
                            event_ids=[returned["event_id"]],
                            rules=["R005", "D12"],
                        ),
                        "at": returned.get("expected_at"),
                    }
                )
    unique: dict[tuple[Any, ...], dict[str, Any]] = {}
    for item in result:
        key = (
            item["kind"],
            tuple(item["refs"]),
            None if item["amount"] is None else item["amount"]["value"],
            item["at"],
        )
        unique[key] = item
    return list(unique.values())


def _user_confirmations(case: dict[str, Any], version: str) -> list[dict[str, Any]]:
    return [
        {
            "field": item["field"],
            "value": item["value"],
            "input_version": item["input_version"],
            "status": (
                "CURRENT" if item["input_version"] == version else "NEEDS_RECONFIRM"
            ),
        }
        for item in case.get("confirmations", [])
    ]


def _action_list(
    case: dict[str, Any],
    candidate: CandidateEvaluation | None,
    decision: str | None,
) -> list[dict[str, Any]]:
    if case.get("confirmed_plan") is None or candidate is None:
        return []
    cost_by_id = {item["cost_item_id"]: item for item in case["cost_items"]}
    plan_version = case["confirmed_plan"]["plan_version"]
    # D75 / R015 rule 4: an already purchased item never becomes a purchase task again.
    alternate = alternate_quote_indexes(
        case, candidate.candidate, cancelled=decision == "CANCELLED"
    )
    actions: list[dict[str, Any]] = []
    for index, item in enumerate(candidate.candidate["items"]):
        if index in alternate:
            continue
        if decision == "CANCELLED" and item.get("cancellable") is True:
            continue
        kind = candidate.price_kinds[index]
        pending_checks: list[str] = []
        if kind == "FORECAST":
            pending_checks.extend(
                ["RECHECK_PRICE", "RECHECK_OFFER_CONDITIONS"]
            )
        elif kind in {"REFERENCE", "UNDATED_QUOTE"}:
            pending_checks.append("RECHECK_PRICE")
        offer_ids = [
            use["offer_id"]
            for use in candidate.candidate["offers_used"]
            if use["order_id"] == item["order_id"]
        ]
        if offer_ids and "RECHECK_OFFER_CONDITIONS" not in pending_checks:
            pending_checks.append("RECHECK_OFFER_CONDITIONS")
        actions.append(
            {
                "task_id": f"TASK:{candidate.candidate['candidate_id']}:{index}",
                "cost_item_id": item["cost_item_id"],
                "category": cost_by_id[item["cost_item_id"]]["category"],
                "spec": item["spec"],
                "purchase_date": item["purchase_date"],
                "channel": item["channel"],
                "offer_ids": offer_ids,
                "amount": (
                    None
                    if candidate.item_amounts[index] is None
                    else money(
                        candidate.item_amounts[index],
                        rules=["R017", "D53"],
                    )
                ),
                "payment_at": item["payment_at"],
                "pending_checks": pending_checks,
                "task_state": "PENDING_PURCHASE",
                "plan_version": plan_version,
            }
        )
    return actions


def _labels(
    runtime: Runtime,
    candidate: CandidateEvaluation | None,
    optimization: OptimizationResult,
    forecasts: list[dict[str, Any]],
    scenarios: list[ScenarioComputation],
    daily: dict[str, Any],
    nodes: list[dict[str, Any]],
) -> list[str]:
    labels = ["SIMULATED_DATA", "TOP_K_DEMO"]
    if runtime.case.get("confirmed_plan") is None:
        labels.extend(["DRAFT_PREVIEW", "PREVIEW_UNCONFIRMED"])
    if any(
        item["status"] == "HISTORY_INSUFFICIENT" for item in forecasts
    ) or any(
        item.wire["unavailable_reason"] == "HISTORY_INSUFFICIENT"
        for item in scenarios
    ):
        labels.append("HISTORY_INSUFFICIENT")
    if forecasts:
        labels.append("FORECAST_DISCLAIMER")
    if candidate is not None and any(
        kind in {"REFERENCE", "UNDATED_QUOTE"} for kind in candidate.price_kinds
    ):
        labels.append("FORECAST_UNAVAILABLE")
    if candidate is not None and candidate.cost.net_spend_if_received != candidate.cost.net_spend:
        labels.append("IF_RECEIVED")
    tie_groups = [
        item.tie_group
        for item in optimization.evaluations
        if item.tie_group is not None
    ]
    if len(tie_groups) != len(set(tie_groups)):
        labels.append("SAME_PRICE")
    if any(
        event["event_status"] == "ACTUAL"
        and event.get("in_snapshot")
        and (event.get("actual_at") or event.get("expected_at") or "")[:10]
        < "2026-09-01"
        for event in runtime.case["events"]
    ):
        labels.append("PRE_RANGE_PAID")
    if any(node["node_verdict"] == "PROTECTED_SHORTFALL" for node in nodes):
        labels.append("PROTECTED_SQUEEZE")
    if any(item["status"] == "NEEDS_RECONFIRM" for item in _user_confirmations(runtime.case, runtime.input_version)):
        labels.append("NEED_RECONFIRM")
    if (
        runtime.case.get("confirmed_plan") is not None
        and runtime.formalized_version_number is not None
        and runtime.input_version_number > runtime.formalized_version_number
    ):
        labels.append("NEED_RECONFIRM")
    if "label" in daily:
        labels.append(daily["label"])
    return list(dict.fromkeys(labels))


def _initial_no_plan_issue(case: dict[str, Any]) -> dict[str, Any] | None:
    if (
        not case["candidates"]
        and not case["cost_items"]
        and not any(
            event["event_kind"] == "GOAL_PAYMENT" for event in case["events"]
        )
    ):
        return issue("NO_PLAN", "D47", [case["goal"]["goal_id"]])
    return None


def build_result(runtime: Runtime) -> dict[str, Any]:
    raw_case = runtime.case
    input_issues = validate_semantics(raw_case)
    case = _calculation_case(raw_case, input_issues)
    forecasts, forecast_lookup = compute_forecasts(case)
    shared_incomplete = any(
        item["code"]
        in {
            "MISSING_KEY_INFO",
            "CASH_AS_OF_MISMATCH",
            "AS_OF_FORMAT",
            "SNAPSHOT_PHASE_MISSING",
            "SNAPSHOT_PHASE_MISMATCH",
            "COVERAGE_EXCEEDS_AMOUNT",
            "GROUP_COVERAGE_OVERSUBSCRIBED",
            "OVERDUE_EVENT",
            "OUT_OF_RANGE",
        }
        for item in input_issues
        if not _candidate_local_issue(raw_case, item)
        and not _nonblocking_unknown_inflow_issue(raw_case, item)
    )
    optimization = evaluate_candidates(
        case,
        forecast_lookup=forecast_lookup,
        shared_input_incomplete=shared_incomplete,
    )
    candidate = _relevant_candidate(
        runtime,
        optimization,
        case,
        forecast_lookup,
        shared_input_incomplete=shared_incomplete,
    )
    timeline, cost = _relevant_timeline_cost(runtime, candidate, case)

    for timeline_issue in timeline.issues:
        if timeline_issue not in input_issues:
            input_issues.append(timeline_issue)
    no_plan = _initial_no_plan_issue(case)
    if no_plan is not None and no_plan not in input_issues:
        input_issues.append(no_plan)
    if timeline.period.out_of_range and not any(
        item["code"] == "OUT_OF_RANGE" for item in input_issues
    ):
        input_issues.append(issue("OUT_OF_RANGE", "R008/D41/D56", []))

    relevant_issues = _relevant_input_issues(case, input_issues, candidate)
    underlying = underlying_plan_state(
        input_issues=relevant_issues,
        candidate=None if runtime.decision == "CANCELLED" else candidate,
        timeline=timeline,
        cost=cost,
    )
    states = state_wire(runtime, optimization, candidate, underlying)
    result = result_skeleton(raw_case["snapshot"]["as_of"], runtime.input_version)
    result["check_period"] = timeline.period.wire()
    result["check_period"]["start"] = raw_case["snapshot"]["as_of"]
    result["input_issues"] = input_issues
    result["snapshot"] = snapshot_wire(
        initial_state(case, release_allocation=runtime.decision == "CANCELLED")
    )
    result["nodes"] = timeline.nodes
    result["earliest_gap"] = timeline.earliest_gap
    result["gap_list"] = timeline.gap_list
    result["constraint_issues"] = {
        "budget_overrun": cost.wire["budget_overrun"],
        "allocation_conflicts": timeline.allocation_conflicts,
    }
    result["cost"] = cost.wire
    result["dependencies"] = _dependencies(case, candidate)
    result["candidates"] = [item.wire() for item in optimization.evaluations]
    result["optimization"] = optimization.wire()
    result["states"] = states
    result["user_confirmations"] = _user_confirmations(raw_case, runtime.input_version)

    if runtime.last_confirmation is not None:
        result["confirmation"] = deepcopy(runtime.last_confirmation)
    elif candidate is not None and (
        runtime.selected_candidate_id is not None or case.get("confirmed_plan") is not None
    ):
        try:
            result["confirmation"] = suggest_confirmation(
                case, candidate, runtime.input_version
            ).wire
        except (ValueError, AssertionError):
            result["confirmation"] = None
    result["action_list"] = _action_list(case, candidate, runtime.decision)

    scenarios = build_scenarios(case, timeline.period)
    confirmed_candidate = candidate if case.get("confirmed_plan") is not None else None
    daily = compute_daily_reference(
        case, confirmed_candidate, scenarios, input_issues=relevant_issues
    )
    result["daily_reference"] = daily
    result["forecasts"] = forecasts
    result["scenarios"] = [scenario.wire for scenario in scenarios]
    result["labels"] = _labels(
        runtime,
        candidate,
        optimization,
        forecasts,
        scenarios,
        daily,
        timeline.nodes,
    )
    validate_result(result)
    return result


def _confirm_forecasts(runtime: Runtime, op: dict[str, Any]) -> None:
    forecasts, _ = compute_forecasts(runtime.case)
    by_key = {
        (item["series_id"], item["purchase_date"]): item for item in forecasts
    }
    for request in op["forecasts"]:
        key = (request["series_id"], request["purchase_date"])
        forecast = by_key.get(key)
        if forecast is None or forecast["amount"] is None:
            raise ValueError(f"forecast is not confirmable: {key}")
        runtime.case["forecast_confirmations"] = [
            item
            for item in runtime.case["forecast_confirmations"]
            if (item["series_id"], item["purchase_date"]) != key
        ]
        runtime.case["forecast_confirmations"].append(
            {
                "series_id": request["series_id"],
                "purchase_date": request["purchase_date"],
                "price": forecast["amount"]["value"],
                "config_version": forecast["config_version"],
            }
        )
    runtime.bump_version()


def _confirm(runtime: Runtime, op: dict[str, Any]) -> None:
    semantic_issues = validate_semantics(runtime.case)
    forecasts, lookup = compute_forecasts(runtime.case)
    del forecasts
    optimization = evaluate_candidates(runtime.case, forecast_lookup=lookup)
    candidate = _find_evaluation(optimization, op["candidate_id"])
    if _relevant_input_issues(runtime.case, semantic_issues, candidate):
        runtime.draft_candidate_id = op["candidate_id"]
        return
    apply_confirmation(runtime, op, candidate)


def evaluate(
    case_data: dict[str, Any],
    ops: list[dict[str, Any]] | None = None,
    config: Any | None = None,
) -> dict[str, Any]:
    if config not in (None, "DEMO-CFG-1") and not (
        isinstance(config, dict) and config.get("config_version") == "DEMO-CFG-1"
    ):
        raise ValueError("only DEMO-CFG-1 is supported")
    validate_case(case_data)
    operation_list = [] if ops is None else ops
    validate_ops(operation_list)
    runtime = Runtime.from_case(case_data)
    checkpoints: list[dict[str, Any]] = []
    saw_evaluate = False
    for op in operation_list:
        kind = op["type"]
        if kind == "EVALUATE":
            saw_evaluate = True
            checkpoints.append({"label": op["label"], "result": build_result(runtime)})
        elif kind == "CONFIRM":
            _confirm(runtime, op)
        elif kind == "CONFIRM_FORECASTS":
            _confirm_forecasts(runtime, op)
        elif not apply_direct_operation(runtime, op):
            raise ValueError(f"unsupported operation: {kind}")
        validate_case(schema_safe_case(runtime))
    if not saw_evaluate:
        checkpoints.append({"label": "final", "result": build_result(runtime)})
    return {"checkpoints": checkpoints}


def evaluate_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if "input" in payload and "ops" in payload:
        return evaluate(payload["input"], payload["ops"])
    return evaluate(payload, [])

