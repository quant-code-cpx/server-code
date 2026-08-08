import type { Config } from 'jest'
import baseConfig from './jest.config'

const config: Config = {
  ...baseConfig,
  testRegex: '.*(?:\\.spec|\\.e2e-spec)\\.ts$',
  modulePathIgnorePatterns: ['<rootDir>/.agents/', '<rootDir>/.claude/'],
  collectCoverageFrom: [
    'src/apps/agent/**/*.ts',
    '!src/apps/agent/**/*.module.ts',
    '!src/apps/agent/**/*.spec.ts',
    '!src/apps/agent/**/test/**',
    '!src/apps/agent/api/dto/**',
    '!src/apps/agent/**/index.ts',
    '!src/apps/agent/contracts/generated/**',
  ],
  coverageDirectory: 'coverage/agent',
  coverageReporters: ['json-summary', 'text', 'text-summary'],
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 70,
      functions: 90,
      lines: 90,
    },
  },
}

export default config
