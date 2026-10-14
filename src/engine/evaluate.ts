import type { EngineConfig } from './config.ts'
import type { Op } from './ops.ts'
import type { ResultCore } from './result.ts'
import type { CaseFile } from './schema.ts'

export type Checkpoint = {
  label: string
  result: ResultCore
}

export type EvaluateOutput = {
  checkpoints: Checkpoint[]
}

/**
 * 纯函数：每个 EVALUATE 产生一个检查点；ops 中没有 EVALUATE 时在末尾补一个（ensureCheckpoint）。
 * 改变输入的操作使 input_version 加 1（rules.md §12.4）。
 */
export function evaluate(_caseData: CaseFile, _ops: readonly Op[], _config: EngineConfig): EvaluateOutput {
  throw new Error('未实现')
}
