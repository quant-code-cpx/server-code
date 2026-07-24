import { createHash } from 'node:crypto'
import type {
  BacktestConfig,
  BacktestReproducibilityManifest,
  PointInTimeUniverseSnapshot,
} from '../types/backtest-engine.types'

export const BACKTEST_ENGINE_VERSION = 'backtest-engine-pit-v2'
export const BACKTEST_DATA_CONTRACT_VERSION = 'backtest-data-contract-v2'
export const BACKTEST_UNIVERSE_POLICY_VERSION = 'pit-universe-v1'
export const BACKTEST_FINANCIAL_AS_OF_POLICY_VERSION = 'announcement-date-update-flag-v2'
export const BACKTEST_ADJUSTMENT_POLICY_VERSION = 'tushare-qfq-v1'

export function isVerifiedBacktestCreationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BACKTEST_REQUIRE_VERIFIED_DATA?.trim().toLowerCase() !== 'false'
}

export function isCompleteBacktestReproducibilityManifest(value: unknown): value is BacktestReproducibilityManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<BacktestReproducibilityManifest>
  return (
    manifest.engineVersion === BACKTEST_ENGINE_VERSION &&
    manifest.dataContractVersion === BACKTEST_DATA_CONTRACT_VERSION &&
    manifest.universePolicyVersion === BACKTEST_UNIVERSE_POLICY_VERSION &&
    manifest.financialAsOfPolicyVersion === BACKTEST_FINANCIAL_AS_OF_POLICY_VERSION &&
    manifest.adjustmentPolicyVersion === BACKTEST_ADJUSTMENT_POLICY_VERSION &&
    typeof manifest.inputHash === 'string' &&
    /^[a-f0-9]{64}$/.test(manifest.inputHash) &&
    Array.isArray(manifest.universeSnapshots) &&
    manifest.universeSnapshots.length > 0 &&
    Array.isArray(manifest.qualityFlags) &&
    manifest.qualityFlags.length === 0
  )
}

export const BACKTEST_PENDING_REPRODUCIBILITY = {
  engineVersion: BACKTEST_ENGINE_VERSION,
  dataContractVersion: BACKTEST_DATA_CONTRACT_VERSION,
  universePolicyVersion: BACKTEST_UNIVERSE_POLICY_VERSION,
  financialAsOfPolicyVersion: BACKTEST_FINANCIAL_AS_OF_POLICY_VERSION,
  adjustmentPolicyVersion: BACKTEST_ADJUSTMENT_POLICY_VERSION,
  reproducibilityStatus: 'PENDING',
  qualityFlags: [],
} as const

export function backtestPendingReproducibilityData() {
  return {
    engineVersion: BACKTEST_ENGINE_VERSION,
    dataContractVersion: BACKTEST_DATA_CONTRACT_VERSION,
    universePolicyVersion: BACKTEST_UNIVERSE_POLICY_VERSION,
    financialAsOfPolicyVersion: BACKTEST_FINANCIAL_AS_OF_POLICY_VERSION,
    adjustmentPolicyVersion: BACKTEST_ADJUSTMENT_POLICY_VERSION,
    reproducibilityStatus: 'PENDING',
    qualityFlags: [],
  }
}

export function buildBacktestReproducibilityManifest(
  config: BacktestConfig,
  universeSnapshots: PointInTimeUniverseSnapshot[],
): BacktestReproducibilityManifest {
  const orderedSnapshots = [...universeSnapshots].sort((a, b) => a.date.localeCompare(b.date))
  const input = {
    strategyType: config.strategyType,
    strategyConfig: config.strategyConfig,
    startDate: toIsoDate(config.startDate),
    endDate: toIsoDate(config.endDate),
    benchmarkTsCode: config.benchmarkTsCode,
    universe: config.universe,
    customUniverseTsCodes: [...(config.customUniverseTsCodes ?? [])].sort(),
    initialCapital: config.initialCapital,
    rebalanceFrequency: config.rebalanceFrequency,
    priceMode: config.priceMode,
    commissionRate: config.commissionRate,
    stampDutyRate: config.stampDutyRate,
    minCommission: config.minCommission,
    slippageBps: config.slippageBps,
    maxPositions: config.maxPositions,
    maxWeightPerStock: config.maxWeightPerStock,
    minDaysListed: config.minDaysListed,
    enableTradeConstraints: config.enableTradeConstraints,
    enableT1Restriction: config.enableT1Restriction,
    partialFillEnabled: config.partialFillEnabled,
    universeSnapshots: orderedSnapshots.map(({ date, source, version, hash }) => ({ date, source, version, hash })),
  }

  return {
    engineVersion: BACKTEST_ENGINE_VERSION,
    dataContractVersion: BACKTEST_DATA_CONTRACT_VERSION,
    universePolicyVersion: BACKTEST_UNIVERSE_POLICY_VERSION,
    financialAsOfPolicyVersion: BACKTEST_FINANCIAL_AS_OF_POLICY_VERSION,
    adjustmentPolicyVersion: BACKTEST_ADJUSTMENT_POLICY_VERSION,
    inputHash: sha256(stableStringify(input)),
    universeSnapshots: orderedSnapshots.map(({ date, source, version, hash, members }) => ({
      date,
      source,
      version,
      hash,
      memberCount: members.length,
    })),
    qualityFlags: [],
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}
