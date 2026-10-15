from __future__ import annotations

import json
from copy import deepcopy
from decimal import Decimal, ROUND_DOWN, localcontext
from pathlib import Path

import pytest

from oracle import evaluate, evaluate_payload
from oracle.__main__ import _serialized, main
from oracle.candidates import evaluate_candidates
from oracle.engine import _calculation_case
from oracle.holt import compute_forecasts, holt_formula
from oracle.schema import validate_result
from oracle.validation import validate_semantics


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
    assert "NEED_RECONFIRM" not in result["labels"]


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

    bounded_result = result_for(VECTORS / "T008-05.json")
    assert bounded_result["input_issues"] == [
        {
            "code": "NO_PLAN",
            "refs": ["G1"],
            "rule": "§12.7(12)/D47",
        }
    ]
    assert bounded_result["candidates"][0]["evaluable"] is True
    bounded = bounded_result["forecasts"][0]
    assert bounded["sample_count"] == 0
    assert bounded["history_end"] is None
    assert bounded["status"] == "HISTORY_INSUFFICIENT"

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


def final_result(payload):
    return evaluate_payload(payload)["checkpoints"][-1]["result"]


def triggers(result):
    return [(node["at"], node["trigger"]["event_ids"]) for node in result["nodes"]]


def never_triggered(result, event_id):
    return all(event_id not in ids for _, ids in triggers(result))


def test_d75_expected_goal_payment_marks_the_cost_item_as_purchased():
    vector = load(VECTORS / "T002-05.json")
    ticket = vector["input"]["events"][0]
    del ticket["actual_at"]
    ticket.update(event_status="EXPECTED", expected_at="2026-09-05", in_snapshot=False)
    result = final_result(vector)
    assert ("2026-09-05", ["E0"]) in triggers(result)
    assert never_triggered(result, "PLAN:C02:1:TICKET")
    assert [item["event_id"] for item in result["cost"]["future_payments"]] == [
        "E0",
        "PLAN:C02:0:LODGING",
    ]
    assert result["cost"]["future_payable"]["value"] == 58000 + 30000


def test_d75_goal_payment_without_cost_item_does_not_mark_any_item():
    vector = load(VECTORS / "T002-05.json")
    del vector["input"]["events"][0]["cost_item_id"]
    result = final_result(vector)
    assert ("2026-09-10", ["PLAN:C02:1:TICKET"]) in triggers(result)
    assert result["cost"]["future_payable"]["value"] == 30000 + 52000


def test_d75_cancel_stops_counting_cancellable_unpaid_payments():
    vector = load(VECTORS / "T015-04.json")
    case = vector["input"]
    deposit = case["events"][0]
    del deposit["actual_at"]
    deposit.update(
        event_status="EXPECTED",
        expected_at="2026-09-05",
        in_snapshot=False,
        cancellable=True,
    )
    del case["candidates"][0]["items"][0]["settles_event_id"]
    vector["ops"] = [
        {"type": "EVALUATE", "label": "before"},
        {"type": "CANCEL"},
        {"type": "EVALUATE", "label": "after"},
    ]
    before, after = (
        checkpoint["result"] for checkpoint in evaluate_payload(vector)["checkpoints"]
    )
    assert ("2026-09-05", ["E-DEPOSIT"]) in triggers(before)
    assert never_triggered(before, "PLAN:C01:0:LODGING")
    assert before["action_list"] == []
    assert ("2026-09-27", ["PLAN:C01:0:LODGING"]) in triggers(after)
    assert never_triggered(after, "E-DEPOSIT")
    assert [item["task_id"] for item in after["action_list"]] == ["TASK:C01:0"]

    paid = load(VECTORS / "T015-04.json")
    paid["input"]["events"][0]["cancellable"] = True
    del paid["input"]["candidates"][0]["items"][0]["settles_event_id"]
    paid["ops"] = [{"type": "CANCEL"}]
    cancelled = final_result(paid)
    assert never_triggered(cancelled, "PLAN:C01:0:LODGING")
    assert cancelled["action_list"] == []


def test_d75_alternate_quote_is_not_counted_paid_or_tasked():
    result = result_for(VECTORS / "T002-05.json")
    by_id = {item["candidate_id"]: item for item in result["candidates"]}
    assert result["cost"]["paid_total"]["value"] == 58000
    assert result["cost"]["future_payable"]["value"] == 30000
    assert [item["event_id"] for item in result["cost"]["future_payments"]] == [
        "PLAN:C02:0:LODGING"
    ]
    assert never_triggered(result, "PLAN:C02:1:TICKET")
    assert by_id["C02"]["net_spend"]["value"] == 58000 + 30000
    assert result["confirmation"]["w"]["value"] == 30000

    vector = load(VECTORS / "T002-05.json")
    vector["input"]["confirmed_plan"] = {
        "candidate_id": "C02",
        "plan_version": "C02@v1",
        "input_version": "v1",
    }
    vector["ops"] = []
    confirmed = final_result(vector)
    assert [
        (item["task_id"], item["cost_item_id"]) for item in confirmed["action_list"]
    ] == [("TASK:C02:0", "LODGING")]


