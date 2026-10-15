export type RankRow = {
  candidateId: string
  feasible: boolean | null
  netSpend: number | null
}

export type Placement = {
  tieGroup: number | null
  rank: number | null
}

type Entry = {
  index: number
  candidateId: string
  netSpend: number
}

function byNetSpend(left: Entry, right: Entry): number {
  if (left.netSpend !== right.netSpend) return left.netSpend < right.netSpend ? -1 : 1
  if (left.candidateId !== right.candidateId) return left.candidateId < right.candidateId ? -1 : 1
  return left.index - right.index
}

/**
 * R016 第4、6、7条：可行候选按预计消费净支出升序，同价按候选编号升序；前 K 名的 rank 为 1..K（§12.7），
 * 末位同价不突破 K。K 不是正整数时不给出 rank（R016 异常）。
 * SPEC-GAP SG-62：tie_group 给全部可行候选，按净支出从 1 起连续编号，同价同号。
 */
export function rankFeasible(rows: readonly RankRow[], topK: number): { placements: Placement[]; samePrice: boolean } {
  const limit = Number.isSafeInteger(topK) && topK > 0 ? topK : 0
  const entries = rows
    .flatMap((row, index) =>
      row.feasible === true && row.netSpend !== null ? [{ index, candidateId: row.candidateId, netSpend: row.netSpend }] : [],
    )
    .sort(byNetSpend)
  const placements: Placement[] = rows.map(() => ({ tieGroup: null, rank: null }))
  let group = 0
  let previous: number | null = null
  let samePrice = false
  for (const [position, entry] of entries.entries()) {
    if (entry.netSpend === previous) samePrice = true
    else {
      group += 1
      previous = entry.netSpend
    }
    placements[entry.index] = { tieGroup: group, rank: position < limit ? position + 1 : null }
  }
  return { placements, samePrice }
}
