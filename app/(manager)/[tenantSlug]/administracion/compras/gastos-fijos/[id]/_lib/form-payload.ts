/**
 * La ficha de un gasto fijo, lo puro: qué se le manda a `saveRecurringExpense`
 * y qué se valida antes. Salió tal cual del `submit` del formulario anterior
 * para poder fijarlo con un test (`administracion-gastos-fijos-envio.test.ts`):
 * la ficha se reordenó y se vistió, pero manda EXACTAMENTE lo mismo, clave por
 * clave.
 *
 * También vive acá lo que traduce las preguntas nuevas a los valores de
 * siempre: «¿Qué papel te dan?» → `voucherType` (ningún valor nuevo) y «¿De
 * cuántas cuotas es? / ¿Por cuál vas?» → las mismas `dues` e
 * `installmentsTotal` que antes salían de «Faltan N» + «¿De cuántas?».
 */

import type { RecurringBreakdownKind, RecurringBreakdownRow } from '@/lib/accounting/party-profile'
import type { QuickVoucher } from '../../../_lib/quick-expense'
import { duesUntil, nthDue, type RecurringFrequency } from '../../../_lib/recurring'
import { PURCHASE_VOUCHER_OPTIONS } from '../../../_lib/vouchers'

export type RecurringFormValues = {
  id: string | null
  updatedAt: string | null
  name: string
  partyId: string | null
  accountId: string | null
  voucherType: string | null
  vatRateBp: number | null
  amountCents: number | null
  frequency: RecurringFrequency
  dueDay: number
  nextDueDate: string
  remindDaysBefore: number
  treasuryAccountId: string | null
  active: boolean
  notes: string
  /** En cuotas: el último vencimiento (`null` = no termina). */
  endsOn: string | null
  /** En cuotas: de cuántas es (`null` = no se sabe). */
  installmentsTotal: number | null
  breakdown: RecurringBreakdownRow[]
}

// ─── El detalle (los sueldos) ────────────────────────────────────────────────

export type BreakdownDraft = {
  /** Solo para React: los renglones se agregan y se quitan. */
  key: string
  label: string
  kind: RecurringBreakdownKind | null
  amountCents: number | null
}

let draftSeq = 0

export function newBreakdownDraft(
  patch: Partial<Omit<BreakdownDraft, 'key'>> = {},
): BreakdownDraft {
  draftSeq += 1
  return { key: `l${draftSeq}`, label: '', kind: null, amountCents: null, ...patch }
}

/** Los renglones con algo escrito, listos para guardar (los vacíos se descartan). */
export function breakdownToSave(lines: readonly BreakdownDraft[]) {
  return lines
    .filter((l) => l.label.trim() !== '' || l.amountCents !== null)
    .map((l) => ({ label: l.label.trim(), kind: l.kind, amountCents: l.amountCents ?? 0 }))
}

// ─── Cuotas ──────────────────────────────────────────────────────────────────

/** Cuántas faltaban al abrir (contando la próxima): `null` no termina · `0` ya terminó. */
export function initialDuesOf(
  initial: Pick<RecurringFormValues, 'endsOn' | 'nextDueDate' | 'frequency'>,
): number | null {
  return initial.endsOn === null
    ? null
    : duesUntil(initial.nextDueDate, initial.endsOn, initial.frequency)
}

/**
 * Cómo está contestado «¿Es en cuotas?» en pantalla:
 *
 * - `none`: no, es de siempre.
 * - `total`: «¿De cuántas cuotas es?» y «¿Por cuál vas?» (lo normal).
 * - `remaining`: «No sé de cuántas era: solo sé cuántas faltan». También es
 *   como abre uno guardado sin total y uno que ya terminó (con el campo vacío).
 *   `total` es el que ya tenía guardado, que se conserva sin mostrarlo.
 *
 * Las dos formas escriben lo mismo que antes: cuántas faltan contando la
 * próxima (`dues`) y de cuántas es (`installmentsTotal`).
 */
export type InstallmentsDraft =
  | { mode: 'none' }
  | { mode: 'total'; total: number | null; current: number | null }
  | { mode: 'remaining'; remaining: number | null; total: number | null }

/** Cómo abre la pregunta de cuotas según lo guardado. */
export function initialInstallments(
  initial: Pick<RecurringFormValues, 'endsOn' | 'nextDueDate' | 'frequency' | 'installmentsTotal'>,
): InstallmentsDraft {
  const dues = initialDuesOf(initial)
  if (dues === null) return { mode: 'none' }
  const total = initial.installmentsTotal
  // Ya terminó: el campo abre vacío, para decir cuántas más faltan.
  if (dues === 0) return { mode: 'remaining', remaining: null, total }
  if (total !== null && total >= dues) return { mode: 'total', total, current: total - dues + 1 }
  return { mode: 'remaining', remaining: dues, total }
}

/**
 * Lo contestado → lo que se guarda. `dues`: `null` no termina · `0` falta
 * completar (o ya terminó y nadie lo tocó) · 1 o más, las que faltan contando
 * la próxima. Con «¿De cuántas?» T y «¿Por cuál vas?» k, faltan `T − k + 1`.
 */
export function installmentsValues(draft: InstallmentsDraft): {
  dues: number | null
  installmentsTotal: number | null
} {
  if (draft.mode === 'none') return { dues: null, installmentsTotal: null }
  if (draft.mode === 'remaining') {
    const remaining = draft.remaining ?? 0
    // Un total guardado más chico que las que faltan no sirve (y acá no se ve para corregirlo).
    const total = draft.total !== null && draft.total < remaining ? null : draft.total
    return { dues: remaining, installmentsTotal: total }
  }
  const { total, current } = draft
  if (total === null || current === null) return { dues: 0, installmentsTotal: total }
  return { dues: Math.max(0, total - current + 1), installmentsTotal: total }
}

