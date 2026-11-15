'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useDockFlat } from './dock/dock-flat-context'
import { SectionTabs } from './section-tabs'
import { activeSectionTab, type ResolvedSection, sectionBarVisible } from './section-tabs-config'

/**
 * Las páginas angostas de una sección (Acreditar, el QR del club, las de 6xl, las fichas) se
 * centran solas, y con la barra arriba quedaban corridas de las pestañas. Esto las pega al borde
 * izquierdo de la barra: les da el mismo margen que tendría una página de 7xl, así el título
 * arranca justo debajo de la primera pestaña en cualquier ancho. En el celular no cambia nada (el
 * margen da 0).
 *
 * Solo toca lo que viene después de la barra dentro del layout (la página o su loading: son
 * hermanas directas en el `<main>`) y solo con estos anchos. Las de 7xl ya coinciden, y una más
 * ancha (el editor de páginas, que no lleva barra) se saldría por la derecha.
 */
const ALIGN_NARROW_PAGES =
  '[&~:is(.max-w-xl,.max-w-2xl,.max-w-3xl,.max-w-4xl,.max-w-5xl,.max-w-6xl)]:ms-[max(0px,calc((100%_-_80rem)/2))]'

/**
 * Lo mismo para una sección ancha (Reservas: el Operativo y el Calendario miden `max-w-screen-2xl`):
 * la barra mide eso, y las páginas más angostas (la lista de Reservas, de 7xl) se pegan a su borde
 * izquierdo en vez de centrarse.
 */
const ALIGN_PAGES_TO_WIDE =
  '[&~:is(.max-w-xl,.max-w-2xl,.max-w-3xl,.max-w-4xl,.max-w-5xl,.max-w-6xl,.max-w-7xl)]:ms-[max(0px,calc((100%_-_96rem)/2))]'

/**
 * La barra de pestañas de una sección, arriba de todo y antes del título, del mismo ancho en
 * todas las páginas de la sección (así no salta al cambiar de pestaña aunque cada página tenga
 * su propio ancho). La renderiza el layout de cada sección con las pestañas que ve quien mira
 * (`resolveSection`); la activa sale de la URL, así que sirve igual en las sub-rutas.
 */
export function SectionTabsBar({ id, label, tabs, showWhenNoneActive, width }: ResolvedSection) {
  const pathname = usePathname()
  // En el celular, si la barra de abajo ya lleva estas pestañas sueltas, acá arriba sobran.
  const flat = useDockFlat().includes(id)
  const active = activeSectionTab(tabs, pathname)
  if (!sectionBarVisible({ tabs, showWhenNoneActive }, active)) return null

  return (
    <div
      data-section-bar={id}
      className={cn(
        'mx-auto w-full px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8',
        flat && 'max-lg:hidden',
        width === 'wide'
          ? ['max-w-screen-2xl', ALIGN_PAGES_TO_WIDE]
          : ['max-w-7xl', ALIGN_NARROW_PAGES],
      )}
    >
      <SectionTabs items={tabs} active={active} label={label} />
    </div>
  )
}
