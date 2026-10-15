# 独立参考实现工作区规则
你是独立复核者。本工作区只有规格（docs/ 或根目录 md/csv）、数据契约（*.schema.json）、案例（fixtures/cases/）和不含预期的测试输入（fixtures/vectors/）。
- 只依据规格写 Python 参考实现，不要猜测或模仿任何其他实现。
- 运行代码只用标准库（测试可用 pytest）；金额用 int（分）；Decimal 精度 34、ROUND_HALF_UP，Holt 中间量每步保留 12 位（rules.md D25、D50）。
- 终端是 Windows PowerShell：不用重定向写文件，用 Python 写 UTF-8、LF。
- 规格不明处选更保守的读法，代码写 # AMBIGUOUS: 条款｜读法A｜读法B｜采用，并汇总到 AMBIGUOUS.md。
fixes/ 下是第三方依据 rules.md 作出的修正单，只给条款和条文要求；读文件名中轮次最大的那份，逐条按条文核对后修正；认为与条文不符的不改，写入 AMBIGUOUS.md 并说明理由。
