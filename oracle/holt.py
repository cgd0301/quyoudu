"""Holt damped-trend forecasting with the exact D25/D50 decimal rules."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal, InvalidOperation, localcontext
from typing import Any, Iterable

from .config import (
    CONFIG_VERSION,
    DECIMAL_CONTEXT,
    HOLT_ALPHAS,
    HOLT_BETAS,
    HOLT_MIN_BACKTEST_COUNT,
    HOLT_MIN_SAMPLES,
    HOLT_PHIS,
    TWELVE_PLACES,
)
from .dates import as_date, parse_date, parse_time


def q12(value: Decimal) -> Decimal:
    with localcontext(DECIMAL_CONTEXT):
        return value.quantize(TWELVE_PLACES)


def dstr(value: Decimal | None) -> str | None:
    return None if value is None else f"{q12(value):.12f}"


@dataclass(frozen=True)
class HoltFit:
    alpha: Decimal
    beta: Decimal
    phi: Decimal
    level: Decimal
    trend: Decimal
    sse: Decimal


def fit_holt(
    prices: Iterable[int | Decimal],
    alpha: Decimal,
    beta: Decimal,
    phi: Decimal,
) -> HoltFit:
    with localcontext(DECIMAL_CONTEXT):
        values = [Decimal(value) for value in prices]
        if len(values) < 2:
            raise ValueError("Holt fitting requires at least two observations")
        level = q12(values[1])
        trend = q12(values[1] - values[0])
        sse = q12(Decimal(0))
        one = Decimal(1)
        for observed in values[2:]:
            one_step = q12(level + phi * trend)
            error = q12(observed - one_step)
            squared = q12(error * error)
            sse = q12(sse + squared)
            new_level = q12(
                alpha * observed + (one - alpha) * (level + phi * trend)
            )
            new_trend = q12(
                beta * (new_level - level) + (one - beta) * phi * trend
            )
            level, trend = new_level, new_trend
        return HoltFit(alpha, beta, phi, level, trend, sse)


def select_fit(prices: Iterable[int | Decimal]) -> HoltFit:
    values = list(prices)
    candidates = [
        fit_holt(values, alpha, beta, phi)
        for alpha in HOLT_ALPHAS
        for beta in HOLT_BETAS
        for phi in HOLT_PHIS
    ]
    return min(
        candidates,
        key=lambda item: (item.sse, item.alpha, item.beta, item.phi),
    )


def damped_power_sum(phi: Decimal, horizon: int) -> Decimal:
    if horizon < 1:
        raise ValueError("forecast horizon must be positive")
    # D25 says the power sum is one intermediate quantity: round after its
    # complete formula, not after each multiplication inside that formula.
    with localcontext(DECIMAL_CONTEXT):
        return q12(sum((phi**step for step in range(1, horizon + 1)), Decimal(0)))


def forecast_fit(fit: HoltFit, horizon: int) -> Decimal:
    with localcontext(DECIMAL_CONTEXT):
        power_sum = damped_power_sum(fit.phi, horizon)
        return q12(fit.level + fit.trend * power_sum)


def forecast_amount(predicted: Decimal) -> int:
    with localcontext(DECIMAL_CONTEXT):
        return int(predicted.quantize(Decimal("1"), rounding=DECIMAL_CONTEXT.rounding))


def holt_formula(
    prices: Iterable[int | Decimal],
    *,
    alpha: Decimal,
    beta: Decimal,
    phi: Decimal,
    horizon: int,
) -> tuple[HoltFit, Decimal, int]:
    """Direct formula hook used by the independent T020-01 unit check."""

    fit = fit_holt(prices, alpha, beta, phi)
    predicted = forecast_fit(fit, horizon)
    return fit, predicted, forecast_amount(predicted)


def _series_targets(
    case: dict[str, Any], series_id: str, rows: list[dict[str, Any]]
) -> list[str]:
    keys = {
        (row["cost_item_id"], row["channel"], row["spec"]) for row in rows
    }
    targets = {
        item["purchase_date"]
        for candidate in case["candidates"]
        for item in candidate["items"]
        if (item["cost_item_id"], item["channel"], item["spec"]) in keys
    }
    targets.update(
        confirmation["purchase_date"]
        for confirmation in case["forecast_confirmations"]
        if confirmation["series_id"] == series_id
    )
    return sorted(targets)


def _usable_rows(
    rows: list[dict[str, Any]], as_of: str
) -> tuple[list[dict[str, Any]], bool]:
    as_of_time = parse_time(as_of)
    available = [
        (index, row)
        for index, row in enumerate(rows)
        if parse_time(row["available_at"]) <= as_of_time
    ]
    comparable = (
        len(
            {
                (
                    row["cost_item_id"],
                    row["channel"],
                    row["spec"],
                    row["service_date"],
                    row["currency"],
                )
                for _, row in available
            }
        )
        <= 1
    )
    # AMBIGUOUS: §7.2｜同日“最后一条”按 recorded_at｜按 available_at｜
    # 采用 available_at、recorded_at、输入顺序的稳定末项，且绝不读取 as_of 后数据。
    by_day: dict[str, tuple[int, dict[str, Any]]] = {}
    for index, row in available:
        day = row["observed_on"]
        current = by_day.get(day)
        key = (parse_time(row["available_at"]), parse_time(row["recorded_at"]), index)
        if current is None:
            by_day[day] = (index, row)
        else:
            old_index, old = current
            old_key = (
                parse_time(old["available_at"]),
                parse_time(old["recorded_at"]),
                old_index,
            )
            if key > old_key:
                by_day[day] = (index, row)
    ordered = [pair[1] for _, pair in sorted(by_day.items())]
    return _continuous_tail(ordered), comparable


def _continuous_tail(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []
    trailing = [rows[-1]]
    for row in reversed(rows[:-1]):
        if parse_date(trailing[-1]["observed_on"]) - parse_date(
            row["observed_on"]
        ) == timedelta(days=1):
            trailing.append(row)
        else:
            break
    trailing.reverse()
    return trailing


def _backtest(
    rows: list[dict[str, Any]], horizon: int
) -> tuple[Decimal | None, Decimal | None, int]:
    errors: list[Decimal] = []
    baseline_errors: list[Decimal] = []
    # origin is the number of observations visible at that simulated origin.
    for origin in range(HOLT_MIN_SAMPLES, len(rows) - horizon + 1):
        origin_day = rows[origin - 1]["observed_on"]
        cutoff = parse_time(f"{origin_day}T23:59:59+08:00")
        visible = [
            row
            for row in rows[:origin]
            if parse_time(row["available_at"]) <= cutoff
        ]
        training_rows = _continuous_tail(visible)
        if len(training_rows) < HOLT_MIN_SAMPLES:
            continue
        training = [row["price"] for row in training_rows]
        actual = Decimal(rows[origin + horizon - 1]["price"])
        fit = select_fit(training)
        predicted = forecast_fit(fit, horizon)
        errors.append(q12(abs(actual - predicted)))
        baseline_errors.append(q12(abs(actual - Decimal(training[-1]))))
    if not errors:
        return None, None, 0
    with localcontext(DECIMAL_CONTEXT):
        mae = q12(sum(errors, Decimal(0)) / Decimal(len(errors)))
        baseline = q12(
            sum(baseline_errors, Decimal(0)) / Decimal(len(baseline_errors))
        )
    return mae, baseline, len(errors)


def _empty_forecast(
    series_id: str,
    cost_item_id: str,
    purchase_date: str,
    horizon: int,
    status: str,
    sample_count: int,
    history_end: str | None,
) -> dict[str, Any]:
    return {
        "series_id": series_id,
        "cost_item_id": cost_item_id,
        "purchase_date": purchase_date,
        "horizon": horizon,
        "status": status,
        "config_version": CONFIG_VERSION,
        "sample_count": sample_count,
        "history_end": history_end,
        "alpha": None,
        "beta": None,
        "phi": None,
        "level": None,
        "trend": None,
        "train_sse": None,
        "predicted": None,
        "amount": None,
        "backtest_mae": None,
        "baseline_mae": None,
        "backtest_count": 0,
        "confirmed": False,
    }


def compute_forecasts(
    case: dict[str, Any],
) -> tuple[
    list[dict[str, Any]],
    dict[tuple[str, str, str, str], dict[str, Any]],
]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in case["price_series"]:
        grouped.setdefault(row["series_id"], []).append(row)
    results: list[dict[str, Any]] = []
    lookup: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    confirmations = {
        (
            item["series_id"],
            item["purchase_date"],
            item["price"],
            item["config_version"],
        )
        for item in case["forecast_confirmations"]
    }
    for series_id in sorted(grouped):
        source_rows = grouped[series_id]
        rows, comparable = _usable_rows(source_rows, case["snapshot"]["as_of"])
        metadata = source_rows[0]
        targets = _series_targets(case, series_id, source_rows)
        for purchase_date in targets:
            history_end = rows[-1]["observed_on"] if rows else None
            horizon = (
                0
                if history_end is None
                else (parse_date(purchase_date) - parse_date(history_end)).days
            )
            if not comparable:
                result = _empty_forecast(
                    series_id,
                    metadata["cost_item_id"],
                    purchase_date,
                    horizon,
                    "NOT_COMPARABLE",
                    len(rows),
                    history_end,
                )
            elif any(row["price"] <= 0 for row in rows):
                result = _empty_forecast(
                    series_id,
                    metadata["cost_item_id"],
                    purchase_date,
                    horizon,
                    "INVALID_RESULT",
                    len(rows),
                    history_end,
                )
            elif len(rows) < HOLT_MIN_SAMPLES:
                result = _empty_forecast(
                    series_id,
                    metadata["cost_item_id"],
                    purchase_date,
                    horizon,
                    "HISTORY_INSUFFICIENT",
                    len(rows),
                    history_end,
                )
            elif horizon < 1:
                result = _empty_forecast(
                    series_id,
                    metadata["cost_item_id"],
                    purchase_date,
                    horizon,
                    "INVALID_RESULT",
                    len(rows),
                    history_end,
                )
            else:
                prices = [row["price"] for row in rows]
                try:
                    fit = select_fit(prices)
                    predicted = forecast_fit(fit, horizon)
                    amount = forecast_amount(predicted)
                    mae, baseline, count = _backtest(rows, horizon)
                    invalid = not predicted.is_finite() or predicted <= 0 or amount <= 0
                    status = (
                        "INVALID_RESULT"
                        if invalid
                        else (
                            "BACKTEST_INSUFFICIENT"
                            if count < HOLT_MIN_BACKTEST_COUNT
                            else "AVAILABLE"
                        )
                    )
                    confirmed = (
                        status == "AVAILABLE"
                        and (
                            series_id,
                            purchase_date,
                            amount,
                            CONFIG_VERSION,
                        )
                        in confirmations
                    )
                    result = {
                        "series_id": series_id,
                        "cost_item_id": metadata["cost_item_id"],
                        "purchase_date": purchase_date,
                        "horizon": horizon,
                        "status": status,
                        "config_version": CONFIG_VERSION,
                        "sample_count": len(rows),
                        "history_end": history_end,
                        "alpha": str(fit.alpha),
                        "beta": str(fit.beta),
                        "phi": str(fit.phi),
                        "level": dstr(fit.level),
                        "trend": dstr(fit.trend),
                        "train_sse": dstr(fit.sse),
                        "predicted": dstr(predicted),
                        "amount": (
                            None
                            if invalid
                            else {
                                "value": amount,
                                "basis": {
                                    "event_ids": [],
                                    "reserve_ids": [],
                                    "rules": ["R020", "D25", "D50"],
                                },
                            }
                        ),
                        "backtest_mae": dstr(mae),
                        "baseline_mae": dstr(baseline),
                        "backtest_count": count,
                        "confirmed": confirmed,
                    }
                except (ValueError, InvalidOperation, ArithmeticError):
                    result = _empty_forecast(
                        series_id,
                        metadata["cost_item_id"],
                        purchase_date,
                        horizon,
                        "FIT_FAILED",
                        len(rows),
                        history_end,
                    )
            results.append(result)
            amount_value = (
                None if result["amount"] is None else result["amount"]["value"]
            )
            entry = {
                "series_id": series_id,
                "status": result["status"],
                "qualified": result["status"] == "AVAILABLE",
                "confirmed": result["confirmed"],
                "amount": amount_value,
            }
            for row in source_rows:
                lookup[
                    (
                        row["cost_item_id"],
                        row["channel"],
                        row["spec"],
                        purchase_date,
                    )
                ] = entry
    return results, lookup

