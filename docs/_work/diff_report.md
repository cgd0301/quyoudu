警告：oracle 输入与记录指纹不一致：docs/rules.md

# 引擎与参考实现对拍

## 总体

案例 10，向量 152，检查点 TS 180 / oracle 180
差异 合计 0（P1 0，P2 0，P3 0）
运行失败 0

## 来源与版本

- 生成命令：`pnpm diff:oracle`
- 代码提交：`2372914`（2026-10-18T14:27:50+08:00，提交时间）
- 运行环境：Node v24.17.0；pnpm 12.11.2；Python 3.11.9
- 比较对象：fixtures/cases 与 fixtures/vectors 的检查点；参考实现只经 `python -m oracle` 调用，输出读 `.cache/oracle-out`，未打开 `oracle/` 源码（AGENTS.md §3）

## P1 演示案例

无

## P2 向量中未被断言的字段

无

## P3 其余

无
