'use client'

import { useEffect, useState } from 'react'

/** Los atajos del editor, dichos como lo que hacen. Se muestran en el panel y en la barra. */
const SHORTCUTS: { what: string; keys: string[] }[] = [
  { what: 'Mover de a poquito', keys: ['←', '↑', '↓', '→'] },
  { what: 'Mover de a un cuadro', keys: ['Shift', 'flechas'] },
  { what: 'Agrandar o achicar', keys: ['Alt', 'flechas'] },
  { what: 'Girar un cuarto de vuelta', keys: ['R'] },
  { what: 'Duplicar', keys: ['Ctrl', 'D'] },
  { what: 'Quitar', keys: ['Supr'] },
  { what: 'Deshacer', keys: ['Ctrl', 'Z'] },
  { what: 'Rehacer', keys: ['Ctrl', 'Shift', 'Z'] },
  { what: 'Al frente / al fondo', keys: [']', '['] },
  { what: 'Elegir varias', keys: ['Shift', 'clic'] },
  { what: 'Soltar sin imán', keys: ['Alt'] },
  { what: 'Soltar la selección', keys: ['Esc'] },
]

export function ShortcutList() {
  // En una Mac la tecla es ⌘. Se decide después de montar: el servidor no sabe qué teclado hay.
  const [mac, setMac] = useState(false)
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.userAgent))
  }, [])

  return (
    <ul className="fpe-tips">
      {SHORTCUTS.map(({ what, keys }) => (
        <li key={what}>
          <span>{what}</span>
          <span className="fpe-keys">
            {keys.map((key) => (
              <kbd key={key} className="fpe-kbd">
                {key === 'Ctrl' && mac ? '⌘' : key}
              </kbd>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}
