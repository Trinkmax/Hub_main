'use client'

import { useEffect } from 'react'

/**
 * En el celular las ocho pestañas de Ajustes no entran y la barra se desliza de costado: si la
 * activa es de las últimas (Plataformas, Puntos de venta, Integridad) quedaba fuera de la vista y
 * no se sabía dónde se estaba. Esto la trae al centro de la barra, sin mover la página. Si la
 * barra entra entera, no hace nada.
 */
export function ActiveTabIntoView({ navLabel, active }: { navLabel: string; active: string }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` no se lee adentro, pero cambiar de pestaña tiene que volver a centrar la nueva (el DOM ya la marca con aria-current)
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(`nav[aria-label="${CSS.escape(navLabel)}"]`)
    const link = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !link) return
    const overflow = nav.scrollWidth - nav.clientWidth
    if (overflow <= 0) return
    const navBox = nav.getBoundingClientRect()
    const linkBox = link.getBoundingClientRect()
    const target =
      nav.scrollLeft + (linkBox.left - navBox.left) - (navBox.width - linkBox.width) / 2
    nav.scrollLeft = Math.max(0, Math.min(target, overflow))
  }, [navLabel, active])

  return null
}
