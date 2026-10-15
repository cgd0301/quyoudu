# 向量预检报告

## 总体

- 向量通过数：152／152
- 断言通过数：1004／1004（跳过 0）
- 运行错误数：0
- 选择器多命中数：0
- 运行错误：无

## 失败分组

共 0 组。

无失败断言。

## 单元核对

- 退出码：0
- T020-01｜l3=11740｜一致｜l3 oracle 为 "11740.000000000000"
- T020-01｜b3=788｜一致｜b3 oracle 为 "788.000000000000"
- T020-01｜h=2 预测 12874.72 取整为 12875｜一致｜forecast_h2 oracle 为 "12874.720000000000"；integer_cents oracle 为 12875
- T020-01｜第3笔一步误差 -300｜一致｜third_one_step_error oracle 为 "-300.000000000000"
- T007-05｜4999.500000000000 得 5000｜一致｜integer_cents oracle 为 5000
- T007-05｜4999.499999999999 得 4999｜一致｜integer_cents oracle 为 4999
- T020-11｜0.1234567890125 得 0.123456789013｜未能核对｜输出中没有 input=0.1234567890125
- T020-11｜-0.1234567890125 得 -0.123456789013｜未能核对｜输出中没有 input=-0.1234567890125
- T020-11｜12874.72 得 12875｜未能核对｜输出中没有 input=12874.72

### 原始输出

```
{
  "T007-05": [
    {
      "input": "4999.500000000000",
      "integer_cents": 5000,
      "rounded_12": "4999.500000000000"
    },
    {
      "input": "4999.499999999999",
      "integer_cents": 4999,
      "rounded_12": "4999.499999999999"
    }
  ],
  "T020-01": {
    "b3": "788.000000000000",
    "forecast_h2": "12874.720000000000",
    "integer_cents": 12875,
    "l3": "11740.000000000000",
    "third_one_step_error": "-300.000000000000"
  },
  "T020-11": [
    {
      "input": "4999.500000000000",
      "integer_cents": 5000,
      "rounded_12": "4999.500000000000"
    },
    {
      "input": "4999.499999999999",
      "integer_cents": 4999,
      "rounded_12": "4999.499999999999"
    }
  ]
}
```

## 约定观察

检查点 180 个，来自 .cache/oracle-out 的 cases 与 vectors。

### nodes[].at

- 出现次数：532；缺失：0；不同取值：48
- 形态：YYYY-MM-DD × 351；YYYY-MM-DDTHH:mm:ss+08:00 × 180；其他 × 1
- 其他原文："2026-09-01 09:00" × 1
- 样例：
  - cases/c00_r019_minimal.json｜final｜"2026-09-01T09:00:00+08:00"
  - cases/c00_r019_minimal.json｜final｜"2026-09-10"
  - vectors/T001-06.json｜final｜"2026-09-01 09:00"

### check_period.start

- 出现次数：180；缺失：0；不同取值：7
- 形态：YYYY-MM-DDTHH:mm:ss+08:00 × 179；其他 × 1
- 其他原文："2026-09-01 09:00" × 1
- 取值："2026-09-01T09:00:00+08:00" × 146；"2026-10-01T09:00:00+08:00" × 26；"2026-09-10T09:00:00+08:00" × 3；"2026-10-01T15:00:00+08:00" × 2；"2026-09-01 09:00" × 1；"2026-09-01T10:30:00+08:00" × 1；"2026-09-11T09:00:00+08:00" × 1
- 样例：
  - cases/c00_r019_minimal.json｜final｜"2026-09-01T09:00:00+08:00"
  - vectors/T001-06.json｜final｜"2026-09-01 09:00"
  - cases/c00_v1_living_not_provided.json｜final｜"2026-09-01T09:00:00+08:00"

### candidates[].plan_version

- 出现次数：253；缺失：0；不同取值：12
- 取值："C01@v1" × 156；"C02@v1" × 43；"C03@v1" × 21；"C04@v1" × 10；"C05@v1" × 10；"C06@v1" × 4；"C07@v1" × 4；"C08@v1" × 1；"C09@v1" × 1；"C10@v1" × 1；"C11@v1" × 1；"C12@v1" × 1
- candidates 缺失或不是数组的检查点：0
- 样例：
  - cases/c00_r019_minimal.json｜final｜"C01@v1"
  - cases/cB_topk.json｜final｜"C02@v1"
  - cases/cB_topk.json｜final｜"C03@v1"

