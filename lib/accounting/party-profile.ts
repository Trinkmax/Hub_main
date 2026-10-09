/**
 * La ficha del proveedor (contactos, días de entrega, anticipación) y el
 * detalle de un gasto fijo (por ejemplo los sueldos, por empleado y concepto).
 * Pedido de los socios de HUB del 09/10/2026. Sin I/O ni `server-only`: lo usan
 * las acciones, las lecturas y los formularios.
 */

export type PartyContact = {
  name: string | null
  role: string | null
  phone: string | null
  email: string | null
}

export const RECURRING_BREAKDOWN_KINDS = ['aporte', 'contribucion', 'blanco', 'negro'] as const
export type RecurringBreakdownKind = (typeof RECURRING_BREAKDOWN_KINDS)[number]

export const BREAKDOWN_KIND_LABELS: Readonly<Record<RecurringBreakdownKind, string>> = {
  aporte: 'Aporte',
  contribucion: 'Contribución',
  blanco: 'Pago en blanco',
  negro: 'Pago en negro',
}

export type RecurringBreakdownRow = {
  label: string
  kind: RecurringBreakdownKind | null
  amountCents: number
}

/** 1 = lunes … 7 = domingo (como la base). */
export const WEEKDAYS = [
  { value: 1, short: 'Lun', label: 'lunes' },
  { value: 2, short: 'Mar', label: 'martes' },
  { value: 3, short: 'Mié', label: 'miércoles' },
  { value: 4, short: 'Jue', label: 'jueves' },
  { value: 5, short: 'Vie', label: 'viernes' },
  { value: 6, short: 'Sáb', label: 'sábado' },
  { value: 7, short: 'Dom', label: 'domingo' },
] as const

function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

export function parsePartyContacts(raw: unknown): PartyContact[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const c = record(item)
    if (!c) return []
    return [{ name: text(c.name), role: text(c.role), phone: text(c.phone), email: text(c.email) }]
  })
}

export function parseDeliveryDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return [
    ...new Set(
      raw
        .map((d) => (typeof d === 'number' ? d : Number(d)))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
    ),
  ].sort((a, b) => a - b)
}

export function parseBreakdown(raw: unknown): RecurringBreakdownRow[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const l = record(item)
    const amount = l ? Number(l.amount_cents) : Number.NaN
    if (!l || !Number.isSafeInteger(amount) || amount < 1) return []
    return [
      {
        label: text(l.label) ?? '',
        kind: (RECURRING_BREAKDOWN_KINDS as readonly unknown[]).includes(l.kind)
          ? (l.kind as RecurringBreakdownKind)
          : null,
        amountCents: amount,
      },
    ]
  })
}

/** «Lunes, miércoles y viernes» · «Todos los días» · `null` si no se cargó. */
export function deliveryDaysText(days: readonly number[]): string | null {
  const names = WEEKDAYS.filter((d) => days.includes(d.value)).map((d) => d.label)
  if (names.length === 0) return null
  if (names.length === 7) return 'Todos los días'
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d)))
    return 'De lunes a viernes'
  const joined =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
  return joined ? joined.charAt(0).toUpperCase() + joined.slice(1) : null
}

/** «El mismo día» · «1 día antes» · «3 días antes» · `null` si no se cargó. */
export function orderLeadText(days: number | null): string | null {
  if (days === null) return null
  if (days === 0) return 'El mismo día'
  return days === 1 ? '1 día antes' : `${days} días antes`
}

/** Suma por concepto (los sin concepto van en `null`) y el total. */
export function breakdownTotals(lines: readonly RecurringBreakdownRow[]): {
  total: number
  byKind: ReadonlyArray<{ kind: RecurringBreakdownKind | null; cents: number }>
} {
  const sums = new Map<RecurringBreakdownKind | null, number>()
  let total = 0
  for (const line of lines) {
    total += line.amountCents
    sums.set(line.kind, (sums.get(line.kind) ?? 0) + line.amountCents)
  }
  const order: ReadonlyArray<RecurringBreakdownKind | null> = [...RECURRING_BREAKDOWN_KINDS, null]
  return {
    total,
    byKind: order.flatMap((kind) => {
      const cents = sums.get(kind)
      return cents === undefined ? [] : [{ kind, cents }]
    }),
  }
}
