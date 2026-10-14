import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { importOracle } from '../../scripts/oracle-import.ts'

function write(root: string, relativePath: string, text: string) {
  const file = path.join(root, relativePath)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
}

describe('importOracle', () => {
  test('清空目标并复制参考实现，跳过 __pycache__，保留 .gitkeep', async () => {
    const source = mkdtempSync(path.join(tmpdir(), 'oracle-import-src-'))
    const target = mkdtempSync(path.join(tmpdir(), 'oracle-import-dst-'))
    try {
      write(source, 'oracle/engine.py', 'print(1)\n')
      write(source, 'oracle/pkg/mod.py', 'print(2)\n')
      write(source, 'oracle/pkg/__pycache__/mod.pyc', 'pyc')
      write(source, 'oracle/__pycache__/x.pyc', 'pyc')
      write(source, 'AMBIGUOUS.md', '# 歧义\n')
      write(source, 'oracle_inputs.json', '{}\n')
      write(target, '.gitkeep', 'keep\n')
      write(target, 'old.py', 'old\n')
      write(target, 'nested/old.py', 'old\n')
      const copied = await importOracle(source, target)
      expect(copied).toEqual(['AMBIGUOUS.md', 'engine.py', 'oracle_inputs.json', 'pkg/mod.py'])
      expect(readFileSync(path.join(target, '.gitkeep'), 'utf8')).toBe('keep\n')
      expect(readFileSync(path.join(target, 'engine.py'), 'utf8')).toBe('print(1)\n')
      expect(readFileSync(path.join(target, 'pkg', 'mod.py'), 'utf8')).toBe('print(2)\n')
      expect(readFileSync(path.join(target, 'AMBIGUOUS.md'), 'utf8')).toBe('# 歧义\n')
      expect(existsSync(path.join(target, 'old.py'))).toBe(false)
      expect(existsSync(path.join(target, 'nested'))).toBe(false)
      expect(existsSync(path.join(target, '__pycache__'))).toBe(false)
      expect(existsSync(path.join(target, 'pkg', '__pycache__'))).toBe(false)
    } finally {
      rmSync(source, { recursive: true, force: true })
      rmSync(target, { recursive: true, force: true })
    }
  })

  test('缺少来源文件时报错，且不改目标', async () => {
    const source = mkdtempSync(path.join(tmpdir(), 'oracle-import-src-'))
    const target = mkdtempSync(path.join(tmpdir(), 'oracle-import-dst-'))
    try {
      write(target, 'old.py', 'old\n')
      await expect(importOracle(source, target)).rejects.toThrow('缺少 oracle/')
      write(source, 'oracle/engine.py', 'print(1)\n')
      write(source, 'oracle_inputs.json', '{}\n')
      await expect(importOracle(source, target)).rejects.toThrow('缺少 AMBIGUOUS.md')
      expect(readFileSync(path.join(target, 'old.py'), 'utf8')).toBe('old\n')
    } finally {
      rmSync(source, { recursive: true, force: true })
      rmSync(target, { recursive: true, force: true })
    }
  })
})
