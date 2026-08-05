import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('第一批 Agent Tool 数据源边界', () => {
  it('[ARCH] Agent Tool 与三个 Facade 不得 import TushareClient 或 ApiService', () => {
    const root = process.cwd()
    const files = [
      'src/apps/agent/tools/adapters/technical-analysis-tools.ts',
      'src/apps/agent/tools/adapters/data-availability-tools.ts',
      'src/apps/stock/stock-technical-tool.facade.ts',
      'src/apps/technical-signal/technical-signal-tool.facade.ts',
      'src/apps/data-availability/data-availability-tool.facade.ts',
    ]
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8')
      expect(source).not.toMatch(/TushareClient|FactorDataApiService|from ['"].*\/api\//)
    }
  })
})
