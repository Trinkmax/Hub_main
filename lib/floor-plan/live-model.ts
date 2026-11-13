/**
 * El salón en vivo para el dueño — PURO y testeado
 * (`tests/lib/floor-plan-live-model.test.ts`).
 *
 * La pestaña «En vivo» del editor dibuja la misma maqueta que usa el salón, con
 * los estados reales. Los estados salen de `lib/pos/table-state.ts` (nadie los
 * marca a mano); acá solo se juntan con las mesas de la foto del salón
 * (`pos_floor_snapshot`), con el mismo criterio que la pantalla del mozo
 * (`components/pos/floor/floor-live.tsx`).
 */
import {
  deriveFreeState,
  deriveSessionState,
  type FloorSummary,
  needsAttention,
  reservationForTable,
  type TableState,
} from '@/lib/pos/table-state'
import type { FloorSession, FloorSnapshot } from '@/lib/pos/types'
import type { ModelTable } from './model'

export type LiveEntry = {
  tableId: string
  label: string
  capacity: number | null
  /** `null` = mesa sin ubicar en el plano. */
  areaId: string | null
  session: FloorSession | null
  state: TableState
}

/**
 * Una entrada por mesa de la sucursal (las del plano y las sueltas), con su
 * estado a la hora `nowMs` (`nowServiceMinutes` = minutos del día de servicio,
 * para saber qué reserva está por llegar).
 */
export function buildLiveEntries(
  snapshot: FloorSnapshot,
  nowMs: number,
  nowServiceMinutes: number,
): LiveEntry[] {
  const byTable = new Map<string, FloorSession>()
  for (const session of snapshot.sessions) {
    if (session.table_id) byTable.set(session.table_id, session)
  }
  const build = (
    tableId: string,
    label: string,
    capacity: number | null,
    areaId: string | null,
  ): LiveEntry => {
    const session = byTable.get(tableId) ?? null
    const state = session
      ? deriveSessionState(session, nowMs, snapshot.settings)
      : deriveFreeState(reservationForTable(label, snapshot.reservations, nowServiceMinutes))
    return { tableId, label, capacity, areaId, session, state }
  }
  const placed = snapshot.elements
    .filter((el) => el.kind === 'table' && el.table_id)
    .map((el) => build(el.table_id as string, el.table_label ?? '', el.capacity, el.area_id))
  const loose = snapshot.loose_tables.map((t) => build(t.id, t.label, t.capacity, null))
  return [...placed, ...loose]
}

/** El estado de cada mesa, como lo pide la maqueta (por id de mesa). */
export function liveTables(entries: readonly LiveEntry[]): Record<string, ModelTable> {
  const out: Record<string, ModelTable> = {}
  for (const entry of entries) {
    out[entry.tableId] = {
      state: entry.state,
      partySize: entry.session?.party_size ?? null,
      alias: entry.session?.alias ?? null,
      practice: entry.session?.is_practice === true,
    }
  }
  return out
}

/** Cuántas mesas de cada sector tienen algo pendiente (lo que avisa cada pestaña). */
export function pendingByArea(entries: readonly LiveEntry[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const entry of entries) {
    if (entry.areaId && needsAttention(entry.state)) {
      out[entry.areaId] = (out[entry.areaId] ?? 0) + 1
    }
  }
  return out
}

/** El salón en una línea: «12 de 25 mesas · 46 personas · 2 para llevar». */
export function liveSummaryLine(summary: FloorSummary): string {
  const parts = [
    `${summary.open} de ${summary.tables} ${summary.tables === 1 ? 'mesa' : 'mesas'}`,
    `${summary.people} ${summary.people === 1 ? 'persona' : 'personas'}`,
  ]
  if (summary.ready > 0) parts.push(`${summary.ready} para llevar`)
  if (summary.waitingFood > 0) parts.push(`${summary.waitingFood} esperando comida`)
  if (summary.bill > 0) {
    parts.push(`${summary.bill} ${summary.bill === 1 ? 'pidió' : 'pidieron'} la cuenta`)
  }
  if (summary.late > 0) parts.push(`${summary.late} con demora`)
  return parts.join(' · ')
}
