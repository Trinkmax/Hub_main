'use client'

/**
 * El archivo que se soltó, mientras navega hasta la pantalla que lo recibe. Vive en memoria: un
 * `File` no entra en una URL. La pantalla lo toma una sola vez con `takeDroppedFile`.
 *
 * Si la pantalla que lo recibe ya está abierta (el formulario de la compra), se registra con
 * `onDroppedComprobante` y lo recibe directo, sin navegar.
 */

let pending: File | null = null
let receiver: ((file: File) => void) | null = null

export function setDroppedFile(file: File): void {
  pending = file
}

export function takeDroppedFile(): File | null {
  const file = pending
  pending = null
  return file
}

/** Registra quién recibe comprobantes mientras está montado. Devuelve cómo sacarlo. */
export function onDroppedComprobante(fn: (file: File) => void): () => void {
  receiver = fn
  return () => {
    if (receiver === fn) receiver = null
  }
}

/** Le entrega el comprobante a quien está esperando. `false`: no hay nadie, hay que navegar. */
export function deliverComprobante(file: File): boolean {
  if (!receiver) return false
  receiver(file)
  return true
}
