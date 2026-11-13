'use client'

import { toast } from 'sonner'

/** Lo que dura el «Deshacer» (el mismo tiempo que en Precios y en Administración). */
const UNDO_MS = 6_000

/**
 * Dónde sale el aviso. En el teléfono va arriba: abajo lo tapa el teclado, que es justo donde
 * está la persona mientras escribe un nombre o un alias. En la compu, donde siempre.
 */
function place(): { position?: 'top-center' } {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
    ? { position: 'top-center' }
    : {}
}

/** Los avisos de «Sucursales»: una sola voz y un solo lugar para todos. */
export const notify = {
  ok(message: string) {
    toast.success(message, place())
  },
  /** Lo que salió mal dice qué pasó y qué hacer: se queda más tiempo para poder leerlo. */
  error(message: string) {
    toast.error(message, { ...place(), duration: 9_000 })
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
  /** Saca los avisos de la vista (al abrir un diálogo: su botón queda donde salen los avisos). */
  clear() {
    toast.dismiss()
  },
}
