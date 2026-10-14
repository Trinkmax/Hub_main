/**
 * «Gastos del banco»: los renglones del resumen, como figuran en el papel que
 * la persona tiene en la mano. Puro; lo prueba
 * `tests/lib/administracion-hojas-cajas.test.ts`.
 *
 * Cada renglón tiene el nombre en criollo («Impuesto al cheque») y, debajo,
 * cómo suele figurar en el resumen («IMP. LEY 25413 DEB»), para encontrarlo
 * sin saber de impuestos. Los campos son los MISMOS ocho importes de siempre:
 * acá solo cambia cómo se llaman y en qué orden se piden.
 */

/** Los importes del formulario, con el nombre que les da el esquema (`bankExpenseSchema`). */
export const BANK_AMOUNT_FIELDS = [
  'feesNetCents',
  'ley25413DebitCents',
  'ley25413CreditCents',
  'sircrebCents',
  'interestCents',
  'vatPerceptionCents',
  'feesNoVatCents',
] as const
export type BankAmountField = (typeof BANK_AMOUNT_FIELDS)[number]

/** Los campos que el formulario dibuja en su lugar (para no repetir arriba un error que ya se ve). */
export const BANK_KNOWN_FIELDS: ReadonlySet<string> = new Set([
  'treasuryAccountId',
  'date',
  'includeInIvaBook',
  'voucher',
  'voucher.voucherType',
  'voucher.pointOfSale',
  'voucher.number',
  'feesNetCents',
  'vatRateBp',
  'vatPerceptionCents',
  'feesNoVatCents',
  'ley25413CreditCents',
  'ley25413DebitCents',
  'sircrebCents',
  'interestCents',
  'notes',
])

export type BankRow = {
  field: BankAmountField
  /** El nombre para el dueño. */
  label: string
  /** Cómo suele figurar en el resumen (en mayúsculas, como viene impreso). `null`: no tiene uno típico. */
  printed: string | null
  /**
   * El nombre técnico, para quien lo busque (va en gris, con `Term`). Solo
   * donde lo impreso en el resumen no lo dice ya: dos aclaraciones por renglón
   * son ruido.
   */
  term: string | null
  /** La ayuda mientras no tiene importe. */
  hint: string | null
  /** Va detrás de «Más conceptos». */
  more: boolean
}

export const BANK_ROWS: readonly BankRow[] = [
  {
    field: 'feesNetCents',
    label: 'Comisiones y mantenimiento',
    printed: 'COMISION MANT. CTA · COM. PAQUETE',
    term: null,
    hint: 'Sin el IVA: se suma solo.',
    more: false,
  },
  {
    field: 'ley25413DebitCents',
    label: 'Impuesto al cheque, sobre lo que salió',
    printed: 'IMP. LEY 25413 DEB',
    term: null,
    hint: null,
    more: false,
  },
  {
    field: 'ley25413CreditCents',
    label: 'Impuesto al cheque, sobre lo que entró',
    printed: 'IMP. LEY 25413 CRED',
    term: null,
    hint: null,
    more: false,
  },
  {
    field: 'sircrebCents',
    label: 'Ingresos Brutos',
    printed: 'SIRCREB · RET. IIBB',
    term: null,
    hint: null,
    more: false,
  },
  {
    field: 'interestCents',
    label: 'Intereses',
    printed: 'INTERESES · INT. DESCUBIERTO',
    term: null,
    hint: null,
    more: false,
  },
  {
    field: 'vatPerceptionCents',
    label: 'IVA que te cobraron por adelantado',
    printed: 'PERCEP. IVA RG 2408',
    term: 'Percepción de IVA',
    hint: null,
    more: true,
  },
  {
    field: 'feesNoVatCents',
    label: 'Comisiones sin IVA',
    printed: null,
    term: null,
    hint: 'Las que el resumen no grava con IVA.',
    more: true,
  },
]

export type BankAmounts = Readonly<Record<BankAmountField, number | null>>

/** Cuántos «otros conceptos» se pueden sumar. */
export const BANK_OTHERS_MAX = 10

export type BankProgress =
  | { kind: 'no_control'; text: string }
  | { kind: 'empty'; text: string }
  | { kind: 'short'; text: string; leftCents: number }
  | { kind: 'match'; text: string }
  | { kind: 'over'; text: string; overCents: number }

/**
 * El avance contra el total del resumen, en palabras: «Repartiste $ 18.124 de
 * $ 26.800. Faltan $ 8.676.» → «Coincide con el resumen.» → «Cargaste $ 300 de
 * más.» Sin total del resumen no hay contra qué medir: «Total debitado $ X».
 * `money` formatea centavos (lo pasa la pantalla, para usar el mismo formato).
 */
export function bankProgress(
  totalCents: number,
  controlCents: number | null,
  money: (cents: number) => string,
): BankProgress {
  if (controlCents === null) {
    return { kind: 'no_control', text: `Total debitado ${money(totalCents)}` }
  }
  const left = controlCents - totalCents
  if (left === 0) return { kind: 'match', text: 'Coincide con el resumen.' }
  if (left < 0) {
    return { kind: 'over', text: `Cargaste ${money(-left)} de más.`, overCents: -left }
  }
  if (totalCents === 0) {
    return { kind: 'empty', text: `Te falta repartir ${money(left)}.` }
  }
  return {
    kind: 'short',
    text: `Repartiste ${money(totalCents)} de ${money(controlCents)}. Faltan ${money(left)}.`,
    leftCents: left,
  }
}

/** La nota del papel: lo mismo, dicho para el pie del resumen. */
export function bankStatementNote(
  progress: BankProgress,
  money: (cents: number) => string,
): string | null {
  switch (progress.kind) {
    case 'match':
      return 'Coincide con el resumen.'
    case 'short':
      return `Faltan ${money(progress.leftCents)} para llegar al total.`
    case 'over':
      return `Cargaste ${money(progress.overCents)} de más.`
    default:
      return null
  }
}

/** Por qué no se puede elegir «Sí, tengo el comprobante» (lo mismo que deshabilitaba la casilla). */
export type BookBlock = 'no_treasury' | 'no_cuit' | 'no_fees' | null

export function bookBlock(input: {
  hasTreasury: boolean
  bankHasCuit: boolean
  feesNetCents: number | null
}): BookBlock {
  if (!input.hasTreasury) return 'no_treasury'
  if (!input.bankHasCuit) return 'no_cuit'
  if ((input.feesNetCents ?? 0) <= 0) return 'no_fees'
  return null
}
