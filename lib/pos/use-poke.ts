'use client'

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import { createClient, realtimeAuthReady, syncRealtimeAuth } from '@/lib/supabase/browser'

/** Qué se movió: el salón, la cocina, la carta, la plata (un cobro, la caja) o un pedido de permiso. */
export type PokeWhat = 'floor' | 'kitchen' | 'menu' | 'cash' | 'approvals'
export type LiveStatus = 'connecting' | 'live' | 'offline'

/**
 * Cada cuánto conviene releer «por las dudas». Con el canal en vivo los avisos llegan solos y alcanza
 * con una pasada cada tanto; sin canal (conectando o caído) la lectura es lo único que hay, y un salón
 * que tarda 40 segundos en cambiar de color obliga a recargar a mano.
 */
export function safetyNetMs(status: LiveStatus): number {
  return status === 'live' ? 20_000 : 6_000
}

type Listener = (what: PokeWhat, sessionId: string | null) => void
type StatusListener = (status: LiveStatus) => void
/** Un aviso de cocina para alguien del equipo: llega con sus datos (ver `lib/pos/notices/types.ts`). */
type NoticeListener = (payload: unknown) => void

/**
 * Un canal por sucursal, compartido por todo lo que escucha en la página.
 *
 * El cliente de Supabase devuelve EL MISMO canal si se le pide dos veces el mismo nombre: dos pantallas
 * (o dos piezas de una pantalla) que se suscribían cada una por su lado terminaban compartiéndolo sin
 * saberlo, y la primera que se iba se lo cortaba a la otra. Acá se cuenta quién escucha y el canal se
 * suelta recién cuando no queda nadie, un momento después: pasar del mapa a una mesa (misma sucursal)
 * lo deja vivo en vez de cerrarlo y abrirlo de nuevo.
 */
type Shared = {
  supabase: SupabaseClient
  /** `null` mientras el socket todavía no tiene la sesión de quien mira (ver `join`). */
  channel: RealtimeChannel | null
  /** Se soltó antes de llegar a entrar: cuando la sesión esté lista, ya no hay que abrir nada. */
  gone: boolean
  listeners: Set<Listener>
  statusListeners: Set<StatusListener>
  noticeListeners: Set<NoticeListener>
  status: LiveStatus
  /** Estuvo caído: al volver, a todos les toca releer (lo que pasó en el medio no se reenvía). */
  wasDown: boolean
  release: ReturnType<typeof setTimeout> | null
}

const shared = new Map<string, Shared>()
/** Cuánto se espera, sin nadie escuchando, antes de soltar el canal. */
const RELEASE_AFTER_MS = 1500

/**
 * Le pasa al socket la sesión de AHORA. No alcanza con `realtimeAuthReady()` (se resuelve una sola vez
 * por página): si la persona inició sesión después, sin recargar, el socket seguiría como anónimo y el
 * canal privado la dejaría afuera. Sin sesión, Realtime contesta que no y la pantalla lo muestra como
 * «sin conexión».
 *
 * Nunca con un token escrito a mano: ese queda fijo, vence a la hora y deja el canal caído hasta
 * recargar (ver `syncRealtimeAuth`).
 */
async function authorizeSocket(): Promise<void> {
  await realtimeAuthReady()
  await syncRealtimeAuth()
}

function setShared(entry: Shared, status: LiveStatus) {
  entry.status = status
  for (const notify of [...entry.statusListeners]) notify(status)
}

