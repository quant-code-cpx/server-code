import { BadRequestException, Injectable } from '@nestjs/common'
import {
  CompiledQuery,
  ExpressionAST,
  ExpressionNode,
  TableCategory,
  ValidationResult,
} from '../types/expression.types'

// ── Whitelists ────────────────────────────────────────────────────────────────

/** Allowed field identifiers and their SQL representation in the outer query */
const FIELD_SQL: Record<string, { sql: string; table: TableCategory[] }> = {
  close: { sql: '(d.close * af.adj_factor)', table: ['prices', 'adj'] },
  open: { sql: '(d.open * af.adj_factor)', table: ['prices', 'adj'] },
  high: { sql: '(d.high * af.adj_factor)', table: ['prices', 'adj'] },
  low: { sql: '(d.low * af.adj_factor)', table: ['prices', 'adj'] },
  vol: { sql: 'd.vol', table: ['prices'] },
  amount: { sql: 'd.amount', table: ['prices'] },
  pe_ttm: { sql: 'db.pe_ttm', table: ['daily_basic'] },
  pb: { sql: 'db.pb', table: ['daily_basic'] },
  ps_ttm: { sql: 'db.ps_ttm', table: ['daily_basic'] },
  dv_ttm: { sql: 'db.dv_ttm', table: ['daily_basic'] },
  total_mv: { sql: 'db.total_mv', table: ['daily_basic'] },
  circ_mv: { sql: 'db.circ_mv', table: ['daily_basic'] },
  turnover_rate_f: { sql: 'db.turnover_rate_f', table: ['daily_basic'] },
  volume_ratio: { sql: 'db.volume_ratio', table: ['daily_basic'] },
  roe: { sql: 'fi.roe', table: ['fina_pit'] },
  roa: { sql: 'fi.roa', table: ['fina_pit'] },
  revenue_yoy: { sql: 'fi.revenue_yoy', table: ['fina_pit'] },
  net_profit_yoy: { sql: 'fi.netprofit_yoy', table: ['fina_pit'] },
}

/** Field → table for time-series subquery generation */
const FIELD_TS_TABLE: Record<string, 'prices' | 'daily_basic' | 'fina_pit'> = {
  close: 'prices',
  open: 'prices',
  high: 'prices',
  low: 'prices',
  vol: 'prices',
  amount: 'prices',
  pe_ttm: 'daily_basic',
  pb: 'daily_basic',
  ps_ttm: 'daily_basic',
  dv_ttm: 'daily_basic',
  total_mv: 'daily_basic',
  circ_mv: 'daily_basic',
  turnover_rate_f: 'daily_basic',
  volume_ratio: 'daily_basic',
  roe: 'fina_pit',
  roa: 'fina_pit',
  revenue_yoy: 'fina_pit',
  net_profit_yoy: 'fina_pit',
}

/** SQL expression used in time-series subqueries for each field */
const FIELD_TS_SQL: Record<'prices' | 'daily_basic' | 'fina_pit', Record<string, string>> = {
  prices: {
    close: 'd2.close * af2.adj_factor',
    open: 'd2.open * af2.adj_factor',
    high: 'd2.high * af2.adj_factor',
    low: 'd2.low * af2.adj_factor',
    vol: 'd2.vol',
    amount: 'd2.amount',
  },
  daily_basic: {
    pe_ttm: 'd2.pe_ttm',
    pb: 'd2.pb',
    ps_ttm: 'd2.ps_ttm',
    dv_ttm: 'd2.dv_ttm',
    total_mv: 'd2.total_mv',
    circ_mv: 'd2.circ_mv',
    turnover_rate_f: 'd2.turnover_rate_f',
    volume_ratio: 'd2.volume_ratio',
  },
  fina_pit: {
    roe: 'd2.roe',
    roa: 'd2.roa',
    revenue_yoy: 'd2.revenue_yoy',
    net_profit_yoy: 'd2.netprofit_yoy',
  },
}

/** Allowed function names */
const ALLOWED_FUNCTIONS = new Set([
  'rank',
  'zscore',
  'ts_mean',
  'ts_std',
  'ts_sum',
  'ts_min',
  'ts_max',
  'ts_rank',
  'delay',
  'delta',
  'ts_corr',
  'ts_cov',
  'log',
  'abs',
  'sign',
  'max',
  'min',
  'if_else',
])

/** Single-argument time-series functions (arg: field, n: window) */
const TS_SINGLE_FIELD_FUNCTIONS = new Set([
  'ts_mean',
  'ts_std',
  'ts_sum',
  'ts_min',
  'ts_max',
  'ts_rank',
  'delay',
  'delta',
])

