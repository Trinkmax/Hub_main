'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { refreshLiveModelAction } from '@/lib/floor-plan/live-actions'
import {
  buildLiveEntries,
  type LiveEntry,
  liveTables,
  pendingByArea,
} from '@/lib/floor-plan/live-model'
import type { ModelTable } from '@/lib/floor-plan/model'
import { type FloorSummary, serviceMinutesAt, summarize } from '@/lib/pos/table-state'
import type { FloorSnapshot } from '@/lib/pos/types'
import { useLiveReload } from '@/lib/pos/use-live-reload'
import { type LiveStatus, usePosPoke } from '@/lib/pos/use-poke'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'

export type LiveModel = {
  /** `null` mientras se pide la primera foto del salón. */
  snapshot: FloorSnapshot | null
  /** Si la foto no se pudo leer, por qué. */
  error: string | null
  /** El canal en vivo: se dice en pantalla si se corta. */
  connection: LiveStatus
  entries: LiveEntry[]
  tables: Record<string, ModelTable>
  /** Mesas con algo pendiente por sector. */
  pending: Record<string, number>
  summary: FloorSummary | null
  reload: () => Promise<void>
}

const EMPTY_ENTRIES: LiveEntry[] = []

/**
 * El salón en vivo de una sucursal, para la pestaña «En vivo» del editor.
 *
 * Mientras `enabled` es falso no pide ni escucha nada (el dueño está editando).
 * Al prenderse lee la foto del salón y se suscribe a los avisos de la sucursal
 * (`usePosPoke`): cada aviso vuelve a leer. Si un aviso se pierde, una red de
 * seguridad vuelve a leer cada 40 s mientras la pestaña está a la vista.
 */
export function useLiveModel({
  enabled,
  slug,
  branchId,
  timeZone,
}: {
  enabled: boolean
  slug: string
  branchId: string | null
  timeZone: string
}): LiveModel {
  const [snapshot, setSnapshot] = useState<FloorSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const active = enabled && branchId !== null
  const activeRef = useRef(active)
  activeRef.current = active

  const read = useCallback(async () => {
    if (!activeRef.current || !branchId) return
    try {
      const result = await refreshLiveModelAction(slug, branchId)
      if (result.ok) {
        setSnapshot(result.data)
        setError(null)
      } else {
        setError(result.message)
      }
    } catch {
      setError('No se pudo leer el salón. Revisá la conexión.')
    }
  }, [slug, branchId])
  // Un aviso que llega mientras se está leyendo no se pierde: se lee de nuevo al terminar.
  const { poke, now: reload } = useLiveReload(read)

  // Al entrar a «En vivo»: leer YA (la foto anterior puede ser vieja).
  useEffect(() => {
    if (active) void reload()
  }, [active, reload])

  const connection = usePosPoke(active ? branchId : null, poke)
  useVisibleInterval(reload, 40_000)

  // El reloj de la computadora puede estar corrido: se usa la hora de la base y se la hace avanzar acá.
  const serverNow = snapshot?.now ?? null
  const offset = useRef(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!serverNow) return
    offset.current = Date.parse(serverNow) - Date.now()
    setNow(Date.now() + offset.current)
  }, [serverNow])
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now() + offset.current), 15_000)
    return () => window.clearInterval(timer)
  }, [active])

  const entries = useMemo(() => {
    if (!snapshot) return EMPTY_ENTRIES
    return buildLiveEntries(snapshot, now, serviceMinutesAt(new Date(now), timeZone))
  }, [snapshot, now, timeZone])

  const tables = useMemo(() => liveTables(entries), [entries])
  const pending = useMemo(() => pendingByArea(entries), [entries])
  const summary = useMemo(
    () =>
      snapshot
        ? summarize(
            entries.map((e) => ({ state: e.state, partySize: e.session?.party_size ?? null })),
          )
        : null,
    [snapshot, entries],
  )

  return { snapshot, error, connection, entries, tables, pending, summary, reload }
}
