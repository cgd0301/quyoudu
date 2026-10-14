from __future__ import annotations

import json
from copy import deepcopy
from decimal import Decimal, ROUND_DOWN, localcontext
from pathlib import Path

from oracle import evaluate, evaluate_payload
from oracle.__main__ import _serialized, main
from oracle.holt import holt_formula
from oracle.schema import validate_result


ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "fixtures" / "cases"
VECTORS = ROOT / "fixtures" / "vectors"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def result_for(path: Path):
    return evaluate_payload(load(path))["checkpoints"][-1]["result"]


def values(node):
    return {
        key: node[key]["value"]
        for key in (
            "cash",
            "living_reserve",
            "other_protected_reserve",
            "other_goal_hold",
            "contingency_reserve",
            "goal_allocation",
            "goal_available",
            "payment_headroom",
            "unallocated",
            "protected_total",
        )
    }


def test_c00_daily_reference_and_today_spend():
    base = load(CASES / "c00_r019_minimal.json")
    initial = evaluate_payload(base)["checkpoints"][0]["result"]
    assert initial["snapshot"]["unallocated"]["value"] == 30000
    assert initial["snapshot"]["contingency_reserve"]["value"] == 0
    assert initial["daily_reference"]["display"] == "AMOUNT"
    assert initial["daily_reference"]["amount"]["value"] == 10000

    vector = load(VECTORS / "T019-02.json")
    updated = evaluate_payload(vector)["checkpoints"][0]["result"]
    assert updated["snapshot"]["cash"]["value"] == 96000
    assert updated["snapshot"]["unallocated"]["value"] == 26000
    assert updated["daily_reference"]["amount"]["value"] == 6000


def test_rules_10_7_every_fixed_number():
    data = load(VECTORS / "T006-04.json")
    result = evaluate_payload(data)["checkpoints"][0]["result"]
    assert result["as_of"] == "2026-09-01T09:00:00+08:00"
    assert result["check_period"]["end"] == "2027-01-01"
    assert data["input"]["goal"]["budget_cap"] == 90000
    start, september_5, september_10 = result["nodes"]

    assert values(start) == {
        "cash": 100000,
        "living_reserve": 30000,
        "other_protected_reserve": 0,
        "other_goal_hold": 0,
        "contingency_reserve": 0,
        "goal_allocation": 40000,
        "goal_available": 70000,
        "payment_headroom": 70000,
        "unallocated": 30000,
        "protected_total": 30000,
    }
    assert start["node_verdict"] == "PASS"

    assert values(september_5) == {
        "cash": 60000,
        "living_reserve": 30000,
        "other_protected_reserve": 0,
        "other_goal_hold": 0,
        "contingency_reserve": 0,
        "goal_allocation": 40000,
        "goal_available": 30000,
        "payment_headroom": 30000,
        "unallocated": -10000,
        "protected_total": 30000,
    }
    assert september_5["node_verdict"] == "PAYMENT_SHORTFALL"
    assert september_5["amount"]["value"] == 10000
    assert september_5["related"] == ["E-0905"]

    assert values(september_10) == {
        "cash": 20000,
        "living_reserve": 30000,
        "other_protected_reserve": 0,
        "other_goal_hold": 0,
        "contingency_reserve": 0,
        "goal_allocation": 0,
        "goal_available": -10000,
        "payment_headroom": -10000,
        "unallocated": -10000,
        "protected_total": 30000,
    }
    assert september_10["node_verdict"] == "GAP_CONTINUED"
    assert september_10["amount"]["value"] == 10000
    assert result["earliest_gap"]["at"] == "2026-09-05"
    assert result["earliest_gap"]["amount"]["value"] == 10000
    assert result["states"]["plan_state"] == "PAYMENT_GAP"


