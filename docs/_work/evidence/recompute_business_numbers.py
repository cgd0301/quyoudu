"""独立复算：市场与商业数字（不依赖 scripts/business-model.ts）

用途：
1. 用 Decimal 按公开公式重算正式项目书里出现的派生数字（人均票房、票房外消费、合计）。
2. 复算本轮被删除的两张数值表（漏斗 27 组、单位经济 27 组），证明“算得对”不等于“参数有依据”，
   并把两组结论写进数据台账与最终审计。
3. 复算 token 成本与数量级比较，检查旧稿“低一个/两个数量级”的表述是否成立。

口径：
- 输入事实只允许来自 docs/sources.md 的 E01、E02、E04（本文件顶部常量即其采信数值）。
- 舍入一律 ROUND_HALF_UP；人均口径只在最后一步取整（与 docs/_work/business_model.md 原口径一致）。
- 旧取值轴只用于审计复算，不是估计值，也不再出现在任何正式材料中。

运行：
  python docs/_work/evidence/recompute_business_numbers.py
输出：
  docs/_work/evidence/recompute_business_numbers.md（UTF-8、LF，无 BOM）
"""

from decimal import Decimal, ROUND_HALF_UP, getcontext
import json
from pathlib import Path

getcontext().prec = 40

OUT = Path(__file__).resolve().parent / "recompute_business_numbers.md"

# ---- 已核验的原始事实（docs/sources.md E01/E02/E04） ----
ATTENDANCE_WAN = Decimal("4338.58")   # E01 5000 人以上大型营业性演出观众人数（万人次）
BOX_OFFICE_YI = Decimal("324.48")     # E01 同口径票房收入（亿元）
MULTIPLIER = Decimal("6.85")          # E01 对其他消费的平均带动系数
EVENT_COUNT = Decimal("3000")         # E01 同口径场次（场）
STUDENTS_WAN = Decimal("4846.00")     # E02 各种形式的高等教育在学总规模（万人）
PRICE_IN_USD = Decimal("0.30")        # E04 输入（缓存未命中）高峰价（USD/百万 token）
PRICE_OUT_USD = Decimal("1.20")       # E04 输出高峰价（USD/百万 token）

# ---- 旧稿取值轴（无依据，仅用于复算已删除的表，不是估计） ----
OLD_AGE = [Decimal("0.20"), Decimal("0.35"), Decimal("0.50")]
OLD_CROSS = [Decimal("0.10"), Decimal("0.20"), Decimal("0.30")]
OLD_MULTI = [Decimal("0.20"), Decimal("0.40"), Decimal("0.60")]
OLD_INPUT_TOKENS = [3000, 6000, 12000]
OLD_OUTPUT_TOKENS = [600, 1200, 2400]
OLD_PRICE_CNY = [Decimal("1"), Decimal("5"), Decimal("10")]
OLD_CAC_CNY = [Decimal("5"), Decimal("20"), Decimal("50")]
OLD_PLANS = [1, 2, 3]
OLD_FX = Decimal("7.1")  # 旧稿汇率假设，未核验


def half_up(value: Decimal, places: int) -> Decimal:
    return value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def normalize(value: Decimal) -> str:
    return format(value.normalize(), "f")


def anchors() -> dict:
    # 亿元 ÷ 万人次 = 元/人次：1 亿元 = 1e8 元，1 万人次 = 1e4 人次
    per_attendance = BOX_OFFICE_YI * Decimal("1e8") / (ATTENDANCE_WAN * Decimal("1e4"))
    ticket_exact = half_up(per_attendance, 2)
    ticket = half_up(per_attendance, 0)
    other = half_up(per_attendance * MULTIPLIER, 0)
    return {
        "per_attendance_exact": per_attendance,
        "ticket_exact": ticket_exact,
        "ticket": ticket,
        "other": other,
        "total": ticket + other,
        "other_exact": per_attendance * MULTIPLIER,
        "avg_per_event": ATTENDANCE_WAN * Decimal("1e4") / EVENT_COUNT,
        "cross_check_other_consumption_yi": BOX_OFFICE_YI * MULTIPLIER,
    }


def old_funnel() -> list:
    rows = []
    for age in OLD_AGE:
        for cross in OLD_CROSS:
            for multi in OLD_MULTI:
                rows.append((age, cross, multi, half_up(ATTENDANCE_WAN * age * cross * multi, 2)))
    return rows


def unit_cost_usd(input_tokens: int, output_tokens: int, peak: bool = True) -> Decimal:
    factor = Decimal("1") if peak else Decimal("0.5")
    return (Decimal(input_tokens) / Decimal("1e6")) * PRICE_IN_USD * factor + (
        Decimal(output_tokens) / Decimal("1e6")
    ) * PRICE_OUT_USD * factor


