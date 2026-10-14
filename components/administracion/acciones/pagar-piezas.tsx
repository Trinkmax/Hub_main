'use client'

import { ArrowRight, Check, ChevronDown, ChevronRight, Repeat, ShoppingBasket } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { RailWords } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/libreta'
import type { PaymentOutcome } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/pay-summary'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDayMonth } from '@/lib/dates'
import { formatCents, formatCentsShort, MINUS_SIGN } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Amount } from '../amount'
import { Meter } from '../charts/meter'
import {
  LedgerList,
  LedgerRail,
  LedgerRow,
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketTotal,
} from '../kit'

/**
 * Las piezas de la hoja «Pagar» que solo dibujan: los renglones de «Lo más
 * urgente», las dos salidas de «¿No es a un proveedor?», el tilde de una
 * compra, lo que cubre el pago y el ticket. El estado, la cuenta
 * (`planPayment`) y el envío viven en `pagar-sheet.tsx`.
 */

/** El tilde de un renglón que se tilda (una compra, algo a favor). Con el color va la marca. */
export function TickMark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors duration-(--duration-fast) motion-reduce:transition-none',
        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card',
      )}
    >
      {on ? <Check className="size-3.5" strokeWidth={3.5} /> : null}
    </span>
  )
}

export type UrgentSupplier = {
  partyId: string
  name: string
  rail: RailWords | null
  debtCents: number
}

/**
 * «Lo más urgente»: los proveedores a los que más apura pagarles, como
 * renglones de la libreta (el vencimiento en el margen, cuánto se les debe a la
 * derecha). Tocar uno pasa a pagarle. `null` = los saldos todavía están
 * llegando (tres renglones en esqueleto).
 */
