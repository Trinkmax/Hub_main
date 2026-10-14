import { InstallmentDots } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/installment-dots'
import { TickBox } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/tick-box'
import {
  installmentWords,
  papelLabel,
  weekdayDay,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla-words'
import { Amount } from '@/components/administracion/amount'
import { LedgerRail, Panel } from '@/components/administracion/kit'
import { recurringInstallment } from '@/lib/accounting/recurring-status'
import {
  formatDayMonth,
  formatIsoDay,
  MONTH_NAMES_SHORT,
  WEEKDAY_NAMES_SHORT,
  weekdayOf,
} from '@/lib/dates'
import { cn } from '@/lib/utils'
import { nthDue, type RecurringFrequency } from '../../../_lib/recurring'

/**
 * «Así queda en tu planilla»: el renglón del gasto fijo que se está cargando,
 * dibujado con las mismas piezas de la planilla (el margen del día, el
 * casillero, los puntitos de cuotas) y armándose en vivo mientras se completa
 * la ficha. Debajo, sus próximos tres vencimientos.
 *
 * Es el equivalente del ticket del cierre del día: se ve qué se está armando
 * antes de guardar. Es un dibujo: no paga ni lee nada.
 */
export function RowPreview({
  name,
  accountName,
  voucherType,
  partyName,
  amountCents,
  nextDueDate,
  dueDay,
  frequency,
  dues,
  installmentsTotal,
  today,
  className,
}: {
  name: string
  accountName: string | null
  voucherType: string | null
  partyName: string | null
  /** `null` = sin monto. */
  amountCents: number | null
  nextDueDate: string
  dueDay: number
  frequency: RecurringFrequency
  /** Cuotas que faltan contando la próxima (`null` = no termina). */
  dues: number | null
  installmentsTotal: number | null
  today: string
  className?: string
}) {
  const blank = name.trim() === ''
  const paper = papelLabel(voucherType)
  const subline = [accountName, paper === 'Sin factura' ? 'sin factura' : paper, partyName]
    .filter(Boolean)
    .join(' · ')
  const installment =
    dues !== null && dues > 0
      ? recurringInstallment({ remainingDues: dues, installmentsTotal })
      : null
  const cuota = installmentWords(installment)
  const isToday = nextDueDate === today
  const count = dues === null ? 3 : Math.min(3, Math.max(0, dues))
  const upcoming = Array.from({ length: count }, (_, index) => ({
    date: nthDue(nextDueDate, dueDay, frequency, index + 1),
    cuota:
      installment?.current != null && installment.total !== null
        ? `cuota ${installment.current + index}`
        : null,
  }))
  const endsAfter = dues !== null && dues > 0 && dues <= 3

  return (
    <Panel title="Así queda en tu planilla" className={className}>
      <div className="mt-3 overflow-hidden rounded-xl border border-border/70">
        <div className="flex">
          <LedgerRail
            label={MONTH_NAMES_SHORT[Number(nextDueDate.slice(5, 7)) - 1]}
            value={String(Number(nextDueDate.slice(8, 10)))}
            unit={isToday ? 'hoy' : WEEKDAY_NAMES_SHORT[weekdayOf(nextDueDate)]}
          />
          <div className="flex min-w-0 flex-1 items-start gap-2.5 border-l border-adm-s5/35 p-3">
            <TickBox state="empty" label="Sin pagar" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'line-clamp-2 font-medium leading-snug [overflow-wrap:anywhere]',
                  blank && 'text-muted-foreground',
                )}
              >
                {blank ? 'Tu gasto fijo' : name}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                {subline || 'Todavía sin categoría'}
              </p>
              {cuota && installment ? (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <InstallmentDots
                    current={installment.current}
                    total={installment.total}
                    remaining={installment.remaining}
                  />
                  {cuota}
                </p>
              ) : null}
              <p className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-medium tabular-nums">
                  {amountCents === null ? (
                    <span className="text-muted-foreground">Sin monto</span>
                  ) : (
                    <Amount cents={amountCents} decimals={0} />
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  Vence el {weekdayDay(nextDueDate)}
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {upcoming.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Los próximos
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {upcoming.map((due) => (
              <li
                key={due.date}
                className="rounded-full bg-secondary px-2.5 py-1 text-xs tabular-nums"
                title={formatIsoDay(due.date)}
              >
                {formatDayMonth(due.date)}
                {due.cuota ? <span className="text-muted-foreground"> · {due.cuota}</span> : null}
              </li>
            ))}
          </ul>
          {endsAfter ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Después de la última sale sola de la planilla.
            </p>
          ) : null}
        </div>
      ) : null}

      {amountCents === null ? (
        <p className="mt-3 text-xs text-muted-foreground text-pretty">
          Sin monto no suma en «Te falta de gasto fijo».
        </p>
      ) : null}
    </Panel>
  )
}
