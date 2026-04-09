/**
 * FactorExpressionService — 单元测试
 *
 * 覆盖要点：
 * - validate(): 合法表达式返回 { valid: true }
 * - validate(): 各类非法表达式返回 { valid: false, errors: [...] }
 * - compile(): 合法 AST 返回含 sql 属性的 CompiledQuery
 */
import { FactorExpressionService } from '../services/factor-expression.service'
import { ValidationResult } from '../types/expression.types'

// ── 工具：通过手动构造 AST 对象测试 compile() ─────────────────────────────────

function createService(): FactorExpressionService {
  // 无构造参数，直接 new
  return new FactorExpressionService()
}

describe('FactorExpressionService', () => {
  let service: FactorExpressionService

  beforeEach(() => {
    jest.clearAllMocks()
    service = createService()
  })

  // ── validate: 合法表达式 ────────────────────────────────────────────────────

  describe('validate() — 合法表达式', () => {
    it('单字段 close 合法', () => {
      const result: ValidationResult = service.validate('close')
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('单字段 vol 合法', () => {
      const result: ValidationResult = service.validate('vol')
      expect(result.valid).toBe(true)
    })

    it('rank(close) 合法', () => {
      const result: ValidationResult = service.validate('rank(close)')
      expect(result.valid).toBe(true)
    })

    it('ts_mean(vol, 20) 合法', () => {
      const result: ValidationResult = service.validate('ts_mean(vol, 20)')
      expect(result.valid).toBe(true)
    })

    it('rank(close/open) 合法', () => {
      const result: ValidationResult = service.validate('rank(close/open)')
      expect(result.valid).toBe(true)
    })

    it('ts_std(close, 20) 合法', () => {
      const result: ValidationResult = service.validate('ts_std(close, 20)')
      expect(result.valid).toBe(true)
    })

    it('rank(ts_std(close, 20)) 嵌套合法', () => {
      const result: ValidationResult = service.validate('rank(ts_std(close, 20))')
      expect(result.valid).toBe(true)
    })

    it('算术组合 close - open 合法', () => {
      const result: ValidationResult = service.validate('close - open')
      expect(result.valid).toBe(true)
    })

    it('zscore(pe_ttm) 合法', () => {
      const result: ValidationResult = service.validate('zscore(pe_ttm)')
      expect(result.valid).toBe(true)
    })

    it('log(total_mv) 合法', () => {
      const result: ValidationResult = service.validate('log(total_mv)')
      expect(result.valid).toBe(true)
    })

    it('abs(close - open) 合法', () => {
      const result: ValidationResult = service.validate('abs(close - open)')
      expect(result.valid).toBe(true)
    })
  })

  // ── validate: 非法表达式 ────────────────────────────────────────────────────

  describe('validate() — 非法表达式', () => {
    it('空字符串返回 valid: false', () => {
      const result: ValidationResult = service.validate('')
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('纯空白字符串返回 valid: false', () => {
      const result: ValidationResult = service.validate('   ')
      expect(result.valid).toBe(false)
    })

    it('未知字段名返回 valid: false', () => {
      const result: ValidationResult = service.validate('unknown_field')
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => /unknown_field/.test(e))).toBe(true)
    })

    it('未知函数名返回 valid: false', () => {
      const result: ValidationResult = service.validate('unknown_fn(close)')
      expect(result.valid).toBe(false)
    })

    it('超过 500 字符的表达式返回 valid: false', () => {
      const longExpr = 'close + ' + 'close + '.repeat(80) + 'close'
      expect(longExpr.length).toBeGreaterThan(500)
      const result: ValidationResult = service.validate(longExpr)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => /过长/.test(e))).toBe(true)
    })

    it('嵌套深度超过 MAX_DEPTH 返回 valid: false', () => {
      // MAX_DEPTH = 5，构造 6 层嵌套
      const deepExpr = 'rank(rank(rank(rank(rank(rank(close))))))'
      const result: ValidationResult = service.validate(deepExpr)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => /嵌套/.test(e))).toBe(true)
    })

    it('无效语法（括号不匹配）返回 valid: false', () => {
      const result: ValidationResult = service.validate('rank(close')
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('ts_mean 缺少窗口参数时返回 valid: false', () => {
      const result: ValidationResult = service.validate('ts_mean(close)')
      expect(result.valid).toBe(false)
    })
  })

  // ── validate: 返回 warnings ────────────────────────────────────────────────

  describe('validate() — 大窗口警告', () => {
    it('窗口 > 60 时产生 warnings（但 valid 仍为 true）', () => {
      const result: ValidationResult = service.validate('ts_mean(close, 100)')
      expect(result.valid).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it('窗口 <= 60 时无 warnings', () => {
      const result: ValidationResult = service.validate('ts_mean(close, 20)')
      expect(result.valid).toBe(true)
      expect(result.warnings).toHaveLength(0)
    })
  })

  // ── compile ─────────────────────────────────────────────────────────────────

  describe('compile()', () => {
    it('compile() 对 close 字段返回包含 sql 的 CompiledQuery', () => {
      // 构造最小 AST
      const ast = {
        root: { type: 'field', name: 'close' },
        referencedFields: ['close'],
        requiredTables: new Set(['prices', 'adj']),
        maxWindowSize: 0,
        nestingDepth: 1,
      }
      const result = service.compile(ast as any, '20250102')
      expect(result).toHaveProperty('sql')
      expect(typeof result.sql).toBe('string')
      expect(result.sql.length).toBeGreaterThan(0)
    })

    it('compile() 对 roe 字段设置 needsFinapit = true', () => {
      const ast = {
        root: { type: 'field', name: 'roe' },
        referencedFields: ['roe'],
        requiredTables: new Set(['fina_pit']),
        maxWindowSize: 0,
        nestingDepth: 1,
      }
      const result = service.compile(ast as any, '20250102')
      expect(result.needsFinapit).toBe(true)
    })

    it('compile() 对 pe_ttm 字段 needsFinapit = false', () => {
      const ast = {
        root: { type: 'field', name: 'pe_ttm' },
        referencedFields: ['pe_ttm'],
        requiredTables: new Set(['daily_basic']),
        maxWindowSize: 0,
        nestingDepth: 1,
      }
      const result = service.compile(ast as any, '20250102')
      expect(result.needsFinapit).toBe(false)
    })

    it('compile() 返回 requiredTables 为 Set', () => {
      const ast = {
        root: { type: 'field', name: 'close' },
        referencedFields: ['close'],
        requiredTables: new Set(['prices', 'adj']),
        maxWindowSize: 0,
        nestingDepth: 1,
      }
      const result = service.compile(ast as any, '20250102')
      expect(result.requiredTables).toBeInstanceOf(Set)
    })

    it('compile() maxWindowSize 从 ast 透传', () => {
      const ast = {
        root: { type: 'field', name: 'vol' },
        referencedFields: ['vol'],
        requiredTables: new Set(['prices']),
        maxWindowSize: 20,
        nestingDepth: 1,
      }
      const result = service.compile(ast as any, '20250102')
      expect(result.maxWindowSize).toBe(20)
    })
  })
})
