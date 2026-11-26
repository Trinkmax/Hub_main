'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_NOTICE_PREFS,
  NOTICE_PREFS_KEY,
  type NoticePrefs,
  parseNoticePrefs,
  prefEvents,
} from '@/lib/pos/notices/prefs'
import {
  enablePush,
  pushPublicKey,
  removePushSubscription,
  savePushSubscription,
} from '@/lib/push/actions'
import { currentPush, pushKeys, subscribePush, unsubscribePush } from '@/lib/push/client'

/**
 * Lo que comparten el aviso de «¿te aviso en el celular?» y la hoja «Tu cuenta»: las preferencias de
 * este dispositivo y prender o apagar las notificaciones push.
 */

const PREFS_EVENT = 'hub:notice-prefs'

export function readNoticePrefs(): NoticePrefs {
  try {
    return parseNoticePrefs(window.localStorage.getItem(NOTICE_PREFS_KEY))
  } catch {
    return DEFAULT_NOTICE_PREFS
  }
}

/** Las preferencias de este dispositivo, al día aunque se cambien desde otra pieza de la pantalla. */
export function useNoticePrefs(): [NoticePrefs, (next: NoticePrefs) => void] {
  const [prefs, setPrefs] = useState<NoticePrefs>(DEFAULT_NOTICE_PREFS)
  useEffect(() => {
    const sync = () => setPrefs(readNoticePrefs())
    sync()
    window.addEventListener(PREFS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(PREFS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  const save = useCallback((next: NoticePrefs) => {
    setPrefs(next)
    try {
      window.localStorage.setItem(NOTICE_PREFS_KEY, JSON.stringify(next))
    } catch {
      // sin almacenamiento (modo privado): vale para esta vez
    }
    window.dispatchEvent(new Event(PREFS_EVENT))
  }, [])
  return [prefs, save]
}

export type EnableResult = { ok: true } | { ok: false; message: string }

/** Pedir permiso y anotar este equipo. Tiene que venir de un toque (el navegador lo exige). */
export async function enableNotices(slug: string, prefs: NoticePrefs): Promise<EnableResult> {
  let key: Awaited<ReturnType<typeof pushPublicKey>>
  try {
    key = await pushPublicKey(slug)
  } catch {
    return { ok: false, message: 'No hay señal. Probá de nuevo cuando vuelva.' }
  }
  if (!key.ok) return key
  if (!key.data) {
    return { ok: false, message: 'Las notificaciones todavía no están prendidas en este bar.' }
  }
  const subscribed = await subscribePush(key.data)
  if (!subscribed.ok) {
    return {
      ok: false,
      message:
        subscribed.reason === 'denied'
          ? 'El celular tiene bloqueadas las notificaciones de esta app. Se habilitan desde los ajustes del navegador.'
          : subscribed.reason === 'unsupported'
            ? 'Este navegador no puede recibir notificaciones.'
            : 'No pude activar los avisos en este equipo. Probá de nuevo.',
    }
  }
  try {
    return await enablePush(slug, {
      ...subscribed.keys,
      userAgent: navigator.userAgent.slice(0, 300),
      events: prefEvents(prefs),
    })
  } catch {
    return { ok: false, message: 'No hay señal: los avisos no quedaron guardados.' }
  }
}

/** Apagar las notificaciones en este equipo (también al cerrar sesión: el teléfono cambia de manos). */
export async function disableNotices(slug: string): Promise<void> {
  const endpoint = await unsubscribePush()
  if (!endpoint) return
  try {
    await removePushSubscription(slug, endpoint)
  } catch {
    // Sin señal: el navegador ya no la tiene, y la base la da de baja sola cuando el envío rebote.
  }
}

/**
 * Si este navegador ya tenía permiso y suscripción, se la anota a quien entró ahora: un teléfono que
 * pasa de un mozo a otro deja de recibir los avisos del anterior. Con `prefs` además guarda de qué
 * pasos quiere enterarse.
 */
export async function syncNotices(slug: string, prefs?: NoticePrefs): Promise<boolean> {
  const subscription = await currentPush()
  const keys = subscription ? pushKeys(subscription) : null
  if (!keys) return false
  try {
    const saved = await savePushSubscription(slug, {
      ...keys,
      userAgent: navigator.userAgent.slice(0, 300),
      events: prefs ? prefEvents(prefs) : undefined,
    })
    return saved.ok
  } catch {
    return false
  }
}
