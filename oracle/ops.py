"""Operation state and the direct CaseFile mutations from rules.md §12.4."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .dates import as_date, parse_date, parse_time


@dataclass
class Runtime:
    case: dict[str, Any]
    input_version_number: int = 1
    selected_candidate_id: str | None = None
    decision: str | None = None
    accepted_confirmations: set[tuple[str, str, str]] = field(default_factory=set)
    last_confirmation: dict[str, Any] | None = None
    draft_candidate_id: str | None = None
    confirmed_candidate_data: dict[str, Any] | None = None
    confirmed_forecast_confirmations: list[dict[str, Any]] = field(default_factory=list)
    formalized_version_number: int | None = None

    @classmethod
    def from_case(cls, case: dict[str, Any]) -> "Runtime":
        copied = deepcopy(case)
        confirmed = copied.get("confirmed_plan")
        candidate = None
        accepted: set[tuple[str, str, str]] = set()
        if confirmed is not None:
            candidate = next(
                (
                    deepcopy(item)
                    for item in copied["candidates"]
                    if item["candidate_id"] == confirmed["candidate_id"]
                ),
                None,
            )
            accepted.add(
                (
                    confirmed["candidate_id"],
                    confirmed["plan_version"],
                    confirmed["input_version"],
                )
            )
        return cls(
            case=copied,
            accepted_confirmations=accepted,
            confirmed_candidate_data=candidate,
            confirmed_forecast_confirmations=deepcopy(
                copied.get("forecast_confirmations", [])
            ),
            formalized_version_number=1 if confirmed is not None else None,
        )

    @property
    def input_version(self) -> str:
        return f"v{self.input_version_number}"

    def bump_version(self) -> None:
        self.input_version_number += 1


def _pointer_tokens(pointer: str) -> list[str]:
    if not pointer.startswith("/"):
        raise ValueError("PATCH path must be an RFC 6901 JSON Pointer")
    if pointer == "/":
        return [""]
    return [part.replace("~1", "/").replace("~0", "~") for part in pointer[1:].split("/")]


def apply_patch(document: Any, pointer: str, value: Any) -> None:
    tokens = _pointer_tokens(pointer)
    target = document
    for token in tokens[:-1]:
        if isinstance(target, list):
            target = target[int(token)]
        elif isinstance(target, dict):
            target = target[token]
        else:
            raise ValueError(f"PATCH path traverses a scalar at {token!r}")
    final = tokens[-1]
    if isinstance(target, list):
        index = int(final)
        if not 0 <= index < len(target):
            raise IndexError(f"PATCH array index out of range: {index}")
        target[index] = deepcopy(value)
    elif isinstance(target, dict):
        if final not in target:
            raise KeyError(f"PATCH path does not exist: {pointer}")
        target[final] = deepcopy(value)
    else:
        raise ValueError("PATCH path parent is a scalar")


def _date_part(value: str) -> str:
    return value[:10]


def _remove_added_living(runtime: Runtime, event_id: str) -> None:
    old = next((event for event in runtime.case["events"] if event["event_id"] == event_id), None)
    if old is None or old.get("_added_by_op") is not True:
        return
    runtime.case["events"].remove(old)
    for coverage in old.get("coverage", []):
        reserve_id = coverage["reserve_id"]
        reserve = next(
            (item for item in runtime.case["reserves"] if item["reserve_id"] == reserve_id),
            None,
        )
        if reserve is not None and reserve.get("_added_by_op") is True:
            runtime.case["reserves"].remove(reserve)


def _clean_private_markers(case: dict[str, Any]) -> dict[str, Any]:
    """Return a schema-safe deep copy, useful for diagnostics and tests."""

    result = deepcopy(case)
    for collection in ("events", "reserves"):
        for item in result.get(collection, []):
            for key in [name for name in item if name.startswith("_")]:
                del item[key]
    return result


def apply_direct_operation(runtime: Runtime, op: dict[str, Any]) -> bool:
    """Apply an operation that does not require an engine evaluation.

    Returns True when handled. CONFIRM, CONFIRM_FORECASTS and EVALUATE are
    deliberately left to the orchestrator.
    """

    kind = op["type"]
    case = runtime.case
    as_of = case["snapshot"]["as_of"]

    if kind == "SELECT_CANDIDATE":
        runtime.selected_candidate_id = op["candidate_id"]
        return True

    if kind == "PATCH":
        apply_patch(case, op["path"], op["value"])
        runtime.bump_version()
        return True

    if kind == "SET_ALLOCATION":
        case["snapshot"]["goal_allocation"] = op["goal_allocation"]
        runtime.bump_version()
        return True

    if kind == "DELAY_INCOME":
        event = next(
            (
                item
                for item in case["events"]
                if item["event_id"] == op["event_id"]
                and item["event_kind"] in {"INCOME", "RETURN"}
                and item["event_status"] == "EXPECTED"
            ),
            None,
        )
        if event is None:
            raise ValueError(f"DELAY_INCOME event not found: {op['event_id']}")
        event["expected_at"] = op["expected_at"]
        runtime.bump_version()
        return True

    if kind == "CHANGE_PAYMENT_DATE":
        found = False
        for event in case["events"]:
            for window in event.get("payment_windows", []):
                if window["window_id"] == op["window_id"]:
                    event["expected_at"] = window["expected_at"]
                    found = True
        for candidate in case["candidates"]:
            for item in candidate["items"]:
                for window in item.get("payment_windows", []):
                    if window["window_id"] == op["window_id"]:
                        item["payment_at"] = window["payment_at"]
                        found = True
        if not found:
            raise ValueError(f"payment window not found: {op['window_id']}")
        runtime.bump_version()
        return True

    if kind == "ADD_LIVING_EXPENSE":
        _remove_added_living(runtime, op["event_id"])
        reserve_id = op["reserve_id"]
        date = _date_part(op["expected_at"])
        if op["amount"] < 0:
            raise ValueError("ADD_LIVING_EXPENSE amount must be non-negative")
        if op["cover_mode"] == "NEW_RESERVE":
            existing = next(
                (item for item in case["reserves"] if item["reserve_id"] == reserve_id),
                None,
            )
            if existing is not None:
                raise ValueError(f"new reserve id already exists: {reserve_id}")
            case["reserves"].append(
                {
                    "reserve_id": reserve_id,
                    "reserve_kind": "LIVING",
                    "amount": op["amount"],
                    "coverage_start": date,
                    "coverage_end": date,
                    "release_at_end": False,
                    "_added_by_op": True,
                }
            )
        else:
            existing = next(
                (item for item in case["reserves"] if item["reserve_id"] == reserve_id),
                None,
            )
            if existing is None:
                raise ValueError(f"existing reserve not found: {reserve_id}")
            if not (
                existing["coverage_start"] <= date <= existing["coverage_end"]
            ):
                raise ValueError("living expense is outside the reserve coverage period")
        event = {
            "event_id": op["event_id"],
            "event_kind": "OTHER_EXPENSE",
            "event_status": "EXPECTED",
            "amount": op["amount"],
            "expected_at": op["expected_at"],
            "time_precision": "DATETIME" if "T" in op["expected_at"] else "DATE",
            "in_snapshot": False,
            "coverage": [{"reserve_id": reserve_id, "covered_amount": op["amount"]}],
            "recorded_at": as_of,
            "available_at": as_of,
            "currency": "CNY",
            "category": op.get("category", "MEALS"),
            "_added_by_op": True,
        }
        case["events"].append(event)
        runtime.bump_version()
        return True

    if kind == "ADD_TODAY_SPEND":
        old = next((event for event in case["events"] if event["event_id"] == op["event_id"]), None)
        if old is not None:
            if old.get("in_snapshot"):
                if old.get("_added_by_op") is not True:
                    raise ValueError(f"actual event is already in snapshot: {op['event_id']}")
                case["snapshot"]["cash"] += old["amount"]
                for coverage in old.get("_actual_coverage", []):
                    reserve = next(
                        item
                        for item in case["reserves"]
                        if item["reserve_id"] == coverage["reserve_id"]
                    )
                    reserve["amount"] += coverage["covered_amount"]
                case["snapshot"]["goal_allocation"] += old.get(
                    "_allocation_used", 0
                )
            elif old["event_status"] != "EXPECTED":
                raise ValueError(f"event id cannot be converted to actual: {op['event_id']}")
            case["events"].remove(old)

        amount = op["amount"]
        actual_at = parse_time(op["actual_at"])
        current_at = parse_time(as_of)
        if actual_at.date() != current_at.date() or actual_at > current_at:
            raise ValueError("ADD_TODAY_SPEND must be an already occurred spend today")
        if amount < 0:
            raise ValueError("ADD_TODAY_SPEND amount must be non-negative")
        if sum(item["covered_amount"] for item in op["coverage"]) > amount:
            raise ValueError("coverage exceeds ADD_TODAY_SPEND amount")
        if case["snapshot"]["cash"] is None:
            raise ValueError("cannot add actual spend to an unknown cash snapshot")
        case["snapshot"]["cash"] -= amount
        total_covered = 0
        actual_coverage: list[dict[str, Any]] = []
        for coverage in op["coverage"]:
            reserve = next(
                (
                    item
                    for item in case["reserves"]
                    if item["reserve_id"] == coverage["reserve_id"]
                ),
                None,
            )
            if reserve is None:
                raise ValueError(f"reserve not found: {coverage['reserve_id']}")
            declared = coverage["covered_amount"]
            if declared < 0:
                raise ValueError("covered_amount must be non-negative")
            if not (
                parse_date(reserve["coverage_start"])
                <= actual_at.date()
                <= parse_date(reserve["coverage_end"])
            ):
                raise ValueError("spend is outside the reserve coverage period")
            funding_id = reserve.get("funding_event_id")
            established = funding_id is None or any(
                event["event_id"] == funding_id and event.get("in_snapshot")
                for event in case["events"]
            )
            covered = 0
            if established:
                if declared > reserve["amount"]:
                    raise ValueError("coverage exceeds remaining reserve")
                covered = declared
                reserve["amount"] -= covered
                actual_coverage.append(
                    {
                        "reserve_id": coverage["reserve_id"],
                        "covered_amount": covered,
                    }
                )
                total_covered += covered
        allocation_used = 0
        if op.get("goal_id") == case["goal"]["goal_id"]:
            uncovered = max(0, amount - total_covered)
            allocation_used = min(uncovered, case["snapshot"]["goal_allocation"])
            case["snapshot"]["goal_allocation"] -= allocation_used
        new_event = {
                "event_id": op["event_id"],
                "event_kind": (
                    "GOAL_PAYMENT"
                    if op.get("goal_id") == case["goal"]["goal_id"]
                    else "OTHER_EXPENSE"
                ),
                "event_status": "ACTUAL",
                "amount": amount,
                "expected_at": op["actual_at"],
                "actual_at": op["actual_at"],
                "time_precision": "DATETIME",
                "in_snapshot": True,
                "coverage": deepcopy(op["coverage"]),
                "recorded_at": as_of,
                "available_at": as_of,
                "currency": "CNY",
                **({"category": op["category"]} if "category" in op else {}),
                "_added_by_op": True,
                "_actual_coverage": actual_coverage,
                "_allocation_used": allocation_used,
            }
        if "goal_id" in op:
            new_event["goal_id"] = op["goal_id"]
        if "cost_item_id" in op:
            new_event["cost_item_id"] = op["cost_item_id"]
        case["events"].append(new_event)
        same_day_actuals = [
            event
            for event in case["events"]
            if event.get("in_snapshot")
            and event["event_kind"] in {"GOAL_PAYMENT", "OTHER_EXPENSE", "INCOME", "RETURN"}
            and _date_part(event.get("actual_at") or event.get("expected_at") or "") == _date_part(as_of)
        ]
        case["snapshot"]["snapshot_phase"] = f"AFTER_EVENT({len(same_day_actuals)})"
        runtime.bump_version()
        return True

    if kind == "PAUSE":
        runtime.decision = "PAUSED"
        runtime.bump_version()
        return True

    if kind == "CANCEL":
        runtime.decision = "CANCELLED"
        runtime.bump_version()
        return True

    return False


def schema_safe_case(runtime: Runtime) -> dict[str, Any]:
    return _clean_private_markers(runtime.case)