def test_d75_settling_item_is_paid_on_payment_at_and_keeps_its_task():
    result = result_for(VECTORS / "T015-04.json")
    assert not [
        item for item in result["input_issues"] if item["code"] == "REFERENCE_INVALID"
    ]
    assert ("2026-09-27", ["PLAN:C01:0:LODGING"]) in triggers(result)
    assert result["cost"]["net_spend"]["value"] == 10000 + 30000
    action = result["action_list"][0]
    assert (action["task_id"], action["payment_at"], action["amount"]["value"]) == (
        "TASK:C01:0",
        "2026-09-27",
        30000,
    )


def test_d75_settling_item_with_unknown_price_keeps_future_payable_unknown():
    vector = load(VECTORS / "T015-04.json")
    vector["input"]["candidates"][0]["items"][0].update(
        price=None, price_basis="PENDING"
    )
    result = final_result(vector)
    assert result["cost"]["pending_cost_item_ids"] == ["LODGING"]
    assert result["cost"]["future_payable"] is None


@pytest.mark.parametrize("target", ["E-NOPE", "E-TICKET", "E-REFUND"])
def test_d75_invalid_settles_reference_is_reported_and_still_paid(target):
    vector = load(VECTORS / "T015-04.json")
    case = vector["input"]
    case["cost_items"].append(
        {
            "cost_item_id": "TICKET",
            "category": "TICKET",
            "necessary": True,
            "amount_status": "CONFIRMED",
        }
    )
    ticket = deepcopy(case["events"][0])
    ticket.update(event_id="E-TICKET", cost_item_id="TICKET", amount=58000)
    refund = {
        "event_id": "E-REFUND",
        "event_kind": "RETURN",
        "event_status": "EXPECTED",
        "amount": 1000,
        "expected_at": "2026-09-20",
        "time_precision": "DATE",
        "in_snapshot": False,
        "goal_id": "G1",
        "cost_item_id": "LODGING",
        "coverage": [],
        "recorded_at": "2026-09-01T08:00:00+08:00",
        "available_at": "2026-09-01T08:00:00+08:00",
        "currency": "CNY",
    }
    case["events"].extend([ticket, refund])
    case["candidates"][0]["items"][0]["settles_event_id"] = target
    result = final_result(vector)
    assert any(
        item["code"] == "REFERENCE_INVALID" and target in item["refs"]
        for item in result["input_issues"]
    )
    assert ("2026-09-27", ["PLAN:C01:0:LODGING"]) in triggers(result)
    assert result["cost"]["future_payable"]["value"] == 30000


def test_d75_omitted_field_without_goal_payment_pays_every_item():
    vector = load(VECTORS / "T002-05.json")
    vector["input"]["events"] = []
    result = final_result(vector)
    assert result["cost"]["future_payable"]["value"] == 30000 + 52000
    assert ("2026-09-10", ["PLAN:C02:1:TICKET"]) in triggers(result)


def test_d75_inputs_without_purchased_items_keep_every_priced_item_as_payment():
    checked = 0
    for path in sorted(CASES.glob("*.json")) + sorted(VECTORS.glob("*.json")):
        data = load(path)
        case = data["input"] if "input" in data and "ops" in data else data
        purchased = {
            event["cost_item_id"]
            for event in case["events"]
            if event["event_kind"] == "GOAL_PAYMENT" and event.get("cost_item_id")
        }
        items = [item for candidate in case["candidates"] for item in candidate["items"]]
        if any(
            "settles_event_id" in item or item["cost_item_id"] in purchased
            for item in items
        ):
            continue
        issues = validate_semantics(case)
        assert not [item for item in issues if item["rule"] == "D75"], path
        working = _calculation_case(case, issues)
        _, lookup = compute_forecasts(working)
        for evaluation in evaluate_candidates(working, forecast_lookup=lookup).evaluations:
            candidate_id = evaluation.candidate["candidate_id"]
            expected = [
                f"PLAN:{candidate_id}:{index}:{item['cost_item_id']}"
                for index, item in enumerate(evaluation.candidate["items"])
                if evaluation.item_amounts[index] is not None
            ]
            planned = [
                event["event_id"]
                for event in evaluation.plan_events
                if event["event_kind"] == "GOAL_PAYMENT"
            ]
            assert planned == expected, path
            checked += 1
    assert checked > 0


