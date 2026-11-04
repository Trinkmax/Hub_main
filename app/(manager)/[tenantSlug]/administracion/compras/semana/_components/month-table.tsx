import Link from 'next/link'
import type { ReactNode } from 'react'
import { Planilla, PRow, PTable, PTd, PTh, PTotalRow } from '@/components/administracion/planilla'
import type { MonthPlan } from '@/lib/accounting/week-plan'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { NoAmount, SheetEmpty } from '../../_components/planilla-bits'
import { weekPlanHref } from '../../_lib/links'

/** La primera columna queda quieta al deslizar: con tantas columnas, si no, se pierde de quién es. */
const STICKY = 'sticky left-0 z-[1] border-r border-border/60 bg-card'

function Money({ cents }: { cents: number }) {
  return cents === 0 ? <NoAmount /> : formatCentsShort(cents)
}

/** La variación: más de lo presupuestado va en rojo y con su signo. */
function Variation({ cents }: { cents: number }) {
  if (cents === 0) return <NoAmount />
  return (
    <span className={cn(cents > 0 && 'text-destructive')}>
      {formatCentsShort(cents, { sign: 'always' })}
    </span>
  )
}

function GroupHead({ colSpan, children }: { colSpan?: number; children?: ReactNode }) {
  return (
    <th
      scope="colgroup"
      colSpan={colSpan}
      className="border-b border-l border-border/70 bg-secondary/50 px-3 py-2 text-center text-[11px] font-semibold tracking-wide whitespace-nowrap text-muted-foreground"
    >
      {children}
    </th>
  )
}

/**
 * «Ver el mes»: las semanas una al lado de la otra, sin editar. Proveedor · Compró, Presup. y Pagó de
 * cada semana · Total presupuesto · Total pagado · Variación (pagado menos presupuesto). Tocar una
 * semana abre su planilla.
 */
export function MonthTable({ tenantSlug, plan }: { tenantSlug: string; plan: MonthPlan }) {
  return (
    <Planilla>
      {plan.rows.length === 0 ? (
        <SheetEmpty>Este mes todavía no hay presupuesto ni movimientos.</SheetEmpty>
      ) : (
        <PTable
          label="Plan del mes, por semana"
          minWidth={220 + plan.weeks.length * 3 * 92 + 3 * 116}
        >
          <thead>
            <tr>
              <th
                scope="col"
                rowSpan={2}
                className={cn(
                  STICKY,
                  'border-b border-border bg-secondary px-3 py-2 text-left align-bottom text-[11px] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase',
                )}
              >
                Proveedor
              </th>
              {plan.weeks.map((week) => (
                <GroupHead key={week} colSpan={3}>
                  <Link
                    href={weekPlanHref(tenantSlug, { semana: week })}
                    className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Semana del {formatDayMonth(week)}
                  </Link>
                </GroupHead>
              ))}
              <GroupHead colSpan={3}>Total del mes</GroupHead>
            </tr>
            <tr>
              {plan.weeks.map((week) => (
                <WeekHeads key={week} />
              ))}
              <PTh align="right" className="border-l border-border/70">
                Total presupuesto
              </PTh>
              <PTh align="right">Total pagado</PTh>
              <PTh align="right">Variación</PTh>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((row) => (
              <PRow key={row.partyId}>
                <PTd className={cn(STICKY, 'max-w-[14rem] truncate')}>{row.partyName}</PTd>
                {row.cells.map((cell, index) => (
                  <WeekCells key={plan.weeks[index] ?? index} cell={cell} />
                ))}
                <PTd align="right" className="border-l border-border/60">
                  <Money cents={row.budgetCents} />
                </PTd>
                <PTd align="right">
                  <Money cents={row.paidCents} />
                </PTd>
                <PTd align="right">
                  <Variation cents={row.variationCents} />
                </PTd>
              </PRow>
            ))}
          </tbody>
          <tfoot>
            <PTotalRow>
              <PTd>Total</PTd>
              {plan.totals.cells.map((cell, index) => (
                <WeekCells key={plan.weeks[index] ?? index} cell={cell} />
              ))}
              <PTd align="right">{formatCentsShort(plan.totals.budgetCents)}</PTd>
              <PTd align="right">{formatCentsShort(plan.totals.paidCents)}</PTd>
              <PTd align="right">
                <Variation cents={plan.totals.variationCents} />
              </PTd>
            </PTotalRow>
          </tfoot>
        </PTable>
      )}
    </Planilla>
  )
}

function WeekHeads() {
  return (
    <>
      <PTh align="right" className="border-l border-border/70">
        Compró
      </PTh>
      <PTh align="right">Presup.</PTh>
      <PTh align="right">Pagó</PTh>
    </>
  )
}

function WeekCells({ cell }: { cell: MonthPlan['totals']['cells'][number] }) {
  return (
    <>
      <PTd align="right" className="border-l border-border/60">
        <Money cents={cell.purchasedCents} />
      </PTd>
      <PTd align="right">
        <Money cents={cell.budgetCents} />
      </PTd>
      <PTd align="right">
        <Money cents={cell.paidCents} />
      </PTd>
    </>
  )
}
