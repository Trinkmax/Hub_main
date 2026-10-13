'use client'

import { AlertTriangle, ArrowRight } from 'lucide-react'
import { type ReactNode, useSyncExternalStore } from 'react'
import type { QuickVoucher } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import type { SheetTreasury } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'
import {
  ChoiceCard,
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from '@/components/administracion/kit'
import { cn } from '@/lib/utils'
import {
  PAPER_OPTIONS,
  type PaperOption,
  type PaperStamp,
  treasuryAfter,
  treasuryAfterWords,
  treasuryMoneyText,
} from './gasto-papel'

/**
 * Lo que se VE de «Nuevo gasto» (rediseño de oct 2026): los cuatro papeles
 * para elegir, cómo queda la caja y el ticket con sello. Nada de acá decide
 * qué se guarda: reciben el estado de la hoja y avisan lo que la persona tocó.
 * Los textos y las cuentas viven en `gasto-papel.ts` (puro, con tests).
 */

// ─── Los dibujos ─────────────────────────────────────────────────────────────

const FAINT = 'stroke-adm-paper-ink/30'
const INK = 'stroke-adm-paper-ink'
const LETTER = {
  textAnchor: 'middle',
  dominantBaseline: 'central',
  fontWeight: 700,
} as const

/**
 * El papel, dibujado: lo que la persona tiene en la mano cuando contesta. Cada
 * uno se reconoce por la forma antes de leer el título: la factura lleva su
 * letra en el recuadro del membrete (la A, además, el renglón del IVA aparte),
 * el tique es angosto y termina dentado, el remito es el papel sin valor
 * fiscal (contorno punteado y una firma). Es papel: claro también en oscuro.
 * Decorativo: el nombre lo dice el título de la tarjeta.
 */
export function PaperArt({ kind, className }: { kind: QuickVoucher; className?: string }) {
  const frame = cn('h-13 w-11 shrink-0', className)
  if (kind === 'a') {
    return (
      <svg viewBox="0 0 44 52" fill="none" aria-hidden="true" className={frame}>
        <rect
          x="5"
          y="2.5"
          width="34"
          height="47"
          rx="2.5"
          strokeWidth="1.25"
          className="fill-adm-paper stroke-adm-paper-rule"
        />
        <path
          d="M9 8.5h6M9 12h4.5M29 8.5h6M30.5 12h4.5"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={FAINT}
        />
        <rect x="17.5" y="5.5" width="9" height="9" rx="1" strokeWidth="1.25" className={INK} />
        <text x="22" y="10.2" fontSize="7" className="fill-adm-paper-ink" {...LETTER}>
          A
        </text>
        <path d="M5 18.5h34" strokeWidth="1" className="stroke-adm-paper-rule" />
        <path
          d="M9 23.5h16M9 28h12M30 23.5h5M31 28h4"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={FAINT}
        />
        {/* El IVA va en su propio renglón: es lo que se recupera. */}
        <rect x="7.5" y="32" width="29" height="7" rx="2" className="fill-adm-s1/15" />
        <path
          d="M10.5 35.5h8M28.5 35.5h5.5"
          strokeWidth="1.75"
          strokeLinecap="round"
          className="stroke-adm-s1"
        />
        <path d="M9 44.5h8M27 44.5h8" strokeWidth="1.75" strokeLinecap="round" className={INK} />
      </svg>
    )
  }
  if (kind === 'bc') {
    return (
      <svg viewBox="0 0 44 52" fill="none" aria-hidden="true" className={frame}>
        {/* Atrás asoma la C: puede ser cualquiera de las dos. */}
        <rect
          x="12"
          y="2.5"
          width="29"
          height="43"
          rx="2.5"
          strokeWidth="1.25"
          className="fill-adm-paper stroke-adm-paper-rule"
        />
        <rect
          x="32.5"
          y="5"
          width="6.5"
          height="6.5"
          rx="1"
          strokeWidth="1"
          className="stroke-adm-paper-ink/60"
        />
        <text x="35.75" y="8.4" fontSize="5" className="fill-adm-paper-ink/70" {...LETTER}>
          C
        </text>
        <rect
          x="3"
          y="7"
          width="29"
          height="43"
          rx="2.5"
          strokeWidth="1.25"
          className="fill-adm-paper stroke-adm-paper-rule"
        />
        <path
          d="M6.5 12.5h4.5M6.5 15.5h3.5M24 12.5h5M25 15.5h4"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={FAINT}
        />
        <rect x="13.5" y="10" width="8" height="8" rx="1" strokeWidth="1.25" className={INK} />
        <text x="17.5" y="14.2" fontSize="6.5" className="fill-adm-paper-ink" {...LETTER}>
          B
        </text>
        <path d="M3 21.5h29" strokeWidth="1" className="stroke-adm-paper-rule" />
        <path
          d="M6.5 26.5h13M6.5 31h10M6.5 35.5h12M24.5 26.5h4.5M25.5 31h3.5M24.5 35.5h4.5"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={FAINT}
        />
        <path
          d="M6.5 44h7.5M21.5 44h7.5"
          strokeWidth="1.75"
          strokeLinecap="round"
          className={INK}
        />
      </svg>
    )
  }
  if (kind === 'ticket') {
    return (
      <svg viewBox="0 0 44 52" fill="none" aria-hidden="true" className={frame}>
        <path
          d="M12 2.5h20v43.5l-2.5 3-2.5-3-2.5 3-2.5-3-2.5 3-2.5-3-2.5 3-2.5-3z"
          strokeWidth="1.25"
          strokeLinejoin="round"
          className="fill-adm-paper stroke-adm-paper-rule"
        />
        <path d="M17 8h10M19 11.5h6" strokeWidth="1.5" strokeLinecap="round" className={FAINT} />
        <path
          d="M15 16.5h14M15 35h14"
          strokeWidth="1"
          strokeDasharray="1.5 2"
          className="stroke-adm-paper-ink/45"
        />
        <path
          d="M15.5 21.5h7M15.5 26h5M15.5 30.5h8M25.5 21.5h3M25.5 26h3M25.5 30.5h3"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={FAINT}
        />
        <path d="M15.5 40h5M23.5 40h5" strokeWidth="1.75" strokeLinecap="round" className={INK} />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 44 52" fill="none" aria-hidden="true" className={frame}>
      <rect
        x="5"
        y="2.5"
        width="34"
        height="47"
        rx="2.5"
        strokeWidth="1.25"
        strokeDasharray="3 2.5"
        className="fill-adm-paper stroke-adm-paper-ink/45"
      />
      <path
        d="M9 8.5h6M9 12h4.5M29 8.5h6M30.5 12h4.5"
        strokeWidth="1.5"
        strokeLinecap="round"
        className={FAINT}
      />
      <rect
        x="17.5"
        y="5.5"
        width="9"
        height="9"
        rx="1"
        strokeWidth="1.25"
        strokeDasharray="2 1.5"
        className="stroke-adm-paper-ink/60"
      />
      <text x="22" y="10.2" fontSize="7" className="fill-adm-paper-ink/70" {...LETTER}>
        R
      </text>
      <path
        d="M9 22.5h18M9 27h12M9 31.5h15"
        strokeWidth="1.5"
        strokeLinecap="round"
        className={FAINT}
      />
      {/* La firma de quien entregó: lo único que suele traer un remito. */}
      <path
        d="M11 42.5c1.5-4.5 3-4.5 4-.5s2.5 3.5 4-.5 3-3 4 .5 3 2.5 6-1.5"
        strokeWidth="1.25"
        strokeLinecap="round"
        className="stroke-adm-paper-ink/70"
      />
      <path d="M9 46h26" strokeWidth="1" className="stroke-adm-paper-rule" />
    </svg>
  )
}

// ─── ¿Qué papel te dieron? ───────────────────────────────────────────────────

/** Desde `sm` la hoja mide 560 px y entran dos papeles por fila. */
const TWO_COLUMNS = '(min-width: 40rem)'

function subscribeTwoColumns(onChange: () => void): () => void {
  const query = window.matchMedia(TWO_COLUMNS)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** En el celular los papeles van uno por renglón (el dibujo a la izquierda): así la línea de cada uno se lee entera. */
function useTwoColumns(): boolean {
  return useSyncExternalStore(
    subscribeTwoColumns,
    () => window.matchMedia(TWO_COLUMNS).matches,
    () => false,
  )
}

/**
 * Los cuatro papeles. Reemplaza a «¿Se factura? Sí / No» + los chips de
 * comprobante: cada tarjeta escribe uno de los cuatro valores de siempre.
 * Radios de verdad (flechas, Tab). `onPick` también corre al tocar la que ya
 * estaba elegida: es la persona confirmando lo que el sistema propuso, y
 * desde ahí ya no se lo pisa lo que se recuerde del proveedor.
 */
export function PaperChoices({
  name,
  labelledBy,
  value,
  onPick,
  consequenceFor,
}: {
  /** El `name` del grupo de radios (único por hoja). */
  name: string
  labelledBy: string
  value: QuickVoucher
  onPick: (voucher: QuickVoucher) => void
  consequenceFor: (option: PaperOption) => string
}) {
  const twoColumns = useTwoColumns()
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-2.5 sm:grid-cols-2">
      {PAPER_OPTIONS.map((option) => (
        <ChoiceCard
          key={option.value}
          name={name}
          value={option.value}
          checked={value === option.value}
          onChange={() => onPick(option.value)}
          onClick={() => {
            if (value === option.value) onPick(option.value)
          }}
          layout={twoColumns ? 'stack' : 'row'}
          art={
            twoColumns ? (
              // Con el dibujo arriba, más grande y alineado con el texto (la pieza lo centra).
              <span className="flex w-full">
                <PaperArt kind={option.value} className="h-16 w-[3.375rem]" />
              </span>
            ) : (
              <PaperArt kind={option.value} />
            )
          }
          title={option.title}
          consequence={consequenceFor(option)}
        />
      ))}
    </div>
  )
}

// ─── La caja: antes → después ────────────────────────────────────────────────

/**
 * Debajo de «¿Con qué pagaste?»: cuánto hay hoy en la caja elegida y cuánto
 * queda con este gasto. Aparece recién con el importe (sin importe, el saldo
 * ya está en el chip). Si una caja que no admite negativo quedaría en rojo, lo
 * dice acá, antes del aviso que el servidor muestra al guardar; no bloquea.
 */
export function TreasuryAfterLine({
  treasury,
  amountCents,
}: {
  treasury: SheetTreasury
  amountCents: number | null
}) {
  const after = treasuryAfter(treasury, amountCents)
  const words = treasuryAfterWords(treasury.kind, after)
  if (words === null) return null
  const short = after.state === 'short'
  return (
    <div className="rounded-xl bg-secondary/50 px-3.5 py-2.5 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="max-w-full truncate font-medium">{treasury.name}</span>
        <span className="text-muted-foreground">
          {words.before.label} <span className="tabular-nums">{words.before.amount}</span>
        </span>
        <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={cn(short && 'text-warning-text')}>
          {words.after.label}{' '}
          <span className="font-semibold tabular-nums">{words.after.amount}</span>
        </span>
      </p>
      {short ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning-text text-pretty">
          <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
          Con lo cargado hasta hoy no alcanza. ¿Falta cargar lo que había, algún ingreso o el cierre
          del día? Lo podés guardar igual.
        </p>
      ) : null}
    </div>
  )
}

// ─── El ticket ───────────────────────────────────────────────────────────────

export type GastoTicketRow = { key: string; label: ReactNode; value: ReactNode; hint?: ReactNode }

/**
 * El papel de lo que se está por guardar, en palabras: a quién, en qué, con
 * qué sello y cuánto sale de qué caja. Va justo antes del botón. No es el
 * asiento (ese queda plegado debajo, para la contadora): es lo que el dueño
 * controla de un vistazo. Con datos faltantes igual se dibuja, con «—» y lo
 * que falta en la letra chica: nunca un «$ 0».
 */
export function GastoTicket({
  title,
  subtitle,
  stamp,
  stampNonce,
  rows,
  totalLabel,
  total,
  totalHint,
  note,
  pending,
}: {
  title: ReactNode
  subtitle: ReactNode
  stamp: PaperStamp
  /** Sube cada vez que la persona elige un papel: el sello entra de nuevo. En 0, quieto. */
  stampNonce: number
  rows: readonly GastoTicketRow[]
  totalLabel: string
  /** Ya formateado, o «—» si todavía no hay importe. */
  total: string
  totalHint?: ReactNode
  note: ReactNode
  /** Falta algo: el papel se ve en borrador. */
  pending: boolean
}) {
  return (
    <Ticket aria-label="Lo que vas a cargar" className="mx-auto w-full max-w-[22rem]">
      <TicketHeader title={title} subtitle={subtitle} className={cn(pending && 'opacity-70')}>
        <TicketStamp key={stampNonce} tone={stamp.tone} animate={stampNonce > 0}>
          {stamp.text}
        </TicketStamp>
      </TicketHeader>
      <TicketRule />
      {rows.map((row) => (
        <TicketRow key={row.key} label={row.label} value={row.value} hint={row.hint} />
      ))}
      {rows.length > 0 ? <TicketRule double /> : null}
      <TicketTotal label={totalLabel} value={total} hint={totalHint} />
      <TicketNote>{note}</TicketNote>
    </Ticket>
  )
}

/** «Caja: $ 394.757 → $ 382.257» para el pie del total, con la flecha dicha en palabras para lectores. */
export function TreasuryAfterHint({
  treasury,
  amountCents,
}: {
  treasury: SheetTreasury
  amountCents: number | null
}) {
  const after = treasuryAfter(treasury, amountCents)
  if (after.afterCents === null) return null
  return (
    <>
      {treasury.name}: {treasuryMoneyText(treasury.kind, after.beforeCents)}{' '}
      <span aria-hidden="true">→</span>
      <span className="sr-only">queda en</span> {treasuryMoneyText(treasury.kind, after.afterCents)}
    </>
  )
}

// ─── Recién cargado ──────────────────────────────────────────────────────────

/**
 * Con «Cargar otro después» la hoja se vacía y sigue abierta: arriba queda lo
 * último que se cargó, con el tilde que se dibuja. El toast con «Deshacer»
 * sigue saliendo igual; esto es para no perder el hilo cuando se cargan varios.
 */
export function SavedNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2.5 rounded-xl bg-secondary/50 px-3.5 py-2.5 text-sm"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-3.5">
          <path
            className="adm-tick adm-tick-draw"
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="3.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="min-w-0 text-pretty">{children}</span>
    </p>
  )
}
