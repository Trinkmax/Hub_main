/**
 * Un aviso de cocina para quien atiende una mesa (tabla `pos_notices`, migración
 * `pos_estaciones_mozos_avisos`). Lo escribe la base cuando una estación mueve lo de una mesa, y sale
 * por dos caminos: el canal en vivo de la sucursal (la app abierta) y una notificación push.
 */
export type NoticeKind = 'preparing' | 'ready' | 'not_ready'

/** Un producto del aviso: nombre y cuántas unidades. */
export type NoticeItem = { n: string; q: number }

export type PosNotice = {
  id: string
  /** A quién le toca: cada dispositivo de la sucursal recibe el aviso y se queda solo con los suyos. */
  user_id: string
  session_id: string
  kind: NoticeKind
  station_id: string | null
  station_name: string | null
  station_kind: string | null
  station_icon: string | null
  table_label: string | null
  alias: string | null
  items: NoticeItem[]
  units: number
  created_at: string
}

/** Los pasos de los que alguien quiere enterarse en un dispositivo. */
export type NoticeEvent = 'ready' | 'preparing'
export const NOTICE_EVENTS: readonly NoticeEvent[] = ['ready', 'preparing']

/** A qué preferencia responde cada aviso: «todavía no» corrige un «listo», así que va con él. */
export function noticeEvent(kind: NoticeKind): NoticeEvent {
  return kind === 'preparing' ? 'preparing' : 'ready'
}

function isItem(value: unknown): value is NoticeItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as NoticeItem).n === 'string' &&
    typeof (value as NoticeItem).q === 'number'
  )
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

/**
 * Lee un aviso que llega de afuera (el canal en vivo, una fila de la tabla). Lo que no tiene la forma
 * esperada se descarta: un aviso a medias no hace sonar nada.
 */
export function parseNotice(raw: unknown): PosNotice | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  const id = text(row.id)
  const userId = text(row.user_id)
  const sessionId = text(row.session_id)
  const kind = row.kind
  if (!id || !userId || !sessionId) return null
  if (kind !== 'preparing' && kind !== 'ready' && kind !== 'not_ready') return null
  const items = Array.isArray(row.items) ? row.items.filter(isItem) : []
  return {
    id,
    user_id: userId,
    session_id: sessionId,
    kind,
    station_id: text(row.station_id),
    station_name: text(row.station_name),
    station_kind: text(row.station_kind),
    station_icon: text(row.station_icon),
    table_label: text(row.table_label),
    alias: text(row.alias),
    items,
    units: typeof row.units === 'number' && Number.isFinite(row.units) ? row.units : 0,
    created_at: text(row.created_at) ?? new Date(0).toISOString(),
  }
}
