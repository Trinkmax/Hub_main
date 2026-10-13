/**
 * «¿Qué papel te dieron?» de «Nuevo gasto» (rediseño de oct 2026), lo puro:
 * las cuatro tarjetas y qué valor escribe cada una, el sello del ticket, cómo
 * queda la caja («antes → después») y los textos del resumen.
 *
 * NO cambia lo que se guarda. Las tarjetas escriben los mismos cuatro valores
 * de `quickExpenseSchema.voucher` que escribían «¿Se factura? Sí / No» y los
 * chips de comprobante (`none`, `ticket`, `a`, `bc`): cambió cómo se pregunta.
 * Todo queda en el mismo libro; «sin factura» solo dice que no entra al Libro
 * IVA. Lo prueba `administracion-gasto-papel.test.ts`.
 */

import {
  type QuickVoucher,
  quickVoucherInvoiced,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import type { SheetTreasury } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'
import { invoiceLetterFor } from '@/lib/accounting/posting/quick-expense'
import type { IvaCondition, SasIvaCondition } from '@/lib/accounting/types'
import { isVatComputable } from '@/lib/accounting/voucher-types'
import { formatCentsShort } from '@/lib/money'
import { balanceText } from '../format'

// ─── Las cuatro tarjetas ─────────────────────────────────────────────────────

export type PaperOption = {
  /** Lo que se guarda en `voucher`: no se inventa ningún valor nuevo. */
  value: QuickVoucher
  title: string
  /** Qué cambia si elegís este papel, en una línea. */
  consequence: string
}

/** En el orden en que se ven: del papel que más vale al que menos. */
export const PAPER_OPTIONS: readonly PaperOption[] = [
  { value: 'a', title: 'Factura A', consequence: 'Te discrimina el IVA: lo recuperás.' },
  { value: 'bc', title: 'Factura B o C', consequence: 'Queda registrada. El IVA va al costo.' },
  { value: 'ticket', title: 'Tique', consequence: 'Queda registrado como tique.' },
  {
    value: 'none',
    title: 'Remito o nada',
    consequence: 'Sin factura: queda en tus números y no entra al Libro IVA.',
  },
]

/**
 * ¿Se recupera el IVA de una Factura A? La misma regla del motor
 * (`isVatComputable`): el proveedor y el bar tienen que ser responsables
 * inscriptos. Sin proveedor elegido todavía, alcanza con el bar (una Factura A
 * la emite un responsable inscripto).
 */
export function recoversVat(input: {
  /** `null`: todavía no se eligió proveedor. */
  condition: IvaCondition | null
  sasCondition: SasIvaCondition
}): boolean {
  if (input.condition === null) return input.sasCondition === 'responsable_inscripto'
  return isVatComputable('factura_a', input.condition, input.sasCondition)
}

/**
 * La línea de cada tarjeta. Solo la de Factura A cambia: con la tarjeta elegida
 * y el importe cargado dice cuánto IVA se recupera; si ese IVA no se puede
 * recuperar (el proveedor o el bar no son responsables inscriptos), lo dice.
 * Nunca promete algo que el asiento no va a hacer.
 */
export function paperConsequence(
  option: PaperOption,
  input: {
    selected: QuickVoucher
    recovers: boolean
    /** El IVA que se recupera con lo cargado hasta ahora; `null` si todavía no se sabe. */
    recoveredVatCents: number | null
  },
): string {
  if (option.value !== 'a') return option.consequence
  if (!input.recovers) return 'Te discrimina el IVA, pero acá no se recupera: va al costo.'
  if (input.selected === 'a' && input.recoveredVatCents !== null && input.recoveredVatCents > 0) {
    return `Recuperás ${formatCentsShort(input.recoveredVatCents)} de IVA.`
  }
  return option.consequence
}

/** Una línea del asiento de la vista previa (`EntryPreviewLine`), lo que hace falta de ella. */
type VatLine = { role: string; accountId: string; debitCents: number | null }

/**
 * El IVA que la vista previa manda a crédito fiscal (lo que se recupera): los
 * renglones de IVA que van a esa cuenta. Si el IVA fue al costo, da 0.
 */
export function recoveredVatFromPreview(
  entries: ReadonlyArray<{ lines: readonly VatLine[] }>,
  vatCreditAccountId: string,
): number {
  let total = 0
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.role === 'vat' && line.accountId === vatCreditAccountId) {
        total += line.debitCents ?? 0
      }
    }
  }
  return total
}

