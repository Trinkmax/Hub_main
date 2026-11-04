'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { renderTicketImage, type TicketImageInput } from '@/lib/ticketing/ticket-image'
import type { PublicOrder } from '@/lib/ticketing/types'

export type TicketImageHandle = {
  /** La imagen ya está hecha: guardar es instantáneo. */
  ready: boolean
  saving: boolean
  /** No se pudo armar la imagen: la pantalla lo dice y ofrece la salida. */
  failed: boolean
  /** Deja la imagen lista y la devuelve. */
  get: () => Promise<Blob>
  setSaving: (saving: boolean) => void
  setFailed: (failed: boolean) => void
}

/**
 * La imagen de la entrada se prepara apenas se ve la entrada, en un momento
 * libre: compartir un archivo en iPhone tiene que salir del toque mismo, y si
 * antes hay que esperar a dibujar, Safari lo rechaza.
 */
export function useTicketImage(input: TicketImageInput | null): TicketImageHandle {
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const inputRef = useRef(input)
  inputRef.current = input
  const blobRef = useRef<Promise<Blob> | null>(null)
  const hasInput = input !== null

  const get = useCallback(() => {
    if (!blobRef.current) {
      const current = inputRef.current
      if (!current) return Promise.reject(new Error('sin entrada'))
      blobRef.current = renderTicketImage(current)
      blobRef.current.catch(() => {
        blobRef.current = null
      })
    }
    return blobRef.current
  }, [])

  useEffect(() => {
    if (!hasInput) return
    const run = () => {
      get()
        .then(() => setReady(true))
        .catch(() => {
          // Se reintenta al tocar «Guardar».
        })
    }
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 2500 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = setTimeout(run, 800)
    return () => clearTimeout(timer)
  }, [hasInput, get])

  return { ready, saving, failed, get, setSaving, setFailed }
}

function fileName(order: PublicOrder): string {
  const title = order.title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `entrada-${title}-${order.shortCode.toLowerCase()}.png`
}

function download(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 2000)
}

/**
 * En el celular, el menú de compartir (ahí está «Guardar imagen» y WhatsApp); en
 * la compu, o si el navegador no puede, se descarga.
 */
export async function saveTicketImage(image: TicketImageHandle, order: PublicOrder) {
  image.setSaving(true)
  image.setFailed(false)
  try {
    const blob = await image.get()
    const name = fileName(order)
    const file = new File([blob], name, { type: 'image/png' })
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (touch && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Entrada · ${order.title}` })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        // No dejó compartir (Safari, si se pasó el tiempo del toque): se descarga.
      }
    }
    download(blob, name)
  } catch (error) {
    console.error('[ticketing.saveTicketImage]', {
      error: error instanceof Error ? error.message : 'unknown',
    })
    image.setFailed(true)
  } finally {
    image.setSaving(false)
  }
}