// ─── El envío ────────────────────────────────────────────────────────────────

export type RecurringPayloadInput = {
  /** Lo que hay cargado ahora. */
  form: RecurringFormValues
  /** Lo que había al abrir (decide si es una edición y si ya había terminado). */
  initial: Pick<RecurringFormValues, 'id' | 'endsOn' | 'nextDueDate' | 'frequency'>
  /** Cuotas que faltan contando la próxima (`null` = no termina; 0 = ya terminó). */
  dues: number | null
  /** El detalle, como está en pantalla. */
  lines: readonly BreakdownDraft[]
}

/**
 * El paquete para `saveRecurringExpense`: las mismas claves y los mismos
 * valores que armaba el formulario anterior.
 *
 * - Con detalle, el monto es la suma del detalle.
 * - Una que había terminado y vuelve a tener cuotas se prende sola.
 * - Una que ya terminó y nadie tocó conserva su último vencimiento.
 */
export function buildRecurringPayload({ form, initial, dues, lines }: RecurringPayloadInput) {
  const editing = initial.id !== null
  const initialDues = initialDuesOf(initial)
  const ended = initialDues === 0 && dues === 0
  const breakdown = breakdownToSave(lines)
  const detailTotal = lines.reduce((sum, l) => sum + (l.amountCents ?? 0), 0)
  const lastDue =
    dues !== null && dues > 0 ? nthDue(form.nextDueDate, form.dueDay, form.frequency, dues) : null
  return {
    ...(editing ? { id: form.id, expectedUpdatedAt: form.updatedAt } : {}),
    name: form.name,
    partyId: form.partyId,
    accountId: form.accountId,
    voucherType: form.voucherType,
    vatRateBp: form.vatRateBp,
    amountCents: breakdown.length > 0 ? detailTotal : form.amountCents,
    frequency: form.frequency,
    dueDay: form.dueDay,
    nextDueDate: form.nextDueDate,
    remindDaysBefore: form.remindDaysBefore,
    treasuryAccountId: form.treasuryAccountId,
    // Una que había terminado y vuelve a tener cuotas se prende sola.
    active: initialDues === 0 && dues !== null && dues > 0 ? true : form.active,
    notes: form.notes,
    endsOn: dues === null ? null : ended ? initial.endsOn : lastDue,
    installmentsTotal: dues === null ? null : form.installmentsTotal,
    breakdown,
  }
}

/**
 * Lo que se revisa antes de mandar (lo mismo de siempre; cambió cómo se dice).
 * Devuelve un error por campo; vacío = se puede guardar. `draft` es cómo está
 * contestada la pregunta de cuotas, para decir el error con sus palabras.
 */
export function validateRecurringForm(
  { form, initial, dues, lines }: RecurringPayloadInput,
  draft?: InstallmentsDraft,
): Record<string, string> {
  const errors: Record<string, string> = {}
  const initialDues = initialDuesOf(initial)
  const ended = initialDues === 0 && dues === 0
  if (form.name.trim().length < 2) errors.name = 'Escribí el nombre (por ejemplo, «Alquiler»).'
  if (!form.accountId) errors.accountId = 'Elegí en qué se gasta.'
  if (breakdownToSave(lines).some((l) => l.label === '' || l.amountCents < 1)) {
    errors.breakdown = 'Cada renglón del detalle necesita a quién corresponde y un monto.'
  }
  const byTotal = draft?.mode === 'total'
  if (dues !== null && dues < 1 && !ended) {
    errors.endsOn = !byTotal
      ? 'Poné cuántas cuotas faltan (1 o más).'
      : draft.total === null || draft.current === null
        ? 'Poné de cuántas cuotas es y por cuál vas.'
        : 'Vas por una cuota que no existe: revisá los dos números.'
  }
  if (dues !== null && form.installmentsTotal !== null && form.installmentsTotal < dues) {
    errors.installmentsTotal = byTotal
      ? 'Vas por una cuota que no existe: revisá los dos números.'
      : 'El total no puede ser menos que las cuotas que faltan.'
  }
  return errors
}

// ─── «¿Qué papel te dan?» → `voucherType` ────────────────────────────────────

/** Los papeles que tienen su tarjeta o su píldora a la vista. */
const CARD_VOUCHERS = new Set(['factura_a', 'factura_b', 'factura_c', 'tique', 'sin_comprobante'])

/** «Otro papel»: el resto del catálogo de siempre (Factura M, tique factura, recibo, otro comprobante). */
export const OTHER_PAPER_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  PURCHASE_VOUCHER_OPTIONS.filter((option) => !CARD_VOUCHERS.has(option.value))

/**
 * El valor que escribe cada tarjeta. «Factura B o C» escribe `factura_c`
 * (lo más común en un bar), salvo que ya hubiera una de las dos guardada.
 */
export function voucherTypeForPaper(paper: QuickVoucher, previous: string | null): string {
  switch (paper) {
    case 'a':
      return 'factura_a'
    case 'bc':
      return previous === 'factura_b' || previous === 'factura_c' ? previous : 'factura_c'
    case 'ticket':
      return 'tique'
    case 'none':
      return 'sin_comprobante'
  }
}

/** Las alícuotas de siempre, en el orden en que se ofrecen: las tres comunes y, detrás de «Otra», el resto. */
export const COMMON_VAT_RATES = [2100, 1050, 2700] as const
export const OTHER_VAT_RATES = [500, 250, 0] as const

/** ¿El papel elegido muestra «IVA de siempre» a la vista? (Solo la Factura A lo discrimina.) */
export function paperShowsVat(voucherType: string | null): boolean {
  return voucherType === 'factura_a'
}
