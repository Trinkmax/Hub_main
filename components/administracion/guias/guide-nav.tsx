'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

/**
 * Qué pasos de una guía están abiertos, y el salto a un paso (`#paso-N`): lo comparten el riel,
 * la barra del celular, cada paso y los links «Cómo se arregla». Abre el paso del `#` al entrar
 * a la página y cuando cambia el `#` (un link del riel o de otra pantalla), y al saltar lleva el
 * foco al título del paso para que el teclado y el lector sigan desde ahí.
 */

export type GuideNavItem = { readonly id: string; readonly anchor: string }

type GuideNavValue = {
  isOpen: (id: string) => boolean
  setOpen: (id: string, open: boolean) => void
  /** Abre el paso, lo trae a la vista, pone su `#` en la URL y le da el foco a su título. */
  reveal: (id: string) => void
  anchorFor: (id: string) => string | null
}

const GuideNavContext = createContext<GuideNavValue | null>(null)

/** El id del botón que abre y cierra un paso (para devolverle el foco). */
export function stepToggleId(anchor: string): string {
  return `${anchor}-titulo`
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function GuideNavProvider({
  items,
  initialOpen,
  children,
}: {
  items: readonly GuideNavItem[]
  /** Los pasos abiertos al entrar (el «Te toca»). */
  initialOpen: readonly string[]
  children: ReactNode
}) {
  const [open, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(initialOpen))
  // Los mapas dependen de qué pasos hay, no del arreglo: el servidor manda uno nuevo en cada
  // `router.refresh()` y, si cambiaran, el efecto del `#` volvería a saltar al paso del link
  // después de cada acción.
  const signature = items.map((i) => `${i.id}:${i.anchor}`).join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: la firma resume `items` (ver arriba)
  const { byAnchor, byId } = useMemo(
    () => ({
      byAnchor: new Map(items.map((i) => [i.anchor, i.id])),
      byId: new Map(items.map((i) => [i.id, i.anchor])),
    }),
    [signature],
  )

  const setOpen = useCallback((id: string, value: boolean) => {
    setOpenIds((prev) => {
      if (prev.has(id) === value) return prev
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const reveal = useCallback(
    (id: string) => {
      const anchor = byId.get(id)
      if (!anchor) return
      setOpen(id, true)
      // Dos cuadros: el primero pinta el paso abierto, el segundo ya tiene la altura nueva.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const section = document.getElementById(anchor)
          section?.scrollIntoView({
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
            block: 'start',
          })
          document.getElementById(stepToggleId(anchor))?.focus({ preventScroll: true })
          try {
            window.history.replaceState(window.history.state, '', `#${anchor}`)
          } catch {
            // Sin history (un iframe raro): el paso igual quedó abierto.
          }
        }),
      )
    },
    [byId, setOpen],
  )

  useEffect(() => {
    const openFromHash = (scroll: boolean) => {
      const id = byAnchor.get(window.location.hash.replace(/^#/, ''))
      if (!id) return
      setOpen(id, true)
      if (scroll) {
        const anchor = byId.get(id)
        requestAnimationFrame(() =>
          document.getElementById(anchor ?? '')?.scrollIntoView({ block: 'start' }),
        )
      }
    }
    // Al entrar con `#paso-6`: el navegador ya saltó, pero el paso estaba cerrado.
    openFromHash(true)
    const onHash = () => openFromHash(false)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [byAnchor, byId, setOpen])

  const value = useMemo<GuideNavValue>(
    () => ({
      isOpen: (id) => open.has(id),
      setOpen,
      reveal,
      anchorFor: (id) => byId.get(id) ?? null,
    }),
    [open, setOpen, reveal, byId],
  )

  return <GuideNavContext.Provider value={value}>{children}</GuideNavContext.Provider>
}

/** `null` fuera de una guía (el componente se arregla solo, sin saltos). */
export function useGuideNav(): GuideNavValue | null {
  return useContext(GuideNavContext)
}
