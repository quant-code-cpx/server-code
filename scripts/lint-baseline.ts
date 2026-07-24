import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { LegacyESLint } from 'eslint/use-at-your-own-risk'
import { format } from 'prettier'

import { buildLintBaseline, findLintRegressions, LINT_PATTERNS, type LintBaseline } from './support/eslint-baseline'

const repoRoot = path.resolve(__dirname, '..')
const baselinePath = path.join(repoRoot, '.eslint-baseline.json')

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2))
  requireLegacyConfigMode()

  const eslint = new LegacyESLint({ cwd: repoRoot, fix: false })
  const results = await eslint.lintFiles(LINT_PATTERNS)
  const current = buildLintBaseline(results, repoRoot)

  if (mode === 'update') {
    const serialized = await format(JSON.stringify(current), { parser: 'json' })
    await writeFile(baselinePath, serialized)
    console.log(`ESLint baseline updated: ${formatSummary(current)}`)
    return
  }

  const historical = await readBaseline()
  const regressions = findLintRegressions(historical, current)
  if (regressions.length === 0) {
    console.log(`ESLint baseline passed: ${formatSummary(current)}`)
    return
  }

  console.error(`ESLint baseline failed: ${regressions.length} increased group(s)`)
  for (const regression of regressions.slice(0, 50)) {
    const rule = regression.ruleId ?? '<parser>'
    console.error(
      `- ${regression.filePath} | ${rule} | severity=${regression.severity} | ${regression.baselineCount} -> ${regression.currentCount}`,
    )
  }
  if (regressions.length > 50) {
    console.error(`- ... ${regressions.length - 50} more group(s)`)
  }
  process.exitCode = 1
}

function parseMode(args: string[]): 'check' | 'update' {
  if (args.length === 1 && args[0] === '--check') return 'check'
  if (args.length === 1 && args[0] === '--update') return 'update'
  throw new Error('Usage: lint-baseline.ts <--check|--update>')
}

function requireLegacyConfigMode(): void {
  if (process.env.ESLINT_USE_FLAT_CONFIG !== 'false') {
    throw new Error('ESLINT_USE_FLAT_CONFIG=false is required until flat config migration')
  }
}

async function readBaseline(): Promise<LintBaseline> {
  const parsed: unknown = JSON.parse(await readFile(baselinePath, 'utf8'))
  if (!isLintBaseline(parsed)) {
    throw new Error(`Invalid ESLint baseline: ${path.basename(baselinePath)}`)
  }
  if (JSON.stringify(parsed.patterns) !== JSON.stringify(LINT_PATTERNS)) {
    throw new Error('ESLint baseline patterns differ from configured lint patterns')
  }
  return parsed
}

function isLintBaseline(value: unknown): value is LintBaseline {
  if (!value || typeof value !== 'object') return false
  const baseline = value as Partial<LintBaseline>
  return (
    baseline.schemaVersion === 1 &&
    Array.isArray(baseline.patterns) &&
    !!baseline.summary &&
    Array.isArray(baseline.entries) &&
    baseline.entries.every(
      (entry) =>
        typeof entry?.filePath === 'string' &&
        (typeof entry.ruleId === 'string' || entry.ruleId === null) &&
        Number.isInteger(entry.severity) &&
        Number.isInteger(entry.count) &&
        entry.count > 0,
    )
  )
}

function formatSummary(baseline: LintBaseline): string {
  const { filesScanned, filesWithFindings, errors, warnings } = baseline.summary
  return `${filesScanned} files, ${filesWithFindings} affected, ${errors} errors, ${warnings} warnings`
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