### confirmation.plan_version

- 出现次数：48；缺失：0；不同取值：2
- 取值："C01@v1" × 38；"C02@v1" × 10
- confirmation 为 null：132
- confirmation 缺少：0
- confirmation 不是对象也不是 null：0
- 样例：
  - vectors/T001-07#3.json｜final｜"C01@v1"
  - vectors/T002-05.json｜final｜"C02@v1"
  - vectors/T002-01.json｜final｜"C01@v1"

### 不在前 K 名的候选的 rank

- 出现次数：124；缺失：0；不同取值：1
- 取值：null × 124
- 统计范围：rank 为 null、缺字段，或大于该检查点 optimization.top_k 的数字
- top_k 不是数字的检查点：0
- 样例：
  - cases/cA_gap.json｜final｜candidate_id=C01 rank=null top_k=3
  - cases/cB_topk.json｜final｜candidate_id=C01 rank=null top_k=3
  - cases/cB_topk.json｜final｜candidate_id=C03 rank=null top_k=3

### candidates[].rank（全部）

- 出现次数：253；缺失：0；不同取值：4
- 取值：null × 124；1 × 102；2 × 19；3 × 8
- 样例：
  - cases/c00_r019_minimal.json｜final｜1
  - cases/cA_gap.json｜final｜null
  - cases/cB_topk.json｜final｜2

### candidates[] 的排列顺序

- 候选数大于 1 的检查点：46
- 样例：
  - cases/cB_topk.json｜final｜C01 rank=null，C02 rank=1，C03 rank=null，C04 rank=null，C05 rank=2，C06 rank=3，C07 rank=null
  - cases/cB_v1_two_feasible.json｜final｜C01 rank=null，C02 rank=1，C03 rank=null，C04 rank=null，C05 rank=2，C06 rank=null，C07 rank=null
  - cases/cB_v2_zero_feasible.json｜final｜C01 rank=null，C02 rank=null，C03 rank=null，C04 rank=null，C05 rank=null，C06 rank=null，C07 rank=null

### forecasts

- 键缺失或不是数组：0
- 空数组：164
- 非空：16
- 非空构成：长度 1；status HISTORY_INSUFFICIENT×1 × 7；长度 1；status AVAILABLE×1 × 2；长度 3；status AVAILABLE×2，BACKTEST_INSUFFICIENT×1 × 2；长度 12；status AVAILABLE×12 × 1；长度 1；status INVALID_RESULT×1 × 1；长度 1；status NOT_COMPARABLE×1 × 1；长度 2；status AVAILABLE×1，BACKTEST_INSUFFICIENT×1 × 1；长度 3；status AVAILABLE×3 × 1
- 样例：
  - cases/cB_topk.json｜final｜长度 1；status HISTORY_INSUFFICIENT×1
  - cases/cB_v1_two_feasible.json｜final｜长度 1；status HISTORY_INSUFFICIENT×1
  - cases/cB_v2_zero_feasible.json｜final｜长度 1；status HISTORY_INSUFFICIENT×1
  - vectors/T001-04.json｜final｜长度 1；status HISTORY_INSUFFICIENT×1
  - vectors/T008-05.json｜final｜长度 1；status HISTORY_INSUFFICIENT×1
  - vectors/T010-07.json｜final｜长度 1；status HISTORY_INSUFFICIENT×1
  - vectors/T011-05.json｜final｜长度 1；status AVAILABLE×1
  - vectors/T020-02.json｜final｜长度 12；status AVAILABLE×12
  - vectors/T020-05.json｜final｜长度 3；status AVAILABLE×2，BACKTEST_INSUFFICIENT×1
  - vectors/T020-06.json｜final｜长度 3；status AVAILABLE×2，BACKTEST_INSUFFICIENT×1
  - vectors/T020-07#1.json｜final｜长度 1；status NOT_COMPARABLE×1
  - vectors/T020-07#2.json｜final｜长度 1；status INVALID_RESULT×1
  - vectors/T020-09.json｜final｜长度 1；status AVAILABLE×1
  - vectors/T020-10#1.json｜final｜长度 1；status HISTORY_INSUFFICIENT×1
  - vectors/T020-10#2.json｜final｜长度 2；status AVAILABLE×1，BACKTEST_INSUFFICIENT×1
  - vectors/T020-12.json｜final｜长度 3；status AVAILABLE×3

