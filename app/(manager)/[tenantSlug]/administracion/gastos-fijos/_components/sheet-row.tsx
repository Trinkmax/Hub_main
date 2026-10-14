'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import {
  documentHref,
  gastosFijosFillHref,
  gastosFijosHref,
  newPurchaseHref,
  recurringHref,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import { RECURRING_FREQUENCIES } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/recurring'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { Amount } from '@/components/administracion/amount'
import { Pill, StatusPill } from '@/components/administracion/kit'
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
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import { formatIsoDay } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  installmentWords,
  type PayAction,
  papelLabel,
  type RowActions,
  rowActions,
  rowSubline,
  rowTint,
  rowWords,
  type SheetItem,
  tickState,
} from '../_lib/planilla-words'
import { InstallmentDots } from './installment-dots'
import { RowQuickEdit } from './row-quick-edit'
import { SaveMark } from './save-mark'
import { TickBox, type TickState } from './tick-box'
import { useRowActions, useRowEdit } from './use-row-actions'

/**
 * Un renglón de la planilla de gastos fijos: casillero, concepto, cuotas en
 * puntitos, monto, cómo va y, si toca, «Pagar». Tocarlo lo abre hacia abajo,
 * con sus datos, el monto y el día para cambiar en el lugar y lo demás que se
 * puede hacer con él.
 *
 * Tres reglas que vienen de Operativo:
 * - el renglón NO se mueve cuando lo pagás: se tilda en su lugar;
 * - el casillero vacío de uno que se puede pagar es un atajo de «Pagar»;
 * - a quien solo mira (la contadora) no se le dibuja ningún control que escriba.
 *
 * El ancho lo decide la HOJA (`@container/ledger` en la planilla), no la
 * ventana: en angosto son tres líneas, en ancho una sola con columnas.
 */

/**
 * Las columnas del renglón ancho; los rótulos de arriba usan la misma grilla.
 * La columna «Cuota» existe solo si algún gasto de la planilla es en cuotas:
 * una columna entera de rayas no dice nada y le saca lugar al nombre.
 */
const WIDE = {
  cuotas: {
    columns:
      '@[58rem]/ledger:grid-cols-[3.5rem_minmax(0,1fr)_10.5rem_8.5rem_minmax(0,13.5rem)_7.5rem]',
    areas:
      "@[58rem]/ledger:[grid-template-areas:'tick_name_cuota_amount_status_action'_'tick_sub_cuota_amount_status_action']",
  },
  plain: {
    columns: '@[58rem]/ledger:grid-cols-[3.5rem_minmax(0,1fr)_8.5rem_minmax(0,15rem)_7.5rem]',
    areas:
      "@[58rem]/ledger:[grid-template-areas:'tick_name_amount_status_action'_'tick_sub_amount_status_action']",
  },
} as const

/**
 * En angosto son tres líneas (nombre y monto · lo gris · cómo va y «Pagar»).
 * `compact` es el renglón sin monto bajo el encabezado de su día: dos líneas,
 * con «Poner monto» a la derecha (31 renglones que repetían «Sin monto», el
 * vencimiento y «Poner monto» eran una pared).
 */
const rowGrid = (cuotas: boolean, compact: boolean) =>
  cn(
    'grid items-start gap-x-3 gap-y-1.5 grid-cols-[2rem_minmax(0,1fr)_auto]',
    compact
      ? "[grid-template-areas:'tick_name_action'_'._sub_action']"
      : "[grid-template-areas:'tick_name_amount'_'._sub_sub'_'._status_action']",
    WIDE[cuotas ? 'cuotas' : 'plain'].columns,
    '@[58rem]/ledger:items-center @[58rem]/ledger:gap-y-0.5',
    WIDE[cuotas ? 'cuotas' : 'plain'].areas,
  )
/** Lo que el renglón compacto no dibuja en angosto y sí en la hoja ancha, que tiene su columna. */
const WIDE_ONLY = 'hidden @[58rem]/ledger:block'

const TINT = {
  ok: 'bg-success/6',
  warn: 'bg-warning/6',
  late: 'bg-destructive/5',
} as const

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring'
/** El nombre es el botón que abre el renglón, estirado a toda la fila. */
const STRETCHED = cn(
  "cursor-pointer rounded-sm text-left font-[inherit] outline-none after:absolute after:inset-0 after:content-['']",
  'focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring',
)
const TEXT_LINK = cn(
  'rounded-sm font-medium text-foreground underline underline-offset-4 hover:no-underline',
  FOCUS,
)

