import { isPurchaseImputation } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/accounts'
import {
  defaultDebtSelection,
  type PaymentPlan,
  planPayment,
  resolveMethods,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/payment-plan'
import {
  buildQuickExpenseValues,
  type QuickExpenseFormValues,
  type QuickVoucher,
  type RecurringPrefill,
  recurringPrefill,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import {
  isRecurringFrequency,
  nextDueFrom,
  type RecurringFrequency,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/recurring'
import {
  buildRecurringPayload,
  type InstallmentsDraft,
  initialInstallments,
  installmentsValues,
  newBreakdownDraft,
  type RecurringFormValues,
  validateRecurringForm,
  voucherTypeForPaper,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/gastos-fijos/[id]/_lib/form-payload'
import {
  dueDayPatch,
  type SheetItem,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla-words'
import type {
  EmployeeValues,
  PayFrequency,
  PayrollEmployee,
  PayrollKind,
} from '@/lib/accounting/payroll'
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import { type RecurringPaymentFacts, recurringLine } from '@/lib/accounting/recurring-status'
import type { PaymentValues } from '@/lib/accounting/server/document-types'
import type { OpenItemRef, PostingContext } from '@/lib/accounting/types'

/**
 * Lo que Tex manda en Gastos fijos y Sueldos, puro. Cada función copia el criterio de la ficha del
 * gasto fijo (`form-payload.ts`), de la planilla (`planilla-words.ts`), de la tira de pago y de la
 * hoja «Pago». Lo prueba `tex-actions-gastos.test.ts`.
 */

// ─── Buscar por nombre ───────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sin tildes ni mayúsculas: la misma comparación que los proveedores (`searchKey`). */
function nameKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

export type NameMatch<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'many' | 'none'; options: string[] }

/**
 * Uno solo o nada: por id, por nombre exacto o por parte del nombre. Tex nunca elige a ojo entre dos
 * empleados.
 */
export function matchByName<T extends { id: string; name: string }>(
  rows: readonly T[],
  wanted: string,
): NameMatch<T> {
  const key = nameKey(wanted)
  const exact = rows.filter((row) => nameKey(row.name) === key)
  const found = UUID_RE.test(wanted.trim())
    ? rows.filter((row) => row.id === wanted.trim())
    : exact.length === 1
      ? exact
      : rows.filter((row) => nameKey(row.name).includes(key))
  const [only] = found
  if (only && found.length === 1) return { ok: true, value: only }
  if (found.length > 1) {
    return { ok: false, reason: 'many', options: found.slice(0, 8).map((row) => row.name) }
  }
  return { ok: false, reason: 'none', options: rows.slice(0, 8).map((row) => row.name) }
}

/** El mismo tono que los otros resolvers (`lib/tex/resolve.ts`): qué tiene que preguntar Tex. */
export function noMatchText(
  match: Extract<NameMatch<unknown>, { ok: false }>,
  wanted: string,
): string {
  return match.reason === 'many'
    ? `«${wanted}» puede ser ${match.options.join(', ')}. Preguntale cuál.`
    : `No encontré «${wanted}». Los que hay: ${match.options.join(', ') || 'ninguno'}.`
}

// ─── La ficha de un gasto fijo ───────────────────────────────────────────────

export const FREQUENCY_WORDS = ['mensual', 'bimestral', 'trimestral', 'anual'] as const
export type FrequencyWord = (typeof FREQUENCY_WORDS)[number]

const FREQUENCY_OF: Readonly<Record<FrequencyWord, RecurringFrequency>> = {
  mensual: 'monthly',
  bimestral: 'bimonthly',
  trimestral: 'quarterly',
  anual: 'yearly',
}

export const FREQUENCY_TEXT: Readonly<Record<RecurringFrequency, string>> = {
  monthly: 'Todos los meses',
  bimonthly: 'Cada 2 meses',
  quarterly: 'Cada 3 meses',
  yearly: 'Una vez por año',
}

export function frequencyOf(word: FrequencyWord): RecurringFrequency {
  return FREQUENCY_OF[word]
}

export const PAPER_WORDS = ['factura_a', 'factura_b_c', 'tique', 'sin_factura', 'no_se'] as const
export type PaperWord = (typeof PAPER_WORDS)[number]

const PAPER_OF: Readonly<Record<Exclude<PaperWord, 'no_se'>, QuickVoucher>> = {
  factura_a: 'a',
  factura_b_c: 'bc',
  tique: 'ticket',
  sin_factura: 'none',
}

/** «¿Qué papel te dan?» → `voucherType`, como las tarjetas de la ficha; «No sé o cambia» es `null`. */
export function voucherTypeOfPaper(paper: PaperWord, previous: string | null): string | null {
  return paper === 'no_se' ? null : voucherTypeForPaper(PAPER_OF[paper], previous)
}

/** El papel de un pago: sin decirlo (o «no sé»), el de siempre del gasto fijo. */
export function quickVoucherOfPaper(paper: PaperWord | undefined): QuickVoucher | null {
  return paper === undefined || paper === 'no_se' ? null : PAPER_OF[paper]
}

/** Los valores con que abre la ficha de un gasto fijo que ya existe. */
export function recurringFormOf(row: RecurringExpenseRow): RecurringFormValues {
  return {
    id: row.id,
    updatedAt: row.updatedAt,
    name: row.name,
    partyId: row.partyId,
    accountId: row.accountId,
    voucherType: row.voucherType,
    vatRateBp: row.vatRateBp,
    amountCents: row.amountCents,
    frequency: isRecurringFrequency(row.frequency) ? row.frequency : 'monthly',
    dueDay: row.dueDay,
    nextDueDate: row.nextDueDate,
    remindDaysBefore: row.remindDaysBefore,
    treasuryAccountId: row.treasuryAccountId,
    active: row.active,
    notes: row.notes ?? '',
    endsOn: row.endsOn,
    installmentsTotal: row.installmentsTotal,
    breakdown: row.breakdown,
  }
}

/** Los valores con que abre la ficha de un alta. */
export function blankRecurringForm(today: string): RecurringFormValues {
  return {
    id: null,
    updatedAt: null,
    name: '',
    partyId: null,
    accountId: null,
    voucherType: null,
    vatRateBp: null,
    amountCents: null,
    frequency: 'monthly',
    dueDay: 10,
    nextDueDate: nextDueFrom(today, 10),
    remindDaysBefore: 5,
    treasuryAccountId: null,
    active: true,
    notes: '',
    endsOn: null,
    installmentsTotal: null,
    breakdown: [],
  }
}

export type RecurringChange = {
  name?: string
  accountId?: string
  amountCents?: number
  partyId?: string
  voucherType?: string | null
  vatRateBp?: number
  frequency?: RecurringFrequency
  dueDay?: number
  nextDueDate?: string
  treasuryAccountId?: string
  active?: boolean
  notes?: string
  installments?: { total?: number; current?: number; remaining?: number }
}

/** «¿De cuántas cuotas es? / ¿Por cuál vas?», o «solo sé cuántas faltan». Sin decir nada, como estaba. */
function installmentsDraftOf(
  initial: RecurringFormValues,
  said: RecurringChange['installments'],
): InstallmentsDraft {
  if (!said) return initialInstallments(initial)
  if (said.remaining !== undefined) {
    return { mode: 'remaining', remaining: said.remaining, total: said.total ?? null }
  }
  return { mode: 'total', total: said.total ?? null, current: said.current ?? null }
}

/**
 * Alta o edición: arranca de lo que abriría la ficha, le aplica lo que se pidió y arma el paquete con
 * `buildRecurringPayload`, el mismo de la pantalla. El detalle (los sueldos) viaja como estaba.
 *
 * Cambiar el día en una edición deja el vencimiento en el mismo mes (`dueDayPatch`, como la planilla):
 * no saltea ni repite ninguno. En un alta, el próximo a partir de hoy (como la ficha).
 */
export function recurringSavePayload(
  row: RecurringExpenseRow | null,
  change: RecurringChange,
  today: string,
): {
  payload: ReturnType<typeof buildRecurringPayload>
  form: RecurringFormValues
  errors: Record<string, string>
} {
  const initial = row ? recurringFormOf(row) : blankRecurringForm(today)
  const { installments, ...fields } = change
  const nextDueDate =
    change.nextDueDate ??
    (change.dueDay === undefined
      ? initial.nextDueDate
      : row
        ? dueDayPatch(row, change.dueDay).nextDueDate
        : nextDueFrom(today, change.dueDay))
  const draft = installmentsDraftOf(initial, installments)
  const { dues, installmentsTotal } = installmentsValues(draft)
  const said = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<RecurringFormValues>
  const form: RecurringFormValues = { ...initial, ...said, nextDueDate, installmentsTotal }
  const input = {
    form,
    initial,
    dues,
    lines: initial.breakdown.map((line) => newBreakdownDraft(line)),
  }
  return {
    payload: buildRecurringPayload(input),
    form,
    errors: validateRecurringForm(input, draft),
  }
}

// ─── Tildar un gasto fijo ────────────────────────────────────────────────────

/** Un renglón de la planilla del mes de hoy, armado como `buildSheet`. */
export function recurringSheetItem(
  row: RecurringExpenseRow,
  facts: RecurringPaymentFacts | null | undefined,
  today: string,
): SheetItem {
  const line = recurringLine(row, facts, today)
  const document = facts?.document ?? null
  const doc = document !== null && document.id === line.documentId ? document : null
  const day =
    line.state === 'skipped'
      ? (row.skippedDue ?? line.dueDate ?? row.nextDueDate)
      : (line.dueDate ?? row.nextDueDate)
  return { row, line, doc, realStatus: row.monthStatus, day }
}

/** El «Nuevo gasto» de la tira de pago: lo que precarga el gasto fijo, con lo que se haya dicho. */
export function recurringExpenseValues(input: {
  row: RecurringExpenseRow
  posting: Pick<PostingContext, 'parties' | 'accounts' | 'treasuries'>
  amountCents: number | null
  treasuryId: string
  /** `null`: el papel de siempre del gasto fijo. */
  voucher: QuickVoucher | null
  pointOfSale: number | null
  number: number | null
  date: string
  note?: string | null
}): {
  values: QuickExpenseFormValues | null
  missing: Record<string, string>
  voucher: QuickVoucher
  target: RecurringPrefill['target'] | null
} {
  const { row, posting } = input
  const prefill = recurringPrefill(
    {
      id: row.id,
      name: row.name,
      partyId: row.partyId,
      accountId: row.accountId,
      voucherType: row.voucherType,
      vatRateBp: row.vatRateBp,
      amountCents: row.amountCents,
      treasuryAccountId: row.treasuryAccountId,
      nextDueDate: row.nextDueDate,
      pending: row.monthStatus === 'pending',
    },
    {
      // Los que se ofrecen en «¿En qué?» (`payableParties`).
      payablePartyIds: new Set(
        [...posting.parties.values()]
          .filter((p) => p.active && (p.kind === 'supplier' || p.kind === 'other'))
          .map((p) => p.id),
      ),
      imputableAccountIds: new Set(
        [...posting.accounts.values()].filter(isPurchaseImputation).map((a) => a.id),
      ),
      activeTreasuryIds: new Set(
        [...posting.treasuries.values()].filter((t) => t.active).map((t) => t.id),
      ),
    },
  )
  const voucher = input.voucher ?? prefill?.voucher ?? 'none'
  const built = buildQuickExpenseValues({
    amountCents: input.amountCents,
    target: prefill?.target ?? null,
    treasuryAccountId: input.treasuryId,
    voucher,
    vatRateBp: prefill?.vatRateBp ?? 2100,
    vatAdjustCents: 0,
    pointOfSale: input.pointOfSale,
    number: input.number,
    date: input.date,
    detail: input.note ?? '',
    recurringExpenseId: row.id,
  })
  return { ...built, voucher, target: prefill?.target ?? null }
}

export type PaymentFormValues = Omit<PaymentValues, 'clientRef' | 'previewHash' | 'warningsAck'>

/** El pago de la hoja «Pago», con la misma cuenta (`planPayment`). */
export function recurringPaymentValues(input: {
  partyId: string
  items: readonly OpenItemRef[]
  today: string
  date: string
  treasuryId: string
  /** `null`: lo que hace falta para cancelar lo que se paga. */
  amountCents: number | null
  /** El gasto fijo que queda pagado (Rentas, Municipalidad). */
  recurringExpenseId: string | null
  /** La factura que se cancela: la del gasto fijo, si ya está cargada. */
  documentId: string | null
  note?: string | null
}): {
  values: PaymentFormValues
  plan: PaymentPlan
  debtTotalCents: number
  labelOf: (lineId: string) => string | undefined
} {
  const { items } = input

  // Un pago no mezcla cuentas de control (`mixed_control_accounts`): la de la factura que se paga o,
  // si no, la que tiene más deuda, como la hoja.
  const debtByAccount = new Map<string, number>()
  for (const item of items) {
    const debt = item.side === 'credit' ? item.openCents : 0
    debtByAccount.set(item.accountId, (debtByAccount.get(item.accountId) ?? 0) + debt)
  }
  const focus = input.documentId
    ? items.find((i) => i.side === 'credit' && i.documentId === input.documentId)
    : undefined
  const accountId =
    focus?.accountId ?? [...debtByAccount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const debts = items.filter((i) => i.side === 'credit' && i.accountId === accountId)
  const credits = items.filter((i) => i.side === 'debit' && i.accountId === accountId)

  // Lo que se tilda: la factura del gasto fijo; con un monto dicho, toda la deuda (el plan cancela de
  // lo más viejo a lo más nuevo); si no, lo de la hoja (lo vencido y lo de esta semana) y, si eso es
  // nada, toda la deuda.
  const usual = new Set(defaultDebtSelection(debts, input.today))
  const picked = focus
    ? debts.filter((d) => d.documentId === input.documentId)
    : input.amountCents !== null || usual.size === 0
      ? debts
      : debts.filter((d) => usual.has(d.lineId))

  const plan = planPayment({
    debts: picked.map((d) => ({
      lineId: d.lineId,
      label: d.label,
      accountId: d.accountId,
      openCents: d.openCents,
      targetCents: d.openCents,
      dueDate: d.dueDate,
      entryDate: d.entryDate,
    })),
    credits: credits.map((c) => ({
      lineId: c.lineId,
      label: c.label,
      accountId: c.accountId,
      openCents: c.openCents,
      entryDate: c.entryDate,
    })),
    amountCents: input.amountCents,
    writeOff: false,
  })
  const { methods } = resolveMethods(
    [{ key: 'm1', treasuryId: input.treasuryId, amountCents: null, reference: '' }],
    plan.amountCents,
  )
  const notes = input.note?.trim() ?? ''
  const labels = new Map(debts.map((d) => [d.lineId, d.label]))
  return {
    values: {
      partyId: input.partyId,
      date: input.date,
      applications: plan.applications,
      creditsUsed: plan.creditsUsed,
      methods,
      writeOffCents: plan.writeOffCents,
      notes: notes === '' ? null : notes,
      recurringExpenseId: input.recurringExpenseId,
    },
    plan,
    debtTotalCents: debts.reduce((sum, d) => sum + d.openCents, 0),
    labelOf: (lineId) => labels.get(lineId),
  }
}

// ─── Sueldos ─────────────────────────────────────────────────────────────────

export const EMPLOYEE_FREQUENCIES: Readonly<Record<'mensual' | 'quincenal', PayFrequency>> = {
  mensual: 'monthly',
  quincenal: 'biweekly',
}

export const PAYROLL_KINDS_OF: Readonly<Record<'adelanto' | 'pago', PayrollKind>> = {
  adelanto: 'advance',
  pago: 'payment',
}

export type EmployeeChange = {
  name?: string
  frequency?: PayFrequency
  active?: boolean
  notes?: string
}

/**
 * Lo que manda el formulario del empleado: un alta con lo suyo, o una edición con lo que ya tenía y lo
 * que cambia. `null`: es una edición y no cambia nada.
 */
export function employeeValues(
  employee: Pick<PayrollEmployee, 'id' | 'name' | 'payFrequency' | 'active' | 'notes'> | null,
  change: EmployeeChange,
): EmployeeValues | null {
  if (employee) {
    const name = change.name ?? employee.name
    const payFrequency = change.frequency ?? employee.payFrequency
    const active = change.active ?? employee.active
    const notes = change.notes ?? employee.notes
    const same =
      name === employee.name &&
      payFrequency === employee.payFrequency &&
      active === employee.active &&
      notes === employee.notes
    return same ? null : { id: employee.id, name, payFrequency, active, notes }
  }
  return {
    id: null,
    name: change.name ?? '',
    payFrequency: change.frequency ?? 'monthly',
    active: change.active ?? true,
    notes: change.notes ?? null,
  }
}
