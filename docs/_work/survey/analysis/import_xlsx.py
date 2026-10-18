"""从线上表单 XLSX 生成脱敏分析数据（只读原始文件，不写回、不复制原始行）。

用法：
  python docs/_work/survey/analysis/import_xlsx.py \
      --input "<原始 XLSX 路径>" \
      --out docs/_work/survey/analysis

输出：
- responses.csv：脱敏分析数据（无邮箱、无姓名、无精确时间戳，只有日期与时长）
- cleaning_log.json：清洗规则、剔除/修正记录、列与选项校验结果

规则（先定义、后执行）：
1. 只取 10 道题 + 时长；身份列（电子邮件、名称）不进入分析数据，只统计非空数与唯一值数；
2. 多选题按分号拆分并去空白；出现“无”选项（以上皆无/以上均没有/没有明显影响/
   没有遇到相关问题/目前的方法已经足够好/没有明显担忧/以上均没有明显吸引力）
   且同时选了其他选项时，剔除该“无”选项，保留其他选择，并记录行号与题号；
3. 选项不在题目选项清单内 → 报错停止，不做猜测；
4. 时长 = 完成时间 − 开始时间（秒，整数）；不设 60 秒剔除门槛（该门槛属于旧设计稿，
   实际表单 10 题、以点选为主，最快 21 秒；<60 秒只做敏感性分析，不剔除）；
5. 同一人多次提交无法识别：不生成、不推断应答编号；R01—R30 只是行号重命名。
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime
from pathlib import Path

from openpyxl import load_workbook

EXPECTED_HEADERS = [
    "Id",
    "开始时间",
    "完成时间",
    "电子邮件",
    "名称",
    "语言",
    "您的年龄是？",
    "你的主要居住地区是？",
    "过去 12 个月，你是否有过以下消费经历？",
    " 过去 12 个月，你曾遇到哪些资金规划问题？",
    "这些问题对你造成过什么影响？",
    "你认为目前使用的资金规划方式有什么不足？",
    "如果趣有度可以免费试用，你未来 3 个月使用它的可能性有多大？",
    "以下哪些功能对你最有帮助？",
    "使用这类工具时，你最在意或担心什么？",
    "你最能接受哪种使用或付费方式？",
]

QUESTIONS = [
    {
        "id": "Q1",
        "column": 6,
        "label": "您的年龄是？",
        "type": "single",
        "options": ["<18", "18-20", "21-23", "24-26", ">30"],
    },
    {
        "id": "Q2",
        "column": 7,
        "label": "你的主要居住地区是？",
        "type": "single",
        "options": ["中国香港", "中国内地"],
    },
    {
        "id": "Q3",
        "column": 8,
        "label": "过去 12 个月，你是否有过以下消费经历？",
        "type": "multi",
        "none": ["以上皆无"],
        "options": [
            "旅行",
            "购买较昂贵的电子产品或其他商品",
            "跨城演唱会、音乐节或现场演出",
            "跨城体育赛事或大型活动",
            "以上皆无",
        ],
    },
    {
        "id": "Q4",
        "column": 9,
        "label": "过去 12 个月，你曾遇到哪些资金规划问题？",
        "type": "multi",
        "none": ["以上均没有"],
        "options": [
            "总费用超出预算",
            "忘记或低估后续费用",
            "担心消费影响日常生活开支",
            "因不确定是否负担得起而推迟或放弃计划",
            "难以比较不同方案的总成本",
            "总体资金足够，但某个付款日期前可用资金不足",
            "以上均没有",
        ],
    },
    {
        "id": "Q5",
        "column": 10,
        "label": "这些问题对你造成过什么影响？",
        "type": "multi",
        "none": ["没有明显影响", "没有遇到相关问题"],
        "options": [
            "花费额外时间计算和核对",
            "感到焦虑或犹豫",
            "临时修改或取消计划",
            "减少其他开支",
            "动用原本希望保留的储备资金",
            "没有明显影响",
            "没有遇到相关问题",
        ],
    },
    {
        "id": "Q6",
        "column": 11,
        "label": "你认为目前使用的资金规划方式有什么不足？",
        "type": "multi",
        "none": ["目前的方法已经足够好"],
        "options": [
            "需要手动收集和输入太多资料",
            "难以掌握每笔费用的付款日期",
            "难以比较多个完整消费方案",
            "无法清楚区分可消费资金与必要储备",
            "计划变化时需要重新计算",
            "目前的方法已经足够好",
            "没有固定的规划方式",
        ],
    },
    {
        "id": "Q7",
        "column": 12,
        "label": "如果趣有度可以免费试用，你未来 3 个月使用它的可能性有多大？",
        "type": "single",
        "options": ["一定不会", "不太可能", "不确定", "很可能会尝试", "一定会尝试"],
    },
    {
        "id": "Q8",
        "column": 13,
        "label": "以下哪些功能对你最有帮助？",
        "type": "multi",
        "none": ["以上均没有明显吸引力"],
        "options": [
            "付款时间轴： 查看每笔费用的付款日期及对应资金需求",
            "必要资金保护： 保留日常生活费及指定储备资金",
            "资金缺口预警： 提前发现某个时间点可能出现的资金不足",
            "多方案比较： 比较不同门票、交通、住宿组合的费用与付款安排",
            "行动清单： 提示下一步需要确认或处理的事项",
            "情景模拟： 测试收入延迟或费用增加后的影响",
            "不确定费用提示： 标记尚未确认的费用及其影响",
            "以上均没有明显吸引力",
        ],
    },
    {
        "id": "Q9",
        "column": 14,
        "label": "使用这类工具时，你最在意或担心什么？",
        "type": "multi",
        "none": ["没有明显担忧"],
        "options": [
            "个人财务信息的隐私与安全",
            "计算结果是否准确",
            "是否遗漏费用或给出过于乐观的判断",
            "输入资料是否太麻烦",
            "结果是否容易理解",
            "不希望工具影响自己的消费决定",
            "没有明显担忧",
        ],
    },
    {
        "id": "Q10",
        "column": 15,
        "label": "你最能接受哪种使用或付费方式？",
        "type": "single",
        "options": [
            "只使用免费版本，不愿付费",
            "由银行、学校或其他机构提供免费服务",
            "为一次完整的消费计划支付少量费用",
            "为持续使用支付月费",
            "为高级功能支付一次性费用",
            "视实际功能和效果而定",
            "暂时无法判断",
        ],
    },
]

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
URL = re.compile(r"https?://\S+", re.I)
MULTI_SPLIT = re.compile(r"[;；]")


def split_multi(value: str) -> list[str]:
    return [item.strip() for item in MULTI_SPLIT.split(value) if item.strip()]


def parse_time(value: str) -> datetime:
    text = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    raise ValueError(f"无法解析时间：{text!r}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="原始 XLSX 路径（只读）")
    parser.add_argument("--out", default="docs/_work/survey/analysis")
    args = parser.parse_args()

    source = Path(args.input)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    workbook = load_workbook(source, read_only=True, data_only=True)
    if workbook.sheetnames != ["Sheet1"]:
        raise SystemExit(f"预期只有一个 Sheet1，实际为 {workbook.sheetnames}")
    sheet = workbook["Sheet1"]
    rows = list(sheet.iter_rows(values_only=True))
    header = [("" if value is None else str(value).strip()) for value in rows[0]]
    if header != [item.strip() for item in EXPECTED_HEADERS]:
        raise SystemExit("表头与预期不一致；拒绝猜测字段含义")
    data = [["" if cell is None else str(cell).strip() for cell in row] for row in rows[1:]]
    if len(data) != 30:
        raise SystemExit(f"预期 30 条提交，实际 {len(data)} 条")

    cleaned_none: list[dict[str, str | int]] = []
    unknown_options: list[dict[str, str]] = []
    pii_hits = 0
    durations: list[int] = []
    output_rows: list[dict[str, str]] = []

    for index, row in enumerate(data, start=1):
        key = f"R{index:02d}"
        started = parse_time(row[1])
        finished = parse_time(row[2])
        duration = int((finished - started).total_seconds())
        if duration < 0:
            raise SystemExit(f"{key} 完成时间早于开始时间")
        durations.append(duration)

        values: dict[str, str] = {
            "meta_response_key": key,
            "meta_submitted_date": started.strftime("%Y-%m-%d"),
            "meta_duration_seconds": str(duration),
        }
        for question in QUESTIONS:
            raw = row[question["column"]]
            if question["type"] == "single":
                if raw not in question["options"]:
                    unknown_options.append({"row": key, "question": question["id"], "value": raw})
                    continue
                values[question["id"]] = raw
            else:
                selected = split_multi(raw)
                for item in selected:
                    if item not in question["options"]:
                        unknown_options.append({"row": key, "question": question["id"], "value": item})
                bad = [item for item in selected if item not in question["options"]]
                if bad:
                    continue
                if any(item in question.get("none", []) for item in selected) and any(
                    item not in question.get("none", []) for item in selected
                ):
                    kept = [item for item in selected if item not in question.get("none", [])]
                    cleaned_none.append(
                        {"row": key, "question": question["id"], "dropped": "；".join(sorted(set(selected) & set(question.get("none", []))))}
                    )
                    selected = kept
                values[question["id"]] = ";".join(selected)

        for cell in row:
            if EMAIL.search(cell) or PHONE.search(cell) or URL.search(cell):
                pii_hits += 1
        output_rows.append(values)

    if unknown_options:
        print(json.dumps(unknown_options[:10], ensure_ascii=False, indent=2))
        raise SystemExit("存在不在选项清单内的取值；停止，不猜测")

    fieldnames = ["meta_response_key", "meta_submitted_date", "meta_duration_seconds"] + [q["id"] for q in QUESTIONS]
    with (out_dir / "responses.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        for row in output_rows:
            writer.writerow(row)

    log = {
        "source_file": source.name,
        "source_bytes": source.stat().st_size,
        "submissions": len(data),
        "questions": len(QUESTIONS),
        "duration_seconds": {
            "min": min(durations),
            "median": sorted(durations)[len(durations) // 2 - 1 : len(durations) // 2 + 1],
            "max": max(durations),
            "under_60": sum(1 for value in durations if value < 60),
            "under_30": sum(1 for value in durations if value < 30),
        },
        "identity_columns": {
            "email_nonempty": sum(1 for row in data if row[3]),
            "email_distinct": len({row[3] for row in data if row[3]}),
            "name_nonempty": sum(1 for row in data if row[4]),
            "note": "身份列不进入分析数据，也未读取具体值",
        },
        "pii_hits_in_all_cells": pii_hits,
        "none_option_cleaned": cleaned_none,
        "unknown_options": unknown_options,
        "rules": [
            "多选题按分号拆分；‘无’选项与其他选项同时出现时剔除‘无’选项并记录",
            "选项不在清单内即停止，不猜测",
            "身份列（电子邮件、名称）不进入分析数据",
            "时长由完成时间减开始时间计算；不设 60 秒剔除门槛，<60 秒只做敏感性分析",
            "R01—R30 只是行号重命名，不是身份编号，不能用于确认独立受访者",
        ],
    }
    (out_dir / "cleaning_log.json").write_text(json.dumps(log, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(
        f"已写入 {out_dir/'responses.csv'} 与 cleaning_log.json："
        f"{len(data)} 条、{len(QUESTIONS)} 题、剔除‘无’选项 {len(cleaned_none)} 处、"
        f"PII 命中 {pii_hits}、时长 {min(durations)}—{max(durations)} 秒"
    )


if __name__ == "__main__":
    main()
