'use client'

import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TourDefinition, TourStep } from './types'

/**
 * Motor de tours guiados in-context (coach marks): oscurece la pantalla y
 * recorta un "spotlight" sobre el elemento real de la UI, con una tarjeta
 * explicativa al lado. Sin dependencias: el spotlight es un div posicionado
 * sobre el target con un box-shadow gigante que oscurece todo lo demás, así
 * la transición entre pasos se anima sola (transition en top/left/width/height).
 *
 * Convención de anclaje: los pasos apuntan a `[data-tour="…"]`. Un paso sin
 * `target` (o cuyo target no está montado y tiene `fallbackCentered`) se
 * muestra como tarjeta centrada. Un paso cuyo target falta y NO es centrable
 * se saltea solo — así el tour no se rompe si la UI cambia.
 *
 * La tarjeta y el velo usan el kit HUB (§7.d): se reestilan, pero los ids,
 * el `localStorage` (`TourLauncher`) y los anclajes no cambian.
 */

type Rect = { top: number; left: number; width: number; height: number }

const SPOTLIGHT_PADDING = 8

function measure(target: string): Rect | null {
  const el = document.querySelector(target)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return {
    top: r.top - SPOTLIGHT_PADDING,
    left: r.left - SPOTLIGHT_PADDING,
    width: r.width + SPOTLIGHT_PADDING * 2,
    height: r.height + SPOTLIGHT_PADDING * 2,
  }
}

function scrollTargetIntoView(target: string): void {
  document.querySelector(target)?.scrollIntoView({ block: 'center', behavior: 'instant' })
}

export function GuidedTour({
  tour,
  open,
  onClose,
}: {
  tour: TourDefinition
  open: boolean
  onClose: (completed: boolean) => void
}) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Pasos realmente disponibles: los anclados a targets ausentes se filtran al
  // abrir (la UI puede variar por rol/estado). Los centrados quedan siempre.
  const [steps, setSteps] = useState<TourStep[]>(tour.steps)
  useEffect(() => {
    if (!open) return
    setSteps(
      tour.steps.filter((s) => !s.target || s.fallbackCentered || document.querySelector(s.target)),
    )
    setIndex(0)
  }, [open, tour])

  const step = steps[index]
  const total = steps.length
  const isLast = index === total - 1

  // Medición + seguimiento del target del paso actual.
  useEffect(() => {
    if (!open || !step) return
    let raf = 0
    if (step.target) {
      scrollTargetIntoView(step.target)
      // Espera un frame post-scroll para medir donde quedó.
      raf = requestAnimationFrame(() => setRect(step.target ? measure(step.target) : null))
    } else {
      setRect(null)
    }
    const onMove = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setRect(step.target ? measure(step.target) : null))
    }
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, step])

  // Foco a la tarjeta en cada paso (lectores de pantalla + teclado).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-enfocar al cambiar de paso es el efecto buscado
  useEffect(() => {
    if (open) cardRef.current?.focus()
  }, [open, index])

  const next = useCallback(() => {
    if (isLast) {
      onClose(true)
    } else {
      setIndex((i) => Math.min(i + 1, total - 1))
    }
  }, [isLast, onClose, total])

  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false)
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'Enter') {
        // Enter sobre un botón ya dispara su click — avanzar acá lo duplicaría.
        const target = e.target as HTMLElement | null
        if (target?.closest('button')) return
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, next, prev, onClose])

  if (!open || !step || total === 0) return null

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: el teclado se maneja global (Esc/flechas) en el listener de window
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-label={`Tutorial: ${tour.title}`}
      data-slot="tour"
      onClick={(e) => {
        // Click en el fondo avanza (gesto natural en mobile); la tarjeta frena la propagación.
        if (e.target === e.currentTarget) next()
      }}
    >
      <TourBackdrop rect={rect} />

      <TourCard
        ref={cardRef}
        step={step}
        rect={rect}
        index={index}
        total={total}
        isLast={isLast}
        onPrev={prev}
        onNext={next}
        onClose={() => onClose(false)}
      />
    </div>
  )
}

/**
 * El velo. Con un target medido es el spotlight: un div sobre el target con
 * una sombra gigante que tapa todo lo demás. Sin target (pasos centrados), el
 * velo entero. El color es el del velo de los diálogos (`--overlay`: tinta al
 * 40 % en claro, negro al 60 % en oscuro).
 *
 * El borde del recorte es un `outline`: el `boxShadow` en línea pisaba la
 * sombra de un `ring-*` (por eso el anillo de antes nunca se vio), y el
 * contorno además sobrevive al alto contraste de Windows, que borra las
 * sombras y con ellas el velo: ahí es lo único que marca el target. Con
 * «reducir movimiento» salta de un target al otro sin deslizarse.
 *
 * Exportado para los tests de render; la página usa `GuidedTour`.
 */
