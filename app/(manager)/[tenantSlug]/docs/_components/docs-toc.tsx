'use client'

import * as React from 'react'
import { tabsListClasses, tabsTriggerClasses, useScrollRow } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

/*
 * Índice de la guía. Es navegación DENTRO de la página (anclas `#seccion`),
 * así que no sirve `SectionNav` (que marca la ruta activa por pathname): este
 * componente arma lo mismo a mano y marca la sección que se está leyendo.
 *
 * - Desde `lg`: columna fija al costado (debajo del topbar, nunca tapada), con
 *   el ítem del menú lateral: fondo `--selected` + barra de 2 px.
 * - Debajo de `lg`: la fila subrayada de `TabsNav`, pegada debajo del topbar y
 *   con scroll horizontal; la sección activa se lleva a la vista sola.
 * - «Estás acá» sigue al scroll (no solo al click): `aria-current="location"`.
 */

export type DocsTocItem = {
  id: string
  label: string
  /** Ya dibujado en el server (un componente de ícono no cruza al cliente). */
  icon: React.ReactNode
}

/** El ítem de la columna: el mismo del menú lateral y de `SectionNav`. */
const COLUMN_ITEM = [
  'relative flex min-h-8 items-center gap-2.5 rounded-md px-2.5 type-body font-medium text-muted-foreground pointer-coarse:min-h-11',
  'hover:bg-hover hover:text-foreground',
  'outline-(--ring) -outline-offset-2 focus-visible:outline-2',
  'aria-[current=location]:bg-selected aria-[current=location]:text-foreground',
  '[&_svg]:shrink-0 [&_svg]:text-muted-foreground aria-[current=location]:[&_svg]:text-primary',
].join(' ')

/** Una sección cuenta como «la que se lee» cuando su título pasó esta línea. */
function readingLine() {
  return Math.max(140, window.innerHeight * 0.3)
}

export function DocsToc({
  items,
  roleLabel,
}: {
  items: ReadonlyArray<DocsTocItem>
  roleLabel: string
}) {
  const ids = React.useMemo(() => items.map((item) => item.id), [items])
  const [active, setActive] = React.useState(ids[0] ?? '')
  // Después de un click en el índice manda el click (si la sección está al
  // final, la página no llega a subirla y el cálculo por posición elegiría la
  // última). Se libera cuando la persona vuelve a desplazarse.
  const lockedRef = React.useRef(false)
  const row = useScrollRow<HTMLDivElement>(active, '[aria-current="location"]')

  React.useEffect(() => {
    if (ids.length === 0) return
    let frame = 0

    const compute = () => {
      frame = 0
      if (lockedRef.current) return
      const line = readingLine()
      let current = ids[0] ?? ''
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= line) current = id
        else break
      }
      const doc = document.documentElement
      const atBottom =
        window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 2
      if (atBottom) current = ids[ids.length - 1] ?? current
      setActive(current)
    }
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(compute)
    }
    const release = () => {
      lockedRef.current = false
    }

    // Llegó con un ancla (`/docs#roles`): el navegador ya saltó ahí.
    const hash = window.location.hash.slice(1)
    if (hash && ids.includes(hash)) {
      lockedRef.current = true
      setActive(hash)
    } else {
      compute()
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    window.addEventListener('wheel', release, { passive: true })
    window.addEventListener('touchstart', release, { passive: true })
    window.addEventListener('keydown', release)
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('wheel', release)
      window.removeEventListener('touchstart', release)
      window.removeEventListener('keydown', release)
    }
  }, [ids])

  const select = (id: string) => {
    lockedRef.current = true
    setActive(id)
  }

  return (
    <nav
      aria-label="Índice de la guía"
      className={cn(
        // Celular: fila pegada debajo del topbar, de borde a borde.
        'sticky top-(--topbar-h) z-10 -mx-4 bg-background px-4 sm:-mx-6 sm:px-6',
        // Escritorio: columna fija que nunca queda abajo del topbar.
        'lg:top-[calc(var(--topbar-h)+2rem)] lg:z-auto lg:mx-0 lg:max-h-[calc(100dvh-var(--topbar-h)-4rem)] lg:self-start lg:overflow-y-auto lg:bg-transparent lg:px-0',
      )}
    >
      <div ref={row.ref} data-overflow={row.overflow} className={cn(tabsListClasses, 'lg:hidden')}>
        {items.map((item) => {
          const isActive = item.id === active
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={() => select(item.id)}
              aria-current={isActive ? 'location' : undefined}
              data-state={isActive ? 'active' : 'inactive'}
              className={tabsTriggerClasses}
            >
              {item.label}
            </a>
          )
        })}
      </div>

      <div className="hidden lg:flex lg:flex-col lg:gap-4">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const isActive = item.id === active
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={() => select(item.id)}
                  aria-current={isActive ? 'location' : undefined}
                  className={COLUMN_ITEM}
                >
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary forced-colors:bg-[Highlight]"
                    />
                  ) : null}
                  {item.icon}
                  <span className="min-w-0 truncate">{item.label}</span>
                </a>
              </li>
            )
          })}
        </ul>
        <p className="px-2.5 type-caption text-subtle-foreground">Tu rol: {roleLabel}</p>
      </div>
    </nav>
  )
}
