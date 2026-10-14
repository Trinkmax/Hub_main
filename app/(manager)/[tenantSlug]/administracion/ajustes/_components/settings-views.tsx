import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartTable } from '@/components/administracion/charts/chart-parts'
import {
  MonthStrip,
  type MonthStripMonth,
  type MonthStripState,
} from '@/components/administracion/charts/month-strip'
import { Panel } from '@/components/administracion/kit/panel'
import { PaperSheet } from '@/components/administracion/kit/paper'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import type { FiscalYearRow, PeriodRow } from '@/lib/accounting/queries/periods'
import type { AccountingSettings } from '@/lib/accounting/queries/settings'
import {
  capitalizeFirst,
  fiscalYearEndOnOrAfter,
  formatDate,
  formatIsoDay,
  formatMonthLabel,
  MONTH_NAMES_SHORT,
} from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { formatCents } from '@/lib/money'
import {
  CLOSED_PERIOD_VOID_LABELS,
  IIBB_REGIME_LABELS,
  IVA_SETTLEMENT_LABELS,
  monthTitle,
  SAS_IVA_CONDITION_LABELS,
  UNINVOICED_SALES_LABELS,
} from '../_lib/labels'
import { formatBp } from '../_lib/percent'
import { ReadOnlyItem } from './form-bits'

/**
 * Lo que ve la contadora en Ajustes (H.17, «lectura»): los mismos datos, con
 * la misma forma, sin campos ni botones. Y los meses del ejercicio, que son
 * iguales para todos. Server-safe.
 */

/** Un dato que falta, dicho: nunca un casillero vacío que parece completo. */
function Missing() {
  return <StatusPill tone="info">Sin cargar</StatusPill>
}

/** Un renglón de la hoja: la etiqueta chica arriba y el dato abajo. */
function SheetItem({
  label,
  children,
  className,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-pretty">{children}</dd>
    </div>
  )
}

/** «Primer ejercicio: del 12/10/2026 al 31/12/2026.» */
export function firstYearSentence(
  settings: Pick<AccountingSettings, 'booksStartDate' | 'fiscalYearEndMonth'>,
): string | null {
  try {
    const end = fiscalYearEndOnOrAfter(settings.booksStartDate, settings.fiscalYearEndMonth)
    return `Primer ejercicio: del ${formatIsoDay(settings.booksStartDate)} al ${formatIsoDay(end)}.`
  } catch {
    return null
  }
}

/** Datos de la SAS, para quien solo lee: la misma hoja de la constancia, con los valores escritos. */
export function SasSettingsView({ settings }: { settings: AccountingSettings }) {
  const firstYear = firstYearSentence(settings)
  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
      <PaperSheet title="Datos de la SAS" aside="como en la constancia" className="lg:col-span-7">
        <dl className="grid gap-5">
          <SheetItem label="CUIT">
            {settings.cuit ? (
              <span className="font-mono text-2xl leading-none font-semibold tabular-nums">
                {formatCuit(settings.cuit)}
              </span>
            ) : (
              <StatusPill tone="warn">Falta</StatusPill>
            )}
          </SheetItem>
          <SheetItem label="Razón social">
            <span className="text-base font-medium text-balance">{settings.legalName}</span>
          </SheetItem>
          <SheetItem label="Domicilio fiscal">{settings.fiscalAddress ?? <Missing />}</SheetItem>
          <SheetItem label="Inicio de actividades">
            {settings.activityStartDate ? formatIsoDay(settings.activityStartDate) : <Missing />}
          </SheetItem>
          <div className="grid gap-5 border-t border-border pt-4 sm:grid-cols-2">
            <SheetItem label="IVA">{SAS_IVA_CONDITION_LABELS[settings.ivaCondition]}</SheetItem>
            <SheetItem label="Ingresos Brutos">
              {IIBB_REGIME_LABELS[settings.iibbRegime]}
              {settings.iibbNumber ? (
                <span className="block text-xs text-muted-foreground tabular-nums">
                  N.º {settings.iibbNumber}
                </span>
              ) : null}
            </SheetItem>
          </div>
        </dl>
      </PaperSheet>
      <Panel title="Los libros" description={firstYear} className="lg:col-span-5">
        <dl className="grid gap-4">
          <ReadOnlyItem label="Se carga desde el">
            <span className="tabular-nums">{formatIsoDay(settings.booksStartDate)}</span>
            <span className="block text-xs text-muted-foreground">
              Todo lo anterior a ese día no se carga: entra como saldos iniciales.
            </span>
          </ReadOnlyItem>
          <ReadOnlyItem label="El ejercicio cierra en">
            {monthTitle(settings.fiscalYearEndMonth)}
          </ReadOnlyItem>
        </dl>
      </Panel>
    </div>
  )
}

