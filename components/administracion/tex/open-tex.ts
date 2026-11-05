/** Abrir a Tex desde cualquier lado (⌘K, el lanzador) sin traer todo su código. Puro navegador. */

export const TEX_OPEN_EVENT = 'tex:open'

/** ¿Está Tex en esta pantalla? Solo existe en Administración, y solo con la clave de la API. */
export function texAvailable(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.tex !== undefined
}

export function openTex(message?: string): void {
  window.dispatchEvent(new CustomEvent(TEX_OPEN_EVENT, { detail: { message: message ?? null } }))
}
