import { ArrowRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { GalleryItem, PublicExperience } from '@/lib/ticketing/types'
import { Poster } from '../../../_components/poster'
import { Reveal } from '../../../_components/reveal'

/** Encabezado de cada acto: «Acto II · El menú». */
export function ActHeading({
  act,
  kicker,
  title,
  id,
}: {
  act: string
  kicker: string
  title: string
  id: string
}) {
  return (
    <Reveal className="mb-8">
      <p className="ent-mono text-[0.66rem] text-(--ent-gold)">
        <span className="text-(--ent-muted)">Acto {act} · </span>
        {kicker}
      </p>
      <h2 id={id} className="ent-display mt-3 text-[clamp(2.2rem,7.5vw,3.6rem)] text-balance">
        {title}
      </h2>
    </Reveal>
  )
}

/** Fotos reales de una función, como copias reveladas sobre la mesa. */
export function VenuePolaroids({
  photos,
  venueName,
}: {
  photos: GalleryItem[]
  venueName: string
}) {
  const tilts = [-2.2, 1.6, -1.1, 2.4, -1.8, 1.2]
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {photos.slice(0, 6).map((photo, i) => (
        <Reveal
          as="li"
          key={photo.url}
          index={i % 3}
          className={i === 0 ? 'col-span-2 sm:col-span-1' : undefined}
        >
          <figure
            className="rounded-md bg-(--ent-paper) p-2 pb-3 text-(--ent-ink) shadow-[0_24px_40px_-24px_rgb(0_0_0/0.9)]"
            style={{ transform: `rotate(${tilts[i % tilts.length]}deg)` }}
          >
            <div className="relative aspect-[4/3] overflow-hidden rounded-sm bg-(--ent-ink)">
              <Image
                src={photo.url}
                alt={photo.caption ?? `Una función en ${venueName}`}
                fill
                sizes="(min-width: 640px) 240px, 45vw"
                className="object-cover"
              />
            </div>
            {photo.caption ? (
              <figcaption className="mt-2 line-clamp-3 px-0.5 text-[0.72rem] leading-snug text-(--ent-ink-2)">
                {photo.caption}
              </figcaption>
            ) : null}
          </figure>
        </Reveal>
      ))}
    </ul>
  )
}

/** «Seguí mirando»: las otras películas de la cartelera. */
export function OtherFilms({
  others,
  tenantSlug,
}: {
  others: Array<Pick<PublicExperience, 'slug' | 'title' | 'posterUrl' | 'accent'>>
  tenantSlug: string
}) {
  if (others.length === 0) return null
  return (
    <section aria-labelledby="otras" className="mx-auto max-w-6xl px-5 pt-6 pb-20 sm:px-8">
      <Reveal className="mb-6 flex items-end justify-between gap-4">
        <h2 id="otras" className="ent-display text-[clamp(1.9rem,6vw,2.8rem)]">
          También en cartelera
        </h2>
        <Link
          href={`/entradas/${tenantSlug}`}
          className="ent-press inline-flex h-11 shrink-0 items-center gap-2 text-sm font-semibold text-(--ent-cream-2) hover:text-(--ent-cream)"
        >
          Ver todas
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Reveal>
      <ul className="-mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {others.map((film, i) => (
          <Reveal
            as="li"
            key={film.slug}
            index={i}
            className="ent-film w-[42%] max-w-[11rem] shrink-0 snap-start"
          >
            <Link
              href={`/entradas/${tenantSlug}/${film.slug}`}
              className="ent-press block"
              style={{ '--accent': film.accent } as React.CSSProperties}
            >
              <Poster title={film.title} url={film.posterUrl} sizes="176px" />
              <span className="mt-3 block truncate text-sm font-semibold text-(--ent-cream)">
                {film.title}
              </span>
            </Link>
          </Reveal>
        ))}
      </ul>
    </section>
  )
}