/** Ejercicio, para quien solo lee: los mismos dos grupos, con «Reglas contables» a la vista. */
export function PeriodSettingsView({ settings }: { settings: AccountingSettings }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <Panel title="Avisos y vencimientos">
        <dl className="grid gap-4">
          <ReadOnlyItem label="Aviso de que algo vence">
            {settings.dueSoonDays} {settings.dueSoonDays === 1 ? 'día antes' : 'días antes'}
          </ReadOnlyItem>
          <ReadOnlyItem label="El IVA vence el día">
            {settings.ivaDueDay ? settings.ivaDueDay : '—'}
          </ReadOnlyItem>
          <ReadOnlyItem label="Ingresos Brutos vence el día">
            {settings.iibbDueDay ? settings.iibbDueDay : '—'}
          </ReadOnlyItem>
        </dl>
      </Panel>
      <Panel title="Reglas contables" id="reglas">
        <dl className="grid gap-4">
          <ReadOnlyItem label="Liquidación del IVA">
            {IVA_SETTLEMENT_LABELS[settings.ivaSettlementMode]}
          </ReadOnlyItem>
          <ReadOnlyItem label="Tolerancia del IVA">
            {formatCents(settings.vatToleranceCents)}
          </ReadOnlyItem>
          <ReadOnlyItem label="Impuesto al cheque computable">
            Créditos {formatBp(settings.bankTaxCreditComputableBp)} · Débitos{' '}
            {formatBp(settings.bankTaxDebitComputableBp)}
          </ReadOnlyItem>
          <ReadOnlyItem label="Ventas sin factura">
            {UNINVOICED_SALES_LABELS[settings.uninvoicedSalesMode]}
          </ReadOnlyItem>
          <ReadOnlyItem label="Anulaciones de meses cerrados en el Libro IVA">
            {CLOSED_PERIOD_VOID_LABELS[settings.closedPeriodVoidIvaMode]}
          </ReadOnlyItem>
        </dl>
      </Panel>
    </div>
  )
}

// ─── Los meses del ejercicio ─────────────────────────────────────────────────

function periodLabel(p: PeriodRow): string {
  if (p.kind === 'fy_opening') return `Apertura ${p.startsOn.slice(0, 4)}`
  if (p.kind === 'fy_adjustments') return `Ajustes de cierre ${p.endsOn.slice(0, 4)}`
  return formatMonthLabel(p.month)
}

function closedLine(p: { closedAt: string | null; closedByName: string | null }): string {
  const when = p.closedAt ? ` el ${formatDate(p.closedAt)}` : ''
  const who = p.closedByName ? ` por ${p.closedByName}` : ''
  return `Cerrado${when}${who}`
}

/**
 * Cómo está un período hoy. Es la misma regla que usa Libros para su tira de
 * meses (un mes abierto que ya terminó «falta cerrar»; el de hoy está «en
 * curso»; el que no empezó, «no empezó»). El período de ajustes de cierre no
 * es un mes calendario: abierto, se muestra «Abierto» y nada más.
 */
export function periodState(
  p: Pick<PeriodRow, 'kind' | 'status' | 'startsOn' | 'endsOn'>,
  today: string,
): MonthStripState {
  if (p.status === 'closed') return 'closed'
  if (p.kind !== 'month') return 'open'
  if (p.startsOn > today) return 'future'
  if (p.endsOn < today) return 'to_close'
  return 'current'
}

