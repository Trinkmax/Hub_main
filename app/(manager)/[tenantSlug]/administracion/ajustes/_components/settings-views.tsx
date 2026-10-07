import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { FiscalYearRow, PeriodRow } from '@/lib/accounting/queries/periods'
import type { AccountingSettings } from '@/lib/accounting/queries/settings'
import { formatDate, formatIsoDay, formatMonthLabel } from '@/lib/dates'
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
 * Lo que ve la contadora en Ajustes (H.17, «lectura»): los mismos datos, sin
 * campos ni botones. Y la lista de ejercicios y meses, que es igual para
 * todos. Server-safe.
 */

const CARD = 'card-hairline rounded-xl border bg-card p-6'

export function SasSettingsView({ settings }: { settings: AccountingSettings }) {
  return (
    <dl className={`${CARD} grid gap-5 sm:grid-cols-2`}>
      <ReadOnlyItem label="Razón social">{settings.legalName}</ReadOnlyItem>
      <ReadOnlyItem label="CUIT">
        {settings.cuit ? (
          <span className="tabular-nums">{formatCuit(settings.cuit)}</span>
        ) : (
          <span className="text-muted-foreground">Sin cargar</span>
        )}
      </ReadOnlyItem>
      <ReadOnlyItem label="Condición frente al IVA">
        {SAS_IVA_CONDITION_LABELS[settings.ivaCondition]}
      </ReadOnlyItem>
      <ReadOnlyItem label="Ingresos Brutos">
        {IIBB_REGIME_LABELS[settings.iibbRegime]}
        {settings.iibbNumber ? ` · N° ${settings.iibbNumber}` : ''}
      </ReadOnlyItem>
      <ReadOnlyItem label="Inicio de actividades">
        {settings.activityStartDate ? formatIsoDay(settings.activityStartDate) : '—'}
      </ReadOnlyItem>
      <ReadOnlyItem label="Domicilio fiscal">{settings.fiscalAddress ?? '—'}</ReadOnlyItem>
      <ReadOnlyItem label="Los libros arrancan el">
        {formatIsoDay(settings.booksStartDate)}
      </ReadOnlyItem>
      <ReadOnlyItem label="Cierre del ejercicio">
        {monthTitle(settings.fiscalYearEndMonth)}
      </ReadOnlyItem>
    </dl>
  )
}

export function PeriodSettingsView({ settings }: { settings: AccountingSettings }) {
  return (
    <dl className={`${CARD} grid gap-5 sm:grid-cols-2`}>
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
      <ReadOnlyItem label="«Vence pronto»">
        {settings.dueSoonDays} {settings.dueSoonDays === 1 ? 'día' : 'días'}
      </ReadOnlyItem>
      <ReadOnlyItem label="Vencimiento del IVA">
        {settings.ivaDueDay ? `Día ${settings.ivaDueDay}` : '—'}
      </ReadOnlyItem>
      <ReadOnlyItem label="Vencimiento de IIBB">
        {settings.iibbDueDay ? `Día ${settings.iibbDueDay}` : '—'}
      </ReadOnlyItem>
    </dl>
  )
}

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
 * «Ejercicio 2026 · 01/10/2026 al 31/12/2026 · Abierto» y sus meses con su
 * estado (H.17). Cerrar y reabrir se hace en Libros › Cierres.
 */
export function FiscalYearsList({
  years,
  cierresHref,
}: {
  years: readonly FiscalYearRow[]
  cierresHref: string
}) {
  if (years.length === 0) {
    return (
      <p className={`${CARD} text-sm text-muted-foreground`}>
        Todavía no hay ejercicios: se arman solos con la fecha de arranque de los libros.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      {[...years].reverse().map((year) => (
        <section key={year.id} className="card-hairline overflow-hidden rounded-xl border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="min-w-0">
              <h3 className="font-serif text-lg font-semibold tracking-tight">
                Ejercicio {year.endDate.slice(0, 4)}
              </h3>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatIsoDay(year.startDate)} al {formatIsoDay(year.endDate)}
              </p>
            </div>
            {year.status === 'closed' ? (
              <Badge variant="muted">{closedLine(year)}</Badge>
            ) : (
              <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                Abierto
              </Badge>
            )}
          </header>
          <ul className="divide-y divide-border/60">
            {year.periods.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5 text-sm"
              >
                <span className="font-medium">{periodLabel(p)}</span>
                <span className="text-xs text-muted-foreground">
                  {p.status === 'closed' ? closedLine(p) : 'Abierto'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">
        Los meses se cierran y se reabren en{' '}
        <Link
          href={cierresHref}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Libros › Cierres de mes
        </Link>
        .
      </p>
    </div>
  )
}