export function TourBackdrop({ rect }: { rect: Rect | null }) {
  if (!rect) {
    return <div aria-hidden data-slot="tour-scrim" className="absolute inset-0 bg-overlay" />
  }
  return (
    <div
      aria-hidden
      data-slot="tour-spotlight"
      className={cn(
        'pointer-events-none absolute rounded-xl outline-2 outline-primary',
        'transition-[top,left,width,height] duration-(--duration-overlay) ease-(--ease-move) motion-reduce:transition-none',
      )}
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        boxShadow: '0 0 0 9999px var(--overlay)',
      }}
    />
  )
}

/**
 * La tarjeta de cada paso, con el vocabulario del diálogo del kit (§3.7):
 * cartulina que flota con pelo de 1 px y sombra modal, título de sección,
 * cuerpo de 14 px y la X fantasma de 32 px (44 de área con el dedo).
 *
 * Exportada para los tests de render; la página usa `GuidedTour`.
 */
export function TourCard({
  ref,
  step,
  rect,
  index,
  total,
  isLast,
  onPrev,
  onNext,
  onClose,
}: {
  ref?: React.Ref<HTMLDivElement>
  step: TourStep
  rect: Rect | null
  index: number
  total: number
  isLast: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}) {
  // En pantallas chicas la tarjeta vive abajo, fija: siempre alcanzable con el
  // pulgar y nunca tapa mal el spotlight. En desktop se posiciona junto al target.
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const cb = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }, [])

  const style = useMemo<React.CSSProperties>(() => {
    if (isMobile || !rect) return {}
    const CARD_W = 360
    const CARD_H = 220 // estimación para decidir arriba/abajo
    const margin = 12
    const vw = window.innerWidth
    const vh = window.innerHeight
    const below = rect.top + rect.height + margin
    const top = below + CARD_H <= vh ? below : Math.max(margin, rect.top - CARD_H - margin)
    const left = Math.min(Math.max(margin, rect.left), vw - CARD_W - margin)
    return { top, left, width: CARD_W }
  }, [isMobile, rect])

  const progress = `Paso ${index + 1} de ${total}`

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: el click sólo frena la propagación (el fondo avanza al tocarlo); el teclado se maneja global en el listener de window
    <div
      ref={ref}
      role="document"
      tabIndex={-1}
      data-slot="tour-card"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        // Sin contorno propio: recibe el foco por código en cada paso, como el
        // contenido de un diálogo. Los botones de adentro sí dibujan el suyo.
        'absolute flex flex-col gap-3 rounded-2xl border border-border bg-popover p-5 text-popover-foreground shadow-modal outline-none',
        // Entra como un diálogo (opacidad + escala 0,97 en 220 ms); con
        // «reducir movimiento», solo el fundido.
        'animate-in fade-in-0 zoom-in-97 duration-(--duration-overlay) ease-(--ease-ui) motion-reduce:zoom-in-100',
        (isMobile || !rect) && 'inset-x-3 bottom-3 w-auto',
        !isMobile &&
          !rect &&
          'bottom-auto left-1/2 top-1/2 w-[min(440px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2',
      )}
      style={style}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p data-slot="tour-kicker" className="type-caption font-medium text-primary">
            {step.kicker ?? progress}
            {/* Con un kicker propio, los puntos son el único avance y van
                ocultos: el lector lo escucha igual. */}
            {step.kicker ? <span className="sr-only"> · {progress}</span> : null}
          </p>
          <h2 data-slot="tour-title" className="mt-1 type-section text-balance text-foreground">
            {step.title}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Salir del tutorial"
          data-slot="tour-close"
          // El ícono queda alineado con el borde del contenido y centrado
          // contra la línea del kicker.
          className="-mt-2 -mr-2"
        >
          <X aria-hidden />
        </Button>
      </div>

      <div data-slot="tour-body" className="type-body text-pretty text-muted-foreground">
        {step.body}
      </div>

      {step.demo ? (
        <div
          aria-hidden
          data-slot="tour-demo"
          className="pointer-events-none select-none rounded-xl border border-border bg-muted p-3"
        >
          {step.demo}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-1" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: los dots son puramente posicionales
              key={i}
              className={cn(
                'size-1.5 rounded-full transition-colors',
                i === index ? 'bg-primary' : i < index ? 'bg-primary/40' : 'bg-border-strong',
              )}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {index > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={onPrev} data-slot="tour-prev">
              <ArrowLeft aria-hidden />
              Anterior
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={onNext} data-slot="tour-next">
            {isLast ? (
              <>
                ¡Listo!
                <Check aria-hidden />
              </>
            ) : (
              <>
                Siguiente
                <ArrowRight aria-hidden />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
