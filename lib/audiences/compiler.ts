import type { AudienceFilter, ConditionField, ConditionOp } from './schemas'

// Param "tipado" para evaluate_audience_query: { type, value }.
// type debe ser un identificador SQL (uuid, text, int, bigint, bool, date).
// El RPC reescribe los placeholders del where ($2, $3, …) reemplazándolos
// por `quote_literal(value)::type` — solo el value se literal-escapea, el
// type viene de allowlist en Node, no del usuario.
export type SqlParam =
  | { type: 'uuid'; value: string | null }
  | { type: 'text'; value: string | null }
  | { type: 'int'; value: number | null }
  | { type: 'bigint'; value: number | null }
  | { type: 'bool'; value: boolean | null }
  | { type: 'date'; value: string | null }

export type CompiledAudience = {
  where: string
  params: SqlParam[]
}

export class InvalidFilterError extends Error {
  readonly code = 'invalid_filter'
}

const SCALAR_OPS: ReadonlyArray<ConditionOp> = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
const NULL_OPS: ReadonlyArray<ConditionOp> = ['is_null', 'is_not_null']
const BOOL_OPS: ReadonlyArray<ConditionOp> = ['is_true', 'is_false']
const SET_OPS: ReadonlyArray<ConditionOp> = ['in', 'not_in']

const SQL_OP: Record<ConditionOp, string> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  in: 'IN',
  not_in: 'NOT IN',
  is_true: 'IS TRUE',
  is_false: 'IS FALSE',
  is_null: 'IS NULL',
  is_not_null: 'IS NOT NULL',
}

// Cómo se proyecta cada campo del builder al SQL final.
// Los que llevan EXISTS subselect se compilan completos (no van por placeholder
// del operador estándar) — esos manejan su propio op/value adentro.
type FieldKind = 'scalar' | 'subquery'
type FieldDef = {
  kind: FieldKind
  // Para scalar: expresión a la izquierda del operador.
  expr?: string
  paramType?: SqlParam['type']
  allowedOps: ReadonlyArray<ConditionOp>
}

const FIELDS: Record<ConditionField, FieldDef> = {
  opt_in_marketing: {
    kind: 'scalar',
    expr: 'c.opt_in_marketing',
    paramType: 'bool',
    allowedOps: ['is_true', 'is_false', 'eq', 'neq'],
  },
  birth_month: {
    kind: 'scalar',
    expr: 'extract(month from c.birthdate)::int',
    paramType: 'int',
    allowedOps: ['eq', 'neq', 'in', 'not_in'],
  },
  days_since_last_visit: {
    // null si nunca visitó: lo tratamos como infinito en gt/gte y lo dejamos
    // fuera en lt/lte automáticamente.
    kind: 'scalar',
    expr: '(extract(epoch from (now() - c.last_visit_at)) / 86400)::int',
    paramType: 'int',
    allowedOps: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  },
  visits_count: {
    kind: 'scalar',
    expr: 'c.total_visits',
    paramType: 'int',
    allowedOps: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  },
  total_spent_cents: {
    kind: 'scalar',
    expr: 'c.total_spent_cents',
    paramType: 'bigint',
    allowedOps: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  },
  points_balance: {
    kind: 'scalar',
    expr: 'c.points_balance',
    paramType: 'int',
    allowedOps: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  },
  created_days_ago: {
    kind: 'scalar',
    expr: '(extract(epoch from (now() - c.created_at)) / 86400)::int',
    paramType: 'int',
    allowedOps: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  },
  source: {
    kind: 'scalar',
    expr: 'c.source::text',
    paramType: 'text',
    allowedOps: ['eq', 'neq', 'in', 'not_in'],
  },
  has_tag: { kind: 'subquery', allowedOps: ['eq', 'neq'] },
  attended_event_id: { kind: 'subquery', allowedOps: ['eq', 'neq'] },
}

class Compiler {
  private params: SqlParam[] = []

  compile(filter: AudienceFilter): CompiledAudience {
    const where = this.compileNode(filter)
    return { where, params: this.params }
  }

  private addParam(p: SqlParam): string {
    // p_tenant_id ocupa $1; los nuestros van desde $2.
    this.params.push(p)
    return `$${this.params.length + 1}`
  }

