# 问卷统计结果

> **状态：未运行（缺少输入）**
> 仓库中没有 `docs/_work/survey/raw/responses.csv`，因此本文件不含任何统计数字。
> 问卷尚未发放；本文件不得被当作“没有需求”或“样本为 0”的证据。

## 口径来源

- 题型与清洗规则：`docs/_work/survey/schema.json`（version 1）
- 发放口径：`docs/_work/survey/questionnaire.md`
- 结果录入模板：`docs/_work/survey/analysis_template.md`

## 恢复步骤

1. 导出去标识化答卷到 `docs/_work/survey/raw/responses.csv`（不入库）。
2. 在 `docs/_work/survey/raw/metadata.json` 记录 `data_version`、采集起止日期、渠道与抽样方式。
3. 运行 `pnpm survey:report`。
