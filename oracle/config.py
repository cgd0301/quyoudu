"""Frozen demonstration configuration from rules.md §7 and §8."""

from __future__ import annotations

from decimal import Context, Decimal, ROUND_HALF_UP, getcontext


CONFIG_VERSION = "DEMO-CFG-1"
TOP_K = 3
TOP_K_LABEL = "K=3（演示配置v1）"

SUPPORTED_START = "2026-09-01"
SUPPORTED_END = "2027-01-01"
BEIJING_OFFSET = "+08:00"

SCENARIO_WINDOW_DAYS = 30
HOLT_MIN_SAMPLES = 14
HOLT_MIN_BACKTEST_COUNT = 5
HOLT_ALPHAS = tuple(Decimal(value) for value in ("0.2", "0.4", "0.6", "0.8"))
HOLT_BETAS = HOLT_ALPHAS
HOLT_PHIS = tuple(Decimal(value) for value in ("0.80", "0.90", "0.95", "0.98"))
TWELVE_PLACES = Decimal("0.000000000001")
DECIMAL_CONTEXT = Context(prec=34, rounding=ROUND_HALF_UP)

getcontext().prec = DECIMAL_CONTEXT.prec
getcontext().rounding = DECIMAL_CONTEXT.rounding

