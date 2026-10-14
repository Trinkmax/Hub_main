'use client'

import { Bike, CircleCheck, CreditCard, type LucideIcon, UserRound, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DEDUCTION_KINDS } from '@/lib/accounting/schemas'
import type { PartyKind } from '@/lib/accounting/types'
import { formatCents, formatCentsShort, NBSP } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  ChoiceCard,
  StatusPill,
  Term,
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketTotal,
} from '../kit'
import type {
  DeductionKind,
  Deductions,
  PayerCard,
  SettlementSummary,
  VoucherMode,
} from './cobrar-cuenta'

/**
 * Lo que se VE de «Registrar un cobro» y no tiene estado propio: la hoja le
 * pasa sus números ya calculados y sus mismos manejadores, y estas piezas solo
 * dibujan. La cuenta está en `cobrar-cuenta.ts`.
 */

// ─── ① ¿Quién te pagó? ───────────────────────────────────────────────────────

const PAYER_ICONS: Partial<Record<PartyKind, LucideIcon>> = {
  card_processor: CreditCard,
  delivery_platform: Bike,
  payment_wallet: Wallet,
  customer: UserRound,
}

/** El círculo con el ícono de quién paga (una tarjeta, una app, una billetera, un cliente). */
function PayerArt({ kind }: { kind: PartyKind }) {
  const Icon = PAYER_ICONS[kind] ?? UserRound
  return (
    <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
      <Icon className="size-5" aria-hidden />
    </span>
  )
}

/**
 * Los que más deben, como tarjetas para elegir con un toque (un radio de
 * verdad): quién es y, debajo, cuánto debe y desde cuándo. Los demás quedan en
 * el buscador de abajo.
 */
export function PayerChoices({
  name,
  labelledBy,
  cards,
  value,
  onPick,
}: {
  /** El `name` del grupo de radios. */
  name: string
  labelledBy: string
  cards: readonly PayerCard[]
  value: string | null
  onPick: (partyId: string) => void
}) {
  if (cards.length === 0) return null
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-2">
      {cards.map((card) => (
        <ChoiceCard
          key={card.id}
          name={name}
          value={card.id}
          checked={value === card.id}
          onChange={() => onPick(card.id)}
          art={<PayerArt kind={card.kind} />}
          title={<span className="text-pretty">{card.name}</span>}
          consequence={card.consequence}
        />
      ))}
    </div>
  )
}

// ─── ③ El número que importa ─────────────────────────────────────────────────

/**
 * «Te descontaron $ 127.465 (6,7 %)»: lo que suman las ventas menos lo que
 * entró. Mientras los descuentos de abajo no se toquen, lleva «Estimado».
 * Un cliente no «descuenta»: «retiene».
 */
export function SettlementNumber({
  summary,
  estimated,
  isCustomer,
}: {
  summary: SettlementSummary
  /** Los descuentos de abajo todavía son los precargados. */
  estimated: boolean
  isCustomer: boolean
}) {
  if (summary.discountCents === 0) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-medium text-success">
        <CircleCheck className="size-4" aria-hidden />
        Te entró todo: no te descontaron nada.
      </p>
    )
  }
  // Sin centavos (es un titular), y el porcentaje y «Estimado» van juntos: en el celular bajan
  // los dos al renglón de abajo, nunca «(13,6» arriba y «%)» abajo.
  return (
    <p
      role="status"
      className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 font-serif text-2xl font-semibold leading-tight tracking-tight"
    >
      <span>
        {isCustomer ? 'Te retuvieron' : 'Te descontaron'}{' '}
        <span className="whitespace-nowrap tabular-nums">
          {formatCentsShort(summary.discountCents)}
        </span>
      </span>
      <span className="inline-flex items-center gap-2 whitespace-nowrap font-sans text-base font-normal text-muted-foreground tabular-nums">
        ({summary.percentText.replace(' %', `${NBSP}%`)})
        {estimated ? (
          <StatusPill tone="muted" className="font-sans">
            Estimado
          </StatusPill>
        ) : null}
      </span>
    </p>
  )
}

