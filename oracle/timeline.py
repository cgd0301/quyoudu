"""Cash timeline, reserve lifecycle, check period and node verdicts."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from .config import SUPPORTED_END
from .dates import as_date, parse_date, parse_time
from .result import money
from .snapshot import BalanceState, initial_state
from .validation import issue


OUTFLOWS = {"GOAL_PAYMENT", "OTHER_EXPENSE"}
INFLOWS = {"INCOME", "RETURN"}


@dataclass
class CheckPeriod:
    start: str
    end: date
    out_of_range: bool

    def wire(self) -> dict[str, Any]:
        return {
            "start": self.start,
            "end": self.end.isoformat(),
            "out_of_range": self.out_of_range,
        }


@dataclass
class TimelineRun:
    period: CheckPeriod
    nodes: list[dict[str, Any]]
    earliest_gap: dict[str, Any] | None
    gap_list: list[dict[str, Any]]
    allocation_conflicts: list[dict[str, Any]]
    issues: list[dict[str, Any]]
    min_unallocated: int | None
    final_state: BalanceState | None

    @property
    def passes(self) -> bool:
        return (
            not self.period.out_of_range
            and not self.issues
            and all(node["node_verdict"] == "PASS" for node in self.nodes)
        )


def _event_at(event: dict[str, Any]) -> str | None:
    if event.get("event_status") == "ACTUAL":
        return event.get("actual_at") or event.get("expected_at")
    return event.get("expected_at") or event.get("at")


def _confirmed_income(event: dict[str, Any]) -> bool:
    # AMBIGUOUS: D41｜仅 confirmations 明确关联的收入才算已确认｜
    # CaseFile 未定义确认记录到 event_id 的关联且 fixtures 以完整无条件 INCOME 表示确认｜
    # 采用金额日期完整且无 trigger_condition 的 INCOME 为已确认，避免补入条件资金。
    return (
        event.get("event_kind") == "INCOME"
        and event.get("amount") is not None
        and _event_at(event) is not None
        and not event.get("trigger_condition")
    )


def compute_check_period(
    case: dict[str, Any],
    plan_events: list[dict[str, Any]],
    *,
    cancelled: bool = False,
) -> CheckPeriod:
    as_of = case["snapshot"]["as_of"]
    as_of_date = as_date(as_of)
    support_end = parse_date(SUPPORTED_END)

    future_goal_dates = [
        as_date(at)
        for event in [*case["events"], *plan_events]
        if event.get("event_kind") in {"GOAL_PAYMENT", "RETURN"}
        and not event.get("in_snapshot")
        and (at := _event_at(event)) is not None
        and as_date(at) >= as_of_date
        and not event.get("trigger_condition")
        and (not cancelled or event.get("cancellable") is not True)
    ]
    last_goal = max(future_goal_dates) if future_goal_dates else None

    incomes = sorted(
        (
            as_date(at)
            for event in case["events"]
            if _confirmed_income(event)
            and not event.get("in_snapshot")
            and (at := _event_at(event)) is not None
        )
    )
    if last_goal is not None:
        next_income = next((day for day in incomes if day >= last_goal), None)
        provisional = (
            max(last_goal, next_income)
            if next_income is not None
            else max(last_goal, support_end)
        )
    else:
        next_income = next((day for day in incomes if day > as_of_date), None)
        provisional = next_income if next_income is not None else support_end

    other_dates: list[date] = []
    for event in case["events"]:
        if (
            event.get("event_kind") == "OTHER_EXPENSE"
            and not event.get("in_snapshot")
            and (not cancelled or event.get("cancellable") is not True)
        ):
            at = _event_at(event)
            if at is not None:
                other_dates.append(as_date(at))
    end = max([provisional, *other_dates]) if other_dates else provisional
    return CheckPeriod(start=as_of, end=end, out_of_range=end > support_end)


def candidate_timeline_events(
    case: dict[str, Any],
    candidate: dict[str, Any] | None,
    item_amounts: list[int | None] | None = None,
    returns_override: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if candidate is None:
        return []
    result: list[dict[str, Any]] = []
    for index, item in enumerate(candidate["items"]):
        amount = item["price"] if item_amounts is None else item_amounts[index]
        if amount is None:
            continue
        result.append(
            {
                "event_id": f"PLAN:{candidate['candidate_id']}:{index}:{item['cost_item_id']}",
                "event_kind": "GOAL_PAYMENT",
                "event_status": "EXPECTED",
                "amount": amount,
                "expected_at": item["payment_at"],
                "time_precision": "DATETIME" if "T" in item["payment_at"] else "DATE",
                "known_order": item.get("known_order"),
                "in_snapshot": False,
                "goal_id": case["goal"]["goal_id"],
                "cost_item_id": item["cost_item_id"],
                "coverage": deepcopy(item.get("coverage", [])),
                "currency": item["currency"],
                "cancellable": item.get("cancellable", False),
                "source_item_index": index,
            }
        )
    for returned in (
        candidate["returns"] if returns_override is None else returns_override
    ):
        if returned.get("amount") is None or returned.get("expected_at") is None:
            continue
        result.append(
            {
                "event_id": returned["event_id"],
                "event_kind": "RETURN",
                "event_status": "EXPECTED",
                "amount": returned["amount"],
                "expected_at": returned["expected_at"],
                "time_precision": returned["time_precision"],
                "in_snapshot": False,
                "cost_item_id": returned.get("cost_item_id"),
                "coverage": [],
                "trigger_condition": returned.get("trigger_condition"),
                "currency": returned["currency"],
            }
        )
    return result


def _activity_release_event(
    case: dict[str, Any], candidate: dict[str, Any] | None
) -> dict[str, Any] | None:
    if not any(
        reserve["reserve_kind"] == "CONTINGENCY" for reserve in case["reserves"]
    ):
        return None
    activity_end = as_date(case["goal"]["show_end_at"])
    if candidate is not None:
        categories = {
            item["cost_item_id"]: item["category"] for item in case["cost_items"]
        }
        return_arrivals = [
            as_date(item["arrive_at"])
            for item in candidate["items"]
            if categories.get(item["cost_item_id"]) == "RETURN_TRANSPORT"
            and item.get("arrive_at")
        ]
        if return_arrivals:
            activity_end = max(activity_end, max(return_arrivals))
    release_date = activity_end + timedelta(days=1)
    return {
        "event_id": "AUTO:CONTINGENCY_RELEASE",
        "event_kind": "CONTINGENCY_RELEASE",
        "event_status": "EXPECTED",
        "amount": 0,
        "expected_at": release_date.isoformat(),
        "time_precision": "DATE",
        "in_snapshot": False,
        "coverage": [],
        "currency": "CNY",
        "day_end": True,
    }


def collect_timeline_events(
    case: dict[str, Any],
    plan_events: list[dict[str, Any]],
    period: CheckPeriod,
    *,
    candidate: dict[str, Any] | None = None,
    scenario_events: list[dict[str, Any]] | None = None,
    probe_amount: int | None = None,
    cancelled: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    as_of = parse_time(case["snapshot"]["as_of"])
    as_of_date = as_of.date()
    issues: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []

    for original in [*case["events"], *plan_events, *(scenario_events or [])]:
        if original.get("in_snapshot"):
            continue
        if cancelled and original.get("cancellable") is True:
            continue
        event = deepcopy(original)
        at = _event_at(event)
        if at is None or event.get("amount") is None:
            continue
        if event["event_kind"] != "CONTINGENCY_RELEASE" and event["amount"] <= 0:
            continue
        event_day = as_date(at)
        overdue = False
        if event.get("event_status") == "EXPECTED":
            if event_day < as_of_date:
                overdue = True
            elif event_day == as_of_date and "T" in at:
                try:
                    overdue = parse_time(at) < parse_time(case["snapshot"]["cash_as_of"])
                except ValueError:
                    overdue = False
        if overdue:
            issues.append(issue("OVERDUE_EVENT", "D54", [event["event_id"]]))
            if event["event_kind"] in OUTFLOWS:
                event["expected_at"] = case["snapshot"]["as_of"]
                event["overdue"] = True
                events.append(event)
            continue
        if as_of_date <= event_day <= period.end:
            if event["event_kind"] in INFLOWS and event.get("trigger_condition"):
                continue
            events.append(event)

    release = _activity_release_event(case, candidate)
    if release is not None and as_of_date <= as_date(release["expected_at"]) <= period.end:
        events.append(release)

    if probe_amount is not None:
        events.append(
            {
                "event_id": "PROBE:DAILY_REFERENCE",
                "event_kind": "OTHER_EXPENSE",
                "event_status": "EXPECTED",
                "amount": probe_amount,
                "expected_at": case["snapshot"]["as_of"],
                "time_precision": "DATETIME",
                "in_snapshot": False,
                "coverage": [],
                "currency": "CNY",
                "force_first": True,
            }
        )
    return events, issues


def _same_day_steps(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_day: dict[date, list[dict[str, Any]]] = {}
    for event in events:
        by_day.setdefault(as_date(_event_at(event) or ""), []).append(event)

    steps: list[dict[str, Any]] = []
    for day in sorted(by_day):
        daily = by_day[day]
        force_first = sorted(
            [event for event in daily if event.get("force_first")],
            key=lambda event: event["event_id"],
        )
        day_end = sorted(
            [event for event in daily if event.get("day_end")],
            key=lambda event: event["event_id"],
        )
        ordinary = [
            event
            for event in daily
            if not event.get("force_first") and not event.get("day_end")
        ]
        known = sorted(
            [event for event in ordinary if event.get("known_order") is not None],
            key=lambda event: (event["known_order"], event["event_id"]),
        )
        unknown = [event for event in ordinary if event.get("known_order") is None]
        unknown_out = sorted(
            [event for event in unknown if event["event_kind"] in OUTFLOWS],
            key=lambda event: event["event_id"],
        )
        unknown_in = sorted(
            [event for event in unknown if event["event_kind"] not in OUTFLOWS],
            key=lambda event: event["event_id"],
        )
        for event in force_first:
            steps.append({"kind": "EVENT", "at": _event_at(event), "events": [event]})
        if unknown_out:
            steps.append(
                {
                    "kind": "OUTFLOW_GROUP" if len(unknown_out) > 1 else "EVENT",
                    "at": day.isoformat() if len(unknown_out) > 1 else _event_at(unknown_out[0]),
                    "events": unknown_out,
                }
            )
        for event in known:
            steps.append({"kind": "EVENT", "at": _event_at(event), "events": [event]})
        for event in unknown_in + day_end:
            steps.append({"kind": "EVENT", "at": _event_at(event), "events": [event]})
    return steps


def _coverage_oversubscribed(state: BalanceState, events: list[dict[str, Any]]) -> bool:
    declarations: dict[str, int] = {}
    for event in events:
        for coverage in event.get("coverage", []):
            declarations[coverage["reserve_id"]] = (
                declarations.get(coverage["reserve_id"], 0) + coverage["covered_amount"]
            )
    for reserve_id, total in declarations.items():
        reserve = state.reserves.get(reserve_id)
        remaining = reserve.remaining if reserve is not None and reserve.established else 0
        if total > remaining:
            return True
    return False


def _write_off(
    state: BalanceState,
    event: dict[str, Any],
) -> int:
    total = 0
    amount = event["amount"]
    event_day = as_date(_event_at(event) or "")
    if sum(item["covered_amount"] for item in event.get("coverage", [])) > amount:
        return 0
    for coverage in event.get("coverage", []):
        if coverage["covered_amount"] < 0:
            continue
        reserve = state.reserves.get(coverage["reserve_id"])
        if reserve is None or not reserve.established:
            continue
        if not (
            parse_date(reserve.coverage_start)
            <= event_day
            <= parse_date(reserve.coverage_end)
        ):
            continue
        covered = min(coverage["covered_amount"], reserve.remaining, amount - total)
        reserve.remaining -= covered
        total += covered
    return total


def _apply(
    state: BalanceState,
    event: dict[str, Any],
    applied: list[dict[str, Any]],
    planned_allocation: dict[str, Any] | None,
) -> None:
    kind = event["event_kind"]
    amount = event["amount"]
    if kind == "GOAL_PAYMENT":
        state.cash -= amount
        uncovered = amount - _write_off(state, event)
        state.goal_allocation -= min(uncovered, state.goal_allocation)
    elif kind == "OTHER_EXPENSE":
        state.cash -= amount
        _write_off(state, event)
    elif kind == "INCOME":
        state.cash += amount
        for reserve in state.reserves.values():
            if reserve.funding_event_id == event["event_id"] and not reserve.established:
                earlier_declared = sum(
                    coverage["covered_amount"]
                    for old in applied
                    for coverage in old.get("coverage", [])
                    if coverage["reserve_id"] == reserve.reserve_id
                )
                reserve.remaining = max(0, reserve.original_amount - earlier_declared)
                reserve.established = True
        if (
            planned_allocation is not None
            and planned_allocation["funding_event_id"] == event["event_id"]
        ):
            state.goal_allocation += planned_allocation["amount"]
    elif kind == "RETURN":
        if not event.get("trigger_condition"):
            state.cash += amount
    elif kind == "CONTINGENCY_RELEASE":
        for reserve in state.reserves.values():
            if reserve.kind == "CONTINGENCY" and reserve.established:
                reserve.remaining = 0
    applied.append(event)


def _trigger(step: dict[str, Any]) -> tuple[str, list[str]]:
    events = step["events"]
    ids = [event["event_id"] for event in events]
    if step["kind"] == "OUTFLOW_GROUP":
        return "OUTFLOW_GROUP", ids
    kind = events[0]["event_kind"]
    if kind in OUTFLOWS:
        return "OUTFLOW", ids
    if kind == "INCOME":
        return "INCOME", ids
    return "OTHER", ids


def _node(
    state: BalanceState,
    at: str,
    trigger_kind: str,
    event_ids: list[str],
    prev_u: int | None,
    prev_verdict: str | None,
) -> dict[str, Any]:
    reserve_ids = [
        reserve.reserve_id
        for reserve in state.reserves.values()
        if reserve.established
    ]
    fell = prev_u is None or state.unallocated < prev_u
    verdict = "PASS"
    amount: int | None = None
    protected_over: int | None = None
    allocation_unsupported: int | None = None

    if (
        state.unallocated < 0
        and prev_u is not None
        and prev_u < 0
        and not fell
    ):
        verdict = (
            "CONFLICT_CONTINUED"
            if prev_verdict in {"ALLOCATION_CONFLICT", "CONFLICT_CONTINUED"}
            else "GAP_CONTINUED"
        )
        amount = -state.unallocated
    elif state.protected_total > state.cash:
        verdict = "PROTECTED_SHORTFALL"
        amount = -state.unallocated
        protected_over = state.protected_total - state.cash
        allocation_unsupported = state.goal_allocation
    elif state.unallocated < 0:
        amount = -state.unallocated
        if trigger_kind == "START" or trigger_kind in {"INCOME", "OTHER"}:
            verdict = "ALLOCATION_CONFLICT"
        else:
            verdict = "PAYMENT_SHORTFALL"

    def m(value: int, rules: list[str]) -> dict[str, Any]:
        return money(
            value,
            event_ids=event_ids,
            reserve_ids=reserve_ids,
            rules=rules,
        )

    return {
        "at": at,
        "trigger": {"kind": trigger_kind, "event_ids": event_ids},
        "cash": m(state.cash, ["R001", "§10.3"]),
        "living_reserve": m(state.living, ["R003", "§10.3"]),
        "other_protected_reserve": m(
            state.other_protected, ["R003", "§10.3"]
        ),
        "other_goal_hold": m(state.other_goal_hold, ["R004", "D09"]),
        "contingency_reserve": m(state.contingency, ["R003", "D09"]),
        "goal_allocation": m(state.goal_allocation, ["R004", "D06"]),
        "goal_available": m(state.goal_available, ["§1", "D05"]),
        "payment_headroom": m(state.payment_headroom, ["§1", "D05"]),
        "unallocated": m(state.unallocated, ["§1", "D05"]),
        "protected_total": m(state.protected_total, ["D05"]),
        "node_verdict": verdict,
        "amount": None if amount is None else m(amount, ["D05", "D34", "D35"]),
        "protected_over_cash": (
            None
            if protected_over is None
            else m(protected_over, ["D05", "D34"])
        ),
        "allocation_unsupported": (
            None
            if allocation_unsupported is None
            else m(allocation_unsupported, ["D34"])
        ),
        "related": event_ids,
    }


def _gap_ref(node: dict[str, Any], index: int) -> dict[str, Any]:
    return {
        "node_index": index,
        "at": node["at"],
        "node_verdict": node["node_verdict"],
        "amount": deepcopy(node["amount"]),
        "related": list(node["related"]),
    }


def run_timeline(
    case: dict[str, Any],
    plan_events: list[dict[str, Any]],
    *,
    candidate: dict[str, Any] | None = None,
    scenario_events: list[dict[str, Any]] | None = None,
    probe_amount: int | None = None,
    initial_allocation: int | None = None,
    planned_allocation: dict[str, Any] | None = None,
    cancelled: bool = False,
) -> TimelineRun:
    period = compute_check_period(case, plan_events, cancelled=cancelled)
    state = initial_state(case, release_allocation=cancelled)
    if state is None:
        return TimelineRun(period, [], None, [], [], [], None, None)
    if initial_allocation is not None:
        state.goal_allocation = initial_allocation
    if planned_allocation is None:
        planned_allocation = case.get("planned_allocation")

    events, issues = collect_timeline_events(
        case,
        plan_events,
        period,
        candidate=candidate,
        scenario_events=scenario_events,
        probe_amount=probe_amount,
        cancelled=cancelled,
    )
    nodes = [
        _node(
            state,
            case["snapshot"]["as_of"],
            "START",
            [],
            None,
            None,
        )
    ]
    applied: list[dict[str, Any]] = [
        deepcopy(event)
        for event in case["events"]
        if event.get("in_snapshot")
    ]
    for step in _same_day_steps(events):
        previous = nodes[-1]
        trigger_kind, event_ids = _trigger(step)
        if step["kind"] == "OUTFLOW_GROUP" and _coverage_oversubscribed(
            state, step["events"]
        ):
            issues.append(
                issue(
                    "GROUP_COVERAGE_OVERSUBSCRIBED",
                    "D10/D38",
                    event_ids,
                )
            )
            continue
        for event in step["events"]:
            _apply(state, event, applied, planned_allocation)
        nodes.append(
            _node(
                state,
                step["at"],
                trigger_kind,
                event_ids,
                previous["unallocated"]["value"],
                previous["node_verdict"],
            )
        )

    gap_list: list[dict[str, Any]] = []
    allocation_conflicts: list[dict[str, Any]] = []
    earliest: dict[str, Any] | None = None
    for index, node in enumerate(nodes):
        verdict = node["node_verdict"]
        if verdict in {"PROTECTED_SHORTFALL", "PAYMENT_SHORTFALL", "GAP_CONTINUED"}:
            ref = _gap_ref(node, index)
            gap_list.append(ref)
            if earliest is None and verdict in {
                "PROTECTED_SHORTFALL",
                "PAYMENT_SHORTFALL",
            }:
                earliest = deepcopy(ref)
        elif verdict in {"ALLOCATION_CONFLICT", "CONFLICT_CONTINUED"}:
            allocation_conflicts.append(_gap_ref(node, index))
    minimum = min(node["unallocated"]["value"] for node in nodes) if nodes else None
    return TimelineRun(
        period=period,
        nodes=nodes,
        earliest_gap=earliest,
        gap_list=gap_list,
        allocation_conflicts=allocation_conflicts,
        issues=issues,
        min_unallocated=minimum,
        final_state=state,
    )