/** Max expression length */
const MAX_EXPR_LENGTH = 500
/** Max nesting depth */
const MAX_DEPTH = 5
/** Max time-series window */
const MAX_WINDOW = 250

// ── Token types ───────────────────────────────────────────────────────────────

type TokenType =
  | 'NUMBER'
  | 'IDENT'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'GT'
  | 'LT'
  | 'GTE'
  | 'LTE'
  | 'EQ'
  | 'NEQ'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'EOF'

interface Token {
  type: TokenType
  value: string
  pos: number
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++
      continue
    }
    // Number
    if (/[0-9]/.test(input[i])) {
      let num = ''
      const pos = i
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i++]
      }
      tokens.push({ type: 'NUMBER', value: num, pos })
      continue
    }
    // Identifier
    if (/[a-z_]/.test(input[i])) {
      let ident = ''
      const pos = i
      while (i < input.length && /[a-z0-9_]/.test(input[i])) {
        ident += input[i++]
      }
      tokens.push({ type: 'IDENT', value: ident, pos })
      continue
    }
    // Two-char operators
    if (i + 1 < input.length) {
      const two = input.slice(i, i + 2)
      if (two === '>=') {
        tokens.push({ type: 'GTE', value: '>=', pos: i })
        i += 2
        continue
      }
      if (two === '<=') {
        tokens.push({ type: 'LTE', value: '<=', pos: i })
        i += 2
        continue
      }
      if (two === '!=') {
        tokens.push({ type: 'NEQ', value: '!=', pos: i })
        i += 2
        continue
      }
    }
    // Single-char operators
    const char = input[i]
    const pos = i
    i++
    switch (char) {
      case '+':
        tokens.push({ type: 'PLUS', value: '+', pos })
        break
      case '-':
        tokens.push({ type: 'MINUS', value: '-', pos })
        break
      case '*':
        tokens.push({ type: 'STAR', value: '*', pos })
        break
      case '/':
        tokens.push({ type: 'SLASH', value: '/', pos })
        break
      case '>':
        tokens.push({ type: 'GT', value: '>', pos })
        break
      case '<':
        tokens.push({ type: 'LT', value: '<', pos })
        break
      case '=':
        tokens.push({ type: 'EQ', value: '=', pos })
        break
      case '(':
        tokens.push({ type: 'LPAREN', value: '(', pos })
        break
      case ')':
        tokens.push({ type: 'RPAREN', value: ')', pos })
        break
      case ',':
        tokens.push({ type: 'COMMA', value: ',', pos })
        break
      default:
        throw new Error(`表达式包含非法字符 '${char}' 在位置 ${pos}`)
    }
  }
  tokens.push({ type: 'EOF', value: '', pos: i })
  return tokens
}

// ── Recursive Descent Parser ──────────────────────────────────────────────────

class Parser {
  private tokens: Token[]
  private pos = 0
  private depth = 0
  maxDepth = 0
  maxWindow = 0
  referencedFields: string[] = []
  warnings: string[] = []

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private consume(): Token {
    return this.tokens[this.pos++]
  }

  private expect(type: TokenType): Token {
    const t = this.consume()
    if (t.type !== type) {
      throw new Error(`期望 '${type}'，实际得到 '${t.value}' (${t.type}) 在位置 ${t.pos}`)
    }
    return t
  }

  parse(): ExpressionNode {
    const node = this.parseComparison()
    if (this.peek().type !== 'EOF') {
      throw new Error(`表达式有多余内容: '${this.peek().value}'`)
    }
    return node
  }

  private parseComparison(): ExpressionNode {
    let left = this.parseAdditive()
    const t = this.peek()
    if (
      t.type === 'GT' ||
      t.type === 'LT' ||
      t.type === 'GTE' ||
      t.type === 'LTE' ||
      t.type === 'EQ' ||
      t.type === 'NEQ'
    ) {
      this.consume()
      const op = t.value as '>' | '<' | '>=' | '<=' | '=' | '!='
      const right = this.parseAdditive()
      left = { type: 'binary', op, left, right }
    }
    return left
  }

  private parseAdditive(): ExpressionNode {
    let left = this.parseMultiplicative()
    while (this.peek().type === 'PLUS' || this.peek().type === 'MINUS') {
      const op = this.consume().value as '+' | '-'
      const right = this.parseMultiplicative()
      left = { type: 'binary', op, left, right }
    }
    return left
  }

