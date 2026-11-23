/**
 * Para qué sale la plata del cajón — PURO y testeado (`tests/lib/pos-cash-targets.test.ts`).
 *
 * Pedido de los socios (22/11/2026): al sacar plata, elegir el proveedor o a quién del equipo se le
 * paga (un adelanto, horas extra, el sueldo), para que quede anotado y Administración lo levante sin
 * que nadie tenga que adivinar qué era «Adelanto Juan».
 *
 * Acá vive todo lo que no toca la base ni la pantalla: los destinos y sus palabras, el buscador de la
 * lista, los atajos de fechas del pago de un sueldo y la forma de lo que se manda. La regla que manda
 * es la de la base (`pos_cash_move`): esto la espeja para avisar antes de hacer el viaje.
 *
 * Quien atiende la caja solo ve NOMBRES (`pos_cash_targets`): ni sueldos, ni saldos, ni si algo va en
 * blanco o en negro. Eso es de los socios, en Sueldos.
 */
import { z } from 'zod'

// ─── Los destinos ────────────────────────────────────────────────────────────

/** `pos_cash_movements.purpose`. Sin destino (`null`) es el retiro de siempre, con texto libre. */
export const CASH_PURPOSES = ['supplier', 'advance', 'overtime', 'salary'] as const
export type CashPurpose = (typeof CASH_PURPOSES)[number]

/** Los tres que son plata para alguien del equipo: piden elegir a la persona. */
export function isStaffPurpose(purpose: CashPurpose): boolean {
  return purpose !== 'supplier'
}

/** Lo que se elige en «¿Para qué sale?»: un destino, o el motivo escrito de siempre. */
export type MoveChoice = CashPurpose | 'other'

export const MOVE_CHOICES: ReadonlyArray<MoveChoice> = [
  'supplier',
  'advance',
  'overtime',
  'salary',
  'other',
]

type ChoiceCopy = {
  /** La ficha. */
  label: string
  /** Debajo de la ficha: qué entra ahí. */
  hint: string
  /** La pregunta del paso siguiente. */
  who: string
  /** Lo que dice el campo del buscador. */
  search: string
  /** Lo que se lee al terminar. */
  done: string
}

export const CHOICE_COPY: Readonly<Record<MoveChoice, ChoiceCopy>> = {
  supplier: {
    label: 'Proveedor',
    hint: 'Mercadería, hielo, un servicio',
    who: '¿A qué proveedor?',
    search: 'Buscá o escribí el nombre',
    done: 'Quedó anotado para Administración.',
  },
  advance: {
    label: 'Adelanto de sueldo',
    hint: 'A cuenta de lo que cobra',
    who: '¿A quién se le adelanta?',
    search: 'Buscá a la persona',
    done: 'Quedó anotado: los socios lo ven en Sueldos.',
  },
  overtime: {
    label: 'Hora extra',
    hint: 'Se paga aparte del sueldo',
    who: '¿De quién son las horas extra?',
    search: 'Buscá a la persona',
    done: 'Quedó anotado: los socios lo ven en Sueldos.',
  },
  salary: {
    label: 'Pago de sueldo',
    hint: 'El sueldo o una parte',
    who: '¿A quién se le paga?',
    search: 'Buscá a la persona',
    done: 'Quedó anotado: los socios lo ven en Sueldos.',
  },
  other: {
    label: 'Otro motivo',
    hint: 'Propinas, un retiro, lo que sea',
    who: '¿Para qué?',
    search: '',
    done: '',
  },
}

/** Cómo arranca el motivo que arma la base para cada destino (`pos_cash_move`). */
const REASON_HEAD: Readonly<Record<CashPurpose, string>> = {
  supplier: 'Proveedor',
  advance: 'Adelanto de sueldo',
  overtime: 'Horas extra',
  salary: 'Pago de sueldo',
}

/**
 * El motivo como va a quedar en la cinta: «Adelanto de sueldo · Ana», «Proveedor · Hielo Sur · Remito
 * 12». Es para mostrarlo antes de guardar; el que vale es el que arma la base.
 */
export function purposeReason(purpose: CashPurpose, name: string, note?: string | null): string {
  const parts = [REASON_HEAD[purpose], name.trim(), (note ?? '').trim()].filter(Boolean)
  return parts.join(' · ')
}

// ─── Las listas ──────────────────────────────────────────────────────────────

export type CashTarget = { id: string; name: string }
/** `here`: trabaja en la sucursal de esta caja (van primero). */
export type CashEmployee = CashTarget & { here: boolean }
export type CashTargets = { suppliers: CashTarget[]; employees: CashEmployee[] }

export const NO_TARGETS: CashTargets = { suppliers: [], employees: [] }

const targetSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(200) })
const targetsSchema = z.object({
  suppliers: z.array(z.unknown()).default([]),
  employees: z.array(z.unknown()).default([]),
})

/**
 * Lo que devuelve `pos_cash_targets` → las listas. Lo que no se entiende se saltea (un renglón raro
 * no deja a la caja sin lista); si no se entiende nada, listas vacías.
 */