def test_rules_10_8_every_fixed_number():
    base = result_for(CASES / "c01_base.json")
    snapshot = base["snapshot"]
    assert snapshot["cash"]["value"] == 100000
    assert snapshot["living_reserve"]["value"] == 30000
    assert snapshot["other_protected_reserve"]["value"] == 0
    assert snapshot["other_goal_hold"]["value"] == 0
    assert snapshot["contingency_reserve"]["value"] == 20000
    assert snapshot["goal_allocation"]["value"] == 40000
    assert snapshot["goal_available"]["value"] == 70000
    assert snapshot["payment_headroom"]["value"] == 50000
    assert snapshot["unallocated"]["value"] == 10000
    assert snapshot["protected_total"]["value"] == 50000
    assert (
        snapshot["living_reserve"]["value"]
        + snapshot["other_protected_reserve"]["value"]
        + snapshot["other_goal_hold"]["value"]
        + snapshot["contingency_reserve"]["value"]
        + snapshot["goal_allocation"]["value"]
        == 90000
    )
    assert load(CASES / "c01_base.json")["goal"]["budget_cap"] == 90000

    t003 = result_for(VECTORS / "T003-01.json")["nodes"][1]
    assert values(t003) == {
        "cash": 80000,
        "living_reserve": 10000,
        "other_protected_reserve": 0,
        "other_goal_hold": 0,
        "contingency_reserve": 20000,
        "goal_allocation": 40000,
        "goal_available": 70000,
        "payment_headroom": 50000,
        "unallocated": 10000,
        "protected_total": 30000,
    }

    t004_result = result_for(VECTORS / "T004-02.json")
    t004 = t004_result["nodes"][0]
    assert t004["cash"]["value"] == 100000
    assert t004["living_reserve"]["value"] == 30000
    assert t004["contingency_reserve"]["value"] == 20000
    assert t004["goal_allocation"]["value"] == 60000
    assert t004["goal_available"]["value"] == 70000
    assert t004["payment_headroom"]["value"] == 50000
    assert t004["unallocated"]["value"] == -10000
    assert t004["node_verdict"] == "ALLOCATION_CONFLICT"
    assert t004["amount"]["value"] == 10000
    assert 30000 + 0 + 0 + 20000 + 60000 - 100000 == 10000

    t006_result = result_for(VECTORS / "T006-01.json")
    payment, income = t006_result["nodes"][1:3]
    assert values(payment) == {
        "cash": 35000,
        "living_reserve": 30000,
        "other_protected_reserve": 0,
        "other_goal_hold": 0,
        "contingency_reserve": 20000,
        "goal_allocation": 0,
        "goal_available": 5000,
        "payment_headroom": -15000,
        "unallocated": -15000,
        "protected_total": 50000,
    }
    assert payment["node_verdict"] == "PROTECTED_SHORTFALL"
    assert payment["amount"]["value"] == 15000
    assert values(income) == {
        "cash": 75000,
        "living_reserve": 30000,
        "other_protected_reserve": 0,
        "other_goal_hold": 0,
        "contingency_reserve": 20000,
        "goal_allocation": 0,
        "goal_available": 45000,
        "payment_headroom": 25000,
        "unallocated": 25000,
        "protected_total": 50000,
    }
    assert income["node_verdict"] == "PASS"
    assert t006_result["states"]["plan_state"] == "PAYMENT_GAP"


def test_holt_formula_constructed():
    fit, predicted, amount = holt_formula(
        [10000, 11000, 13675],
        alpha=Decimal("0.2"),
        beta=Decimal("0.2"),
        phi=Decimal("0.80"),
        horizon=1,
    )
    assert fit.level == Decimal("12175.000000000000")
    assert fit.trend == Decimal("875.000000000000")
    assert predicted == Decimal("12875.000000000000")
    assert amount == 12875


def test_unit_command_outputs_requested_keys(capsys):
    assert main(["unit"]) == 0
    output = json.loads(capsys.readouterr().out)
    assert set(output) == {"T007-05", "T020-01", "T020-11"}


def test_stale_confirmation_rechecks_current_version_and_preview_labels():
    checkpoints = evaluate_payload(load(VECTORS / "T017-02.json"))["checkpoints"]
    preview = checkpoints[0]["result"]
    confirmed = checkpoints[-1]["result"]

    preview_labels = {"DRAFT_PREVIEW", "PREVIEW_UNCONFIRMED"}
    assert preview_labels <= set(preview["labels"])
    assert confirmed["input_version"] == "v3"
    assert confirmed["confirmation"]["input_version"] == "v2"
    assert confirmed["states"]["confirmation_state"] == "CONFIRMED"
    assert preview_labels.isdisjoint(confirmed["labels"])


