/**
 * Lo que salió de la caja del salón y espera su comprobante (pedido de los socios, 22/11/2026: «cuando
 * se pone sacar plata de la caja y se selecciona el proveedor…», «si pongo adelanto de sueldo […] que se
 * cargue»). Puro, sin I/O ni `server-only`: lo usan la lectura, las acciones, las bandejas y los tests
 * (`tests/lib/accounting-pos-cash.test.ts`).
 *
 * En la caja del salón, quien saca plata dice para qué: un proveedor, un adelanto, horas extra o un
 * sueldo. Ese retiro «espera» hasta que tiene un comprobante vigente en Administración (o alguien dice
 * que no va a los libros). Mientras espera se ve en una bandeja: en Compras los de proveedores, en
 * Sueldos los del personal. La bandeja no carga nada sola: abre el formulario de siempre ya completo, y
 * el comprobante lo guarda una persona con acceso, por el camino de todos los comprobantes.
 */

import { z } from 'zod'
import { isRealIsoDay, maxIsoDay, minIsoDay, monthOf } from '@/lib/dates'

export const POS_CASH_PURPOSES = ['supplier', 'advance', 'overtime', 'salary'] as const
export type PosCashPurpose = (typeof POS_CASH_PURPOSES)[number]

/** Los que van a Sueldos: un adelanto, horas extra o un pago de sueldo. */
export const POS_CASH_PAYROLL_PURPOSES = ['advance', 'overtime', 'salary'] as const
export type PosCashPayrollPurpose = (typeof POS_CASH_PAYROLL_PURPOSES)[number]

export function isPayrollPurpose(purpose: PosCashPurpose): purpose is PosCashPayrollPurpose {
  return purpose !== 'supplier'
}

/** Cómo se nombra cada retiro, como lo dice la caja. */
export const POS_CASH_PURPOSE_LABELS: Readonly<Record<PosCashPurpose, string>> = {
  supplier: 'Proveedor',
  advance: 'Adelanto de sueldo',
  overtime: 'Horas extra',
  salary: 'Pago de sueldo',
}

/** Un retiro de la caja del salón que todavía no tiene comprobante (`acc_pos_cash_pending`). */
export type PosCashPending = {
  id: string
  /** Cuándo se anotó (instante). */
  at: string
  /** El día de servicio del turno (`yyyy-MM-dd`): con esa fecha se propone el comprobante. */
  date: string
  shiftLabel: string | null
  branchId: string
  branchName: string | null
  purpose: PosCashPurpose
  amountCents: number
  /** Lo que quedó escrito en la caja («Proveedor · Coca-Cola · Factura 123»). */
  reason: string
  /** El proveedor, si se eligió de la lista. Un nombre suelto viene sin id. */
  partyId: string | null
  partyName: string | null
  employeeId: string | null
  employeeName: string | null
  /** Las fechas que cubre un pago de sueldo, si la caja las anotó. */
  periodFrom: string | null
  periodTo: string | null
  /** Quién lo anotó. */
  byName: string | null
  hasPhoto: boolean
}

const dayOrNull = z
  .string()
  .nullish()
  .transform((value) => (value && isRealIsoDay(value) ? value : null))
const textOrNull = z
  .string()
  .nullish()
  .transform((value) => {
    const text = (value ?? '').trim()
    return text === '' ? null : text
  })

const rawPendingSchema = z.object({
  id: z.uuid(),
  at: z.string(),
  date: z.string().refine((value) => isRealIsoDay(value)),
  shift_label: textOrNull,
  branch_id: z.uuid(),
  branch: textOrNull,
  purpose: z.enum(POS_CASH_PURPOSES),
  amount_cents: z.coerce.number().int().positive(),
  reason: z.string().nullish(),
  party_id: z.uuid().nullish(),
  party_name: textOrNull,
  employee_id: z.uuid().nullish(),
  employee_name: textOrNull,
  period_from: dayOrNull,
  period_to: dayOrNull,
  by_name: textOrNull,
  has_photo: z.boolean().nullish(),
})

/**
 * Lo que devuelve `acc_pos_cash_pending` → la bandeja. Un renglón que no se puede leer se saltea (el
 * resto se muestra igual); si no vino una lista, no hay nada que mostrar.
 */
