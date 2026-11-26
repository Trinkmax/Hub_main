/**
 * De qué avisos de cocina quiere enterarse alguien en ESTE dispositivo — PURO y testeado.
 *
 * Se guarda en el teléfono (un celular silencioso en la caja no es lo mismo que el del mozo) y la parte
 * de los pasos viaja también a la base, para que la notificación push respete lo mismo.
 */
import type { NoticeEvent, NoticeKind } from './types'
import { noticeEvent } from './types'

export type NoticePrefs = {
  /** Cuando algo está para retirar (y su «todavía no», si se arrepienten). */
  ready: boolean
  /** Cuando una estación empieza a prepararlo. */
  preparing: boolean
  /** Sonido y vibración con la app abierta. */
  sound: boolean
}

export const DEFAULT_NOTICE_PREFS: NoticePrefs = { ready: true, preparing: true, sound: true }
export const NOTICE_PREFS_KEY = 'hub:pos:notices'

export function parseNoticePrefs(raw: string | null | undefined): NoticePrefs {
  if (!raw) return DEFAULT_NOTICE_PREFS
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return DEFAULT_NOTICE_PREFS
    const read = (key: keyof NoticePrefs) => {
      const field = (value as Record<string, unknown>)[key]
      return typeof field === 'boolean' ? field : DEFAULT_NOTICE_PREFS[key]
    }
    return { ready: read('ready'), preparing: read('preparing'), sound: read('sound') }
  } catch {
    return DEFAULT_NOTICE_PREFS
  }
}

/** Los pasos que se le piden a la base para este dispositivo. */
export function prefEvents(prefs: NoticePrefs): NoticeEvent[] {
  const events: NoticeEvent[] = []
  if (prefs.ready) events.push('ready')
  if (prefs.preparing) events.push('preparing')
  return events
}

/** ¿Este aviso se muestra acá? */
export function wantsNotice(prefs: NoticePrefs, kind: NoticeKind): boolean {
  return prefs[noticeEvent(kind)]
}
