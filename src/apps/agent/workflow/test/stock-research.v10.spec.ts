import { WorkflowRegistryService } from '../workflow-registry.service'
import { STOCK_RESEARCH_WORKFLOW_V9 } from '../workflows/stock-research.v9'
import {
  STOCK_RESEARCH_WORKFLOW_CURRENT,
  STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V10,
} from '../workflows/stock-research.v10'

describe('Stock research workflow v10', () => {
  it('[REG] 冻结 v9，并用有界回答 schema 避免合成结果耗尽输出长度', () => {
    expect(STOCK_RESEARCH_WORKFLOW_CURRENT).toBe(STOCK_RESEARCH_WORKFLOW_V10)
    expect(STOCK_RESEARCH_WORKFLOW_V10.version).toBe(10)
    expect(STOCK_RESEARCH_WORKFLOW_V9.outputSchema).not.toBe(STOCK_RESEARCH_WORKFLOW_V10.outputSchema)

    const properties = STOCK_RESEARCH_WORKFLOW_V10.outputSchema.properties as Record<string, Record<string, unknown>>
    const claimItems = properties.claims.items as Record<string, Record<string, unknown>>
    const claimProperties = claimItems.properties as Record<string, Record<string, unknown>>

    expect(properties.markdown.maxLength).toBe(3_000)
    expect(properties.claims.maxItems).toBe(10)
    expect(claimProperties.text.maxLength).toBe(240)
    expect(claimProperties.factIds.maxItems).toBe(4)
    expect(properties.warnings.maxItems).toBe(6)
    expect(STOCK_RESEARCH_WORKFLOW_V10.prompt.template).toContain('single-stock answer under 2000 Chinese characters')

    const registry = new WorkflowRegistryService(STOCK_RESEARCH_WORKFLOW_DEFINITIONS)
    registry.onModuleInit()
    expect(registry.resolve('stock_research', 9).contentHash).not.toBe(
      registry.resolve('stock_research', 10).contentHash,
    )
  })
})
