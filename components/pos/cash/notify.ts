'use client'

import { toast } from 'sonner'

/**
 * Dónde sale un aviso de la caja. Con el dedo (celular, tablet) va arriba: abajo están el cajón y
 * el botón que manda, y un aviso encima los taparía justo cuando hacen falta. Con mouse, donde
 * siempre.
 */
function place(): { position?: 'top-center' } {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
    ? { position: 'top-center' }
    : {}
}

/** Los avisos de la caja: una sola voz y un solo lugar. */
export const notify = {
  ok(message: string) {
    toast.success(message, place())
  },
  /** Lo que salió mal dice qué pasó y qué hacer: se queda más tiempo para poder leerlo. */
  error(message: string) {
    toast.error(message, { ...place(), duration: 9_000 })
  },
  info(message: string) {
    toast.message(message, place())
  },
  /** Al abrir una hoja o el arqueo: un aviso viejo no tiene que tapar lo que viene. */
  clear() {
    toast.dismiss()
  },
}
