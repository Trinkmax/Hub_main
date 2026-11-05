import { z } from 'zod'
import {
  TAX_BASE_LABELS,
  TAX_ROWS,
  type TaxField,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/taxes-view'
import {
  hasContent,
  type InitialLine,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/asiento-manual/_lib/manual-entry'
import type { CloseLine } from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/_lib/close-lines'
import type { IvaPositionExpected } from '@/lib/accounting/actions/payloads'
import type { DocumentDetail } from '@/lib/accounting/queries/documents'
import type { ReimputeTarget } from '@/lib/accounting/reimpute'
import type { ManualEntryValues } from '@/lib/accounting/server/document-types'
import { bpLabel, TAX_BASES, type TaxBase, type TaxSettings } from '@/lib/accounting/taxes'
import type { CloseWarningKey } from '@/lib/accounting/types'
import { formatIsoDay, maxIsoDay, monthName } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import type { TexTicketWarning } from '../../protocol'

/**
 * Lo que Tex manda en Contabilidad, puro. Cada función copia el criterio de su pantalla: la grilla del
 * asiento (`manual-entry-form.tsx`), los diálogos de anular (`document-actions.tsx`), el botón de
 * cerrar el mes (`close-actions.tsx`) y Ajustes › Impuestos. Lo prueba `tex-actions-contabilidad.test.ts`.
 */

// ─── El asiento ──────────────────────────────────────────────────────────────

export const ENTRY_KIND_WORDS = ['ajuste', 'sueldos', 'otro'] as const
export type EntryKindWord = (typeof ENTRY_KIND_WORDS)[number]

const ENTRY_KIND_OF = {
  ajuste: 'adjustment',
  sueldos: 'payroll',
  otro: 'manual',
} as const satisfies Readonly<Record<EntryKindWord, string>>

export const ENTRY_KIND_TITLE: Readonly<Record<EntryKindWord, string>> = {
  ajuste: 'Asiento de ajuste',
  sueldos: 'Asiento de sueldos',
  otro: 'Asiento manual',
}

export type ManualEntryFormValues = Omit<ManualEntryValues, 'clientRef' | 'previewHash'>

/** Lo mismo que manda la grilla (`manualEntryValues`), que vive en un archivo de cliente. */
export function manualEntryFormValues(input: {
  kind: EntryKindWord
  date: string
  description: string
  lines: readonly InitialLine[]
  correctsId: string | null
  /** El respaldo: va a la nota del comprobante. */
  backing: string
}): ManualEntryFormValues {
  const notes = input.backing.trim()
  return {
    entryKind: ENTRY_KIND_OF[input.kind],
    date: input.date,
    description: input.description.trim(),
    lines: input.lines.filter(hasContent).map((line) => ({
      accountId: line.accountId ?? '',
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      partyId: line.partyId,
      dueDate: line.dueDate,
      memo: line.memo.trim() === '' ? null : line.memo.trim(),
    })),
    correctsDocumentId: input.correctsId,
    ...(notes ? { notes } : {}),
  }
}

// ─── Reimputar ───────────────────────────────────────────────────────────────

export type TargetPick =
  | { ok: true; target: ReimputeTarget }
  | { ok: false; options: ReimputeTarget[] }

/** Qué renglón: por su id, por la cuenta que tiene ahora, o el único que hay. */
export function pickReimputeTarget(
  targets: readonly ReimputeTarget[],
  wanted: { lineId?: string; accountKey?: (name: string, code: string) => boolean },
): TargetPick {
  const found = wanted.lineId
    ? targets.filter((t) => t.lineId === wanted.lineId)
    : wanted.accountKey
      ? targets.filter((t) => wanted.accountKey?.(t.accountName, t.accountCode))
      : targets
  const [only] = found
  if (only && found.length === 1) return { ok: true, target: only }
  return { ok: false, options: [...(found.length > 1 ? found : targets)] }
}

// ─── Anular ──────────────────────────────────────────────────────────────────

export type AppliedWord = 'pagos' | 'cobros' | 'pagos o cobros'

/** Lo que tiene unido una compra son pagos; una venta o un cierre, cobros. */
export function appliedWordOf(kind: DocumentDetail['kind']): AppliedWord {
  if (kind === 'purchase' || kind === 'purchase_debit_note') return 'pagos'
  if (kind === 'sales_invoice' || kind === 'sales_debit_note' || kind === 'sales_close') {
    return 'cobros'
  }
  return 'pagos o cobros'
}

/** El mismo aviso de los diálogos de anular. `null`: no tiene nada unido. */
export function appliedText(appliedCents: number | null, word: AppliedWord): string | null {
  if (!appliedCents || appliedCents <= 0) return null
  const amount = appliedCents < 100 ? formatCents(appliedCents) : formatCentsShort(appliedCents)
  return `Tiene ${amount} en ${word} unidos. Si lo anulás, quedan a cuenta.`
}

export function bundleText(siblings: readonly string[]): string | null {
  if (siblings.length === 0) return null
  if (siblings.length === 1) return `Se guardó junto con ${siblings[0]}: se anulan los dos.`
  return `Se guardó junto con ${siblings.join(', ')}: se anula todo junto.`
}

/** Cómo entra al Libro IVA la anulación de un mes cerrado (Ajustes › Ejercicio). */
export function reversalIvaText(input: {
  hasFiscal: boolean
  ivaMode: 'adjustment_only' | 'negative_row' | null
  date: string
}): string | null {
  if (!input.hasFiscal) return null
  const month = monthName(Number(input.date.slice(5, 7)))
  return input.ivaMode === 'negative_row'
    ? `En el Libro IVA de ${month} aparece el mismo comprobante en negativo («Anulación de …»).`
    : `En el Libro IVA no aparece una fila nueva: la contadora lo ve en la posición de IVA de ${month} como ajuste de un período cerrado y decide si rectifica.`
}

/** La fecha de «Anular con fecha de hoy»: del primer mes abierto, y no antes del comprobante. */
export function reversalDate(input: {
  wanted: string | undefined
  today: string
  firstOpenDate: string | null
  documentDate: string
}): { ok: true; date: string } | { ok: false; message: string } {
  const min = maxIsoDay(input.firstOpenDate ?? input.today, input.documentDate)
  if (min > input.today) {
    return { ok: false, message: 'Todavía no hay un mes abierto donde cargar la anulación.' }
  }
  const date = input.wanted ?? input.today
  if (date < min || date > input.today) {
    return {
      ok: false,
      message: `La anulación tiene que tener fecha entre el ${formatIsoDay(min)} y hoy. Preguntale cuál.`,
    }
  }
  return { ok: true, date }
}

// ─── Cerrar el mes ───────────────────────────────────────────────────────────

/** Lo que manda `CloseMonthButton`: los avisos que se ven y el IVA con las cifras que se ven. */
export function closePeriodValues(input: {
  /** Primer día del mes. */
  month: string
  warningKeys: readonly CloseWarningKey[]
  iva: { expected: IvaPositionExpected; optional: boolean } | null
  /** «Anotar el IVA del mes al cerrar». */
  generate: boolean
}) {
  const settle = input.iva !== null && (input.generate || !input.iva.optional)
  return {
    month: input.month,
    warningsAck: [...new Set(input.warningKeys)],
    ivaSettlement:
      input.iva && settle
        ? { generate: true, expected: input.iva.expected }
        : { generate: false, expected: null },
  }
}

/** Lo que queda para mirar antes de cerrar, con las mismas palabras de la pantalla. */
export function closeTicketWarnings(lines: readonly CloseLine[]): TexTicketWarning[] {
  return lines
    .filter((line) => line.tone === 'warn' || line.tone === 'late' || line.tone === 'muted')
    .map((line) => {
      const body = [
        line.detail,
        ...line.recurring.map((recurring) => recurring.text),
        line.more,
      ].filter((part): part is string => Boolean(part))
      return { key: line.key, title: line.title, body: body.length > 0 ? body.join(' · ') : null }
    })
}

// ─── Impuestos ───────────────────────────────────────────────────────────────

const PERCENT_MESSAGE = 'El porcentaje va de 0 a 100.'
const percentBp = z
  .number({ message: PERCENT_MESSAGE })
  .int(PERCENT_MESSAGE)
  .min(0, PERCENT_MESSAGE)
  .max(10_000, PERCENT_MESSAGE)

/** El mismo esquema de `saveTaxSettings`: la acción no lo puede exportar (`'use server'`). */
export const taxSettingsPayload = z.object({
  auto: z.boolean({ message: 'Decí si se calculan solos.' }),
  iibbBp: percentBp,
  municipalBp: percentBp,
  bankTaxBp: percentBp,
  base: z.enum(TAX_BASES, { message: 'Elegí sobre qué se calculan.' }),
})

export const TAX_BASE_WORDS = ['facturado', 'todo'] as const
export type TaxBaseWord = (typeof TAX_BASE_WORDS)[number]

const TAX_BASE_OF: Readonly<Record<TaxBaseWord, TaxBase>> = {
  facturado: 'invoiced_net',
  todo: 'all_sales',
}

export type TaxChange = {
  auto?: boolean
  /** Porcentajes como los dice la gente: 0,7 = 0,7 %. */
  iibb?: number
  municipal?: number
  bankTax?: number
  base?: TaxBaseWord
}

const toBp = (percent: number) => Math.round(percent * 100)

/** Lo guardado, con lo que cambia. Se manda entero, como la pantalla. */
export function nextTaxSettings(current: TaxSettings, change: TaxChange): TaxSettings {
  return {
    auto: change.auto ?? current.auto,
    iibbBp: change.iibb !== undefined ? toBp(change.iibb) : current.iibbBp,
    municipalBp: change.municipal !== undefined ? toBp(change.municipal) : current.municipalBp,
    bankTaxBp: change.bankTax !== undefined ? toBp(change.bankTax) : current.bankTaxBp,
    base: change.base ? TAX_BASE_OF[change.base] : current.base,
  }
}

/** Los renglones del tique: lo que cambia, de cuánto a cuánto. */
export function taxChangeRows(
  current: TaxSettings,
  next: TaxSettings,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  if (current.auto !== next.auto) {
    rows.push({ label: 'Calcular solos', value: next.auto ? 'Prendido' : 'Apagado' })
  }
  for (const row of TAX_ROWS) {
    const field: TaxField | null = row.field
    if (field === null || current[field] === next[field]) continue
    rows.push({ label: row.name, value: `${bpLabel(current[field])} → ${bpLabel(next[field])}` })
  }
  if (current.base !== next.base) {
    rows.push({ label: 'Sobre qué', value: TAX_BASE_LABELS[next.base] })
  }
  return rows
}