export function UrgentSuppliers({
  rows,
  onPick,
}: {
  rows: readonly UrgentSupplier[] | null
  onPick: (partyId: string) => void
}) {
  if (rows === null) {
    return (
      <div
        className="card-hairline overflow-hidden rounded-2xl border bg-card shadow-xs"
        aria-busy="true"
      >
        <span className="sr-only">Cargando a quién le debés…</span>
        <div className="divide-y divide-border/60">
          {['a', 'b', 'c'].map((k) => (
            <div key={k} className="flex">
              <div className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 border-r border-adm-s5/35 py-3">
                <Skeleton className="h-2 w-8" />
                <Skeleton className="h-5 w-6" />
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-4 px-3 py-3.5">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-4 w-20 shrink-0" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <LedgerList aria-label="Lo más urgente">
      {rows.map((row) => (
        <LedgerRow
          key={row.partyId}
          rail={row.rail ? <LedgerRail {...row.rail} /> : undefined}
          title={row.name}
          onClick={() => onPick(row.partyId)}
          amount={
            <span className="flex items-center gap-1.5">
              <span>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  Le debés
                </span>
                <Amount cents={row.debtCents} decimals={0} />
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </span>
          }
        />
      ))}
    </LedgerList>
  )
}

const WAY_OUT =
  'flex min-h-14 w-full items-center gap-3 rounded-xl bg-secondary/50 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring'

export type PendingFixed = {
  id: string
  name: string
  nextDueDate: string
  /** `null` = monto variable. */
  amountCents: number | null
}

/**
 * «¿No es a un proveedor?»: las otras dos cosas que se pagan. «Un gasto fijo»
 * se despliega en el lugar con los de este mes que faltan cargar (tocar uno
 * abre «Nuevo gasto» con ese gasto fijo); «Otro gasto» abre «Nuevo gasto».
 * Los dos renglones se ven desde el primer instante; la lista, cuando llega
 * (`fixed: null` = todavía cargando).
 */
export function OtherThanSupplier({
  fixedLabel,
  fixedHint,
  otherLabel,
  otherHint,
  open,
  onToggle,
  fixed,
  onPickFixed,
  onOther,
  sheetHref,
}: {
  fixedLabel: string
  fixedHint: string
  otherLabel: string
  otherHint: string
  /** «Un gasto fijo» está desplegado. */
  open: boolean
  onToggle: () => void
  fixed: readonly PendingFixed[] | null
  onPickFixed: (id: string) => void
  onOther: () => void
  /** «Ver la planilla»: la pantalla de Gastos fijos. */
  sheetHref: string
}) {
  return (
    <div className="grid gap-2">
      <div className="rounded-xl bg-secondary/50">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={cn(WAY_OUT, 'bg-transparent')}
        >
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-accent-foreground shadow-2xs"
          >
            <Repeat className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{fixedLabel}</span>
            <span className="block text-xs text-muted-foreground text-pretty">{fixedHint}</span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        </button>
        {open ? (
          <div className="px-3.5 pb-3">
            {fixed === null ? (
              <div className="space-y-2" aria-busy="true">
                <span className="sr-only">Cargando los gastos fijos…</span>
                <Skeleton className="h-11 w-full rounded-lg" />
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
            ) : fixed.length === 0 ? (
              <p className="text-sm text-muted-foreground text-pretty">
                No hay gastos fijos sin pagar este mes.
              </p>
            ) : (
              <ul className="grid gap-1.5">
                {fixed.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onPickFixed(item.id)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-left text-sm shadow-2xs outline-none transition-colors hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{item.name}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">
                          vence el {formatDayMonth(item.nextDueDate)}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums whitespace-nowrap">
                        {item.amountCents !== null ? (
                          formatCentsShort(item.amountCents)
                        ) : (
                          <span className="text-xs text-muted-foreground">sin monto</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={sheetHref}
              className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
            >
              Ver la planilla
              <ArrowRight aria-hidden className="size-3" />
            </Link>
          </div>
        ) : null}
      </div>
      <button type="button" onClick={onOther} className={WAY_OUT}>
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-accent-foreground shadow-2xs"
        >
          <ShoppingBasket className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{otherLabel}</span>
          <span className="block text-xs text-muted-foreground text-pretty">{otherHint}</span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  )
}

/**
 * Lo que cubre el pago: el avance contra TODO lo que se le debe y una oración
 * («Le quedás debiendo $ X»). Reemplaza a los tres avisos sueltos de antes.
 */
export function PayCover({ outcome }: { outcome: PaymentOutcome }) {
  return (
    <div className="grid gap-2 rounded-xl bg-secondary/50 px-3.5 py-3" aria-live="polite">
      {outcome.totalCents > 0 ? (
        <Meter
          valueCents={outcome.coveredCents}
          totalCents={outcome.totalCents}
          height={6}
          label="Lo que cubre este pago"
        />
      ) : null}
      <p
        className={cn(
          'text-sm text-pretty',
          outcome.kind === 'nothing' ? 'text-muted-foreground' : 'font-medium',
        )}
      >
        {outcome.sentence}
      </p>
      {outcome.details.map((detail) => (
        <p key={detail} className="text-xs text-muted-foreground text-pretty">
          {detail}
        </p>
      ))}
    </div>
  )
}

export type PayTicketRow = { key: string; label: ReactNode; cents: number }

/**
 * El ticket del pago (sin sello: un pago no es un papel con o sin factura): a
 * quién, qué compras paga, lo que se usa de lo que hay a favor, y cuánto sale
 * de qué caja. La letra chica es la misma oración de arriba.
 */
export function PayTicket({
  name,
  subtitle,
  rows,
  more,
  moreCents,
  creditUsedCents,
  writeOffCents,
  totalLabel,
  totalCents,
  totalHint,
  note,
  pending,
}: {
  name: string
  /** «Mar 13/10». */
  subtitle: string
  rows: readonly PayTicketRow[]
  /** Cuántas compras quedaron afuera de los renglones («y 2 más»). */
  more: number
  moreCents: number
  creditUsedCents: number
  writeOffCents: number
  totalLabel: string
  /** `null` = todavía sin importe. */
  totalCents: number | null
  totalHint?: ReactNode
  note: ReactNode
  pending: boolean
}) {
  const exact = (cents: number) =>
    cents % 100 === 0 ? formatCentsShort(cents) : formatCents(cents)
  const hasRows = rows.length > 0 || creditUsedCents > 0 || writeOffCents > 0
  return (
    <Ticket aria-label="Lo que vas a pagar" className="mx-auto w-full max-w-[22rem]">
      <TicketHeader
        title={`Pago a ${name}`}
        subtitle={subtitle}
        className={cn(pending && 'opacity-70')}
      />
      <TicketRule />
      {rows.map((row) => (
        <TicketRow key={row.key} label={row.label} value={exact(row.cents)} />
      ))}
      {more > 0 ? (
        <TicketRow
          label={more === 1 ? 'y 1 compra más' : `y ${more} compras más`}
          value={exact(moreCents)}
          muted
        />
      ) : null}
      {creditUsedCents > 0 ? (
        <TicketRow label="A favor que usás" value={`${MINUS_SIGN} ${exact(creditUsedCents)}`} />
      ) : null}
      {writeOffCents > 0 ? (
        <TicketRow label="Redondeo" value={`${MINUS_SIGN} ${exact(writeOffCents)}`} />
      ) : null}
      {hasRows ? <TicketRule double /> : null}
      <TicketTotal
        label={totalLabel}
        value={
          totalCents !== null && totalCents > 0 ? (
            exact(totalCents)
          ) : (
            <>
              <span aria-hidden>—</span>
              <span className="sr-only">Todavía sin importe</span>
            </>
          )
        }
        hint={totalHint}
      />
      <TicketNote className={cn(pending && 'font-medium text-foreground')}>{note}</TicketNote>
    </Ticket>
  )
}
