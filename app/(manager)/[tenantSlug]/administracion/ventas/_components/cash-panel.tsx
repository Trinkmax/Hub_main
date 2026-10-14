import { ArrowRight } from 'lucide-react'
import { Panel, PanelLink } from '@/components/administracion/kit'
import { cashDiffText, type Projection } from '@/lib/accounting/projection'
import type { CashCountTreasury, DailyCashCounts } from '@/lib/accounting/queries/projection'
import { formatWeekdayDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cashTitle } from '../_lib/almanac'
import { CashCountDialog } from './cash-count-dialog'
import { CashTable, cashPending } from './cash-table'
import { FOLD_SUMMARY, FoldChevron } from './projection-panel'
import { longDay } from './projection-table'

/**
 * El bloque «Ventas contra caja» de «El mes» (pedido de los socios): lo vendido
 * en el salón contra la plata que entró ese día en cada caja, para encontrar
 * diferencias. No cambia ningún saldo, y la pantalla lo dice.
 *
 * Arriba va la conclusión («En 8 noches anotadas, faltan $ 12.400»); la tabla
 * noche por noche queda plegada. Se llega con `?tab=caja` (el link de siempre):
 * ahí viene abierta. Para quien solo mira también.
 */
export function CashPanel({
  projection,
  counts,
  treasuries,
  monthLabel,
  base,
  canWrite,
  open,
}: {
  projection: Projection
  counts: DailyCashCounts
  treasuries: readonly CashCountTreasury[]
  /** «Octubre 2026». */
  monthLabel: string
  /** `/<bar>/administracion`. */
  base: string
  canWrite: boolean
  /** La tabla viene abierta (se entró con `?tab=caja`, o es quien solo mira). */
  open: boolean
}) {
  const { cash } = projection
  const hasCloses = projection.days.some((d) => d.hasClose)
  const compared = cash.comparedDays > 0
  const pending = cashPending(cash)
  // La acción al lado del aviso: anotar la última noche con cierre a la que le falta lo que
  // entró (el mismo diálogo de la tabla, sin tener que abrirla).
  const lastUncounted = canWrite
    ? projection.days.filter((d) => d.cash.kind === 'missing_count').at(-1)
    : undefined
  const lastInitial = lastUncounted ? (counts[lastUncounted.day] ?? {}) : {}

  return (
    <Panel id="caja" title="Ventas contra caja">
      <p className="font-serif text-xl font-semibold leading-snug tracking-tight text-balance">
        {cashTitle(cash, { reader: !canWrite })}
      </p>
      <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
        Compara lo vendido en el salón (sin las comisiones estimadas de las tarjetas) con la plata
        que entró ese día en cada caja. Las apps de delivery no cuentan: pagan después. No cambia
        ningún saldo: sirve para encontrar diferencias.
      </p>

      {compared ? (
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Vendido en el salón</dt>
            <dd className="font-serif text-2xl font-semibold tracking-tight tabular-nums">
              {formatCentsShort(cash.salesCents)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Entró</dt>
            <dd className="font-serif text-2xl font-semibold tracking-tight tabular-nums">
              {formatCentsShort(cash.countedCents)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Diferencia</dt>
            <dd
              className={
                cash.diffCents < 0
                  ? 'font-serif text-2xl font-semibold tracking-tight tabular-nums text-warning-text'
                  : 'font-serif text-2xl font-semibold tracking-tight tabular-nums'
              }
            >
              {cashDiffText(cash.diffCents)}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="mt-4 rounded-xl bg-secondary/50 p-3 text-sm">
        <p className="text-pretty">
          ¿Contaste los billetes al cerrar? Eso va en el cierre del día (paso 2) y sí corrige la
          caja.
        </p>
        {canWrite ? (
          <PanelLink href={`${base}/ventas/cierre`} className="mt-1">
            Ir al cierre
            <ArrowRight aria-hidden className="size-3.5" />
          </PanelLink>
        ) : null}
      </div>

      {pending.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <ul className="min-w-0 space-y-1 text-sm text-muted-foreground">
            {pending.map((text) => (
              <li key={text} className="flex items-start gap-2 text-pretty">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
                {text}
              </li>
            ))}
          </ul>
          {lastUncounted ? (
            <CashCountDialog
              trigger="button"
              buttonLabel={`Anotar lo que entró el ${formatWeekdayDayMonth(lastUncounted.day)}`}
              day={lastUncounted.day}
              dayLabel={longDay(lastUncounted.day)}
              treasuries={treasuries.filter((t) => t.active || lastInitial[t.id] !== undefined)}
              initial={lastInitial}
              salesCents={lastUncounted.realCents}
              countedCents={null}
            />
          ) : null}
        </div>
      ) : null}

      {hasCloses || cash.missingCloseDays > 0 ? (
        <details open={open} className="group/fold mt-4 border-t border-border/60 pt-2">
          <summary className={FOLD_SUMMARY}>
            Ver noche por noche
            <FoldChevron />
          </summary>
          <div className="pt-2">
            <CashTable
              bare
              projection={projection}
              counts={counts}
              treasuries={treasuries}
              monthLabel={monthLabel}
              base={base}
              canWrite={canWrite}
            />
          </div>
        </details>
      ) : (
        <p className="mt-4 border-t border-border/60 pt-4 text-sm text-muted-foreground text-pretty">
          Todavía no hay noches para comparar: primero {canWrite ? 'cargá' : 'hay que cargar'} un
          cierre.
        </p>
      )}
    </Panel>
  )
}
