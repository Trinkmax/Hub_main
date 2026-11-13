'use client'

import { ArrowRightLeft, Bell, CircleDot, Receipt, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { MoveTableSheet } from '@/components/floor-plan/move-table-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { refreshLiveFloorAction } from '@/lib/floor-plan/live-actions'
import type { AreaRow, LiveFloorData, LiveTable } from '@/lib/floor-plan/queries'
import { ARSFormat, elapsedLabel } from '@/lib/salon/format'
import { LiveFloor } from './live-floor'

export type LegacyLiveProps = {
  slug: string
  tenantId: string
  /** El sector que se está mirando (el de las pestañas del editor). */
  area: AreaRow
}

/**
 * «En vivo» para los bares SIN el punto de venta: el plano con las sesiones de
 * mesa de siempre (las del salón anterior), tal como venía funcionando. Con el
 * punto de venta prendido se usa la maqueta (`live-pane.tsx`).
 *
 * Lee recién cuando el dueño entra a la pestaña (antes se leía en cada carga
 * del editor, aunque nadie la abriera).
 */
export function LegacyLive({ slug, tenantId, area }: LegacyLiveProps) {
  const router = useRouter()
  const [data, setData] = useState<LiveFloorData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<LiveTable | null>(null)
  const [moving, setMoving] = useState(false)
  const onOpen = useCallback((table: LiveTable) => setDetail(table), [])

  const load = useCallback(async () => {
    setError(null)
    const result = await refreshLiveFloorAction(slug, area.id)
    if (result.ok) setData(result.data)
    else setError('No se pudo leer el salón. Probá de nuevo.')
  }, [slug, area.id])

  useEffect(() => {
    void load()
  }, [load])

  if (!data) {
    return error ? (
      <div className="fpe-empty">
        <h2>No pude leer el salón</h2>
        <p>{error}</p>
        <button type="button" className="fpe-btn fpe-btn-quiet" onClick={() => void load()}>
          Probar de nuevo
        </button>
      </div>
    ) : (
      <p className="fpe-loading" role="status">
        Mirando el salón…
      </p>
    )
  }

  return (
    <div className="fpe-paper fpe-legacy-live">
      <LiveFloor
        slug={slug}
        tenantId={tenantId}
        areas={[area]}
        activeAreaId={area.id}
        initial={data}
        onTableOpen={onOpen}
      />

      <Sheet
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      >
        <SheetContent side="right" className="gap-0">
          <SheetHeader>
            <SheetTitle className="font-serif">
              {detail?.session?.alias ?? detail?.label ?? 'Mesa'}
            </SheetTitle>
            <SheetDescription>
              {detail?.session
                ? 'Estado de la sesión en curso (solo lectura).'
                : 'Mesa libre: no hay sesión abierta.'}
            </SheetDescription>
          </SheetHeader>

          {detail?.session ? (
            <div className="space-y-4 px-6 py-6">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground text-xs uppercase tracking-wider">
                  Gasto acumulado
                </span>
                <span className="font-semibold font-serif text-2xl tabular-nums">
                  {ARSFormat(detail.session.total_cents)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {detail.session.party_size !== null ? (
                  <Badge variant="secondary" className="gap-1">
                    <Users className="size-3" aria-hidden />
                    {detail.session.party_size}{' '}
                    {detail.session.party_size === 1 ? 'comensal' : 'comensales'}
                  </Badge>
                ) : null}
                <Badge variant="outline" className="gap-1">
                  <CircleDot className="size-3" aria-hidden />
                  {elapsedLabel(detail.session.opened_at)}
                </Badge>
                {detail.session.kitchen === 'preparing' ? (
                  <Badge variant="warning" className="gap-1">
                    <Bell className="size-3" aria-hidden />
                    Preparando
                  </Badge>
                ) : null}
                {detail.session.kitchen === 'ready' ? (
                  <Badge variant="success" className="gap-1">
                    <Bell className="size-3" aria-hidden />
                    Lista
                  </Badge>
                ) : null}
                {detail.session.bill_requested ? (
                  <Badge variant="destructive" className="gap-1">
                    <Receipt className="size-3" aria-hidden />
                    Cuenta pedida
                  </Badge>
                ) : null}
              </div>
              <Button variant="outline" className="w-full gap-2" onClick={() => setMoving(true)}>
                <ArrowRightLeft className="size-4" aria-hidden />
                Mover de mesa
              </Button>
              <p className="text-muted-foreground text-xs">
                Cobrar y dividir se hacen desde el salón.
              </p>
            </div>
          ) : (
            <div className="px-6 py-6">
              <p className="text-muted-foreground text-sm">
                Esta mesa no tiene una sesión abierta en este momento.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {detail?.session ? (
        <MoveTableSheet
          slug={slug}
          sessionId={detail.session.id}
          currentTableId={detail.physical_table_id}
          currentLabel={detail.label}
          open={moving}
          onOpenChange={setMoving}
          onMoved={() => {
            setMoving(false)
            setDetail(null)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}
