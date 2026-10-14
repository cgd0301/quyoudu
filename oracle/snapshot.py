"""Snapshot balance derivation (rules.md §1, D03 and D05)."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .result import money


@dataclass
class ReserveState:
    reserve_id: str
    kind: str
    remaining: int
    original_amount: int
    coverage_start: str
    coverage_end: str
    funding_event_id: str | None
    established: bool


@dataclass
class BalanceState:
    cash: int
    reserves: dict[str, ReserveState]
    other_goal_hold: int
    goal_allocation: int

    def clone(self) -> "BalanceState":
        return deepcopy(self)

    def reserve_total(self, kind: str) -> int:
        return sum(
            reserve.remaining
            for reserve in self.reserves.values()
            if reserve.kind == kind and reserve.established
        )

    @property
    def living(self) -> int:
        return self.reserve_total("LIVING")

    @property
    def other_protected(self) -> int:
        return self.reserve_total("OTHER_PROTECTED")

    @property
    def contingency(self) -> int:
        return self.reserve_total("CONTINGENCY")

    @property
    def goal_available(self) -> int:
        return self.cash - self.living - self.other_protected - self.other_goal_hold

    @property
    def payment_headroom(self) -> int:
        return self.goal_available - self.contingency

    @property
    def unallocated(self) -> int:
        return self.payment_headroom - self.goal_allocation

    @property
    def protected_total(self) -> int:
        return self.living + self.other_protected + self.other_goal_hold + self.contingency


def initial_state(case: dict[str, Any], *, release_allocation: bool = False) -> BalanceState | None:
    cash = case["snapshot"]["cash"]
    if cash is None:
        return None
    event_by_id = {event["event_id"]: event for event in case["events"]}
    reserves: dict[str, ReserveState] = {}
    for item in case["reserves"]:
        funding_id = item.get("funding_event_id")
        established = funding_id is None
        if funding_id is not None:
            funding = event_by_id.get(funding_id)
            established = bool(funding and funding.get("in_snapshot"))
        reserves[item["reserve_id"]] = ReserveState(
            reserve_id=item["reserve_id"],
            kind=item["reserve_kind"],
            remaining=item["amount"] if established else 0,
            original_amount=item["amount"],
            coverage_start=item["coverage_start"],
            coverage_end=item["coverage_end"],
            funding_event_id=funding_id,
            established=established,
        )
    other = case["snapshot"].get("other_goal_hold")
    return BalanceState(
        cash=cash,
        reserves=reserves,
        other_goal_hold=0 if other is None else other["amount"],
        goal_allocation=0 if release_allocation else case["snapshot"]["goal_allocation"],
    )


def _reserve_ids(state: BalanceState, kind: str) -> list[str]:
    return [
        item.reserve_id
        for item in state.reserves.values()
        if item.kind == kind and item.established
    ]


def snapshot_wire(state: BalanceState | None) -> dict[str, Any] | None:
    if state is None:
        return None
    living_ids = _reserve_ids(state, "LIVING")
    other_ids = _reserve_ids(state, "OTHER_PROTECTED")
    contingency_ids = _reserve_ids(state, "CONTINGENCY")
    all_reserve_ids = living_ids + other_ids + contingency_ids
    issues: list[dict[str, Any]] = []
    if state.protected_total > state.cash:
        issues.append(
            {
                "node_verdict": "PROTECTED_SHORTFALL",
                "amount": money(
                    -state.unallocated,
                    reserve_ids=all_reserve_ids,
                    rules=["§1", "D05", "D34"],
                ),
            }
        )
    elif state.unallocated < 0:
        issues.append(
            {
                "node_verdict": "ALLOCATION_CONFLICT",
                "amount": money(
                    -state.unallocated,
                    reserve_ids=all_reserve_ids,
                    rules=["§1", "R004", "D05"],
                ),
            }
        )
    return {
        "cash": money(state.cash, rules=["R001", "§1"]),
        "living_reserve": money(
            state.living, reserve_ids=living_ids, rules=["R003", "§1"]
        ),
        "other_protected_reserve": money(
            state.other_protected, reserve_ids=other_ids, rules=["R003", "§1"]
        ),
        "other_goal_hold": money(state.other_goal_hold, rules=["R004", "D09", "§1"]),
        "contingency_reserve": money(
            state.contingency,
            reserve_ids=contingency_ids,
            rules=["R003", "D09", "§1"],
        ),
        "goal_allocation": money(state.goal_allocation, rules=["R004", "§1"]),
        "goal_available": money(
            state.goal_available, reserve_ids=living_ids + other_ids, rules=["§1"]
        ),
        "payment_headroom": money(
            state.payment_headroom, reserve_ids=all_reserve_ids, rules=["§1"]
        ),
        "unallocated": money(
            state.unallocated, reserve_ids=all_reserve_ids, rules=["R004", "§1"]
        ),
        "protected_total": money(
            state.protected_total,
            reserve_ids=all_reserve_ids,
            rules=["D05", "§1"],
        ),
        "issues": issues,
    }