def test_h3_no_plan_semantics_and_no_automatic_release():
    result = result_for(CASES / "cA_gap.json")
    assert result["states"]["plan_target"] == "NONE"
    assert result["states"]["plan_state"] == "INCOMPLETE"
    assert any(item["code"] == "NO_PLAN" for item in result["input_issues"])
    assert result["cost"]["pending_cost_item_ids"] == []
    assert result["cost"]["future_payable"] is None
    assert result["cost"]["net_spend"] is None
    assert result["dependencies"] == []
    assert never_triggered(result, "AUTO:CONTINGENCY_RELEASE")


@pytest.mark.parametrize(
    ("folder", "name"),
    [
        (CASES, "cB_topk.json"),
        (CASES, "cB_v1_two_feasible.json"),
        (CASES, "cB_v2_zero_feasible.json"),
        (CASES, "cB_v4_lodging_free.json"),
        (VECTORS, "T016-03.json"),
        (VECTORS, "T001-04.json"),
    ],
)
def test_h3_no_plan_cost_never_uses_a_partial_or_zero_total(folder, name):
    cost = result_for(folder / name)["cost"]
    assert cost["future_payable"] is None
    assert cost["net_spend"] is None


@pytest.mark.parametrize(
    "name",
    [
        "T001-01.json",
        "T001-03.json",
        "T001-05#1.json",
        "T001-05#2.json",
        "T003-01.json",
        "T003-02.json",
        "T004-03.json",
        "T004-05.json",
        "T005-05.json",
        "T006-02.json",
        "T008-01.json",
        "T013-01.json",
        "T013-02.json",
        "T013-08.json",
        "T015-07.json",
    ],
)
def test_h3_no_plan_known_common_payments_keep_cost_complete(name):
    for checkpoint in evaluate_payload(load(VECTORS / name))["checkpoints"]:
        cost = checkpoint["result"]["cost"]
        assert cost["future_payable"] is not None
        assert cost["net_spend"] is not None
        assert cost["net_spend"]["value"] == (
            cost["paid_total"]["value"]
            + cost["future_payable"]["value"]
            - cost["eligible_return"]["value"]
        )


def test_h3_no_plan_empty_and_confirmed_common_payment_costs():
    empty = result_for(CASES / "c01_base.json")["cost"]
    assert empty["future_payable"]["value"] == 0
    assert empty["net_spend"]["value"] == 0

    confirmed = result_for(VECTORS / "T003-06.json")["cost"]
    assert confirmed["pending_cost_item_ids"] == []
    assert confirmed["future_payable"]["value"] == 30000
    assert confirmed["net_spend"]["value"] == 30000
    assert [item["event_id"] for item in confirmed["future_payments"]] == ["E1"]


def test_h3_d74_truncation_raw_times_and_unknown_inflow():
    pending = result_for(VECTORS / "T010-01.json")
    assert any(
        item["code"] == "MISSING_KEY_INFO" and item["rule"] == "R010"
        for item in pending["input_issues"]
    )
    assert [ids for _, ids in triggers(pending)] == [
        [],
        ["PLAN:C01:0:TICKET"],
    ]

    malformed_time = result_for(VECTORS / "T001-06.json")
    assert malformed_time["nodes"][0]["at"] == "2026-09-01 09:00"
    overdue = result_for(VECTORS / "T017-06.json")
    assert overdue["nodes"][1]["at"] == "2026-09-10"

    unknown_return = result_for(VECTORS / "T005-03.json")
    assert not [
        item for item in unknown_return["input_issues"] if "E-DEP" in item["refs"]
    ]


