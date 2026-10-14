"""Semantic validation which is intentionally separate from JSON Schema."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from .config import SUPPORTED_END, SUPPORTED_START
from .dates import as_date, parse_date, parse_time


def issue(code: str, rule: str, refs: list[str] | tuple[str, ...]) -> dict[str, Any]:
    return {"code": code, "rule": rule, "refs": list(dict.fromkeys(refs))}


def _append_unique(issues: list[dict[str, Any]], item: dict[str, Any]) -> None:
    key = (item["code"], item["rule"], tuple(item["refs"]))
    if all((old["code"], old["rule"], tuple(old["refs"])) != key for old in issues):
        issues.append(item)


def _inside(day: date) -> bool:
    return parse_date(SUPPORTED_START) <= day <= parse_date(SUPPORTED_END)


def _event_time(event: dict[str, Any]) -> str | None:
    if event["event_status"] == "ACTUAL":
        return event.get("actual_at") or event.get("expected_at")
    return event.get("expected_at")


def validate_semantics(case: dict[str, Any]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    snapshot = case["snapshot"]

    try:
        as_of = parse_time(snapshot["as_of"], allow_date=False)
    except (ValueError, TypeError):
        as_of = None
        _append_unique(issues, issue("AS_OF_FORMAT", "R001/D03", ["snapshot.as_of"]))

    try:
        cash_as_of = parse_time(snapshot["cash_as_of"], allow_date=False)
    except (ValueError, TypeError):
        cash_as_of = None
        _append_unique(
            issues, issue("AS_OF_FORMAT", "R001/D03", ["snapshot.cash_as_of"])
        )

    if as_of is not None and cash_as_of is not None and as_of != cash_as_of:
        _append_unique(
            issues,
            issue(
                "CASH_AS_OF_MISMATCH",
                "R001",
                ["snapshot.as_of", "snapshot.cash_as_of"],
            ),
        )
    if as_of is not None and not _inside(as_of.date()):
        _append_unique(
            issues, issue("OUT_OF_RANGE", "R008", ["snapshot.as_of"])
        )
    if cash_as_of is not None and not _inside(cash_as_of.date()):
        _append_unique(
            issues, issue("OUT_OF_RANGE", "R008", ["snapshot.cash_as_of"])
        )

    phase = snapshot.get("snapshot_phase")
    if phase is None:
        _append_unique(
            issues,
            issue("SNAPSHOT_PHASE_MISSING", "D03", ["snapshot.snapshot_phase"]),
        )

    if snapshot.get("cash") is None:
        _append_unique(issues, issue("MISSING_KEY_INFO", "R010", ["snapshot.cash"]))
    elif snapshot["cash"] < 0:
        _append_unique(issues, issue("MISSING_KEY_INFO", "R007", ["snapshot.cash"]))
    if snapshot["goal_allocation"] < 0:
        _append_unique(
            issues, issue("MISSING_KEY_INFO", "R004/R007", ["snapshot.goal_allocation"])
        )
    if (
        snapshot.get("other_goal_hold") is not None
        and snapshot["other_goal_hold"]["amount"] < 0
    ):
        _append_unique(
            issues, issue("MISSING_KEY_INFO", "R004/R007", ["snapshot.other_goal_hold"])
        )
    if case["goal"].get("budget_cap") is None:
        _append_unique(issues, issue("MISSING_KEY_INFO", "R010", ["goal.budget_cap"]))
    elif case["goal"]["budget_cap"] < 0:
        _append_unique(issues, issue("MISSING_KEY_INFO", "R007", ["goal.budget_cap"]))

    event_ids: set[str] = set()
    reserve_by_id = {reserve["reserve_id"]: reserve for reserve in case["reserves"]}
    reserve_ids = set(reserve_by_id)
    cost_ids = {item["cost_item_id"] for item in case["cost_items"]}
    goal_id = case["goal"]["goal_id"]
    as_of_date = as_of.date() if as_of is not None else None
    same_day_snapshot_events: list[dict[str, Any]] = []
    same_day_actual_due: list[dict[str, Any]] = []
    same_day_cash_events: list[dict[str, Any]] = []

    for event in case["events"]:
        event_id = event["event_id"]
        if event_id in event_ids:
            _append_unique(
                issues, issue("REFERENCE_INVALID", "R002", [event_id])
            )
        event_ids.add(event_id)
        if event.get("goal_id") not in (None, goal_id):
            _append_unique(
                issues, issue("REFERENCE_INVALID", "R004", [event_id, event["goal_id"]])
            )
        if event.get("cost_item_id") is not None and event["cost_item_id"] not in cost_ids:
            _append_unique(
                issues,
                issue(
                    "REFERENCE_INVALID",
                    "R002",
                    [event_id, event["cost_item_id"]],
                ),
            )
        if event["currency"] != "CNY":
            _append_unique(issues, issue("NON_CNY", "R008", [event_id]))
        if event["amount"] is None or (
            event["event_kind"] != "CONTINGENCY_RELEASE" and event["amount"] <= 0
        ):
            _append_unique(issues, issue("MISSING_KEY_INFO", "R005", [event_id]))
        covered_total = 0
        for coverage in event["coverage"]:
            covered_total += coverage["covered_amount"]
            if coverage["covered_amount"] < 0:
                _append_unique(
                    issues, issue("COVERAGE_EXCEEDS_AMOUNT", "R003", [event_id])
                )
            if coverage["reserve_id"] not in reserve_ids:
                _append_unique(
                    issues,
                    issue(
                        "REFERENCE_INVALID",
                        "R003",
                        [event_id, coverage["reserve_id"]],
                    ),
                )
        if event["amount"] is not None and covered_total > event["amount"]:
            _append_unique(
                issues, issue("COVERAGE_EXCEEDS_AMOUNT", "R003", [event_id])
            )

        value = _event_time(event)
        if value is None:
            _append_unique(issues, issue("MISSING_KEY_INFO", "R005", [event_id]))
            continue
        try:
            day = as_date(value)
        except (ValueError, TypeError):
            _append_unique(issues, issue("AS_OF_FORMAT", "D03", [event_id]))
            continue
        for coverage in event["coverage"]:
            reserve = reserve_by_id.get(coverage["reserve_id"])
            if reserve is not None and not (
                parse_date(reserve["coverage_start"])
                <= day
                <= parse_date(reserve["coverage_end"])
            ):
                _append_unique(
                    issues,
                    issue(
                        "REFERENCE_INVALID",
                        "R003",
                        [event_id, coverage["reserve_id"]],
                    ),
                )

        pre_range_paid = (
            event.get("in_snapshot") is True
            and event["event_status"] == "ACTUAL"
            and event["event_kind"] in {"GOAL_PAYMENT", "RETURN"}
        )
        if not _inside(day) and not (pre_range_paid and day < parse_date(SUPPORTED_START)):
            _append_unique(issues, issue("OUT_OF_RANGE", "R008/D57", [event_id]))

        if (
            as_of_date is not None
            and day == as_of_date
            and event["event_kind"]
            in {"GOAL_PAYMENT", "OTHER_EXPENSE", "INCOME", "RETURN"}
        ):
            same_day_cash_events.append(event)
            if event.get("in_snapshot"):
                same_day_snapshot_events.append(event)
            if (
                event["event_status"] == "ACTUAL"
                and cash_as_of is not None
                and event.get("actual_at")
            ):
                try:
                    if parse_time(event["actual_at"]) <= cash_as_of:
                        same_day_actual_due.append(event)
                except ValueError:
                    pass

        if event.get("in_snapshot") and event["event_status"] != "ACTUAL":
            _append_unique(
                issues,
                issue("SNAPSHOT_PHASE_MISMATCH", "D03/D51", [event_id]),
            )
        if event in same_day_actual_due and not event.get("in_snapshot"):
            _append_unique(
                issues,
                issue("SNAPSHOT_PHASE_MISMATCH", "D03/D51", [event_id]),
            )
        if event["event_status"] == "ACTUAL" and event.get("actual_at") and cash_as_of is not None:
            try:
                occurred = parse_time(event["actual_at"])
                if event.get("in_snapshot") and occurred > cash_as_of:
                    _append_unique(
                        issues,
                        issue("SNAPSHOT_PHASE_MISMATCH", "D03/D51", [event_id]),
                    )
                if not event.get("in_snapshot") and occurred <= cash_as_of:
                    _append_unique(
                        issues,
                        issue("SNAPSHOT_PHASE_MISMATCH", "D03/D51", [event_id]),
                    )
            except ValueError:
                pass

    known_by_day: dict[str, dict[int, list[str]]] = {}
    for event in case["events"]:
        at = _event_time(event)
        if at is None or event.get("known_order") is None:
            continue
        known_by_day.setdefault(at[:10], {}).setdefault(
            event["known_order"], []
        ).append(event["event_id"])
    for orders in known_by_day.values():
        for refs in orders.values():
            if len(refs) > 1:
                _append_unique(
                    issues, issue("REFERENCE_INVALID", "D10", refs)
                )

    if phase is not None and as_of_date is not None:
        actual_count = len(same_day_snapshot_events)
        mismatch = False
        if phase == "DAY_START":
            mismatch = actual_count != 0
        elif phase == "DAY_END":
            mismatch = any(
                event not in same_day_snapshot_events
                for event in same_day_cash_events
            )
        else:
            match = re.fullmatch(r"AFTER_EVENT\(([1-9][0-9]*)\)", phase)
            mismatch = match is None or int(match.group(1)) != actual_count
        if mismatch:
            _append_unique(
                issues,
                issue(
                    "SNAPSHOT_PHASE_MISMATCH",
                    "D03/D51",
                    ["snapshot.snapshot_phase"],
                ),
            )

    for reserve in case["reserves"]:
        refs = [reserve["reserve_id"]]
        try:
            start = parse_date(reserve["coverage_start"])
            end = parse_date(reserve["coverage_end"])
            if start > end or not _inside(start) or not _inside(end):
                _append_unique(issues, issue("OUT_OF_RANGE", "R008", refs))
        except ValueError:
            _append_unique(issues, issue("AS_OF_FORMAT", "R008", refs))
        funding = reserve.get("funding_event_id")
        if funding is not None and funding not in event_ids:
            _append_unique(
                issues, issue("REFERENCE_INVALID", "D08", refs + [funding])
            )
        if reserve["amount"] < 0:
            _append_unique(issues, issue("MISSING_KEY_INFO", "R003", refs))

    try:
        show_start = as_date(case["goal"]["show_start_at"])
        show_end = as_date(case["goal"]["show_end_at"])
        if not _inside(show_start) or not _inside(show_end):
            _append_unique(
                issues, issue("OUT_OF_RANGE", "R008", [case["goal"]["goal_id"]])
            )
    except ValueError:
        _append_unique(
            issues, issue("AS_OF_FORMAT", "R008", [case["goal"]["goal_id"]])
        )

    for candidate in case["candidates"]:
        for item in candidate["items"]:
            refs = [candidate["candidate_id"], item["cost_item_id"]]
            if item["cost_item_id"] not in cost_ids:
                _append_unique(issues, issue("REFERENCE_INVALID", "R016", refs))
            if item["currency"] != "CNY":
                _append_unique(issues, issue("NON_CNY", "R008", refs))
            cost_item = next(
                (
                    cost
                    for cost in case["cost_items"]
                    if cost["cost_item_id"] == item["cost_item_id"]
                ),
                None,
            )
            if item["price"] is not None and (
                item["price"] < 0
                or (
                    item["price"] == 0
                    and (
                        cost_item is None
                        or cost_item["amount_status"] != "CONFIRMED_FREE"
                    )
                )
            ):
                _append_unique(issues, issue("MISSING_KEY_INFO", "R007/R020", refs))
            try:
                if not _inside(parse_date(item["purchase_date"])) or not _inside(
                    as_date(item["payment_at"])
                ):
                    _append_unique(issues, issue("OUT_OF_RANGE", "R008", refs))
            except ValueError:
                _append_unique(issues, issue("AS_OF_FORMAT", "R008", refs))
        for returned in candidate["returns"]:
            if returned["currency"] != "CNY":
                _append_unique(
                    issues,
                    issue(
                        "NON_CNY",
                        "R008",
                        [candidate["candidate_id"], returned["event_id"]],
                    ),
                )

    for row in case["price_series"]:
        if row["currency"] != "CNY":
            _append_unique(issues, issue("NON_CNY", "R008", [row["series_id"]]))
        if row["price"] <= 0:
            _append_unique(
                issues, issue("MISSING_KEY_INFO", "R020", [row["series_id"]])
            )
        try:
            if not _inside(parse_date(row["observed_on"])):
                _append_unique(
                    issues, issue("OUT_OF_RANGE", "R008", [row["series_id"]])
                )
        except ValueError:
            _append_unique(
                issues, issue("AS_OF_FORMAT", "R008", [row["series_id"]])
            )

    for record in case["consumption_records"]:
        for item in record["items"]:
            if item["currency"] != "CNY":
                _append_unique(
                    issues, issue("NON_CNY", "R008", [item["event_id"]])
                )

    return issues

