import type { Config } from 'jest'

const config: Config = {
  // ── 模块解析 ──────────────────────────────────────────────────────────────
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },

  // ── 转译 ──────────────────────────────────────────────────────────────────
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },

  // ── 测试文件查找 ───────────────────────────────────────────────────────────
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testEnvironment: 'node',

  // ── 全局 Setup ─────────────────────────────────────────────────────────────
  // 每个测试文件运行前执行：静默 NestJS logger
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],

  // ── 覆盖率 ────────────────────────────────────────────────────────────────
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.entity.ts',
    '!src/**/index.ts',
    '!src/constant/**',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      statements: 30,
      branches: 20,
      functions: 25,
      lines: 30,
    },
  },
}

export default config