def test_top_k_is_stable_and_never_breaks_tie_limit():
    result = result_for(CASES / "cB_topk.json")
    by_id = {item["candidate_id"]: item for item in result["candidates"]}
    assert result["states"]["optimization_state"] == "COMPLETED_FEASIBLE"
    assert by_id["C01"]["excluded_reasons"][0]["code"] == "PAYMENT_GAP"
    assert by_id["C03"]["excluded_reasons"][0]["code"] == "ARRIVAL_TOO_LATE"
    assert by_id["C04"]["excluded_reasons"][0]["code"] == "OFFER_NOT_STACKABLE"
    assert [(key, by_id[key]["rank"]) for key in ("C02", "C05", "C06", "C07")] == [
        ("C02", 1),
        ("C05", 2),
        ("C06", 3),
        ("C07", None),
    ]
    assert by_id["C06"]["tie_group"] == by_id["C07"]["tie_group"]


def test_scenario_group_rounding_and_no_daily_deduplication():
    result = result_for(VECTORS / "T018-12.json")
    scenario = next(item for item in result["scenarios"] if item["kind"] == "RECENT_MONTH")
    group = scenario["groups"][0]
    assert group["scenario_group_total"]["value"] == 1000
    assert group["scheduled_group_total"]["value"] == 500
    assert group["scenario_increment"]["value"] == 500
    assert [item["amount"]["value"] for item in group["daily_amounts"]] == [167, 167, 166]


def test_scenario_without_matching_reserve_becomes_uncovered_not_unavailable():
    result = result_for(VECTORS / "T018-01.json")
    scenario = next(item for item in result["scenarios"] if item["kind"] == "RECENT_MONTH")
    assert scenario["available"] is True
    assert scenario["unavailable_reason"] is None
    assert scenario["groups"][0]["scenario_increment"]["value"] == 279000


def test_out_of_range_period_never_returns_a_numeric_daily_reference():
    result = result_for(VECTORS / "T008-07.json")
    assert result["check_period"]["out_of_range"] is True
    assert result["daily_reference"]["display"] == "UNAVAILABLE"
    assert "amount" not in result["daily_reference"]


def test_add_today_spend_replacing_same_event_is_idempotent():
    case = load(CASES / "c00_r019_minimal.json")
    op = {
        "type": "ADD_TODAY_SPEND",
        "event_id": "E-SAME",
        "amount": 5000,
        "actual_at": case["snapshot"]["as_of"],
        "goal_id": "G1",
        "cost_item_id": "TICKET",
        "coverage": [],
    }
    result = evaluate(case, [op, op])["checkpoints"][0]["result"]
    assert result["input_version"] == "v3"
    assert result["snapshot"]["cash"]["value"] == 95000
    assert result["snapshot"]["goal_allocation"]["value"] == 35000
    assert result["cost"]["paid_total"]["value"] == 5000


def test_partial_payment_keeps_the_remaining_action():
    result = result_for(VECTORS / "T015-04.json")
    assert result["cost"]["paid_total"]["value"] == 10000
    assert result["cost"]["future_payable"]["value"] == 30000
    assert [(item["cost_item_id"], item["amount"]["value"]) for item in result["action_list"]] == [
        ("LODGING", 30000)
    ]


def test_confirmed_plan_is_frozen_when_current_candidate_price_changes():
    case = load(CASES / "c00_r019_minimal.json")
    result = evaluate(
        case,
        [{"type": "PATCH", "path": "/candidates/0/items/0/price", "value": 90000}],
    )["checkpoints"][0]["result"]
    assert result["states"]["confirmation_state"] == "CONFIRMED"
    assert result["cost"]["future_payable"]["value"] == 60000
    assert result["action_list"][0]["amount"]["value"] == 60000
    assert result["daily_reference"]["amount"]["value"] == 10000
    assert result["candidates"][0]["net_spend"]["value"] == 90000
    assert "NEED_RECONFIRM" in result["labels"]


