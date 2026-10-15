import type { NormalizedCase } from '../normalize/index.ts'
import { dayNumber, instantMs, latestMs, localDay } from './time.ts'

/** price_series 的一行（§9.6）；调用方按 price_series 原顺序传入，D66 要取位置靠后者 */
export type PriceObservation = NormalizedCase['priceSeries'][number]

export type Sample = {
  observedOn: string
  price: number
}

export type SampleSet = {
  /** 起点前已可获得的观测是否同一项目、渠道、规格、服务日期与币种（R020 第1条） */
  comparable: boolean
  /** 预测起点前最近一段连续有效日级样本，按观测日升序（D24） */
  samples: Sample[]
  /** 该段最后一笔的观测日；没有样本时为 null */
  historyEnd: string | null
}

type Candidate = {
  observation: PriceObservation
  index: number
  day: number
  availableAt: number
  recordedAt: number
}

function sameComposition(a: PriceObservation, b: PriceObservation): boolean {
  return (
    a.costItemId === b.costItemId &&
    a.channel === b.channel &&
    a.spec === b.spec &&
    a.serviceDate === b.serviceDate &&
    a.currency === b.currency
  )
}

// D66：available_at 最晚者；相同取 recorded_at 最晚者；仍相同取 price_series 中位置靠后者
function supersedes(next: Candidate, kept: Candidate): boolean {
  if (next.availableAt !== kept.availableAt) return next.availableAt > kept.availableAt
  if (next.recordedAt !== kept.recordedAt) return next.recordedAt > kept.recordedAt
  return next.index > kept.index
}

function mostRecentRun(valid: readonly Candidate[]): Candidate[] {
  let start = valid.length - 1
  while (start > 0 && valid[start - 1].day === valid[start].day - 1) start -= 1
  return valid.slice(start)
}

/** R008：价格预测不使用 2026-09-01 之前的观测 */
const RANGE_START = '2026-09-01'

/** 取预测起点 asOf 前的样本；只用起点时已经可获得的观测（R020 第3条、D24、D66） */
export function extractSamples(observations: readonly PriceObservation[], seriesId: string, asOf: string): SampleSet {
  const origin = instantMs(asOf)
  if (origin === null) return { comparable: true, samples: [], historyEnd: null }
  const originDay = localDay(origin)

  const candidates: Candidate[] = []
  observations.forEach((observation, index) => {
    if (observation.seriesId !== seriesId) return
    const day = dayNumber(observation.observedOn)
    const availableAt = latestMs(observation.availableAt)
    // SPEC-GAP SG-48：可获得时间无法解析的不用；观测日晚于起点日期或早于支持范围的不用（R008）
    if (day === null || availableAt === null || availableAt > origin || day > originDay || observation.observedOn < RANGE_START) return
    candidates.push({ observation, index, day, availableAt, recordedAt: latestMs(observation.recordedAt) ?? -Infinity })
  })

  const [first] = candidates
  if (first === undefined) return { comparable: true, samples: [], historyEnd: null }
  // SPEC-GAP SG-48：构成不一致或币种不是 CNY 时整条序列不可比
  if (first.observation.currency !== 'CNY' || candidates.some((item) => !sameComposition(item.observation, first.observation))) {
    return { comparable: false, samples: [], historyEnd: null }
  }

  const byDay = new Map<number, Candidate>()
  for (const candidate of candidates) {
    const kept = byDay.get(candidate.day)
    if (kept === undefined || supersedes(candidate, kept)) byDay.set(candidate.day, candidate)
  }

  // SPEC-GAP SG-48：选中的观测价格不是正整数时该日不算有效样本，也不回退到同日其他观测（R020 第11条）
  const valid = [...byDay.values()]
    .filter(({ observation }) => Number.isSafeInteger(observation.price) && observation.price > 0)
    .sort((a, b) => a.day - b.day)
  const samples = mostRecentRun(valid).map(({ observation }) => ({
    observedOn: observation.observedOn,
    price: observation.price,
  }))
  return { comparable: true, samples, historyEnd: samples.at(-1)?.observedOn ?? null }
}
