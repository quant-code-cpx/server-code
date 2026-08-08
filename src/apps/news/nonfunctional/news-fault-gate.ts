export interface NewsFaultScenarioEvidence {
  scenario: 'DATABASE_NETWORK' | 'REDIS_NETWORK' | 'WORKER_RESTART' | 'PROVIDER_FAILURE'
  injectedAt: string
  recoveredAt: string | null
  recoveryDurationMs: number | null
  controlledFailureObserved: boolean
  consecutiveSuccessesAfterRecovery: number
  dataInvariantPreserved: boolean
  duplicateFacts: number
}

export interface NewsFaultReport {
  schemaVersion: 1
  runId: string
  generatedAt: string
  status: 'PASSED' | 'FAILED'
  scenarioCount: number
  scenarios: NewsFaultScenarioEvidence[]
  checks: Array<{ key: string; passed: boolean; actual: number | boolean | null; threshold: number | boolean }>
}

export function buildNewsFaultReport(_input: {
  runId: string
  generatedAt: string
  scenarios: NewsFaultScenarioEvidence[]
}): NewsFaultReport {
  const input = _input
  if (!/^news-fault-[a-z0-9][a-z0-9-]{0,63}$/.test(input.runId)) {
    throw new Error('runId 必须使用 news-fault- 前缀')
  }
  if (!Number.isFinite(new Date(input.generatedAt).getTime())) throw new Error('generatedAt 必须是合法时间')
  const required = new Set<NewsFaultScenarioEvidence['scenario']>([
    'DATABASE_NETWORK',
    'REDIS_NETWORK',
    'WORKER_RESTART',
    'PROVIDER_FAILURE',
  ])
  const present = new Set(input.scenarios.map((scenario) => scenario.scenario))
  const checks: NewsFaultReport['checks'] = [
    {
      key: 'scenarios.required',
      passed: required.size === present.size && [...required].every((scenario) => present.has(scenario)),
      actual: present.size,
      threshold: required.size,
    },
  ]
  for (const scenario of input.scenarios) {
    if (!Number.isFinite(new Date(scenario.injectedAt).getTime())) throw new Error('injectedAt 必须是合法时间')
    const prefix = `scenarios.${scenario.scenario}`
    const recoveryThresholdMs =
      scenario.scenario === 'DATABASE_NETWORK' || scenario.scenario === 'REDIS_NETWORK'
        ? 60_000
        : scenario.scenario === 'PROVIDER_FAILURE'
          ? 120_000
          : 180_000
    checks.push(
      {
        key: `${prefix}.controlledFailureObserved`,
        passed: scenario.controlledFailureObserved,
        actual: scenario.controlledFailureObserved,
        threshold: true,
      },
      {
        key: `${prefix}.recoveryDurationMs`,
        passed:
          scenario.recoveredAt != null &&
          Number.isFinite(new Date(scenario.recoveredAt).getTime()) &&
          scenario.recoveryDurationMs != null &&
          Number.isFinite(scenario.recoveryDurationMs) &&
          scenario.recoveryDurationMs >= 0 &&
          scenario.recoveryDurationMs <= recoveryThresholdMs,
        actual: scenario.recoveryDurationMs,
        threshold: recoveryThresholdMs,
      },
      {
        key: `${prefix}.consecutiveSuccessesAfterRecovery`,
        passed: scenario.consecutiveSuccessesAfterRecovery >= 3,
        actual: scenario.consecutiveSuccessesAfterRecovery,
        threshold: 3,
      },
      {
        key: `${prefix}.dataInvariantPreserved`,
        passed: scenario.dataInvariantPreserved,
        actual: scenario.dataInvariantPreserved,
        threshold: true,
      },
      {
        key: `${prefix}.duplicateFacts`,
        passed: scenario.duplicateFacts === 0,
        actual: scenario.duplicateFacts,
        threshold: 0,
      },
    )
  }
  const scenarios = input.scenarios.map((scenario) => ({
    scenario: scenario.scenario,
    injectedAt: scenario.injectedAt,
    recoveredAt: scenario.recoveredAt,
    recoveryDurationMs: scenario.recoveryDurationMs,
    controlledFailureObserved: scenario.controlledFailureObserved,
    consecutiveSuccessesAfterRecovery: scenario.consecutiveSuccessesAfterRecovery,
    dataInvariantPreserved: scenario.dataInvariantPreserved,
    duplicateFacts: scenario.duplicateFacts,
  }))
  return {
    schemaVersion: 1,
    runId: input.runId,
    generatedAt: input.generatedAt,
    status: checks.every((check) => check.passed) ? 'PASSED' : 'FAILED',
    scenarioCount: scenarios.length,
    scenarios,
    checks,
  }
}
