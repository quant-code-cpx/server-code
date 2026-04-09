import { StrategySchemaValidatorService } from '../strategy-schema-validator.service'
import { BacktestStrategyRegistryService } from 'src/apps/backtest/services/backtest-strategy-registry.service'
import { BACKTEST_STRATEGY_TYPES } from 'src/apps/backtest/types/backtest-engine.types'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'

// ── 辅助类型 ──────────────────────────────────────────────────────────────────

type MockRegistry = jest.Mocked<Pick<BacktestStrategyRegistryService, 'validateStrategyConfig'>>

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('StrategySchemaValidatorService', () => {
  let service: StrategySchemaValidatorService
  let mockRegistry: MockRegistry

  beforeEach(() => {
    mockRegistry = { validateStrategyConfig: jest.fn() }
    // @ts-ignore - 只注入单方法的局部 mock，DI 跳过
    service = new StrategySchemaValidatorService(mockRegistry)
  })

  // ── getAllSchemas() ─────────────────────────────────────────────────────────

  describe('getAllSchemas()', () => {
    it('应返回含有 5 个策略类型的对象', () => {
      const schemas = service.getAllSchemas()
      expect(Object.keys(schemas)).toHaveLength(5)
      for (const type of BACKTEST_STRATEGY_TYPES) {
        expect(schemas).toHaveProperty(type)
      }
    })

    it('每个 schema 都应包含 type: "object" 和 properties', () => {
      const schemas = service.getAllSchemas()
      for (const schema of Object.values(schemas)) {
        expect(schema.type).toBe('object')
        expect(schema.properties).toBeDefined()
      }
    })

    it('返回的是拷贝，对结果的修改不影响内部 map', () => {
      const schemas = service.getAllSchemas()
      // @ts-ignore 故意写入非法 key 验证隔离性
      schemas['SHOULD_NOT_EXIST'] = { type: 'object', properties: {} }
      const schemas2 = service.getAllSchemas()
      expect(Object.keys(schemas2)).toHaveLength(5)
      expect(schemas2).not.toHaveProperty('SHOULD_NOT_EXIST')
    })
  })

  // ── getSchema() ────────────────────────────────────────────────────────────

  describe('getSchema()', () => {
    it.each(BACKTEST_STRATEGY_TYPES)('应为 %s 返回合法 schema', (type) => {
      const schema = service.getSchema(type)
      expect(schema).toBeDefined()
      expect(schema!.type).toBe('object')
      expect(typeof schema!.properties).toBe('object')
    })

    it('对未知类型应返回 undefined', () => {
      expect(service.getSchema('UNKNOWN_TYPE')).toBeUndefined()
    })

    it('对空字符串应返回 undefined', () => {
      expect(service.getSchema('')).toBeUndefined()
    })

    describe('MA_CROSS_SINGLE schema', () => {
      it('required 应包含 tsCode', () => {
        expect(service.getSchema('MA_CROSS_SINGLE')!.required).toContain('tsCode')
      })

      it('properties 应包含 shortWindow 和 longWindow', () => {
        const props = service.getSchema('MA_CROSS_SINGLE')!.properties
        expect(props).toHaveProperty('shortWindow')
        expect(props).toHaveProperty('longWindow')
      })
    })

    describe('SCREENING_ROTATION schema', () => {
      it('不应有 required 字段（所有字段均有默认值）', () => {
        const schema = service.getSchema('SCREENING_ROTATION')!
        expect(schema.required ?? []).toHaveLength(0)
      })

      it('properties 应包含 rankBy 和 topN', () => {
        const props = service.getSchema('SCREENING_ROTATION')!.properties
        expect(props).toHaveProperty('rankBy')
        expect(props).toHaveProperty('topN')
      })
    })

    describe('FACTOR_RANKING schema', () => {
      it('required 应包含 factorName', () => {
        expect(service.getSchema('FACTOR_RANKING')!.required).toContain('factorName')
      })

      it('properties 应包含 optionalFilters', () => {
        expect(service.getSchema('FACTOR_RANKING')!.properties).toHaveProperty('optionalFilters')
      })
    })

    describe('CUSTOM_POOL_REBALANCE schema', () => {
      it('required 应包含 tsCodes', () => {
        expect(service.getSchema('CUSTOM_POOL_REBALANCE')!.required).toContain('tsCodes')
      })

      it('properties 应包含 weightMode', () => {
        expect(service.getSchema('CUSTOM_POOL_REBALANCE')!.properties).toHaveProperty('weightMode')
      })
    })

    describe('FACTOR_SCREENING_ROTATION schema', () => {
      it('required 应包含 conditions', () => {
        expect(service.getSchema('FACTOR_SCREENING_ROTATION')!.required).toContain('conditions')
      })

      it('properties 应包含 sortBy、sortOrder、topN、weightMethod', () => {
        const props = service.getSchema('FACTOR_SCREENING_ROTATION')!.properties
        expect(props).toHaveProperty('sortBy')
        expect(props).toHaveProperty('sortOrder')
        expect(props).toHaveProperty('topN')
        expect(props).toHaveProperty('weightMethod')
      })
    })
  })

  // ── getSupportedTypes() ────────────────────────────────────────────────────

  describe('getSupportedTypes()', () => {
    it('应返回包含全部 5 个策略类型的只读数组', () => {
      const types = service.getSupportedTypes()
      expect(types).toHaveLength(5)
      for (const type of BACKTEST_STRATEGY_TYPES) {
        expect(types).toContain(type)
      }
    })

    it('结果与 BACKTEST_STRATEGY_TYPES 内容完全一致', () => {
      const types = service.getSupportedTypes()
      expect([...types].sort()).toEqual([...BACKTEST_STRATEGY_TYPES].sort())
    })
  })

  // ── validate() ─────────────────────────────────────────────────────────────

  describe('validate()', () => {
    it('应将调用委托给 strategyRegistry.validateStrategyConfig 并返回结果', () => {
      const normalized = { tsCode: '000001.SZ', shortWindow: 5, longWindow: 20 }
      mockRegistry.validateStrategyConfig.mockReturnValue(normalized as never)

      const result = service.validate('MA_CROSS_SINGLE', { tsCode: '000001.SZ' })

      expect(mockRegistry.validateStrategyConfig).toHaveBeenCalledWith('MA_CROSS_SINGLE', {
        tsCode: '000001.SZ',
      })
      expect(result).toEqual(normalized)
    })

    it('应原样透传 strategyType 和 config', () => {
      const config = { conditions: [{ factorName: 'roe', operator: 'gt', value: 10 }] }
      mockRegistry.validateStrategyConfig.mockReturnValue(config as never)

      service.validate('FACTOR_SCREENING_ROTATION', config)

      expect(mockRegistry.validateStrategyConfig).toHaveBeenCalledWith('FACTOR_SCREENING_ROTATION', config)
    })

    it('当 registry 抛出 BusinessException 时应向上传播', () => {
      const err = new BusinessException(ErrorEnum.BACKTEST_UNKNOWN_STRATEGY)
      mockRegistry.validateStrategyConfig.mockImplementation(() => {
        throw err
      })

      expect(() => service.validate('UNKNOWN', {})).toThrow(BusinessException)
    })

    it('当 registry 抛出普通 Error 时也应向上传播', () => {
      mockRegistry.validateStrategyConfig.mockImplementation(() => {
        throw new Error('validation failure')
      })

      expect(() => service.validate('MA_CROSS_SINGLE', null)).toThrow('validation failure')
    })
  })
})
