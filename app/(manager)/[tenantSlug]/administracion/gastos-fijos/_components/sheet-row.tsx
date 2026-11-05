'use client'

import { Ellipsis } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import {
  documentHref,
  recurringHref,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import type { SheetData } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { PHONE_HIDDEN, PRow, PTd, ROW_ACTION } from '@/components/administracion/planilla'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  type AutoTaxPlan,
  amountEditable,
  askWords,
  installmentWords,
  type RowMenuItem,
  rowActions,
  rowMenu,
  rowStatus,
  rowSubline,
  type SheetItem,
  tickState,
} from '../_lib/planilla-words'
import { AMOUNT_ALIGN, CellMoney } from './cell-money'
import { PayStripSkeleton } from './pay-strip-skeleton'
import { StatusMark } from './row-status'
import { SaveMark } from './save-mark'
import { TickBox, type TickState } from './tick-box'
import { useRowActions, useRowEdit } from './use-row-actions'

/** La tira trae el motor contable: baja recién al tildar el primer renglón. */
const PayStrip = dynamic(() => import('./pay-strip').then((m) => m.PayStrip), {
  loading: () => <PayStripSkeleton />,
})

const FLASH_MS = 2000

const TICK_LABEL: Readonly<Record<TickState, string>> = {
  empty: 'Sin pagar',
  done: 'Pagado',
  half: 'Pagaste una parte',
  skip: 'No se paga',
}

/** Lo que la tira de pago necesita de la hoja: se trae una sola vez, al tildar el primero. */
export type PayStripLoad = {
  data: SheetData | null
  message: string | null
  reload: () => void
}

/**
 * Un renglón de la planilla: ☐ · Vence · Concepto · Monto · Estado y su «⋯». Tildar paga, «como pagar
 * la EPEC, vas marcando»: abre debajo la tira con lo poco que hace falta (`PayStrip`) y, si el gasto
 * ya tiene quién cobre (una factura cargada, un impuesto que se devengó solo), abre «Pagar» con ese
 * proveedor.
 *
 * Tres reglas que vienen de Operativo:
 * - el renglón NO se mueve cuando lo pagás: se tilda en su lugar;
 * - lo que no es de todos los días va al «⋯»: no se pierde, pero no ocupa la fila;
 * - a quien solo mira (la contadora) no se le dibuja ningún control que escriba.
 */
