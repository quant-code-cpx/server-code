import path from 'node:path'

export const LINT_PATTERNS = ['src/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts']

export interface LintMessageInput {
  ruleId: string | null
  severity: number
  fatal?: boolean
}

export interface LintResultInput {
  filePath: string
  messages: readonly LintMessageInput[]
}

export interface LintBaselineEntry {
  filePath: string
  ruleId: string | null
  severity: number
  count: number
}

export interface LintBaseline {
  schemaVersion: 1
  patterns: string[]
  summary: {
    filesScanned: number
    filesWithFindings: number
    errors: number
    warnings: number
  }
  entries: LintBaselineEntry[]
}

export type LintRegression = Omit<LintBaselineEntry, 'count'> & {
  baselineCount: number
  currentCount: number
  addedCount: number
}

export function buildLintBaseline(results: readonly LintResultInput[], repoRoot: string): LintBaseline {
  const groups = new Map<string, LintBaselineEntry>()
  let filesWithFindings = 0
  let errors = 0
  let warnings = 0

  for (const result of results) {
    const messages = result.messages.filter((message) => message.severity > 0)
    if (messages.length > 0) filesWithFindings += 1

    const filePath = toPortableRelativePath(repoRoot, result.filePath)
    for (const message of messages) {
      if (message.severity === 2) errors += 1
      if (message.severity === 1) warnings += 1

      const key = entryKey({
        filePath,
        ruleId: message.ruleId,
        severity: message.severity,
      })
      const existing = groups.get(key)
      if (existing) {
        existing.count += 1
      } else {
        groups.set(key, {
          filePath,
          ruleId: message.ruleId,
          severity: message.severity,
          count: 1,
        })
      }
    }
  }

  return {
    schemaVersion: 1,
    patterns: [...LINT_PATTERNS],
    summary: {
      filesScanned: results.length,
      filesWithFindings,
      errors,
      warnings,
    },
    entries: [...groups.values()].sort(compareEntries),
  }
}

export function findLintRegressions(historical: LintBaseline, current: LintBaseline): LintRegression[] {
  const historicalCounts = new Map(historical.entries.map((entry) => [entryKey(entry), entry.count]))

  return current.entries
    .map((entry) => {
      const baselineCount = historicalCounts.get(entryKey(entry)) ?? 0
      const { count, ...identity } = entry
      return {
        ...identity,
        baselineCount,
        currentCount: count,
        addedCount: count - baselineCount,
      }
    })
    .filter((entry) => entry.addedCount > 0)
    .sort(compareEntries)
}

function toPortableRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}

function entryKey(entry: Pick<LintBaselineEntry, 'filePath' | 'ruleId' | 'severity'>): string {
  return JSON.stringify([entry.filePath, entry.ruleId, entry.severity])
}

function compareEntries(
  left: Pick<LintBaselineEntry, 'filePath' | 'ruleId' | 'severity'>,
  right: Pick<LintBaselineEntry, 'filePath' | 'ruleId' | 'severity'>,
): number {
  const fileOrder = compareText(left.filePath, right.filePath)
  if (fileOrder !== 0) return fileOrder

  const ruleOrder = compareText(left.ruleId ?? '', right.ruleId ?? '')
  if (ruleOrder !== 0) return ruleOrder

  return left.severity - right.severity
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
