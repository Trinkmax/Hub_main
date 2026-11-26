'use client'

import { ArrowRight, ChevronLeft } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type CartaRoot, type CartaSection, foldText } from '@/lib/menu/carta'
import type { MenuItem } from '@/lib/menu/queries'
import type { CartaSponsor } from '@/lib/menu/sponsors'
import { cn } from '@/lib/utils'
import { SponsorsLine } from '../../_components/sponsors'
import { CartaFooter } from './carta-footer'
import { DishCard, DishFeature, DishRow, type OpenDish } from './dish'
import { SectionRail } from './section-rail'

/** El id en el DOM de una sección (para bajar hasta ella). */
export const sectionDomId = (section: Pick<CartaSection, 'slug'>) => `seccion-${section.slug}`

/** Cuánto por debajo de las pestañas tiene que estar el título de una sección para contarla como «la de ahora». */
const SPY_SLACK = 28

/**
 * La página de un rubro: todas sus secciones, una debajo de la otra.
 *
 * - Arriba, los rubros como palabras grandes: la de este es el título, las demás llevan a su página.
 * - Las pestañas de las secciones se pegan arriba y siguen el recorrido: marcan la que se está mirando
 *   y, al tocarlas, bajan hasta ella.
 * - Al final, el rubro que sigue: se puede recorrer la carta entera sin volver al inicio.
 */
export function CartaCategory({
  tenantName,
  roots,
  root,
  startSection,
  sponsors,
  onHome,
  onOpenRoot,
  onOpenItem,
}: {
  tenantName: string
  roots: CartaRoot[]
  root: CartaRoot
  /** La sección a la que se llegó por la dirección (`#bebidas/tragos-hub`), para arrancar ahí. */
  startSection: CartaSection | null
  sponsors: CartaSponsor[]
  onHome: () => void
  onOpenRoot: (slug: string) => void
  /** Abre un producto, con la lista de su sección para pasar al siguiente. */
  onOpenItem: (item: MenuItem, from: HTMLElement | null, list: MenuItem[]) => void
}): React.JSX.Element {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(
    startSection?.id ?? root.sections[0]?.id ?? null,
  )
  const [stuck, setStuck] = useState(false)
  /** Mientras la página baja sola hasta una sección, las pestañas no persiguen lo que pasa por el camino. */
  const lockUntil = useRef(0)

  const hasRail = root.sections.length > 1
  // Los rubros arrancan por este y siguen en el orden de la carta, dando la vuelta: el título queda
  // siempre primero y todos los demás a la derecha, a la vista (ninguno escondido a la izquierda).
  const here = Math.max(
    0,
    roots.findIndex((each) => each.id === root.id),
  )
  const pager = [...roots.slice(here), ...roots.slice(0, here)]
  const nextRoot = pager[1]

  // Qué sección se está mirando: la última cuyo título ya pasó por debajo de las pestañas.
  useEffect(() => {
    if (!hasRail) return
    let frame = 0
    const read = () => {
      frame = 0
      if (performance.now() < lockUntil.current) return
      const line = railHeight() + SPY_SLACK
      let current = root.sections[0]?.id ?? null
      for (const section of root.sections) {
        const element = document.getElementById(sectionDomId(section))
        if (!element) continue
        if (element.getBoundingClientRect().top <= line) current = section.id
        else break
      }
      // Al fondo de la página manda la última, aunque su título no haya llegado arriba.
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      if (atBottom) current = root.sections[root.sections.length - 1]?.id ?? current
      setActiveId(current)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [hasRail, root.sections])

  // ¿Las pestañas ya están pegadas arriba? (les aparece el fondo y la línea)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasRail) return
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry?.isIntersecting), {
      threshold: 0,
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasRail])

  const goToSection = useCallback((section: CartaSection) => {
    const element = document.getElementById(sectionDomId(section))
    if (!element) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setActiveId(section.id)
    lockUntil.current = performance.now() + (reduce ? 0 : 900)
    const top = element.getBoundingClientRect().top + window.scrollY - railHeight() - 6
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
  }, [])

  return (
    <div className="pb-(--carta-dock-space)">
      <header className="mx-auto w-full max-w-6xl px-4 pt-[max(env(safe-area-inset-top),0.75rem)] sm:px-6">
        <button
          type="button"
          onClick={onHome}
          className="carta-press carta-focus -ml-2.5 inline-flex h-10 items-center gap-0.5 rounded-full pl-1.5 pr-3.5 text-[0.9375rem] font-semibold text-(--carta-soft)"
        >
          <ChevronLeft className="size-5" aria-hidden />
          Inicio
        </button>

        <nav
          aria-label="Rubros de la carta"
          className="carta-scroller -mx-4 mt-2 flex items-baseline gap-x-6 px-4 pb-4 sm:-mx-6 sm:px-6"
        >
          {pager.map((each) =>
            each.id === root.id ? (
              <h1
                key={each.id}
                aria-current="page"
                className="shrink-0 font-serif text-[2.625rem] font-medium leading-[1.05] tracking-[-0.03em] lg:text-[3.25rem]"
              >
                <span className="inline-block" style={{ viewTransitionName: 'carta-title' }}>
                  {each.name}
                </span>
              </h1>
            ) : (
              <button
                key={each.id}
                type="button"
                onClick={() => onOpenRoot(each.slug)}
                className="carta-focus shrink-0 rounded-lg font-serif text-[2.625rem] font-medium leading-[1.05] tracking-[-0.03em] text-(--carta-soft)/85 transition-colors duration-200 hover:text-foreground lg:text-[3.25rem]"
              >
                {each.name}
              </button>
            ),
          )}
          <span aria-hidden className="w-2 shrink-0" />
        </nav>
      </header>

      {hasRail ? (
        <>
          <div ref={sentinelRef} aria-hidden className="h-px" />
          <div
            data-carta-rail
            data-stuck={stuck ? '' : undefined}
            className={cn(
              'sticky top-0 z-30 border-b transition-[background-color,border-color,backdrop-filter] duration-300',
              stuck
                ? 'border-(--carta-line) bg-background/88 backdrop-blur-xl backdrop-saturate-150'
                : 'border-transparent',
            )}
          >
            <SectionRail
              sections={root.sections}
              activeId={activeId}
              onSelect={goToSection}
              className="mx-auto h-(--carta-rail-h) w-full max-w-6xl"
            />
          </div>
        </>
      ) : null}

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {root.sections.map((section, index) => (
          <SectionBlock
            key={section.id}
            section={section}
            // Un rubro de una sola sección que se llama igual ya tiene su título arriba.
            titled={hasRail || foldText(section.title) !== foldText(root.name)}
            first={index === 0}
            onOpenItem={onOpenItem}
          />
        ))}
      </div>

      {nextRoot && nextRoot.id !== root.id ? (
        <div className="mx-auto mt-16 w-full max-w-6xl px-4 sm:px-6">
          <button
            type="button"
            onClick={() => onOpenRoot(nextRoot.slug)}
            className="carta-press carta-focus flex w-full items-center justify-between gap-4 rounded-[1.75rem] bg-(--carta-night) px-6 py-7 text-left text-(--carta-on-night) sm:px-9 sm:py-9"
          >
            <span className="font-serif text-[1.875rem] font-medium leading-[1.08] tracking-[-0.028em] sm:text-[2.25rem]">
              <span className="text-(--carta-on-night-soft)">Seguí con </span>
              {nextRoot.name}
            </span>
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-(--carta-on-night) text-(--carta-night)"
            >
              <ArrowRight className="size-5" />
            </span>
          </button>
        </div>
      ) : null}

      <CartaFooter tenantName={tenantName} className="mt-14">
        <SponsorsLine sponsors={sponsors} className="mb-9" />
      </CartaFooter>
    </div>
  )
}

