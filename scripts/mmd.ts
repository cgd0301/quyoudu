import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const cliPath = path.join(rootDir, 'node_modules/@mermaid-js/mermaid-cli/src/cli.js')

export type MermaidRenderOptions = {
  input: string
  output: string
  width?: number
}

const defaultWidth = 1600

export function renderMermaid(options: MermaidRenderOptions): Promise<number> {
  const width = options.width ?? defaultWidth
  const args = [
    cliPath,
    '--input',
    options.input,
    '--output',
    options.output,
    '--size',
    String(width),
    '--backgroundColor',
    'white',
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve(code ?? 1)
    })
  })
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  const [input, output, widthArg] = process.argv.slice(2)
  if (!input || !output) {
    console.error('用法: tsx scripts/mmd.ts <输入> <输出> [宽度]')
    process.exit(1)
  }
  const width = widthArg === undefined ? defaultWidth : Number(widthArg)
  if (!Number.isInteger(width) || width <= 0) {
    console.error('宽度必须是正整数')
    process.exit(1)
  }
  renderMermaid({ input, output, width })
    .then((code) => {
      process.exit(code)
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exit(1)
    })
}
