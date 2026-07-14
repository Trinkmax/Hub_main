'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { saveFlowGraphPayloadSchema, validateFlowGraph } from './graph-schemas'

export type FlowGraphActionState =
  | { ok: true; id: string; message?: string }
  | { ok: false; message: string }

async function authorizeOwner(slug: string) {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])
    return access
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

export async function saveFlowGraph(slug: string, payload: unknown): Promise<FlowGraphActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }

  let parsed: ReturnType<typeof saveFlowGraphPayloadSchema.parse>
  try {
    parsed = saveFlowGraphPayloadSchema.parse(payload)
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }

  // Structural graph validation
  const graphError = validateFlowGraph(parsed)
  if (graphError) return { ok: false, message: graphError }

  const service = createServiceClient()

  // Upsert the flow row
  let flowId: string

  if (parsed.id) {
    // Update existing flow — verify it belongs to this tenant first
    const { error: updateErr } = await service
      .from('flows')
      .update({
        name: parsed.name,
        active: parsed.active,
        trigger_type: parsed.trigger.type,
        trigger_config: parsed.trigger as unknown as never,
      })
      .eq('id', parsed.id)
      .eq('tenant_id', access.tenant.id)

    if (updateErr) return { ok: false, message: updateErr.message }
    flowId = parsed.id
  } else {
    // Insert new flow
    const { data: newFlow, error: insertErr } = await service
      .from('flows')
      .insert({
        tenant_id: access.tenant.id,
        name: parsed.name,
        active: parsed.active,
        trigger_type: parsed.trigger.type,
        trigger_config: parsed.trigger as unknown as never,
      })
      .select('id')
      .single()

    if (insertErr || !newFlow) return { ok: false, message: insertErr?.message ?? 'insert failed' }
    flowId = newFlow.id
  }

  // Preservar ejecuciones en curso: el FK flow_executions.current_node_id es
  // ON DELETE SET NULL, así que borrar los nodos anularía el puntero y el próximo
  // tick reenviaría desde el trigger (bug de la auditoría). Capturamos el puntero
  // ANTES de borrar y (en edición) pausamos los ticks mientras reescribimos el grafo.
  const runningExecs = parsed.id
    ? ((
        await service
          .from('flow_executions')
          .select('id, current_node_id')
          .eq('flow_id', flowId)
          .eq('status', 'running')
      ).data ?? [])
    : []
  if (runningExecs.length > 0) {
    await service
      .from('flow_executions')
      .update({ next_run_at: new Date(Date.now() + 60_000).toISOString() })
      .eq('flow_id', flowId)
      .eq('status', 'running')
  }

  // Replace graph: delete existing nodes (cascades edges) then re-insert
  const { error: deleteErr } = await service.from('flow_nodes').delete().eq('flow_id', flowId)
  if (deleteErr) return { ok: false, message: deleteErr.message }

  if (parsed.nodes.length > 0) {
    const nodeRows = parsed.nodes.map((n) => ({
      id: n.id,
      flow_id: flowId,
      kind: n.kind,
      position: n.position as unknown as never,
      config: n.config as unknown as never,
    }))

    const { error: nodesErr } = await service.from('flow_nodes').insert(nodeRows)
    if (nodesErr) return { ok: false, message: nodesErr.message }
  }

  if (parsed.edges.length > 0) {
    const edgeRows = parsed.edges.map((e) => ({
      id: e.id,
      flow_id: flowId,
      source_node_id: e.source,
      target_node_id: e.target,
      source_handle: e.sourceHandle,
    }))

    const { error: edgesErr } = await service.from('flow_edges').insert(edgeRows)
    if (edgesErr) return { ok: false, message: edgesErr.message }
  }

  // Restaurar/cancelar ejecuciones según si su paso sobrevivió a la reescritura.
  let cancelled = 0
  if (runningExecs.length > 0) {
    const survivingNodeIds = new Set(parsed.nodes.map((n) => n.id))
    const nowIso = new Date().toISOString()
    for (const ex of runningExecs) {
      if (ex.current_node_id && survivingNodeIds.has(ex.current_node_id)) {
        // El paso sigue existiendo → restauramos el puntero (el delete lo anuló) y reanudamos.
        await service
          .from('flow_executions')
          .update({ current_node_id: ex.current_node_id, next_run_at: nowIso })
          .eq('id', ex.id)
      } else if (ex.current_node_id) {
        // El paso donde estaba fue eliminado → no se puede continuar coherentemente.
        await service
          .from('flow_executions')
          .update({
            status: 'cancelled',
            completed_at: nowIso,
            error: 'paso eliminado al editar el flow',
          })
          .eq('id', ex.id)
        cancelled += 1
      } else {
        // Aún no había arrancado (current_node_id null) → reanudamos desde el trigger.
        await service.from('flow_executions').update({ next_run_at: nowIso }).eq('id', ex.id)
      }
    }
  }

  revalidatePath(`/${slug}/mensajeria/flows`)
  return {
    ok: true,
    id: flowId,
    message:
      cancelled > 0
        ? `Flow guardado. Se cancelaron ${cancelled} ejecución(es) en curso porque su paso fue eliminado.`
        : undefined,
  }
}