/** El alto de las pestañas pegadas (con el área segura de arriba), o 0 si este rubro no las tiene. */
function railHeight(): number {
  return document.querySelector<HTMLElement>('[data-carta-rail]')?.offsetHeight ?? 0
}

function SectionBlock({
  section,
  titled,
  first,
  onOpenItem,
}: {
  section: CartaSection
  titled: boolean
  first: boolean
  onOpenItem: (item: MenuItem, from: HTMLElement | null, list: MenuItem[]) => void
}): React.JSX.Element {
  const open: OpenDish = useCallback(
    (item, from) => onOpenItem(item, from, section.items),
    [onOpenItem, section.items],
  )
  const headingId = `${sectionDomId(section)}-titulo`

  return (
    <section
      id={sectionDomId(section)}
      aria-labelledby={titled ? headingId : undefined}
      aria-label={titled ? undefined : section.title}
      className={first ? 'pt-5' : 'pt-12'}
    >
      {titled ? (
        <h2
          id={headingId}
          className="font-serif text-[1.875rem] font-medium leading-[1.05] tracking-[-0.026em] text-balance lg:text-[2.25rem]"
        >
          {section.title}
        </h2>
      ) : null}

      {section.layout === 'gallery' ? (
        <ul
          className={cn(
            'grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 lg:gap-x-5 lg:gap-y-9',
            titled ? 'mt-5' : 'mt-1',
          )}
        >
          {section.items.map((item, index) =>
            item.featured ? (
              <li key={item.id} className="col-span-2">
                <DishFeature item={item} onOpen={open} />
              </li>
            ) : (
              <li key={item.id}>
                <DishCard item={item} onOpen={open} priority={first && index < 4} />
              </li>
            ),
          )}
        </ul>
      ) : (
        <ul
          className={cn(
            'divide-y divide-(--carta-line) lg:grid lg:grid-cols-2 lg:gap-x-14 lg:divide-y-0',
            titled ? 'mt-2' : '',
          )}
        >
          {section.items.map((item) => (
            <li key={item.id} className="lg:border-b lg:border-(--carta-line)">
              <DishRow item={item} onOpen={open} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
