/**
 * 自然语言辅助（src/nl）的公共入口。
 *
 * 只用确定性引擎做计算；本模块只负责把用户输入整理成「待确认值」，
 * 并在用户确认后以案例输入的 confirmations[] 形式交给 evaluate()。
 */
export {
  AMOUNT_FIELDS,
  BOOLEAN_FIELDS,
  DATE_FIELDS,
  EXTRACTION_FIELDS,
  FIELD_STATES,
  MAX_QUESTIONS_PER_ROUND,
  MAX_QUESTION_ROUNDS,
  NlError,
  type Draft,
  type ExtractedField,
  type ExtractionField,
  type FieldState,
  type NlErrorCode,
  type Question,
  type Recording,
  type ReplayTurn,
} from './contracts.ts'
export {
  applyExtraction,
  applyTurn,
  buildConfirmedCase,
  buildDraft,
  confirmFields,
  createSession,
  evaluateConfirmed,
  modifyField,
  nextQuestions,
  parseExtraction,
  recordQuestions,
  rejectField,
  type FieldSlot,
  type HandoffResult,
  type NlSession,
} from './session.ts'
export {
  createLiveTransport,
  createOffTransport,
  createReplayTransport,
  listRecordings,
  loadRecording,
  loadRecordingIndex,
  REPLAY_DIR,
  type NlTransport,
} from './transport.ts'
export { explain, sentenceIsSupported } from './explain.ts'
