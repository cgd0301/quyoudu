/**
 * 问卷导出件的完整性信号：只做计数与判定，不解释任何回答内容。
 *
 * 背景：Excel for the web 的旧版 CSV 导出会把不在当前代码页内的字符替换成 "?"，
 * 文件因此变成纯 ASCII，且题干与选项不可恢复。这里用可复现的计数把这类文件识别出来，
 * 让上游脚本在生成任何统计之前就停下。
 */

export type TextSignals = {
  /** 汉字个数（含扩展 A 区） */
  cjkChars: number
  /** U+FFFD 替换符个数：UTF-8 解码失败的信号 */
  replacementChars: number
  /** 半角 "?" 总数 */
  questionMarks: number
  /** 连续 3 个及以上 "?" 的片段数：整段中文被替换的典型形态 */
  questionMarkRuns: number
}

export type BufferSignals = TextSignals & {
  /** 原始字节中大于 127 的字节数 */
  nonAsciiBytes: number
}

export function textSignals(text: string): TextSignals {
  return {
    cjkChars: (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length,
    replacementChars: (text.match(/\uFFFD/g) ?? []).length,
    questionMarks: (text.match(/\?/g) ?? []).length,
    questionMarkRuns: (text.match(/\?{3,}/g) ?? []).length,
  }
}

export function bufferSignals(buffer: Buffer): BufferSignals {
  let nonAsciiBytes = 0
  for (const byte of buffer) {
    if (byte > 127) nonAsciiBytes += 1
  }
  return { nonAsciiBytes, ...textSignals(buffer.toString('utf8')) }
}

/**
 * 编码丢失判定：
 * - 出现 U+FFFD：按 UTF-8 解码失败；
 * - 整个文件没有任何非 ASCII 字节，却出现 3 段以上连续 "?"：中文被旧版 CSV 导出替换。
 * 普通英文文本里的单个问号不会触发；需要连续 3 个以上且至少 3 段。
 */
export function looksLikeEncodingLoss(signals: TextSignals & { nonAsciiBytes?: number }): boolean {
  if (signals.replacementChars > 0) return true
  const nonAscii = signals.nonAsciiBytes ?? 0
  return nonAscii === 0 && signals.questionMarkRuns >= 3
}