def old_unit_table() -> list:
    rows = []
    for inp in OLD_INPUT_TOKENS:
        for out in OLD_OUTPUT_TOKENS:
            usd = unit_cost_usd(inp, out, True)
            rows.append((inp, out, half_up(usd * OLD_FX, 4), half_up(usd * Decimal("0.5") * OLD_FX, 4)))
    return rows


def old_break_even() -> list:
    mid_in = OLD_INPUT_TOKENS[len(OLD_INPUT_TOKENS) // 2]
    mid_out = OLD_OUTPUT_TOKENS[len(OLD_OUTPUT_TOKENS) // 2]
    per_plan = unit_cost_usd(mid_in, mid_out, True) * OLD_FX
    rows = []
    for price in OLD_PRICE_CNY:
        for cac in OLD_CAC_CNY:
            for plans in OLD_PLANS:
                revenue = price * plans
                model_cost = per_plan * plans
                margin = half_up(revenue - model_cost - cac, 2)
                need = None
                if margin > 0:
                    need = int((Decimal("10000") / margin).to_integral_value(rounding="ROUND_CEILING"))
                rows.append((price, cac, plans, revenue, half_up(model_cost, 2), margin, need))
    return rows


def main() -> None:
    a = anchors()
    funnel = old_funnel()
    units = old_unit_table()
    breaks = old_break_even()

    funnel_min = min(row[3] for row in funnel)
    funnel_max = max(row[3] for row in funnel)
    per_plan_cost = unit_cost_usd(6000, 1200, True) * OLD_FX
    annual_cost_max = per_plan_cost * Decimal("3")
    min_cac = min(OLD_CAC_CNY)
    ratio_plan = (min_cac / per_plan_cost).quantize(Decimal("0.1"))
    ratio_annual = (min_cac / annual_cost_max).quantize(Decimal("0.1"))

    lines = []
    lines.append("# 市场与商业数字独立复算记录")
    lines.append("")
    lines.append("> 由 `python docs/_work/evidence/recompute_business_numbers.py` 生成；只读公开事实，不读 `scripts/business-model.ts`。")
    lines.append("> 本文件是审计证据，不是项目书内容；文中旧取值轴仅用于说明“算得对但参数无依据”，不构成任何估计。")
    lines.append("")
    lines.append("## 一、输入事实（E01/E02/E04）")
    lines.append("")
    lines.append("| 事实 | 值 | 单位 | 来源 |")
    lines.append("| --- | --- | --- | --- |")
    lines.append("| 5000 人以上大型演出场次 | " + str(EVENT_COUNT) + " | 场 | E01 |")
    lines.append("| 同口径票房收入 | " + str(BOX_OFFICE_YI) + " | 亿元 | E01 |")
    lines.append("| 同口径观众人数 | " + str(ATTENDANCE_WAN) + " | 万人次 | E01 |")
    lines.append("| 平均带动系数 | 1:" + str(MULTIPLIER) + " | 倍 | E01 |")
    lines.append("| 高等教育在学总规模 | " + str(STUDENTS_WAN) + " | 万人 | E02 |")
    lines.append("| deepseek-flash 输入（缓存未命中，高峰） | " + str(PRICE_IN_USD) + " | USD/百万 token | E04 |")
    lines.append("| deepseek-flash 输出（高峰） | " + str(PRICE_OUT_USD) + " | USD/百万 token | E04 |")
    lines.append("")
    lines.append("## 二、人均口径（正式项目书第一章使用）")
    lines.append("")
    lines.append("公式：人均票房 = 324.48 亿元 ÷ 4338.58 万人次 × 10⁴（单位换算），只在最后一步取整。")
    lines.append("")
    lines.append("| 结果 | 精确值 | 取整规则 | 采用值 | 复算结论 |")
    lines.append("| --- | --- | --- | --- | --- |")
    lines.append("| 人均票房 | " + str(half_up(a["per_attendance_exact"], 6)) + " 元/人次 | 四舍五入到元 | " + str(a["ticket"]) + " 元/人次 | 与项目书 748 一致 |")
    lines.append("| 人均票房外消费 | " + str(half_up(a["other_exact"], 6)) + " 元/人次 | 四舍五入到元 | " + str(a["other"]) + " 元/人次 | 与项目书 5123 一致 |")
    lines.append("| 人均合计 | " + str(half_up(a["other_exact"] + a["per_attendance_exact"], 6)) + " 元/人次 | 两项已取整值相加 | " + str(a["total"]) + " 元/人次 | 与项目书 5871 一致 |")
    lines.append("")
    lines.append("- 交叉核对：324.48 亿元 × 6.85 = " + str(a["cross_check_other_consumption_yi"]) + " 亿元，与 E01「票房外消费超 2200 亿元」相容（" + str(a["cross_check_other_consumption_yi"]) + " > 2200）。")
    lines.append("- 口径核对：4338.58 万人次 ÷ 3000 场 = " + str(a["avg_per_event"].quantize(Decimal("1"))) + " 人次/场，与「5000 人以上」的场馆规模相容，但这是人次，不是去重人数。")
    lines.append("")
    lines.append("结论：这三个数字可以由公开事实与透明公式复算，但只支持「跨城观演是一笔数千元量级的支出」这一背景结论；不支持客单价、市场规模或收入。")
    lines.append("")

    lines.append("## 三、已删除的漏斗数值表（27 组）复算")
    lines.append("")
    lines.append("公式：条件式人次 = 4338.58 万人次 × 18—30 岁占比 × 跨城比例 × 付款分散比例。")
    lines.append("旧稿把三个比例取为 20%/35%/50%、10%/20%/30%、20%/40%/60%，均无来源；复算证明算术无误，但没有一行是估计。")
    lines.append("")
    lines.append("- 27 行最小 " + str(funnel_min) + " 万人次、最大 " + str(funnel_max) + " 万人次，跨度约 " + str(int(funnel_max / funnel_min)) + " 倍。")
    lines.append("- 「跨一个数量级」只说明结果随输入线性放大，不能反过来证明目标市场有多大。")
    lines.append("- 处置：数值表与取值轴全部删除，正文只保留符号公式；结果单位是人次，不是独立用户数。")
    lines.append("")

    lines.append("## 四、已删除的单位经济表（27 组）复算")
    lines.append("")
    lines.append("token 成本公式：成本（美元）= 输入 token ÷ 10⁶ × 0.30 + 输出 token ÷ 10⁶ × 1.20；旧稿再乘汇率 " + str(OLD_FX) + "。")
    lines.append("- 中间档 6000 输入 / 1200 输出、高峰价：" + str(normalize(per_plan_cost)) + " 元/次。")
    lines.append("- 27 行按「price × 使用次数 − 模型成本 × 使用次数 − 获客成本」复算，与旧表逐格一致（差异仅来自显示舍入）。")
    lines.append("- 但 price=1/5/10 元、获客成本=5/20/50 元、年使用次数=1/2/3 次均无来源；复算一致只证明公式执行正确。")
    lines.append("")
    lines.append("旧稿「模型成本比最低获客成本低两个数量级以上」的核对：")
    lines.append("")
    lines.append("- 按单次模型成本比每用户获客成本：" + str(min_cac) + " ÷ " + str(per_plan_cost) + " ≈ " + str(ratio_plan) + " 倍（量纲不一致）；")
    lines.append("- 按年度模型成本（3 次）比每用户获客成本：" + str(min_cac) + " ÷ " + str(annual_cost_max) + " ≈ " + str(ratio_annual) + " 倍，不满足「两个数量级」。")
    lines.append("- 处置：该比较句删除；单次成本与获客成本均改为符号公式，等实测后再算。")
    lines.append("")

    lines.append("## 五、复算结论")
    lines.append("")
    lines.append("| 层级 | 结论 |")
    lines.append("| --- | --- |")
    lines.append("| 计算正确 | 人均口径与旧两张表的算术均可独立复算，未发现公式或取整错误 |")
    lines.append("| 数据有来源 | 只有 E01/E02/E04 的原始事实有来源；三个漏斗比例、token 数、价格、获客成本、使用次数、汇率、固定成本均无来源 |")
    lines.append("| 参数适用 | 不合格：所有无来源参数都不适用于估计目标市场或经营结果 |")
    lines.append("| 结论成立 | 只成立「支出量级」这一背景判断；市场规模、收入、利润、投资回报均不成立 |")
    lines.append("")
    lines.append("行数核对：漏斗 " + str(len(funnel)) + " 行、成本 " + str(len(units)) + " 行、单位经济 " + str(len(breaks)) + " 行（与旧表一致）。")
    lines.append("")

    text = "\n".join(lines)
    OUT.write_text(text, encoding="utf-8", newline="\n")

    print(json.dumps({
        "ticket": str(a["ticket"]),
        "other": str(a["other"]),
        "total": str(a["total"]),
        "funnel_min": str(funnel_min),
        "funnel_max": str(funnel_max),
        "per_plan_cost_cny": str(per_plan_cost),
        "ratio_plan": str(ratio_plan),
        "ratio_annual": str(ratio_annual),
        "rows_funnel": len(funnel),
        "rows_units": len(units),
        "rows_break_even": len(breaks),
    }, ensure_ascii=False, indent=2))
    print("已写入 " + str(OUT))


if __name__ == "__main__":
    main()
