'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { refreshLiveFloorAction } from '@/lib/floor-plan/live-actions'
import type { AreaRow, LiveDecor, LiveFloorData, LiveTable } from '@/lib/floor-plan/queries'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { cn } from '@/lib/utils'
import { LiveTableCard } from './live-table-card'
import { PanZoomStage } from './pan-zoom-stage'

const SAFETY_NET_INTERVAL_MS = 30_000
const REALTIME_DEBOUNCE_MS = 500

export type LiveFloorProps = {
  slug: string
  tenantId: string
  areas: AreaRow[]
  activeAreaId: string
  initial: LiveFloorData
  onTableOpen: (table: LiveTable) => void
}

// Decoración: "poche" sólido (mate, sin sombra) para leerla como base construida
// fija; mismo lenguaje visual que el editor. El color del dueño tiene prioridad.
function DecorBox({ decor }: { decor: LiveDecor }) {
  const isCircle = decor.shape === 'circle'
  return (
    <div
      aria-hidden
      className={cn(
        'absolute border-2 border-wall-border text-wall-foreground',
        isCircle ? 'rounded-full' : 'rounded-md',
      )}
      style={{
        left: decor.x,
        top: decor.y,
        width: decor.width,
        height: decor.height,
        zIndex: decor.z_index,
        backgroundColor: decor.color ?? 'var(--wall)',
      }}
    >
      {decor.label ? (
        <span className="pointer-events-none flex h-full w-full items-center justify-center px-1 text-center text-[10px] font-medium">
          {decor.label}
        </span>
      ) : null}
    </div>
  )
}

export function LiveFloor({
  slug,
  tenantId,
  areas,
  activeAreaId: initialAreaId,
  initial,
  onTableOpen,
}: LiveFloorProps) {
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null)
  const [activeAreaId, setActiveAreaId] = useState<string>(initialAreaId)
  const [data, setData] = useState<LiveFloorData>(initial)

  // El área activa real para refetch; un ref evita reiniciar la suscripción
  // Realtime cada vez que cambia (el canal está scopeado por tenant, no por área).
  const activeAreaRef = useRef(activeAreaId)
  useEffect(() => {
    activeAreaRef.current = activeAreaId
  }, [activeAreaId])

  const refresh = useCallback(async () => {
    const res = await refreshLiveFloorAction(slug, activeAreaRef.current)
    if (res.ok) setData(res.data)
  }, [slug])

  const debouncedRefresh = useDebouncedRefresh(refresh, REALTIME_DEBOUNCE_MS)

  // Suscripción Realtime (una sola, por tenant) + safety net.
  useEffect(() => {
    const cleanup = subscribeChanges({
      channel: `live-${tenantId}`,
      events: [
        {
          event: '*',
          table: 'table_sessions',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: debouncedRefresh,
        },
        {
          event: '*',
          table: 'tickets',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: debouncedRefresh,
        },
      ],
    })

    const safetyNet = window.setInterval(() => {
      void refresh()
    }, SAFETY_NET_INTERVAL_MS)

    return () => {
      cleanup()
      window.clearInterval(safetyNet)
    }
  }, [tenantId, refresh, debouncedRefresh])

  // Cambio de área activa → refetch inmediato (no esperar al debounce/Realtime).
  const onSelectArea = useCallback(
    (id: string) => {
      if (id === activeAreaRef.current) return
      setActiveAreaId(id)
      activeAreaRef.current = id
      void refresh()
    },
    [refresh],
  )

  const occupied = data.tables.filter((t) => t.session?.status === 'open').length
  const total = data.tables.length
  const free = total - occupied

  return (
    <div className="space-y-3">
      {/* Resumen + selector de áreas. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular-nums">
          {occupied} {occupied === 1 ? 'ocupada' : 'ocupadas'} · {free}{' '}
          {free === 1 ? 'libre' : 'libres'} · {total} {total === 1 ? 'mesa' : 'mesas'}
        </p>
        {areas.length > 1 ? (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Seleccionar área">
            {areas.map((a) => {
              const selected = a.id === activeAreaId
              return (
                <button
                  key={a.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onSelectArea(a.id)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/70 bg-card text-muted-foreground hover:bg-muted',
                  )}
                >
                  {a.name}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <PanZoomStage
        width={data.area.width}
        height={data.area.height}
        transformRef={transformRef}
        interactive={false}
      >
        {data.decor.map((d) => (
          <DecorBox key={d.element_id} decor={d} />
        ))}
        {data.tables.map((t) => (
          <LiveTableCard key={t.element_id} table={t} onOpen={() => onTableOpen(t)} />
        ))}
      </PanZoomStage>
    </div>
  )
}
