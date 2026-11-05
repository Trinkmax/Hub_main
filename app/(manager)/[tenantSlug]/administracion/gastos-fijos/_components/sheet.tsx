'use client'

import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Fragment, type ReactNode, useCallback, useState } from 'react'
import { useSheetData } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/use-sheet-data'
import {
  comprasHref,
  gastosFijosFillHref,
  gastosFijosHref,
  recurringHref,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import { loadSheetData } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-actions'
import { useAccounting } from '@/components/administracion/accounting-provider'
import {
  PHONE_FIT,
  PHONE_HIDDEN,
  Planilla,
  PlanillaFoot,
  PRow,
  PTable,
  PTd,
  PTh,
  PTotalRow,
} from '@/components/administracion/planilla'
import { Button } from '@/components/ui/button'
import { payrollHref } from '@/lib/accounting/payroll'
import { endOfMonth, formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  type AutoTaxPlan,
  monthWord,
  type PayrollSums,
  payrollRowStatus,
  type Sheet,
  type SheetItem,
  type SheetStretch,
  type SheetTotals,
  sheetCarry,
} from '../_lib/planilla-words'
import { AMOUNT_ALIGN } from './cell-money'
import { StatusMark } from './row-status'
import { SheetRow } from './sheet-row'

const QUIET_LINK =
  'inline-flex min-h-8 items-center rounded-sm px-1 text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11'
const TEXT_LINK =
  'rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring'
const STRETCH =
  'border-b border-border/60 bg-secondary/40 px-3 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'

/**
 * El rótulo de un tramo de la hoja, UNA vez donde empieza: «Quedó de antes» antes del primer renglón
 * arrastrado y «Vence en noviembre» donde arranca el mes.
 */
function stretchLabel(
  place: SheetStretch['place'],
  previous: SheetStretch['place'] | undefined,
  mes: string,
): string | null {
  if (place === 'before') return 'Quedó de antes'
  if (place === 'ahead') return 'Pagado por adelantado'
  // El mes abre la hoja: no hace falta decir de qué mes es.
  return previous === undefined ? null : `Vence en ${mes}`
}

/**
 * La planilla de gastos fijos del mes: como la que ya llevan los socios. Una fila por gasto, tildar
 * paga, el monto se escribe en su celda y al final van los sueldos y el total con su doble raya. Lo
 * que no vence este mes y lo que está en pausa queda plegado abajo.
 *
 * Lo que necesita la tira de pago se trae una sola vez, al tildar el primero, y se vuelve a pedir
 * después de cada pago: el siguiente abre al toque.
 */
export function SheetView({
  sheet,
  totals,
  payroll,
  autoTax,
  tenantSlug,
  canWrite,
  openId,
  miscAccountId,
  pasteList,
}: {
  sheet: Sheet
  totals: SheetTotals
  /** La planilla de Sueldos; `null` si no se pudo leer. */
  payroll: PayrollSums | null
  autoTax: AutoTaxPlan
  tenantSlug: string
  canWrite: boolean
  /** `?abrir=<uuid>`: el renglón que entra a la vista, marcado. */
  openId: string | null
  /** La cuenta «Gastos varios», para ofrecer cambiarla. */
  miscAccountId: string | null
  /** «Pegar una lista» (solo para quien carga y si se pudo leer el plan). */
  pasteList: ReactNode
}) {
  const { readOnly } = useAccounting()
  // Dos guardas: el permiso que manda la página y el de la sección.
  const writable = canWrite && !readOnly
  const { month } = sheet
  const mes = monthWord(month)
  const carry = sheetCarry(sheet)
  const cols = writable ? 6 : 5

  const [payingId, setPayingId] = useState<string | null>(null)
  const [wanted, setWanted] = useState(false)
  const load = useSheetData(
    wanted ? () => loadSheetData(tenantSlug, { recurring: true }) : null,
    wanted ? tenantSlug : '',
  )
  const togglePay = useCallback((id: string) => {
    setWanted(true)
    setPayingId((current) => (current === id ? null : id))
  }, [])
  const { reload } = load
  const onPaid = useCallback(() => {
    setPayingId(null)
    reload()
  }, [reload])
  const strip = {
    data: load.data,
    message: load.status === 'error' ? load.message : null,
    reload,
  }

  const row = (item: SheetItem, inSheet: boolean) => (
    <SheetRow
      key={item.row.id}
      item={item}
      month={month}
      writable={writable}
      autoTax={autoTax}
      isMisc={miscAccountId !== null && item.row.accountId === miscAccountId}
      inSheet={inSheet}
      highlighted={item.row.id === openId}
      paying={payingId === item.row.id}
      onTogglePay={() => togglePay(item.row.id)}
      onPaid={onPaid}
      strip={strip}
    />
  )
  const head = (
    <thead>
      <tr>
        <PTh className="w-9 pr-0">
          <span className="sr-only">Pagado</span>
        </PTh>
        <PTh className={PHONE_HIDDEN}>Vence</PTh>
        <PTh>Concepto</PTh>
        <PTh align="right">Monto</PTh>
        <PTh className={PHONE_HIDDEN}>Estado</PTh>
        {writable ? (
          <PTh className="w-10 pl-0">
            <span className="sr-only">Más opciones</span>
          </PTh>
        ) : null}
      </tr>
    </thead>
  )

  const hasAny = sheet.items.length + sheet.later.length + sheet.off.length > 0
  const openIn = (list: readonly SheetItem[]) => list.some((item) => item.row.id === openId)
  const addHref = recurringHref(tenantSlug, 'nuevo')

  return (
    <>
      <Planilla>
        <PTable minWidth={560} className={PHONE_FIT} label={`Gastos fijos de ${mes}`}>
          {head}
          <tbody>
            {sheet.items.length === 0 ? (
              <tr>
                <td colSpan={cols} className="border-b border-border/60 px-3 py-6 text-center">
                  <p className="text-sm text-muted-foreground text-pretty">
                    {hasAny
                      ? `En ${mes} no vence ninguno.`
                      : writable
                        ? 'Todavía no cargaste gastos fijos.'
                        : 'Todavía no hay gastos fijos cargados.'}
                  </p>
                  {!hasAny && writable ? (
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      {pasteList}
                      <Button asChild variant="outline" className="h-11">
                        <Link href={addHref}>Agregar gasto fijo</Link>
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ) : null}
            {sheet.stretches.map((stretch, index) => {
              const label = stretchLabel(stretch.place, sheet.stretches[index - 1]?.place, mes)
              return (
                <Fragment key={stretch.items[0]?.row.id ?? stretch.place}>
                  {label ? (
                    <tr>
                      <td colSpan={cols} className={STRETCH}>
                        {label}
                        {stretch.place === 'before' && carry ? (
                          <span className="ml-2 font-medium tracking-normal normal-case">
                            {carry.cents > 0 ? `${formatCentsShort(carry.cents)} · ` : null}
                            <Link
                              href={gastosFijosHref(tenantSlug, { mes: carry.month })}
                              scroll={false}
                              className={TEXT_LINK}
                            >
                              Ver {monthWord(carry.month)}
                            </Link>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                  {stretch.items.map((item) => row(item, true))}
                </Fragment>
              )
            })}
            <PayrollRow
              tenantSlug={tenantSlug}
              month={month}
              payroll={payroll}
              writable={writable}
            />
          </tbody>
          <tfoot>
            <PTotalRow>
              <PTd colSpan={3}>{carry ? `Total de ${mes}` : 'Total'}</PTd>
              <PTd align="right">
                <span className={AMOUNT_ALIGN}>
                  {totals.totalCents !== null ? formatCentsShort(totals.totalCents) : '—'}
                </span>
              </PTd>
              <PTd colSpan={writable ? 2 : 1} />
            </PTotalRow>
          </tfoot>
        </PTable>

        {sheet.progress.priorOpenCents > 0 ? (
          <p className="border-t border-border/70 px-3 py-2 text-sm text-pretty">
            Aparte, de meses anteriores te quedan{' '}
            <span className="font-semibold tabular-nums">
              {formatCentsShort(sheet.progress.priorOpenCents)}
            </span>{' '}
            sin pagar.{' '}
            <Link href={comprasHref(tenantSlug)} className={TEXT_LINK}>
              Ver en Compras y pagos
            </Link>
          </p>
        ) : null}

        <PlanillaFoot>
          <div className="flex flex-wrap items-center gap-x-2.5">
            {hasAny ? pasteList : null}
            {writable && hasAny ? (
              <Link href={gastosFijosFillHref(tenantSlug)} className={QUIET_LINK}>
                Completar la planilla
              </Link>
            ) : null}
            <Link
              href={`/${tenantSlug}/administracion/guias/dia-a-dia#receta-gasto-fijo`}
              className={QUIET_LINK}
            >
              ¿Cómo se paga un gasto fijo?
            </Link>
          </div>
          {writable && hasAny ? (
            <Button asChild size="sm" variant="outline" className="pointer-coarse:h-11">
              <Link href={addHref}>Agregar gasto fijo</Link>
            </Button>
          ) : null}
        </PlanillaFoot>
      </Planilla>

      {sheet.later.length > 0 ? (
        <SheetFold
          key={`later-${openIn(sheet.later) ? 'open' : 'closed'}`}
          title={`No vencen en ${mes}`}
          count={sheet.later.length}
          defaultOpen={openIn(sheet.later)}
        >
          <PTable minWidth={560} className={PHONE_FIT} label={`No vencen en ${mes}`}>
            {head}
            <tbody>{sheet.later.map((item) => row(item, false))}</tbody>
          </PTable>
        </SheetFold>
      ) : null}
      {sheet.off.length > 0 ? (
        <SheetFold
          key={`off-${openIn(sheet.off) ? 'open' : 'closed'}`}
          title="En pausa o terminados"
          count={sheet.off.length}
          defaultOpen={openIn(sheet.off)}
        >
          <PTable minWidth={560} className={PHONE_FIT} label="En pausa o terminados">
            {head}
            <tbody>{sheet.off.map((item) => row(item, false))}</tbody>
          </PTable>
        </SheetFold>
      ) : null}
    </>
  )
}

/**
 * La fila fija de los sueldos: el total de la planilla de Sueldos y lo que falta pagar. Suma al
 * totalizador. Si en el bar hay gastos fijos viejos con nombre de sueldos, siguen siendo otra fila:
 * no se tocan.
 */
function PayrollRow({
  tenantSlug,
  month,
  payroll,
  writable,
}: {
  tenantSlug: string
  month: string
  payroll: PayrollSums | null
  writable: boolean
}) {
  const status = payrollRowStatus(payroll)
  const salary = payroll?.salaryCents ?? 0
  return (
    <PRow className="relative">
      <PTd className="w-9 pr-0" />
      <PTd className={cn('whitespace-nowrap text-muted-foreground', PHONE_HIDDEN)}>
        {formatDayMonth(endOfMonth(month))}
      </PTd>
      <PTd>
        <Link
          href={payrollHref(tenantSlug, month)}
          className="font-medium underline-offset-4 outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          Sueldos del personal
        </Link>
        <small className="block text-xs text-muted-foreground max-sm:hidden">
          Tocá para ver el detalle
        </small>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 sm:hidden">
          <small className="text-xs text-muted-foreground">
            {formatDayMonth(endOfMonth(month))}
          </small>
          <StatusMark label={status.label} tone={status.tone} stamp={status.stamp} />
        </span>
      </PTd>
      <PTd align="right">
        <span className={cn(AMOUNT_ALIGN, salary <= 0 && 'text-muted-foreground')}>
          {salary > 0 ? formatCentsShort(salary) : '—'}
        </span>
      </PTd>
      <PTd className={PHONE_HIDDEN}>
        <StatusMark label={status.label} tone={status.tone} stamp={status.stamp} />
      </PTd>
      {writable ? <PTd className="w-10 pl-0" /> : null}
    </PRow>
  )
}

/** Un plegado debajo de la planilla. Se acuerda de si lo abriste aunque la pantalla se refresque. */
function SheetFold({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string
  count: number
  defaultOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group/fold"
    >
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) group-open/fold:rotate-90 motion-reduce:transition-none"
        />
        {title}
        <span className="rounded-full bg-secondary px-1.5 py-px text-[11px] tabular-nums text-muted-foreground">
          {count}
        </span>
      </summary>
      <Planilla className="mt-1.5">{children}</Planilla>
    </details>
  )
}
