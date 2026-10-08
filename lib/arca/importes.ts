/**
 * Importes para WSFE (diseño §2.4.1; `arca-tecnico.md` §4.8; manual WSFEv1 v4.7,
 * «Margen de error» y validaciones 10018–10070).
 *
 * - Todo en centavos enteros; adentro, `BigInt`. Nunca `float` con plata.
 * - ARCA redondea con **Round Half Even** («mitad al par»). Para separar el IVA de
 *   un precio final (la carta del bar) se usa `splitGrossHalfEven`: neto =
 *   half_even(total / (1 + r)) e IVA = total − neto, así el total cuadra exacto y
 *   |IVA − r·neto| ≤ 0,6 centavos (pasa la 10051).
 * - `wsfeAmounts` lleva los importes del comprobante fiscal que arma el motor
 *   (`FiscalAmounts`, centavos por columna) a los campos de `FECAESolicitar`, y
 *   `checkWsfeAmounts` hace acá, antes de gastar una llamada, las validaciones de
 *   importes de ARCA (10048, 10061, 10023, 10051, 10018, 10070, 10020…).
 * - `formatCents2` escribe los importes con 2 decimales desde el entero.
 *
 * Puro: sirve en el navegador y en el servidor.
 */

import { AFIP_ALIQUOT_ID } from '@/lib/accounting/iva'
import type { Cents, FiscalAmounts, VatRateBp } from '@/lib/accounting/types'
import { VAT_RATE_VALUES } from '@/lib/accounting/types'

const BP = 10_000n
/** Tope por importe del módulo (1e15 centavos): entra exacto en un `number`. */
const MAX_CENTS = 1_000_000_000_000_000

// ─── Redondeo ────────────────────────────────────────────────────────────────

/** `num / den` redondeado al entero más cercano y, en la mitad, al par. `den > 0`. */
export function roundHalfEvenDiv(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('El divisor tiene que ser positivo')
  const negative = num < 0n
  const n = negative ? -num : num
  const q = n / den
  const twiceRest = 2n * (n % den)
  const up = twiceRest > den || (twiceRest === den && q % 2n === 1n)
  const r = up ? q + 1n : q
  return negative ? -r : r
}

function assertCents(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CENTS) {
    throw new RangeError(`${what} tiene que ser un entero de centavos entre 0 y 1e15`)
  }
}

/** IVA de un neto con «mitad al par»: half_even(neto × tasa). */
export function vatFromNetHalfEven(netCents: Cents, rateBp: VatRateBp): Cents {
  assertCents(netCents, 'El neto')
  return Number(roundHalfEvenDiv(BigInt(netCents) * BigInt(rateBp), BP))
}

/** Neto de un total con IVA incluido: half_even(total / (1 + tasa)). */
export function netFromGrossHalfEven(grossCents: Cents, rateBp: VatRateBp): Cents {
  assertCents(grossCents, 'El total')
  return Number(roundHalfEvenDiv(BigInt(grossCents) * BP, BP + BigInt(rateBp)))
}

/** Neto e IVA de un total con IVA incluido; `net + vat === gross` exacto. */
export function splitGrossHalfEven(
  grossCents: Cents,
  rateBp: VatRateBp,
): { net: Cents; vat: Cents } {
  const net = netFromGrossHalfEven(grossCents, rateBp)
  return { net, vat: grossCents - net }
}

export type GrossLine = { readonly grossCents: Cents; readonly rateBp: VatRateBp }

export type GrossAliquot = {
  readonly rateBp: VatRateBp
  readonly grossCents: Cents
  readonly netCents: Cents
  readonly vatCents: Cents
}

/**
 * El algoritmo de §4.8 para precios finales: se suman los totales de cada
 * alícuota y recién después se separa neto e IVA (una vez por alícuota, no por
 * renglón). Devuelve las alícuotas con algo, en el orden de `VAT_RATE_VALUES`.
 */
export function aliquotsFromGross(lines: readonly GrossLine[]): GrossAliquot[] {
  const byRate = new Map<VatRateBp, number>()
  for (const line of lines) {
    assertCents(line.grossCents, 'Cada total')
    byRate.set(line.rateBp, (byRate.get(line.rateBp) ?? 0) + line.grossCents)
  }
  const out: GrossAliquot[] = []
  for (const rate of VAT_RATE_VALUES) {
    const gross = byRate.get(rate)
    if (gross === undefined || gross === 0) continue
    const { net, vat } = splitGrossHalfEven(gross, rate)
    out.push({ rateBp: rate, grossCents: gross, netCents: net, vatCents: vat })
  }
  return out
}

// ─── Formato ─────────────────────────────────────────────────────────────────

