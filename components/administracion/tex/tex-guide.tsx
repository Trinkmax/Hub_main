'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { usePathname } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { findTexTarget } from './tex-point'
import { useTex } from './tex-provider'
import { TexSprite, useTexFace } from './tex-sprite'

/** Lo busca un rato: la pantalla puede estar llegando. */
const FIND_TIMEOUT_MS = 4000
const AUTO_CLEAR_MS = 9000

type Box = { left: number; top: number; width: number; height: number }

function sameBox(a: Box | null, b: Box): boolean {
  return (
    a !== null &&
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  )
}

/** Dónde se para Tex: al lado de lo señalado, donde entre, sin taparlo. Puro. */
export function texPerch(
  box: Box,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
): { x: number; y: number; side: 'left' | 'right' | 'above' | 'below' } {
  const gap = 14
  const y = Math.min(
    Math.max(8, box.top + box.height / 2 - size.height / 2),
    viewport.height - size.height - 8,
  )
  if (box.left - size.width - gap >= 8) return { x: box.left - size.width - gap, y, side: 'left' }
  if (box.left + box.width + gap + size.width <= viewport.width - 8) {
    return { x: box.left + box.width + gap, y, side: 'right' }
  }
  const x = Math.min(Math.max(8, box.left), viewport.width - size.width - 8)
  if (box.top - size.height - gap >= 8) return { x, y: box.top - size.height - gap, side: 'above' }
  return {
    x,
    y: Math.min(box.top + box.height + gap, viewport.height - size.height - 8),
    side: 'below',
  }
}

/**
 * Tex va hasta lo que quiere mostrar: salta por la pantalla, se para al lado, lo marca y dice lo que
 * tenga que decir. La pantalla sigue andando: la marca no bloquea los clics.
 */
export function TexGuide() {
  const { pointing, guide, clearPoint, guideNext, guideClose, mood, talking } = useTex()
  const pathname = usePathname()
  const face = useTexFace({ talking, mood })
  const reduced = useReducedMotion()
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [viewport, setViewport] = useState({ width: 1280, height: 800 })
  const boxRef = useRef<Box | null>(null)
  const step = guide ? guide.steps[guide.index] : null
  const note = step?.note ?? pointing?.note ?? null
  const wanted = pointing?.text ?? null
  const active = Boolean(wanted || guide)

  // Busca el elemento. Vuelve a buscar si cambia lo pedido o la pantalla.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pointing.id` y la ruta disparan otra búsqueda.
  useEffect(() => {
    setTarget(null)
    setBox(null)
    boxRef.current = null
    if (!wanted) return
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout>
    const look = () => {
      const found = findTexTarget(wanted)
      if (found) {
        found.scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: reduced ? 'auto' : 'smooth',
        })
        setTarget(found)
        return
      }
      if (Date.now() - started < FIND_TIMEOUT_MS) {
        timer = setTimeout(look, 200)
        return
      }
      // No está en esta pantalla: Tex vuelve a su esquina. Lo que quería decir ya lo dijo en la charla.
      if (!guide) clearPoint()
    }
    timer = setTimeout(look, 120)
    return () => clearTimeout(timer)
  }, [wanted, pointing?.id, pathname, reduced, guide, clearPoint])

  // Lo sigue mientras la página se mueve.
  useLayoutEffect(() => {
    if (!target) return
    let raf = 0
    const tick = () => {
      if (!target.isConnected) {
        setTarget(null)
        return
      }
      const rect = target.getBoundingClientRect()
      const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      if (!sameBox(boxRef.current, next)) {
        boxRef.current = next
        setBox(next)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [target])

  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Se va solo si no hay nada que leer; con Esc, siempre.
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (guide) guideClose()
      else clearPoint()
    }
    window.addEventListener('keydown', onKey)
    const timer = !guide && !note ? setTimeout(clearPoint, AUTO_CLEAR_MS) : null
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer) clearTimeout(timer)
    }
  }, [active, guide, note, clearPoint, guideClose])

  if (!active) return null

  const spriteSize = { width: 110, height: 88 }
  const perch = box ? texPerch(box, viewport, spriteSize) : null
  const pad = 6

  return (
    <>
      <AnimatePresence>
        {box ? (
          <motion.div
            key="ring"
            data-tex-ui
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="tex-ring pointer-events-none fixed z-40"
            style={{
              left: box.left - pad,
              top: box.top - pad,
              width: box.width + pad * 2,
              height: box.height + pad * 2,
            }}
          >
            <span className="tex-ring-corner tex-ring-tl" />
            <span className="tex-ring-corner tex-ring-tr" />
            <span className="tex-ring-corner tex-ring-bl" />
            <span className="tex-ring-corner tex-ring-br" />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {perch ? (
        <motion.div
          data-tex-ui
          aria-hidden
          initial={
            reduced ? false : { x: viewport.width - 130, y: viewport.height - 100, opacity: 0 }
          }
          animate={{ x: perch.x, y: perch.y, opacity: 1 }}
          transition={
            reduced ? { duration: 0 } : { type: 'spring', stiffness: 150, damping: 17, mass: 0.9 }
          }
          className="pointer-events-none fixed top-0 left-0 z-40"
        >
          <TexSprite pose="support" face={face} scale={1.75} className="tex-hop" />
        </motion.div>
      ) : null}

      {note || guide ? (
        <motion.div
          data-tex-ui
          role="status"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="tex-bubble-note fixed z-40 grid w-[min(20rem,calc(100vw-2rem))] gap-2 px-3.5 py-3 text-sm leading-snug text-pretty"
          style={
            perch
              ? {
                  left: Math.min(Math.max(12, perch.x - 40), viewport.width - 332),
                  top:
                    perch.y + 96 + 150 < viewport.height
                      ? perch.y + 96
                      : Math.max(12, perch.y - 150),
                }
              : { right: 24, bottom: 120 }
          }
        >
          {guide ? (
            <p className="text-[11px] font-semibold tracking-wide uppercase opacity-70">
              {guide.title} · {guide.index + 1} de {guide.steps.length}
            </p>
          ) : null}
          {note ? <p>{note}</p> : null}
          <div className="flex items-center justify-end gap-2">
            {guide ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={guideClose}
                  className="h-8"
                >
                  Salir
                </Button>
                <Button type="button" size="sm" onClick={guideNext} className="h-8">
                  {guide.index + 1 === guide.steps.length ? 'Listo' : 'Seguir'}
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="ghost" onClick={clearPoint} className="h-8">
                Entendido
              </Button>
            )}
          </div>
        </motion.div>
      ) : null}
    </>
  )
}
