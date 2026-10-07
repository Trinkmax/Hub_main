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
      onClick={(e) => {
        // Click en el fondo avanza (gesto natural en mobile); la tarjeta frena la propagación.
        if (e.target === e.currentTarget) next()
      }}
    >
      {/* Spotlight (o velo completo en pasos centrados) */}
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary/80 transition-all duration-300 ease-out"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px rgba(15, 20, 12, 0.62)',
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[rgba(15,20,12,0.62)]" />
      )}

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

function TourCard({
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
  ref: React.Ref<HTMLDivElement>
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

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: el click sólo frena la propagación (el fondo avanza al tocarlo); el teclado se maneja global en el listener de window
    <div
      ref={ref}
      role="document"
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-xl outline-none',
        'animate-in fade-in-0 zoom-in-95 duration-200',
        (isMobile || !rect) && 'inset-x-3 bottom-3 w-auto',
        !isMobile &&
          !rect &&
          'bottom-auto left-1/2 top-1/2 w-[min(440px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2',
      )}
      style={style}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            {step.kicker ?? `Paso ${index + 1} de ${total}`}
          </p>
          <h2 className="mt-1 font-serif text-lg font-semibold leading-snug">{step.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Salir del tutorial"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="text-sm leading-relaxed text-muted-foreground">{step.body}</div>

      {step.demo ? (
        <div
          aria-hidden
          className="pointer-events-none select-none rounded-xl border border-border/60 bg-secondary/30 p-3"
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
                i === index ? 'bg-primary' : i < index ? 'bg-primary/40' : 'bg-border',
              )}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {index > 0 ? (
            <Button variant="ghost" size="sm" onClick={onPrev} className="gap-1">
              <ArrowLeft className="size-3.5" aria-hidden />
              Anterior
            </Button>
          ) : null}
          <Button size="sm" onClick={onNext} className="gap-1">
            {isLast ? (
              <>
                ¡Listo!
                <Check className="size-3.5" aria-hidden />
              </>
            ) : (
              <>
                Siguiente
                <ArrowRight className="size-3.5" aria-hidden />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
