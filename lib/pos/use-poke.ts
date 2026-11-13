'use client'

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/browser'

/** Qué se movió: el salón, la cocina, la carta, la plata (un cobro, la caja) o un pedido de permiso. */
export type PokeWhat = 'floor' | 'kitchen' | 'menu' | 'cash' | 'approvals'
export type LiveStatus = 'connecting' | 'live' | 'offline'

type Listener = (what: PokeWhat, sessionId: string | null) => void
type StatusListener = (status: LiveStatus) => void

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
  channel: RealtimeChannel
  listeners: Set<Listener>
  statusListeners: Set<StatusListener>
  status: LiveStatus
  /** Estuvo caído: al volver, a todos les toca releer (lo que pasó en el medio no se reenvía). */
  wasDown: boolean
  release: ReturnType<typeof setTimeout> | null
}

const shared = new Map<string, Shared>()
/** Cuánto se espera, sin nadie escuchando, antes de soltar el canal. */
const RELEASE_AFTER_MS = 1500

function setShared(entry: Shared, status: LiveStatus) {
  entry.status = status
  for (const notify of [...entry.statusListeners]) notify(status)
}

function join(branchId: string, listener: Listener, onStatus: StatusListener): () => void {
  let entry = shared.get(branchId)
  if (!entry) {
    const supabase = createClient() as unknown as SupabaseClient
    const created: Shared = {
      supabase,
      channel: supabase.channel(`pos:${branchId}`),
      listeners: new Set(),
      statusListeners: new Set(),
      status: 'connecting',
      wasDown: false,
      release: null,
    }
    created.channel
      .on('broadcast', { event: 'poke' }, (message) => {
        const payload = (message.payload ?? {}) as { what?: PokeWhat; session_id?: string | null }
        for (const each of [...created.listeners]) {
          each(payload.what ?? 'floor', payload.session_id ?? null)
        }
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
        }
      })
    shared.set(branchId, created)
    entry = created
  }

  const current = entry
  if (current.release !== null) {
    clearTimeout(current.release)
    current.release = null
  }
  current.listeners.add(listener)
  current.statusListeners.add(onStatus)
  onStatus(current.status)

  return () => {
    current.listeners.delete(listener)
    current.statusListeners.delete(onStatus)
    if (current.listeners.size > 0 || current.release !== null) return
    current.release = setTimeout(() => {
      current.release = null
      if (current.listeners.size > 0) return
      if (shared.get(branchId) === current) shared.delete(branchId)
      void current.supabase.removeChannel(current.channel)
    }, RELEASE_AFTER_MS)
  }
}

/**
 * Avisos en vivo de una sucursal. La base manda un «algo cambió» sin datos (canal `pos:<sucursal>`)
 * cada vez que una mesa, una tanda o la carta se mueven, y cada pantalla vuelve a leer lo suyo.
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
