import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { compileFilter, paramsToJsonb } from './compiler'
import type { AudienceFilter } from './schemas'

export type AudienceEvaluation = {
  customerIds: string[]
  total: number
}

export async function evaluateAudience(
  tenantId: string,
  filters: AudienceFilter,
  opts?: { limit?: number },
): Promise<AudienceEvaluation> {
  const compiled = compileFilter(filters)
  const service = createServiceClient()
  const { data, error } = await service.rpc('evaluate_audience_query', {
    p_tenant_id: tenantId,
    p_where: compiled.where,
    p_params: paramsToJsonb(compiled.params) as never,
    p_limit: opts?.limit ?? null,
  })
  if (error) throw new Error(`evaluateAudience: ${error.message}`)
  const rows = (data ?? []) as Array<{ customer_id: string; count_total: number }>
  return {
    customerIds: rows.map((r) => r.customer_id),
    total: rows[0]?.count_total ?? 0,
  }
}

export async function refreshAudienceCount(audienceId: string): Promise<number> {
  const service = createServiceClient()
  const { data: aud, error: audErr } = await service
    .from('audiences')
    .select('tenant_id, filters')
    .eq('id', audienceId)
    .maybeSingle()
  if (audErr || !aud) throw new Error(audErr?.message ?? 'audience not found')
  const filters = aud.filters as unknown as AudienceFilter
  const result = await evaluateAudience(aud.tenant_id, filters, { limit: 1 })
  await service
    .from('audiences')
    .update({
      customer_count_cached: result.total,
      last_calculated_at: new Date().toISOString(),
    })
    .eq('id', audienceId)
  return result.total
}

export async function materializeAudience(audienceId: string): Promise<string[]> {
  const service = createServiceClient()
  const { data: aud, error: audErr } = await service
    .from('audiences')
    .select('tenant_id, filters')
    .eq('id', audienceId)
    .maybeSingle()
  if (audErr || !aud) throw new Error(audErr?.message ?? 'audience not found')
  const filters = aud.filters as unknown as AudienceFilter
  const result = await evaluateAudience(aud.tenant_id, filters)
  return result.customerIds
}
