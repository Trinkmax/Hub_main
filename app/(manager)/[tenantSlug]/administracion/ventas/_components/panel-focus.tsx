'use client'

import { useLinkStatus } from 'next/link'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Las dos islas mínimas de «El mes». La pantalla es del servidor: esto es lo
 * único que necesita el navegador.
 *
 * `PanelFocus` trae un bloque a la vista. Los `?tab=` de siempre siguen
 * valiendo (`proyeccion`, `caja`, `cobros`), pero ahora son bloques de una
 * vista más larga: al entrar por uno de esos links, la pantalla baja sola
 * hasta su bloque. Y en el celular, donde la noche elegida queda debajo del
 * almanaque, baja hasta ella cuando se toca un día.
 */
export function PanelFocus({
  target,
  when = 'mount',
  watch,
  below,
}: {
  /** El `id` del bloque (`proyeccion`, `caja`, `cobros`, `noche`). */
  target: string
  /** `mount`: al entrar. `change`: solo cuando `watch` cambia (no al entrar). */
  when?: 'mount' | 'change'
  /** Lo que se mira para saber que cambió (el día elegido). */
  watch?: string | null
  /** Solo por debajo de este ancho de ventana, en px (el celular y la tablet). */
  below?: number
}) {
  const seen = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const first = seen.current === undefined
    const changed = !first && seen.current !== (watch ?? null)
    seen.current = watch ?? null
    if (when === 'mount' ? !first : !changed) return
    if (below && !window.matchMedia(`(max-width: ${below - 1}px)`).matches) return
    const element = document.getElementById(target)
    if (!element) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [target, when, watch, below])

  return null
}

/**
 * La señal inmediata de un link que ya se tocó: va DENTRO del `<Link>` y se
 * dibuja mientras la navegación está en camino (`useLinkStatus`). El casillero
 * del almanaque se marca al instante, sin esperar al servidor.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-primary ring-inset motion-safe:animate-pulse',
        className,
      )}
    />
  )
}
