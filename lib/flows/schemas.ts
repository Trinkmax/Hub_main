import { z } from 'zod'

const sendTemplateConfig = z.object({
  type: z.literal('send_template'),
  channel_id: z.string().uuid(),
  template_id: z.string().uuid(),
  variables: z.array(z.string()).default([]),
})

const waitConfig = z.object({
  type: z.literal('wait'),
  // Duración en minutos para simplificar (1..43200 = hasta 30 días).
  minutes: z.number().int().min(1).max(43_200),
})

const conditionConfig = z.object({
  type: z.literal('condition'),
  // Comparamos contra un campo del context o del customer en runtime.
  // Para v1: { field: 'customer.opt_in_marketing' | 'context.replied', op, value }
  field: z.string().min(1),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_true', 'is_false']),
  value: z.unknown().optional(),
  // Saltos relativos (skip si false). Default: avanza 1 si true, salta a `else_offset` si false.
  else_offset: z.number().int().min(1).default(1),
})

const addTagConfig = z.object({
  type: z.literal('add_tag'),
  tag_id: z.string().uuid(),
})

export const flowStepConfigSchema = z.discriminatedUnion('type', [
  sendTemplateConfig,
  waitConfig,
  conditionConfig,
  addTagConfig,
])
export type FlowStepConfig = z.infer<typeof flowStepConfigSchema>

const inactiveTriggerCfg = z.object({
  type: z.literal('customer_inactive'),
  days: z.number().int().min(1).max(365),
})
const birthdayTriggerCfg = z.object({ type: z.literal('birthday') })
const afterVisitTriggerCfg = z.object({ type: z.literal('after_visit') })
const eventStartingTriggerCfg = z.object({
  type: z.literal('event_starting'),
  hours_before: z.number().int().min(1).max(168),
})
const tagAddedTriggerCfg = z.object({
  type: z.literal('tag_added'),
  tag_id: z.string().uuid().optional(),
})

export const flowTriggerConfigSchema = z.discriminatedUnion('type', [
  inactiveTriggerCfg,
  birthdayTriggerCfg,
  afterVisitTriggerCfg,
  eventStartingTriggerCfg,
  tagAddedTriggerCfg,
])
export type FlowTriggerConfig = z.infer<typeof flowTriggerConfigSchema>

export const flowCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  trigger: flowTriggerConfigSchema,
  steps: z.array(flowStepConfigSchema).min(1).max(20),
  active: z.boolean().default(false),
})
export type FlowCreateInput = z.infer<typeof flowCreateSchema>

export const flowUpdateSchema = flowCreateSchema.extend({ id: z.string().uuid() })
export type FlowUpdateInput = z.infer<typeof flowUpdateSchema>