export function parseCashTargets(raw: unknown): CashTargets {
  const parsed = targetsSchema.safeParse(raw)
  if (!parsed.success) return NO_TARGETS
  const suppliers: CashTarget[] = []
  for (const item of parsed.data.suppliers) {
    const row = targetSchema.safeParse(item)
    if (row.success) suppliers.push(row.data)
  }
  const employees: CashEmployee[] = []
  for (const item of parsed.data.employees) {
    const row = targetSchema.extend({ here: z.boolean().default(false) }).safeParse(item)
    if (row.success) employees.push(row.data)
  }
  return { suppliers, employees }
}

// ─── El buscador ─────────────────────────────────────────────────────────────

/** Sin tildes, en minúsculas y sin espacios de más: «Panadería  La Única» → «panaderia la unica». */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Filtra una lista por lo que se va escribiendo. Cada palabra tiene que aparecer en el nombre; primero
 * los que EMPIEZAN con lo escrito, después los que tienen una palabra que empieza así, después el
 * resto. Dentro de cada grupo se respeta el orden que trajo la lista (la base ya la ordenó).
 */
export function searchTargets<T extends { name: string }>(
  list: ReadonlyArray<T>,
  query: string,
): T[] {
  const key = searchKey(query)
  if (key === '') return [...list]
  const words = key.split(' ')
  const ranked: { item: T; rank: number; index: number }[] = []
  list.forEach((item, index) => {
    const name = searchKey(item.name)
    if (!words.every((word) => name.includes(word))) return
    const nameWords = name.split(' ')
    const rank = name.startsWith(key)
      ? 0
      : words.every((word) => nameWords.some((candidate) => candidate.startsWith(word)))
        ? 1
        : 2
    ranked.push({ item, rank, index })
  })
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((entry) => entry.item)
}

/** ¿Lo escrito ya es, tal cual, uno de la lista? (Entonces no se ofrece «no está en la lista».) */
export function findExactTarget<T extends { name: string }>(
  list: ReadonlyArray<T>,
  query: string,
): T | null {
  const key = searchKey(query)
  if (key === '') return null
  return list.find((item) => searchKey(item.name) === key) ?? null
}

/** El nombre de un proveedor escrito a mano, prolijo. `null` si no alcanza para un nombre. */
export function typedSupplierName(query: string): string | null {
  const name = query.replace(/\s+/g, ' ').trim()
  return name.length >= 2 ? name.slice(0, 80) : null
}

// ─── Las fechas del pago de un sueldo ────────────────────────────────────────

