'use client'

import { ChevronRight, ImageOff, Star } from 'lucide-react'
import Image from 'next/image'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { cn } from '@/lib/utils'

type Item = ActiveSessionStateData['menu'][number]['items'][number]

export function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

/** Texto claro u oscuro según luminancia del color hex del tag (YIQ). */
export function pickContrastText(bgHex: string): 'light' | 'dark' {
  if (!bgHex.startsWith('#') || bgHex.length !== 7) return 'light'
  const r = Number.parseInt(bgHex.slice(1, 3), 16)
  const g = Number.parseInt(bgHex.slice(3, 5), 16)
  const b = Number.parseInt(bgHex.slice(5, 7), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 'light'
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? 'dark' : 'light'
}

export function ItemRow({ item, onOpen }: { item: Item; onOpen: (item: Item) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="card-hairline group flex w-full items-stretch gap-3 rounded-2xl border border-border/60 bg-card p-2.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-card/95 hover:shadow-md"
    >
      <div className="relative size-[72px] shrink-0 overflow-hidden rounded-xl bg-secondary/40">
        {item.image_url ? (
          <Image
            src={item.image_url}
            alt=""
            fill
            sizes="72px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
            <ImageOff className="size-5" aria-hidden />
          </div>
        )}
        {item.featured && (
          <span
            role="img"
            className="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-warning/95 text-warning-foreground shadow-sm"
            aria-label="Destacado"
          >
            <Star className="size-3 fill-current" aria-hidden />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          <p className="line-clamp-1 font-medium leading-tight">{item.name}</p>
          {item.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
          )}
        </div>
        {(item.tags.length > 0 || item.points_override != null) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {item.tags.slice(0, 3).map((tag) => {
              const tone = pickContrastText(tag.color)
              return (
                <span
                  key={tag.id}
                  className={cn(
                    'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium leading-tight',
                    tone === 'light' ? 'text-white' : 'text-foreground',
                  )}
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </span>
              )
            })}
            {item.points_override != null && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-semibold leading-tight text-warning">
                +{item.points_override} pts
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end justify-between py-0.5 pl-1">
        <span className="font-serif text-base font-semibold tabular-nums">
          {ARSFormat(item.price_cents)}
        </span>
        <ChevronRight
          className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
    </button>
  )
}
