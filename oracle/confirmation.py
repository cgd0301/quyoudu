"""D18/D46 confirmation allocation and idempotent formalization."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .candidates import CandidateEvaluation
from .dates import as_date
from .ops import Runtime
from .result import money
from .timeline import run_timeline


@dataclass
class ConfirmationSuggestion:
    wire: dict[str, Any]
    delta_a: int
    planned_amount: int
    funding_event_id: str | None
    baseline_min: int


def _remaining_uncovered(case: dict[str, Any], candidate: CandidateEvaluation) -> int:
    base = [
        event
        for event in case["events"]
        if event["event_kind"] == "GOAL_PAYMENT"
        and not event["in_snapshot"]
        and event.get("amount") is not None
    ]
    total = 0
    for event in [*base, *candidate.plan_events]:
        declared = sum(item["covered_amount"] for item in event.get("coverage", []))
        total += max(0, event["amount"] - declared)
    return total


def _minimum_u(
    case: dict[str, Any],
    candidate: CandidateEvaluation,
    *,
    initial_allocation: int,
    planned_allocation: dict[str, Any] | None,
) -> int:
    run = run_timeline(
        case,
        candidate.plan_events,
        candidate=candidate.candidate,
        initial_allocation=initial_allocation,
        planned_allocation=planned_allocation,
    )
    if run.min_unallocated is None:
        raise ValueError("cannot derive confirmation allocation without a timeline")
    return run.min_unallocated


def _maximize(upper: int, predicate) -> int:
    low, high = 0, max(0, upper)
    while low < high:
        middle = (low + high + 1) // 2
        if predicate(middle):
            low = middle
        else:
            high = middle - 1
    assert predicate(low), "binary-search result must satisfy the allocation condition"
    if low < upper:
        assert not predicate(low + 1), "allocation +1 must fail before its upper bound"
    return low


def _funding_event(
    case: dict[str, Any], candidate: CandidateEvaluation
) -> str | None:
    if case.get("planned_allocation") is not None:
        return case["planned_allocation"]["funding_event_id"]
    as_of = as_date(case["snapshot"]["as_of"])
    last_payment = max(
        (
            as_date(event["expected_at"])
            for event in [
                *candidate.plan_events,
                *[
                    item
                    for item in case["events"]
                    if item["event_kind"] == "GOAL_PAYMENT"
                    and not item["in_snapshot"]
                    and item.get("expected_at") is not None
                ],
            ]
            if event["event_kind"] == "GOAL_PAYMENT"
        ),
        default=None,
    )
    incomes = sorted(
        (
            (as_date(event["expected_at"]), event["event_id"])
            for event in case["events"]
            if event["event_kind"] == "INCOME"
            and event["event_status"] == "EXPECTED"
            and not event["in_snapshot"]
            and event.get("amount") is not None
            and event.get("expected_at") is not None
            and not event.get("trigger_condition")
            and as_date(event["expected_at"]) > as_of
            and (
                last_payment is None
                or as_date(event["expected_at"]) < last_payment
            )
        ),
        key=lambda pair: (pair[0], pair[1]),
    )
    return incomes[0][1] if incomes else None


def suggest_confirmation(
    case: dict[str, Any],
    candidate: CandidateEvaluation,
    input_version: str,
) -> ConfirmationSuggestion:
    a0 = case["snapshot"]["goal_allocation"]
    w = _remaining_uncovered(case, candidate)
    baseline = candidate.timeline
    if baseline is None or baseline.min_unallocated is None:
        baseline_min = _minimum_u(
            case,
            candidate,
            initial_allocation=a0,
            planned_allocation=case.get("planned_allocation"),
        )
    else:
        baseline_min = baseline.min_unallocated
    delta_upper = max(0, w - a0)
    if w <= a0:
        delta = 0
    else:
        delta = _maximize(
            delta_upper,
            lambda amount: _minimum_u(
                case,
                candidate,
                initial_allocation=a0 + amount,
                planned_allocation=None,
            )
            >= baseline_min,
        )

    funding_id = _funding_event(case, candidate)
    planned_upper = max(0, w - a0 - delta)
    if funding_id is None or planned_upper == 0:
        planned = 0
    else:
        planned = _maximize(
            planned_upper,
            lambda amount: _minimum_u(
                case,
                candidate,
                initial_allocation=a0 + delta,
                planned_allocation={
                    "funding_event_id": funding_id,
                    "amount": amount,
                },
            )
            >= baseline_min,
        )
    remainder = max(0, w - a0 - delta - planned)
    candidate_id = candidate.candidate["candidate_id"]
    wire = {
        "candidate_id": candidate_id,
        "plan_version": f"{candidate_id}@v1",
        "input_version": input_version,
        "w": money(
            w,
            event_ids=[event["event_id"] for event in candidate.plan_events],
            rules=["R017", "D18", "D46"],
        ),
        "m": money(baseline_min, rules=["D18", "D46"]),
        "delta_a": money(delta, rules=["R017", "D18", "D46"]),
        "planned_allocation": (
            None
            if planned == 0 or funding_id is None
            else {
                "funding_event_id": funding_id,
                "amount": money(
                    planned,
                    event_ids=[funding_id],
                    rules=["R017", "D18", "D46"],
                ),
            }
        ),
        "unallocated_note": (
            None
            if remainder == 0
            else money(remainder, rules=["D06", "D46"])
        ),
    }
    return ConfirmationSuggestion(wire, delta, planned, funding_id, baseline_min)


def apply_confirmation(
    runtime: Runtime,
    op: dict[str, Any],
    candidate: CandidateEvaluation | None,
) -> bool:
    key = (op["candidate_id"], op["plan_version"], op["input_version"])
    if key in runtime.accepted_confirmations:
        return True
    if candidate is None or candidate.candidate["candidate_id"] != op["candidate_id"]:
        runtime.draft_candidate_id = op["candidate_id"]
        return False
    if op["plan_version"] != f"{op['candidate_id']}@v1":
        runtime.draft_candidate_id = op["candidate_id"]
        return False
    if int(op["input_version"][1:]) > runtime.input_version_number:
        runtime.draft_candidate_id = op["candidate_id"]
        return False
    suggestion = suggest_confirmation(runtime.case, candidate, runtime.input_version)
    if candidate.feasible is not True or candidate.timeline is None:
        runtime.draft_candidate_id = op["candidate_id"]
        return False
    planned = (
        None
        if suggestion.planned_amount == 0 or suggestion.funding_event_id is None
        else {
            "funding_event_id": suggestion.funding_event_id,
            "amount": suggestion.planned_amount,
        }
    )
    rerun = run_timeline(
        runtime.case,
        candidate.plan_events,
        candidate=candidate.candidate,
        initial_allocation=runtime.case["snapshot"]["goal_allocation"]
        + suggestion.delta_a,
        planned_allocation=planned,
    )
    if not rerun.passes or candidate.cost.budget_overrun is not None:
        runtime.draft_candidate_id = op["candidate_id"]
        return False
    runtime.last_confirmation = suggestion.wire
    runtime.case["snapshot"]["goal_allocation"] += suggestion.delta_a
    runtime.case["planned_allocation"] = planned
    runtime.case["confirmed_plan"] = {
        "candidate_id": op["candidate_id"],
        "plan_version": op["plan_version"],
        "input_version": runtime.input_version,
    }
    frozen = deepcopy(candidate.candidate)
    for index, item in enumerate(frozen["items"]):
        if candidate.item_amounts[index] is not None:
            item["price"] = candidate.item_amounts[index]
    runtime.confirmed_candidate_data = frozen
    runtime.confirmed_forecast_confirmations = deepcopy(
        runtime.case.get("forecast_confirmations", [])
    )
    runtime.accepted_confirmations.add(key)
    runtime.draft_candidate_id = None
    runtime.bump_version()
    runtime.formalized_version_number = runtime.input_version_number
    return True

