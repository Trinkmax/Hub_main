'use client'

import { ArrowRight, Search } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { StorageImage } from '@/components/media/storage-image'
import { type CartaRoot, rootSummary } from '@/lib/menu/carta'
import type { MenuItem } from '@/lib/menu/queries'
import type { CartaSponsor } from '@/lib/menu/sponsors'
import { cn } from '@/lib/utils'
import { CartaBrand } from './carta-brand'
import { CartaFooter } from './carta-footer'
import { type OpenDish, photoOf } from './dish'
import { formatARS } from './format'
import { SponsorsBand } from './sponsors'

/**
 * El inicio de la carta: el saludo según la hora del bar, el buscador, los recomendados (si el bar marcó
 * alguno) y los rubros como portadas grandes. Tocar una portada abre el rubro; su nombre viaja hasta el
 * título de la página que se abre.
 */
export function CartaHome({
  tenantName,
  logoUrl,
  greeting,
  roots,
  featured,
  sponsors,
  member,
  intro,
  titleFor,
  onOpenRoot,
  onOpenItem,
  onSearch,
  onClub,
}: {
  tenantName: string
  logoUrl: string | null
  /** «Buenas noches» / «Buenas noches, Nacho». */
  greeting: string
  roots: CartaRoot[]
  featured: MenuItem[]
  sponsors: CartaSponsor[]
  /** Este celular ya tiene una sesión del club. */
  member: boolean
  /** La entrada animada: solo la primera vez que se dibuja el inicio. */
  intro: boolean
  /** El rubro cuyo nombre viaja en el cambio de pantalla (el que se abre o del que se vuelve). */
  titleFor: string | null
  onOpenRoot: (slug: string) => void
  onOpenItem: OpenDish
  onSearch: () => void
  onClub: () => void
}): React.JSX.Element {
  return (
    <div className={cn('pb-(--carta-dock-space)', intro && 'carta-intro')}>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <header className="flex items-center justify-between pt-[max(env(safe-area-inset-top),1.25rem)]">
          <CartaBrand tenantName={tenantName} logoUrl={logoUrl} className="h-11 max-w-[11rem]" />
        </header>

        <div className="pb-2 pt-9 lg:pt-14">
          <h1
            data-rise
            style={{ '--i': 0 } as CSSProperties}
            className="font-serif text-[2.625rem] font-medium leading-[1.02] tracking-[-0.032em] text-balance sm:text-[3.25rem] lg:text-[4rem]"
          >
            {greeting}.<span className="block text-(--carta-green)">¿Qué vas a pedir?</span>
          </h1>

          <button
            type="button"
            onClick={onSearch}
            data-rise
            style={{ '--i': 1 } as CSSProperties}
            className="carta-press carta-focus mt-7 flex h-[3.375rem] w-full max-w-xl items-center gap-3 rounded-full bg-card pl-5 pr-6 text-left text-[1rem] text-(--carta-soft) shadow-sm ring-1 ring-(--carta-line)"
          >
            <Search className="size-5 text-(--carta-green)" aria-hidden />
            Buscar un plato o una bebida
          </button>
        </div>
      </div>

      {featured.length > 0 ? <FeaturedStrip items={featured} onOpen={onOpenItem} /> : null}

      <nav
        aria-label="Rubros de la carta"
        className="mx-auto mt-9 grid w-full max-w-6xl gap-x-6 gap-y-11 px-4 sm:px-6 md:grid-cols-2 lg:mt-14 lg:grid-cols-3"
      >
        {roots.map((root, index) => (
          <RootCover
            key={root.id}
            root={root}
            index={index}
            travels={titleFor === root.slug}
            onOpen={() => onOpenRoot(root.slug)}
          />
        ))}
      </nav>

      {roots.length === 0 ? <EmptyCarta /> : null}

      <SponsorsBand sponsors={sponsors} className="mt-16" />

      {member ? null : (
        <div className="mx-auto mt-14 w-full max-w-6xl px-4 sm:px-6">
          <ClubInvite tenantName={tenantName} onJoin={onClub} />
        </div>
      )}

      <CartaFooter tenantName={tenantName} className="mt-14" />
    </div>
  )
}

/** La foto de un rubro: la que le cargó el bar o, si no tiene, la del primero de sus productos con foto. */
function coverOf(root: CartaRoot): string | null {
  if (root.imageUrl) return root.imageUrl
  for (const section of root.sections) {
    for (const item of section.items) {
      const photo = photoOf(item)
      if (photo) return photo
    }
  }
  return null
}

/** Lo que hay adentro, en una línea: los nombres de sus secciones, o cuántas opciones tiene. */
function insideOf(root: CartaRoot): string {
  if (root.sections.length <= 1) return rootSummary(root)
  return root.sections.map((section) => section.title).join(' · ')
}

