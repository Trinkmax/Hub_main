'use client'

import { Info, ZoomIn } from 'lucide-react'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** Debajo de esta escala el dibujo cuesta leerlo: aparece «Ampliar». */
const ZOOM_BELOW = 0.85

/**
 * El marco «Así se ve en ARCA» de las maquetas (diseño §5.1.2): un lienzo de ancho fijo (720 px
 * por defecto) que se achica con `ResizeObserver` para entrar en la columna, sin scroll de
 * costado en el celular. El alto se reserva desde el primer render con `aspect-ratio` (no salta
 * la página) y el dibujo aparece cuando se midió.
 *
 * - `role="img"` + `aria-label` describen la pantalla; el dibujo va con `aria-hidden` y todas
 *   las instrucciones están también en el texto del paso.
 * - Con la escala chica (el celular) aparece «Ampliar»: abre el dibujo en tamaño real, con
 *   scroll, para mirarlo de cerca.
 * - `approximate`: el sello «Puede verse distinto» (lo que la investigación no pudo confirmar).
 * - La maqueta conserva la paleta clara de ARCA en los dos temas, con borde visible.
 */
export function ScaledMock({
  width = 720,
  height,
  label,
  caption,
  approximate = false,
  frameLabel = 'Así se ve en ARCA',
  className,
  children,
}: {
  width?: number
  /** El alto del dibujo, en px (el contenido que no entra se recorta). */
  height: number
  /** Qué muestra la pantalla, para lectores de pantalla. */
  label: string
  caption?: ReactNode
  approximate?: boolean
  frameLabel?: string
  className?: string
  children: ReactNode
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState<number | null>(null)
  const [zoom, setZoom] = useState(false)

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const update = () => {
      const available = box.clientWidth
      // Escondido (un paso plegado): se mide cuando se abre.
      if (available > 0) setScale(Math.min(1, available / width))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(box)
    return () => observer.disconnect()
  }, [width])

  const small = scale !== null && scale < ZOOM_BELOW

  return (
    <figure className={cn('min-w-0 space-y-2', className)}>
      <div
        className="overflow-hidden rounded-lg border border-border bg-card shadow-xs ring-1 ring-black/5 dark:ring-white/10"
        style={{ maxWidth: width + 2 }}
      >
        <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 px-3 py-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {frameLabel}
          </span>
          {approximate ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning-text">
              <Info className="size-3" aria-hidden />
              Puede verse distinto
            </span>
          ) : null}
          {small ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-11 gap-1.5 px-2 text-xs md:h-8"
              onClick={() => setZoom(true)}
            >
              <ZoomIn className="size-4" aria-hidden />
              Ampliar
              <span className="sr-only">: {label}</span>
            </Button>
          ) : null}
        </div>
        <div
          ref={boxRef}
          role="img"
          aria-label={label}
          className="relative w-full overflow-hidden bg-white"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <div
            aria-hidden="true"
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width,
              height,
              transform: scale !== null && scale < 1 ? `scale(${scale})` : undefined,
              visibility: scale === null ? 'hidden' : undefined,
            }}
          >
            {children}
          </div>
          {small ? (
            // Atajo para el dedo: tocar el dibujo también lo amplía (el botón de arriba es el
            // control accesible, por eso este no entra en el orden del teclado).
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="absolute inset-0 cursor-zoom-in"
              onClick={() => setZoom(true)}
            />
          ) : null}
        </div>
      </div>
      {caption ? (
        <figcaption className="text-xs text-muted-foreground text-pretty">{caption}</figcaption>
      ) : null}

      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-h-[92dvh] gap-3 p-3 sm:max-w-[min(calc(100vw-2rem),780px)]">
          <DialogTitle className="pr-10 text-sm leading-snug">{label}</DialogTitle>
          <DialogDescription className="sr-only">
            La misma pantalla en tamaño real. Deslizá para recorrerla.
          </DialogDescription>
          <section
            aria-label={`Imagen ampliada: ${label}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: zona con scroll, tiene que poder recorrerse con el teclado
            tabIndex={0}
            className="max-h-[78dvh] overflow-auto rounded-md border border-border bg-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div aria-hidden="true" style={{ width, height }}>
              {children}
            </div>
          </section>
        </DialogContent>
      </Dialog>
    </figure>
  )
}
