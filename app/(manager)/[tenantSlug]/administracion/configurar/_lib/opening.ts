/**
 * Los saldos iniciales del asistente (H.3 paso 3, E.5.16), puros: qué se
 * manda a `postOpening`, cuánto da el patrimonio inicial y en qué campo va
 * cada error. La vista previa la arma el motor (`buildOpening`) con la SALIDA
 * de `openingSchema`, igual que la acción: así el hash coincide.
 */

import type { Side, TreasuryKind } from '@/lib/accounting/types'

export type OpeningItemRow = {
  id: string
  partyId: string | null
  amountCents: number | null
  dueDate: string | null
  /** «Factura A 0003-00001234» (opcional). */
  reference: string
}

export type OpeningOtherRow = {
  id: string
  accountId: string | null
  side: Side
  amountCents: number | null
}

export type OpeningFormState = {
  /** Id de la caja → plata al empezar (en la tarjeta de la empresa, la deuda). */
  treasuries: Record<string, number | null>
  payables: OpeningItemRow[]
  receivables: OpeningItemRow[]
  others: OpeningOtherRow[]
  shareCapitalCents: number | null
}

export type OpeningTreasury = { id: string; name: string; kind: TreasuryKind }

export function emptyItemRow(id: string): OpeningItemRow {
  return { id, partyId: null, amountCents: null, dueDate: null, reference: '' }
}

export function emptyOtherRow(id: string): OpeningOtherRow {
  return { id, accountId: null, side: 'debit', amountCents: null }
}

export function initialOpeningState(rowIds: {
  payable: string
  receivable: string
}): OpeningFormState {
  return {
    treasuries: {},
    payables: [emptyItemRow(rowIds.payable)],
    receivables: [emptyItemRow(rowIds.receivable)],
    others: [],
    shareCapitalCents: null,
  }
}

/** Una fila sin nada cargado no viaja (ni se marca con error). */
export function isBlankItem(row: OpeningItemRow): boolean {
  return (
    row.partyId === null &&
    row.amountCents === null &&
    row.dueDate === null &&
    row.reference.trim() === ''
  )
}

export function isBlankOther(row: OpeningOtherRow): boolean {
  return row.accountId === null && row.amountCents === null
}

/** Fila lista para el asiento: con quién y cuánto. */
function completeItem(row: OpeningItemRow): boolean {
  return row.partyId !== null && row.amountCents !== null && row.amountCents > 0
}

function completeOther(row: OpeningOtherRow): boolean {
  return row.accountId !== null && row.amountCents !== null && row.amountCents > 0
}

export type OpeningItemValues = {
  partyId: string
  accountId: null
  amountCents: number | null
  dueDate: string | null
  reference: string
}

export type OpeningOtherValues = {
  accountId: string
  side: Side
  amountCents: number | null
  partyId: null
  dueDate: null
  reference: null
}

export type OpeningValues = {
  treasuries: Array<{ treasuryAccountId: string; balanceCents: number }>
  payables: OpeningItemValues[]
  receivables: OpeningItemValues[]
  others: OpeningOtherValues[]
  shareCapitalCents: number | null
}

export type OpeningPayload = {
  /** Lo que recibe `openingSchema` (sin `clientRef`, `previewHash` ni avisos). */
  values: OpeningValues
  /** Índice de cada lista → id de la caja o de la fila (zod marca por índice). */
  index: { treasuries: string[]; payables: string[]; receivables: string[]; others: string[] }
}

function itemValues(row: OpeningItemRow): OpeningItemValues {
  return {
    partyId: row.partyId ?? '',
    accountId: null,
    amountCents: row.amountCents,
    dueDate: row.dueDate,
    reference: row.reference,
  }
}

/**
 * El formulario → los datos de `openingSchema`. Una caja en cero o vacía no
 * viaja (no suma una línea en cero) y las filas en blanco tampoco. Con
 * `completeOnly` (la vista previa mientras se carga) quedan afuera además las
 * filas a medio cargar: el asiento muestra lo que ya está completo.
 */
export function openingPayload(
  form: OpeningFormState,
  treasuries: readonly OpeningTreasury[],
  opts: { completeOnly?: boolean } = {},
): OpeningPayload {
  const keepItem = opts.completeOnly ? completeItem : (r: OpeningItemRow) => !isBlankItem(r)
  const keepOther = opts.completeOnly ? completeOther : (r: OpeningOtherRow) => !isBlankOther(r)
  const withBalance = treasuries.filter((t) => (form.treasuries[t.id] ?? 0) > 0)
  const payables = form.payables.filter(keepItem)
  const receivables = form.receivables.filter(keepItem)
  const others = form.others.filter(keepOther)
  const capital = form.shareCapitalCents
  return {
    values: {
      treasuries: withBalance.map((t) => ({
        treasuryAccountId: t.id,
        balanceCents: form.treasuries[t.id] ?? 0,
      })),
      payables: payables.map(itemValues),
      receivables: receivables.map(itemValues),
      others: others.map((r) => ({
        accountId: r.accountId ?? '',
        side: r.side,
        amountCents: r.amountCents,
        partyId: null,
        dueDate: null,
        reference: null,
      })),
      shareCapitalCents: opts.completeOnly && (capital ?? 0) <= 0 ? null : capital,
    },
    index: {
      treasuries: withBalance.map((t) => t.id),
      payables: payables.map((r) => r.id),
      receivables: receivables.map((r) => r.id),
      others: others.map((r) => r.id),
    },
  }
}