function RootCover({
  root,
  index,
  travels,
  onOpen,
}: {
  root: CartaRoot
  index: number
  travels: boolean
  onOpen: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  // Todas nacen a la vista (si el JavaScript no llega, la carta se lee igual). Al montar, las que
  // quedaron debajo de la pantalla esperan tapadas y se descubren cuando se llega a ellas.
  const [waiting, setWaiting] = useState(false)
  const cover = coverOf(root)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (element.getBoundingClientRect().top < window.innerHeight * 0.92) return
    setWaiting(true)
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setWaiting(false)
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      data-cover={waiting ? 'waiting' : 'in'}
      data-rise={index < 2 ? '' : undefined}
      style={{ '--i': index + 2 } as CSSProperties}
      className="carta-press carta-focus group flex w-full flex-col rounded-[1.75rem] text-left"
    >
      {cover ? (
        <div className="carta-cover-art relative aspect-[5/4] w-full overflow-hidden rounded-[1.75rem] bg-(--carta-paper-2)">
          <StorageImage
            src={cover}
            // Un poco menos que su ancho real (casi toda la pantalla): así un celular de pantalla densa
            // elige la variante de 800 px, que se ve igual de bien y pesa un tercio que la de 1600.
            sizes="(min-width: 1024px) 360px, (min-width: 768px) 44vw, 64vw"
            priority={index === 0}
          />
        </div>
      ) : null}
      {/* Sin ninguna foto (un bar que recién arranca) el rubro es su nombre y lo que tiene adentro: queda
          un índice de carta impresa, sin recuadros vacíos. */}
      <div
        className={cn(
          'carta-cover-text flex items-start justify-between gap-4 px-1',
          cover ? 'mt-4' : 'border-t border-(--carta-line) pt-5',
        )}
      >
        <div className="min-w-0">
          <h2 className="font-serif text-[2.125rem] font-medium leading-none tracking-[-0.03em]">
            <span
              className="inline-block"
              style={travels ? { viewTransitionName: 'carta-title' } : undefined}
            >
              {root.name}
            </span>
          </h2>
          <p className="mt-2 line-clamp-2 text-[0.875rem] leading-[1.45] text-(--carta-soft)">
            {insideOf(root)}
          </p>
        </div>
        <span
          aria-hidden
          className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-(--carta-green) text-(--carta-on-green) transition-transform duration-500 ease-(--carta-ease) group-hover:translate-x-1"
        >
          <ArrowRight className="size-5" />
        </span>
      </div>
    </button>
  )
}

/** Los recomendados del bar: una tira de fotos altas que se corre con el dedo. */
function FeaturedStrip({
  items,
  onOpen,
}: {
  items: MenuItem[]
  onOpen: OpenDish
}): React.JSX.Element {
  return (
    <section aria-labelledby="carta-recomendados" className="mt-9">
      <h2
        id="carta-recomendados"
        className="mx-auto w-full max-w-6xl px-4 font-serif text-[1.5rem] font-medium leading-none tracking-[-0.02em] sm:px-6"
      >
        Los elegidos de la casa
      </h2>
      <ul className="carta-scroller mx-auto mt-4 flex w-full max-w-6xl snap-x snap-mandatory scroll-px-4 gap-3 px-4 pb-1 sm:scroll-px-6 sm:px-6">
        {items.map((item, index) => (
          <li key={item.id} className="w-[62vw] max-w-[15.5rem] shrink-0 snap-start">
            <FeaturedCard item={item} onOpen={onOpen} priority={index < 2} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function FeaturedCard({
  item,
  onOpen,
  priority,
}: {
  item: MenuItem
  onOpen: OpenDish
  priority: boolean
}): React.JSX.Element {
  const artRef = useRef<HTMLDivElement>(null)
  const photo = photoOf(item)
  return (
    <button
      type="button"
      onClick={() => onOpen(item, photo ? artRef.current : null)}
      className="carta-press carta-focus relative block w-full rounded-[1.5rem] text-left"
    >
      <div
        ref={artRef}
        data-art-of={photo ? item.id : undefined}
        className="relative aspect-[3/4] w-full overflow-hidden rounded-[1.5rem] bg-(--carta-night)"
      >
        {photo ? (
          <StorageImage src={photo} sizes="(min-width: 640px) 248px, 62vw" priority={priority} />
        ) : null}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-black/80 via-black/35 to-transparent"
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 p-4 text-white">
        <h3 className="font-serif text-[1.25rem] font-medium leading-[1.1] tracking-[-0.02em] text-pretty">
          {item.name}
        </h3>
        <p className="mt-1.5 text-[0.9375rem] font-semibold">{formatARS(item.price_cents)}</p>
      </div>
    </button>
  )
}

/** La invitación al club, para quien todavía no entró en este celular. */
function ClubInvite({
  tenantName,
  onJoin,
}: {
  tenantName: string
  onJoin: () => void
}): React.JSX.Element {
  return (
    <section
      aria-labelledby="carta-club"
      className="flex flex-col gap-5 rounded-[1.75rem] bg-card p-6 shadow-sm ring-1 ring-(--carta-line) sm:flex-row sm:items-center sm:justify-between sm:p-8"
    >
      <div>
        <h2
          id="carta-club"
          className="font-serif text-[1.75rem] font-medium leading-[1.05] tracking-[-0.025em]"
        >
          El club de {tenantName}
        </h2>
        <p className="mt-2 max-w-md text-[0.9375rem] leading-[1.5] text-(--carta-soft)">
          Puntos en cada visita, beneficios y novedades.
        </p>
      </div>
      <button
        type="button"
        onClick={onJoin}
        className="carta-press carta-focus inline-flex h-[3.25rem] shrink-0 items-center justify-center gap-2 rounded-full bg-(--carta-green) px-7 text-[1rem] font-semibold text-(--carta-on-green)"
      >
        Sumarme o entrar
        <ArrowRight className="size-[1.125rem]" aria-hidden />
      </button>
    </section>
  )
}

function EmptyCarta(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
      <p className="font-serif text-[1.75rem] font-medium leading-tight tracking-[-0.02em]">
        La carta se está armando.
      </p>
      <p className="mt-2 text-[0.9375rem] text-(--carta-soft)">
        Todavía no hay nada para mostrar. Volvé en un rato.
      </p>
    </div>
  )
}
