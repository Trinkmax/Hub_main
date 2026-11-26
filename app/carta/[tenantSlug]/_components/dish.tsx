'use client'

import { Play, Star } from 'lucide-react'
import { Fragment, useRef } from 'react'
import { StorageImage } from '@/components/media/storage-image'
import type { ItemTag } from '@/lib/item-tags/queries'
import { posterUrlFor } from '@/lib/menu/media-urls'
import type { MenuItem } from '@/lib/menu/queries'
import { cn } from '@/lib/utils'
import { formatARS } from './format'

/**
 * Las piezas con las que la carta muestra un producto. Las tres avisan lo mismo al tocarlas
 * (`onOpen`): qué producto es y desde qué recuadro sale su foto, para que la ficha la haga crecer
 * desde ahí.
 *
 * - `DishCard`: la tarjeta de una galería (foto cuadrada arriba, nombre, descripción y precio abajo).
 * - `DishFeature`: un recomendado adentro de una galería, a todo el ancho.
 * - `DishRow`: la fila de una lista (cartas de vinos, cafés) y de los resultados del buscador.
 */
export type OpenDish = (item: MenuItem, from: HTMLElement | null) => void

/** La foto de un producto: la suya o, si solo tiene video, su cuadro de portada. */
export function photoOf(item: Pick<MenuItem, 'image_url' | 'video_url'>): string | null {
  return item.image_url ?? (item.video_url ? posterUrlFor(item.video_url) : null)
}

/**
 * Las etiquetas del producto: un punto con el color que eligió el bar y el nombre en la tinta de la
 * carta. El color avisa sin pintar un cartel de otro color sobre el papel.
 */
export function DishTags({
  tags,
  className,
  max,
}: {
  tags: ItemTag[]
  className?: string
  max?: number
}): React.JSX.Element | null {
  if (tags.length === 0) return null
  const shown = max ? tags.slice(0, max) : tags
  return (
    <ul className={cn('flex flex-wrap gap-x-3 gap-y-1', className)}>
      {shown.map((tag) => (
        <li
          key={tag.id}
          className="flex items-center gap-1.5 text-[0.75rem] font-medium leading-none"
        >
          <span
            aria-hidden
            className="size-[0.4375rem] rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
        </li>
      ))}
    </ul>
  )
}

function Price({ cents, className }: { cents: number; className?: string }): React.JSX.Element {
  return (
    <span className={cn('font-semibold tracking-[-0.01em] text-(--carta-green)', className)}>
      {formatARS(cents)}
    </span>
  )
}

/** Marcas chicas sobre la foto: tiene video, es un recomendado. */
function PhotoMarks({ item, starLabel }: { item: MenuItem; starLabel?: boolean }) {
  return (
    <>
      {item.featured ? (
        <span className="absolute left-2 top-2 flex h-6 items-center gap-1 rounded-full bg-warning px-1.5 text-[0.6875rem] font-semibold text-warning-foreground shadow-sm">
          <Star className="size-3 fill-current" aria-hidden />
          {starLabel ? <span className="pr-0.5">Recomendado</span> : null}
          {starLabel ? null : <span className="sr-only">Recomendado</span>}
        </span>
      ) : null}
      {item.video_url ? (
        <span className="absolute bottom-2 left-2 flex size-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
          <Play className="size-3 fill-current" aria-hidden />
          <span className="sr-only">Tiene video</span>
        </span>
      ) : null}
    </>
  )
}

const ART = 'relative w-full overflow-hidden rounded-[1.375rem] bg-(--carta-paper-2)'

export function DishCard({
  item,
  onOpen,
  priority = false,
}: {
  item: MenuItem
  onOpen: OpenDish
  priority?: boolean
}): React.JSX.Element {
  const artRef = useRef<HTMLDivElement>(null)
  const photo = photoOf(item)
  const description = item.description?.trim() || null

  return (
    <button
      type="button"
      onClick={() => onOpen(item, photo ? artRef.current : null)}
      className="carta-press carta-focus flex w-full flex-col rounded-[1.375rem] text-left"
    >
      <div
        ref={artRef}
        data-art-of={photo ? item.id : undefined}
        className={cn(ART, 'aspect-square')}
      >
        {photo ? (
          <StorageImage
            src={photo}
            sizes="(min-width: 1024px) 236px, (min-width: 640px) 30vw, 46vw"
            priority={priority}
          />
        ) : description ? (
          // Sin foto, su recuadro lleva lo que sí se sabe de él: de qué está hecho.
          <p className="absolute inset-0 flex items-end p-3.5 font-serif text-[1rem] leading-[1.3] text-(--carta-green)">
            <span className="line-clamp-6 text-pretty">{description}</span>
          </p>
        ) : (
          <h3 className="absolute inset-0 flex items-end p-3.5 font-serif text-[1.3rem] font-medium leading-[1.12] tracking-[-0.015em] text-(--carta-green)">
            <span className="line-clamp-5 text-balance">{item.name}</span>
          </h3>
        )}
        <PhotoMarks item={item} />
      </div>
      <div className="mt-2.5 flex flex-col gap-1 px-0.5 pb-1">
        {photo || description ? (
          <h3 className="text-[0.9375rem] font-semibold leading-[1.25] tracking-[-0.012em] text-pretty">
            {item.name}
          </h3>
        ) : null}
        {photo && description ? (
          <p className="line-clamp-2 text-[0.8125rem] leading-[1.38] text-(--carta-soft)">
            {description}
          </p>
        ) : null}
        <Price cents={item.price_cents} className="mt-0.5 text-[0.9375rem]" />
        <DishTags tags={item.tags} max={2} className="mt-0.5" />
      </div>
    </button>
  )
}

