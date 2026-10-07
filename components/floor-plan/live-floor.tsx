'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import {
  ChairsSvg,
  DecorContent,
  decorSurfaceClass,
  decorSurfaceStyle,
} from '@/components/floor-plan/table-glyph'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { refreshLiveFloorAction } from '@/lib/floor-plan/live-actions'
import type { AreaRow, LiveDecor, LiveFloorData, LiveTable } from '@/lib/floor-plan/queries'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'
import { cn } from '@/lib/utils'
import { LiveTableCard } from './live-table-card'
import { PanZoomStage } from './pan-zoom-stage'

// Realtime es el camino principal; esto es la red de seguridad (ver useVisibleInterval).
const SAFETY_NET_INTERVAL_MS = 90_000
const REALTIME_DEBOUNCE_MS = 500

export type LiveFloorProps = {
  slug: string
  tenantId: string
  areas: AreaRow[]
  activeAreaId: string
  initial: LiveFloorData
  onTableOpen: (table: LiveTable) => void
}

// Referencias del dibujo: los mismos colores que el cuerpo de cada mesa en vivo.
const LEGEND = [
  { label: 'Libre', dot: 'bg-success' },
  { label: 'Ocupada', dot: 'bg-warning' },
  { label: 'Pagada', dot: 'bg-info' },
] as const

// Decoración: "poche" sólido (mate, sin sombra) para leerla como base construida
// fija; mismo lenguaje visual que el editor. El color del dueño tiene prioridad.
function DecorBox({ decor }: { decor: LiveDecor }) {
  const isCircle = decor.shape === 'circle'
  const rotation = decor.rotation ?? 0
  return (
    <div
      aria-hidden
      className="absolute"
      style={{
        left: decor.x,
        top: decor.y,
        width: decor.width,
        height: decor.height,
        zIndex: decor.z_index,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'center',
      }}
    >
      {decor.kind === 'bar' ? (
        <ChairsSvg
          shape={decor.shape}
          kind="bar"
          width={decor.width}
          height={decor.height}
          capacity={null}
        />
      ) : null}
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center',
          decorSurfaceClass(decor.kind),
        )}
        style={{
          ...decorSurfaceStyle(decor.kind, decor.color),
          ...(isCircle ? { borderRadius: '50%' } : null),
        }}
      >
        <DecorContent kind={decor.kind} label={decor.label} />
      </div>
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
    // Al montar, sincronizar YA: con staleTimes (next.config.ts) esta pantalla
    // puede venir del Client Router Cache con datos de hasta 30 s; Realtime
    // sólo trae cambios FUTUROS y el safety net recién corre a los 30 s.
    void refresh()

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

    return () => {
      cleanup()
    }
  }, [tenantId, refresh, debouncedRefresh])

  useVisibleInterval(refresh, SAFETY_NET_INTERVAL_MS)

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

  // Mismo criterio que el dibujo (LiveTableCard): abierta = ocupada, pagada =
  // pagada; el resto (sin sesión, fusionada o abandonada) se ve libre.
  const occupied = data.tables.filter((t) => t.session?.status === 'open').length
  const paid = data.tables.filter((t) => t.session?.status === 'paid').length
  const total = data.tables.length
  const free = total - occupied - paid

  return (
    <div className="flex flex-col gap-3">
      {/* Resumen + referencias del dibujo + selector de áreas. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="type-small text-muted-foreground tabular-nums">
            {occupied} {occupied === 1 ? 'ocupada' : 'ocupadas'} · {free}{' '}
            {free === 1 ? 'libre' : 'libres'}
            {paid > 0 ? ` · ${paid} ${paid === 1 ? 'pagada' : 'pagadas'}` : ''} · {total}{' '}
            {total === 1 ? 'mesa' : 'mesas'}
          </p>
          {/* Qué quiere decir cada color del dibujo: el color nunca va solo. */}
          <ul
            aria-label="Referencias del plano"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-muted-foreground"
          >
            {LEGEND.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5">
                <span aria-hidden className={cn('size-2 rounded-full', item.dot)} />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
        {areas.length > 1 ? (
          <SegmentedControl
            aria-label="Área del plano"
            size="sm"
            items={areas.map((a) => ({ value: a.id, label: a.name }))}
            value={activeAreaId}
            onValueChange={onSelectArea}
          />
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
          <LiveTableCard key={t.element_id} table={t} onOpen={onTableOpen} />
        ))}
      </PanZoomStage>
    </div>
  )
}