/** Un rango de días, los dos incluidos, en `yyyy-MM-dd`. */
export type PeriodRange = { from: string; to: string }
export type PeriodShortcut = PeriodRange & {
  id: 'first-half' | 'second-half' | 'month' | 'week'
  label: string
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

type Ymd = { year: number; month: number; day: number }

function readDay(value: string | null | undefined): Ymd | null {
  const match = ISO_DAY.exec(value ?? '')
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  // «2026-02-31» no es un día: `Date` lo correría a marzo.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null
  if (date.getUTCDate() !== day) return null
  return { year, month, day }
}

function writeDay(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

/** ¿Es un día de verdad en `yyyy-MM-dd`? */
export function isIsoDay(value: string | null | undefined): value is string {
  return readDay(value) !== null
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Hasta este día del mes, lo que se paga suele ser del mes anterior. */
export const PAY_PREVIOUS_MONTH_UNTIL_DAY = 10

/**
 * Los atajos de «¿Qué fechas cubre?». Las quincenas y el mes son los del mes que se está pagando:
 * hasta el día 10 es el anterior (el sueldo de octubre se paga la primera semana de noviembre), y
 * después, el que corre. El mes se dice una sola vez, en «Todo noviembre», que va pegado a las dos
 * quincenas; al elegir, la pantalla escribe el rango entero («Del 1 al 15 de noviembre»).
 * `today` es el día del bar en `yyyy-MM-dd`; si no se entiende, no hay atajos.
 */
export function periodShortcuts(today: string): PeriodShortcut[] {
  const now = readDay(today)
  if (!now) return []
  const previous = now.day <= PAY_PREVIOUS_MONTH_UNTIL_DAY
  const year = previous && now.month === 1 ? now.year - 1 : now.year
  const month = previous ? (now.month === 1 ? 12 : now.month - 1) : now.month
  const name = MONTHS[month - 1] ?? ''
  const end = lastDayOf(year, month)

  // La semana va de lunes a domingo, como se dice acá.
  const weekday = new Date(Date.UTC(now.year, now.month - 1, now.day)).getUTCDay()
  const sinceMonday = (weekday + 6) % 7

  return [
    {
      id: 'first-half',
      label: '1.ª quincena',
      from: writeDay(year, month, 1),
      to: writeDay(year, month, 15),
    },
    {
      id: 'second-half',
      label: '2.ª quincena',
      from: writeDay(year, month, 16),
      to: writeDay(year, month, end),
    },
    {
      id: 'month',
      label: `Todo ${name}`,
      from: writeDay(year, month, 1),
      to: writeDay(year, month, end),
    },
    {
      id: 'week',
      label: 'Esta semana',
      from: writeDay(now.year, now.month, now.day - sinceMonday),
      to: writeDay(now.year, now.month, now.day - sinceMonday + 6),
    },
  ]
}

/**
 * Un rango escrito a mano: los dos días de verdad y en orden. Con uno solo, vale por ese día.
 * `null` si falta todo o está al revés.
 */
export function readPeriod(from: string, to: string): PeriodRange | null {
  const start = isIsoDay(from) ? from : null
  const end = isIsoDay(to) ? to : null
  if (!start && !end) return null
  const range = { from: start ?? end ?? '', to: end ?? start ?? '' }
  return range.to >= range.from ? range : null
}

/** «Del 1 al 15 de noviembre», «Del 28 de octubre al 3 de noviembre», «El 5 de noviembre». */
export function periodWords(range: PeriodRange): string {
  const from = readDay(range.from)
  const to = readDay(range.to)
  if (!from || !to) return ''
  const monthOf = (day: Ymd) => MONTHS[day.month - 1] ?? ''
  if (range.from === range.to) return `El ${from.day} de ${monthOf(from)}`
  if (from.year === to.year && from.month === to.month) {
    return `Del ${from.day} al ${to.day} de ${monthOf(to)}`
  }
  const year = from.year === to.year ? '' : ` de ${from.year}`
  return `Del ${from.day} de ${monthOf(from)}${year} al ${to.day} de ${monthOf(to)}`
}

// ─── Lo que se manda ─────────────────────────────────────────────────────────

/** Lo que la hoja ya sabe del retiro, antes de pedir el monto. */
export type MoveTarget =
  | { purpose: 'supplier'; partyId: string | null; name: string }
  | { purpose: Exclude<CashPurpose, 'supplier'>; employeeId: string; name: string }

/**
 * Los campos del retiro que salen del destino: a quién, y qué va en el texto libre. Con un proveedor
 * que no está en la lista, el texto libre ES su nombre y nada más: la base lo guarda tal cual como
 * nombre del proveedor, y una nota pegada («Verdulero · Remito 7») lo ensuciaría en Administración.
 */
export function targetFields(
  target: MoveTarget,
  note: string,
  period: PeriodRange | null,
): {
  purpose: CashPurpose
  partyId: string | null
  employeeId: string | null
  reason: string | null
  periodFrom: string | null
  periodTo: string | null
} {
  const text = note.replace(/\s+/g, ' ').trim()
  if (target.purpose === 'supplier') {
    const reason = (target.partyId === null ? target.name.trim() : text).slice(0, 160)
    return {
      purpose: 'supplier',
      partyId: target.partyId,
      employeeId: null,
      reason: reason || null,
      periodFrom: null,
      periodTo: null,
    }
  }
  const dated = target.purpose === 'salary' ? period : null
  // Las fechas van en sus columnas y, dichas en palabras, en el motivo: así se leen en la cinta, en
  // el cierre impreso y en el mail a los socios.
  const reason = [text, dated ? periodWords(dated) : ''].filter(Boolean).join(' · ')
  return {
    purpose: target.purpose,
    partyId: null,
    employeeId: target.employeeId,
    reason: reason.slice(0, 160) || null,
    periodFrom: dated?.from ?? null,
    periodTo: dated?.to ?? null,
  }
}

/**
 * ¿Lo que se quiere anotar tiene sentido? Espeja las reglas de `pos_cash_move` para cortar antes del
 * viaje. Devuelve el código del problema (los mismos de la base) o `null`.
 */
export function moveProblem(input: {
  kind: 'in' | 'out'
  reason?: string | null
  purpose?: CashPurpose | null
  partyId?: string | null
  employeeId?: string | null
  periodFrom?: string | null
  periodTo?: string | null
}): 'purpose_invalid' | 'employee_required' | 'reason_required' | 'period_invalid' | null {
  const purpose = input.purpose ?? null
  const reason = (input.reason ?? '').trim()
  const hasPeriod = Boolean(input.periodFrom || input.periodTo)
  if (purpose === null) {
    if (input.partyId || input.employeeId || hasPeriod) return 'purpose_invalid'
    return reason === '' ? 'reason_required' : null
  }
  if (input.kind !== 'out') return 'purpose_invalid'
  if (purpose === 'supplier') {
    if (input.employeeId || hasPeriod) return 'purpose_invalid'
    return !input.partyId && reason === '' ? 'reason_required' : null
  }
  if (input.partyId) return 'purpose_invalid'
  if (!input.employeeId) return 'employee_required'
  if (input.periodFrom && input.periodTo && input.periodTo < input.periodFrom) {
    return 'period_invalid'
  }
  return null
}