/** La medida de las píldoras del renglón abierto: 44 px con el dedo, 36 con mouse. */
const ACTION_SIZE = 'md:pointer-fine:h-9 md:pointer-fine:px-3.5 md:pointer-fine:text-[13px]'
/** Una píldora que es un link, con la medida de las de acción. */
const PILL_LINK = cn(
  'inline-flex h-11 max-w-full items-center rounded-full border border-border/70 bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-cream-tint',
  ACTION_SIZE,
  FOCUS,
)
/** «Poner monto»: punteado, como la celda vacía de una planilla. */
const BLANK_AMOUNT = cn(
  'relative z-[1] cursor-pointer items-center rounded-full border border-dashed border-foreground/30 px-3 text-xs font-medium whitespace-nowrap text-muted-foreground hover:border-foreground/50 hover:text-foreground',
  FOCUS,
)

const TICK_LABEL: Readonly<Record<TickState, string>> = {
  empty: 'Sin pagar',
  done: 'Pagado',
  half: 'Pagaste una parte',
  skip: 'No se paga',
}

const FREQUENCY_LABEL = new Map<string, string>(
  RECURRING_FREQUENCIES.map((f) => [f.value, f.label]),
)

/** Los rótulos de columna de la hoja ancha, alineados con los renglones. */
export function SheetColumnLabels({ cuotas }: { cuotas: boolean }) {
  const cell = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'
  return (
    <div
      aria-hidden
      className={cn(
        'hidden gap-x-3 px-4 @[58rem]/ledger:grid',
        WIDE[cuotas ? 'cuotas' : 'plain'].columns,
        'min-w-0 flex-1',
      )}
    >
      <span className={cn(cell, 'text-center')}>Pagado</span>
      <span className={cell}>Concepto</span>
      {cuotas ? <span className={cell}>Cuota</span> : null}
      <span className={cn(cell, 'text-right')}>Monto</span>
      <span className={cell}>Cómo va</span>
      <span />
    </div>
  )
}

/**
 * Un plegado de renglones debajo de la hoja («No vencen en octubre», «En pausa
 * o terminados»). Cerrado por defecto; se acuerda de si lo abriste aunque la
 * pantalla se refresque después de un guardado.
 */
export function SheetFold({
  title,
  count,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string
  count: number
  hint?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group/fold"
    >
      <summary
        className={cn(
          'inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden',
          FOCUS,
        )}
      >
        <ChevronRight
          aria-hidden
          className="size-4 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) group-open/fold:rotate-90 motion-reduce:transition-none"
        />
        {title}
        <span className="rounded-full bg-secondary px-1.5 py-px font-mono text-[11px] tabular-nums text-muted-foreground">
          {count}
        </span>
      </summary>
      {hint ? <p className="mt-0.5 pl-5.5 text-sm text-muted-foreground">{hint}</p> : null}
      <div className="@container/ledger card-hairline mt-3 rounded-2xl border bg-card shadow-xs">
        <ul aria-label={title}>{children}</ul>
      </div>
    </details>
  )
}