/**
 * Ruta de zod o del motor (`payables.2.amountCents`) → clave del campo en
 * pantalla (`payables.<id de la fila>.amountCents`). Lo que no es de una fila
 * va a `form` (el aviso arriba de los botones).
 */
export function openingFieldKey(path: string, index: OpeningPayload['index']): string {
  const match = /^(treasuries|payables|receivables|others)\.(\d+)(?:\.(\w+))?/.exec(path)
  if (match) {
    const list = match[1] as keyof OpeningPayload['index']
    const id = index[list][Number(match[2])]
    if (!id) return 'form'
    return list === 'treasuries' ? `treasuries.${id}` : `${list}.${id}.${match[3] ?? 'amountCents'}`
  }
  if (path === 'shareCapitalCents') return 'shareCapitalCents'
  return 'form'
}

export type OpeningTotals = {
  /** Lo que tienen: cajas, lo que les debían y otros saldos deudores. */
  assetsCents: number
  /** Lo que deben: proveedores, tarjetas de la empresa y otros saldos acreedores. */
  liabilitiesCents: number
  /** Patrimonio inicial = lo que tienen − lo que deben. */
  equityCents: number
  capitalCents: number
  /** Lo que queda en «Saldo de apertura a asignar» (lo revisa la contadora). */
  unassignedCents: number
}

const positive = (cents: number | null): number => (cents !== null && cents > 0 ? cents : 0)

/** Las cuentas del patrimonio inicial con lo mismo que va al asiento. */
export function openingTotals(
  values: OpeningValues,
  treasuries: readonly OpeningTreasury[],
): OpeningTotals {
  const kinds = new Map(treasuries.map((t) => [t.id, t.kind]))
  let assets = 0
  let liabilities = 0
  for (const t of values.treasuries) {
    if (kinds.get(t.treasuryAccountId) === 'credit_card') liabilities += positive(t.balanceCents)
    else assets += positive(t.balanceCents)
  }
  for (const r of values.receivables) assets += positive(r.amountCents)
  for (const r of values.payables) liabilities += positive(r.amountCents)
  for (const r of values.others) {
    if (r.side === 'debit') assets += positive(r.amountCents)
    else liabilities += positive(r.amountCents)
  }
  const capital = positive(values.shareCapitalCents)
  const equity = assets - liabilities
  return {
    assetsCents: assets,
    liabilitiesCents: liabilities,
    equityCents: equity,
    capitalCents: capital,
    unassignedCents: equity - capital,
  }
}

// ─── Borrador (localStorage) ─────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null
}

function cents(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null
}

function day(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

/**
 * Un borrador guardado en el navegador → el formulario, o `null` si no se
 * lee. Se revisa campo por campo: un borrador viejo o tocado a mano nunca
 * rompe la pantalla.
 */
export function openingStateFromDraft(raw: unknown): OpeningFormState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  if (!Array.isArray(v.payables) || !Array.isArray(v.receivables) || !Array.isArray(v.others)) {
    return null
  }
  const treasuries: Record<string, number | null> = {}
  if (typeof v.treasuries === 'object' && v.treasuries !== null) {
    for (const [id, value] of Object.entries(v.treasuries as Record<string, unknown>)) {
      if (str(id)) treasuries[id] = cents(value)
    }
  }
  const item = (r: unknown): OpeningItemRow | null => {
    if (typeof r !== 'object' || r === null) return null
    const row = r as Record<string, unknown>
    const id = str(row.id)
    if (!id) return null
    return {
      id,
      partyId: str(row.partyId),
      amountCents: cents(row.amountCents),
      dueDate: day(row.dueDate),
      reference: typeof row.reference === 'string' ? row.reference.slice(0, 60) : '',
    }
  }
  const other = (r: unknown): OpeningOtherRow | null => {
    if (typeof r !== 'object' || r === null) return null
    const row = r as Record<string, unknown>
    const id = str(row.id)
    if (!id) return null
    return {
      id,
      accountId: str(row.accountId),
      side: row.side === 'credit' ? 'credit' : 'debit',
      amountCents: cents(row.amountCents),
    }
  }
  const isRow = <T>(x: T | null): x is T => x !== null
  return {
    treasuries,
    payables: v.payables.map(item).filter(isRow),
    receivables: v.receivables.map(item).filter(isRow),
    others: v.others.map(other).filter(isRow),
    shareCapitalCents: cents(v.shareCapitalCents),
  }
}

/** ¿Hay algo cargado? (para no perderlo: el borrador y «¿Descartás…?»). */
export function hasAnyOpeningValue(form: OpeningFormState): boolean {
  return (
    Object.values(form.treasuries).some((v) => v !== null && v !== undefined) ||
    form.payables.some((r) => !isBlankItem(r)) ||
    form.receivables.some((r) => !isBlankItem(r)) ||
    form.others.some((r) => !isBlankOther(r)) ||
    form.shareCapitalCents !== null
  )
}
