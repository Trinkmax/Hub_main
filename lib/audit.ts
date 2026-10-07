import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'

type AuditEntry = {
  tenantId: string
  userId: string | null
  action: string
  entity: string
  entityId?: string | null
  payload?: Record<string, unknown>
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  const service = createServiceClient()
  const { error } = await service.from('audit_log').insert({
    tenant_id: entry.tenantId,
    user_id: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    payload: entry.payload ?? {},
  })
  if (error) {
    // No bloqueamos la operación principal por un fallo de auditoría;
    // pero sí logueamos para investigar después.
    console.error('[audit] failed to write log', { entry, error })
  }
}