// ─── El sello y la letra chica del ticket ────────────────────────────────────

export type PaperStamp = { tone: 'factura' | 'sin'; text: string }

/**
 * El sello del ticket. «Factura B o C» se resuelve como lo hace el motor: B si
 * el proveedor es responsable inscripto, C en cualquier otro caso; sin
 * proveedor todavía, quedan las dos letras.
 */
export function paperStamp(input: {
  voucher: QuickVoucher
  hasParty: boolean
  condition: IvaCondition | null
}): PaperStamp {
  switch (input.voucher) {
    case 'none':
      return { tone: 'sin', text: 'Sin factura' }
    case 'ticket':
      return { tone: 'factura', text: 'Con tique' }
    case 'a':
      return { tone: 'factura', text: 'Con factura A' }
    case 'bc': {
      if (!input.hasParty) return { tone: 'factura', text: 'Con factura B o C' }
      const letter = invoiceLetterFor(input.condition ?? 'sin_datos') === 'factura_b' ? 'B' : 'C'
      return { tone: 'factura', text: `Con factura ${letter}` }
    }
  }
}

/**
 * Qué pasa con este gasto, en una oración (la letra chica del ticket).
 * `outcome` es lo que arma el motor (`quickExpenseOutcome`): un gasto, o una
 * compra con su pago. Solo una compra con número entra al Libro IVA.
 */
export function paperOutcomeNote(input: {
  voucher: QuickVoucher
  outcome: 'expense' | 'purchase'
  recovers: boolean
}): string {
  if (!quickVoucherInvoiced(input.voucher)) {
    return 'Queda en tus números, sin factura. No entra al Libro IVA.'
  }
  if (input.voucher === 'ticket') {
    return input.outcome === 'purchase'
      ? 'Entra al Libro IVA como tique. El IVA va al costo.'
      : 'Queda como gasto con tique. Sin proveedor o sin número no entra al Libro IVA.'
  }
  if (input.voucher === 'a' && input.recovers) {
    return 'Entra al Libro IVA y recuperás el IVA. Con el proveedor no queda deuda.'
  }
  return 'Entra al Libro IVA; el IVA va al costo. Con el proveedor no queda deuda.'
}