function join(
  branchId: string,
  listener: Listener | null,
  onStatus: StatusListener,
  onNotice: NoticeListener | null = null,
): () => void {
  let entry = shared.get(branchId)
  if (!entry) {
    const supabase = createClient() as unknown as SupabaseClient
    const created: Shared = {
      supabase,
      channel: null,
      gone: false,
      listeners: new Set(),
      statusListeners: new Set(),
      noticeListeners: new Set(),
      status: 'connecting',
      wasDown: false,
      release: null,
    }
    // El canal es PRIVADO: Realtime deja entrar solo a quien tiene un rol en el bar de esa sucursal (la
    // política `pos_live_listen` de `realtime.messages`), y lo decide con la sesión que tenga el socket
    // en el momento de entrar. Por eso primero se le pasa la sesión de quien mira y recién después se
    // une: entrar un instante antes, todavía como anónimo, sería quedarse afuera.
    void authorizeSocket().then(() => {
      if (created.gone) return
      const channel = supabase.channel(`pos:${branchId}`, { config: { private: true } })
      created.channel = channel
      channel
        .on('broadcast', { event: 'poke' }, (message) => {
          const payload = (message.payload ?? {}) as {
            what?: PokeWhat
            session_id?: string | null
          }
          for (const each of [...created.listeners]) {
            each(payload.what ?? 'floor', payload.session_id ?? null)
          }
        })
        // Los avisos de cocina al mozo viajan por el mismo canal, con sus datos: cada dispositivo se
        // queda con los suyos (`useKitchenNotices`).
        .on('broadcast', { event: 'notice' }, (message) => {
          for (const each of [...created.noticeListeners]) each(message.payload)
        })
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') {
            const recovered = created.wasDown
            created.wasDown = false
            setShared(created, 'live')
            if (recovered) for (const each of [...created.listeners]) each('floor', null)
          } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
            created.wasDown = true
            setShared(created, 'offline')
            // La librería reintenta sola; que el reintento entre con la sesión de ahora (si lo que
            // lo tiró fue un token vencido, con el de antes rebotaría para siempre).
            if (state !== 'CLOSED' && !created.gone) void syncRealtimeAuth()
          }
        })
    })
    shared.set(branchId, created)
    entry = created
  }

  const current = entry
  if (current.release !== null) {
    clearTimeout(current.release)
    current.release = null
  }
  if (listener) current.listeners.add(listener)
  if (onNotice) current.noticeListeners.add(onNotice)
  current.statusListeners.add(onStatus)
  onStatus(current.status)

  // Quién escucha: los que esperan avisos de «algo cambió», los de avisos al mozo, o los dos.
  const users = () => current.statusListeners.size

  return () => {
    if (listener) current.listeners.delete(listener)
    if (onNotice) current.noticeListeners.delete(onNotice)
    current.statusListeners.delete(onStatus)
    if (users() > 0 || current.release !== null) return
    current.release = setTimeout(() => {
      current.release = null
      if (users() > 0) return
      if (shared.get(branchId) === current) shared.delete(branchId)
      current.gone = true
      if (current.channel) void current.supabase.removeChannel(current.channel)
    }, RELEASE_AFTER_MS)
  }
}

/**
 * Avisos en vivo de una sucursal. La base manda un «algo cambió» sin datos (canal privado
 * `pos:<sucursal>`: solo lo escucha el equipo de ese bar) cada vez que una mesa, una tanda o la carta se
 * mueven, y cada pantalla vuelve a leer lo suyo.
 *
 * Devuelve el estado real del canal para poder decirlo en pantalla: si se corta, se nota. Al volver,
 * llama a `onPoke` una vez (lo que pasó mientras estuvo caído no se reenvía).
 */
export function usePosPoke(
  branchId: string | null,
  onPoke: (what: PokeWhat, sessionId: string | null) => void,
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const handler = useRef(onPoke)

  useEffect(() => {
    handler.current = onPoke
  }, [onPoke])

  useEffect(() => {
    if (!branchId) return
    // Sin red, el celular lo sabe antes que el canal: manda lo que diga el navegador.
    let online = typeof navigator === 'undefined' || navigator.onLine !== false
    let channelStatus: LiveStatus = 'connecting'
    const show = () => setStatus(online ? channelStatus : 'offline')

    const leave = join(
      branchId,
      (what, sessionId) => handler.current(what, sessionId),
      (next) => {
        channelStatus = next
        show()
      },
    )

    const onOffline = () => {
      online = false
      show()
    }
    const onOnline = () => {
      online = true
      show()
      // Si el canal nunca se enteró del corte no va a avisar que volvió: esta pantalla relee igual.
      if (channelStatus === 'live') handler.current('floor', null)
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    show()

    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      leave()
    }
  }, [branchId])

  return status
}

/**
 * Los avisos de cocina al mozo, en vivo. La base los manda por el canal de la sucursal (el mismo de
 * `usePosPoke`, que se comparte: no abre otra conexión) cuando una estación empieza o termina lo de una
 * mesa. Llegan a todos los dispositivos de la sucursal; `onNotice` recibe el aviso tal cual y decide
 * si es para quien mira.
 *
 * `onStatus` avisa cuando el canal vuelve después de un corte: lo que pasó en el medio no se reenvía,
 * así que ahí conviene leer la bandeja.
 */
export function useKitchenNotices(
  branchIds: readonly string[],
  onNotice: (payload: unknown) => void,
  onBack?: () => void,
): void {
  const handler = useRef(onNotice)
  const back = useRef(onBack)
  useEffect(() => {
    handler.current = onNotice
    back.current = onBack
  }, [onNotice, onBack])

  const key = branchIds.join(',')
  useEffect(() => {
    if (key === '') return
    const leaves = key.split(',').map((branchId) => {
      let wasDown = false
      return join(
        branchId,
        null,
        (status) => {
          if (status === 'offline') wasDown = true
          else if (status === 'live' && wasDown) {
            wasDown = false
            back.current?.()
          }
        },
        (payload) => handler.current(payload),
      )
    })
    return () => {
      for (const leave of leaves) leave()
    }
  }, [key])
}
