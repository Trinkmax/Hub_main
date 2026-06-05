import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core'

/**
 * Accesibilidad del editor de plano (CLAUDE.md §7: keyboard nav + ARIA, es-AR).
 *
 * KEYMAP CANÓNICO (documentado para que el comportamiento sea predecible y no
 * choque "abrir inspector" con "levantar para arrastrar"):
 *   - Click / Enter sobre un elemento  → lo SELECCIONA y abre su inspector.
 *   - Barra espaciadora (Space)        → LEVANTA el elemento para arrastre por teclado.
 *   - Flechas (↑ ↓ ← →)                → mueven el elemento levantado 1 celda de grilla.
 *   - Barra espaciadora (de nuevo)     → SUELTA el elemento en la posición nueva.
 *   - Escape (Esc)                     → CANCELA el arrastre y vuelve a la posición original.
 *
 * El paso por flecha equivale a `GRID * scale` px de pantalla (= 1 celda lógica);
 * lo configura el `coordinateGetter` del `KeyboardSensor` en floor-plan-editor.tsx.
 *
 * Estas cadenas las lee
 * `<DndContext accessibility={{ announcements, screenReaderInstructions }}>`.
 */
export const floorPlanScreenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    'Para mover un elemento del plano con el teclado, presioná la barra espaciadora para levantarlo. ' +
    'Mientras lo movés, usá las flechas del teclado para desplazarlo de a una celda. ' +
    'Presioná la barra espaciadora de nuevo para soltarlo en la posición nueva, o Escape para cancelar. ' +
    'Para editar un elemento sin moverlo, presioná Enter: se selecciona y se abre su panel.',
}

export const floorPlanAnnouncements: Announcements = {
  onDragStart({ active }) {
    return `Levantaste el elemento ${active.id}. Usá las flechas para moverlo.`
  },
  onDragOver({ active, over }) {
    if (over) {
      return `El elemento ${active.id} está sobre el área ${over.id}.`
    }
    return `El elemento ${active.id} ya no está sobre un área.`
  },
  onDragEnd({ active, over }) {
    if (over) {
      return `Soltaste el elemento ${active.id} en el área ${over.id}.`
    }
    return `Soltaste el elemento ${active.id} en su nueva posición.`
  },
  onDragCancel({ active }) {
    return `Cancelaste el movimiento. El elemento ${active.id} volvió a su posición original.`
  },
}
