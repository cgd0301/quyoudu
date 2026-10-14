export const MODULES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9'] as const
export type ModuleId = (typeof MODULES)[number]

/** 已完成的模块。pnpm vec 未指定编号或模块时只跑这些模块的向量；每完成一个模块追加一项。 */
export const doneModules: readonly ModuleId[] = ['M1', 'M2']