/** Lo que todavía falta para poder mostrar el resumen, en palabras. `null`: no falta nada. */
export function missingForSummary(missing: {
  amount: boolean
  target: boolean
  treasury: boolean
}): string | null {
  const parts = [
    missing.amount ? 'cuánto gastaste' : null,
    missing.target ? 'en qué se gastó' : null,
    missing.treasury ? 'con qué pagaste' : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return null
  const last = parts[parts.length - 1]
  const list = parts.length === 1 ? last : `${parts.slice(0, -1).join(', ')} y ${last}`
  return `Falta decir ${list}.`
}

// ─── La caja: antes → después ────────────────────────────────────────────────

type TreasuryFacts = Pick<SheetTreasury, 'kind' | 'balanceCents' | 'allowNegative'>

export type TreasuryAfter = {
  /** El saldo de hoy, en el sentido de la caja (en una tarjeta de la empresa, la deuda). */
  beforeCents: number
  /** Cómo queda con este gasto. `null`: todavía no hay importe. */
  afterCents: number | null
  /**
   * - `idle`: sin importe.
   * - `ok`: alcanza.
   * - `short`: una caja que no admite quedar en negativo y quedaría en rojo. Es
   *   el mismo caso que el servidor avisa al guardar (`treasury_negative`).
   * - `overdraft`: queda en descubierto, y esa cuenta lo admite.
   * - `debt`: tarjeta de la empresa: sube lo que se debe.
   */
  state: 'idle' | 'ok' | 'short' | 'overdraft' | 'debt'
}

/** Cómo queda la caja elegida después de este gasto (no guarda nada: es la cuenta a la vista). */
export function treasuryAfter(treasury: TreasuryFacts, amountCents: number | null): TreasuryAfter {
  const beforeCents = treasury.balanceCents
  if (amountCents === null || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { beforeCents, afterCents: null, state: 'idle' }
  }
  if (treasury.kind === 'credit_card') {
    return { beforeCents, afterCents: beforeCents + amountCents, state: 'debt' }
  }
  const afterCents = beforeCents - amountCents
  if (afterCents >= 0) return { beforeCents, afterCents, state: 'ok' }
  return { beforeCents, afterCents, state: treasury.allowNegative ? 'overdraft' : 'short' }
}

/**
 * Un saldo de caja en palabras y sin centavos: «$ 394.757», «Descubierto
 * $ 12.000»; en una tarjeta de la empresa, «Deuda $ 80.000». Nunca un menos
 * pelado (misma regla que `treasuryBalanceText`).
 */
export function treasuryMoneyText(kind: SheetTreasury['kind'], cents: number): string {
  if (kind === 'credit_card') {
    return cents > 0
      ? `Deuda ${balanceText(cents, 'treasury', { decimals: 0 })}`
      : balanceText(-cents, 'treasury', { decimals: 0 })
  }
  return balanceText(cents, 'treasury', { decimals: 0 })
}

export type TreasuryAfterWords = {
  before: { label: string; amount: string }
  after: { label: string; amount: string }
}

/**
 * El «antes → después» dicho con palabras, cada número con su rótulo (dos
 * cifras sueltas no se entienden): «hoy $ 394.757 → queda $ 382.257». Si no
 * alcanza, «faltan $ 12.500»; en una cuenta con descubierto, «queda en
 * descubierto $ 12.000»; con la tarjeta de la empresa, «hoy debés $ 80.000 →
 * vas a deber $ 92.500». Los importes van siempre en positivo. `null` sin importe.
 */
export function treasuryAfterWords(
  kind: SheetTreasury['kind'],
  after: TreasuryAfter,
): TreasuryAfterWords | null {
  if (after.afterCents === null) return null
  const money = (cents: number) => formatCentsShort(Math.abs(cents))
  if (kind === 'credit_card') {
    return {
      before: {
        label: after.beforeCents >= 0 ? 'hoy debés' : 'hoy a favor',
        amount: money(after.beforeCents),
      },
      after: {
        label: after.afterCents >= 0 ? 'vas a deber' : 'queda a favor',
        amount: money(after.afterCents),
      },
    }
  }
  return {
    before: {
      label: after.beforeCents < 0 ? 'hoy en descubierto' : 'hoy',
      amount: money(after.beforeCents),
    },
    after: {
      label:
        after.afterCents >= 0
          ? 'queda'
          : after.state === 'short'
            ? 'faltan'
            : 'queda en descubierto',
      amount: money(after.afterCents),
    },
  }
}

/** «Caja: $ 394.757 → $ 382.257» (para lectores y para el pie del ticket). `null` sin importe. */
export function treasuryAfterText(
  treasury: TreasuryFacts & Pick<SheetTreasury, 'name'>,
  after: TreasuryAfter,
): string | null {
  if (after.afterCents === null) return null
  const before = treasuryMoneyText(treasury.kind, after.beforeCents)
  const then = treasuryMoneyText(treasury.kind, after.afterCents)
  return `${treasury.name}: ${before} → ${then}`
}

const TOTAL_LABEL_NAME_MAX = 22

/** El rótulo del total del ticket: «Salen de Caja»; con la tarjeta de la empresa, «Con Visa». */
export function ticketTotalLabel(treasury: Pick<SheetTreasury, 'kind' | 'name'> | null): string {
  if (!treasury) return 'Total'
  // El rótulo va en un solo renglón: un nombre muy largo se corta.
  const name =
    treasury.name.length > TOTAL_LABEL_NAME_MAX
      ? `${treasury.name.slice(0, TOTAL_LABEL_NAME_MAX - 1).trimEnd()}…`
      : treasury.name
  return treasury.kind === 'credit_card' ? `Con ${name}` : `Salen de ${name}`
}