// ─── ③ Lo que falta explicar ─────────────────────────────────────────────────

/** Cada salida de «Faltan explicar»: alto parejo y el texto puede bajar de renglón. */
const MISSING_CHOICE =
  'h-auto min-h-11 whitespace-normal px-2 py-1.5 text-center leading-tight text-balance md:min-h-9'

/**
 * La cuenta tiene que cerrar: ventas − descuentos = lo que entró. Si falta
 * explicar algo, tres salidas en un toque; si entró de más, queda a cuenta.
 * Son los mismos cuatro manejadores de siempre, con otras palabras.
 */
export function MissingLine({
  missing,
  received,
  estimated,
  error,
  onCommission,
  onOther,
  onDifference,
  onOnAccount,
}: {
  /** Ventas − lo que entró − descuentos. `null` mientras falte un dato. */
  missing: number | null
  received: number | null
  /** Los descuentos todavía son los precargados. */
  estimated: boolean
  error: string | null
  onCommission: () => void
  onOther: () => void
  onDifference: () => void
  onOnAccount: () => void
}) {
  if (received === null) {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        Escribí cuánto te entró y te mostramos cuánto te descontaron.
      </p>
    )
  }
  if (missing === null) return null
  if (missing === 0) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-medium text-success">
        <CircleCheck className="size-4" aria-hidden />
        Coincide con la liquidación.
      </p>
    )
  }
  return (
    <div
      className={cn(
        'space-y-2.5 rounded-xl border p-4 text-sm',
        error ? 'border-destructive/30 bg-destructive/10' : 'border-warning/40 bg-warning/10',
      )}
    >
      <p
        role="status"
        className={cn('font-medium', error ? 'text-destructive' : 'text-warning-text')}
      >
        {missing > 0
          ? `Faltan explicar ${formatCentsShort(missing)}. ¿Qué es?`
          : `Entraron ${formatCentsShort(-missing)} más de lo que da la cuenta`}
      </p>
      {missing > 0 ? (
        // Las tres salidas, parejas en una grilla de tres (en el celular quedaban 2 + 1).
        <div className="grid grid-cols-3 gap-2">
          <Button type="button" size="sm" className={MISSING_CHOICE} onClick={onCommission}>
            Es comisión
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={MISSING_CHOICE}
            onClick={onOther}
          >
            Son otros cargos
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={MISSING_CHOICE}
            onClick={onDifference}
          >
            No sé qué es
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 md:h-9"
            onClick={onOnAccount}
          >
            Dejarlo a cuenta ({formatCentsShort(-missing)})
          </Button>
        </div>
      )}
      {missing < 0 && estimated ? (
        <p className="text-xs text-muted-foreground text-pretty">
          Si te descontaron menos de lo estimado, bajá la comisión de arriba.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

// ─── ③ Las palabras de cada descuento ────────────────────────────────────────

const DEDUCTION_TEXT: Readonly<Record<DeductionKind, string>> = {
  comision: 'Comisión',
  iva_comision: 'IVA de la comisión',
  percepcion_iva_comision: 'Percepción de IVA',
  ret_iva: 'Retención de IVA',
  ret_iibb: 'Retención de Ingresos Brutos',
  sircupa: 'SIRCUPA',
  ret_ganancias: 'Retención de Ganancias',
  otro: 'Otros cargos',
  diferencia: 'Diferencia sin explicar',
}

/** El nombre de un descuento, en texto plano (para el menú y el ticket). */
export function deductionText(kind: DeductionKind): string {
  return kind === 'sircupa' ? 'Retención de la cuenta bancaria' : DEDUCTION_TEXT[kind]
}

/** El nombre de un descuento en su renglón: la sigla va con la idea primero. */
export function DeductionLabel({ kind }: { kind: DeductionKind }): ReactNode {
  if (kind === 'sircupa') return <Term name="SIRCUPA">Retención de la cuenta bancaria</Term>
  return DEDUCTION_TEXT[kind]
}

// ─── ③ La factura de la comisión ─────────────────────────────────────────────

export const VOUCHER_MODE_WORDS: Readonly<
  Record<VoucherMode, { title: string; consequence: string }>
> = {
  included: {
    title: 'Viene en la liquidación',
    consequence: 'Recuperás el IVA de la comisión.',
  },
  later: {
    title: 'Llega después',
    consequence: 'El IVA queda esperando esa factura.',
  },
  none: {
    title: 'No te dan factura',
    consequence: 'El IVA de la comisión va al costo.',
  },
}

const VOUCHER_MODES: readonly VoucherMode[] = ['included', 'later', 'none']

/** Las tres maneras en que una tarjeta o una app factura su comisión, como tarjetas para elegir. */
export function VoucherModeChoices({
  name,
  labelledBy,
  value,
  onPick,
}: {
  name: string
  labelledBy: string
  value: VoucherMode
  onPick: (mode: VoucherMode) => void
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-2">
      {VOUCHER_MODES.map((mode) => (
        <ChoiceCard
          key={mode}
          name={name}
          value={mode}
          checked={value === mode}
          onChange={() => onPick(mode)}
          title={VOUCHER_MODE_WORDS[mode].title}
          consequence={VOUCHER_MODE_WORDS[mode].consequence}
        />
      ))}
    </div>
  )
}

// ─── El ticket de la liquidación ─────────────────────────────────────────────

/**
 * La liquidación como papel: las ventas que te pagan, cada descuento con su
 * «−» y, abajo, lo que entró a la caja. Es la cascada del cobro (no hace falta
 * otro gráfico dentro de la hoja). Si queda algo sin explicar, va en gris.
 */
export function SettlementTicket({
  payer,
  appliedCents,
  creditUsedCents,
  grossCents,
  grossEdited,
  isCustomer,
  rows,
  missing,
  received,
  treasuryName,
  summary,
}: {
  /** Quién pagó. */
  payer: string
  /** Lo que suman las ventas tildadas. */
  appliedCents: number
  /** Lo que se descuenta de lo que le debíamos (o de su saldo a favor). */
  creditUsedCents: number
  /** El total de la liquidación. */
  grossCents: number | null
  /** El total se escribió a mano («El total de la liquidación es otro»). */
  grossEdited: boolean
  isCustomer: boolean
  rows: Deductions
  missing: number | null
  received: number | null
  treasuryName: string | null
  summary: SettlementSummary | null
}) {
  const minus = (cents: number) => `− ${formatCents(cents)}`
  const deductions = DEDUCTION_KINDS.filter((kind) => (rows[kind].amount ?? 0) > 0)
  return (
    <Ticket aria-label={`Liquidación de ${payer}`}>
      <TicketHeader title={isCustomer ? 'Cobro' : 'Liquidación'} subtitle={payer} />
      <TicketRule />
      {grossEdited || appliedCents <= 0 ? (
        <TicketRow
          label={isCustomer ? 'Lo que te paga' : 'Total de la liquidación'}
          muted={grossCents === null}
          value={grossCents === null ? '—' : formatCents(grossCents)}
        />
      ) : (
        <>
          <TicketRow label="Ventas que te pagan" value={formatCents(appliedCents)} />
          {creditUsedCents > 0 ? (
            <TicketRow
              label={isCustomer ? 'Saldo a favor que usa' : 'Lo que le debíamos'}
              value={minus(creditUsedCents)}
            />
          ) : null}
        </>
      )}
      {deductions.map((kind) => (
        <TicketRow key={kind} label={deductionText(kind)} value={minus(rows[kind].amount ?? 0)} />
      ))}
      {missing !== null && missing > 0 ? (
        <TicketRow muted label="Sin explicar" value={minus(missing)} />
      ) : null}
      <TicketRule double />
      <TicketTotal
        label={treasuryName ? `Entró a ${treasuryName}` : 'Entró'}
        value={received !== null && received > 0 ? formatCents(received) : '—'}
      />
      {summary && summary.discountCents > 0 ? (
        <TicketNote>Te quedan {summary.keptOfHundred} de cada $ 100.</TicketNote>
      ) : null}
    </Ticket>
  )
}
