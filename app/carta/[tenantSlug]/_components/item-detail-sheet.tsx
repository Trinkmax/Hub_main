'use client'

import { ArrowLeft, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { posterUrlFor } from '@/lib/menu/media-urls'
import type { MenuItem } from '@/lib/menu/queries'
import { formatARS } from './format'
import { ItemImage, TagChip } from './item-visual'
import { useDismissOnBack } from './use-dismiss-on-back'

/**
 * Media del hero: si el ítem tiene video, autoplay muteado en loop con el
 * poster pregenerado (`_vp.webp`); tap togglea el sonido. Si el video falla
 * (o no hay), cae a la foto — y si tampoco hay foto, al poster del video.
 */
function HeroMedia({ item }: { item: MenuItem }): React.JSX.Element {
  const [muted, setMuted] = useState(true)
  const [videoFailed, setVideoFailed] = useState(false)

  const poster = item.video_url ? posterUrlFor(item.video_url) : null
  const showVideo = Boolean(item.video_url) && !videoFailed

  if (!showVideo) {
    return (
      <ItemImage
        src={item.image_url ?? poster}
        name={item.name}
        sizes="(max-width: 672px) 100vw, 672px"
        priority
      />
    )
  }

  return (
    <>
      {/* Video decorativo del plato: sin captions (arranca muteado, sin audio relevante). */}
      <video
        src={item.video_url ?? undefined}
        poster={poster ?? undefined}
        playsInline
        muted={muted}
        loop
        autoPlay
        preload="metadata"
        onClick={() => setMuted((m) => !m)}
        onError={() => setVideoFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        aria-label={muted ? 'Activar sonido' : 'Silenciar'}
        className="absolute right-3.5 top-3.5 z-20 flex size-9 items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
    </>
  )
}

/**
 * Detalle del ítem en bottom-sheet, READ-ONLY: imagen grande, descripción
 * completa, precio, hint de puntos y tags. Sin cantidad, sin notas, sin
 * "agregar" — el cierre es la única acción (botón "Volver" + grabber + atrás).
 */
export function ItemDetailSheet({
  item,
  onClose,
}: {
  item: MenuItem | null
  onClose: () => void
}): React.JSX.Element {
  const open = item !== null
  useDismissOnBack(open, onClose)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className="force-light max-h-[92dvh] gap-0 overflow-hidden rounded-t-3xl border-t-0 p-0"
        aria-describedby={undefined}
      >
        <AnimatePresence mode="wait">
          {item && (
            <motion.div
              key={item.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex h-full flex-col"
            >
              {/* HERO */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary/40">
                <SheetGrabber tone="light" />
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Volver"
                  className="absolute left-3.5 top-3.5 z-20 flex size-9 items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <ArrowLeft className="size-5" />
                </button>
                <HeroMedia item={item} />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background via-background/55 to-transparent"
                />
                {(item.tags.length > 0 || item.points_override != null) && (
                  <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1.5 px-5 pb-3">
                    {item.tags.map((tag) => (
                      <TagChip key={tag.id} tag={tag} className="px-2.5 py-0.5 text-[11px]" />
                    ))}
                    {item.points_override != null && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/95 px-2.5 py-0.5 text-[11px] font-semibold text-warning-foreground shadow-sm">
                        <Sparkles className="size-3" aria-hidden />+{item.points_override} pts
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* CONTENIDO */}
              <div className="flex-1 overflow-y-auto px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-5">
                <div className="flex items-start justify-between gap-4">
                  <SheetTitle className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance">
                    {item.name}
                  </SheetTitle>
                  <span className="mt-1 shrink-0 font-serif text-xl font-semibold tabular-nums [color:var(--brand-accent,var(--primary))]">
                    {formatARS(item.price_cents)}
                  </span>
                </div>

                {item.description ? (
                  <SheetDescription className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                    {item.description}
                  </SheetDescription>
                ) : (
                  <SheetDescription className="sr-only">{item.name}</SheetDescription>
                )}

                {item.points_override != null && (
                  <div className="mt-5 flex items-center gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3">
                    <Sparkles className="size-4 text-warning" aria-hidden />
                    <p className="text-sm text-foreground">
                      Sumás{' '}
                      <span className="font-semibold text-warning">
                        {item.points_override} puntos
                      </span>{' '}
                      con este producto.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  )
}