function Dash({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground/60">
      <span aria-hidden>—</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function SheetRow({
  item,
  month,
  canWrite,
  payInRow = true,
  underDay = false,
  defaultOpen = false,
  isMisc = false,
  cuotas = false,
}: {
  item: SheetItem
  /** El mes que se está mirando (`yyyy-MM`), para volver a él. */
  month: string
  canWrite: boolean
  /** Algún gasto de la planilla es en cuotas: la hoja ancha lleva esa columna. */
  cuotas?: boolean
  /** `false` en los plegados de abajo: el botón queda adentro del renglón. */
  payInRow?: boolean
  /** Cuelga del encabezado de su día (no en los plegados): el día ya está dicho arriba. */
  underDay?: boolean
  /** `?abrir=<id>`: entra abierto, a la vista y resaltado un momento. */
  defaultOpen?: boolean
  /** Quedó en «Gastos varios»: se ofrece cambiarlo. */
  isMisc?: boolean
}) {
  const { tenantSlug, today, readOnly, openAction } = useAccounting()
  const { row, line } = item
  const bodyId = useId()
  const rowRef = useRef<HTMLLIElement>(null)
  const [open, setOpen] = useState(defaultOpen)
  const [focusAmount, setFocusAmount] = useState(false)
  const [flash, setFlash] = useState(defaultOpen)

  const actions = rowActions(item, { canWrite: canWrite && !readOnly })
  const words = rowWords(item, today)
  const tint = rowTint(item)
  const tick = tickState(item)
  const cuota = installmentWords(line.installment)
  const subline = rowSubline(row)
  const showPay = payInRow && actions.payInRow && actions.pay !== null
  // Sin monto y se puede poner: lo dice la celda del monto («Poner monto»), así que la
  // frase de al lado no lo repite y queda solo el vencimiento.
  const needsAmount = line.dueCents === null && actions.edit
  const quietStatus = needsAmount && line.state === 'no_amount' && words.detail !== null
  // Sin monto, todavía sin vencer y bajo su día: en angosto, dos líneas (el encabezado del día
  // ya dice cuándo vence y «Poner monto» ya dice que no tiene).
  const compact =
    underDay && line.state === 'no_amount' && !line.pastDue && !showPay && words.extras.length === 0
  // La pregunta «¿Era eso?» ya dice la diferencia y ofrece el comprobante: no se repiten.
  const asking = actions.ask && words.short !== null
  const openAmount = () => {
    setOpen(true)
    setFocusAmount(true)
  }
  const { busy, keepAmount } = useRowActions(tenantSlug)

  // El tilde se dibuja solo cuando el renglón pasa a pago en ESTA visita.
  const lastTick = useRef(tick)
  const [justPaid, setJustPaid] = useState(false)
  useEffect(() => {
    if (lastTick.current !== 'done' && tick === 'done') setJustPaid(true)
    lastTick.current = tick
  }, [tick])

  // `?abrir=`: a la vista y con un anillo dos segundos.
  useEffect(() => {
    if (!defaultOpen) return
    rowRef.current?.scrollIntoView({ block: 'center' })
    const timer = window.setTimeout(() => setFlash(false), 2000)
    return () => window.clearTimeout(timer)
  }, [defaultOpen])

  const pay = (action: PayAction) => {
    if (action.kind === 'gasto') openAction('gasto', { 'gasto-fijo': action.recurringId })
    else if (action.kind === 'pagar') openAction('pagar', { proveedor: action.partyId })
  }
  const payLabel = `Pagar ${row.name}${line.dueCents !== null ? `, ${formatCentsShort(line.remainingCents ?? line.dueCents)}` : ''}`
  const tickBox = (
    <TickBox
      state={tick}
      animate={justPaid}
      label={
        tick === 'skip'
          ? line.state === 'paused'
            ? 'En pausa'
            : line.state === 'ended'
              ? 'Terminó'
              : 'Este mes no se paga'
          : TICK_LABEL[tick]
      }
    />
  )
  const payAction = actions.pay
  const tickPays = showPay && payAction !== null && payAction.kind !== 'document'

  return (
    <li
      ref={rowRef}
      id={`gasto-${row.id}`}
      data-state={line.state}
      className={cn(
        'relative scroll-mt-32 border-b border-border/60 last:border-b-0',
        tint && TINT[tint],
        flash && 'z-[1] ring-2 ring-ring ring-inset',
      )}
    >
      <div
        className={cn(
          rowGrid(cuotas, compact),
          'relative px-3 py-3 transition-colors duration-(--duration-fast) hover:bg-cream-tint motion-reduce:transition-none @[28rem]/ledger:px-4',
        )}
      >
        <div className="flex justify-center pt-0.5 [grid-area:tick] @[58rem]/ledger:pt-0">
          {tickPays && payAction ? (
            // Un atajo de «Pagar»: fuera del orden de Tab, porque el botón ya está.
            <button
              type="button"
              tabIndex={-1}
              aria-label={payLabel}
              onClick={() => pay(payAction)}
              className={cn(
                'relative z-[1] -m-2.5 flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-secondary/70',
                FOCUS,
              )}
            >
              {tickBox}
            </button>
          ) : (
            tickBox
          )}
        </div>

        <p className="min-w-0 font-medium leading-snug [grid-area:name]" title={row.name}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
            className={cn(STRETCHED, 'block w-full')}
          >
            {/* Dos gastos que se llaman casi igual se distinguen al final: en angosto la
                columna del nombre es finita y hacen falta tres renglones para llegar. */}
            <span className="line-clamp-3 [overflow-wrap:anywhere] @[58rem]/ledger:line-clamp-2">
              {row.name}
            </span>
          </button>
        </p>

        <div className="min-w-0 [grid-area:sub] text-xs leading-snug text-muted-foreground">
          <span className="[overflow-wrap:anywhere]">
            {subline.length > 0 ? subline.join(' · ') : 'Sin categoría'}
          </span>
          {isMisc && actions.edit ? (
            <>
              {' · '}
              <Link
                href={gastosFijosFillHref(tenantSlug, { ver: 'varios', foco: row.id })}
                className={cn(TEXT_LINK, 'relative z-[1]')}
              >
                cambiar
              </Link>
            </>
          ) : null}
          {cuota ? (
            <span
              className={cn('mt-1 flex items-center gap-1.5', cuotas && '@[58rem]/ledger:hidden')}
            >
              <InstallmentDots
                current={line.installment?.current ?? null}
                total={line.installment?.total ?? null}
                remaining={line.installment?.remaining ?? 0}
              />
              {cuota}
            </span>
          ) : null}
        </div>

        {cuotas ? (
          <div className="hidden min-w-0 [grid-area:cuota] @[58rem]/ledger:block">
            {cuota && line.installment ? (
              <span className="flex flex-col gap-1 text-xs text-muted-foreground">
                <InstallmentDots
                  current={line.installment.current}
                  total={line.installment.total}
                  remaining={line.installment.remaining}
                />
                {cuota}
              </span>
            ) : (
              // Vacía y no con una raya: una columna de rayas no dice nada.
              <span className="sr-only">No es en cuotas</span>
            )}
          </div>
        ) : null}

        <div
          className={cn(
            'text-right text-sm font-medium whitespace-nowrap tabular-nums [grid-area:amount]',
            compact && WIDE_ONLY,
          )}
        >
          {line.dueCents !== null ? (
            <Amount cents={line.dueCents} decimals={0} />
          ) : needsAmount ? (
            <>
              {/* En angosto «Poner monto» va abajo, donde iría «Pagar»: acá queda el dato. (En el
                  renglón compacto esta celda no se ve en angosto: lo dice «Poner monto».) */}
              {compact ? null : (
                <span className="text-xs font-normal text-muted-foreground @[58rem]/ledger:hidden">
                  Sin monto
                </span>
              )}
              <button
                type="button"
                tabIndex={-1}
                onClick={openAmount}
                // En una tablet la hoja ancha también se toca con el dedo: 44 px; con mouse, 36.
                className={cn(
                  BLANK_AMOUNT,
                  'hidden h-11 pointer-fine:h-9 @[58rem]/ledger:inline-flex',
                )}
              >
                Poner monto
              </button>
            </>
          ) : (
            <Dash label="Sin monto" />
          )}
        </div>

        <div className={cn('min-w-0 self-center [grid-area:status]', compact && WIDE_ONLY)}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {quietStatus ? (
              line.pastDue ? (
                <StatusPill tone="late">{capitalize(words.detail ?? '')}</StatusPill>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {capitalize(words.detail ?? '')}
                </span>
              )
            ) : (
              <>
                {words.tone ? (
                  <StatusPill tone={words.tone}>{words.label}</StatusPill>
                ) : (
                  <span className="text-xs text-muted-foreground">{words.label}</span>
                )}
                {/* Con mayúscula: cuando baja de renglón no parece una frase cortada. */}
                {words.detail && !asking ? (
                  <span className="text-xs text-muted-foreground">{capitalize(words.detail)}</span>
                ) : null}
              </>
            )}
          </span>
          {words.extras.map((extra) => (
            <span key={extra} className="mt-0.5 block text-[11px] text-muted-foreground">
              {extra}
            </span>
          ))}
        </div>

        <div
          className={cn(
            'relative z-[1] flex items-center justify-end gap-1 [grid-area:action] @[58rem]/ledger:self-center',
            compact ? 'self-center' : 'self-end',
          )}
        >
          {showPay && payAction ? (
            payAction.kind === 'document' ? (
              <Button
                asChild
                variant="outline"
                className="h-11 rounded-full px-3.5 text-[13px] @[58rem]/ledger:pointer-fine:h-9"
              >
                <Link
                  href={documentHref(tenantSlug, payAction.documentId)}
                  aria-label={`Ver la factura de ${row.name} y pagarla`}
                >
                  Ver la factura
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                aria-label={payLabel}
                onClick={() => pay(payAction)}
                className="h-11 rounded-full px-5 @[58rem]/ledger:pointer-fine:h-9"
              >
                Pagar
              </Button>
            )
          ) : needsAmount ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={openAmount}
              className={cn(
                BLANK_AMOUNT,
                'inline-flex h-11 @[58rem]/ledger:hidden',
                !compact && 'px-4 text-[13px]',
              )}
            >
              Poner monto
            </button>
          ) : compact ? (
            // A quien solo mira: el dato, donde a quien carga le va «Poner monto».
            <StatusPill tone="muted" className="@[58rem]/ledger:hidden">
              Sin monto
            </StatusPill>
          ) : null}
          {/* Dice que el renglón se abre; el botón es el nombre, estirado a toda la fila. */}
          <ChevronDown
            aria-hidden
            className={cn(
              'pointer-events-none size-4 shrink-0 text-muted-foreground/70 transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        </div>
      </div>

      {asking && words.short ? (
        // La pregunta va a la vista, sin abrir el renglón: es lo que destraba «Te falta».
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3 pl-[3.5rem] text-sm @[28rem]/ledger:px-4 @[28rem]/ledger:pl-[3.75rem] @[58rem]/ledger:pl-[5.25rem]">
          <p className="text-pretty">
            Calculabas <strong>{formatCentsShort(words.short.expectedCents)}</strong> y pagaste{' '}
            <strong>{formatCentsShort(words.short.paidCents)}</strong>. ¿Era eso?
          </p>
          <div className="flex flex-wrap gap-2">
            <Pill
              size="touch"
              disabled={busy}
              onClick={() => keepAmount(row, words.short?.paidCents ?? 0)}
              className="md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]"
            >
              Sí, dejar {formatCentsShort(words.short.paidCents)}
            </Pill>
            {line.documentId ? (
              <Link
                href={documentHref(tenantSlug, line.documentId)}
                className={cn(
                  TEXT_LINK,
                  'inline-flex min-h-11 items-center text-[13px] md:pointer-fine:min-h-9',
                )}
              >
                Ver el comprobante
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {open ? (
        <RowBody
          id={bodyId}
          item={item}
          month={month}
          actions={actions}
          tenantSlug={tenantSlug}
          autoFocusAmount={focusAmount}
          payShownInRow={showPay}
          docLinkShown={asking && line.documentId !== null}
          onPay={pay}
        />
      ) : null}
    </li>
  )
}

function Datum({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-pretty [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function ActionRow({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <li className="flex flex-col items-start gap-1">
      {children}
      {hint ? <p className="text-xs text-muted-foreground text-pretty">{hint}</p> : null}
    </li>
  )
}

/** El renglón abierto: lo último cargado, monto y día en el lugar, sus datos y lo que se puede hacer. */
function RowBody({
  id,
  item,
  month,
  actions,
  tenantSlug,
  autoFocusAmount,
  payShownInRow,
  docLinkShown,
  onPay,
}: {
  id: string
  item: SheetItem
  month: string
  actions: RowActions
  tenantSlug: string
  autoFocusAmount: boolean
  /** El renglón ya muestra su «Pagar»: adentro no se repite. */
  payShownInRow: boolean
  /** La pregunta «¿Era eso?» ya lleva al comprobante: adentro no se repite el link. */
  docLinkShown: boolean
  onPay: (action: PayAction) => void
}) {
  const { row, line, doc } = item
  const { busy, skip, unskip, pause, resume, keepAmount, remove } = useRowActions(tenantSlug)
  const [confirming, setConfirming] = useState(false)
  const fichaHref = recurringHref(tenantSlug, row.id)
  const paper = papelLabel(row.voucherType)
  const frequency = row.frequency === 'monthly' ? null : FREQUENCY_LABEL.get(row.frequency)
  const installment = line.installment
  const cuotas = installment
    ? [
        installmentWords(installment),
        row.endsOn ? `termina el ${formatIsoDay(row.endsOn)}` : null,
        row.amountCents !== null
          ? `te quedan ${formatCentsShort(row.amountCents * installment.remaining)} en ${
              installment.remaining === 1 ? '1 cuota' : `${installment.remaining} cuotas`
            }`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null
  const missing = [
    row.partyId === null ? 'a quién le pagás' : null,
    row.treasuryAccountId === null ? 'con qué' : null,
    row.voucherType === null ? 'qué papel te dan' : null,
  ].filter((part): part is string => part !== null)
  const missingText =
    missing.length > 1
      ? `${missing.slice(0, -1).join(', ')} y ${missing[missing.length - 1]}`
      : missing[0]
  const nextDue = formatIsoDay(row.nextDueDate).slice(0, 5)
  const payAction = payShownInRow ? null : actions.pay
  const hasActions = actions.remove

  return (
    <div id={id} className="px-3 pb-3 @[28rem]/ledger:px-4 @[28rem]/ledger:pb-4">
      <div
        className={cn(
          'grid gap-5 rounded-xl bg-secondary/50 p-4',
          hasActions && 'md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]',
        )}
      >
        <div className="min-w-0 space-y-4">
          {doc ? (
            <p className="text-sm text-pretty">
              Lo último que cargaste: <Amount cents={doc.totalCents} decimals={0} /> el{' '}
              {formatIsoDay(doc.accountingDate).slice(0, 5)}.
              {docLinkShown ? null : (
                <>
                  {' '}
                  <Link href={documentHref(tenantSlug, doc.id)} className={TEXT_LINK}>
                    Ver el comprobante
                  </Link>
                </>
              )}
            </p>
          ) : null}

          {actions.keepPaid && line.paidCents !== null ? (
            <p className="text-sm text-pretty">
              Pagaste más de lo que calculabas.{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() => keepAmount(row, line.paidCents ?? 0)}
                className={cn(TEXT_LINK, 'cursor-pointer disabled:opacity-50')}
              >
                Usar {formatCentsShort(line.paidCents)} de ahora en más
              </button>
            </p>
          ) : null}

          {actions.edit ? (
            <RowEditor
              row={row}
              tenantSlug={tenantSlug}
              autoFocusAmount={autoFocusAmount}
              fichaHref={fichaHref}
            />
          ) : null}

          <dl className="text-sm">
            {row.accountName ? <Datum label="En qué se gasta">{row.accountName}</Datum> : null}
            {paper ? <Datum label="Papel de siempre">{paper}</Datum> : null}
            {row.partyName ? <Datum label="A quién le pagás">{row.partyName}</Datum> : null}
            {row.treasuryName ? <Datum label="Con qué lo pagás">{row.treasuryName}</Datum> : null}
            {frequency ? <Datum label="Cada cuánto">{frequency}</Datum> : null}
            {cuotas ? <Datum label="Cuotas">{capitalize(cuotas)}</Datum> : null}
            {row.breakdown.length > 0 ? (
              <Datum label="Detalle">
                {row.breakdown.length === 1 ? '1 renglón' : `${row.breakdown.length} renglones`}
              </Datum>
            ) : null}
            {row.notes ? <Datum label="Notas">{row.notes}</Datum> : null}
          </dl>

          {row.breakdown.length > 0 ? (
            <p className="text-xs text-muted-foreground text-pretty">
              Los números del mes que te pasa la contadora van en{' '}
              {hasActions ? (
                <Link
                  href={`/${tenantSlug}/administracion/libros/asiento-manual?tipo=sueldos`}
                  className={TEXT_LINK}
                >
                  Libros › Sueldos del mes
                </Link>
              ) : (
                // Es una pantalla de carga: a quien solo mira se le dice dónde van, sin el link.
                'Libros › Sueldos del mes'
              )}
              .
            </p>
          ) : null}

          {actions.edit && missingText ? (
            <p className="text-xs text-muted-foreground text-pretty">
              Falta decir {missingText}.{' '}
              <Link href={fichaHref} className={TEXT_LINK}>
                Completar en la ficha
              </Link>
            </p>
          ) : null}
        </div>

        {hasActions ? (
          <ul className="flex min-w-0 flex-col gap-3">
            {payAction ? (
              <ActionRow
                hint={actions.payAhead ? `Paga el vencimiento del ${nextDue}.` : undefined}
              >
                {payAction.kind === 'document' ? (
                  <Link href={documentHref(tenantSlug, payAction.documentId)} className={PILL_LINK}>
                    Ver la factura y pagarla
                  </Link>
                ) : (
                  <Pill size="touch" onClick={() => onPay(payAction)} className={ACTION_SIZE}>
                    {actions.payAhead ? 'Pagar por adelantado' : 'Pagar'}
                  </Pill>
                )}
              </ActionRow>
            ) : null}
            {actions.bill ? (
              <ActionRow
                hint={`Queda como deuda con el proveedor. Cubre el vencimiento del ${nextDue}.`}
              >
                <Link
                  href={newPurchaseHref(tenantSlug, {
                    proveedor: row.partyId,
                    gastoFijo: row.id,
                    volver: gastosFijosHref(tenantSlug, { mes: month }),
                  })}
                  className={PILL_LINK}
                >
                  Me llegó la factura y la pago después
                </Link>
              </ActionRow>
            ) : null}
            {actions.skip ? (
              <ActionRow hint="Usalo también si ya lo cargaste por otro lado.">
                <Pill
                  size="touch"
                  disabled={busy}
                  onClick={() => skip(row)}
                  className={ACTION_SIZE}
                >
                  Este mes no se paga
                </Pill>
              </ActionRow>
            ) : null}
            {actions.unskip ? (
              <ActionRow>
                <Pill
                  size="touch"
                  disabled={busy}
                  onClick={() => unskip(row)}
                  className={ACTION_SIZE}
                >
                  Sí se paga este mes
                </Pill>
              </ActionRow>
            ) : null}
            <li className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              <Link href={fichaHref} className={PILL_LINK}>
                Abrir la ficha
              </Link>
              {actions.pause ? (
                <Pill
                  size="touch"
                  disabled={busy}
                  onClick={() => pause(row)}
                  className={ACTION_SIZE}
                >
                  Pausar
                </Pill>
              ) : null}
              {actions.resume ? (
                <Pill
                  size="touch"
                  disabled={busy}
                  onClick={() => resume(row)}
                  className={ACTION_SIZE}
                >
                  Reanudar
                </Pill>
              ) : null}
              <Pill
                size="touch"
                disabled={busy}
                onClick={() => setConfirming(true)}
                className={cn(ACTION_SIZE, 'text-destructive hover:bg-destructive/8')}
              >
                Eliminar
              </Pill>
            </li>
          </ul>
        ) : null}
      </div>

      {hasActions ? (
        <DeleteDialog
          row={row}
          open={confirming}
          busy={busy}
          onOpenChange={setConfirming}
          onConfirm={() => remove(row, () => setConfirming(false))}
        />
      ) : null}
    </div>
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** «Monto» y «Vence el día» del renglón abierto, que se guardan solos. */
function RowEditor({
  row,
  tenantSlug,
  autoFocusAmount,
  fichaHref,
}: {
  row: RecurringExpenseRow
  tenantSlug: string
  autoFocusAmount: boolean
  fichaHref: string
}) {
  const edit = useRowEdit(tenantSlug, row)
  const amountRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocusAmount) amountRef.current?.focus()
  }, [autoFocusAmount])
  const failure = edit.mark.failure

  return (
    <div className="space-y-1.5">
      <RowQuickEdit
        idPrefix={`gf-${row.id}`}
        name={row.name}
        amountCents={edit.amountCents}
        onAmountChange={edit.setAmountCents}
        dueDay={edit.dueDay}
        onDueDayChange={edit.setDueDay}
        detailTotalCents={row.breakdown.length > 0 ? row.amountCents : null}
        fichaHref={fichaHref}
        onCommit={() => void edit.commit()}
        onLeave={() => void edit.commit()}
        onRevert={edit.revert}
        amountRef={amountRef}
        mark={
          <SaveMark
            state={edit.mark.state}
            message={failure?.message}
            onRetry={
              failure?.kind === 'stale'
                ? () => window.location.reload()
                : failure?.kind === 'other'
                  ? () => void edit.commit()
                  : undefined
            }
            retryLabel={failure?.kind === 'stale' ? 'Recargar' : 'Reintentar'}
          />
        }
      />
      {failure?.kind === 'category' ? (
        <Link href={fichaHref} className={cn(TEXT_LINK, 'text-xs')}>
          Cambiarla en la ficha
        </Link>
      ) : null}
      <p className="text-xs text-muted-foreground">Se guarda con Enter o al salir del campo.</p>
    </div>
  )
}

function DeleteDialog({
  row,
  open,
  busy,
  onOpenChange,
  onConfirm,
}: {
  row: Pick<RecurringExpenseRow, 'name'>
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminás «{row.name}»?</AlertDialogTitle>
          <AlertDialogDescription>
            Sale de la planilla y deja de avisar. Lo que ya cargaste con él queda igual.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {busy ? 'Eliminando…' : 'Eliminar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
