"""Complete-candidate validation, independent enumeration and Top-K."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP
from typing import Any

from .config import TOP_K
from .costs import CostComputation, compute_cost
from .dates import as_date, parse_date, parse_time
from .result import money
from .settlement import alternate_quote_indexes
from .timeline import TimelineRun, candidate_timeline_events, run_timeline


def reason(code: str, rule: str, refs: list[str]) -> dict[str, Any]:
    return {"code": code, "rule": rule, "refs": list(dict.fromkeys(refs))}


@dataclass
class CandidateEvaluation:
    candidate: dict[str, Any]
    evaluable: bool
    pending_reasons: list[dict[str, Any]]
    excluded_reasons: list[dict[str, Any]]
    feasible: bool | None
    item_amounts: list[int | None]
    price_kinds: list[str]
    dependencies: list[dict[str, Any]]
    plan_events: list[dict[str, Any]]
    returns: list[dict[str, Any]]
    cost: CostComputation
    timeline: TimelineRun | None
    tie_group: int | None = None
    rank: int | None = None

    @property
    def net_spend(self) -> int | None:
        return self.cost.net_spend

    def wire(self) -> dict[str, Any]:
        candidate_id = self.candidate["candidate_id"]
        return {
            "candidate_id": candidate_id,
            "plan_version": f"{candidate_id}@v1",
            "evaluable": self.evaluable,
            "pending_reasons": self.pending_reasons,
            "excluded_reasons": self.excluded_reasons,
            "feasible": self.feasible,
            "net_spend": (
                None
                if not self.evaluable or self.cost.net_spend is None
                else money(
                    self.cost.net_spend,
                    event_ids=[event["event_id"] for event in self.plan_events],
                    rules=["R007", "R016", "§3"],
                )
            ),
            "net_spend_if_received": (
                None
                if not self.evaluable or self.cost.net_spend_if_received is None
                else money(
                    self.cost.net_spend_if_received,
                    event_ids=[
                        event["event_id"] for event in self.plan_events + self.returns
                    ],
                    rules=["R005", "D12", "R016"],
                )
            ),
            "tie_group": self.tie_group,
            "rank": self.rank,
        }


@dataclass
class OptimizationResult:
    evaluations: list[CandidateEvaluation]
    evaluated_count: int
    pending_count: int
    excluded_count: int
    state: str

    @property
    def feasible(self) -> list[CandidateEvaluation]:
        return [item for item in self.evaluations if item.feasible is True]

    def wire(self) -> dict[str, Any]:
        return {
            "scope": [item.candidate["candidate_id"] for item in self.evaluations],
            "evaluated_count": self.evaluated_count,
            "pending_count": self.pending_count,
            "excluded_count": self.excluded_count,
            "top_k": TOP_K,
        }


def _cost_items(case: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {item["cost_item_id"]: item for item in case["cost_items"]}


def _paid_cost_ids(case: dict[str, Any]) -> set[str]:
    return {
        event["cost_item_id"]
        for event in case["events"]
        if event["event_kind"] == "GOAL_PAYMENT"
        and event["event_status"] == "ACTUAL"
        and event.get("cost_item_id")
    }


def _base_future_goal_events(case: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        deepcopy(event)
        for event in case["events"]
        if event["event_kind"] == "GOAL_PAYMENT"
        and not event["in_snapshot"]
        and event.get("amount") is not None
        and event.get("expected_at") is not None
    ]


def _date_valid(value: str | None, on: str) -> bool:
    if value is None:
        return True
    return as_date(value) <= as_date(on)


def _quote_state(
    item: dict[str, Any], as_of: str, basis: str
) -> tuple[bool, bool]:
    quote = item["quote"]
    try:
        available = parse_time(quote["available_at"]) <= parse_time(as_of)
        check_day = (
            as_date(as_of)
            if basis in {"REFERENCE", "UNDATED_QUOTE"}
            else parse_date(item["purchase_date"])
        )
        valid_from = (
            None if quote["valid_from"] is None else as_date(quote["valid_from"])
        )
        valid_to = None if quote["valid_to"] is None else as_date(quote["valid_to"])
        valid = (valid_from is None or valid_from <= check_day) and (
            valid_to is None or check_day <= valid_to
        )
        return available, valid
    except (ValueError, TypeError):
        return False, False


def _resolve_item_price(
    case: dict[str, Any],
    item: dict[str, Any],
    forecast_lookup: dict[tuple[str, str, str, str], dict[str, Any]],
    *,
    allow_frozen_forecast: bool = False,
) -> tuple[int | None, str, list[dict[str, Any]], list[dict[str, Any]]]:
    pending: list[dict[str, Any]] = []
    dependencies: list[dict[str, Any]] = []
    refs = [item["cost_item_id"]]
    dependency_refs = [
        item["cost_item_id"],
        item["channel"],
        item["purchase_date"],
    ]
    if item["currency"] != "CNY":
        pending.append(reason("NON_CNY", "R008", refs))
        return None, item["price_basis"], pending, dependencies
    cost = _cost_items(case).get(item["cost_item_id"])
    if item["price"] is not None and (
        item["price"] < 0
        or (
            item["price"] == 0
            and (cost is None or cost["amount_status"] != "CONFIRMED_FREE")
        )
    ):
        pending.append(reason("PRICE_PENDING", "R007/R020", refs))
        return None, item["price_basis"], pending, dependencies

    forecast = forecast_lookup.get(
        (
            item["cost_item_id"],
            item["channel"],
            item["spec"],
            item["purchase_date"],
        )
    )
    basis = item["price_basis"]
    available, valid = _quote_state(item, case["snapshot"]["as_of"], basis)
    amount = item["price"]

    if basis == "QUOTE" and item["quote"]["valid_to"] is None:
        pending.append(reason("QUOTE_EXPIRED", "R009/D43", refs))
        return None, basis, pending, dependencies
    if basis == "QUOTE" and available and valid and amount is not None:
        return amount, "QUOTE", pending, dependencies
    if basis == "QUOTE" and not valid:
        pending.append(reason("QUOTE_EXPIRED", "R009", refs))
        return None, basis, pending, dependencies

    if (
        forecast is not None
        and forecast.get("status") == "AVAILABLE"
        and forecast.get("qualified")
        and forecast.get("confirmed")
        and forecast.get("amount") is not None
    ):
        amount = forecast["amount"]
        basis = "FORECAST"
        dependencies.append(
            {
                "kind": "CONFIRMED_FORECAST",
                "refs": [forecast["series_id"], item["purchase_date"]],
                "amount": money(amount, rules=["R020", "D13", "D14"]),
                "at": item["payment_at"],
            }
        )
        return amount, basis, pending, dependencies

    if basis == "FORECAST":
        stored = next(
            (
                confirmation
                for confirmation in case["forecast_confirmations"]
                if confirmation["purchase_date"] == item["purchase_date"]
                and confirmation["price"] == amount
                and confirmation["config_version"] == "DEMO-CFG-1"
                and (
                    (
                        not [
                            row
                            for row in case["price_series"]
                            if row["series_id"] == confirmation["series_id"]
                        ]
                        and confirmation["series_id"]
                        == f"S-{item['cost_item_id']}"
                    )
                    or any(
                        row["series_id"] == confirmation["series_id"]
                        and row["cost_item_id"] == item["cost_item_id"]
                        and row["channel"] == item["channel"]
                        and row["spec"] == item["spec"]
                        for row in case["price_series"]
                    )
                )
            ),
            None,
        )
        if allow_frozen_forecast and stored is not None and amount is not None:
            dependencies.append(
                {
                    "kind": "CONFIRMED_FORECAST",
                    "refs": [stored["series_id"], item["purchase_date"]],
                    "amount": money(amount, rules=["R020", "D13", "D14"]),
                    "at": item["payment_at"],
                }
            )
            return amount, basis, pending, dependencies
        pending.append(reason("PRICE_PENDING", "R009/R020", refs))
        return None, basis, pending, dependencies
    if basis == "REFERENCE" and available and valid and amount is not None:
        dependencies.append(
            {
                "kind": "ESTIMATE",
                "refs": dependency_refs,
                "amount": money(amount, rules=["R009", "D13"]),
                "at": item["payment_at"],
            }
        )
        return amount, basis, pending, dependencies
    if basis == "UNDATED_QUOTE" and available and amount is not None:
        dependencies.append(
            {
                "kind": "ESTIMATE",
                "refs": dependency_refs,
                "amount": money(amount, rules=["R009", "D43"]),
                "at": item["payment_at"],
            }
        )
        return amount, basis, pending, dependencies
    pending.append(reason("PRICE_PENDING", "R009", refs))
    return None, basis, pending, dependencies


def _round_decimal(value: Decimal, mode: str) -> int:
    rounding = {
        "FLOOR": ROUND_FLOOR,
        "HALF_UP": ROUND_HALF_UP,
        "CEIL": ROUND_CEILING,
    }[mode]
    return int(value.quantize(Decimal("1"), rounding=rounding))


def _apply_reduction(
    amounts: list[int | None],
    indexes: list[int],
    reduction: int,
    items: list[dict[str, Any]],
) -> None:
    # D65: reduce the latest scoped payment first; ties use reverse item order.
    ordered = sorted(
        indexes,
        key=lambda index: (parse_time(items[index]["payment_at"]), index),
        reverse=True,
    )
    remaining = reduction
    for index in ordered:
        current = amounts[index] or 0
        used = min(current, remaining)
        amounts[index] = current - used
        remaining -= used
        if remaining == 0:
            break


def _offers(
    case: dict[str, Any],
    candidate: dict[str, Any],
    raw_amounts: list[int | None],
    alternate: set[int],
) -> tuple[
    list[int | None],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    amounts = list(raw_amounts)
    pending: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    generated_returns: list[dict[str, Any]] = []
    offer_by_id = {offer["offer_id"]: offer for offer in case["offers"]}
    cost_by_id = _cost_items(case)
    uses = candidate["offers_used"]
    counts: dict[str, int] = {}
    by_order: dict[str, list[dict[str, Any]]] = {}
    invalid_offer_ids: set[str] = set()
    for use in uses:
        counts[use["offer_id"]] = counts.get(use["offer_id"], 0) + 1
        by_order.setdefault(use["order_id"], []).append(use)

    for offer_id, count in counts.items():
        offer = offer_by_id.get(offer_id)
        if offer is None:
            pending.append(reason("OFFER_CONDITION_UNKNOWN", "R009", [offer_id]))
        elif count > offer["max_uses"]:
            invalid_offer_ids.add(offer_id)
            excluded.append(
                reason("OFFER_MAX_USES_EXCEEDED", "D17", [offer_id])
            )

    for order_id, order_uses in by_order.items():
        all_ids = [use["offer_id"] for use in order_uses if use["offer_id"] in offer_by_id]
        if any(
            other not in offer_by_id[current]["stackable_with"]
            for current in all_ids
            for other in all_ids
            if current != other
        ):
            excluded.append(reason("OFFER_NOT_STACKABLE", "D17/D45", all_ids))
            continue
        instant = [
            use
            for use in order_uses
            if offer_by_id.get(use["offer_id"], {}).get("type")
            in {"INSTANT_OFF", "THRESHOLD_OFF", "PERCENT_OFF"}
        ]
        if len(instant) > 1:
            ids = [use["offer_id"] for use in instant]
            if any("sequence" not in use for use in instant):
                pending.append(reason("OFFER_ORDER_MISSING", "D45", ids))
                continue
        ordered_uses = sorted(order_uses, key=lambda use: use.get("sequence", 0))
        for use in ordered_uses:
            offer = offer_by_id.get(use["offer_id"])
            if offer is None or use["offer_id"] in invalid_offer_ids:
                continue
            refs = [candidate["candidate_id"], offer["offer_id"], order_id]
            # AMBIGUOUS: D75/D45/D65 另一报价与订单优惠｜读法A：另一报价仍计入订单优惠前小计并承接冲减｜读法B：另一报价不计入小计、不承接冲减，优惠时点取订单中需付款的价格项｜采用B：D65 只冲减价格项的付款，另一报价没有付款，也不能帮助达到门槛或放大折扣基数；取消后改为正常计入的价格项不重算优惠，金额只高不低。
            order_items = [
                item
                for index, item in enumerate(candidate["items"])
                if item["order_id"] == order_id and index not in alternate
            ] or [item for item in candidate["items"] if item["order_id"] == order_id]
            point = next(
                (
                    item["purchase_date"]
                    if offer["applies_at"] == "ORDER"
                    else item["payment_at"]
                    for item in order_items
                ),
                None,
            )
            if point is None:
                pending.append(reason("OFFER_SCOPE_MISMATCH", "D17", refs))
                continue
            if not _date_valid(offer["valid_from"], point) or (
                offer["valid_to"] is not None
                and as_date(point) > as_date(offer["valid_to"])
            ):
                excluded.append(reason("OFFER_EXPIRED", "R009/D17", refs))
                continue
            indexes = [
                index
                for index, item in enumerate(candidate["items"])
                if item["order_id"] == order_id
                and index not in alternate
                and cost_by_id.get(item["cost_item_id"], {}).get("category")
                in offer["scope"]
            ]
            if not indexes:
                excluded.append(reason("OFFER_SCOPE_MISMATCH", "D17", refs))
                continue
            if any(amounts[index] is None for index in indexes):
                continue
            subtotal = sum(raw_amounts[index] or 0 for index in indexes)
            if offer["threshold"] is not None and subtotal < offer["threshold"]:
                excluded.append(reason("OFFER_THRESHOLD_NOT_MET", "D17", refs))
                continue
            if offer["rounding"] == "UNKNOWN":
                pending.append(reason("ROUNDING_UNKNOWN", "R007/D17", refs))
                continue
            kind = offer["type"]
            if kind in {"INSTANT_OFF", "THRESHOLD_OFF"}:
                _apply_reduction(
                    amounts,
                    indexes,
                    min(offer["value"], sum(amounts[index] or 0 for index in indexes)),
                    candidate["items"],
                )
            elif kind == "PERCENT_OFF":
                discounted = _round_decimal(
                    Decimal(subtotal) * Decimal(offer["value"]) / Decimal(10000),
                    offer["rounding"],
                )
                _apply_reduction(
                    amounts,
                    indexes,
                    max(0, subtotal - discounted),
                    candidate["items"],
                )
            elif kind == "CASHBACK":
                if offer.get("expected_at") is None:
                    pending.append(
                        reason("OFFER_CONDITION_UNKNOWN", "D12/D17", refs)
                    )
                elif not any(
                    returned.get("amount") == offer["value"]
                    and returned.get("expected_at") == offer["expected_at"]
                    and returned.get("trigger_condition")
                    == offer.get("trigger_condition")
                    for returned in candidate["returns"]
                ):
                    generated_returns.append(
                        {
                            "event_id": f"OFFER_RETURN:{candidate['candidate_id']}:{offer['offer_id']}",
                            "amount": offer["value"],
                            "expected_at": offer["expected_at"],
                            "time_precision": (
                                "DATETIME" if "T" in offer["expected_at"] else "DATE"
                            ),
                            "trigger_condition": offer.get("trigger_condition"),
                            "currency": "CNY",
                        }
                    )
            # VOUCHER is intentionally not deducted from this target.
    return amounts, pending, excluded, generated_returns


def _compatibility(
    case: dict[str, Any], candidate: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    pending: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    goal = case["goal"]
    cost_by_id = _cost_items(case)
    by_category: dict[str, list[dict[str, Any]]] = {}
    # AMBIGUOUS: D75/D16/D44 另一报价的相容性｜读法A：另一报价仍参与相容性检查｜读法B：另一报价不购买，不参与｜采用A：D16 以候选为单位检查已填写的约束，events[] 没有规格和时刻，另一报价是候选中描述该项目的价格项；不因 D75 放宽任何约束。
    for item in candidate["items"]:
        category = cost_by_id.get(item["cost_item_id"], {}).get("category")
        if category is not None:
            by_category.setdefault(category, []).append(item)

    def missing(code_ref: str) -> None:
        pending.append(
            reason(
                "COMPARISON_FIELD_MISSING",
                "D16/D44",
                [candidate["candidate_id"], code_ref],
            )
        )

    if goal["arrive_before_show_min"] is not None:
        items = by_category.get("OUTBOUND_TRANSPORT", [])
        if not items or any(item.get("arrive_at") is None for item in items):
            missing("arrive_at")
        elif max(parse_time(item["arrive_at"]) for item in items) > parse_time(
            goal["show_start_at"]
        ) - timedelta(minutes=goal["arrive_before_show_min"]):
            excluded.append(
                reason(
                    "ARRIVAL_TOO_LATE",
                    "D16/D44",
                    [candidate["candidate_id"]],
                )
            )
    if goal["return_after_show_min"] is not None:
        items = by_category.get("RETURN_TRANSPORT", [])
        if not items or any(item.get("depart_at") is None for item in items):
            missing("depart_at")
        elif min(parse_time(item["depart_at"]) for item in items) < parse_time(
            goal["show_end_at"]
        ) + timedelta(minutes=goal["return_after_show_min"]):
            excluded.append(
                reason(
                    "RETURN_TOO_EARLY",
                    "D16/D44",
                    [candidate["candidate_id"]],
                )
            )
    if goal["lodging_nights_required"] is not None:
        items = by_category.get("LODGING", [])
        if not items or any(item.get("lodging_nights") is None for item in items):
            missing("lodging_nights")
        else:
            covered = {
                night for item in items for night in item.get("lodging_nights", [])
            }
            if not set(goal["lodging_nights_required"]).issubset(covered):
                excluded.append(
                    reason(
                        "LODGING_NIGHTS_NOT_COVERED",
                        "D16/D44",
                        [candidate["candidate_id"]],
                    )
                )
    if goal["seat_tier_allowed"] is not None:
        items = by_category.get("TICKET", [])
        if not items:
            missing("ticket.spec")
        elif any(item["spec"] not in goal["seat_tier_allowed"] for item in items):
            excluded.append(
                reason(
                    "SEAT_TIER_NOT_ALLOWED",
                    "D16/D44",
                    [candidate["candidate_id"]],
                )
            )
    if goal["lodging_max_distance_m"] is not None:
        items = by_category.get("LODGING", [])
        if not items or any(item.get("lodging_distance_m") is None for item in items):
            missing("lodging_distance_m")
        elif any(
            item["lodging_distance_m"] > goal["lodging_max_distance_m"]
            for item in items
        ):
            excluded.append(
                reason(
                    "LODGING_TOO_FAR",
                    "D16/D44",
                    [candidate["candidate_id"]],
                )
            )
    if goal["refundable_required"] is not None:
        for category in goal["refundable_required"]:
            items = by_category.get(category, [])
            if not items or any(item.get("refundable") is None for item in items):
                missing(f"{category}.refundable")
            elif any(item["refundable"] is not True for item in items):
                excluded.append(
                    reason(
                        "NOT_REFUNDABLE",
                        "D16/D44",
                        [candidate["candidate_id"], category],
                    )
                )
    return pending, excluded


def _pending_cost_ids(
    case: dict[str, Any],
    candidate: dict[str, Any],
    amounts: list[int | None],
    alternate: set[int],
) -> list[str]:
    paid = _paid_cost_ids(case)
    base = {
        event.get("cost_item_id")
        for event in case["events"]
        if event["event_kind"] == "GOAL_PAYMENT"
        and event.get("amount") is not None
        and event.get("cost_item_id")
    }
    item_indexes: dict[str, list[int]] = {}
    for index, item in enumerate(candidate["items"]):
        if index not in alternate:
            item_indexes.setdefault(item["cost_item_id"], []).append(index)
    pending: list[str] = []
    for cost in case["cost_items"]:
        if not cost["necessary"] or cost["amount_status"] in {
            "NOT_APPLICABLE",
            "CONFIRMED_FREE",
        }:
            continue
        cost_id = cost["cost_item_id"]
        indexes = item_indexes.get(cost_id, [])
        if cost_id in paid or cost_id in base:
            # D75: the unfulfilled part after a goal payment counts as usual.
            if any(amounts[index] is None for index in indexes):
                pending.append(cost_id)
            continue
        if not indexes or any(amounts[index] is None for index in indexes):
            pending.append(cost_id)
    return pending


def _signature(
    candidate: dict[str, Any], amounts: list[int | None]
) -> tuple[Any, ...]:
    # AMBIGUOUS: D75/R016第6条 重复候选｜读法A：另一报价与 settles_event_id 都参与重复判定｜读法B：忽略另一报价，只比较需付款的价格项｜采用A：R016 第6条针对重复记录，列有不同价格项的候选不是重复记录，不因 D75 推定新的排除；settles_event_id 不同时付款不同，必须区分。
    normalized_items = sorted(
        (
            item["cost_item_id"],
            item["channel"],
            item["spec"],
            amounts[index],
            item["price_basis"],
            item["order_id"],
            item["purchase_date"],
            item["payment_at"],
            item.get("arrive_at"),
            item.get("depart_at"),
            item.get("lodging_distance_m"),
            tuple(sorted(item.get("lodging_nights", []))),
            item.get("refundable"),
            item.get("cancellable", False),
            item.get("settles_event_id"),
            item["quote"]["valid_from"],
            item["quote"]["valid_to"],
        )
        for index, item in enumerate(candidate["items"])
    )
    return (
        tuple(normalized_items),
        tuple(
            sorted(
                (use["offer_id"], use["order_id"], use.get("sequence"))
                for use in candidate["offers_used"]
            )
        ),
        tuple(
            sorted(
                (
                    item["amount"],
                    item["expected_at"],
                    item.get("trigger_condition"),
                )
                for item in candidate["returns"]
            )
        ),
    )


def _overdue_item_ids(
    case: dict[str, Any],
    candidate: dict[str, Any],
    amounts: list[int | None],
    alternate: set[int],
) -> list[str]:
    as_of = parse_time(case["snapshot"]["as_of"])
    cash_as_of = parse_time(case["snapshot"]["cash_as_of"])
    result: list[str] = []
    for index, item in enumerate(candidate["items"]):
        if index in alternate or amounts[index] is None:
            continue
        payment_at = item["payment_at"]
        payment_day = as_date(payment_at)
        overdue = payment_day < as_of.date()
        if payment_day == as_of.date() and "T" in payment_at:
            overdue = parse_time(payment_at) < cash_as_of
        if overdue:
            result.append(item["cost_item_id"])
    return list(dict.fromkeys(result))


def _pending_sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
    return (
        1 if item["code"] == "SHARED_INPUT_INCOMPLETE" else 0,
        tuple(item["refs"]),
        item["code"],
    )


def _excluded_sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
    code = item["code"]
    if code.startswith("OFFER_"):
        group = 1
    elif code == "BUDGET_EXCEEDED":
        group = 2
    elif code in {"PAYMENT_GAP", "ALLOCATION_CONFLICT"}:
        group = 3
    elif code == "DUPLICATE_CANDIDATE":
        group = 4
    else:
        group = 0
    return (group, tuple(item["refs"]), code)


def evaluate_candidates(
    case: dict[str, Any],
    *,
    forecast_lookup: dict[tuple[str, str, str, str], dict[str, Any]] | None = None,
    shared_input_incomplete: bool = False,
    allow_frozen_forecasts: bool = False,
) -> OptimizationResult:
    forecast_lookup = forecast_lookup or {}
    evaluations: list[CandidateEvaluation] = []
    seen_signatures: dict[tuple[Any, ...], str] = {}
    base_future = _base_future_goal_events(case)

    for candidate in case["candidates"]:
        alternate = alternate_quote_indexes(case, candidate)
        pending: list[dict[str, Any]] = []
        excluded: list[dict[str, Any]] = []
        dependencies: list[dict[str, Any]] = []
        raw_amounts: list[int | None] = []
        kinds: list[str] = []
        # AMBIGUOUS: D75/R009/D13 另一报价的报价检查｜读法A：另一报价仍按 R009、D13 解析，报价无效、待填或非人民币时候选计入待确认数，依赖条件与价格依据标签照常｜读法B：不计入 F 就不解析｜采用A：D75 只写明不计入 F、不付款，不放宽对候选所列报价的检查，只会多出待确认，不会多出完整结论。
        for item in candidate["items"]:
            amount, kind, item_pending, item_dependencies = _resolve_item_price(
                case,
                item,
                forecast_lookup,
                allow_frozen_forecast=allow_frozen_forecasts,
            )
            raw_amounts.append(amount)
            kinds.append(kind)
            pending.extend(item_pending)
            dependencies.extend(item_dependencies)
        amounts, offer_pending, offer_excluded, offer_returns = _offers(
            case, candidate, raw_amounts, alternate
        )
        pending.extend(offer_pending)
        excluded.extend(offer_excluded)
        compatible_pending, compatible_excluded = _compatibility(case, candidate)
        pending.extend(compatible_pending)
        excluded.extend(compatible_excluded)
        pending_ids = _pending_cost_ids(case, candidate, amounts, alternate)
        item_reason_ids = {
            item["refs"][0]
            for item in pending
            if item["code"] in {"NON_CNY", "QUOTE_EXPIRED", "PRICE_PENDING"}
            and item["refs"]
        }
        pending.extend(
            reason("PRICE_PENDING", "R010/R016", [candidate["candidate_id"], item_id])
            for item_id in pending_ids
            if item_id not in item_reason_ids
        )
        pending.extend(
            reason("PAYMENT_TIME_MISSING", "R010/R017", [item_id])
            for item_id in _overdue_item_ids(
                case, candidate, amounts, alternate
            )
        )

        signature = _signature(candidate, amounts)
        if signature in seen_signatures:
            excluded.append(
                reason(
                    "DUPLICATE_CANDIDATE",
                    "R016",
                    [candidate["candidate_id"], seen_signatures[signature]],
                )
            )
        else:
            seen_signatures[signature] = candidate["candidate_id"]

        returns = [*deepcopy(candidate["returns"]), *offer_returns]
        plan_events = candidate_timeline_events(
            case, candidate, amounts, returns_override=returns
        )
        cost = compute_cost(case, [*base_future, *plan_events], returns, pending_ids)
        timeline: TimelineRun | None = None
        if excluded and pending:
            # A violation that is independent of the missing value is already
            # a deterministic exclusion.  The H3 overdue rule is explicit:
            # an overdue candidate item still counts as pending confirmation.
            pending = [
                item
                for item in pending
                if item["code"] == "PAYMENT_TIME_MISSING"
            ]
        if shared_input_incomplete and not excluded:
            pending.append(
                reason(
                    "SHARED_INPUT_INCOMPLETE",
                    "R010/R011",
                    [candidate["candidate_id"]],
                )
            )
        evaluable = not pending
        feasible: bool | None = None
        if evaluable and excluded and any(amount is None for amount in amounts):
            feasible = False
        elif evaluable:
            timeline = run_timeline(case, plan_events, candidate=candidate)
            if timeline.issues or timeline.period.out_of_range:
                pending.append(
                    reason(
                        "SHARED_INPUT_INCOMPLETE",
                        "R010/R011",
                        [candidate["candidate_id"]],
                    )
                )
                evaluable = False
            else:
                if cost.budget_overrun is not None:
                    excluded.append(
                        reason(
                            "BUDGET_EXCEEDED",
                            "R007/R016",
                            [candidate["candidate_id"]],
                        )
                    )
                if timeline.earliest_gap is not None:
                    excluded.append(
                        reason(
                            "PAYMENT_GAP",
                            "R006/R016",
                            [
                                candidate["candidate_id"],
                                *timeline.earliest_gap["related"],
                            ],
                        )
                    )
                if timeline.allocation_conflicts:
                    excluded.append(
                        reason(
                            "ALLOCATION_CONFLICT",
                            "R004/R016",
                            [candidate["candidate_id"]],
                        )
                    )
                feasible = not excluded
        evaluation = CandidateEvaluation(
            candidate=candidate,
            evaluable=evaluable,
            pending_reasons=list(
                sorted({
                    (item["code"], item["rule"], tuple(item["refs"])): item
                    for item in pending
                }.values(), key=_pending_sort_key)
            ),
            excluded_reasons=list(
                sorted({
                    (item["code"], item["rule"], tuple(item["refs"])): item
                    for item in excluded
                }.values(), key=_excluded_sort_key)
            ),
            feasible=feasible,
            item_amounts=amounts,
            price_kinds=kinds,
            dependencies=dependencies,
            plan_events=plan_events,
            returns=returns,
            cost=cost,
            timeline=timeline,
        )
        evaluations.append(evaluation)

    sorted_feasible = sorted(
        [item for item in evaluations if item.feasible is True],
        key=lambda item: (item.net_spend, item.candidate["candidate_id"]),
    )
    previous_cost: int | None = None
    tie_group = 0
    for position, evaluation in enumerate(sorted_feasible, start=1):
        if evaluation.net_spend != previous_cost:
            tie_group += 1
            previous_cost = evaluation.net_spend
        evaluation.tie_group = tie_group
        evaluation.rank = position if position <= TOP_K else None

    pending_count = sum(not item.evaluable for item in evaluations)
    evaluated_count = sum(item.feasible is True for item in evaluations)
    excluded_count = sum(
        item.evaluable and item.feasible is False for item in evaluations
    )
    if not evaluations:
        state = "NOT_COMPARED"
    elif pending_count:
        state = "PARTIALLY_EVALUABLE"
    elif sorted_feasible:
        state = "COMPLETED_FEASIBLE"
    else:
        state = "NO_KNOWN_FEASIBLE"
    return OptimizationResult(
        evaluations=evaluations,
        evaluated_count=evaluated_count,
        pending_count=pending_count,
        excluded_count=excluded_count,
        state=state,
    )