export function DishFeature({
  item,
  onOpen,
}: {
  item: MenuItem
  onOpen: OpenDish
}): React.JSX.Element {
  const artRef = useRef<HTMLDivElement>(null)
  const photo = photoOf(item)

  return (
    <button
      type="button"
      onClick={() => onOpen(item, photo ? artRef.current : null)}
      className="carta-press carta-focus flex w-full flex-col rounded-[1.375rem] text-left"
    >
      <div
        ref={artRef}
        data-art-of={photo ? item.id : undefined}
        className={cn(ART, 'aspect-[16/10]')}
      >
        {photo ? <StorageImage src={photo} sizes="(min-width: 1024px) 500px, 94vw" /> : null}
        <PhotoMarks item={item} starLabel />
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-4 px-0.5">
        <h3 className="font-serif text-[1.375rem] font-medium leading-[1.12] tracking-[-0.02em] text-pretty">
          {item.name}
        </h3>
        <Price cents={item.price_cents} className="shrink-0 text-[1rem]" />
      </div>
      {item.description ? (
        <p className="mt-1.5 line-clamp-3 px-0.5 text-[0.875rem] leading-[1.45] text-(--carta-soft)">
          {item.description}
        </p>
      ) : null}
      <DishTags tags={item.tags} className="mt-2 px-0.5" />
    </button>
  )
}

/** El nombre con los tramos que coinciden con lo buscado marcados. */
function Highlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  if (ranges.length === 0) return text
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const [from, to] of ranges) {
    if (from > cursor)
      parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor, from)}</Fragment>)
    parts.push(<mark key={`m${from}`}>{text.slice(from, to)}</mark>)
    cursor = to
  }
  if (cursor < text.length) parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor)}</Fragment>)
  return parts
}

/**
 * La descripción en una lista. Si viene en dos partes (un renglón corto y después el resto, como en las
 * cartas de vinos: «Malbec · Mendoza, Valle de Uco» y abajo las notas), el primer renglón va como dato.
 */
function RowDescription({ text }: { text: string | null }): React.JSX.Element | null {
  const clean = text?.trim()
  if (!clean) return null
  const cut = clean.indexOf('\n')
  const lead = cut > 0 && cut <= 72 ? clean.slice(0, cut).trim() : null
  const rest = lead ? clean.slice(cut + 1).trim() : clean
  return (
    <div className="mt-1 text-[0.84rem] leading-[1.45] text-(--carta-soft)">
      {lead ? <p className="font-medium text-foreground/85">{lead}</p> : null}
      {rest ? (
        <p className={cn('whitespace-pre-line', lead ? 'line-clamp-2' : 'line-clamp-3')}>{rest}</p>
      ) : null}
    </div>
  )
}

export function DishRow({
  item,
  onOpen,
  ranges,
  where,
}: {
  item: MenuItem
  onOpen: OpenDish
  /** En el buscador: qué parte del nombre coincide. */
  ranges?: Array<[number, number]>
  /** En el buscador: en qué lugar de la carta está. */
  where?: string
}): React.JSX.Element {
  const artRef = useRef<HTMLDivElement>(null)
  const photo = photoOf(item)

  return (
    <button
      type="button"
      onClick={() => onOpen(item, photo ? artRef.current : null)}
      className="carta-press carta-focus flex w-full items-start gap-3.5 rounded-xl py-4 text-left"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-[1rem] font-semibold leading-[1.25] tracking-[-0.012em] text-pretty">
            <Highlighted text={item.name} ranges={ranges ?? []} />
          </h3>
          <Price cents={item.price_cents} className="shrink-0 text-[0.9375rem]" />
        </div>
        {where ? (
          <p className="mt-1 text-[0.8125rem] leading-snug text-(--carta-soft)">{where}</p>
        ) : (
          <RowDescription text={item.description} />
        )}
        <DishTags tags={item.tags} className="mt-2" />
      </div>
      {photo ? (
        <div
          ref={artRef}
          data-art-of={item.id}
          className="relative size-16 shrink-0 overflow-hidden rounded-2xl bg-(--carta-paper-2)"
        >
          <StorageImage src={photo} sizes="64px" />
        </div>
      ) : null}
    </button>
  )
}
