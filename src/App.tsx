import { useMemo, useState, type FormEvent } from 'react'
import ReactECharts from 'echarts-for-react'
import caseSource from '../fixtures/cases/cB_topk.json?raw'
import { DEMO_CFG_1 } from './engine/config.ts'
import { evaluate } from './engine/evaluate.ts'
import type { Op } from './engine/ops/schema.ts'
import { formatCents } from './engine/money/format.ts'
import { LABEL_TEXT, type ResultCore } from './engine/result.ts'
import type { CaseFile } from './engine/schema.ts'
import { dailyReasonText, dailyValueText } from './ui/dailyText.ts'
import './App.css'

const demoCase = JSON.parse(caseSource) as CaseFile

type PageId = 'overview' | 'compare' | 'calendar' | 'manage'
type AdjustmentId = 'delay' | 'living' | 'payment' | 'allocation' | 'spend'

const pages: { id: PageId; label: string; mark: string }[] = [
  { id: 'overview', label: '目标概览', mark: '◎' },
  { id: 'compare', label: '方案比较', mark: '↗' },
  { id: 'calendar', label: '资金日历', mark: '▦' },
  { id: 'manage', label: '计划管理', mark: '≡' },
]

const adjustments: { id: AdjustmentId; label: string }[] = [
  { id: 'delay', label: '收入延期' },
  { id: 'living', label: '新增生活支出' },
  { id: 'payment', label: '付款日期' },
  { id: 'allocation', label: '分配额' },
  { id: 'spend', label: '当日消费' },
]

const categoryNames: Record<string, string> = {
  TICKET: '演出票',
  LODGING: '住宿',
  'TRAIN-OUT': '去程交通',
  'TRAIN-BACK': '返程交通',
  MEALS: '餐饮',
  LOCAL: '当地交通',
  SERVICE_FEE: '服务费',
  OPTIONAL_PURCHASE: '自选项目',
}

function moneyText(value: number | null | undefined): string {
  return value == null ? '待确认' : `${formatCents(value)} 元`
}

function shortDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${year}.${month}.${day}`
}

function longDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}

function parseMoneyInput(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (match === null) return null
  const yuan = Number(match[1])
  const fen = Number((match[2] ?? '').padEnd(2, '0'))
  const cents = yuan * 100 + fen
  return Number.isSafeInteger(cents) ? cents : null
}

function planStateText(state: ResultCore['states']['planState']): string {
  switch (state) {
    case 'INCOMPLETE':
      return '暂无法完整判断'
    case 'PAYMENT_GAP':
      return '发现付款缺口'
    case 'CONSTRAINT_ISSUE':
      return '存在约束问题'
    case 'FEASIBLE_UNDER_ASSUMPTIONS':
      return '按当前假设可行'
    case 'PAUSED':
      return '已暂停'
    case 'CANCELLED':
      return '已取消'
  }
}

function confirmationText(state: ResultCore['states']['confirmationState']): string {
  switch (state) {
    case 'NOT_SELECTED':
      return '未选择'
    case 'PENDING_CONFIRMATION':
      return '待用户确认'
    case 'CONFIRMED':
      return '已确认'
    case 'DRAFT':
      return '草案'
  }
}

function verdictText(verdict: ResultCore['nodes'][number]['nodeVerdict']): string {
  switch (verdict) {
    case 'PASS':
      return '通过'
    case 'PROTECTED_SHORTFALL':
    case 'PAYMENT_SHORTFALL':
    case 'GAP_CONTINUED':
      return '资金缺口'
    case 'ALLOCATION_CONFLICT':
    case 'CONFLICT_CONTINUED':
      return '分配冲突'
  }
}

function candidateReason(code: string): string {
  switch (code) {
    case 'PAYMENT_GAP':
      return '付款节点无法通过资金检查'
    case 'ARRIVAL_TOO_LATE':
      return '去程到达时间不满足演出要求'
    case 'OFFER_NOT_STACKABLE':
      return '所选优惠不能在同一订单叠加'
    default:
      return code
  }
}

/** 每日参考的文案与取值规则见 src/ui/dailyText.ts（由单元测试覆盖） */

/** D13 的五档价格依据，逐档给文案；不把未知档位一律写成“模拟报价” */
const PRICE_BASIS_TEXT: Record<string, string> = {
  QUOTE: '有效期内报价',
  FORECAST: '已确认的预测估算',
  REFERENCE: '有效参考价，估算',
  UNDATED_QUOTE: '有效期未知的报价',
  PENDING: '待填，未估价',
}

function priceBasisText(basis: string): string {
  return PRICE_BASIS_TEXT[basis] ?? basis
}

/** R017 第7条、D82：本版任务状态恒为待购买，界面按中文显示，不直接暴露枚举 */
const TASK_STATE_TEXT: Record<ResultCore['actionList'][number]['taskState'], string> = {
  PENDING_PURCHASE: '待购买',
  PURCHASED: '已购买',
  PAID: '已付款',
}

/** §9.4 的依赖种类 */
const DEPENDENCY_TEXT: Record<ResultCore['dependencies'][number]['kind'], string> = {
  EXPECTED_INCOME: '预计收入',
  EXPECTED_RETURN: '预计返还',
  CONFIRMED_FORECAST: '已确认的预测估算',
  ESTIMATE: '估算费用',
}

/** 预测状态的中文（D80 的判定优先级决定只会出现其中一种） */
const FORECAST_STATUS_TEXT: Record<NonNullable<ResultCore['forecasts']>[number]['status'], string> = {
  AVAILABLE: '可用预测',
  BACKTEST_INSUFFICIENT: '回测不足',
  HISTORY_INSUFFICIENT: LABEL_TEXT.HISTORY_INSUFFICIENT,
  NOT_COMPARABLE: '不可比',
  FIT_FAILED: '拟合失败',
  INVALID_RESULT: '结果无效',
  CONFIG_NOT_FROZEN: LABEL_TEXT.FORECAST_CONFIG_NOT_FROZEN,
}

function eventName(kind: string): string {
  switch (kind) {
    case 'INCOME':
      return '预计收入'
    case 'OTHER_EXPENSE':
      return '生活支出'
    case 'GOAL_PAYMENT':
      return '目标付款'
    case 'RETURN':
      return '预计返还'
    default:
      return '资金安排'
  }
}

function App() {
  const [activePage, setActivePage] = useState<PageId>('overview')
  const [activeAdjustment, setActiveAdjustment] = useState<AdjustmentId>('delay')
  const [ops, setOps] = useState<Op[]>([])
  const [incomeEventId, setIncomeEventId] = useState(
    demoCase.events.find((event) => event.event_kind === 'INCOME')?.event_id ?? '',
  )
  const [delayDate, setDelayDate] = useState('2026-11-20')
  const [expenseDate, setExpenseDate] = useState('2026-09-10')
  const [expenseAmount, setExpenseAmount] = useState('200.00')
  const [coverMode, setCoverMode] = useState<'NEW_RESERVE' | 'EXISTING_RESERVE'>('NEW_RESERVE')
  const [reserveId, setReserveId] = useState(
    demoCase.reserves.find((reserve) => reserve.reserve_kind === 'LIVING')?.reserve_id ?? '',
  )
  const [paymentWindowId, setPaymentWindowId] = useState('')
  const [allocationAmount, setAllocationAmount] = useState('0.00')
  const [todaySpendAmount, setTodaySpendAmount] = useState('40.00')
  const [formError, setFormError] = useState('')

  const result = useMemo(() => {
    const output = evaluate(demoCase, ops, DEMO_CFG_1)
    return output.checkpoints[output.checkpoints.length - 1]!.result
  }, [ops])

  const selectedId = [...ops].reverse().find((op) => op.type === 'SELECT_CANDIDATE' || op.type === 'CONFIRM')
  const selectedCandidateId = selectedId?.type === 'SELECT_CANDIDATE' || selectedId?.type === 'CONFIRM'
    ? selectedId.candidate_id
    : null
  const selectedCandidate = demoCase.candidates.find((candidate) => candidate.candidate_id === selectedCandidateId) ?? null
  const selectedResult = result.candidates.find((candidate) => candidate.candidateId === selectedCandidateId) ?? null
  const isConfirmed = result.states.confirmationState === 'CONFIRMED'
  const isPaused = result.states.planState === 'PAUSED'
  const isCancelled = result.states.planState === 'CANCELLED'
  const availableIncome = demoCase.events.filter((event) => event.event_kind === 'INCOME' && event.event_status === 'EXPECTED')
  const livingReserves = demoCase.reserves.filter((reserve) => reserve.reserve_kind === 'LIVING')
  const currentLivingReserve = livingReserves.find(
    (reserve) => reserve.coverage_start === demoCase.snapshot.as_of.slice(0, 10),
  )
  const tutoringIncome = availableIncome.find((event) => event.event_id === 'E-INC-1020')
  const paymentWindows = selectedCandidate?.items.flatMap((item) =>
    (item.payment_windows ?? []).map((window) => ({
      id: window.window_id,
      item: categoryNames[item.cost_item_id] ?? item.cost_item_id,
      date: window.payment_at,
    })),
  ) ?? []

  const rankedCandidates = result.candidates
    .filter((candidate) => candidate.feasible && candidate.rank !== null)
  const selectedItems = selectedCandidate?.items ?? []
  const confirmedItemNames = new Map(
    selectedItems.map((item) => [item.cost_item_id, categoryNames[item.cost_item_id] ?? item.cost_item_id]),
  )

  const cashChartOption = useMemo(() => ({
    animationDuration: 360,
    grid: { left: 56, right: 18, top: 28, bottom: 30 },
    legend: {
      top: 0,
      right: 18,
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: '#65746e', fontFamily: 'inherit', fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#18312b',
      borderWidth: 0,
      textStyle: { color: '#ffffff', fontFamily: 'inherit', fontSize: 12 },
      valueFormatter: (value: number) => `${formatCents(Math.round(value))} 元`,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: result.nodes.map((node) => shortDate(node.at)),
      axisLine: { lineStyle: { color: '#dce6e1' } },
      axisTick: { show: false },
      axisLabel: { color: '#8b9691', fontFamily: 'inherit', fontSize: 10, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#8b9691',
        fontFamily: 'inherit',
        fontSize: 10,
        formatter: (value: number) => formatCents(Math.round(value)),
      },
      splitLine: { lineStyle: { color: '#edf2ef', type: 'dashed' } },
    },
    series: [
      {
        name: '现金',
        type: 'line',
        data: result.nodes.map((node) => node.cash?.value ?? null),
        symbol: 'circle',
        symbolSize: 5,
        smooth: 0.18,
        lineStyle: { width: 2.5, color: '#167a67' },
        itemStyle: { color: '#167a67', borderColor: '#ffffff', borderWidth: 2 },
        areaStyle: { color: 'rgba(22, 122, 103, 0.08)' },
      },
      {
        name: '保护性预留',
        type: 'line',
        data: result.nodes.map((node) => node.protectedTotal?.value ?? null),
        symbol: 'none',
        smooth: 0.18,
        lineStyle: { width: 2, color: '#dfa343', type: 'dashed' },
      },
    ],
  }), [result.nodes])

  const timelineRows = useMemo(() => {
    const rows: {
      id: string
      date: string
      title: string
      detail: string
      amount: number | null
      kind: 'income' | 'expense' | 'purchase' | 'payment'
      verdict: string
    }[] = []

    for (const node of result.nodes) {
      for (const eventId of node.trigger.eventIds) {
        const baseEvent = demoCase.events.find((event) => event.event_id === eventId)
        const addedLiving = ops.find((op) => op.type === 'ADD_LIVING_EXPENSE' && op.event_id === eventId)
        const addedSpend = ops.find((op) => op.type === 'ADD_TODAY_SPEND' && op.event_id === eventId)
        const plannedItem = selectedCandidate?.items.find((item, index) =>
          eventId === `PLAN:${selectedCandidate.candidate_id}:${index}:${item.cost_item_id}`,
        )

        if (plannedItem !== undefined) {
          rows.push({
            id: eventId,
            date: node.at.slice(0, 10),
            title: `${categoryNames[plannedItem.cost_item_id] ?? plannedItem.cost_item_id}付款`,
            detail: `${plannedItem.channel} · ${plannedItem.spec}`,
            amount: plannedItem.price,
            kind: 'payment',
            verdict: verdictText(node.nodeVerdict),
          })
          continue
        }

        if (baseEvent !== undefined) {
          rows.push({
            id: eventId,
            date: node.at.slice(0, 10),
            title: eventName(baseEvent.event_kind),
            detail: baseEvent.event_status === 'ACTUAL' ? '已计入模拟快照' : '预计安排',
            amount: baseEvent.amount,
            kind: baseEvent.event_kind === 'INCOME' ? 'income' : 'expense',
            verdict: verdictText(node.nodeVerdict),
          })
          continue
        }

        if (addedLiving?.type === 'ADD_LIVING_EXPENSE') {
          rows.push({
            id: eventId,
            date: node.at.slice(0, 10),
            title: '生活支出',
            detail: addedLiving.cover_mode === 'NEW_RESERVE' ? '新增生活预留' : `由 ${addedLiving.reserve_id} 覆盖`,
            amount: addedLiving.amount,
            kind: 'expense',
            verdict: verdictText(node.nodeVerdict),
          })
          continue
        }

        if (addedSpend?.type === 'ADD_TODAY_SPEND') {
          rows.push({
            id: eventId,
            date: node.at.slice(0, 10),
            title: '当日消费',
            detail: '已计入当前模拟时点',
            amount: addedSpend.amount,
            kind: 'expense',
            verdict: verdictText(node.nodeVerdict),
          })
        }
      }
    }

    selectedCandidate?.items.forEach((item, index) => {
      rows.push({
        id: `purchase:${selectedCandidate.candidate_id}:${index}`,
        date: item.purchase_date,
        title: `${categoryNames[item.cost_item_id] ?? item.cost_item_id}购买日`,
        detail: `${item.channel} · ${item.spec}`,
        amount: null,
        kind: 'purchase',
        verdict: isConfirmed ? '已确认' : '预览，未确认',
      })
    })

    return rows.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
  }, [isConfirmed, ops, result.nodes, selectedCandidate])

  function appendOp(op: Op): void {
    setOps((current) => [...current, op])
    setFormError('')
  }

  function selectCandidate(candidateId: string): void {
    appendOp({ type: 'SELECT_CANDIDATE', candidate_id: candidateId })
  }

  function confirmCandidate(): void {
    if (selectedResult === null || selectedCandidateId === null || result.confirmation === null) return
    appendOp({
      type: 'CONFIRM',
      candidate_id: selectedCandidateId,
      plan_version: selectedResult.planVersion,
      input_version: result.inputVersion,
    })
  }

  function submitAdjustment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setFormError('')

    if (activeAdjustment === 'delay') {
      if (incomeEventId === '' || delayDate === '') {
        setFormError('请选择预计收入并填写新日期')
        return
      }
      appendOp({ type: 'DELAY_INCOME', event_id: incomeEventId, expected_at: delayDate })
      return
    }

    if (activeAdjustment === 'living') {
      const amount = parseMoneyInput(expenseAmount)
      if (amount === null || expenseDate === '' || (coverMode === 'EXISTING_RESERVE' && reserveId === '')) {
        setFormError('请检查金额、日期和预留项目')
        return
      }
      const sequence = ops.length + 1
      appendOp({
        type: 'ADD_LIVING_EXPENSE',
        event_id: `UI-LIVING-${sequence}`,
        expected_at: expenseDate,
        amount,
        cover_mode: coverMode,
        reserve_id: coverMode === 'NEW_RESERVE' ? `R-UI-${sequence}` : reserveId,
        category: 'MEALS',
      })
      return
    }

    if (activeAdjustment === 'payment') {
      if (paymentWindowId === '') {
        setFormError('当前方案没有可用的付款窗口')
        return
      }
      appendOp({ type: 'CHANGE_PAYMENT_DATE', window_id: paymentWindowId })
      return
    }

    if (activeAdjustment === 'allocation') {
      const amount = parseMoneyInput(allocationAmount)
      if (amount === null) {
        setFormError('请输入最多两位小数的金额')
        return
      }
      appendOp({ type: 'SET_ALLOCATION', goal_allocation: amount })
      return
    }

    const amount = parseMoneyInput(todaySpendAmount)
    if (amount === null) {
      setFormError('请输入最多两位小数的金额')
      return
    }
    appendOp({
      type: 'ADD_TODAY_SPEND',
      event_id: `UI-TODAY-${ops.length + 1}`,
      amount,
      actual_at: demoCase.snapshot.as_of,
      coverage: [],
    })
  }

  const title = demoCase.goal.name?.replace(/资金$/, '') ?? '演出计划'
  const budget = demoCase.goal.budget_cap
  const cash = demoCase.snapshot.cash
  const lowestCandidate = rankedCandidates[0]
  const currentPage = pages.find((page) => page.id === activePage)!
  const dailyReason = dailyReasonText(result.dailyReference)
  const disabledPlanControl = !isConfirmed || isCancelled

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setActivePage('overview') }}>
          <span className="brand-mark" aria-hidden="true">趣</span>
          <span className="brand-name">趣有度</span>
        </a>

        <div className="sidebar-caption">计划空间</div>
        <nav className="primary-nav" aria-label="计划导航">
          {pages.map((page, index) => (
            <button
              className={`nav-item${activePage === page.id ? ' is-active' : ''}`}
              key={page.id}
              type="button"
              aria-current={activePage === page.id ? 'page' : undefined}
              onClick={() => setActivePage(page.id)}
            >
              <span className="nav-mark" aria-hidden="true">{page.mark}</span>
              <span>{page.label}</span>
              {index === 1 && <span className="nav-count">{rankedCandidates.length}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-divider" />
          <div className="sidebar-project">
            <span className="project-indicator" />
            <span className="sidebar-project-copy">
              <strong>{title}</strong>
              <small>{shortDate(demoCase.goal.show_start_at)}</small>
            </span>
            <span className="project-status" aria-label={planStateText(result.states.planState)} />
          </div>
          <div className="sidebar-version">输入版本 {result.inputVersion}</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-context">
            <span className="context-dot" />
            <span>个人计划</span>
            <span className="context-divider">/</span>
            <span className="context-current">{currentPage.label}</span>
          </div>
          <div className="topbar-meta">
            <span className="simulation-date">模拟日期&nbsp; {shortDate(result.asOf)}</span>
            <span className="simulation-badge"><span className="simulation-dot" />模拟数据</span>
            <span className="config-badge">DEMO-CFG-1</span>
          </div>
        </header>

        <div className="page-wrap">
          {activePage === 'overview' && (
            <section className="page page-overview" aria-labelledby="overview-title">
              <div className="page-heading overview-heading">
                <div>
                  <div className="eyebrow">兴趣计划 <span>·</span> 单人</div>
                  <h1 id="overview-title">{title}</h1>
                  <p className="heading-subtitle">
                    {demoCase.goal.venue_city} · {longDate(demoCase.goal.show_start_at)} · 看台 B
                  </p>
                </div>
                <div className="heading-state">
                  <span className={`state-dot state-${result.states.planState.toLowerCase()}`} />
                  <span>{planStateText(result.states.planState)}</span>
                </div>
              </div>

              <div className="overview-grid">
                <section className="concert-panel" aria-label="目标详情">
                  <div className="concert-copy">
                    <div className="concert-kicker">SATURDAY · LIVE</div>
                    <h2>把这场演出，安排进计划里。</h2>
                    <p>武汉出发 · 开场前至少 60 分钟到 · 住宿 1 晚，距场馆 3 公里内</p>
                    <div className="concert-pills">
                      <span>未购票</span>
                      <span>看台票</span>
                      <span>上海</span>
                    </div>
                  </div>
                  <div className="concert-ticket" aria-label="11月28日星期六，19点30分开场">
                    <span className="ticket-day">28</span>
                    <span className="ticket-month">NOV · 2026</span>
                    <span className="ticket-time">19:30</span>
                    <span className="ticket-city">上海</span>
                  </div>
                </section>

                <section className="budget-panel" aria-label="预算概况">
                  <div className="panel-label">完整目标消费预算上限</div>
                  <div className="budget-value">{moneyText(budget)}</div>
                  <div className="budget-rule" />
                  <div className="budget-detail">
                    <span>已付金额</span>
                    <strong>{moneyText(result.cost.paidTotal.value)}</strong>
                  </div>
                  <div className="budget-detail">
                    <span>已知可行组合起价</span>
                    <strong>{moneyText(lowestCandidate?.netSpend?.value)}</strong>
                  </div>
                  <div className="budget-footnote">本次已知候选范围 · {result.topKLabel}</div>
                </section>
              </div>

              <div className="metric-row">
                <div className="metric-cell">
                  <span className="metric-label">当前模拟现金</span>
                  <strong>{moneyText(cash)}</strong>
                  <small>{shortDate(demoCase.snapshot.as_of)} 快照</small>
                </div>
                <div className="metric-cell">
                  <span className="metric-label">生活预留</span>
                  <strong>{moneyText(result.cost.protectedReserves.livingReserve.value)}</strong>
                  <small>覆盖已列生活安排</small>
                </div>
                <div className="metric-cell">
                  <span className="metric-label">今日额外支出参考</span>
                  <strong className="metric-status">{dailyValueText(result.dailyReference)}</strong>
                  <small>{dailyReason}</small>
                </div>
                <div className="metric-cell metric-forecast">
                  <span className="metric-label">价格趋势</span>
                  <strong>{result.forecasts?.[0] ? FORECAST_STATUS_TEXT[result.forecasts[0].status] : '没有可比价格序列'}</strong>
                  <small>{result.forecasts?.[0]?.sampleCount ?? 0} 条模拟观测 · 不作确定报价</small>
                </div>
              </div>

              <div className="overview-lower">
                <section className="chart-panel" aria-labelledby="cash-flow-title">
                  <div className="section-heading chart-heading">
                    <div>
                      <div className="eyebrow">资金概览</div>
                      <h2 id="cash-flow-title">现金与保护性预留</h2>
                    </div>
                    <span className="chart-period">{shortDate(result.checkPeriod.start)} — {result.checkPeriod.end ? shortDate(result.checkPeriod.end) : '待确认'}</span>
                  </div>
                  <div className="chart-frame" role="img" aria-label="资金日历中的现金余额和保护性预留变化">
                    <ReactECharts option={cashChartOption} style={{ height: 224, width: '100%' }} opts={{ renderer: 'canvas' }} />
                  </div>
                </section>

                <section className="summary-panel" aria-labelledby="summary-title">
                  <div className="eyebrow">案例摘要</div>
                  <h2 id="summary-title">关键安排</h2>
                  <div className="summary-lines">
                    <div><span>当前月生活预留</span><strong>{moneyText(currentLivingReserve?.amount)}</strong></div>
                    <div><span>预计家教收入</span><strong>{moneyText(tutoringIncome?.amount)}</strong></div>
                    <div><span>预计到账日期</span><strong>{tutoringIncome?.expected_at ? shortDate(tutoringIncome.expected_at) : '待确认'}</strong></div>
                    <div><span>已知候选</span><strong>{result.optimization.scope.length} 个</strong></div>
                  </div>
                  <button className="text-action" type="button" onClick={() => setActivePage('compare')}>
                    查看方案比较 <span aria-hidden="true">↗</span>
                  </button>
                </section>
              </div>

              <section className="conversation-panel" aria-labelledby="conversation-title">
                <div className="section-heading conversation-heading">
                  <div>
                    <div className="eyebrow">需求回放</div>
                    <h2 id="conversation-title">从目标描述整理出的计划</h2>
                  </div>
                  <span className="replay-label">固定话术</span>
                </div>
                <div className="utterances">
                  {demoCase.nl_script?.utterances.map((utterance, index) => (
                    <div className="utterance" key={utterance}>
                      <span className={`utterance-mark${index === 1 ? ' assistant-mark' : ''}`}>{index === 1 ? '趣' : '我'}</span>
                      <p>{utterance}</p>
                    </div>
                  ))}
                </div>
              </section>
            </section>
          )}

          {activePage === 'compare' && (
            <section className="page" aria-labelledby="compare-title">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">组合检查</div>
                  <h1 id="compare-title">方案比较</h1>
                  <p className="heading-subtitle">同一目标 · 完整费用组合 · 按检查结果排序</p>
                </div>
                <span className="config-badge config-badge-large">{result.topKLabel}</span>
              </div>

              <div className="comparison-summary">
                <div><span>比较范围</span><strong>{result.optimization.scope.length} 个已知方案</strong></div>
                <div><span>已评估</span><strong>{result.optimization.evaluatedCount} 个</strong></div>
                <div><span>确定排除</span><strong>{result.optimization.excludedCount} 个</strong></div>
                <div><span>待确认</span><strong>{result.optimization.pendingCount} 个</strong></div>
              </div>

              <div className="comparison-layout">
                <div className="comparison-main">
                  <section className="table-section" aria-labelledby="recommendations-title">
                    <div className="section-heading">
                      <div>
                        <div className="eyebrow">完整购买组合</div>
                        <h2 id="recommendations-title">本次推荐</h2>
                      </div>
                      <span className="recommendation-count">{rankedCandidates.length} 个方案</span>
                    </div>
                    <div className="table-scroll">
                      <table className="candidate-table">
                        <thead>
                          <tr>
                            <th>排序</th>
                            <th>方案</th>
                            <th>预计消费净支出</th>
                            <th>付款检查</th>
                            <th>选择</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rankedCandidates.map((candidate) => {
                            const selected = candidate.candidateId === selectedCandidateId
                            const candidateInput = demoCase.candidates.find((item) => item.candidate_id === candidate.candidateId)
                            const hasReturn = candidate.netSpendIfReceived != null
                            return (
                              <tr className={selected ? 'candidate-selected' : ''} key={candidate.candidateId}>
                                <td><span className="rank-number">{String(candidate.rank).padStart(2, '0')}</span></td>
                                <td>
                                  <strong className="candidate-name">{candidate.candidateId}</strong>
                                  <small className="candidate-spec">{candidateInput?.items.map((item) => categoryNames[item.cost_item_id] ?? item.cost_item_id).join(' · ')}</small>
                                  {hasReturn && <small className="return-note">{LABEL_TEXT.IF_RECEIVED} {moneyText(candidate.netSpendIfReceived?.value)}</small>}
                                </td>
                                <td><strong className="cost-value">{moneyText(candidate.netSpend?.value)}</strong>{result.labels.includes('SAME_PRICE') && candidate.rank === 3 && <small className="same-price-note">{LABEL_TEXT.SAME_PRICE}</small>}</td>
                                <td><span className="status-inline"><span className="status-check">✓</span>按当前假设可行</span></td>
                                <td>
                                  <button
                                    className={`choose-button${selected ? ' is-chosen' : ''}`}
                                    type="button"
                                    aria-label={`${selected ? '已选择' : '选择'}方案 ${candidate.candidateId}`}
                                    disabled={isConfirmed}
                                    onClick={() => selectCandidate(candidate.candidateId)}
                                  >
                                    {selected ? '已选择' : isConfirmed ? '正式方案' : '选此方案'}
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="scope-note">结论仅覆盖本次列出的已知候选与演示配置。</div>
                  </section>

                  <section className="table-section selected-detail" aria-labelledby="selected-detail-title">
                    <div className="section-heading">
                      <div>
                        <div className="eyebrow">方案明细</div>
                        <h2 id="selected-detail-title">{selectedCandidateId ? `方案 ${selectedCandidateId}` : '尚未选择方案'}</h2>
                      </div>
                      {selectedCandidateId && <span className={`confirmation-pill${isConfirmed ? ' confirmed' : ''}`}>{confirmationText(result.states.confirmationState)}</span>}
                    </div>
                    {selectedCandidate === null ? (
                      <div className="empty-line">方案明细将在选定候选后显示。</div>
                    ) : (
                      <div className="table-scroll">
                        <table className="detail-table">
                          <thead><tr><th>项目</th><th>规格与渠道</th><th>购买日</th><th>付款日</th><th>金额</th></tr></thead>
                          <tbody>
                            {selectedCandidate.items.map((item) => (
                              <tr key={`${item.cost_item_id}-${item.channel}`}>
                                <td>{categoryNames[item.cost_item_id] ?? item.cost_item_id}</td>
                                <td><span>{item.spec}</span><small>{item.channel} · {priceBasisText(item.price_basis)}</small></td>
                                <td>{shortDate(item.purchase_date)}</td>
                                <td>{shortDate(item.payment_at)}</td>
                                <td className="money-cell">{moneyText(item.price)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selectedCandidate !== null && selectedResult?.feasible && result.confirmation !== null && (
                      <div className="confirmation-bar">
                        <div>
                          <span className="confirmation-caption">建议分配额（不减少今日可额外支出）</span>
                          <strong>{moneyText(result.confirmation.deltaA.value)}</strong>
                        </div>
                        <button className="primary-button" type="button" onClick={confirmCandidate}>
                          {isConfirmed ? '再次确认方案' : '确认方案'}
                        </button>
                      </div>
                    )}
                  </section>
                </div>

                <aside className="comparison-side">
                  <section className="side-section">
                    <div className="eyebrow">排除原因</div>
                    <h2>未进入推荐</h2>
                    {result.candidates.filter((candidate) => candidate.excludedReasons.length > 0).length === 0 ? (
                      <p className="muted-line">当前没有确定排除的候选。</p>
                    ) : (
                      <div className="excluded-list">
                        {result.candidates.filter((candidate) => candidate.excludedReasons.length > 0).map((candidate) => (
                          <div className="excluded-row" key={candidate.candidateId}>
                            <div className="excluded-title"><strong>{candidate.candidateId}</strong><span>{moneyText(candidate.netSpend?.value)}</span></div>
                            {candidate.excludedReasons.map((reason) => <p key={`${reason.code}-${reason.rule}`}>{candidateReason(reason.code)}</p>)}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="side-section forecast-section">
                    <div className="eyebrow">价格估算</div>
                    <h2>住宿价格趋势</h2>
                    <div className="forecast-status"><span className="forecast-mark">!</span>{LABEL_TEXT.HISTORY_INSUFFICIENT}</div>
                    <p>仅有 {result.forecasts?.[0]?.sampleCount ?? 0} 条可用模拟观测，未生成预测金额。</p>
                    <div className="config-caption">{result.forecasts?.[0]?.configVersion ?? 'DEMO-CFG-1'} · 预测不可用</div>
                  </section>

                  <section className="side-section scenario-section">
                    <div className="eyebrow">消费情景</div>
                    <h2>历史覆盖</h2>
                    <p>{LABEL_TEXT.HISTORY_INSUFFICIENT} · 当前基础安排仍可检查</p>
                    <div className="config-caption">{result.scenarios?.find((scenario) => scenario.kind === 'RECENT_MONTH')?.configVersion ?? 'DEMO-CFG-1'}</div>
                  </section>
                </aside>
              </div>
            </section>
          )}

          {activePage === 'calendar' && (
            <section className="page" aria-labelledby="calendar-title">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">时间轴 <span>·</span> 2026.09 — 2027.01</div>
                  <h1 id="calendar-title">资金日历</h1>
                  <p className="heading-subtitle">{selectedCandidateId ? `${title} · 方案 ${selectedCandidateId}` : title}</p>
                </div>
                <div className="calendar-state">
                  {!isConfirmed && selectedCandidateId && <span className="status-tag status-outline">草案预览</span>}
                  {!isConfirmed && selectedCandidateId && <span className="status-tag status-muted">预览，未确认</span>}
                  {isConfirmed && <span className="status-tag status-good">已确认</span>}
                  {!selectedCandidateId && <span className="status-tag status-muted">暂无法完整判断</span>}
                  {isPaused && <span className="status-tag status-warning">已暂停</span>}
                  {isCancelled && <span className="status-tag status-muted">已取消</span>}
                </div>
              </div>

              <div className="calendar-overview">
                <div className="calendar-intro">
                  <span className="calendar-marker" aria-hidden="true">↕</span>
                  <div>
                    <strong>{selectedCandidateId ? '付款安排与现金节点' : '尚未选择方案'}</strong>
                    <p>{selectedCandidateId ? `输入版本 ${result.inputVersion} · ${planStateText(result.states.planState)}` : '当前仅展示案例中的生活安排与预计收入。'}</p>
                  </div>
                </div>
                <div className="calendar-metrics">
                  <div><span>检查起点</span><strong>{shortDate(result.checkPeriod.start)}</strong></div>
                  <div><span>检查终点</span><strong>{result.checkPeriod.end ? shortDate(result.checkPeriod.end) : '待确认'}</strong></div>
                  <div><span>当日参考</span><strong>{dailyValueText(result.dailyReference)}</strong></div>
                </div>
              </div>

              <div className="calendar-content">
                <div className="timeline-heading">
                  <span>日期</span><span>事项</span><span>计划状态</span><span className="timeline-amount-heading">金额</span>
                </div>
                <div className="timeline-list">
                  {timelineRows.map((row, index) => (
                    <div className={`timeline-row timeline-${row.kind}`} key={row.id}>
                      <div className="timeline-date"><strong>{shortDate(row.date)}</strong><small>{index === 0 ? '起始安排' : ''}</small></div>
                      <div className="timeline-event">
                        <span className="timeline-kind-mark" aria-hidden="true" />
                        <div><strong>{row.title}</strong><small>{row.detail}</small></div>
                      </div>
                      <div><span className="timeline-verdict">{row.verdict}</span></div>
                      <div className="timeline-amount">{row.amount == null ? '—' : moneyText(row.amount)}</div>
                    </div>
                  ))}
                  {timelineRows.length === 0 && <div className="empty-line">暂无可展示的资金事件。</div>}
                </div>
              </div>
              <p className="calendar-footnote">购买日期与付款日期分别列示。预计收入按到账前提参与模拟，不表示已到账。</p>
            </section>
          )}

          {activePage === 'manage' && (
            <section className="page" aria-labelledby="manage-title">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">计划版本 <span>·</span> {result.inputVersion}</div>
                  <h1 id="manage-title">计划管理</h1>
                  <p className="heading-subtitle">{title} · {confirmationText(result.states.confirmationState)}</p>
                </div>
                <span className={`state-badge state-badge-${result.states.planState.toLowerCase()}`}>
                  {planStateText(result.states.planState)}
                </span>
              </div>

              <div className="manage-layout">
                <div className="manage-main">
                  <section className="action-list-section" aria-labelledby="action-list-title">
                    <div className="section-heading">
                      <div>
                        <div className="eyebrow">已确认安排</div>
                        <h2 id="action-list-title">购买行动清单</h2>
                      </div>
                      {isConfirmed && <span className="plan-version-tag">{selectedResult?.planVersion ?? '方案版本'}</span>}
                    </div>
                    {result.actionList.length > 0 ? (
                      <div className="table-scroll">
                        <table className="detail-table action-table">
                          <thead><tr><th>项目</th><th>购买日期 / 渠道</th><th>优惠步骤</th><th>付款日期</th><th>任务状态</th></tr></thead>
                          <tbody>
                            {result.actionList.map((item) => (
                              <tr key={item.taskId}>
                                <td><strong>{item.spec}</strong><small>{item.category}</small></td>
                                <td>{item.purchaseDate ? shortDate(item.purchaseDate) : '待确认'}<small>{item.channel}</small></td>
                                <td>{item.offerIds.length ? item.offerIds.join(' · ') : '无'}</td>
                                <td>{item.paymentAt ? shortDate(item.paymentAt) : '待确认'}<small>{item.amount == null ? '待核价' : moneyText(item.amount.value)}</small></td>
                                <td><span className="task-state">{TASK_STATE_TEXT[item.taskState]}</span>{item.pendingChecks.length > 0 && <small>待核价条件 {item.pendingChecks.length} 项</small>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty-action-list">
                        <span className="empty-rule" />
                        <strong>暂无已确认行动清单</strong>
                        <span>方案确认状态：{confirmationText(result.states.confirmationState)}</span>
                      </div>
                    )}
                    {result.pendingDifferences.length > 0 && (
                      <div className="pending-differences">
                        <strong>待确认差异</strong>
                        {result.pendingDifferences.map((difference) => (
                          <span key={difference.costItemId}>{confirmedItemNames.get(difference.costItemId) ?? difference.costItemId} · {moneyText(difference.delta.value)}</span>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="adjustment-section" aria-labelledby="adjustments-title">
                    <div className="section-heading">
                      <div>
                        <div className="eyebrow">模拟输入</div>
                        <h2 id="adjustments-title">调整记录</h2>
                      </div>
                      <span className="version-chip">{ops.filter((op) => !['SELECT_CANDIDATE', 'CONFIRM'].includes(op.type)).length} 项调整</span>
                    </div>

                    <div className="adjustment-tabs" role="tablist" aria-label="调整类型">
                      {adjustments.map((item) => (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeAdjustment === item.id}
                          className={activeAdjustment === item.id ? 'is-active' : ''}
                          key={item.id}
                          onClick={() => { setActiveAdjustment(item.id); setFormError('') }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    <form className="adjustment-form" onSubmit={submitAdjustment}>
                      {activeAdjustment === 'delay' && (
                        <>
                          <label>
                            <span>预计收入</span>
                            <select value={incomeEventId} onChange={(event) => setIncomeEventId(event.target.value)}>
                              {availableIncome.map((income) => <option key={income.event_id} value={income.event_id}>{moneyText(income.amount)} · {shortDate(income.expected_at ?? '')}</option>)}
                            </select>
                          </label>
                          <label>
                            <span>调整后的到账日期</span>
                            <input type="date" value={delayDate} onChange={(event) => setDelayDate(event.target.value)} />
                          </label>
                          <button className="primary-button" type="submit">更新收入日期</button>
                        </>
                      )}

                      {activeAdjustment === 'living' && (
                        <>
                          <label><span>生活支出日期</span><input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label>
                          <label><span>金额（元）</span><input inputMode="decimal" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} /></label>
                          <label>
                            <span>预留覆盖</span>
                            <select value={coverMode} onChange={(event) => setCoverMode(event.target.value as 'NEW_RESERVE' | 'EXISTING_RESERVE')}>
                              <option value="NEW_RESERVE">新建对应生活预留</option>
                              <option value="EXISTING_RESERVE">使用现有生活预留</option>
                            </select>
                          </label>
                          {coverMode === 'EXISTING_RESERVE' && (
                            <label>
                              <span>生活预留</span>
                              <select value={reserveId} onChange={(event) => setReserveId(event.target.value)}>
                                {livingReserves.map((reserve) => <option key={reserve.reserve_id} value={reserve.reserve_id}>{reserve.reserve_id} · {moneyText(reserve.amount)}</option>)}
                              </select>
                            </label>
                          )}
                          <button className="primary-button" type="submit">加入生活支出</button>
                        </>
                      )}

                      {activeAdjustment === 'payment' && (
                        <>
                          <label>
                            <span>付款窗口</span>
                            <select value={paymentWindowId} onChange={(event) => setPaymentWindowId(event.target.value)} disabled={!selectedCandidateId || paymentWindows.length === 0}>
                              {paymentWindows.length === 0 && <option value="">当前方案没有可用窗口</option>}
                              {paymentWindows.map((window) => <option key={window.id} value={window.id}>{window.item} · {shortDate(window.date)}</option>)}
                            </select>
                          </label>
                          <button className="primary-button" type="submit" disabled={!selectedCandidateId || paymentWindows.length === 0}>更新付款日期</button>
                        </>
                      )}

                      {activeAdjustment === 'allocation' && (
                        <>
                          <label>
                            <span>本目标分配额（元）</span>
                            <input inputMode="decimal" value={allocationAmount} onChange={(event) => setAllocationAmount(event.target.value)} />
                          </label>
                          <button className="primary-button" type="submit">更新分配额</button>
                        </>
                      )}

                      {activeAdjustment === 'spend' && (
                        <>
                          <label>
                            <span>当前模拟时点支出（元）</span>
                            <input inputMode="decimal" value={todaySpendAmount} onChange={(event) => setTodaySpendAmount(event.target.value)} />
                          </label>
                          <button className="primary-button" type="submit">记录当日消费</button>
                        </>
                      )}
                      {formError && <p className="form-error" role="alert">{formError}</p>}
                    </form>
                  </section>
                </div>

                <aside className="manage-side">
                  <section className="side-section">
                    <div className="eyebrow">计划状态</div>
                    <h2>{planStateText(result.states.planState)}</h2>
                    {result.earliestGap && (
                      <div className="gap-summary">
                        <span>最早缺口 · {shortDate(result.earliestGap.at)}</span>
                        <strong>{moneyText(result.earliestGap.amount.value)}</strong>
                      </div>
                    )}
                    <div className="daily-reference-block">
                      <span>每日非计划支出参考</span>
                      <strong>{dailyValueText(result.dailyReference)}</strong>
                      <small>{result.labels.includes('DAILY_DISCLAIMER') ? LABEL_TEXT.DAILY_DISCLAIMER : '确认状态不会代替付款检查。'}</small>
                    </div>
                    <div className="dependency-list">
                      {result.dependencies.map((dependency, index) => (
                        <div key={`${dependency.kind}-${index}`}>
                          <span>{DEPENDENCY_TEXT[dependency.kind]}</span>
                          <strong>{dependency.amount == null ? '条件未完整' : moneyText(dependency.amount.value)}</strong>
                          {dependency.at && <small>{shortDate(dependency.at)}</small>}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="side-section plan-controls">
                    <div className="eyebrow">计划控制</div>
                    <h2>状态操作</h2>
                    <button className="secondary-button" type="button" disabled={disabledPlanControl || isPaused} onClick={() => appendOp({ type: 'PAUSE' })}>暂停计划</button>
                    <button className="danger-button" type="button" disabled={disabledPlanControl} onClick={() => appendOp({ type: 'CANCEL' })}>取消计划</button>
                    {isPaused && <span className="control-state">计划已暂停</span>}
                    {isCancelled && <span className="control-state">计划已取消</span>}
                    {!isConfirmed && <span className="control-hint">方案确认状态：{confirmationText(result.states.confirmationState)}</span>}
                  </section>
                </aside>
              </div>
            </section>
          )}
        </div>

        <footer className="app-footer">
          <span>趣有度 <span className="footer-dot">·</span> 计划工作区</span>
          <span>{result.topKLabel} <span className="footer-dot">·</span> {result.configVersion}</span>
        </footer>
      </main>
    </div>
  )
}

export default App