/** `1234567` → `'12345.67'`; `5` → `'0.05'`; `-150` → `'-1.50'`. Sin pasar por `float`. */
export function formatCents2(cents: number | bigint): string {
  if (typeof cents === 'number' && !Number.isSafeInteger(cents)) {
    throw new RangeError('El importe tiene que ser un entero de centavos')
  }
  const value = BigInt(cents)
  const negative = value < 0n
  const abs = negative ? -value : value
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`
}

/**
 * Un importe como lo devuelve ARCA (`'184.05'`, `'150'`, `'7.8'`) → centavos. Con
 * más de 2 decimales redondea al par. `null` si no es un número decimal simple.
 */
export function parseAmountToCents(text: string | null | undefined): number | null {
  const match = /^([+-])?(\d{1,16})(?:\.(\d{1,12}))?$/.exec((text ?? '').trim())
  if (!match) return null
  const [, sign, whole = '0', frac = ''] = match
  const scaled = BigInt(whole + frac.padEnd(2, '0').slice(0, 2))
  let cents = scaled
  if (frac.length > 2) {
    const extra = frac.slice(2)
    const den = 10n ** BigInt(extra.length)
    cents = roundHalfEvenDiv(scaled * den + BigInt(extra), den)
  }
  const signed = sign === '-' ? -cents : cents
  const n = Number(signed)
  return Number.isSafeInteger(n) ? n : null
}

// ─── De los importes del comprobante a WSFE ──────────────────────────────────

export type WsfeAliquot = {
  /** `AlicIva.Id` (3 = 0 %, 4 = 10,5 %, 5 = 21 %, 6 = 27 %, 8 = 5 %, 9 = 2,5 %). */
  readonly id: number
  readonly rateBp: VatRateBp
  /** `AlicIva.BaseImp`. */
  readonly baseCents: Cents
  /** `AlicIva.Importe`. */
  readonly vatCents: Cents
}

/** Los importes de `FECAEDetRequest`, en centavos. */
export type WsfeAmounts = {
  /** `ImpTotal`. */
  readonly totalCents: Cents
  /** `ImpTotConc`: neto no gravado. */
  readonly nonTaxedCents: Cents
  /** `ImpNeto`: neto gravado = Σ `BaseImp` (incluye el 0 %). */
  readonly netCents: Cents
  /** `ImpOpEx`: exento. */
  readonly exemptCents: Cents
  /** `ImpTrib`: otros tributos. La v1 no los emite: tiene que dar 0. */
  readonly tributesCents: Cents
  /** `ImpIVA` = Σ `Importe`. */
  readonly vatCents: Cents
  /** Lo del comprobante que WSFE no tiene dónde poner (IVA no discriminado). Tiene que dar 0. */
  readonly unsupportedCents: Cents
  /** `Iva/AlicIva`, una por alícuota con importe, en orden de alícuota. */
  readonly iva: readonly WsfeAliquot[]
}

const NET_COLUMN: Readonly<Record<VatRateBp, keyof FiscalAmounts>> = {
  0: 'net_0_cents',
  250: 'net_25_cents',
  500: 'net_5_cents',
  1050: 'net_105_cents',
  2100: 'net_21_cents',
  2700: 'net_27_cents',
}
const VAT_COLUMN: Readonly<Record<VatRateBp, keyof FiscalAmounts | null>> = {
  0: null,
  250: 'vat_25_cents',
  500: 'vat_5_cents',
  1050: 'vat_105_cents',
  2100: 'vat_21_cents',
  2700: 'vat_27_cents',
}
const TRIBUTE_COLUMNS: readonly (keyof FiscalAmounts)[] = [
  'perc_iva_cents',
  'perc_iibb_cents',
  'perc_ganancias_cents',
  'perc_municipal_cents',
  'internal_taxes_cents',
  'other_taxes_cents',
]

/**
 * Los importes de WSFE desde los del comprobante fiscal (`fiscalVouchers[0].amounts`
 * del motor): `ImpNeto` = Σ netos por alícuota, `ImpIVA` = Σ IVA, `ImpTotConc` = no
 * gravado, `ImpOpEx` = exento, `ImpTotal` = el total del comprobante.
 */
export function wsfeAmounts(amounts: FiscalAmounts): WsfeAmounts {
  const get = (key: keyof FiscalAmounts): Cents => amounts[key] ?? 0
  const iva: WsfeAliquot[] = []
  for (const rate of VAT_RATE_VALUES) {
    const vatColumn = VAT_COLUMN[rate]
    const base = get(NET_COLUMN[rate])
    const vat = vatColumn ? get(vatColumn) : 0
    if (base === 0 && vat === 0) continue
    iva.push({ id: AFIP_ALIQUOT_ID[rate], rateBp: rate, baseCents: base, vatCents: vat })
  }
  return {
    totalCents: get('total_cents'),
    nonTaxedCents: get('non_taxed_cents'),
    netCents: iva.reduce((acc, a) => acc + a.baseCents, 0),
    exemptCents: get('exempt_cents'),
    tributesCents: TRIBUTE_COLUMNS.reduce((acc, key) => acc + get(key), 0),
    vatCents: iva.reduce((acc, a) => acc + a.vatCents, 0),
    unsupportedCents: get('undiscriminated_cents'),
    iva,
  }
}

/**
 * Problemas de importes que ARCA rechazaría (el código de su validación) o que la
 * v1 no sabe emitir:
 * - `10048` ImpTotal ≠ ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA (exacto).
 * - `10061` ImpNeto ≠ Σ BaseImp · `10023` ImpIVA ≠ Σ Importe (exactos).
 * - `10051` el IVA de una alícuota no es su tasa × base (margen de ARCA: 1 centavo o
 *   0,01 %); no se mira en NC y ND, como ARCA.
 * - `10018` ImpIVA > 0 sin `Iva`, o ImpIVA = 0 con alícuotas que no son la del 0 %.
 * - `10070` ImpNeto > 0 sin `Iva` · `10020` una base en 0 (salvo NC y ND) ·
 *   `10022` una alícuota repetida.
 * - `invalid_cents` un importe negativo, con decimales o fuera de tope.
 * - `tributes_unsupported` / `undiscriminated_unsupported`: la v1 no emite tributos.
 */
export type WsfeAmountIssue =
  | '10048'
  | '10061'
  | '10023'
  | '10051'
  | '10018'
  | '10070'
  | '10020'
  | '10022'
  | 'invalid_cents'
  | 'tributes_unsupported'
  | 'undiscriminated_unsupported'

/** Notas de crédito y débito A y B: ARCA no les aplica la 10051 ni la 10020. */
const NOTE_CBTE = new Set([2, 3, 7, 8])

export function checkWsfeAmounts(
  a: WsfeAmounts,
  options: { cbteTipo?: number } = {},
): WsfeAmountIssue[] {
  const issues: WsfeAmountIssue[] = []
  const push = (issue: WsfeAmountIssue) => {
    if (!issues.includes(issue)) issues.push(issue)
  }
  const all = [
    a.totalCents,
    a.nonTaxedCents,
    a.netCents,
    a.exemptCents,
    a.tributesCents,
    a.vatCents,
    a.unsupportedCents,
    ...a.iva.flatMap((x) => [x.baseCents, x.vatCents]),
  ]
  if (all.some((v) => !Number.isSafeInteger(v) || v < 0 || v > MAX_CENTS)) {
    push('invalid_cents')
    return issues
  }
  if (a.tributesCents > 0) push('tributes_unsupported')
  if (a.unsupportedCents > 0) push('undiscriminated_unsupported')

  const sum = (values: readonly number[]) => values.reduce((acc, v) => acc + BigInt(v), 0n)
  const parts = sum([a.nonTaxedCents, a.netCents, a.exemptCents, a.tributesCents, a.vatCents])
  if (BigInt(a.totalCents) !== parts) push('10048')
  if (BigInt(a.netCents) !== sum(a.iva.map((x) => x.baseCents))) push('10061')
  if (BigInt(a.vatCents) !== sum(a.iva.map((x) => x.vatCents))) push('10023')

  const isNote = options.cbteTipo !== undefined && NOTE_CBTE.has(options.cbteTipo)
  const ids = new Set<number>()
  for (const x of a.iva) {
    if (ids.has(x.id)) push('10022')
    ids.add(x.id)
    if (!isNote && x.baseCents === 0) push('10020')
    if (!isNote && !vatWithinMargin(x.baseCents, x.rateBp, x.vatCents)) push('10051')
  }
  if (a.vatCents > 0 && a.iva.length === 0) push('10018')
  if (a.vatCents === 0 && a.iva.some((x) => x.rateBp !== 0)) push('10018')
  if (a.netCents > 0 && a.iva.length === 0) push('10070')
  return issues
}

/**
 * ¿El IVA de una alícuota está dentro del margen de ARCA? Error absoluto ≤ 1 centavo
 * o relativo ≤ 0,01 % de tasa × base. Exacto, en enteros.
 */
export function vatWithinMargin(baseCents: Cents, rateBp: VatRateBp, vatCents: Cents): boolean {
  const exactTimesBp = BigInt(baseCents) * BigInt(rateBp) // tasa × base, en centavos × 10.000
  const diff = BigInt(vatCents) * BP - exactTimesBp
  const absDiff = diff < 0n ? -diff : diff
  // |vat − exacto| ≤ 1 centavo  ⇔  |diff| ≤ 10.000
  if (absDiff <= BP) return true
  // |vat − exacto| ≤ 0,0001 × exacto  ⇔  |diff| × 10.000 ≤ exacto × 10.000
  return absDiff * BP <= exactTimesBp
}