/**
 * «Oct», «Apertura», «Cierre»: lo que entra en una pestaña (53 px en el celular). El período
 * de ajustes de cierre va como «Cierre»: «Ajustes», adentro de la pantalla Ajustes, se leía
 * como el nombre de la sección. Su nombre entero («Ajustes de cierre 2026») está en el
 * globito y en «Ver como tabla».
 */
function stripLabel(p: PeriodRow): string {
  if (p.kind === 'fy_opening') return 'Apertura'
  if (p.kind === 'fy_adjustments') return 'Cierre'
  return capitalizeFirst(MONTH_NAMES_SHORT[Number(p.month.slice(5, 7)) - 1] ?? '')
}

/** Las pestañas de un ejercicio para `MonthStrip`: una por período, con su estado y su link. */
export function yearStrip(
  year: Pick<FiscalYearRow, 'periods'>,
  opts: { today: string; cierresHref: string },
): MonthStripMonth[] {
  return year.periods.map((p) => {
    const state = periodState(p, opts.today)
    const month = p.kind === 'month'
    return {
      key: month ? p.month.slice(0, 7) : `${p.kind}-${p.id}`,
      label: stripLabel(p),
      state,
      title: state === 'closed' ? closedLine(p) : !month ? periodLabel(p) : undefined,
      href:
        state === 'future'
          ? undefined
          : month
            ? `${opts.cierresHref}?mes=${p.month.slice(0, 7)}`
            : opts.cierresHref,
    }
  })
}

/** «Ejercicio 2026: ningún mes cerrado todavía» · «Ejercicio 2026: 2 de 3 meses cerrados». */
export function yearTitle(year: Pick<FiscalYearRow, 'endDate' | 'status' | 'periods'>): string {
  const name = `Ejercicio ${year.endDate.slice(0, 4)}`
  if (year.status === 'closed') return `${name}: cerrado`
  const months = year.periods.filter((p) => p.kind === 'month')
  const closed = months.filter((p) => p.status === 'closed').length
  if (months.length === 0) return name
  if (closed === 0) return `${name}: ningún mes cerrado todavía`
  if (closed === months.length) return `${name}: los ${months.length} meses cerrados`
  return `${name}: ${closed} de ${months.length} meses cerrados`
}

/**
 * Los meses de cada ejercicio (el más nuevo primero) como una tira de
 * pestañas, la misma que usa Libros: de un vistazo, qué está cerrado y en cuál
 * estamos. «Ver como tabla» trae la lista de siempre. Cerrar y reabrir se hace
 * en Libros › Fin de mes.
 */
export function FiscalYearsList({
  years,
  cierresHref,
  today,
}: {
  years: readonly FiscalYearRow[]
  cierresHref: string
  today: string
}) {
  if (years.length === 0) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">
          Todavía no hay ejercicios: se arman solos con la fecha de arranque de los libros.
        </p>
      </Panel>
    )
  }
  return (
    <div className="space-y-4">
      {[...years].reverse().map((year) => (
        <Panel key={year.id}>
          <ChartFrame
            headingLevel="h2"
            title={yearTitle(year)}
            sentence={
              <span className="tabular-nums">
                Del {formatIsoDay(year.startDate)} al {formatIsoDay(year.endDate)}.
                {year.status === 'closed' ? ` ${closedLine(year)}.` : ''}
              </span>
            }
            chart={
              <nav aria-label={`Meses del ejercicio ${year.endDate.slice(0, 4)}`}>
                <MonthStrip months={yearStrip(year, { today, cierresHref })} />
              </nav>
            }
            table={
              <ChartTable
                caption={`Períodos del ejercicio ${year.endDate.slice(0, 4)}`}
                columns={[
                  { key: 'period', label: 'Período' },
                  { key: 'state', label: 'Estado' },
                ]}
                rows={year.periods.map((p) => ({
                  key: p.id,
                  cells: [periodLabel(p), p.status === 'closed' ? closedLine(p) : 'Abierto'],
                }))}
              />
            }
          />
        </Panel>
      ))}
      <p className="text-xs text-muted-foreground">
        Los meses se cierran y se reabren en{' '}
        <Link
          href={cierresHref}
          className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Libros › Fin de mes
        </Link>
        .
      </p>
    </div>
  )
}
