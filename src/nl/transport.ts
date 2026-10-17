/**
 * 自然语言调用层：可替换的异步传输接口 + 离线回放 + 关闭模式。
 *
 * 正常单元测试只用回放，不联网、不需要密钥；缺少凭据时实时模式返回明确的不可用状态，
 * 不会静默退回假数据。回放文件在 fixtures/llm-replay，结构见 contracts 的 recordingSchema。
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NlError, recordingIndexSchema, recordingSchema, type Recording, type ReplayTurn } from './contracts.ts'

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
export const REPLAY_DIR = path.join(REPO_ROOT, 'fixtures', 'llm-replay')

export type NlTransport = {
  readonly kind: 'replay' | 'live' | 'off'
  /** 第 index 轮（0 起）的返回；超出录制范围时报错，不重复使用最后一轮 */
  send: (index: number, utterance: string) => Promise<ReplayTurn>
}

export function loadRecordingIndex(dir: string = REPLAY_DIR): string[] {
  const file = path.join(dir, 'index.json')
  try {
    const parsed = recordingIndexSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    return parsed.recordings
  } catch {
    return []
  }
}

export function loadRecording(recordingId: string, dir: string = REPLAY_DIR): Recording {
  const file = path.join(dir, `${recordingId}.json`)
  try {
    return recordingSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    throw new NlError('HTTP_ERROR', `回放文件不可用：${path.relative(REPO_ROOT, file)}（${reason}）`)
  }
}

export function listRecordings(dir: string = REPLAY_DIR): Recording[] {
  let names: string[]
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'index.json').sort()
  } catch {
    return []
  }
  return names.map((name) => recordingSchema.parse(JSON.parse(readFileSync(path.join(dir, name), 'utf8'))))
}

/** 回放：按 turn 顺序返回，不联网 */
export function createReplayTransport(recording: Recording): NlTransport {
  return {
    kind: 'replay',
    send: async (index, utterance) => {
      const turn = recording.turns[index]
      if (turn === undefined) {
        throw new NlError(
          'ROUNDS_EXHAUSTED',
          `回放只有 ${recording.turns.length} 轮，第 ${index + 1} 轮没有录制内容（话术：${utterance}）`,
        )
      }
      return turn
    },
  }
}

/** 关闭模式：完全不调用模型，只提供表单；核心计算不受影响 */
export function createOffTransport(): NlTransport {
  return {
    kind: 'off',
    send: async () => {
      throw new NlError('LIVE_UNAVAILABLE', '自然语言辅助已关闭，请使用表单填写')
    },
  }
}

/**
 * 实时模式：由服务端注入调用函数，本模块不读取环境变量、不直接发请求。
 * 缺少凭据时返回明确不可用；调用方抛出的错误按 TIMEOUT／HTTP_ERROR 交给会话处理。
 */
export function createLiveTransport(options: { available: boolean; invoke?: (utterance: string) => Promise<ReplayTurn> }): NlTransport {
  return {
    kind: 'live',
    send: async (_index, utterance) => {
      if (!options.available || options.invoke === undefined) {
        throw new NlError('LIVE_UNAVAILABLE', '实时模式不可用：未配置模型凭据')
      }
      try {
        return await options.invoke(utterance)
      } catch (error) {
        if (error instanceof NlError) throw error
        throw new NlError('HTTP_ERROR', `模型调用失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