def test_shared_cash_missing_prevents_candidate_ranking():
    vector = load(VECTORS / "T016-01.json")
    vector["input"]["snapshot"]["cash"] = None
    result = evaluate_payload(vector)["checkpoints"][0]["result"]
    assert result["states"]["plan_state"] == "INCOMPLETE"
    assert result["states"]["optimization_state"] == "PARTIALLY_EVALUABLE"
    assert all(item["rank"] is None for item in result["candidates"])


def test_holt_backtest_respects_origin_availability_and_decimal_context():
    vector = load(VECTORS / "T020-02.json")
    late = vector["input"]["price_series"][4]
    late["price"] = 999999
    late["recorded_at"] = "2026-09-30T23:00:00+08:00"
    late["available_at"] = "2026-09-30T23:00:00+08:00"
    forecast = evaluate_payload(vector)["checkpoints"][0]["result"]["forecasts"][0]
    assert forecast["backtest_count"] == 11
    assert forecast["backtest_mae"] == "0.000000000000"

    with localcontext() as context:
        context.prec = 4
        context.rounding = ROUND_DOWN
        _, _, amount = holt_formula(
            [10000, 11000, 13675],
            alpha=Decimal("0.2"),
            beta=Decimal("0.2"),
            phi=Decimal("0.80"),
            horizon=1,
        )
        assert amount == 12875


def test_precheck_o_group_rulings():
    cancelled = result_for(VECTORS / "T012-02.json")
    assert cancelled["cost"]["possible_refund"]["amount"]["value"] == 15000
    assert cancelled["cost"]["possible_refund"]["condition"] == "平台审核通过"

    bounded = result_for(VECTORS / "T008-05.json")["forecasts"][0]
    assert bounded["sample_count"] == 0
    assert bounded["history_end"] is None

    conflict = result_for(VECTORS / "T004-07.json")
    assert conflict["constraint_issues"]["allocation_conflicts"][0]["related"] == [
        "E-INC",
        "R-LIV-0908",
    ]

    unknown_return = result_for(VECTORS / "T005-03.json")
    assert unknown_return["states"]["plan_state"] == "FEASIBLE_UNDER_ASSUMPTIONS"


def test_a4_zero_labels_and_recent_history_reason():
    tied = result_for(VECTORS / "T016-07.json")
    by_id = {item["candidate_id"]: item for item in tied["candidates"]}
    assert by_id["C03"]["tie_group"] == by_id["C04"]["tie_group"]
    assert by_id["C03"]["rank"] == 3
    assert by_id["C04"]["rank"] is None
    assert {"SAME_PRICE", "HISTORY_INSUFFICIENT"} <= set(tied["labels"])

    short_history = result_for(VECTORS / "T018-02.json")
    recent = next(
        item for item in short_history["scenarios"] if item["kind"] == "RECENT_MONTH"
    )
    assert recent["complete_days"] == 29
    assert recent["unavailable_reason"] == "HISTORY_INSUFFICIENT"
    assert "HISTORY_INSUFFICIENT" in short_history["labels"]


def test_confirmed_forecast_action_rechecks_price_and_conditions():
    result = result_for(VECTORS / "T020-09.json")
    assert result["action_list"][0]["offer_ids"] == []
    assert result["action_list"][0]["pending_checks"] == [
        "RECHECK_PRICE",
        "RECHECK_OFFER_CONDITIONS",
    ]


def test_all_fixture_inputs_produce_schema_valid_results():
    paths = sorted(CASES.glob("*.json")) + sorted(VECTORS.glob("*.json"))
    assert len(list(CASES.glob("*.json"))) == 10
    assert len(list(VECTORS.glob("*.json"))) == 152
    for path in paths:
        output = evaluate_payload(load(path))
        assert output["checkpoints"], path
        for checkpoint in output["checkpoints"]:
            validate_result(checkpoint["result"])


def test_json_rendering_is_utf8_friendly_sorted_two_space_lf():
    rendered = _serialized({"中": 1, "a": {"z": 2}})
    assert rendered == '{\n  "a": {\n    "z": 2\n  },\n  "中": 1\n}\n'
    assert "\r" not in rendered
    assert rendered.encode("utf-8").decode("utf-8") == rendered

