"""Daily discretionary-spend reference using full-period integer search."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .candidates import CandidateEvaluation
from .costs import CostComputation
from .dates import as_date
from .result import money
from .scenarios import ScenarioComputation
from .snapshot import initial_state
from .timeline import TimelineRun, run_timeline


@dataclass
class ProbeResult:
    passed: bool
    run: TimelineRun


def _probe(
    case: dict[str, Any],
    candidate: CandidateEvaluation,
    plan_events: list[dict[str, Any]],
    cost: CostComputation,
    scenario: ScenarioComputation,
    amount: int,
    *,
    cancelled: bool,
) -> ProbeResult:
    scenario_events = [
        deepcopy(event)
        for event in scenario.events
        if not event.get("today_same_scope")
    ]
    run = run_timeline(
        case,
        plan_events,
        candidate=candidate.candidate,
        scenario_events=scenario_events,
        probe_amount=amount,
        cancelled=cancelled,
    )
    passed = (
        run.passes
        and cost.budget_overrun is None
        and cost.net_spend is not None
    )
    return ProbeResult(passed, run)


def _unavailable_entries(
    scenarios: list[ScenarioComputation],
) -> list[dict[str, str]]:
    return [
        {
            "scenario": scenario.wire["kind"],
            "reason": scenario.wire["unavailable_reason"],
        }
        for scenario in scenarios
        if not scenario.available
    ]


def compute_daily_reference(
    case: dict[str, Any],
    confirmed_candidate: CandidateEvaluation | None,
    scenarios: list[ScenarioComputation],
    input_issues: list[dict[str, Any]] | None = None,
    *,
    cancelled: bool = False,
    output_nodes: list[dict[str, Any]] | None = None,
    effective_timeline: TimelineRun | None = None,
    effective_cost: CostComputation | None = None,
    effective_plan_events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if case.get("confirmed_plan") is None or confirmed_candidate is None:
        return {
            "display": "NEED_CONFIRMED_PLAN",
            "unavailable": [],
            "missing_reasons": [],
        }
    if case["snapshot"].get("living_arrangement", "PROVIDED") == "NOT_PROVIDED":
        return {
            "display": "UNAVAILABLE",
            "unavailable": [],
            "missing_reasons": ["LIVING_ARRANGEMENT_MISSING"],
        }
    timeline = (
        effective_timeline
        if effective_timeline is not None
        else confirmed_candidate.timeline
    )
    cost = effective_cost if effective_cost is not None else confirmed_candidate.cost
    plan_events = (
        effective_plan_events
        if effective_plan_events is not None
        else confirmed_candidate.plan_events
    )
    if (
        input_issues
        or (not cancelled and not confirmed_candidate.evaluable)
        or cost.net_spend is None
        or timeline is None
        or timeline.period.out_of_range
        or timeline.issues
    ):
        return {
            "display": "UNAVAILABLE",
            "unavailable": [],
            "missing_reasons": [],
        }
    if not cancelled and confirmed_candidate.feasible is False:
        return {
            "display": "NOT_RECOMMENDED",
            "amount": money(0, rules=["R019", "§10.5"]),
            "unavailable": _unavailable_entries(scenarios),
            "missing_reasons": [],
        }
    state = initial_state(case, release_allocation=cancelled)
    if state is None:
        return {
            "display": "UNAVAILABLE",
            "unavailable": [],
            "missing_reasons": [],
        }

    as_of_day = as_date(case["snapshot"]["as_of"])
    if as_of_day.isoformat() == "2026-09-01":
        selected = [scenario for scenario in scenarios if scenario.wire["kind"] == "CONFIRMED_ONLY"]
    else:
        selected = [scenario for scenario in scenarios if scenario.available]
    unavailable = _unavailable_entries(scenarios)
    if not selected:
        return {
            "display": "UNAVAILABLE",
            "unavailable": unavailable,
            "missing_reasons": [],
        }

    upper = max(0, state.unallocated)
    results: list[tuple[ScenarioComputation, int, TimelineRun]] = []
    for scenario in selected:
        zero = _probe(
            case,
            confirmed_candidate,
            plan_events,
            cost,
            scenario,
            0,
            cancelled=cancelled,
        )
        if not zero.passed:
            scenario.wire["daily_reference"] = money(0, rules=["R019", "§10.5"])
            return {
                "display": "NOT_RECOMMENDED",
                "amount": money(0, rules=["R019", "§10.5"]),
                "unavailable": unavailable,
                "missing_reasons": [],
            }
        low, high = 0, upper
        last_run = zero.run
        while low < high:
            middle = (low + high + 1) // 2
            checked = _probe(
                case,
                confirmed_candidate,
                plan_events,
                cost,
                scenario,
                middle,
                cancelled=cancelled,
            )
            if checked.passed:
                low = middle
                last_run = checked.run
            else:
                high = middle - 1
        optimum = low
        optimum_check = _probe(
            case,
            confirmed_candidate,
            plan_events,
            cost,
            scenario,
            optimum,
            cancelled=cancelled,
        )
        assert optimum_check.passed, "D must pass the complete check"
        if optimum < upper:
            assert not _probe(
                case,
                confirmed_candidate,
                plan_events,
                cost,
                scenario,
                optimum + 1,
                cancelled=cancelled,
            ).passed, "D+1 must fail before the U0 upper bound"
        scenario.wire["daily_reference"] = money(
            optimum, rules=["R019", "§4", "§10.5"]
        )
        results.append((scenario, optimum, optimum_check.run))

    limiting_scenario, optimum, run = min(
        results, key=lambda item: (item[1], item[0].wire["kind"])
    )
    limiting_index: int | None = None
    if optimum < upper:
        failed = _probe(
            case,
            confirmed_candidate,
            plan_events,
            cost,
            limiting_scenario,
            optimum + 1,
            cancelled=cancelled,
        )
        failed_node = None
        for node in failed.run.nodes:
            if node["node_verdict"] != "PASS":
                failed_node = node
                break
        if failed_node is not None:
            failed_key = (
                failed_node["trigger"]["kind"],
                tuple(failed_node["trigger"]["event_ids"]),
            )
            for index, node in enumerate(output_nodes or []):
                node_key = (
                    node["trigger"]["kind"],
                    tuple(node["trigger"]["event_ids"]),
                )
                if node_key == failed_key:
                    limiting_index = index
                    break
    result = {
        "display": "AMOUNT",
        "amount": money(optimum, rules=["R019", "§4", "§10.5"]),
        "limited_by": {
            "scenario": limiting_scenario.wire["kind"],
            "node_index": limiting_index,
        },
        "unavailable": unavailable,
        "missing_reasons": [],
    }
    if len(selected) == 1:
        result["label"] = "CONFIRMED_ONLY"
    return result

