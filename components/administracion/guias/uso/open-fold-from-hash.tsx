'use client'

import { useEffect } from 'react'

/**
 * Quien llega con `#glosario` o `#archivos` tiene que ver ese plegable abierto: un `<details>`
 * cerrado no se abre solo cuando el ancla es él mismo. Sin esto, el link no llevaba a nada.
 */
export function OpenFoldFromHash() {
  useEffect(() => {
    const open = () => {
      const id = window.location.hash.slice(1)
      if (!id) return
      const target = document.getElementById(id)
      if (!(target instanceof HTMLDetailsElement)) return
      target.open = true
      target.scrollIntoView({ block: 'start' })
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])
  return null
}
