"""Recent-month consumption scenario construction (R018 and D21-D23)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, localcontext
from typing import Any

from .config import (
    CONFIG_VERSION,
    DECIMAL_CONTEXT,
    SCENARIO_WINDOW_DAYS,
    SUPPORTED_START,
)
from .dates import as_date, days_inclusive, parse_date
from .result import money
from .timeline import CheckPeriod


CATEGORY_RULES: dict[str, tuple[bool, bool]] = {
    "MEALS": (True, False),
    "LOCAL_TRANSPORT": (True, False),
    "DAILY_GOODS": (True, False),
    "ENTERTAINMENT": (False, True),
}


@dataclass
class ScenarioComputation:
    wire: dict[str, Any]
    events: list[dict[str, Any]]
    today_replacement: int | None

    @property
    def available(self) -> bool:
        return self.wire["available"]


def confirmed_only_scenario() -> ScenarioComputation:
    return ScenarioComputation(
        wire={
            "kind": "CONFIRMED_ONLY",
            "available": True,
            "unavailable_reason": None,
            "config_version": CONFIG_VERSION,
            "observation_start": None,
            "observation_end": None,
            "complete_days": 0,
            "groups": [],
            "today_replacement": None,
            "daily_reference": None,
        },
        events=[],
        today_replacement=None,
    )


def _unavailable(
    reason: str,
    observation_start: date | None,
    observation_end: date | None,
    complete_days: int,
) -> ScenarioComputation:
    return ScenarioComputation(
        wire={
            "kind": "RECENT_MONTH",
            "available": False,
            "unavailable_reason": reason,
            "config_version": CONFIG_VERSION,
            "observation_start": (
                None if observation_start is None else observation_start.isoformat()
            ),
            "observation_end": (
                None if observation_end is None else observation_end.isoformat()
            ),
            "complete_days": complete_days,
            "groups": [],
            "today_replacement": None,
            "daily_reference": None,
        },
        events=[],
        today_replacement=None,
    )


def _split_living_periods(
    case: dict[str, Any], start: date, end: date
) -> list[tuple[date, date, str]] | None:
    periods: list[tuple[date, date, str]] = []
    day_to_reserve: dict[date, str] = {}
    living = [
        reserve for reserve in case["reserves"] if reserve["reserve_kind"] == "LIVING"
    ]
    for day in days_inclusive(start, end):
        matching = [
            reserve["reserve_id"]
            for reserve in living
            if parse_date(reserve["coverage_start"])
            <= day
            <= parse_date(reserve["coverage_end"])
        ]
        if len(matching) > 1:
            return None
        day_to_reserve[day] = matching[0] if matching else ""
    if not day_to_reserve:
        return []
    group_start = start
    current = day_to_reserve[start]
    previous = start
    for day in days_inclusive(start + timedelta(days=1), end):
        if day_to_reserve[day] != current:
            periods.append((group_start, previous, current))
            group_start = day
            current = day_to_reserve[day]
        previous = day
    periods.append((group_start, end, current))
    return periods


def _allocate(total: int, days: list[date]) -> list[tuple[date, int]]:
    if not days:
        return []
    quotient, remainder = divmod(total, len(days))
    return [
        (day, quotient + (1 if index < remainder else 0))
        for index, day in enumerate(days)
    ]


def _actual_today_same_scope(case: dict[str, Any]) -> int:
    today = as_date(case["snapshot"]["as_of"])
    as_of = parse_time_safe(case["snapshot"]["as_of"])
    total = 0
    seen: set[str] = set()
    for event in case["events"]:
        if (
            event["event_status"] == "ACTUAL"
            and event.get("in_snapshot")
            and event.get("category") == "ENTERTAINMENT"
            and event.get("actual_at")
            and as_date(event["actual_at"]) == today
            and parse_time_safe(event["available_at"]) <= as_of
        ):
            total += event["amount"] or 0
            seen.add(event["event_id"])
    for record in case["consumption_records"]:
        if parse_date(record["observed_on"]) != today:
            continue
        for item in record["items"]:
            if (
                item["event_id"] not in seen
                and item["category"] == "ENTERTAINMENT"
                and item.get("in_snapshot")
                and item.get("covered_by_living_reserve") is False
                and item.get("same_scope_as_discretionary") is True
                and parse_time_safe(item["available_at"]) <= as_of
            ):
                total += item["amount"]
                seen.add(item["event_id"])
    return total


def recent_month_scenario(
    case: dict[str, Any], period: CheckPeriod
) -> ScenarioComputation:
    today = as_date(case["snapshot"]["as_of"])
    observation_end = today - timedelta(days=1)
    observation_start = observation_end - timedelta(days=SCENARIO_WINDOW_DAYS - 1)
    if observation_start < parse_date(SUPPORTED_START):
        return _unavailable("HISTORY_INSUFFICIENT", observation_start, observation_end, 0)

    window_records = [
        record
        for record in case["consumption_records"]
        if observation_start <= parse_date(record["observed_on"]) <= observation_end
    ]
    records = {
        parse_date(record["observed_on"]): record for record in window_records
    }
    complete_days = sum(
        record["day_coverage"] in {"COMPLETE", "NO_SPEND"}
        for record in records.values()
    )
    required_days = days_inclusive(observation_start, observation_end)
    if complete_days < SCENARIO_WINDOW_DAYS:
        return _unavailable(
            "HISTORY_INSUFFICIENT",
            observation_start,
            observation_end,
            complete_days,
        )
    if len(records) != len(window_records) or any(
        record["day_coverage"] == "NO_SPEND" and record["items"]
        for record in window_records
    ):
        return _unavailable(
            "RECORDS_INCOMPLETE",
            observation_start,
            observation_end,
            complete_days,
        )
    if any(
        records[day]["day_coverage"] == "MISSING"
        for day in required_days
    ):
        return _unavailable(
            "RECORDS_INCOMPLETE",
            observation_start,
            observation_end,
            complete_days,
        )

    totals = {category: 0 for category in CATEGORY_RULES}
    seen_events: dict[str, tuple[Any, ...]] = {}
    for record in records.values():
        for item in record["items"]:
            signature = (
                record["observed_on"],
                item["category"],
                item["amount"],
                item["currency"],
                item["in_snapshot"],
                item.get("covered_by_living_reserve"),
                item.get("same_scope_as_discretionary"),
            )
            previous = seen_events.get(item["event_id"])
            if previous is not None:
                if previous != signature:
                    return _unavailable(
                        "RECORDS_INCOMPLETE",
                        observation_start,
                        observation_end,
                        complete_days,
                    )
                continue
            seen_events[item["event_id"]] = signature
            if parse_time_safe(item["available_at"]) > parse_time_safe(
                case["snapshot"]["as_of"]
            ):
                return _unavailable(
                    "RECORDS_INCOMPLETE",
                    observation_start,
                    observation_end,
                    complete_days,
                )
            category = item["category"]
            if category not in CATEGORY_RULES:
                continue
            expected_flags = CATEGORY_RULES[category]
            actual_flags = (
                item.get("covered_by_living_reserve"),
                item.get("same_scope_as_discretionary"),
            )
            if None in actual_flags or actual_flags != expected_flags:
                return _unavailable(
                    "CATEGORY_FLAGS_MISSING",
                    observation_start,
                    observation_end,
                    complete_days,
                )
            totals[category] += item["amount"]

    scenario_groups: list[dict[str, Any]] = []
    generated_events: list[dict[str, Any]] = []
    today_scenario_same_scope = 0
    future_start = today
    future_end = period.end

    for category, historical_total in totals.items():
        if historical_total == 0:
            continue
        covered, same_scope = CATEGORY_RULES[category]
        if covered:
            periods = _split_living_periods(case, future_start, future_end)
            if periods is None:
                return _unavailable(
                    "COVERAGE_UNCLEAR",
                    observation_start,
                    observation_end,
                    complete_days,
                )
        else:
            periods = [(future_start, future_end, "")]

        for group_index, (group_start, group_end, reserve_id) in enumerate(periods):
            days = days_inclusive(group_start, group_end)
            # D67: multiply before the single ROUND_HALF_UP conversion to fen.
            with localcontext(DECIMAL_CONTEXT):
                pg = int(
                    (
                        Decimal(historical_total)
                        * Decimal(len(days))
                        / Decimal(SCENARIO_WINDOW_DAYS)
                    ).quantize(
                        Decimal("1"), rounding=ROUND_HALF_UP
                    )
                )
            scheduled = [
                event
                for event in case["events"]
                if event["event_kind"] == "OTHER_EXPENSE"
                and not event["in_snapshot"]
                and event.get("amount") is not None
                and event.get("expected_at") is not None
                and event.get("category") == category
                and group_start <= as_date(event["expected_at"]) <= group_end
            ]
            eg = sum(event["amount"] for event in scheduled)
            delta = max(0, pg - eg)
            allocations = _allocate(delta, days)
            daily_wire = [
                {"date": day.isoformat(), "amount": money(amount, rules=["D23", "D49"])}
                for day, amount in allocations
            ]
            scenario_groups.append(
                {
                    "category": category,
                    "coverage_start": group_start.isoformat(),
                    "coverage_end": group_end.isoformat(),
                    "scenario_group_total": money(pg, rules=["R018", "§5", "D23"]),
                    "scheduled_group_total": money(
                        eg,
                        event_ids=[event["event_id"] for event in scheduled],
                        rules=["R018", "§5"],
                    ),
                    "scenario_increment": money(
                        delta,
                        event_ids=[event["event_id"] for event in scheduled],
                        reserve_ids=[reserve_id] if reserve_id else [],
                        rules=["R018", "§5", "D23"],
                    ),
                    "daily_amounts": daily_wire,
                }
            )
            for day, amount in allocations:
                if amount <= 0:
                    continue
                if same_scope and day == today:
                    today_scenario_same_scope += amount
                    continue
                coverage = (
                    [{"reserve_id": reserve_id, "covered_amount": amount}]
                    if covered
                    else []
                )
                generated_events.append(
                    {
                        "event_id": f"SCENARIO:{category}:{group_index}:{day.isoformat()}",
                        "event_kind": "OTHER_EXPENSE",
                        "event_status": "EXPECTED",
                        "amount": amount,
                        "expected_at": day.isoformat(),
                        "time_precision": "DATE",
                        "in_snapshot": False,
                        "coverage": coverage,
                        "currency": "CNY",
                        "category": category,
                        "scenario": True,
                    }
                )

    today_replacement = max(
        0, today_scenario_same_scope - _actual_today_same_scope(case)
    )
    if today_replacement:
        generated_events.append(
            {
                "event_id": f"SCENARIO:ENTERTAINMENT:TODAY:{today.isoformat()}",
                "event_kind": "OTHER_EXPENSE",
                "event_status": "EXPECTED",
                "amount": today_replacement,
                "expected_at": case["snapshot"]["as_of"],
                "time_precision": "DATETIME",
                "in_snapshot": False,
                "coverage": [],
                "currency": "CNY",
                "category": "ENTERTAINMENT",
                "scenario": True,
                "today_same_scope": True,
            }
        )
    wire = {
        "kind": "RECENT_MONTH",
        "available": True,
        "unavailable_reason": None,
        "config_version": CONFIG_VERSION,
        "observation_start": observation_start.isoformat(),
        "observation_end": observation_end.isoformat(),
        "complete_days": complete_days,
        "groups": scenario_groups,
        "today_replacement": money(
            today_replacement, rules=["R018", "D22"]
        ),
        "daily_reference": None,
    }
    return ScenarioComputation(wire, generated_events, today_replacement)


def parse_time_safe(value: str):
    from .dates import parse_time

    return parse_time(value)


def build_scenarios(
    case: dict[str, Any], period: CheckPeriod
) -> list[ScenarioComputation]:
    return [confirmed_only_scenario(), recent_month_scenario(case, period)]

