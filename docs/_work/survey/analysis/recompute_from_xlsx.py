"""独立复算：直接从原始 XLSX 重算关键计数，不调用 survey-report / schema。

用途：验证 `docs/_work/survey/report.md` 的关键数字，而不是只验证脚本能跑。
规则（与导入脚本一致，但独立实现）：
- 多选题按分号拆分；“无”选项与具体选项同时出现时，剔除“无”选项；
- 多选题分母 30；单选题分母 30；
- 时长 = 完成时间 − 开始时间（秒）。

运行：
  python docs/_work/survey/analysis/recompute_from_xlsx.py --input "<XLSX>"
输出：
  docs/_work/survey/analysis/recompute.md
"""

from __future__ import annotations

import argparse
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

from openpyxl import load_workbook

NONE_OPTIONS = {
    8: {"以上皆无"},
    9: {"以上均没有"},
    10: {"没有明显影响", "没有遇到相关问题"},
    11: {"目前的方法已经足够好"},
    13: {"以上均没有明显吸引力"},
    14: {"没有明显担忧"},
}
MULTI_COLUMNS = {8: "Q3", 9: "Q4", 10: "Q5", 11: "Q6", 13: "Q8", 14: "Q9"}


def split_multi(value: str) -> list[str]:
    return [item.strip() for item in re.split(r"[;；]", value) if item.strip()]


def count_option(rows: list[list[str]], column: int, option: str) -> int:
    total = 0
    for row in rows:
        selected = split_multi(row[column])
        none = NONE_OPTIONS.get(column, set())
        if any(item in none for item in selected) and any(item not in none for item in selected):
            selected = [item for item in selected if item not in none]
        total += 1 if option in selected else 0
    return total


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()

    workbook = load_workbook(Path(args.input), read_only=True, data_only=True)
    sheet = workbook["Sheet1"]
    rows = [["" if cell is None else str(cell).strip() for cell in row] for row in list(sheet.iter_rows(values_only=True))[1:]]
    if len(rows) != 30:
        raise SystemExit(f"预期 30 行，实际 {len(rows)}")

    durations = []
    for row in rows:
        start = datetime.strptime(row[1], "%Y-%m-%d %H:%M:%S")
        end = datetime.strptime(row[2], "%Y-%m-%d %H:%M:%S")
        durations.append(int((end - start).total_seconds()))

    q7 = Counter(row[12] for row in rows)
    q10 = Counter(row[15] for row in rows)
    any_paid = q10["为一次完整的消费计划支付少量费用"] + q10["为持续使用支付月费"] + q10["为高级功能支付一次性费用"]
    no_personal_pay = q10["只使用免费版本，不愿付费"] + q10["由银行、学校或其他机构提供免费服务"]

    checks = [
        ("Q3 跨城观演", count_option(rows, 8, "跨城演唱会、音乐节或现场演出"), 9),
        ("Q3 旅行", count_option(rows, 8, "旅行"), 22),
        ("Q4 至少 1 项问题", 30 - count_option(rows, 9, "以上均没有"), 22),
        ("Q4 担心影响生活", count_option(rows, 9, "担心消费影响日常生活开支"), 11),
        ("Q4 付款日不足", count_option(rows, 9, "总体资金足够，但某个付款日期前可用资金不足"), 4),
        ("Q5 至少 1 项影响", 30 - count_option(rows, 10, "没有明显影响") - count_option(rows, 10, "没有遇到相关问题"), 22),
        ("Q5 焦虑或犹豫", count_option(rows, 10, "感到焦虑或犹豫"), 17),
        ("Q5 减少其他开支", count_option(rows, 10, "减少其他开支"), 11),
        ("Q5 动用储备", count_option(rows, 10, "动用原本希望保留的储备资金"), 8),
        ("Q6 至少 1 项不足", 30 - count_option(rows, 11, "目前的方法已经足够好"), 26),
        ("Q6 计划变化需重算", count_option(rows, 11, "计划变化时需要重新计算"), 13),
        ("Q6 手工输入", count_option(rows, 11, "需要手动收集和输入太多资料"), 9),
        ("Q6 难比较完整方案", count_option(rows, 11, "难以比较多个完整消费方案"), 8),
        ("Q6 现有方法已够好", count_option(rows, 11, "目前的方法已经足够好"), 4),
        ("Q7 试用前两档", q7.get("一定会尝试", 0) + q7.get("很可能会尝试", 0), 21),
        ("Q8 多方案比较", count_option(rows, 13, "多方案比较： 比较不同门票、交通、住宿组合的费用与付款安排"), 13),
        ("Q8 付款时间轴", count_option(rows, 13, "付款时间轴： 查看每笔费用的付款日期及对应资金需求"), 11),
        ("Q9 隐私", count_option(rows, 14, "个人财务信息的隐私与安全"), 16),
        ("Q10 只用免费版", q10["只使用免费版本，不愿付费"], 12),
        ("Q10 任何付费形式", any_paid, 8),
        ("Q10 不打算个人付费", no_personal_pay, 17),
        ("时长最小值（秒）", min(durations), 21),
        ("时长中位数（秒）", sorted(durations)[14:16], [84, 92]),
        ("时长最大值（秒）", max(durations), 277),
        ("不足 60 秒", sum(1 for value in durations if value < 60), 8),
    ]

    lines = [
        "# 问卷关键数字独立复算（不调用 survey-report）",
        "",
        "> 输入：原始 XLSX（SHA-256 见 `report.md`）；本脚本独立实现分号拆分、\"无\"选项修正与计数，",
        "> 只用于核对 `report.md`，不替代统计表。",
        "",
        "| 检查项 | 独立复算 | report.md | 一致 |",
        "| --- | --- | --- | --- |",
    ]
    failed = 0
    for name, actual, expected in checks:
        same = actual == expected
        failed += 0 if same else 1
        lines.append(f"| {name} | {actual} | {expected} | {'是' if same else '否'} |")
    lines.append("")
    lines.append(f"结论：{len(checks)} 项中 {len(checks) - failed} 项一致，{failed} 项不一致。")
    lines.append("")
    out = Path(__file__).parent / "recompute.md"
    out.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"已写入 {out}：{len(checks) - failed}/{len(checks)} 一致")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
