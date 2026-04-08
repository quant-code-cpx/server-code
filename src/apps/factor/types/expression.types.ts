// ── AST Node types ────────────────────────────────────────────────────────────

export type ExpressionNode =
  | { type: 'literal'; value: number }
  | { type: 'field'; name: string }
  | {
      type: 'binary'
      op: '+' | '-' | '*' | '/' | '>' | '<' | '>=' | '<=' | '=' | '!='
      left: ExpressionNode
      right: ExpressionNode
    }
  | { type: 'unary'; op: '-'; operand: ExpressionNode }
  | { type: 'call'; fn: string; args: ExpressionNode[] }

// ── AST (result of parsing) ───────────────────────────────────────────────────

export interface ExpressionAST {
  root: ExpressionNode
  /** All field identifiers referenced in the expression */
  referencedFields: string[]
  /** Tables required for the outer query JOIN */
  requiredTables: Set<TableCategory>
  /** Maximum time-series window size seen (for planning) */
  maxWindowSize: number
  /** Maximum function nesting depth */
  nestingDepth: number
}

// ── Table categories (for JOIN planning) ─────────────────────────────────────

export type TableCategory = 'prices' | 'adj' | 'daily_basic' | 'fina_pit'

// ── Compiled query (result of SQL compilation) ───────────────────────────────

export interface CompiledQuery {
  /** SQL expression fragment – safe to embed via Prisma.raw() */
  sql: string
  /** Tables required in the outer FROM / JOIN */
  requiredTables: Set<TableCategory>
  /** Whether a PIT fina CTE is needed */
  needsFinapit: boolean
  /** Maximum window size for information only */
  maxWindowSize: number
}

// ── Validation result ─────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  /** Fatal errors that prevent compilation */
  errors: string[]
  /** Non-fatal warnings */
  warnings: string[]
}
