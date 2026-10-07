import { Bell, Receipt } from 'lucide-react'
import type { StatusMap } from '@/components/ui/status-badge'
import type { LiveSession } from '@/lib/floor-plan/queries'

/**
 * Mapas de estado del plano para `StatusBadge` (kit HUB §3.4): la etiqueta y
 * el tono de cada estado viven en un solo lugar, así la vista en vivo, la
 * hoja de la mesa y la lista dicen lo mismo.
 *
 * TODO(lote I → lib): el kit pide estos mapas en `lib/floor-plan/status-meta.ts`;
 * viven acá porque el lote del plano no edita `lib/`. Mudarlos es solo cambiar
 * el import.
 */

/** Lo que una mesa abierta le avisa al salón: la cocina y el pedido de cuenta. */
export type LiveSignal = 'preparing' | 'ready' | 'bill_requested'

export const LIVE_SIGNAL: StatusMap<LiveSignal> = {
  preparing: {
    label: 'En preparación',
    tone: 'warning',
    icon: Bell,
    description: 'La cocina está preparando algo de esta mesa',
  },
  ready: {
    label: 'Lista para servir',
    tone: 'success',
    icon: Bell,
    description: 'La cocina terminó: hay algo para llevar a la mesa',
  },
  bill_requested: {
    label: 'Pidió la cuenta',
    tone: 'danger',
    icon: Receipt,
  },
}

/** Las señales de una sesión, en el orden en que se leen (cocina, después la cuenta). */
export function liveSignals(
  session: Pick<LiveSession, 'kitchen' | 'bill_requested'>,
): LiveSignal[] {
  const out: LiveSignal[] = []
  if (session.kitchen !== 'none') out.push(session.kitchen)
  if (session.bill_requested) out.push('bill_requested')
  return out
}

/** Mesa física activa o desactivada (`physical_tables.active`). */
export type TableActiveStatus = 'active' | 'inactive'

export const TABLE_ACTIVE_STATUS: StatusMap<TableActiveStatus> = {
  active: { label: 'Activa', tone: 'success', description: 'Se puede usar en el salón' },
  inactive: {
    label: 'Inactiva',
    tone: 'neutral',
    description: 'No se usa hasta reactivarla; conserva su historial',
  },
}

export function tableActiveStatus(active: boolean): TableActiveStatus {
  return active ? 'active' : 'inactive'
}
