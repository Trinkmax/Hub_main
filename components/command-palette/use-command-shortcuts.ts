'use client'

import { useEffect } from 'react'

/**
 * Listener global para Cmd+K / Ctrl+K que abre el command palette.
 * Ignora cuando el usuario está escribiendo en un input editable
 * (excepto si Cmd/Ctrl está presionado, en cuyo caso lo permitimos).
 */
export function useCommandShortcuts(onToggle: () => void, options: { disabled?: boolean } = {}) {
  const { disabled = false } = options

  useEffect(() => {
    if (disabled) return

    const handler = (event: KeyboardEvent) => {
      const isPaletteCombo = event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey

      if (!isPaletteCombo) return

      event.preventDefault()
      onToggle()
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onToggle, disabled])
}
