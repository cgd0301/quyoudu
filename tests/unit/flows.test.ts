import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { UI_OP_TYPES } from '../../src/engine/ops/schema.ts'
import { REPO_ROOT } from '../../scripts/lib/repo.ts'
import { buildFlows, flowIndexSchema } from '../../scripts/make-flows.ts'
import { caseFileSchema } from '../../src/engine/schema.ts'

const indexPath = path.join(REPO_ROOT, 'fixtures/flow_index.json')
const index = flowIndexSchema.parse(JSON.parse(readFileSync(indexPath, 'utf8')))

function caseOf(name: string): unknown {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/cases', `${name}.json`), 'utf8'))
}

describe('flows 演示流程与索引', () => {
  test('flows 每个流程只使用界面白名单操作与 EVALUATE，不含 PATCH', () => {
    for (const flow of index.flows) {
      for (const op of flow.ops) {
        const allowed = op.type === 'EVALUATE' || (UI_OP_TYPES as readonly string[]).includes(op.type)
        expect(allowed, `${flow.flow_id} 出现 ${op.type}`).toBe(true)
      }
    }
  })

  test('flows 索引引用的案例都存在且 case_id 与文件名一致', () => {
    for (const flow of index.flows) {
      const data = caseFileSchema.parse(caseOf(flow.case))
      expect(data.meta.case_id).toBe(flow.case)
    }
  })

  test('flows 每个流程都能被正式引擎执行，且不产生 REFERENCE_INVALID', () => {
    for (const flow of index.flows) {
      const data = caseFileSchema.parse(caseOf(flow.case))
      const output = evaluate(data, flow.ops, DEMO_CFG_1)
      const final = output.checkpoints.at(-1)
      expect(final, `${flow.flow_id} 没有检查点`).toBeDefined()
      const invalid = (final?.result.inputIssues ?? []).filter((issue) => issue.code === 'REFERENCE_INVALID')
      expect(invalid, `${flow.flow_id} 出现引用不存在`).toEqual([])
    }
  })

  test('flows fixtures/flows 与索引生成结果逐字相同', () => {
    const cases = new Map(index.flows.map((flow) => [flow.case, caseOf(flow.case)]))
    const built = buildFlows(index, cases)
    expect(built).toHaveLength(index.flows.length)
    for (const flow of built) {
      const current = readFileSync(path.join(REPO_ROOT, 'fixtures/flows', `${flow.flow_id}.json`), 'utf8')
      expect(current, `${flow.flow_id}.json 与索引不一致，请运行 pnpm flows`).toBe(flow.text)
    }
  })

  test('flows fixtures/flows 的 input 与案例原文件深相等，ops 与索引一致', () => {
    for (const flow of index.flows) {
      const file = JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/flows', `${flow.flow_id}.json`), 'utf8')) as {
        flow_id: string
        input: unknown
        ops: unknown
      }
      expect(file.flow_id).toBe(flow.flow_id)
      expect(file.input).toEqual(caseOf(flow.case))
      expect(file.ops).toEqual(flow.ops)
    }
  })

  test('flows 主线流程按对照表得到付款缺口与已确认状态', () => {
    const flow = index.flows.find((item) => item.flow_id === '01_cB_topk_main')
    expect(flow).toBeDefined()
    const output = evaluate(caseFileSchema.parse(caseOf(flow?.case ?? '')), flow?.ops ?? [], DEMO_CFG_1)
    const final = output.checkpoints.at(-1)?.result
    expect(final?.states.planState).toBe('PAYMENT_GAP')
    expect(final?.states.confirmationState).toBe('CONFIRMED')
    expect(final?.labels).toContain('SIMULATED_DATA')
    expect(final?.earliestGap).not.toBeNull()
  })
})
