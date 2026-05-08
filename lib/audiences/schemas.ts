import { z } from 'zod'

// Campos disponibles en el builder. Allowlist estricta — el compilador a SQL
// solo aceptará estos. Cualquier otro field rechaza con error.
export const CONDITION_FIELDS = [
  'opt_in_marketing',
  'birth_month',
  'days_since_last_visit',
  'visits_count',
  'total_spent_cents',
  'points_balance',
  'created_days_ago',
  'has_tag',
  'attended_event_id',
  'source',
] as const
export type ConditionField = (typeof CONDITION_FIELDS)[number]

export const CONDITION_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'is_true',
  'is_false',
  'is_null',
  'is_not_null',
] as const
export type ConditionOp = (typeof CONDITION_OPS)[number]

const conditionSchema = z.object({
  kind: z.literal('condition'),
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(CONDITION_OPS),
  value: z.unknown(),
})

const staticListSchema = z.object({
  kind: z.literal('static_list'),
  customer_ids: z.array(z.string().uuid()).max(50000),
})

export type AudienceCondition = z.infer<typeof conditionSchema>
export type AudienceStaticList = z.infer<typeof staticListSchema>

export type AudienceFilter =
  | AudienceCondition
  | AudienceStaticList
  | { kind: 'group'; op: 'AND' | 'OR'; nodes: AudienceFilter[] }

const groupSchema: z.ZodType<AudienceFilter> = z.lazy(() =>
  z.union([
    conditionSchema,
    staticListSchema,
    z.object({
      kind: z.literal('group'),
      op: z.enum(['AND', 'OR']),
      nodes: z.array(groupSchema),
    }),
  ]),
)

export const audienceFilterSchema = groupSchema

export const audienceCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filters: audienceFilterSchema,
})
export type AudienceCreateInput = z.infer<typeof audienceCreateSchema>

export const audienceUpdateSchema = audienceCreateSchema.extend({
  id: z.string().uuid(),
})
export type AudienceUpdateInput = z.infer<typeof audienceUpdateSchema>

export const EMPTY_FILTER: AudienceFilter = { kind: 'group', op: 'AND', nodes: [] }
