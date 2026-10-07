'use client'

import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { Eye, History, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { LandingVersionRow, LandingViewPoint } from '@/lib/landings/queries'
import { cn } from '@/lib/utils'

const numberFormat = new Intl.NumberFormat('es-AR')

/**
 * Visitas + historial de versiones.
 *
 * Las visitas las cuenta el servidor al servir la página (ver
 * app/p/[slug]/route.ts): es el único contador que funciona, porque adentro de
 * la landing publicada Google Analytics queda aislado y no manda nada.
 */
export function HistoryPanel({
  versions,
  views,
  totalViews,
  lastViewedAt,
  pending,
  onView,
  onRestore,
}: {
  versions: LandingVersionRow[]
  views: LandingViewPoint[]
  totalViews: number
  lastViewedAt: string | null
  pending: boolean
  onView: (version: LandingVersionRow) => void
  onRestore: (version: LandingVersionRow) => void
}) {
  const [restoring, setRestoring] = useState<LandingVersionRow | null>(null)

  return (
    <div className="space-y-4">
      <VisitsCard views={views} total={totalViews} lastViewedAt={lastViewedAt} />

      <section className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="border-b border-border/60 px-5 py-3.5">
          <h2 className="font-serif text-lg font-semibold tracking-tight">Historial</h2>
          <p className="text-xs text-muted-foreground">
            Cada vez que guardás queda una copia. Guardamos las últimas 20.
          </p>
        </header>

        {versions.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-8 text-sm text-muted-foreground">
            <History className="size-4 shrink-0" aria-hidden />
            Todavía no guardaste ninguna versión de esta página.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {versions.map((version, index) => (
              <li key={version.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">
                      {format(new Date(version.createdAt), "d 'de' MMM, HH:mm", { locale: es })}
                    </span>
                    {index === 0 ? (
                      <span className="text-[11px] uppercase tracking-[0.14em] text-primary">
                        Actual
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {version.label ?? 'Guardada'} · {Math.max(1, Math.round(version.chars / 1024))}{' '}
                    KB ·{' '}
                    {formatDistanceToNow(new Date(version.createdAt), {
                      locale: es,
                      addSuffix: true,
                    })}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => onView(version)}
                  >
                    <Eye className="size-4" aria-hidden />
                    Ver
                  </Button>
                  {index === 0 ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => setRestoring(version)}
                    >
                      <RotateCcw className="size-4" aria-hidden />
                      Restaurar
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={restoring !== null} onOpenChange={(open) => !open && setRestoring(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Volver a esta versión?</AlertDialogTitle>
            <AlertDialogDescription>
              El código del editor se reemplaza por el de esa fecha. Lo que tenés ahora queda
              guardado en el historial, así que podés volver.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                if (restoring) onRestore(restoring)
                setRestoring(null)
              }}
            >
              Restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Total + últimos 14 días. Barras a mano: pesa menos que traer una librería. */
function VisitsCard({
  views,
  total,
  lastViewedAt,
}: {
  views: LandingViewPoint[]
  total: number
  lastViewedAt: string | null
}) {
  const max = Math.max(1, ...views.map((point) => point.views))
  const period = views.reduce((sum, point) => sum + point.views, 0)

  return (
    <section className="card-hairline overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 px-5 py-3.5">
        <div>
          <h2 className="font-serif text-lg font-semibold tracking-tight">Visitas</h2>
          <p className="text-xs text-muted-foreground">
            {lastViewedAt
              ? `Última visita ${formatDistanceToNow(new Date(lastViewedAt), { locale: es, addSuffix: true })}`
              : 'Todavía no la abrió nadie.'}
          </p>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-semibold tabular-nums leading-none">
            {numberFormat.format(total)}
          </div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            en total
          </div>
        </div>
      </header>

      <div className="px-5 py-4">
        <div className="flex h-24 items-end gap-1" aria-hidden>
          {views.map((point) => (
            <div
              key={point.day}
              title={`${format(new Date(`${point.day}T00:00:00`), "EEEE d 'de' MMM", { locale: es })}: ${point.views} ${point.views === 1 ? 'visita' : 'visitas'}`}
              className="flex-1"
            >
              <div
                className={cn(
                  'w-full rounded-t-sm transition-[height] duration-[var(--duration-base)]',
                  point.views > 0 ? 'bg-primary/70' : 'bg-border/70',
                )}
                style={{
                  // Los días en cero se ven como una rayita: el gráfico tiene que
                  // mostrar el hueco, no esconderlo.
                  height: point.views > 0 ? `${Math.max(8, (point.views / max) * 96)}px` : '2px',
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {views[0]
              ? format(new Date(`${views[0].day}T00:00:00`), "d 'de' MMM", { locale: es })
              : ''}
          </span>
          <span className="font-medium text-foreground">
            {numberFormat.format(period)} en {views.length} días
          </span>
          <span>Hoy</span>
        </div>
      </div>
    </section>
  )
}
