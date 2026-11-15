/**
 * Abrir «Más» (la hoja con todo el panel) desde cualquier lado, sin traer su código: Mensajería tiene su
 * propia barra abajo y su círculo lleva acá. Puro navegador, como `openTex()`.
 */

export const MORE_OPEN_EVENT = 'hub:more-open'

export function openMoreSheet(): void {
  window.dispatchEvent(new CustomEvent(MORE_OPEN_EVENT))
}
