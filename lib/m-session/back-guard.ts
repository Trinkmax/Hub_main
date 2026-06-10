/**
 * Engancha un overlay/sheet al History API para que el botón/gesto "atrás"
 * del navegador lo cierre (llamando `onClose`) en vez de salir de la página.
 *
 * Al armarse empuja una entrada "dummy". Devuelve un disposer:
 * - si la entrada dummy sigue presente (cierre programático: botón ⟵ / scrim),
 *   hace `history.back()` para limpiarla;
 * - si el usuario ya tocó "atrás" (el `popstate` consumió la entrada), no hace nada.
 *
 * `win` se inyecta para poder testear en entorno node con un fake.
 */
export type BackGuardWindow = Pick<Window, 'history' | 'addEventListener' | 'removeEventListener'>

export function armBackGuard(win: BackGuardWindow, onClose: () => void): () => void {
  win.history.pushState({ __mSheet: true }, '')
  const onPop = () => onClose()
  win.addEventListener('popstate', onPop)
  return () => {
    win.removeEventListener('popstate', onPop)
    const state = win.history.state as { __mSheet?: boolean } | null
    if (state?.__mSheet) {
      win.history.back()
    }
  }
}