export function SheetRow({
  item,
  month,
  writable,
  autoTax,
  isMisc = false,
  inSheet = true,
  highlighted = false,
  paying = false,
  onTogglePay,
  onPaid,
  strip,
}: {
  item: SheetItem
  /** El mes que se está mirando (`yyyy-MM`), para volver a él. */
  month: string
  /** Quien mira carga: ya contempla el permiso de la página y el de la sección. */
  writable: boolean
  autoTax: AutoTaxPlan
  /** Quedó en «Gastos varios»: se ofrece cambiarlo. */
  isMisc?: boolean
  /** Está en la hoja del mes; `false` en los plegados de abajo, que se pagan desde el «⋯». */
  inSheet?: boolean
  /** `?abrir=<id>`: entra a la vista y resaltado un momento. */
  highlighted?: boolean
  paying?: boolean
  onTogglePay: () => void
  onPaid: () => void
  strip: PayStripLoad
}) {
  const { tenantSlug, today, openAction } = useAccounting()
  const router = useRouter()
  const { row, line } = item
  const stripId = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const [flash, setFlash] = useState(highlighted)
  const [confirming, setConfirming] = useState(false)

  const actions = rowActions(item, { canWrite: writable, autoTax })
  const status = rowStatus(item, today)
  const tick = tickState(item)
  const cuota = installmentWords(line.installment)
  const editable = amountEditable(item, actions)
  const edit = useRowEdit(tenantSlug, row)
  const { busy, skip, unskip, pause, resume, keepAmount, remove } = useRowActions(tenantSlug)
  const failure = edit.mark.failure

  // El sello cae y el tilde se dibuja solo cuando el renglón pasa a pago en ESTA visita.
  const lastTick = useRef(tick)
  const [justPaid, setJustPaid] = useState(false)
  useEffect(() => {
    if (lastTick.current !== 'done' && tick === 'done') setJustPaid(true)
    lastTick.current = tick
  }, [tick])

  // `?abrir=`: a la vista y marcado dos segundos.
  useEffect(() => {
    if (!highlighted) return
    anchorRef.current?.scrollIntoView({ block: 'center' })
    const timer = window.setTimeout(() => setFlash(false), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [highlighted])

  const payAction = actions.pay
  const tickPays = payAction !== null && (actions.payInRow || (actions.payAhead && inSheet))
  const pay = () => {
    if (payAction === null) return
    if (payAction.kind === 'gasto') {
      onTogglePay()
      // Sin monto no hay qué pagar: el cursor va adonde falta.
      if (!paying && editable && edit.amountCents === null) amountRef.current?.focus()
    } else if (payAction.kind === 'pagar') {
      openAction('pagar', {
        proveedor: payAction.partyId,
        ...(payAction.recurringId ? { 'gasto-fijo': payAction.recurringId } : {}),
      })
    } else router.push(documentHref(tenantSlug, payAction.documentId))
  }
  // De una factura cargada se paga lo que le falta; si no, lo que dice la celda.
  const payCents = line.documentId !== null ? line.remainingCents : edit.amountCents
  const payLabel = `Pagar ${row.name}${payCents !== null ? `, ${formatCentsShort(payCents)}` : ''}`

  const run = (entry: RowMenuItem) => {
    switch (entry.run) {
      case 'pay':
        pay()
        break
      case 'skip':
        skip(row)
        break
      case 'unskip':
        unskip(row)
        break
      case 'keep':
        keepAmount(row, entry.cents ?? 0)
        break
      case 'pause':
        pause(row)
        break
      case 'resume':
        resume(row)
        break
      case 'remove':
        setConfirming(true)
        break
      default:
        break
    }
  }

  const menu = writable ? rowMenu(item, actions, { tenantSlug, month, isMisc }) : []
  const detail = actions.ask && status.short ? askWords(status.short) : status.detail
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
  const mark = (
    <StatusMark label={status.label} tone={status.tone} stamp={status.stamp} thud={justPaid} />
  )

  return (
    <>
      <PRow flagged={flash}>
        <PTd className="w-9 pr-0">
          {tickPays && payAction ? (
            <button
              type="button"
              aria-label={payLabel}
              aria-expanded={payAction.kind === 'gasto' ? paying : undefined}
              aria-controls={payAction.kind === 'gasto' && paying ? stripId : undefined}
              onClick={pay}
              className="-m-2.5 flex size-11 cursor-pointer items-center justify-center rounded-lg outline-none hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {tickBox}
            </button>
          ) : (
            tickBox
          )}
        </PTd>
        <PTd className={cn('whitespace-nowrap text-muted-foreground', PHONE_HIDDEN)}>
          {formatDayMonth(item.day)}
        </PTd>
        <PTd className="min-w-40">
          <span
            ref={anchorRef}
            title={rowSubline(row).join(' · ') || undefined}
            className="font-medium [overflow-wrap:anywhere]"
          >
            {row.name}
          </span>
          {cuota ? <small className="block text-xs text-muted-foreground">{cuota}</small> : null}
          {/* En el celular no entran Vence y Estado como columnas: van debajo del concepto. */}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 sm:hidden">
            <small className="text-xs text-muted-foreground">{formatDayMonth(item.day)}</small>
            {mark}
          </span>
        </PTd>
        <PTd align="right">
          {editable ? (
            <span className="inline-flex flex-col items-end gap-0.5">
              <CellMoney
                column="monto"
                label={`Monto de ${row.name}`}
                value={edit.amountCents}
                onValueChange={edit.setAmountCents}
                onCommit={() => void edit.commit()}
                onRevert={edit.revert}
                emptyAllowed
                minCents={1}
                placeholder="Poner monto"
                save={edit.mark.state}
                inputRef={amountRef}
              />
              {failure ? (
                <SaveMark
                  state="error"
                  message={failure.message}
                  onRetry={
                    failure.kind === 'stale'
                      ? () => window.location.reload()
                      : failure.kind === 'other'
                        ? () => void edit.commit()
                        : undefined
                  }
                  retryLabel={failure.kind === 'stale' ? 'Recargar' : 'Reintentar'}
                  className="max-w-44 justify-end text-right whitespace-normal"
                />
              ) : null}
              {failure?.kind === 'category' ? (
                <Link
                  href={recurringHref(tenantSlug, row.id)}
                  className="rounded-sm text-xs font-medium underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Cambiarla en la ficha
                </Link>
              ) : null}
            </span>
          ) : line.dueCents !== null ? (
            <span
              className={AMOUNT_ALIGN}
              title={row.breakdown.length > 0 ? 'La suma del detalle' : undefined}
            >
              {formatCentsShort(line.dueCents)}
            </span>
          ) : (
            <span className={cn(AMOUNT_ALIGN, 'text-muted-foreground')}>
              <span aria-hidden>—</span>
              <span className="sr-only">Sin monto</span>
            </span>
          )}
        </PTd>
        <PTd className={PHONE_HIDDEN}>
          <span className="flex flex-col items-start gap-0.5">
            {line.documentId ? (
              <Link
                href={documentHref(tenantSlug, line.documentId)}
                title={status.title}
                aria-label={`${status.title}. Ver el comprobante de ${row.name}`}
                className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {mark}
              </Link>
            ) : (
              <span title={status.title}>{mark}</span>
            )}
            {detail ? (
              <span className="text-xs text-muted-foreground text-pretty">{detail}</span>
            ) : null}
            {status.extras.map((extra) => (
              <span key={extra} className="text-[11px] text-muted-foreground">
                {extra}
              </span>
            ))}
          </span>
        </PTd>
        {writable ? (
          <PTd align="right" className="w-10 pl-0">
            <span className={ROW_ACTION}>
              <RowMenu name={row.name} entries={menu} disabled={busy} onRun={run} />
            </span>
          </PTd>
        ) : null}
      </PRow>

      {paying ? (
        <tr id={stripId}>
          <td colSpan={writable ? 6 : 5} className="border-b border-border/60 bg-secondary/40 p-0">
            {/* Si la tabla se desliza en el celular, la tira se queda a la vista. */}
            <div className="adm-rise sticky left-0 w-full max-w-[calc(100vw-2rem-2px)] px-3 py-3 sm:max-w-none">
              <PayStrip
                row={row}
                month={month}
                amountCents={edit.amountCents}
                onAmountRead={
                  editable
                    ? (cents) => {
                        edit.setAmountCents(cents)
                        void edit.save({ amountCents: cents })
                      }
                    : null
                }
                data={strip.data}
                message={strip.message}
                onRetry={strip.reload}
                onCancel={onTogglePay}
                onPaid={onPaid}
              />
            </div>
          </td>
        </tr>
      ) : null}

      {writable ? (
        <AlertDialog open={confirming} onOpenChange={(next) => !busy && setConfirming(next)}>
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
                  remove(row, () => setConfirming(false))
                }}
              >
                {busy ? 'Eliminando…' : 'Eliminar'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  )
}

function RowMenu({
  name,
  entries,
  disabled,
  onRun,
}: {
  name: string
  entries: readonly RowMenuItem[]
  disabled: boolean
  onRun: (entry: RowMenuItem) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Más opciones de ${name}`}
          className="size-11 rounded-md text-muted-foreground hover:text-foreground md:pointer-fine:size-7"
        >
          <Ellipsis aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {entries.map((entry, index) => {
          const body = (
            <span className="grid gap-0.5">
              <span>{entry.label}</span>
              {entry.hint ? (
                <span className="text-xs text-muted-foreground text-pretty">{entry.hint}</span>
              ) : null}
            </span>
          )
          return (
            <Fragment key={entry.key}>
              {index > 0 && entries[index - 1]?.section !== entry.section ? (
                <DropdownMenuSeparator />
              ) : null}
              {entry.href !== undefined ? (
                <DropdownMenuItem asChild className="min-h-11 md:min-h-8">
                  <Link href={entry.href}>{body}</Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={disabled}
                  variant={entry.run === 'remove' ? 'destructive' : undefined}
                  className="min-h-11 md:min-h-8"
                  onSelect={() => onRun(entry)}
                >
                  {body}
                </DropdownMenuItem>
              )}
            </Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
