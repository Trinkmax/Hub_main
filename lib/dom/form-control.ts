/**
 * Ayudas de DOM para los campos compuestos del kit (plata, números, fecha,
 * hora, combobox). Sin React adentro: se llaman desde los manejadores.
 */

import type * as React from 'react'

/**
 * En pantallas táctiles el teclado tapa la mitad de abajo: el campo con foco va
 * al centro. Con mouse no se mueve nada (el campo ya está donde se hizo click).
 * Es la de «Cómo nos fue» (kit §3.2, MoneyField punto 8). El spec la ubica en
 * `field.tsx`, que la re-exporta desde acá: así también la usan los campos que
 * no pasan por Field sin importar todo el módulo del Field.
 */
export function scrollIntoViewOnTouch(event: React.FocusEvent<HTMLElement>): void {
  if (typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) return
  event.currentTarget.scrollIntoView({ block: 'center' })
}

/** Los formularios que ya enfocaron su primer campo inválido en este intento de envío. */
const claimedForms = new WeakSet<HTMLFormElement>()

/**
 * Al enviar con campos inválidos, el navegador dispara `invalid` en cada uno,
 * en orden. Los campos del kit cancelan la burbuja nativa (muestran su error en
 * el Field), y con eso el navegador tampoco enfoca: esto enfoca solo el
 * PRIMERO del formulario. La marca se borra en la microtarea siguiente, cuando
 * ya pasaron todos los `invalid` de ese envío.
 */
export function focusIfFirstInvalid(element: HTMLElement): void {
  const form =
    'form' in element && element.form instanceof HTMLFormElement
      ? element.form
      : element.closest('form')
  if (!form) {
    element.focus()
    return
  }
  if (claimedForms.has(form)) return
  claimedForms.add(form)
  queueMicrotask(() => claimedForms.delete(form))
  element.focus()
}

/**
 * Junta varias refs (la propia del componente, la `ref` y el `inputRef` del que
 * llama) en una sola, con limpieza de React 19. Memoizarla en el componente:
 * una función nueva en cada render desengancha y reengancha las refs.
 */
export function mergeRefs<T>(
  ...refs: ReadonlyArray<React.Ref<T> | undefined>
): React.RefCallback<T> {
  return (node) => {
    const cleanups: Array<() => void> = []
    for (const ref of refs) {
      if (typeof ref === 'function') {
        const cleanup = ref(node)
        cleanups.push(typeof cleanup === 'function' ? cleanup : () => ref(null))
      } else if (ref) {
        ref.current = node
        cleanups.push(() => {
          ref.current = null
        })
      }
    }
    return () => {
      for (const cleanup of cleanups) cleanup()
    }
  }
}
