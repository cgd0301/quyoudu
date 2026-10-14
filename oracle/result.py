"""ResultCore wire helpers."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .config import CONFIG_VERSION, TOP_K, TOP_K_LABEL


def _unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def basis(
    *,
    event_ids: Iterable[str] = (),
    reserve_ids: Iterable[str] = (),
    rules: Iterable[str] = (),
) -> dict[str, list[str]]:
    return {
        "event_ids": _unique(event_ids),
        "reserve_ids": _unique(reserve_ids),
        "rules": _unique(rules),
    }


def money(
    value: int,
    *,
    event_ids: Iterable[str] = (),
    reserve_ids: Iterable[str] = (),
    rules: Iterable[str] = (),
) -> dict[str, Any]:
    if type(value) is not int:
        raise TypeError(f"money value must be int cents, got {type(value).__name__}")
    return {
        "value": value,
        "basis": basis(event_ids=event_ids, reserve_ids=reserve_ids, rules=rules),
    }


def empty_cost() -> dict[str, Any]:
    return {
        "paid_total": money(0, rules=["R002", "R007", "§3"]),
        "future_payable": money(0, rules=["R007", "§3"]),
        "eligible_return": money(0, rules=["R005", "D12", "§3"]),
        "net_spend": money(0, rules=["R007", "§3"]),
        "net_spend_if_received": money(0, rules=["R005", "§3"]),
        "budget_overrun": None,
        "paid_payments": [],
        "future_payments": [],
        "protected_reserves": {
            "living_reserve": money(0, rules=["§1"]),
            "other_protected_reserve": money(0, rules=["§1"]),
            "other_goal_hold": money(0, rules=["§1"]),
        },
        "contingency_reserve": money(0, rules=["§1"]),
        "pending_cost_item_ids": [],
        "possible_refund": None,
    }


def unavailable_daily() -> dict[str, Any]:
    return {
        "display": "NEED_CONFIRMED_PLAN",
        "unavailable": [],
        "missing_reasons": [],
    }


def result_skeleton(as_of: str, input_version: str) -> dict[str, Any]:
    """A schema-complete conservative result used by the staged engine."""

    return {
        "as_of": as_of,
        "input_version": input_version,
        "config_version": CONFIG_VERSION,
        "top_k_label": TOP_K_LABEL,
        "check_period": {"start": as_of, "end": None, "out_of_range": False},
        "input_issues": [],
        "snapshot": None,
        "nodes": [],
        "earliest_gap": None,
        "gap_list": [],
        "constraint_issues": {
            "budget_overrun": None,
            "allocation_conflicts": [],
        },
        "cost": empty_cost(),
        "dependencies": [],
        "candidates": [],
        "optimization": {
            "scope": [],
            "evaluated_count": 0,
            "pending_count": 0,
            "excluded_count": 0,
            "top_k": TOP_K,
        },
        "confirmation": None,
        "action_list": [],
        "pending_differences": [],
        "daily_reference": unavailable_daily(),
        "user_confirmations": [],
        "states": {
            "plan_state": "INCOMPLETE",
            "underlying_plan_state": None,
            "optimization_state": "NOT_COMPARED",
            "confirmation_state": "NOT_SELECTED",
            "plan_target": "NONE",
        },
        "labels": ["SIMULATED_DATA", "TOP_K_DEMO"],
    }


def money_value(item: dict[str, Any] | None) -> int | None:
    return None if item is None else item["value"]

