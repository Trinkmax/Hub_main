/**
 * Los movimientos de una caja contados como «actividad» (lo que muestra una
 * billetera): qué pasó, en palabras de dueño de bar, y cuánta plata entró o
 * salió. Puro; lo prueba `tests/lib/administracion-cajas-vista.test.ts`.
 *
 * La base trae cada movimiento con la descripción que escribió el motor al
 * guardarlo («Gasto · Hielo», «Movimiento entre cuentas · Caja → Banco
 * Nación») y el nombre de las cuentas contables. Acá se pasa a lo que el socio
 * reconoce: «Hielo · Gasto», «Caja → Banco Nación · Plata movida entre cajas».
 * Si una descripción no calza con lo esperado, se muestra tal cual: nunca se
 * inventa un texto.
 */

import {
  ArrowLeftRight,
  BanknoteArrowDown,
  CircleEllipsis,
  Flag,
  HandCoins,
  Landmark,
  type LucideIcon,
  ReceiptText,
  Scale,
  ShoppingBasket,
  Undo2,
} from 'lucide-react'
import type { TreasuryKind } from '@/lib/accounting/types'
import {
  capitalizeFirst,
  daysBetween,
  formatDayMonth,
  isRealIsoDay,
  WEEKDAY_NAMES,
  WEEKDAY_NAMES_SHORT,
  weekdayName,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

export type ActivityIcon =
  | 'sale'
  | 'expense'
  | 'payment'
  | 'collection'
  | 'transfer'
  | 'bank'
  | 'count'
  | 'partner'
  | 'other'
  | 'opening'
  | 'reversal'

/** Los mismos íconos que el lanzador «¿Qué querés cargar?»: una cosa, un dibujo. */
export const ACTIVITY_ICONS: Readonly<Record<ActivityIcon, LucideIcon>> = {
  sale: ReceiptText,
  expense: ShoppingBasket,
  payment: HandCoins,
  collection: BanknoteArrowDown,
  transfer: ArrowLeftRight,
  bank: Landmark,
  count: Scale,
  partner: HandCoins,
  other: CircleEllipsis,
  opening: Flag,
  reversal: Undo2,
}

/** Una línea de movimiento como la devuelve el subdiario de disponibilidades. */
export type ActivityMovement = {
  /** Único por línea (el asiento + su renglón). */
  key: string
  /** `yyyy-MM-dd`. */
  date: string
  documentId: string | null
  documentKind: string | null
  /** «Factura A 0003-00001290», «Movimiento entre cuentas». */
  documentLabel: string | null
  /** El concepto que escribió el motor. */
  description: string | null
  /** La leyenda de la línea («Efectivo», «A Banco Nación»). */
  memo: string | null
  inCents: number
  outCents: number
  /** Saldo acumulado después de esta línea (Debe − Haber). */
  balanceCents: number
  treasuryId: string | null
  treasuryName: string | null
}

export type ActivityRow = {
  key: string
  date: string
  title: string
  /**
   * El mismo título, más corto, para una hoja angosta (el celular, la columna
   * de «Últimos movimientos»): «Ventas del mar 06/10». Solo donde el largo no
   * entra en un renglón.
   */
  titleShort?: string
  /** La segunda línea: qué tipo de cosa fue. */
  sub: string
  icon: ActivityIcon
  /** `neutral`: plata que se movió entre dos cajas (ni entró ni salió del bar). */
  direction: 'in' | 'out' | 'neutral'
  /** En positivo. */
  cents: number
  /** `/comprobantes/{id}`, después de `/<bar>/administracion`; `null` si no tiene comprobante. */
  path: string | null
  treasuryId: string | null
  treasuryName: string | null
  /** El saldo de la caja después de este movimiento (solo sirve en la ficha de UNA caja). */
  balanceCents: number
}

/** Lo que se lee de una fila del subdiario de disponibilidades (`acc_report_subledger`). */
type SubledgerLike = {
  rowKind: 'opening' | 'line'
  documentId: string | null
  entryId: string | null
  date: string | null
  values: Readonly<Record<string, unknown>>
}

/**
 * Una fila del subdiario (todas las cajas juntas) como movimiento. `null` para
 * la fila «Saldo anterior» y para una línea sin fecha: no son movimientos.
 */
export function movementFromSubledger(row: SubledgerLike, index: number): ActivityMovement | null {
  if (row.rowKind !== 'line' || row.date === null) return null
  const text = (key: string): string | null => {
    const value = row.values[key]
    return typeof value === 'string' && value !== '' ? value : null
  }
  const amount = (key: string): number => {
    const value = row.values[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  return {
    key: `${row.entryId ?? 'linea'}-${index}`,
    date: row.date,
    documentId: row.documentId,
    documentKind: text('document_kind'),
    documentLabel: text('document_label'),
    description: text('description'),
    memo: text('memo'),
    inCents: amount('inflow_cents'),
    outCents: amount('outflow_cents'),
    balanceCents: amount('balance_cents'),
    treasuryId: text('treasury_id'),
    treasuryName: text('treasury_name'),
  }
}

/** Una fila de «Movimientos de una caja» (`getTreasuryMovements`) como movimiento. */
export function movementFromTreasuryRow(
  row: {
    rowKind: 'opening' | 'line'
    entryId: string | null
    entryDate: string | null
    documentId: string | null
    documentKind: string | null
    documentLabel: string | null
    description: string | null
    memo: string | null
    inCents: number
    outCents: number
    balanceCents: number
  },
  index: number,
  treasury: { id: string; name: string },
): ActivityMovement | null {
  if (row.rowKind !== 'line' || row.entryDate === null) return null
  return {
    key: `${row.entryId ?? 'linea'}-${index}`,
    date: row.entryDate,
    documentId: row.documentId,
    documentKind: row.documentKind,
    documentLabel: row.documentLabel,
    description: row.description,
    memo: row.memo,
    inCents: row.inCents,
    outCents: row.outCents,
    balanceCents: row.balanceCents,
    treasuryId: treasury.id,
    treasuryName: treasury.name,
  }
}

const SEP = ' · '

function parts(description: string | null): string[] {
  return (description ?? '')
    .split(SEP)
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

/** Los motivos de «Otra entrada o salida» que el motor escribe adelante. */
const MOTIVE_TITLES: Readonly<Record<string, string>> = {
  'Retiro de un socio': 'Retiro de un socio',
  'Aporte de un socio': 'Aporte de un socio',
  'Préstamo recibido': 'Préstamo recibido',
  'Seña recibida': 'Seña de un cliente',
}

function countTitle(kind: TreasuryKind | null, entered: boolean, cents: number): string {
  const amount = formatCentsShort(cents)
  if (kind === 'cash') return `${entered ? 'Sobraron' : 'Faltaron'} ${amount} al contar`
  if (kind === 'credit_card') {
    // En la tarjeta, lo que «entra» (Debe) baja la deuda.
    return `Debías ${amount} ${entered ? 'menos' : 'más'} que en el sistema`
  }
  return `Había ${amount} ${entered ? 'más' : 'menos'} que en el sistema`
}

/**
 * Un movimiento, en palabras. `view`: `all` es la portada (todas las cajas:
 * un pasaje se titula «Caja → Banco Nación»); `one` es la ficha de una caja
 * (ahí el pasaje dice de dónde vino o a dónde fue: «A Banco Nación»).
 * `kindOf` dice de qué tipo es la caja del movimiento (un conteo se cuenta
 * distinto en efectivo que en un banco).
 */
export function activityFromMovement(
  m: ActivityMovement,
  opts: {
    view: 'all' | 'one'
    kindOf?: (treasuryId: string | null) => TreasuryKind | null
  } = { view: 'all' },
): ActivityRow {
  const entered = m.inCents > 0 && m.inCents >= m.outCents
  const cents = Math.abs(entered ? m.inCents : m.outCents)
  const description = (m.description ?? '').trim()
  const label = (m.documentLabel ?? '').trim()
  const p = parts(description)
  const head = p[0] ?? ''
  const row = (
    title: string,
    sub: string,
    icon: ActivityIcon,
    direction: ActivityRow['direction'] = entered ? 'in' : 'out',
  ): ActivityRow => ({
    key: m.key,
    date: m.date,
    title,
    sub,
    icon,
    direction,
    cents,
    path: m.documentId ? `/comprobantes/${m.documentId}` : null,
    treasuryId: m.treasuryId,
    treasuryName: m.treasuryName,
    balanceCents: m.balanceCents,
  })
  /** Lo que no se reconoce va tal cual, con la etiqueta del comprobante debajo. */
  const raw = (icon: ActivityIcon): ActivityRow =>
    row(
      description || label || 'Movimiento',
      label && label !== description ? label : 'Movimiento',
      icon,
    )

  switch (m.documentKind) {
    case 'sales_close': {
      const match = /^Cierre del día (\S+) (\d{2})\/(\d{2})\/\d{4}$/.exec(description)
      if (!match) return raw('sale')
      const memo = (m.memo ?? '').trim()
      const weekday = (WEEKDAY_NAMES as readonly string[]).indexOf(match[1] ?? '')
      const short = weekday >= 0 ? WEEKDAY_NAMES_SHORT[weekday] : undefined
      return {
        ...row(
          `Ventas del ${match[1]} ${match[2]}/${match[3]}`,
          memo ? `Cierre del día${SEP}${memo}` : 'Cierre del día',
          'sale',
        ),
        ...(short ? { titleShort: `Ventas del ${short} ${match[2]}/${match[3]}` } : {}),
      }
    }
    case 'expense': {
      if (head !== 'Gasto' || p.length < 2) return raw('expense')
      return row(p.slice(1).join(SEP), 'Gasto', 'expense')
    }
    case 'payment': {
      if (head !== 'Pago' || p.length < 2) return raw('payment')
      const rest = p.slice(2).join(SEP)
      return row(p[1] ?? '', rest ? `Pago${SEP}${rest}` : 'Pago', 'payment')
    }
    case 'collection': {
      const prefix = 'Ajuste de saldo de '
      if (head.startsWith(prefix)) {
        return row(
          'Entró lo que estaba en camino',
          `Conteo de ${head.slice(prefix.length)}`,
          'count',
        )
      }
      if (head !== 'Cobro' || p.length < 2) return raw('collection')
      return row(p.slice(1).join(SEP), entered ? 'Te entró' : 'Devolución', 'collection')
    }
    case 'transfer': {
      const sub = 'Plata movida entre cajas'
      const memo = (m.memo ?? '').trim()
      if (head !== 'Movimiento entre cuentas') {
        // Con descripción propia («Cambio para la caja»), esa.
        return row(description || memo || sub, sub, 'transfer')
      }
      if (opts.view === 'one') return row(memo || p[1] || sub, sub, 'transfer')
      return row(p[1] ?? sub, sub, 'transfer')
    }
    case 'bank_expense':
      return row('Gastos del banco', 'Comisiones e impuestos', 'bank')
    case 'cash_movement': {
      if (head === 'Otro ingreso' || head === 'Otro egreso') {
        if (p.length < 2) return raw('other')
        return row(p[1] ?? '', head === 'Otro ingreso' ? 'Otra entrada' : 'Otra salida', 'other')
      }
      const yields = /^Rendimiento de (.+)$/.exec(head)
      const title = yields ? `Rindió ${yields[1]}` : MOTIVE_TITLES[head]
      if (!title) return raw('other')
      const who = p[1] ?? ''
      const icon: ActivityIcon = head.includes('socio') ? 'partner' : 'other'
      return row(title, who || (entered ? 'Otra entrada' : 'Otra salida'), icon)
    }
    case 'treasury_adjustment': {
      if (head !== 'Ajuste de saldo' || cents === 0) return raw('count')
      const kind = opts.kindOf?.(m.treasuryId) ?? null
      return row(countTitle(kind, entered, cents), 'Conteo de caja', 'count')
    }
    case 'opening':
      return row('Lo que había al arrancar', 'Saldos iniciales', 'opening')
    case 'reversal': {
      const prefix = 'Anulación de '
      if (!description.startsWith(prefix)) return raw('reversal')
      return row(`Se anuló: ${description.slice(prefix.length)}`, 'Anulación', 'reversal')
    }
    default:
      return raw('other')
  }
}

/**
 * Un pasaje entre cajas llega como DOS líneas (una por caja) del mismo
 * comprobante: en la portada, donde se ven todas las cajas juntas, se cuenta
 * una sola vez («Caja → Banco Nación · ↔ $ 200.000»). El resto queda igual y
 * en el mismo orden. Si del pasaje llegó una sola línea (la otra caja es una
 * tarjeta de la empresa, que la portada no trae), se deja como vino: para las
 * cajas, esa plata sí salió o entró.
 */
export function mergeTransfers(rows: readonly ActivityRow[]): ActivityRow[] {
  const byDocument = new Map<string, ActivityRow[]>()
  for (const row of rows) {
    if (row.icon !== 'transfer' || row.path === null) continue
    const list = byDocument.get(row.path) ?? []
    list.push(row)
    byDocument.set(row.path, list)
  }
  const seen = new Set<string>()
  const out: ActivityRow[] = []
  for (const row of rows) {
    const pair = row.icon === 'transfer' && row.path !== null ? byDocument.get(row.path) : undefined
    if (!pair || pair.length < 2) {
      out.push(row)
      continue
    }
    if (seen.has(row.path ?? '')) continue
    seen.add(row.path ?? '')
    out.push({
      ...row,
      key: `pase-${row.path}`,
      direction: 'neutral',
      // Es de las dos cajas: no lleva el punto de color de ninguna.
      treasuryId: null,
      treasuryName: null,
    })
  }
  return out
}

/**
 * «↑ $ 120.013» · «↓ $ 12.000» · «↔ $ 200.000»: la dirección la dice la flecha
 * (no depende del color) y con eso alcanza: flecha y signo decían lo mismo. Es
 * la misma forma que el título del día («↑ entró $ 120.013»).
 *
 * Lo que había al arrancar no entró ni salió: va el importe solo.
 */
export function activityAmountText(
  row: Pick<ActivityRow, 'direction' | 'cents'> & { icon?: ActivityIcon },
): string {
  const amount = formatCentsShort(row.cents)
  if (row.icon === 'opening') return amount
  if (row.direction === 'neutral') return `↔ ${amount}`
  return row.direction === 'in' ? `↑ ${amount}` : `↓ ${amount}`
}

/** Lo mismo para lectores: «entraron $ 120.013», «salieron $ 12.000», «se movieron $ 200.000». */
export function activityAmountLabel(
  row: Pick<ActivityRow, 'direction' | 'cents'> & { icon?: ActivityIcon },
): string {
  const amount = formatCentsShort(row.cents)
  if (row.icon === 'opening') return `había ${amount}`
  if (row.direction === 'neutral') return `se movieron ${amount}`
  return row.direction === 'in' ? `entraron ${amount}` : `salieron ${amount}`
}

/**
 * ¿Este renglón cuenta como plata que entró o que salió? Lo que había al
 * arrancar no: sube el saldo de la caja, pero no es plata que entró. Es el
 * mismo criterio del dibujo de «Lo que entró y lo que salió» y de la oración
 * de la tarjeta («Arrancó con $ X. … entraron $ Y»).
 */
export function countsAsFlow(row: Pick<ActivityRow, 'direction' | 'icon'>): boolean {
  return row.icon !== 'opening' && row.direction !== 'neutral'
}

export type ActivityDay = {
  /** `yyyy-MM-dd`. */
  date: string
  /** «Martes 13/10 · hoy». */
  title: string
  rows: ActivityRow[]
  /**
   * Lo que entró y salió ese día. No suman los pasajes entre cajas ya unidos ni
   * lo que había al arrancar (`countsAsFlow`).
   */
  inCents: number
  outCents: number
  /** El saldo después del último movimiento del día (para la ficha de una caja). */
  closingCents: number
}

/** «Martes 13/10 · hoy» · «Lunes 12/10 · ayer» · «Viernes 09/10». */
export function dayTitle(date: string, today: string): string {
  if (!isRealIsoDay(date)) return date
  const name = `${capitalizeFirst(weekdayName(date))} ${formatDayMonth(date)}`
  const days = daysBetween(date, today)
  return days === 0 ? `${name}${SEP}hoy` : days === 1 ? `${name}${SEP}ayer` : name
}

/**
 * Los movimientos agrupados por día. `rows` llega como los devuelve la base
 * (del más viejo al más nuevo); con `newestFirst` salen el día más nuevo arriba
 * y, dentro del día, lo último primero. El saldo de cierre del día es el del
 * último movimiento de ese día en el orden de la base.
 */
export function groupByDay(
  rows: readonly ActivityRow[],
  opts: { today: string; newestFirst?: boolean },
): ActivityDay[] {
  const days = new Map<string, ActivityDay>()
  for (const row of rows) {
    let day = days.get(row.date)
    if (!day) {
      day = {
        date: row.date,
        title: dayTitle(row.date, opts.today),
        rows: [],
        inCents: 0,
        outCents: 0,
        closingCents: row.balanceCents,
      }
      days.set(row.date, day)
    }
    day.rows.push(row)
    if (countsAsFlow(row)) {
      if (row.direction === 'in') day.inCents += row.cents
      else day.outCents += row.cents
    }
    day.closingCents = row.balanceCents
  }
  const list = [...days.values()]
  if (!opts.newestFirst) return list
  return list.reverse().map((day) => ({ ...day, rows: [...day.rows].reverse() }))
}
