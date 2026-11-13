'use client'

import { toast } from 'sonner'

/** Lo que dura el «Deshacer» de un precio (el mismo tiempo que en Administración). */
const UNDO_MS = 6_000

/**
 * Dónde sale el aviso. En el teléfono va arriba: abajo lo tapa el teclado, que es justo donde
 * está la persona mientras cambia precios. En la compu, donde siempre.
 */
function place(): { position?: 'top-center' } {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
    ? { position: 'top-center' }
    : {}
}

/** Los avisos de «Precios»: una sola voz y un solo lugar para todos. */
export const notify = {
  ok(message: string) {
    toast.success(message, place())
  },
  /** Lo que salió mal dice qué pasó y qué hacer: se queda más tiempo para poder leerlo. */
  error(message: string) {
    toast.error(message, { ...place(), duration: 9_000 })
  },
  warn(message: string) {
    toast.warning(message, { ...place(), duration: 12_000 })
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
  /**
   * Saca los avisos de la vista. Al abrir una hoja: su botón principal queda abajo, justo donde
   * salen los avisos, y un aviso viejo lo taparía.
   */
  clear() {
    toast.dismiss()
  },
}
