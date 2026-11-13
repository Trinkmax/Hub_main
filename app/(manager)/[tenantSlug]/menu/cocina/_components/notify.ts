'use client'

import { toast } from 'sonner'

/** Lo que dura el «Deshacer» de un cambio (el mismo tiempo que en «Precios»). */
const UNDO_MS = 6_000

/**
 * Dónde sale el aviso. En el teléfono va arriba: abajo está la barra de los marcadores, que es
 * justo donde está el pulgar. En la compu, donde siempre.
 */
function place(): { position?: 'top-center' } {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
    ? { position: 'top-center' }
    : {}
}

/** Los avisos de «Cocina y aclaraciones»: una sola voz y un solo lugar para todos. */
export const notify = {
  ok(message: string, id?: string) {
    toast.success(message, { ...place(), id })
  },
  /** Un dato, no un resultado: «eso ya estaba así». */
  note(message: string, id?: string) {
    toast(message, { ...place(), id, duration: 3_500 })
  },
  /** Lo que salió mal dice qué pasó y qué hacer: se queda más tiempo para poder leerlo. */
  error(message: string) {
    toast.error(message, { ...place(), duration: 9_000 })
  },
  warn(message: string) {
    toast.warning(message, { ...place(), duration: 10_000 })
  },
  /** Lo que se guardó solo, con «Deshacer». El mismo `id` reemplaza al aviso anterior. */
  undoable(message: string, opts: { id: string; onUndo: () => void }) {
    toast(message, {
      ...place(),
      id: opts.id,
      duration: UNDO_MS,
      action: { label: 'Deshacer', onClick: opts.onUndo },
    })
  },
  /** Saca los avisos de la vista: al abrir una hoja, un aviso viejo taparía su botón. */
  clear() {
    toast.dismiss()
  },
}