export function parsePosCashPending(raw: unknown): PosCashPending[] {
  if (!Array.isArray(raw)) return []
  const out: PosCashPending[] = []
  for (const item of raw) {
    const parsed = rawPendingSchema.safeParse(item)
    if (!parsed.success) continue
    const row = parsed.data
    out.push({
      id: row.id,
      at: row.at,
      date: row.date,
      shiftLabel: row.shift_label,
      branchId: row.branch_id,
      branchName: row.branch,
      purpose: row.purpose,
      amountCents: row.amount_cents,
      reason: (row.reason ?? '').trim(),
      partyId: row.party_id ?? null,
      partyName: row.party_name,
      employeeId: row.employee_id ?? null,
      employeeName: row.employee_name,
      periodFrom: row.period_from,
      periodTo: row.period_to,
      byName: row.by_name,
      hasPhoto: row.has_photo === true,
    })
  }
  return out
}

/** Los de una bandeja: `suppliers` en Compras, `payroll` en Sueldos. Los más viejos primero. */
export function posCashFor(
  items: readonly PosCashPending[],
  tray: 'suppliers' | 'payroll',
): PosCashPending[] {
  return items
    .filter((item) => (tray === 'suppliers') === (item.purpose === 'supplier'))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

export function posCashTotalCents(items: readonly Pick<PosCashPending, 'amountCents'>[]): number {
  return items.reduce((sum, item) => sum + item.amountCents, 0)
}

/** A quién fue: el proveedor o la persona. Un proveedor que se escribió a mano viene como texto. */
export function posCashWho(
  item: Pick<PosCashPending, 'purpose' | 'partyName' | 'employeeName'>,
): string {
  const name = item.purpose === 'supplier' ? item.partyName : item.employeeName
  return name ?? (item.purpose === 'supplier' ? 'Proveedor sin nombre' : 'Sin nombre')
}

/**
 * Lo que se escribió en la caja además de a quién («Remito 12», «Pan del día»). La caja arma el motivo
 * como «Proveedor · Coca-Cola · Remito 12» o «Adelanto de sueldo · Ana · …»: es lo que sigue al nombre.
 * `null` si no se escribió nada (o el motivo no tiene esa forma).
 */
export function posCashNote(
  item: Pick<PosCashPending, 'purpose' | 'reason' | 'partyName' | 'employeeName'>,
): string | null {
  const who = item.purpose === 'supplier' ? item.partyName : item.employeeName
  if (!who) return null
  const prefix = `${POS_CASH_PURPOSE_LABELS[item.purpose]} · ${who}`
  if (!item.reason.startsWith(prefix)) return null
  const rest = item.reason
    .slice(prefix.length)
    .replace(/^\s*·\s*/, '')
    .trim()
  return rest === '' ? null : rest
}

/** «3 retiros» · «1 retiro». */
export function posCashCountWords(count: number): string {
  return count === 1 ? '1 retiro' : `${count} retiros`
}

/**
 * La caja de efectivo de esa sucursal: de ahí salió la plata. Primero la de efectivo de la sucursal; si
 * no tiene una propia, una de efectivo de todo el bar. `null` si no hay ninguna (el formulario pide
 * elegirla).
 */
export function posCashTreasuryId(
  treasuries: ReadonlyArray<{
    id: string
    kind: string
    active: boolean
    branchId?: string | null
  }>,
  branchId: string,
): string | null {
  const cash = treasuries.filter((t) => t.active && t.kind === 'cash')
  return (cash.find((t) => t.branchId === branchId) ?? cash.find((t) => !t.branchId))?.id ?? null
}

/**
 * La fecha que se propone para el comprobante: la del retiro, sin salirse de lo que se puede cargar
 * (ni antes del primer día abierto, ni después de hoy).
 */
export function posCashDate(date: string, range: { min: string | null; max: string }): string {
  const capped = minIsoDay(date, range.max)
  return range.min ? maxIsoDay(capped, range.min) : capped
}

/** El mes (`yyyy-MM`) en el que salió la plata. */
export function posCashMonth(item: Pick<PosCashPending, 'date'>): string {
  return monthOf(item.date)
}

// ─── Los bordes ──────────────────────────────────────────────────────────────

const BAD_DATA = 'Revisá los datos.'

export const posCashLinkSchema = z.object(
  {
    movementId: z.uuid({ message: 'Ese retiro no existe.' }),
    clientRef: z.uuid({ message: 'Falta la referencia del formulario. Recargá la página.' }),
  },
  { message: BAD_DATA },
)
export type PosCashLinkValues = z.input<typeof posCashLinkSchema>

export const posCashIdSchema = z.object(
  { movementId: z.uuid({ message: 'Ese retiro no existe.' }) },
  { message: BAD_DATA },
)
export type PosCashIdValues = z.input<typeof posCashIdSchema>
