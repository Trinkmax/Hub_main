import {
  addDays,
  formatDayLabel,
  formatDayMonth,
  isoDayInCordoba,
  timeInCordoba,
  weekdayName,
} from '@/lib/dates'

/**
 * La historia contable agrupada por día: «Hoy · martes 13/10», «Ayer · lunes
 * 12/10», «Vie 09/10». Puro (lo prueban los tests).
 *
 * El día es el del BAR (Córdoba), no el del servidor: algo cargado a las 23:50
 * del 12 es del 12, aunque en UTC ya sea 13.
 */

export type HistoryDayGroup<T> = {
  /** `yyyy-MM-dd` (día de Córdoba); vacío si la fecha no se pudo leer. */
  day: string
  /** El encabezado del grupo. */
  label: string
  rows: T[]
}

/** «Hoy · martes 13/10» · «Ayer · lunes 12/10» · «Vie 09/10» (con el año si no es el de hoy). */
export function historyDayLabel(day: string, today: string): string {
  if (!day) return 'Sin fecha'
  if (day === today) return `Hoy · ${weekdayName(day)} ${formatDayMonth(day)}`
  if (day === addDays(today, -1)) return `Ayer · ${weekdayName(day)} ${formatDayMonth(day)}`
  const label = formatDayLabel(day)
  return day.slice(0, 4) === today.slice(0, 4) ? label : `${label}/${day.slice(0, 4)}`
}

/** Los renglones en grupos por día, conservando el orden en que llegan (el más nuevo primero). */
export function groupHistoryByDay<T extends { createdAt: string }>(
  rows: readonly T[],
  today: string,
): HistoryDayGroup<T>[] {
  const groups: HistoryDayGroup<T>[] = []
  for (const row of rows) {
    const day = isoDayInCordoba(row.createdAt) ?? ''
    const last = groups.at(-1)
    if (last && last.day === day) last.rows.push(row)
    else groups.push({ day, label: historyDayLabel(day, today), rows: [row] })
  }
  return groups
}

/** Un renglón de la historia y cuántas veces seguidas pasó lo mismo. */
export type HistoryRun<T> = { row: T; count: number }

type RunnableRow = {
  createdAt: string
  actorName: string
  text: string
  documentId: string | null
  amountCents: number | null
  detail: string | null
}

/**
 * Lo mismo, seguido, en un solo renglón: la misma persona hizo lo mismo en el mismo minuto
 * («cambió un gasto fijo» treinta veces, al cargar la planilla) y se lee «· 30 veces». Lo que
 * lleva a un comprobante o tiene importe nunca se junta: cada uno es un papel distinto.
 */
export function collapseHistoryRuns<T extends RunnableRow>(rows: readonly T[]): HistoryRun<T>[] {
  const out: HistoryRun<T>[] = []
  let lastKey: string | null = null
  for (const row of rows) {
    const key =
      row.documentId === null && row.amountCents === null
        ? [row.actorName, historyText(row.text), historyTime(row.createdAt), row.detail ?? ''].join(
            '|',
          )
        : null
    const last = out.at(-1)
    if (key !== null && key === lastKey && last) last.count += 1
    else out.push({ row, count: 1 })
    lastKey = key
  }
  return out
}

/** «14:32»: dentro de un grupo el día ya está dicho en el encabezado. */
export function historyTime(createdAt: string): string {
  return timeInCordoba(createdAt) ?? ''
}

/** La inicial de quien lo hizo, para el círculo del renglón («F» de Franco). */
export function personInitial(name: string | null | undefined): string {
  const first = (name ?? '').trim().charAt(0)
  return first ? first.toUpperCase() : '·'
}

/**
 * Lo que la consulta de la historia todavía no sabe decir en criollo: para una
 * acción que no conoce devuelve su clave interna («acc_import.batch_done») y esa
 * clave llegaba tal cual a la pantalla. Acá se la traduce; si aparece una que
 * tampoco está en esta lista, va una frase honesta en vez de la clave.
 */
const RAW_ACTION_TEXT: Readonly<Record<string, string>> = {
  'acc_settings.saved': 'cambió los ajustes de Administración',
  'acc_import.batch_created': 'subió un archivo para importar',
  'acc_import.batch_done': 'terminó una importación',
  'acc_import.batch_cancelled': 'descartó una importación',
  'acc_import.rule_saved': 'guardó una regla de importación',
  'acc_import.rule_deleted': 'borró una regla de importación',
  'acc_mp.connected': 'conectó Mercado Pago',
  'acc_mp.connection_saved': 'guardó la conexión con Mercado Pago',
  'acc_mp.disconnected': 'desconectó Mercado Pago',
  'acc_mp.status_changed': 'cambió el estado de la conexión con Mercado Pago',
  'acc_arca.connection_saved': 'guardó la conexión con ARCA',
  'acc_arca.keypair_generated': 'generó la clave para pedir el certificado de ARCA',
  'acc_arca.certificate_saved': 'cargó el certificado de ARCA',
  'acc_arca.tested': 'probó la conexión con ARCA',
  'acc_arca.disconnected': 'desconectó ARCA',
  'acc_document.attachment_added': 'adjuntó un archivo a un comprobante',
  'acc_document.attachment_removed': 'quitó un adjunto de un comprobante',
  'acc_party.bulk_created': 'cargó varios proveedores o clientes de una vez',
  'acc_party.deleted': 'borró un proveedor o cliente',
  'acc_recurring.bulk_created': 'cargó varios gastos fijos de una vez',
  'acc_recurring.deleted': 'borró un gasto fijo',
  'acc_recurring.skipped': 'salteó un gasto fijo',
  'acc_sales_target.saved': 'cambió el objetivo de ventas',
  'acc_accounts.imported': 'importó el plan de cuentas',
  'acc_account.system_key_remapped': 'cambió qué cuenta usa el sistema',
}

/** Una clave interna de auditoría: «acc_algo.algo», sin espacios. */
const RAW_ACTION = /^acc_[a-z0-9_]+\.[a-z0-9_]+$/

/** El texto del renglón, sin claves internas a la vista. */
export function historyText(text: string): string {
  const raw = text.trim()
  if (!RAW_ACTION.test(raw)) return text
  return RAW_ACTION_TEXT[raw] ?? 'hizo un cambio en Administración'
}
