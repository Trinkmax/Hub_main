import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { BalanceArea } from '@/components/administracion/charts/balance-area'
import { EmptyTeach, Panel, PanelError, StatusPill } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import type { CashProjectionRow } from '@/lib/accounting/queries/treasury'
import { formatCentsShort } from '@/lib/money'
import { PROJECTION_SENTENCE, projectionView } from '../_lib/flow-view'

/** El ancla del bloque. */
export const PROJECTION_ANCHOR = 'proximas-semanas'

const TITLE = 'Las próximas 4 semanas'

/** Link adentro de una oración: en el celular el relleno agranda el toque sin separar los renglones. */
const LINK =
  'rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:py-3'

/**
 * «Las próximas 4 semanas»: si con la plata de hoy alcanza para lo que vence.
 * Es una ESTIMACIÓN y lo dice: no sabe cuánto se va a vender, así que el
 * título arranca con «Sin contar lo que vendas…» y lo que falta va en ámbar,
 * nunca en rojo.
 *
 * Antes era una tabla al fondo que desaparecía sin avisar si la lectura
 * fallaba. Ahora el bloque está SIEMPRE: con su dibujo, con «no hay nada que
 * venza», con «primero decime cuánta plata hay» o con el error y «Reintentar».
 */
export function ProjectionBlock({
  projection,
  availableCents,
  known,
  today,
  base,
  canWrite,
}: {
  projection: QueryOutcome<CashProjectionRow[]>
  /** La «Plata disponible» de hoy (la misma de la billetera). */
  availableCents: number
  /** Ese número es un dato (si faltan los saldos iniciales y nada se movió, no lo es). */
  known: boolean
  today: string
  /** `/<bar>/administracion`. */
  base: string
  canWrite: boolean
}) {
  if (!projection.ok) {
    return <PanelError title={TITLE} message={projection.message} />
  }
  const view = projectionView(projection.data, availableCents, { today, known })
  const footer = (
    <>
      Los gastos fijos sin monto no entran en esta cuenta.{' '}
      {canWrite ? (
        <Link href={`${base}/gastos-fijos/completar`} className={LINK}>
          Completarlos
        </Link>
      ) : null}
    </>
  )

  if (view.kind === 'unknown') {
    return (
      <Panel id={PROJECTION_ANCHOR} title={TITLE}>
        <EmptyTeach
          plain
          title={view.title}
          action={
            canWrite ? (
              <Button asChild className="h-11 gap-2">
                <Link href={`${base}/configurar`}>
                  Cargar lo que hay
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            ) : undefined
          }
        >
          Con eso y lo que vence cada semana te decimos si alcanza. {PROJECTION_SENTENCE}
        </EmptyTeach>
      </Panel>
    )
  }

  if (view.kind === 'nothing') {
    return (
      <Panel id={PROJECTION_ANCHOR} title={TITLE} footer={footer}>
        <p className="rounded-xl bg-secondary/50 px-4 py-6 text-sm text-pretty">{view.title}</p>
      </Panel>
    )
  }

  return (
    <Panel id={PROJECTION_ANCHOR} title={view.title} description={view.sentence} footer={footer}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center">
        <BalanceArea
          points={view.points}
          todayIndex={0}
          label="Plata disponible"
          showLegend={false}
          ariaLabel={`${view.title}. ${view.sentence}`}
        />
        {/* La leyenda es la tabla: una semana por renglón, cada número con su palabra. */}
        <ul aria-label="Semana por semana" className="divide-y divide-border/60">
          {view.weeks.map((week) => (
            <li key={week.key} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium">{week.label}</p>
                {week.short ? (
                  <StatusPill tone="warn">
                    faltarían {formatCentsShort(-week.balanceCents)}
                  </StatusPill>
                ) : (
                  <p className="text-sm tabular-nums">
                    <span className="text-muted-foreground">queda </span>
                    <span className="font-medium">{formatCentsShort(week.balanceCents)}</span>
                  </p>
                )}
              </div>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
                {week.inCents === 0 && week.outCents === 0 ? (
                  <span>No entra ni sale nada</span>
                ) : (
                  <>
                    <span className="whitespace-nowrap">
                      <span aria-hidden>↑ </span>entra {formatCentsShort(week.inCents)}
                    </span>
                    <span className="whitespace-nowrap">
                      <span aria-hidden>↓ </span>sale {formatCentsShort(week.outCents)}
                    </span>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}