  private parseMultiplicative(): ExpressionNode {
    let left = this.parseUnary()
    while (this.peek().type === 'STAR' || this.peek().type === 'SLASH') {
      const op = this.consume().value as '*' | '/'
      const right = this.parseUnary()
      left = { type: 'binary', op, left, right }
    }
    return left
  }

  private parseUnary(): ExpressionNode {
    if (this.peek().type === 'MINUS') {
      this.consume()
      const operand = this.parseUnary()
      return { type: 'unary', op: '-', operand }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ExpressionNode {
    const t = this.peek()

    if (t.type === 'NUMBER') {
      this.consume()
      return { type: 'literal', value: parseFloat(t.value) }
    }

    if (t.type === 'LPAREN') {
      this.consume()
      this.depth++
      if (this.depth > this.maxDepth) this.maxDepth = this.depth
      const node = this.parseComparison()
      this.depth--
      this.expect('RPAREN')
      return node
    }

    if (t.type === 'IDENT') {
      this.consume()
      // Function call
      if (this.peek().type === 'LPAREN') {
        this.consume()
        this.depth++
        if (this.depth > this.maxDepth) this.maxDepth = this.depth

        if (!ALLOWED_FUNCTIONS.has(t.value)) {
          throw new Error(`不支持的函数: '${t.value}'`)
        }

        const args: ExpressionNode[] = []
        if (this.peek().type !== 'RPAREN') {
          args.push(this.parseComparison())
          while (this.peek().type === 'COMMA') {
            this.consume()
            args.push(this.parseComparison())
          }
        }
        this.depth--
        this.expect('RPAREN')

        // Validate argument counts
        this.validateFunctionArgs(t.value, args)

        // Track window size for time-series functions
        if (TS_SINGLE_FIELD_FUNCTIONS.has(t.value) || t.value === 'ts_corr' || t.value === 'ts_cov') {
          const nArg = args[args.length - 1]
          if (nArg.type === 'literal' && nArg.value > this.maxWindow) {
            this.maxWindow = nArg.value
          }
        }

        return { type: 'call', fn: t.value, args }
      }

      // Field reference
      if (!FIELD_SQL[t.value]) {
        throw new Error(`未知字段或函数: '${t.value}'`)
      }
      if (!this.referencedFields.includes(t.value)) {
        this.referencedFields.push(t.value)
      }
      return { type: 'field', name: t.value }
    }

    throw new Error(`意外的 token: '${t.value}' 在位置 ${t.pos}`)
  }

  private validateFunctionArgs(fn: string, args: ExpressionNode[]): void {
    const EXPECTED: Record<string, number | [number, number]> = {
      rank: 1,
      zscore: 1,
      log: 1,
      abs: 1,
      sign: 1,
      ts_mean: 2,
      ts_std: 2,
      ts_sum: 2,
      ts_min: 2,
      ts_max: 2,
      ts_rank: 2,
      delay: 2,
      delta: 2,
      ts_corr: 3,
      ts_cov: 3,
      max: 2,
      min: 2,
      if_else: 3,
    }
    const expected = EXPECTED[fn]
    if (expected === undefined) return
    const count = typeof expected === 'number' ? expected : expected[0]
    if (args.length !== count) {
      throw new Error(`函数 '${fn}' 需要 ${count} 个参数，实际给了 ${args.length} 个`)
    }
  }
}

// ── SQL Compiler ──────────────────────────────────────────────────────────────

/** Compile an AST node to a SQL expression fragment */
function compileNode(node: ExpressionNode, tradeDate: string, requiredTables: Set<TableCategory>): string {
  switch (node.type) {
    case 'literal':
      return String(node.value)

    case 'field': {
      const info = FIELD_SQL[node.name]
      for (const t of info.table) requiredTables.add(t)
      return info.sql
    }

    case 'unary':
      return `(-(${compileNode(node.operand, tradeDate, requiredTables)}))`

    case 'binary': {
      const l = compileNode(node.left, tradeDate, requiredTables)
      const r = compileNode(node.right, tradeDate, requiredTables)
      if (node.op === '/') {
        return `(${l} / NULLIF(${r}, 0))`
      }
      // Map comparison ops to SQL
      const opMap: Record<string, string> = {
        '>': '>',
        '<': '<',
        '>=': '>=',
        '<=': '<=',
        '=': '=',
        '!=': '<>',
      }
      const sqlOp = opMap[node.op] ?? node.op
      return `(${l} ${sqlOp} ${r})`
    }

    case 'call':
      return compileCall(node.fn, node.args, tradeDate, requiredTables)
  }
}

function compileCall(
  fn: string,
  args: ExpressionNode[],
  tradeDate: string,
  requiredTables: Set<TableCategory>,
): string {
  switch (fn) {
    // ── Cross-sectional ──────────────────────────────────────────────────────
    case 'rank': {
      const inner = compileNode(args[0], tradeDate, requiredTables)
      return `PERCENT_RANK() OVER (ORDER BY (${inner}))`
    }
    case 'zscore': {
      const inner = compileNode(args[0], tradeDate, requiredTables)
      return `((${inner}) - AVG(${inner}) OVER ()) / NULLIF(STDDEV_SAMP(${inner}) OVER (), 0)`
    }

    // ── Math ─────────────────────────────────────────────────────────────────
    case 'log': {
      const inner = compileNode(args[0], tradeDate, requiredTables)
      return `LN(NULLIF(${inner}, 0))`
    }
    case 'abs': {
      const inner = compileNode(args[0], tradeDate, requiredTables)
      return `ABS(${inner})`
    }
    case 'sign': {
      const inner = compileNode(args[0], tradeDate, requiredTables)
      return `SIGN(${inner})`
    }

    // ── Two-arg point-in-time max/min ────────────────────────────────────────
    case 'max': {
      const a = compileNode(args[0], tradeDate, requiredTables)
      const b = compileNode(args[1], tradeDate, requiredTables)
      return `GREATEST(${a}, ${b})`
    }
    case 'min': {
      const a = compileNode(args[0], tradeDate, requiredTables)
      const b = compileNode(args[1], tradeDate, requiredTables)
      return `LEAST(${a}, ${b})`
    }

    // ── Conditional ──────────────────────────────────────────────────────────
    case 'if_else': {
      const cond = compileNode(args[0], tradeDate, requiredTables)
      const then_ = compileNode(args[1], tradeDate, requiredTables)
      const else_ = compileNode(args[2], tradeDate, requiredTables)
      return `CASE WHEN (${cond}) IS NOT NULL AND (${cond}) <> 0 THEN (${then_}) ELSE (${else_}) END`
    }

    // ── Time-series single-field ─────────────────────────────────────────────
    case 'ts_mean':
    case 'ts_std':
    case 'ts_sum':
    case 'ts_min':
    case 'ts_max':
    case 'ts_rank':
    case 'delay':
    case 'delta': {
      return compileTsSingleField(fn, args, tradeDate, requiredTables)
    }

    // ── Two-field time-series ────────────────────────────────────────────────
    case 'ts_corr':
    case 'ts_cov': {
      return compileTsTwoField(fn, args, tradeDate, requiredTables)
    }

    default:
      throw new Error(`函数 '${fn}' 编译未实现`)
  }
}

function getFieldTsSql(fieldName: string, cat: 'prices' | 'daily_basic' | 'fina_pit'): string {
  const sql = FIELD_TS_SQL[cat][fieldName]
  if (!sql) throw new Error(`字段 '${fieldName}' 在表类别 '${cat}' 中未找到`)
  return sql
}

function buildTsFrom(cat: 'prices' | 'daily_basic' | 'fina_pit'): string {
  switch (cat) {
    case 'prices':
      return `stock_daily_prices d2
        JOIN stock_adjustment_factors af2
          ON af2.ts_code = d2.ts_code AND af2.trade_date = d2.trade_date`
    case 'daily_basic':
      return `stock_daily_valuation_metrics d2`
    case 'fina_pit':
      return `financial_indicator_snapshots d2`
  }
}

function buildTsWhere(cat: 'prices' | 'daily_basic' | 'fina_pit', tradeDate: string, comparison: '<=' | '<'): string {
  // tradeDate is validated by DTO (@Matches /^\d{8}$/) before reaching here — assert format
  if (!/^\d{8}$/.test(tradeDate)) throw new Error('Invalid tradeDate format')
  const dateCol = cat === 'fina_pit' ? 'ann_date' : 'trade_date'
  const extraFina = cat === 'fina_pit' ? `AND d2.ann_date IS NOT NULL\n        ` : ''
  return `${extraFina}AND d2.ts_code = db.ts_code\n        AND d2.${dateCol} ${comparison} '${tradeDate}'::date`
}

function compileTsSingleField(
  fn: string,
  args: ExpressionNode[],
  tradeDate: string,
  requiredTables: Set<TableCategory>,
): string {
  // First arg must be a field ref (for time-series correlation with the outer query)
  const fieldArg = args[0]
  if (fieldArg.type !== 'field') {
    throw new Error(`时序函数 '${fn}' 的第一个参数必须是字段引用（如 close, pe_ttm）`)
  }
  const fieldName = fieldArg.name
  const cat = FIELD_TS_TABLE[fieldName]
  const valSql = getFieldTsSql(fieldName, cat)
  const fromSql = buildTsFrom(cat)
  const nArg = args[1]
  if (nArg.type !== 'literal' || nArg.value < 1 || nArg.value > MAX_WINDOW) {
    throw new Error(`时序函数 '${fn}' 的窗口参数必须是 1~${MAX_WINDOW} 的整数`)
  }
  const n = Math.round(nArg.value)

  switch (fn) {
    case 'ts_mean': {
      const where = buildTsWhere(cat, tradeDate, '<=')
      return `(SELECT AVG(${valSql}) FROM ${fromSql} WHERE ${where} ORDER BY d2.${cat === 'fina_pit' ? 'ann_date' : 'trade_date'} DESC LIMIT ${n})`
    }
    case 'ts_std': {
      const where = buildTsWhere(cat, tradeDate, '<=')
      return `(SELECT STDDEV_SAMP(${valSql}) FROM ${fromSql} WHERE ${where} ORDER BY d2.${cat === 'fina_pit' ? 'ann_date' : 'trade_date'} DESC LIMIT ${n})`
    }
    case 'ts_sum': {
      const where = buildTsWhere(cat, tradeDate, '<=')
      return `(SELECT SUM(${valSql}) FROM ${fromSql} WHERE ${where} ORDER BY d2.${cat === 'fina_pit' ? 'ann_date' : 'trade_date'} DESC LIMIT ${n})`
    }
    case 'ts_min': {
      const where = buildTsWhere(cat, tradeDate, '<=')
      return `(SELECT MIN(${valSql}) FROM ${fromSql} WHERE ${where} ORDER BY d2.${cat === 'fina_pit' ? 'ann_date' : 'trade_date'} DESC LIMIT ${n})`
    }
    case 'ts_max': {
      const where = buildTsWhere(cat, tradeDate, '<=')
      return `(SELECT MAX(${valSql}) FROM ${fromSql} WHERE ${where} ORDER BY d2.${cat === 'fina_pit' ? 'ann_date' : 'trade_date'} DESC LIMIT ${n})`
    }
    case 'ts_rank': {
      // Fraction of past n values that are LESS than the current value (rank in [0,1])
      // current value comes from the outer query's field alias
      const curSql = FIELD_SQL[fieldName].sql
      for (const t of FIELD_SQL[fieldName].table) requiredTables.add(t)
      const where = buildTsWhere(cat, tradeDate, '<=')
      return `(SELECT (COUNT(*) FILTER (WHERE ${valSql} < ${curSql}))::float / NULLIF(COUNT(*), 0) FROM ${fromSql} WHERE ${where} ORDER BY d2.${cat === 'fina_pit' ? 'ann_date' : 'trade_date'} DESC LIMIT ${n})`
    }
    case 'delay': {
      // n days ago (offset n-1)
      const where = buildTsWhere(cat, tradeDate, '<')
      const offset = n - 1
      return `(SELECT ${valSql} FROM ${fromSql} WHERE ${where} ORDER BY d2.${cat === 'fina_pit' ? 'ann_date' : 'trade_date'} DESC OFFSET ${offset} LIMIT 1)`
    }
    case 'delta': {
      // current - n days ago
      const curSql = FIELD_SQL[fieldName].sql
      for (const t of FIELD_SQL[fieldName].table) requiredTables.add(t)
      const where = buildTsWhere(cat, tradeDate, '<')
      const offset = n - 1
      const delaySql = `(SELECT ${valSql} FROM ${fromSql} WHERE ${where} ORDER BY d2.${cat === 'fina_pit' ? 'ann_date' : 'trade_date'} DESC OFFSET ${offset} LIMIT 1)`
      return `(${curSql} - ${delaySql})`
    }
    default:
      throw new Error(`未实现的时序函数 '${fn}'`)
  }
}

function compileTsTwoField(
  fn: string,
  args: ExpressionNode[],
  tradeDate: string,
  requiredTables: Set<TableCategory>,
): string {
  const xArg = args[0]
  const yArg = args[1]
  const nArg = args[2]
  if (xArg.type !== 'field' || yArg.type !== 'field') {
    throw new Error(`函数 '${fn}' 的前两个参数必须是字段引用`)
  }
  if (nArg.type !== 'literal' || nArg.value < 1 || nArg.value > MAX_WINDOW) {
    throw new Error(`函数 '${fn}' 的窗口参数必须是 1~${MAX_WINDOW} 的整数`)
  }
  const n = Math.round(nArg.value)
  const xCat = FIELD_TS_TABLE[xArg.name]
  const yCat = FIELD_TS_TABLE[yArg.name]

  // Both from daily_basic (simplest case)
  if (xCat === 'daily_basic' && yCat === 'daily_basic') {
    const xSql = getFieldTsSql(xArg.name, 'daily_basic')
    const ySql = getFieldTsSql(yArg.name, 'daily_basic')
    const aggFn = fn === 'ts_corr' ? 'CORR' : 'COVAR_SAMP'
    return `(SELECT ${aggFn}(${xSql}, ${ySql}) FROM stock_daily_valuation_metrics d2 WHERE d2.ts_code = db.ts_code AND d2.trade_date <= '${tradeDate}'::date ORDER BY d2.trade_date DESC LIMIT ${n})`
  }
  // Both from prices
  if (xCat === 'prices' && yCat === 'prices') {
    const xSql = getFieldTsSql(xArg.name, 'prices')
    const ySql = getFieldTsSql(yArg.name, 'prices')
    requiredTables.add('prices')
    requiredTables.add('adj')
    const aggFn = fn === 'ts_corr' ? 'CORR' : 'COVAR_SAMP'
    return `(SELECT ${aggFn}(${xSql}, ${ySql}) FROM stock_daily_prices d2 JOIN stock_adjustment_factors af2 ON af2.ts_code = d2.ts_code AND af2.trade_date = d2.trade_date WHERE d2.ts_code = db.ts_code AND d2.trade_date <= '${tradeDate}'::date ORDER BY d2.trade_date DESC LIMIT ${n})`
  }
  // Cross-table: use lateral join
  const xSql = getFieldTsSql(xArg.name, xCat)
  const ySql = getFieldTsSql(yArg.name, yCat)
  const xFrom = buildTsFrom(xCat)
  const yFrom = buildTsFrom(yCat)
  const aggFn = fn === 'ts_corr' ? 'CORR' : 'COVAR_SAMP'
  return `(SELECT ${aggFn}(x_sub.xv, y_sub.yv) FROM (SELECT ${xSql} AS xv, d2.${xCat === 'fina_pit' ? 'ann_date' : 'trade_date'} AS dt FROM ${xFrom} WHERE d2.ts_code = db.ts_code AND d2.${xCat === 'fina_pit' ? 'ann_date' : 'trade_date'} <= '${tradeDate}'::date ORDER BY d2.${xCat === 'fina_pit' ? 'ann_date' : 'trade_date'} DESC LIMIT ${n}) x_sub JOIN (SELECT ${ySql} AS yv, d2.${yCat === 'fina_pit' ? 'ann_date' : 'trade_date'} AS dt FROM ${yFrom} WHERE d2.ts_code = db.ts_code AND d2.${yCat === 'fina_pit' ? 'ann_date' : 'trade_date'} <= '${tradeDate}'::date ORDER BY d2.${yCat === 'fina_pit' ? 'ann_date' : 'trade_date'} DESC LIMIT ${n}) y_sub ON x_sub.dt = y_sub.dt)`
}

// ── FactorExpressionService (Injectable) ─────────────────────────────────────

@Injectable()
export class FactorExpressionService {
  /** Parse expression string into AST. Throws on any syntax/security error. */
  parse(expression: string): ExpressionAST {
    if (expression.length > MAX_EXPR_LENGTH) {
      throw new BadRequestException(`表达式过长（最大 ${MAX_EXPR_LENGTH} 字符）`)
    }

    const tokens = tokenize(expression)
    const parser = new Parser(tokens)
    const root = parser.parse()

    if (parser.maxDepth > MAX_DEPTH) {
      throw new BadRequestException(`表达式嵌套深度超过限制（最大 ${MAX_DEPTH} 层）`)
    }
    if (parser.maxWindow > MAX_WINDOW) {
      throw new BadRequestException(`时序窗口超过限制（最大 ${MAX_WINDOW} 日）`)
    }

    // Compute required tables from referenced fields
    const requiredTables = new Set<TableCategory>()
    for (const field of parser.referencedFields) {
      for (const t of FIELD_SQL[field].table) requiredTables.add(t)
    }

    return {
      root,
      referencedFields: [...new Set(parser.referencedFields)],
      requiredTables,
      maxWindowSize: parser.maxWindow,
      nestingDepth: parser.maxDepth,
    }
  }

  /** Compile AST → CompiledQuery (SQL fragment + metadata). */
  compile(ast: ExpressionAST, tradeDate: string): CompiledQuery {
    const requiredTables = new Set<TableCategory>()
    const sql = compileNode(ast.root, tradeDate, requiredTables)

    // Also add tables from directly referenced fields (the compile pass may not visit all fields)
    for (const field of ast.referencedFields) {
      for (const t of FIELD_SQL[field].table) requiredTables.add(t)
    }

    return {
      sql,
      requiredTables,
      needsFinapit: requiredTables.has('fina_pit'),
      maxWindowSize: ast.maxWindowSize,
    }
  }

  /** Validate without compiling. Returns errors/warnings without throwing. */
  validate(expression: string): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    if (!expression.trim()) {
      return { valid: false, errors: ['表达式不能为空'], warnings: [] }
    }
    if (expression.length > MAX_EXPR_LENGTH) {
      errors.push(`表达式过长（最大 ${MAX_EXPR_LENGTH} 字符，当前 ${expression.length} 字符）`)
      return { valid: false, errors, warnings }
    }

    try {
      const tokens = tokenize(expression)
      const parser = new Parser(tokens)
      parser.parse()

      if (parser.maxDepth > MAX_DEPTH) {
        errors.push(`表达式嵌套深度超过限制（最大 ${MAX_DEPTH} 层，当前 ${parser.maxDepth} 层）`)
      }
      if (parser.maxWindow > MAX_WINDOW) {
        errors.push(`时序窗口超过限制（最大 ${MAX_WINDOW} 日，当前 ${parser.maxWindow} 日）`)
      }
      if (parser.maxWindow > 60) {
        warnings.push(`时序窗口 ${parser.maxWindow} 日较大，可能影响计算性能`)
      }
    } catch (err) {
      errors.push((err as Error).message)
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Build the full SQL query string for a CUSTOM_SQL factor.
   * Returns a SQL string safe to embed via Prisma.raw().
   * The outer query selects { ts_code, factor_value } pairs.
   */
  buildRawQuery(compiled: CompiledQuery, tradeDate: string, universeJoinSql: string): string {
    const { sql, needsFinapit } = compiled

    const pitCte = needsFinapit
      ? `WITH pit_fina AS (
  SELECT DISTINCT ON (ts_code) ts_code, roe, roa, revenue_yoy, netprofit_yoy
  FROM financial_indicator_snapshots
  WHERE ann_date IS NOT NULL AND ann_date <= '${tradeDate}'::date
  ORDER BY ts_code, ann_date DESC
)\n`
      : ''

    const pricesJoin = compiled.requiredTables.has('prices')
      ? `LEFT JOIN stock_daily_prices d ON d.ts_code = db.ts_code AND d.trade_date = db.trade_date
  LEFT JOIN stock_adjustment_factors af ON af.ts_code = d.ts_code AND af.trade_date = d.trade_date`
      : ''

    const finaJoin = needsFinapit ? `LEFT JOIN pit_fina fi ON fi.ts_code = db.ts_code` : ''

    const joins = [pricesJoin, finaJoin].filter(Boolean).join('\n  ')

    return `${pitCte}SELECT db.ts_code, (${sql})::float AS factor_value
FROM stock_daily_valuation_metrics db
INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
${joins ? joins + '\n' : ''}${universeJoinSql ? universeJoinSql + '\n' : ''}LEFT JOIN stock_suspend_events sp ON sp.ts_code = db.ts_code AND sp.trade_date = '${tradeDate}'
WHERE db.trade_date = '${tradeDate}'::date
  AND sb.name NOT LIKE '%ST%'
  AND sb.name NOT LIKE '%退%'
  AND sp.ts_code IS NULL
  AND (sb.list_date IS NULL OR sb.list_date <= ('${tradeDate}'::date - INTERVAL '60 days'))
  AND (${sql}) IS NOT NULL`
  }

  /**
   * Build the paginated factor values query string (with percentile ranking).
   */
  buildPagedQuery(
    compiled: CompiledQuery,
    tradeDate: string,
    universeJoinSql: string,
    pageSize: number,
    offset: number,
    sortDir: 'ASC' | 'DESC',
  ): string {
    const { sql, needsFinapit } = compiled

    const pitCte = needsFinapit
      ? `pit_fina AS (
  SELECT DISTINCT ON (ts_code) ts_code, roe, roa, revenue_yoy, netprofit_yoy
  FROM financial_indicator_snapshots
  WHERE ann_date IS NOT NULL AND ann_date <= '${tradeDate}'::date
  ORDER BY ts_code, ann_date DESC
),\n`
      : ''

    const pricesJoin = compiled.requiredTables.has('prices')
      ? `LEFT JOIN stock_daily_prices d ON d.ts_code = db.ts_code AND d.trade_date = db.trade_date
    LEFT JOIN stock_adjustment_factors af ON af.ts_code = d.ts_code AND af.trade_date = d.trade_date`
      : ''

    const finaJoin = needsFinapit ? `LEFT JOIN pit_fina fi ON fi.ts_code = db.ts_code` : ''
    const joins = [pricesJoin, finaJoin].filter(Boolean).join('\n    ')

    return `WITH ${pitCte}base AS (
  SELECT
    db.ts_code,
    sb.name AS stock_name,
    sb.industry,
    (${sql})::numeric AS raw_value
  FROM stock_daily_valuation_metrics db
  INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
  ${joins ? joins + '\n  ' : ''}${universeJoinSql ? universeJoinSql + '\n  ' : ''}LEFT JOIN stock_suspend_events sp ON sp.ts_code = db.ts_code AND sp.trade_date = '${tradeDate}'
  WHERE db.trade_date = '${tradeDate}'::date
    AND sb.name NOT LIKE '%ST%'
    AND sb.name NOT LIKE '%退%'
    AND sp.ts_code IS NULL
    AND (sb.list_date IS NULL OR sb.list_date <= ('${tradeDate}'::date - INTERVAL '60 days'))
    AND (${sql}) IS NOT NULL
),
ranked AS (
  SELECT ts_code, stock_name, industry, raw_value AS factor_value,
         PERCENT_RANK() OVER (ORDER BY raw_value) AS percentile
  FROM base
)
SELECT ts_code, stock_name, industry, factor_value,
       ROUND(CAST(percentile AS NUMERIC), 4) AS percentile
FROM ranked
ORDER BY factor_value ${sortDir} NULLS LAST
LIMIT ${pageSize} OFFSET ${offset}`
  }

  /**
   * Build the stats query for a CUSTOM_SQL factor.
   */
  buildStatsQuery(compiled: CompiledQuery, tradeDate: string, universeJoinSql: string): string {
    const { sql, needsFinapit } = compiled

    const pitCte = needsFinapit
      ? `WITH pit_fina AS (
  SELECT DISTINCT ON (ts_code) ts_code, roe, roa, revenue_yoy, netprofit_yoy
  FROM financial_indicator_snapshots
  WHERE ann_date IS NOT NULL AND ann_date <= '${tradeDate}'::date
  ORDER BY ts_code, ann_date DESC
)\n`
      : ''

    const pricesJoin = compiled.requiredTables.has('prices')
      ? `LEFT JOIN stock_daily_prices d ON d.ts_code = db.ts_code AND d.trade_date = db.trade_date
  LEFT JOIN stock_adjustment_factors af ON af.ts_code = d.ts_code AND af.trade_date = d.trade_date`
      : ''

    const finaJoin = needsFinapit ? `LEFT JOIN pit_fina fi ON fi.ts_code = db.ts_code` : ''
    const joins = [pricesJoin, finaJoin].filter(Boolean).join('\n  ')

    return `${pitCte}SELECT
  COUNT(*) AS cnt,
  COUNT(*) FILTER (WHERE (${sql}) IS NULL) AS missing,
  AVG((${sql})::numeric) AS mean_val,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (${sql})::numeric) AS median_val,
  STDDEV_SAMP((${sql})::numeric) AS std_val,
  MIN((${sql})::numeric) AS min_val,
  MAX((${sql})::numeric) AS max_val,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY (${sql})::numeric) AS q25_val,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY (${sql})::numeric) AS q75_val
FROM stock_daily_valuation_metrics db
INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
${joins ? joins + '\n' : ''}${universeJoinSql ? universeJoinSql + '\n' : ''}LEFT JOIN stock_suspend_events sp ON sp.ts_code = db.ts_code AND sp.trade_date = '${tradeDate}'
WHERE db.trade_date = '${tradeDate}'::date
  AND sb.name NOT LIKE '%ST%'
  AND sb.name NOT LIKE '%退%'
  AND sp.ts_code IS NULL
  AND (sb.list_date IS NULL OR sb.list_date <= ('${tradeDate}'::date - INTERVAL '60 days'))`
  }
}
