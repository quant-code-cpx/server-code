import path from 'node:path'

import { buildLintBaseline, findLintRegressions, type LintBaseline, type LintResultInput } from '../eslint-baseline'

const repoRoot = path.resolve('/workspace/quant-server')

function lintResult(filePath: string, messages: LintResultInput['messages']): LintResultInput {
  return { filePath, messages }
}

describe('eslint baseline', () => {
  it('按相对文件、规则和严重级别聚合问题', () => {
    const baseline = buildLintBaseline(
      [
        lintResult(path.join(repoRoot, 'src/example.ts'), [
          { ruleId: 'prettier/prettier', severity: 2 },
          { ruleId: 'prettier/prettier', severity: 2 },
          { ruleId: '@typescript-eslint/no-explicit-any', severity: 1 },
        ]),
        lintResult(path.join(repoRoot, 'scripts/example.ts'), [{ ruleId: null, severity: 2, fatal: true }]),
        lintResult(path.join(repoRoot, 'test/clean.spec.ts'), []),
      ],
      repoRoot,
    )

    expect(baseline.summary).toEqual({
      filesScanned: 3,
      filesWithFindings: 2,
      errors: 3,
      warnings: 1,
    })
    expect(baseline.entries).toEqual([
      {
        filePath: 'scripts/example.ts',
        ruleId: null,
        severity: 2,
        count: 1,
      },
      {
        filePath: 'src/example.ts',
        ruleId: '@typescript-eslint/no-explicit-any',
        severity: 1,
        count: 1,
      },
      {
        filePath: 'src/example.ts',
        ruleId: 'prettier/prettier',
        severity: 2,
        count: 2,
      },
    ])
  })

  it('允许历史问题减少或消失', () => {
    const historical = baselineWithEntries([
      {
        filePath: 'src/example.ts',
        ruleId: 'prettier/prettier',
        severity: 2,
        count: 2,
      },
      {
        filePath: 'src/removed.ts',
        ruleId: '@typescript-eslint/no-explicit-any',
        severity: 1,
        count: 1,
      },
    ])
    const current = baselineWithEntries([
      {
        filePath: 'src/example.ts',
        ruleId: 'prettier/prettier',
        severity: 2,
        count: 1,
      },
    ])

    expect(findLintRegressions(historical, current)).toEqual([])
  })

  it('阻断新分组和已有分组计数增长', () => {
    const historical = baselineWithEntries([
      {
        filePath: 'src/example.ts',
        ruleId: 'prettier/prettier',
        severity: 2,
        count: 2,
      },
    ])
    const current = baselineWithEntries([
      {
        filePath: 'src/example.ts',
        ruleId: 'prettier/prettier',
        severity: 2,
        count: 3,
      },
      {
        filePath: 'src/new.ts',
        ruleId: '@typescript-eslint/no-explicit-any',
        severity: 1,
        count: 1,
      },
    ])

    expect(findLintRegressions(historical, current)).toEqual([
      {
        filePath: 'src/example.ts',
        ruleId: 'prettier/prettier',
        severity: 2,
        baselineCount: 2,
        currentCount: 3,
        addedCount: 1,
      },
      {
        filePath: 'src/new.ts',
        ruleId: '@typescript-eslint/no-explicit-any',
        severity: 1,
        baselineCount: 0,
        currentCount: 1,
        addedCount: 1,
      },
    ])
  })
})

function baselineWithEntries(entries: LintBaseline['entries']): LintBaseline {
  return {
    schemaVersion: 1,
    patterns: ['src/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts'],
    summary: {
      filesScanned: 0,
      filesWithFindings: 0,
      errors: 0,
      warnings: 0,
    },
    entries,
  }
}
