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
    // pero sí logueamos para investigar después. Sin el payload: puede traer
    // datos personales (CLAUDE.md §9); alcanza con qué se quiso auditar.
    console.error('[audit] failed to write log', {
      action: entry.action,
      entity: entry.entity,
      code: error.code,
    })
  }
}
