"""Price items of cost items that already have a goal payment (D75)."""

from __future__ import annotations

from typing import Any


def purchased_cost_item_ids(
    case: dict[str, Any], *, cancelled: bool = False
) -> set[str]:
    return {
        event["cost_item_id"]
        for event in case["events"]
        if event["event_kind"] == "GOAL_PAYMENT"
        and event.get("cost_item_id") is not None
        # D61: once cancelled, a cancellable unpaid payment no longer counts.
        and not (
            cancelled
            and event.get("cancellable") is True
            and event["event_status"] == "EXPECTED"
        )
    }


def alternate_quote_indexes(
    case: dict[str, Any],
    candidate: dict[str, Any],
    *,
    cancelled: bool = False,
) -> set[int]:
    purchased = purchased_cost_item_ids(case, cancelled=cancelled)
    return {
        index
        for index, item in enumerate(candidate["items"])
        if "settles_event_id" not in item and item["cost_item_id"] in purchased
    }


def settles_target_valid(case: dict[str, Any], item: dict[str, Any]) -> bool:
    return any(
        event["event_id"] == item["settles_event_id"]
        and event["event_kind"] == "GOAL_PAYMENT"
        and event.get("cost_item_id") == item["cost_item_id"]
        for event in case["events"]
    )
