import { UserRole, UserStatus } from '@prisma/client'
import type { ToolAccessContext } from '../../tool-access-context'
import { ToolSchemaValidator } from '../../tool-schema-validator'
import { createDataAvailabilityToolDefinitions } from '../data-availability-tools'

describe('第一批数据可用性 Tool adapter', () => {
  const context: ToolAccessContext = {
    userId: 1,
    role: UserRole.USER,
    userStatus: UserStatus.ACTIVE,
    scopeId: 'scope',
    conversationId: 'conversation',
    runId: 'run',
    stepId: 'step',
    traceId: 'trace',
    workflowAllowedTools: ['get_data_availability'],
    allowedScopes: ['PUBLIC_MARKET_DATA'],
    callsUsed: 0,
    deadlineAt: new Date(Date.now() + 60_000),
    toolCallId: 'call',
    attempt: 1,
    abortSignal: new AbortController().signal,
  }

  it('[CONTRACT] schema 严格限制固定目录，结果携带水位、同步、质量和来源', async () => {
    const facade = {
      getAvailability: jest.fn().mockResolvedValue({
        data: {
          scope: 'MARKET',
          tsCode: null,
          items: [
            {
              dataset: 'STOCK_TECHNICAL_FACTOR',
              scope: 'MARKET',
              tsCode: null,
              status: 'READY',
              coverageStart: '2000-01-04',
              dataThrough: '2026-08-04',
              rowCount: null,
              lastSyncedAt: '2026-08-04T12:00:00.000Z',
              syncStatus: 'SUCCESS',
              qualityStatus: 'PASS',
              lagTradingDays: 0,
              recommendedTool: 'get_stock_technical_indicators',
              sourceTask: 'STK_FACTOR',
              sourceModels: ['StkFactor'],
              notes: [],
            },
          ],
        },
        warnings: [],
      }),
    }
    const definition = createDataAvailabilityToolDefinitions(facade as never)[0]
    const validator = new ToolSchemaValidator()
    validator.assertDefinitionSchemas(definition)

    expect(validator.validateInput(definition, { datasets: ['DROP_TABLE'] }).valid).toBe(false)
    expect(facade.getAvailability).not.toHaveBeenCalled()

    const result = await definition.execute({ datasets: ['STOCK_TECHNICAL_FACTOR'] }, context)
    expect(validator.validateOutput(definition, result.data)).toEqual({ valid: true, issues: [] })
    expect(result.provenance).toMatchObject({
      sourceModels: ['StkFactor'],
      dataVersion: 'data-availability.v1:2026-08-04',
    })
  })
})
