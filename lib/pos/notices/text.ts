/**
 * Cómo se dice un aviso de cocina — PURO y testeado (`tests/lib/pos-notices.test.ts`).
 *
 * El mismo texto va en la notificación push y en el aviso dentro de la app. Dice lo que el mozo
 * necesita para moverse sin abrir nada: qué mesa, de dónde se retira y qué es.
 */
import { stationIcon } from '@/lib/pos/kitchen/station-kind'
import { countedName } from '@/lib/pos/order/tickets'
import type { NoticeItem, PosNotice } from './types'

export type NoticeText = {
  title: string
  body: string
  /** Un aviso nuevo de la misma mesa y estación reemplaza al anterior en vez de apilarse. */
  tag: string
  /** Hay que ir a buscar algo: suena y vibra fuerte. */
  strong: boolean
  /** Cómo vibra el teléfono (ms prendido, apagado, prendido…). */
  vibrate: number[]
}

/** Cuántos productos se nombran antes de resumir el resto. */
const MAX_ITEMS = 4

/** «4 Mojito · 2 Stella · y 3 más». */
export function itemsLabel(items: readonly NoticeItem[], max = MAX_ITEMS): string {
  const shown = items.slice(0, max).map((item) => countedName(item.q, item.n))
  const rest = items.slice(max).reduce((sum, item) => sum + item.q, 0)
  if (rest > 0) shown.push(`y ${rest} más`)
  return shown.join(' · ')
}

/** «Mesa 12», el nombre si no hay mesa, o «Tu pedido». */
export function noticeWhere(notice: Pick<PosNotice, 'table_label' | 'alias'>): string {
  if (notice.table_label) return `Mesa ${notice.table_label}`
  if (notice.alias) return notice.alias
  return 'Tu pedido'
}

const VIBRATE = {
  ready: [240, 90, 240, 90, 460],
  preparing: [90],
  not_ready: [70, 60, 70],
} as const

export function noticeText(notice: PosNotice): NoticeText {
  const where = noticeWhere(notice)
  const station = notice.station_name ?? 'Cocina'
  const icon = stationIcon({
    name: station,
    kind: notice.station_kind,
    icon: notice.station_icon,
  })
  const items = itemsLabel(notice.items)
  const tag = `pos:${notice.session_id}:${notice.station_id ?? 'sin-estacion'}`

  if (notice.kind === 'ready') {
    return {
      title: `${where} · para retirar`,
      body: items ? `${icon} ${station}: ${items}` : `${icon} Ya está en ${station}.`,
      tag,
      strong: true,
      vibrate: [...VIBRATE.ready],
    }
  }
  if (notice.kind === 'preparing') {
    return {
      title: `${where} · en preparación`,
      body: items ? `${icon} ${station} empezó: ${items}` : `${icon} ${station} empezó tu pedido.`,
      tag,
      strong: false,
      vibrate: [...VIBRATE.preparing],
    }
  }
  return {
    title: `${where} · todavía no`,
    body: `${icon} ${station} lo volvió atrás: te avisamos cuando salga.`,
    tag,
    strong: false,
    vibrate: [...VIBRATE.not_ready],
  }
}
