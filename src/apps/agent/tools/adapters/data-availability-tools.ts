import { UserRole } from '@prisma/client'
import type { JsonSchema } from '../../contracts'
import type { ToolDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'
import { adapterToolResult } from './tool-adapter-support'
import { DATA_AVAILABILITY_DATASETS } from 'src/apps/data-availability/data-availability.catalog'
import {
  DataAvailabilityToolError,
  DataAvailabilityToolFacade,
  type DataAvailabilityInput,
} from 'src/apps/data-availability/data-availability-tool.facade'

export function createDataAvailabilityToolDefinitions(facade: DataAvailabilityToolFacade): readonly ToolDefinition[] {
  return Object.freeze([dataAvailabilityDefinition(facade)])
}

function dataAvailabilityDefinition(facade: DataAvailabilityToolFacade): ToolDefinition {
  return {
    key: 'get_data_availability',
    version: 1,
    description:
      '查询白名单数据集是否有数据、覆盖起点、最新水位线、同步与质量状态。仅在用户询问数据覆盖/更新时间，或业务 Tool 返回无数据后需要解释时调用；不会触发同步。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['datasets'],
      properties: {
        datasets: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          uniqueItems: true,
          items: { enum: [...DATA_AVAILABILITY_DATASETS] },
        },
        tsCode: { type: 'string', pattern: '^\\d{6}\\.(SH|SZ|BJ)$' },
      },
    },
    outputSchema: dataAvailabilityOutputSchema(),
    policy: {
      requiredRole: UserRole.USER,
      sideEffect: 'READ',
      requiresConfirmation: false,
      idempotent: true,
      timeoutMs: 10_000,
      maxAttempts: 2,
      maxRows: 20,
      costClass: 'LOW',
      allowedDataScopes: ['PUBLIC_MARKET_DATA'],
    },
    execute: async (input, context) => {
      try {
        const result = await facade.getAvailability(input as unknown as DataAvailabilityInput)
        const dataThrough = result.data.items
          .map((item) => item.dataThrough)
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1)
        return adapterToolResult(context, input, 'get_data_availability', result.data, {
          version: 1,
          sourceType: 'DATABASE',
          sourceServices: ['DataAvailabilityToolFacade', 'DataAvailabilityRepository'],
          sourceModels: [...new Set(result.data.items.flatMap((item) => item.sourceModels))],
          tradeDate: dataThrough,
          dataVersion: `data-availability.v1:${dataThrough ?? 'empty'}`,
          warnings: result.warnings,
        })
      } catch (error) {
        if (error instanceof DataAvailabilityToolError) {
          throw new ToolAdapterError(error.code, error.message, error.retryable)
        }
        throw new ToolAdapterError('UPSTREAM_FAILED', '数据可用性查询暂时不可用', true)
      }
    },
    countRows: (data) => (data as { items: unknown[] }).items.length,
  }
}

function dataAvailabilityOutputSchema(): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['scope', 'tsCode', 'items'],
    properties: {
      scope: { enum: ['MARKET', 'SECURITY'] },
      tsCode: { type: ['string', 'null'] },
      items: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'dataset',
            'scope',
            'tsCode',
            'status',
            'coverageStart',
            'dataThrough',
            'rowCount',
            'lastSyncedAt',
            'syncStatus',
            'qualityStatus',
            'lagTradingDays',
            'recommendedTool',
            'sourceTask',
            'sourceModels',
            'notes',
          ],
          properties: {
            dataset: { enum: [...DATA_AVAILABILITY_DATASETS] },
            scope: { enum: ['MARKET', 'SECURITY'] },
            tsCode: { type: ['string', 'null'] },
            status: { enum: ['READY', 'DEGRADED', 'EMPTY', 'FAILED'] },
            coverageStart: { type: ['string', 'null'], format: 'date' },
            dataThrough: { type: ['string', 'null'], format: 'date' },
            rowCount: { type: ['integer', 'null'], minimum: 0 },
            lastSyncedAt: { type: ['string', 'null'], format: 'date-time' },
            syncStatus: { enum: ['SUCCESS', 'FAILED', 'RUNNING', 'UNKNOWN'] },
            qualityStatus: { enum: ['PASS', 'WARN', 'FAIL', 'UNKNOWN'] },
            lagTradingDays: { type: ['integer', 'null'], minimum: 0 },
            recommendedTool: { type: ['string', 'null'] },
            sourceTask: { type: 'string' },
            sourceModels: { type: 'array', minItems: 1, items: { type: 'string' } },
            notes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  }
}
