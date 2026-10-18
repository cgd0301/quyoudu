# 问卷统计结果

> **状态：阻塞（原始导出件未通过完整性校验）**
> 接收检查判定：blocked_unreadable；导出件数据行 30；原始文件 SHA-256 `4713c6d1cb2df4564a0a705cf65c1c64630881878ef0f4046f07c5584924a9e7`。
> 阻塞原因：encoding_loss：编码丢失：文件没有非 ASCII 字节，却有 465 段连续 "?"，中文题干与选项疑似在导出时被替换；schema_mismatch：表头缺少 schema 必需字段：Q1、Q2、Q3、Q9、meta_respondent_id、meta_submitted_at、meta_duration_seconds；导出件与受治理问卷不是同一套字段。
> 本文件不包含任何统计数字，也不得被当作“没有需求”“样本为 0”或“付费意愿低”的证据。

## 口径来源

- 题型与清洗规则：`docs/_work/survey/schema.json`（version 1）
- 接收检查报告：`docs/_work/survey/intake/report.md`；机器可读结果：`docs/_work/survey/intake/inventory.json`

## 恢复步骤

1. 从原始表单或工作簿重新导出 **XLSX** 或 **UTF-8 CSV**，确认题干与选项为可读中文。
2. 确认导出字段与 `docs/_work/survey/schema.json` 对齐；不一致时先建立字段映射。
3. 把可读导出件放到 `docs/_work/survey/raw/responses.csv`（不入库），先运行 `pnpm survey:intake` 再运行 `pnpm survey:report`。