def test_h3_forecast_eligibility_nets_offers_and_pending_reasons():
    forecast = result_for(VECTORS / "T005-06.json")
    by_id = {item["candidate_id"]: item for item in forecast["candidates"]}
    assert forecast["states"]["plan_state"] == "INCOMPLETE"
    assert forecast["states"]["optimization_state"] == "PARTIALLY_EVALUABLE"
    assert by_id["C02"]["evaluable"] is False
    assert by_id["C02"]["net_spend"] is None
    assert by_id["C02"]["pending_reasons"][0]["code"] == "PRICE_PENDING"

    offer = result_for(VECTORS / "T009-03#3.json")
    c03 = next(item for item in offer["candidates"] if item["candidate_id"] == "C03")
    assert [item["code"] for item in c03["excluded_reasons"]] == [
        "OFFER_MAX_USES_EXCEEDED",
        "PAYMENT_GAP",
    ]
    assert c03["net_spend"]["value"] == 60000

    pending = result_for(VECTORS / "T008-02.json")
    c02 = next(item for item in pending["candidates"] if item["candidate_id"] == "C02")
    assert c02["pending_reasons"] == [
        {"code": "NON_CNY", "rule": "R008", "refs": ["LODGING"]}
    ]

    overdue = load(VECTORS / "T017-06.json")
    overdue["input"]["goal"]["refundable_required"] = ["OUTBOUND_TRANSPORT"]
    overdue["input"]["candidates"][0]["items"][0]["refundable"] = False
    overdue_result = final_result(overdue)
    overdue_candidate = overdue_result["candidates"][0]
    assert overdue_candidate["evaluable"] is False
    assert overdue_candidate["pending_reasons"] == [
        {
            "code": "PAYMENT_TIME_MISSING",
            "rule": "R010/R017",
            "refs": ["TRAIN-OUT"],
        }
    ]
    assert overdue_candidate["excluded_reasons"][0]["code"] == "NOT_REFUNDABLE"
    assert overdue_result["optimization"]["pending_count"] == 1

    ordered = load(CASES / "cB_topk.json")
    candidate = next(
        item for item in ordered["candidates"] if item["candidate_id"] == "C02"
    )
    ordered["candidates"] = [candidate]
    by_cost_id = {item["cost_item_id"]: item for item in candidate["items"]}
    by_cost_id["TICKET"]["price"] = None
    by_cost_id["TICKET"]["price_basis"] = "PENDING"
    by_cost_id["TRAIN-OUT"]["currency"] = "USD"
    ordered_reasons = final_result(ordered)["candidates"][0]["pending_reasons"]
    assert [(item["refs"], item["code"]) for item in ordered_reasons] == [
        (["TICKET"], "PRICE_PENDING"),
        (["TRAIN-OUT"], "NON_CNY"),
    ]


def test_h3_confirmation_dependencies_and_conditional_net_spend():
    preconfirmed_case = load(CASES / "c00_r019_minimal.json")
    preconfirmed = evaluate(preconfirmed_case)["checkpoints"][-1]["result"]
    assert preconfirmed["confirmation"] is None
    assert preconfirmed["cost"]["net_spend_if_received"] is None

    selected_preconfirmed = evaluate(
        preconfirmed_case,
        [{"type": "SELECT_CANDIDATE", "candidate_id": "C01"}],
    )["checkpoints"][-1]["result"]
    assert selected_preconfirmed["confirmation"] is None

    draft = result_for(VECTORS / "T017-08.json")
    assert draft["states"]["confirmation_state"] == "DRAFT"
    assert draft["confirmation"] is None

    dependencies = result_for(CASES / "cB_v5_cancel.json")["dependencies"]
    assert [item["kind"] for item in dependencies] == [
        "EXPECTED_INCOME",
        "EXPECTED_INCOME",
        "EXPECTED_INCOME",
        "EXPECTED_INCOME",
        "ESTIMATE",
        "ESTIMATE",
    ]
    assert [item["refs"][0] for item in dependencies] == [
        "E-INC-1001",
        "E-INC-1020",
        "E-INC-1101",
        "E-INC-1201",
        "E-MEALS-1128",
        "E-LOCAL-1128",
    ]
    assert all("E-TICKET-REFUND" not in item["refs"] for item in dependencies)
    estimate = result_for(VECTORS / "T009-06.json")["dependencies"][0]
    assert estimate["at"] == "2026-09-27"


