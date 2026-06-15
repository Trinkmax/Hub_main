import { z } from 'zod'

export const variableSourceSchema = z.object({
  source: z.enum(['first_name', 'last_name', 'phone', 'custom']),
  value: z.string().optional(),
  fallback: z.string().optional(),
})
export const variableMappingSchema = z.record(z.string(), variableSourceSchema)
export type VariableSource = z.infer<typeof variableSourceSchema>
export type VariableMapping = z.infer<typeof variableMappingSchema>

export type ResolvableCustomer = { first_name: string; last_name: string; phone: string }

export function templateBodyParamCount(components: unknown): number {
  if (!Array.isArray(components)) return 0
  const body = components.find(
    (c) =>
      typeof c === 'object' &&
      c !== null &&
      String((c as { type?: string }).type).toUpperCase() === 'BODY',
  ) as { text?: string } | undefined
  const text = body?.text ?? ''
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g)
  return matches ? new Set(matches.map((m) => m.replace(/\D/g, ''))).size : 0
}

export function resolveTemplateVariables(
  mapping: VariableMapping,
  customer: ResolvableCustomer,
  count: number,
): string[] {
  const out: string[] = []
  for (let i = 1; i <= count; i += 1) {
    const def = mapping[String(i)]
    out.push(def ? resolveOne(def, customer) : '')
  }
  return out
}

function resolveOne(def: VariableSource, customer: ResolvableCustomer): string {
  if (def.source === 'custom') return def.value ?? ''
  const raw =
    def.source === 'first_name'
      ? customer.first_name
      : def.source === 'last_name'
        ? customer.last_name
        : customer.phone
  return raw && raw.trim().length > 0 ? raw : (def.fallback ?? '')
}
