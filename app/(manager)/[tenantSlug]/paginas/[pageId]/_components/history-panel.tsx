'use client'

import { Eye, History, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Section } from '@/components/ui/section'
import { formatDayMonth, formatLongDate } from '@/lib/dates'
import { formatNumber } from '@/lib/format/number-kind'
import type { LandingVersionRow, LandingViewPoint } from '@/lib/landings/queries'
import { cn } from '@/lib/utils'
import { whenLabel } from '../../_components/page-status'

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
  today,
  pending,
  onView,
  onRestore,
}: {
  versions: LandingVersionRow[]
  views: LandingViewPoint[]
  totalViews: number
  lastViewedAt: string | null
  /** Hoy en Córdoba, resuelto en el server («Hoy 14:32» igual en los dos lados). */
  today: string
  pending: boolean
  onView: (version: LandingVersionRow) => void
  onRestore: (version: LandingVersionRow) => void
}) {
  // La versión queda guardada mientras el diálogo se cierra: así el texto no
  // se vacía durante la animación de salida.
  const [restoreTarget, setRestoreTarget] = useState<LandingVersionRow | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Visitas"
        description={
          lastViewedAt
            ? `Última visita: ${whenLabel(lastViewedAt, today, { withTime: true, lowercase: true })}.`
            : 'Todavía no la abrió nadie.'
        }
      >
        <VisitsChart views={views} total={totalViews} />
      </Section>

      <Section
        title="Historial"
        description="Cada vez que guardás queda una copia. Guardamos las últimas 20."
      >
        {versions.length === 0 ? (
          <EmptyState
            size="sm"
            icon={History}
            title="Todavía no hay versiones"
            description="Cuando guardes la página, acá queda una copia de cada cambio para volver atrás."
          />
        ) : (
          <ol
            aria-label="Versiones guardadas, de la más nueva a la más vieja"
            className="divide-y divide-border overflow-clip rounded-xl border border-border bg-card"
          >
            {versions.map((version, index) => (
              <li key={version.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="type-body font-medium text-foreground">
                      {whenLabel(version.createdAt, today, { withTime: true })}
                    </span>
                    {index === 0 ? <Badge tone="brand">Actual</Badge> : null}
                  </div>
                  <p className="type-small text-muted-foreground">
                    {version.label ?? 'Guardada'} ·{' '}
                    <span className="type-amount">
                      {formatNumber(Math.max(1, Math.round(version.chars / 1024)))} KB
                    </span>
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => onView(version)}
                  >
                    <Eye aria-hidden />
                    Ver
                  </Button>
                  {index === 0 ? null : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        setRestoreTarget(version)
                        setRestoreOpen(true)
                      }}
                    >
                      <RotateCcw aria-hidden />
                      Restaurar
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        icon={RotateCcw}
        title="¿Volver a esta versión?"
        description={
          restoreTarget
            ? `El código del editor se reemplaza por el de esa versión (${whenLabel(restoreTarget.createdAt, today, { withTime: true, lowercase: true })}). Lo que tenés ahora queda guardado en el historial, así que podés volver.`
            : undefined
        }
        confirmLabel="Restaurar versión"
        onConfirm={() => {
          if (restoreTarget) onRestore(restoreTarget)
        }}
      />
    </div>
  )
}

/** Total + últimos 14 días. Barras a mano: pesa menos que traer una librería. */
function VisitsChart({ views, total }: { views: LandingViewPoint[]; total: number }) {
  const max = Math.max(1, ...views.map((point) => point.views))
  const period = views.reduce((sum, point) => sum + point.views, 0)
  const first = views[0]

  return (
    <Card padding="sm" className="gap-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <p className="flex items-baseline gap-2">
          <span className="type-kpi text-foreground">{formatNumber(total)}</span>
          <span className="type-small text-muted-foreground">
            {total === 1 ? 'visita en total' : 'visitas en total'}
          </span>
        </p>
        <p className="type-small text-muted-foreground">
          <span className="type-amount font-medium text-foreground">{formatNumber(period)}</span> en
          los últimos {views.length} días
        </p>
      </div>

      {/* Las barras son decorativas: el resumen de arriba ya dice los números. */}
      <div className="flex h-24 items-end gap-1" aria-hidden>
        {views.map((point) => (
          <div
            key={point.day}
            title={`${formatLongDate(point.day)}: ${point.views} ${point.views === 1 ? 'visita' : 'visitas'}`}
            className="flex-1"
          >
            <div
              className={cn('w-full rounded-t-sm', point.views > 0 ? 'bg-primary' : 'bg-border')}
              style={{
                // Los días en cero se ven como una rayita: el gráfico tiene que
                // mostrar el hueco, no esconderlo.
                height: point.views > 0 ? `${Math.max(8, (point.views / max) * 96)}px` : '2px',
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between type-caption text-muted-foreground">
        <span className="type-amount">{first ? formatDayMonth(first.day) : ''}</span>
        <span>Hoy</span>
      </div>
    </Card>
  )
}