### scenarios

- 键缺失或不是数组：0
- 空数组：0
- 非空：180
- 非空构成：长度 2；CONFIRMED_ONLY available=true，RECENT_MONTH available=false × 169；长度 2；CONFIRMED_ONLY available=true，RECENT_MONTH available=true × 11
- 非空位置共 180 处，下列 3 处
- 样例：
  - cases/c00_r019_minimal.json｜final｜长度 2；CONFIRMED_ONLY available=true，RECENT_MONTH available=false
  - vectors/T002-04.json｜final｜长度 2；CONFIRMED_ONLY available=true，RECENT_MONTH available=true
  - cases/c00_v1_living_not_provided.json｜final｜长度 2；CONFIRMED_ONLY available=true，RECENT_MONTH available=false

### labels 是否含 SIMULATED_DATA

- 含 SIMULATED_DATA：180
- 不含 SIMULATED_DATA：0
- labels 缺失或不是数组：0
- 样例（含）：
  - cases/c00_r019_minimal.json｜final｜["SIMULATED_DATA","TOP_K_DEMO","HISTORY_INSUFFICIENT","DAILY_DISCLAIMER"]
  - cases/c00_v1_living_not_provided.json｜final｜["SIMULATED_DATA","TOP_K_DEMO","HISTORY_INSUFFICIENT","LIVING_ARRANGEMENT_MISSING"]
  - cases/c01_base.json｜final｜["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT"]
- 样例（不含）：
  - 无

### labels 取值

- 出现次数：180；缺失：0；不同取值：18
- 取值：["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT"] × 101；["SIMULATED_DATA","TOP_K_DEMO","HISTORY_INSUFFICIENT","DAILY_DISCLAIMER"] × 25；["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT","PROTECTED_SQUEEZE"] × 12；["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED"] × 9；["SIMULATED_DATA","TOP_K_DEMO","HISTORY_INSUFFICIENT","PRE_RANGE_PAID","DAILY_DISCLAIMER"] × 5；["SIMULATED_DATA","TOP_K_DEMO","HISTORY_INSUFFICIENT","PROTECTED_SQUEEZE"] × 4；["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT","FORECAST_DISCLAIMER","FORECAST_UNAVAILABLE","SAME_PRICE"] × 3；["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT","PRE_RANGE_PAID"] × 3；["SIMULATED_DATA","TOP_K_DEMO","HISTORY_INSUFFICIENT","LIVING_ARRANGEMENT_MISSING"] × 3；["SIMULATED_DATA","TOP_K_DEMO","HISTORY_INSUFFICIENT"] × 3；["SIMULATED_DATA","TOP_K_DEMO","DAILY_DISCLAIMER"] × 2；["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT","FORECAST_DISCLAIMER"] × 2；["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT","FORECAST_UNAVAILABLE"] × 2；["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT","SAME_PRICE"] × 2；["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT","FORECAST_DISCLAIMER","SAME_PRICE"] × 1；["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT","NEED_RECONFIRM"] × 1；["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT","SAME_PRICE","PRE_RANGE_PAID"] × 1；["SIMULATED_DATA","TOP_K_DEMO","HISTORY_INSUFFICIENT","FORECAST_DISCLAIMER","DAILY_DISCLAIMER"] × 1
- 样例：
  - cases/c00_r019_minimal.json｜final｜["SIMULATED_DATA","TOP_K_DEMO","HISTORY_INSUFFICIENT","DAILY_DISCLAIMER"]
  - cases/c00_v1_living_not_provided.json｜final｜["SIMULATED_DATA","TOP_K_DEMO","HISTORY_INSUFFICIENT","LIVING_ARRANGEMENT_MISSING"]
  - cases/c01_base.json｜final｜["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT"]