def test_h3_daily_forecast_and_scenario_output_contracts():
    no_plan = result_for(CASES / "c01_base.json")
    assert no_plan["daily_reference"] == {
        "display": "NEED_CONFIRMED_PLAN",
        "unavailable": [],
        "missing_reasons": [],
    }
    assert no_plan["scenarios"][1]["observation_start"] is None
    assert no_plan["scenarios"][1]["observation_end"] is None

    limited = result_for(CASES / "c00_r019_minimal.json")
    assert limited["daily_reference"]["limited_by"]["node_index"] == 1
    cancelled_with_obligation = result_for(VECTORS / "T012-02.json")
    assert (
        cancelled_with_obligation["states"]["underlying_plan_state"]
        == "FEASIBLE_UNDER_ASSUMPTIONS"
    )
    assert cancelled_with_obligation["daily_reference"]["display"] == "AMOUNT"
    assert cancelled_with_obligation["daily_reference"]["amount"]["value"] == 30000
    assert cancelled_with_obligation["daily_reference"]["label"] == "CONFIRMED_ONLY"
    assert cancelled_with_obligation["daily_reference"]["limited_by"] == {
        "scenario": "CONFIRMED_ONLY",
        "node_index": 1,
    }
    assert cancelled_with_obligation["daily_reference"]["unavailable"] == [
        {"scenario": "RECENT_MONTH", "reason": "HISTORY_INSUFFICIENT"}
    ]
    assert "DAILY_DISCLAIMER" in cancelled_with_obligation["labels"]
    assert (
        cancelled_with_obligation["scenarios"][0]["daily_reference"]
        == cancelled_with_obligation["daily_reference"]["amount"]
    )

    cancelled_empty = result_for(VECTORS / "T012-03.json")
    assert (
        cancelled_empty["states"]["underlying_plan_state"]
        == "FEASIBLE_UNDER_ASSUMPTIONS"
    )
    assert cancelled_empty["daily_reference"]["amount"]["value"] == 50000
    assert cancelled_empty["scenarios"][0]["daily_reference"]["value"] == 50000

    early = evaluate_payload(load(VECTORS / "T002-02.json"))["checkpoints"][0][
        "result"
    ]["scenarios"][1]
    assert (early["observation_start"], early["observation_end"]) == (
        "2026-09-01",
        "2026-09-09",
    )
    assert early["complete_days"] == 0
    assert early["unavailable_reason"] == "HISTORY_INSUFFICIENT"
    september_11 = result_for(VECTORS / "T017-06.json")["scenarios"][1]
    assert (september_11["observation_start"], september_11["observation_end"]) == (
        "2026-09-01",
        "2026-09-10",
    )

    incomparable = result_for(VECTORS / "T020-07#1.json")["forecasts"][0]
    assert (
        incomparable["sample_count"],
        incomparable["history_end"],
        incomparable["horizon"],
    ) == (0, None, 0)

    recent = result_for(VECTORS / "T018-10#1.json")["scenarios"][1]
    assert [item["category"] for item in recent["groups"]] == [
        "MEALS",
        "LOCAL_TRANSPORT",
        "DAILY_GOODS",
        "ENTERTAINMENT",
    ]
    coverage = result_for(VECTORS / "T018-04.json")["scenarios"][1]["groups"][0]
    assert coverage["coverage_end"] == "2026-10-31"


def test_h3_label_predicates_and_no_daily_duplication():
    amount = result_for(CASES / "c00_r019_minimal.json")
    assert "DAILY_DISCLAIMER" in amount["labels"]
    assert "CONFIRMED_ONLY" not in amount["labels"]
    assert "IF_RECEIVED" not in amount["labels"]

    unavailable = result_for(VECTORS / "T020-05.json")
    assert "FORECAST_DISCLAIMER" in unavailable["labels"]
    assert "FORECAST_UNAVAILABLE" in unavailable["labels"]
    assert "NEED_CONFIRMED_PLAN" not in unavailable["labels"]

    no_forecast = result_for(VECTORS / "T009-02.json")
    assert "FORECAST_UNAVAILABLE" not in no_forecast["labels"]
    no_confirmation = result_for(VECTORS / "T010-05.json")
    assert "NEED_RECONFIRM" not in no_confirmation["labels"]

    living_missing = result_for(CASES / "c00_v1_living_not_provided.json")
    assert "LIVING_ARRANGEMENT_MISSING" in living_missing["labels"]
    assert "UNAVAILABLE" not in living_missing["labels"]


def test_h3_protected_squeeze_only_labels_outflow_shortfalls():
    start_only = load(VECTORS / "T012-03.json")
    start_only["input"]["snapshot"]["cash"] = 40000
    start_only["input"]["snapshot"]["goal_allocation"] = 0
    start_only["ops"] = []
    start_result = final_result(start_only)
    assert start_result["nodes"][0]["node_verdict"] == "PROTECTED_SHORTFALL"
    assert start_result["nodes"][0]["trigger"]["kind"] == "START"
    assert "PROTECTED_SQUEEZE" not in start_result["labels"]

    outflow = load(CASES / "c00_r019_minimal.json")
    outflow["snapshot"]["cash"] = 89000
    outflow_result = final_result(outflow)
    squeezed = next(
        node
        for node in outflow_result["nodes"]
        if node["node_verdict"] == "PROTECTED_SHORTFALL"
    )
    assert squeezed["trigger"]["kind"] == "OUTFLOW"
    assert "PROTECTED_SQUEEZE" in outflow_result["labels"]

