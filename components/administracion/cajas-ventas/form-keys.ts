import type { KeyboardEvent } from 'react'

const FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled])',
  'textarea:not([disabled])',
  'button[role="combobox"]:not([disabled])',
].join(', ')

/**
 * Teclado de los formularios largos (H.2): Enter en un campo pasa al
 * siguiente (no guarda a medio cargar); ⌘↵ / Ctrl↵ guarda. En un área de
 * texto, Enter es un salto de línea.
 */
export function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
  const form = event.currentTarget
  // Un diálogo (portal) también burbujea por el árbol de React: lo suyo no es de este formulario.
  if (!(event.target instanceof Node) || !form.contains(event.target)) return
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault()
    form.requestSubmit()
    return
  }
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (target.type === 'checkbox' || target.type === 'radio' || target.type === 'submit') return
  event.preventDefault()
  const fields = Array.from(form.querySelectorAll<HTMLElement>(FIELD_SELECTOR))
  const next = fields[fields.indexOf(target) + 1]
  next?.focus()
}
