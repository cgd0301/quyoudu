"""Historical cost, future payable, returns and budget arithmetic."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .result import money
from .snapshot import initial_state


@dataclass
class CostComputation:
    paid_total: int
    future_payable: int | None
    eligible_return: int
    net_spend: int | None
    net_spend_if_received: int | None
    budget_overrun: int | None
    paid_payments: list[dict[str, Any]]
    future_payments: list[dict[str, Any]]
    pending_cost_item_ids: list[str]
    wire: dict[str, Any]


def _historical_paid(case: dict[str, Any]) -> list[dict[str, Any]]:
    goal_id = case["goal"]["goal_id"]
    return [
        event
        for event in case["events"]
        if event["event_kind"] == "GOAL_PAYMENT"
        and event["event_status"] == "ACTUAL"
        and (
            event.get("goal_id") in (None, goal_id)
            or event.get("cost_item_id") is not None
        )
        and event.get("amount") is not None
    ]


def _historical_returns(case: dict[str, Any]) -> list[dict[str, Any]]:
    goal_id = case["goal"]["goal_id"]
    cost_ids = {item["cost_item_id"] for item in case["cost_items"]}
    return [
        event
        for event in case["events"]
        if event["event_kind"] == "RETURN"
        and event["event_status"] == "ACTUAL"
        and event.get("amount") is not None
        and (
            event.get("goal_id") == goal_id
            or event.get("cost_item_id") in cost_ids
        )
    ]


def compute_cost(
    case: dict[str, Any],
    future_events: list[dict[str, Any]],
    candidate_returns: list[dict[str, Any]],
    pending_cost_item_ids: list[str],
) -> CostComputation:
    paid = _historical_paid(case)
    historical_returns = _historical_returns(case)
    paid_total = sum(event["amount"] for event in paid)
    future_goal = [
        event
        for event in future_events
        if event["event_kind"] == "GOAL_PAYMENT" and event.get("amount") is not None
    ]
    future_total = (
        None if pending_cost_item_ids else sum(event["amount"] for event in future_goal)
    )

    goal_id = case["goal"]["goal_id"]
    cost_ids = {item["cost_item_id"] for item in case["cost_items"]}
    base_future_returns = [
        event
        for event in case["events"]
        if event["event_kind"] == "RETURN"
        and event["event_status"] == "EXPECTED"
        and not event["in_snapshot"]
        and event.get("amount") is not None
        and event.get("expected_at") is not None
        and (
            event.get("goal_id") == goal_id
            or event.get("cost_item_id") in cost_ids
        )
    ]
    merged_returns: list[dict[str, Any]] = []
    seen_return_ids: set[str] = set()
    for returned in [*base_future_returns, *candidate_returns]:
        if returned["event_id"] not in seen_return_ids:
            seen_return_ids.add(returned["event_id"])
            merged_returns.append(returned)
    eligible_future_returns = [
        returned
        for returned in merged_returns
        if returned.get("amount") is not None
        and returned.get("expected_at") is not None
        and not returned.get("trigger_condition")
    ]
    all_known_future_returns = [
        returned
        for returned in merged_returns
        if returned.get("amount") is not None and returned.get("expected_at") is not None
    ]
    eligible_return = sum(event["amount"] for event in historical_returns) + sum(
        item["amount"] for item in eligible_future_returns
    )
    if future_total is None:
        net_spend = None
        net_if = None
    else:
        net_spend = paid_total + future_total - eligible_return
        net_if = (
            paid_total
            + future_total
            - sum(event["amount"] for event in historical_returns)
            - sum(item["amount"] for item in all_known_future_returns)
        )
    budget = case["goal"]["budget_cap"]
    budget_overrun = (
        None
        if net_spend is None or budget is None or net_spend <= budget
        else net_spend - budget
    )
    paid_ids = [event["event_id"] for event in paid]
    future_ids = [event["event_id"] for event in future_goal]
    return_ids = [
        event["event_id"] for event in historical_returns + eligible_future_returns
    ]
    state = initial_state(case)
    if state is None:
        living = other = hold = contingency = 0
        living_ids: list[str] = []
        other_ids: list[str] = []
        contingency_ids: list[str] = []
    else:
        living = state.living
        other = state.other_protected
        hold = state.other_goal_hold
        contingency = state.contingency
        living_ids = [
            reserve.reserve_id
            for reserve in state.reserves.values()
            if reserve.established and reserve.kind == "LIVING"
        ]
        other_ids = [
            reserve.reserve_id
            for reserve in state.reserves.values()
            if reserve.established and reserve.kind == "OTHER_PROTECTED"
        ]
        contingency_ids = [
            reserve.reserve_id
            for reserve in state.reserves.values()
            if reserve.established and reserve.kind == "CONTINGENCY"
        ]

    paid_payments = [
        {
            "event_id": event["event_id"],
            "cost_item_id": event.get("cost_item_id"),
            "at": event.get("actual_at") or event.get("expected_at"),
            "amount": money(
                event["amount"], event_ids=[event["event_id"]], rules=["R002", "R007"]
            ),
        }
        for event in paid
    ]
    future_payments = [
        {
            "event_id": event["event_id"],
            "cost_item_id": event.get("cost_item_id"),
            "at": event.get("expected_at"),
            "amount": money(
                event["amount"], event_ids=[event["event_id"]], rules=["R007", "§3"]
            ),
        }
        for event in future_goal
    ]
    wire = {
        "paid_total": money(paid_total, event_ids=paid_ids, rules=["R002", "R007", "§3"]),
        "future_payable": (
            None
            if future_total is None
            else money(future_total, event_ids=future_ids, rules=["R007", "§3"])
        ),
        "eligible_return": money(
            eligible_return, event_ids=return_ids, rules=["R005", "D12", "§3"]
        ),
        "net_spend": (
            None
            if net_spend is None
            else money(
                net_spend,
                event_ids=paid_ids + future_ids + return_ids,
                rules=["R007", "§3"],
            )
        ),
        "net_spend_if_received": (
            None
            if net_if is None
            else money(
                net_if,
                event_ids=paid_ids
                + future_ids
                + [
                    item["event_id"]
                    for item in historical_returns + all_known_future_returns
                ],
                rules=["R005", "D12", "§3"],
            )
        ),
        "budget_overrun": (
            None
            if budget_overrun is None
            else money(budget_overrun, rules=["R004", "R007", "§3"])
        ),
        "paid_payments": paid_payments,
        "future_payments": future_payments,
        "protected_reserves": {
            "living_reserve": money(
                living, reserve_ids=living_ids, rules=["R003", "§1"]
            ),
            "other_protected_reserve": money(
                other, reserve_ids=other_ids, rules=["R003", "§1"]
            ),
            "other_goal_hold": money(hold, rules=["R004", "D09", "§1"]),
        },
        "contingency_reserve": money(
            contingency, reserve_ids=contingency_ids, rules=["R003", "D09", "§1"]
        ),
        "pending_cost_item_ids": list(dict.fromkeys(pending_cost_item_ids)),
        "possible_refund": None,
    }
    return CostComputation(
        paid_total=paid_total,
        future_payable=future_total,
        eligible_return=eligible_return,
        net_spend=net_spend,
        net_spend_if_received=net_if,
        budget_overrun=budget_overrun,
        paid_payments=paid_payments,
        future_payments=future_payments,
        pending_cost_item_ids=list(dict.fromkeys(pending_cost_item_ids)),
        wire=wire,
    )

