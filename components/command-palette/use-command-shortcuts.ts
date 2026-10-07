'use client'

import { useEffect } from 'react'

/**
 * Listener global para Cmd+K / Ctrl+K que abre el command palette.
 * Anda también adentro de un campo (con Cmd/Ctrl apretado no se está
 * escribiendo) y en el celular, que ahora tiene su lupa en el topbar.
 */
export function useCommandShortcuts(onToggle: () => void, options: { disabled?: boolean } = {}) {
  const { disabled = false } = options

  useEffect(() => {
    if (disabled) return

    const handler = (event: KeyboardEvent) => {
      // `toLowerCase`: con Bloq Mayús la tecla llega como «K». El `typeof`: el
      // autocompletar de Chrome dispara keydown sin `key`.
      const isPaletteCombo =
        typeof event.key === 'string' &&
        event.key.toLowerCase() === 'k' &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey

      if (!isPaletteCombo) return

      event.preventDefault()
      // Dejar apretado ⌘K no la abre y cierra en loop.
      if (event.repeat) return
      onToggle()
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onToggle, disabled])
}
