'use client'

import { useEffect, useRef, useState } from 'react'
import type { ExperienceStep } from '@/lib/ticketing/types'

/**
 * El menú como tira de película: cada paso es un cuadro y se «enciende»
 * cuando pasa por el centro de la pantalla, como si el proyector avanzara.
 * Arriba, una barra cuenta cuántos pasos ya pasaron.
 *
 * Sin JS se ven todos encendidos (el CSS los deja a media luz solo cuando
 * este componente ya está andando).
 */
export function MenuReel({ steps }: { steps: ExperienceStep[] }) {
  const [active, setActive] = useState<number | null>(null)
  const [seen, setSeen] = useState(0)
  const [ready, setReady] = useState(false)
  const frames = useRef<Array<HTMLLIElement | null>>([])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    setReady(true)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const index = Number((entry.target as HTMLElement).dataset.index ?? 0)
          setActive(index)
          setSeen((prev) => Math.max(prev, index + 1))
        }
      },
      // La franja del medio de la pantalla: el cuadro que la cruza es el que
      // «está pasando».
      { rootMargin: '-42% 0px -42% 0px', threshold: 0 },
    )
    for (const frame of frames.current) {
      if (frame) observer.observe(frame)
    }
    return () => observer.disconnect()
  }, [])

  const total = steps.length

  return (
    <div>
      <div className="mb-4 flex items-center gap-3" aria-hidden>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full origin-left rounded-full bg-(--accent) transition-transform duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{ transform: `scaleX(${ready ? seen / total : 1})` }}
          />
        </div>
        <span className="ent-mono ent-num text-[0.62rem] text-(--ent-muted)">
          {ready ? Math.max(seen, 1) : total} / {total}
        </span>
      </div>

      <ol className="ent-strip">
        {steps.map((step, i) => {
          const isActive = active === i
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: los pasos no tienen id y su orden es el del menú
              key={`${i}-${step.title}`}
              ref={(el) => {
                frames.current[i] = el
              }}
              data-index={i}
              className="ent-frame"
              data-active={isActive ? 'true' : 'false'}
              data-seen={!ready || i < seen ? 'true' : 'false'}
            >
              {/* Arriba el número del cuadro, el rótulo y el ícono; abajo el
                  texto a todo el ancho (en el celular, con el número y el
                  ícono a los costados, la descripción quedaba en un hilo). */}
              <div className="flex items-center gap-3">
                <span className="ent-frame-num ent-num shrink-0" aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="ent-mono min-w-0 flex-1 text-[0.6rem] text-(--ent-gold)">
                  {step.label ?? `Paso ${String(i + 1).padStart(2, '0')}`}
                </p>
                {step.icon ? (
                  <span
                    aria-hidden
                    className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/[0.06] text-2xl"
                  >
                    {step.icon}
                  </span>
                ) : null}
              </div>
              <h3 className="ent-display mt-3 text-[1.6rem] leading-[1.05] text-balance sm:text-[1.85rem]">
                {step.title}
              </h3>
              {step.description ? (
                <p className="mt-2 text-[0.95rem] leading-relaxed text-(--ent-cream-2)">
                  {step.description}
                </p>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
