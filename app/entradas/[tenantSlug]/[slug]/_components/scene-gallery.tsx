'use client'

import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GalleryItem } from '@/lib/ticketing/types'

/**
 * Escenas de la película: una tira que se desliza con el dedo y, al tocar
 * una, la escena en grande (con flechas, swipe y Esc). El visor es un
 * <dialog> nativo: el foco, el Esc y el fondo inerte los resuelve el
 * navegador.
 */
export function SceneGallery({ items, title }: { items: GalleryItem[]; title: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const trackRef = useRef<HTMLUListElement>(null)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const touchX = useRef<number | null>(null)
  const [current, setCurrent] = useState(0)

  const open = (index: number, trigger: HTMLButtonElement) => {
    returnFocus.current = trigger
    setCurrent(index)
    dialogRef.current?.showModal()
  }

  const go = useCallback(
    (delta: number) => setCurrent((i) => (i + delta + items.length) % items.length),
    [items.length],
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const onClose = () => returnFocus.current?.focus()
    dialog.addEventListener('close', onClose)
    return () => dialog.removeEventListener('close', onClose)
  }, [])

  const scrollBy = (dir: number) => {
    const track = trackRef.current
    if (!track) return
    const card = track.querySelector('li')
    track.scrollBy({ left: dir * ((card?.clientWidth ?? 300) + 12), behavior: 'smooth' })
  }

  const item = items[current]

  return (
    <div>
      <div className="mb-4 hidden justify-end gap-2 sm:flex">
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          className="ent-press grid size-11 place-items-center rounded-full border border-(--ent-line-strong) hover:bg-white/5"
          aria-label="Escenas anteriores"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => scrollBy(1)}
          className="ent-press grid size-11 place-items-center rounded-full border border-(--ent-line-strong) hover:bg-white/5"
          aria-label="Más escenas"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>

      <ul
        ref={trackRef}
        className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        {items.map((scene, i) => (
          <li key={scene.url} className="w-[78%] shrink-0 snap-start sm:w-[22rem]">
            <button
              type="button"
              onClick={(e) => open(i, e.currentTarget)}
              className="ent-press group relative block aspect-[16/10] w-full overflow-hidden rounded-2xl bg-(--ent-surface) text-left"
              aria-label={`Ver en grande: ${scene.caption ?? `escena ${i + 1} de ${title}`}`}
            >
              <Image
                src={scene.url}
                alt={scene.caption ?? `Escena de ${title}`}
                fill
                sizes="(min-width: 640px) 352px, 78vw"
                className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.04]"
              />
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              {scene.caption ? (
                <span className="absolute right-3 bottom-3 left-3 text-sm font-medium text-(--ent-cream)">
                  {scene.caption}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        aria-label={`Escenas de ${title}`}
        className="m-auto h-[min(88dvh,46rem)] w-[min(96vw,64rem)] max-w-none overflow-hidden rounded-3xl border border-(--ent-line-strong) bg-[#050806] p-0 text-(--ent-cream) backdrop:bg-black/85 backdrop:backdrop-blur-sm"
        // Tocar el fondo cierra; Esc lo cierra el <dialog> nativo y las
        // flechas pasan de escena.
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close()
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(1)
          if (e.key === 'ArrowLeft') go(-1)
        }}
      >
        {item ? (
          <div
            className="relative flex h-full flex-col"
            onTouchStart={(e) => {
              touchX.current = e.changedTouches[0]?.clientX ?? null
            }}
            onTouchEnd={(e) => {
              const start = touchX.current
              const end = e.changedTouches[0]?.clientX
              touchX.current = null
              if (start === null || end === undefined) return
              if (Math.abs(end - start) > 48) go(end < start ? 1 : -1)
            }}
          >
            <div className="relative min-h-0 flex-1">
              <Image
                key={item.url}
                src={item.url}
                alt={item.caption ?? `Escena de ${title}`}
                fill
                sizes="96vw"
                className="ent-step object-contain"
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-(--ent-line) px-4 py-3">
              <button
                type="button"
                onClick={() => go(-1)}
                className="ent-press grid size-11 place-items-center rounded-full hover:bg-white/10"
                aria-label="Escena anterior"
              >
                <ChevronLeft className="size-5" aria-hidden />
              </button>
              <p className="min-w-0 flex-1 truncate text-center text-sm text-(--ent-cream-2)">
                {item.caption ?? title}
                <span className="ent-mono ml-2 text-[0.6rem] text-(--ent-muted)">
                  {current + 1}/{items.length}
                </span>
              </p>
              <button
                type="button"
                onClick={() => go(1)}
                className="ent-press grid size-11 place-items-center rounded-full hover:bg-white/10"
                aria-label="Escena siguiente"
              >
                <ChevronRight className="size-5" aria-hidden />
              </button>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="ent-press absolute top-3 right-3 grid size-11 place-items-center rounded-full bg-black/60 hover:bg-black/80"
              aria-label="Cerrar"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        ) : null}
      </dialog>
    </div>
  )
}
