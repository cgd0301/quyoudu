"""Plan, optimization and confirmation state selection from §11."""

from __future__ import annotations

from typing import Any

from .candidates import CandidateEvaluation, OptimizationResult
from .costs import CostComputation
from .ops import Runtime
from .timeline import TimelineRun


def underlying_plan_state(
    *,
    input_issues: list[dict[str, Any]],
    candidate: CandidateEvaluation | None,
    timeline: TimelineRun | None,
    cost: CostComputation,
    cancelled: bool = False,
) -> str:
    if input_issues:
        return "INCOMPLETE"
    if candidate is None and not cancelled:
        return "INCOMPLETE"
    if candidate is not None and not candidate.evaluable and not cancelled:
        return "INCOMPLETE"
    if cost.pending_cost_item_ids or cost.future_payable is None or cost.net_spend is None:
        return "INCOMPLETE"
    if timeline is None or timeline.period.out_of_range or timeline.issues:
        return "INCOMPLETE"
    if timeline.earliest_gap is not None:
        return "PAYMENT_GAP"
    if (
        timeline.allocation_conflicts
        or cost.budget_overrun is not None
        or (
            not cancelled
            and candidate is not None
            and candidate.excluded_reasons
        )
    ):
        return "CONSTRAINT_ISSUE"
    return "FEASIBLE_UNDER_ASSUMPTIONS"


def state_wire(
    runtime: Runtime,
    optimization: OptimizationResult,
    candidate: CandidateEvaluation | None,
    underlying: str,
) -> dict[str, Any]:
    if runtime.decision == "PAUSED":
        plan_state = "PAUSED"
        underlying_output: str | None = underlying
    elif runtime.decision == "CANCELLED":
        plan_state = "CANCELLED"
        underlying_output = underlying
    else:
        plan_state = underlying
        underlying_output = None

    if runtime.case.get("confirmed_plan") is not None:
        confirmation_state = "CONFIRMED"
        plan_target = "CONFIRMED_PLAN"
    elif runtime.draft_candidate_id is not None:
        confirmation_state = "DRAFT"
        plan_target = "SELECTED_CANDIDATE"
    elif runtime.selected_candidate_id is not None:
        confirmation_state = "PENDING_CONFIRMATION"
        plan_target = "SELECTED_CANDIDATE"
    else:
        confirmation_state = "NOT_SELECTED"
        plan_target = "NONE"
    return {
        "plan_state": plan_state,
        "underlying_plan_state": underlying_output,
        "optimization_state": optimization.state,
        "confirmation_state": confirmation_state,
        "plan_target": plan_target,
    }