  private compileNode(node: AudienceFilter): string {
    if (node.kind === 'group') {
      if (node.nodes.length === 0) return 'true'
      const parts = node.nodes.map((n) => this.compileNode(n))
      const joined = parts.join(node.op === 'AND' ? ' AND ' : ' OR ')
      return `(${joined})`
    }
    if (node.kind === 'static_list') {
      if (node.customer_ids.length === 0) return 'false'
      const placeholders = node.customer_ids
        .map((id) => this.addParam(coerce('uuid', id)))
        .join(', ')
      return `c.id IN (${placeholders})`
    }
    return this.compileCondition(node)
  }

  private compileCondition(c: AudienceFilter & { kind: 'condition' }): string {
    const def = FIELDS[c.field]
    if (!def) throw new InvalidFilterError(`unknown field ${c.field}`)
    if (!def.allowedOps.includes(c.op)) {
      throw new InvalidFilterError(`op ${c.op} not allowed for ${c.field}`)
    }
    if (def.kind === 'subquery') {
      return this.compileSubquery(c.field, c.op, c.value)
    }
    return this.compileScalar(def, c.op, c.value)
  }

  private compileScalar(def: FieldDef, op: ConditionOp, value: unknown): string {
    if (!def.expr || !def.paramType) {
      throw new InvalidFilterError('field misconfigured')
    }
    const paramType = def.paramType
    if (NULL_OPS.includes(op)) {
      return `${def.expr} ${SQL_OP[op]}`
    }
    if (BOOL_OPS.includes(op)) {
      return `${def.expr} ${SQL_OP[op]}`
    }
    if (SET_OPS.includes(op)) {
      const arr = Array.isArray(value) ? value : []
      if (arr.length === 0) {
        // IN () es inválido; emitimos siempre-falso (eq) o siempre-verdadero (not_in).
        return op === 'in' ? 'false' : 'true'
      }
      const placeholders = arr.map((v) => this.addParam(coerce(paramType, v))).join(', ')
      return `${def.expr} ${SQL_OP[op]} (${placeholders})`
    }
    if (SCALAR_OPS.includes(op)) {
      const ph = this.addParam(coerce(paramType, value))
      return `${def.expr} ${SQL_OP[op]} ${ph}`
    }
    throw new InvalidFilterError(`unsupported op ${op}`)
  }

  private compileSubquery(field: ConditionField, op: ConditionOp, value: unknown): string {
    const negate = op === 'neq'
    if (field === 'has_tag') {
      const ph = this.addParam(coerce('uuid', value))
      const inner =
        `select 1 from public.customer_tag_assignments cta` +
        ` where cta.customer_id = c.id and cta.tag_id = ${ph}`
      return negate ? `NOT EXISTS (${inner})` : `EXISTS (${inner})`
    }
    if (field === 'attended_event_id') {
      const ph = this.addParam(coerce('uuid', value))
      const inner =
        `select 1 from public.reservations r` +
        ` where r.customer_id = c.id and r.event_id = ${ph} and r.status = 'checked_in'`
      return negate ? `NOT EXISTS (${inner})` : `EXISTS (${inner})`
    }
    throw new InvalidFilterError(`unhandled subquery field ${field}`)
  }
}

function coerce(type: SqlParam['type'], raw: unknown): SqlParam {
  if (raw === null || raw === undefined) {
    return { type, value: null } as SqlParam
  }
  switch (type) {
    case 'uuid': {
      const s = String(raw)
      if (!/^[0-9a-fA-F-]{36}$/.test(s)) {
        throw new InvalidFilterError(`invalid uuid: ${s}`)
      }
      return { type: 'uuid', value: s }
    }
    case 'text':
      return { type: 'text', value: String(raw) }
    case 'int': {
      const n = Number(raw)
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new InvalidFilterError(`invalid int: ${String(raw)}`)
      }
      return { type: 'int', value: n }
    }
    case 'bigint': {
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new InvalidFilterError(`invalid bigint: ${String(raw)}`)
      return { type: 'bigint', value: Math.trunc(n) }
    }
    case 'bool': {
      if (typeof raw === 'boolean') return { type: 'bool', value: raw }
      if (raw === 'true' || raw === 'false') return { type: 'bool', value: raw === 'true' }
      throw new InvalidFilterError(`invalid bool: ${String(raw)}`)
    }
    case 'date': {
      const s = String(raw)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        throw new InvalidFilterError(`invalid date: ${s}`)
      }
      return { type: 'date', value: s }
    }
  }
}

export function compileFilter(filter: AudienceFilter): CompiledAudience {
  return new Compiler().compile(filter)
}

export function paramsToJsonb(params: SqlParam[]): unknown {
  return params.map((p) => ({ type: p.type, value: p.value }))
}
