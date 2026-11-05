'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useCheering } from './tex-cheer'
import { useTex } from './tex-provider'
import { TexSprite, useTexFace, useTexLook } from './tex-sprite'
import { bottomBarHeight, useIsPhone } from './use-phone'

const HELLO_KEY = 'tex:saludo'
/** Sin moverse este rato, se duerme. */
const NAP_AFTER_MS = 4 * 60 * 1000
/** Cada cuánto mira si apareció o se fue una barra abajo. */
const BAR_CHECK_MS = 800
/** Lo que deja `.tex-dock` entre Tex y el borde de abajo de la pantalla, en el celular. */
const DOCK_BOTTOM_PX = 8

/** Lo último que dijo, en una línea que entre en el globito. */
export function shortLine(text: string): string {
  const clean = text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  return clean.length <= 120 ? clean : `${clean.slice(0, 117).trimEnd()}…`
}

/**
 * Tex parado en la esquina, esperando. Parpadea, mira al puntero, saluda la primera vez, se agacha
 * cuando la página se mueve para no tapar lo que se lee y se duerme si nadie lo usa. Al tocarlo se
 * agranda y abre la charla.
 */
export function TexDock() {
  const { setOpen, mood, talking, attach, cheers, items, canAttach, busy, pathname } = useTex()
  const cheering = useCheering(cheers)
  const baseFace = useTexFace({ talking, mood })
  const { ref, look } = useTexLook()
  const reduced = useReducedMotion()
  const [bubble, setBubble] = useState<string | null>(null)
  const [ducked, setDucked] = useState(false)
  const [asleep, setAsleep] = useState(false)
  const [dragging, setDragging] = useState(false)
  const phone = useIsPhone()
  // La barra de abajo de la pantalla: Tex se para arriba, no encima.
  const [bar, setBar] = useState(0)
  // Una pantalla que pide toda la atención, como un chat abierto: Tex no se mete.
  const [away, setAway] = useState(false)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const napTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Se presenta una sola vez por navegador.
  useEffect(() => {
    let seen = false
    try {
      seen = window.localStorage.getItem(HELLO_KEY) === '1'
      if (!seen) window.localStorage.setItem(HELLO_KEY, '1')
    } catch {
      seen = true
    }
    if (seen) return
    const show = setTimeout(() => setBubble('¡Hola! Soy Tex. Pedime lo que sea.'), 1200)
    const hide = setTimeout(() => setBubble(null), 8000)
    return () => {
      clearTimeout(show)
      clearTimeout(hide)
    }
  }, [])

  useEffect(() => {
    const onScroll = () => {
      setDucked(true)
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
      scrollTimer.current = setTimeout(() => setDucked(false), 700)
    }
    const wake = () => {
      setAsleep(false)
      if (napTimer.current) clearTimeout(napTimer.current)
      napTimer.current = setTimeout(() => setAsleep(true), NAP_AFTER_MS)
    }
    wake()
    // Con `capture` también escucha las listas que se corren adentro, como las de Mensajería. Con el dedo no
    // hay `pointermove` mientras se corre: el toque y el scroll también cuentan como estar acá.
    const options = { passive: true, capture: true }
    window.addEventListener('scroll', onScroll, options)
    window.addEventListener('scroll', wake, options)
    window.addEventListener('pointerdown', wake, options)
    window.addEventListener('pointermove', wake, options)
    window.addEventListener('keydown', wake)
    return () => {
      window.removeEventListener('scroll', onScroll, options)
      window.removeEventListener('scroll', wake, options)
      window.removeEventListener('pointerdown', wake, options)
      window.removeEventListener('pointermove', wake, options)
      window.removeEventListener('keydown', wake)
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
      if (napTimer.current) clearTimeout(napTimer.current)
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: al cambiar de pantalla hay que volver a mirar.
  useEffect(() => {
    if (!phone) {
      setBar(0)
      setAway(false)
      return
    }
    const check = () => {
      setBar(bottomBarHeight())
      setAway(document.querySelector('[data-tex-away]') !== null)
    }
    check()
    const timer = setInterval(check, BAR_CHECK_MS)
    return () => clearInterval(timer)
  }, [phone, pathname])

  // Con un archivo en la mano, abre la boca: también se lo pueden pasar a él.
  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (event: DragEvent) => {
      if (!canAttach || !hasFiles(event)) return
      depth += 1
      setDragging(true)
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onEnd = () => {
      depth = 0
      setDragging(false)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onEnd, true)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onEnd, true)
    }
  }, [canAttach])

  useEffect(() => {
    if (dragging) document.documentElement.dataset.texDrag = ''
    else delete document.documentElement.dataset.texDrag
    return () => {
      delete document.documentElement.dataset.texDrag
    }
  }, [dragging])

  // Si el panel se achicó para mostrar algo y Tex sigue hablando, se lee en su globito.
  const last = items.at(-1)
  const lastText = last?.kind === 'tex' ? last.text : ''
  const [saying, setSaying] = useState<string | null>(null)
  const heard = useRef(lastText)
  useEffect(() => {
    // Lo que ya se leyó adentro del panel no se repite al cerrarlo.
    if (!lastText || lastText === heard.current) return
    heard.current = lastText
    setSaying(shortLine(lastText))
    const timer = setTimeout(() => setSaying(null), 7000)
    return () => clearTimeout(timer)
  }, [lastText])

  const face = asleep ? 'sleep' : dragging ? 'o' : cheering ? 'happy' : baseFace
  const pose = cheering ? 'goals' : busy ? 'analytics' : 'wave'
  const say = dragging ? 'También me lo podés pasar a mí.' : (saying ?? bubble)
  // En el celular se queda asomado: solo la gorra y los ojos, para no tapar lo que se lee. Sale entero
  // cuando tiene algo que decir o está en algo.
  const peeking = phone && !say && !busy && !cheering
  const sunk = ducked ? 52 : peeking ? 36 : 0
  // Parado sobre una barra, lo que se hunde queda atrás de la barra, como atrás del borde de la pantalla.
  const lift = bar > 0 ? bar - DOCK_BOTTOM_PX : 0

  return (
    <motion.div
      data-tex-ui
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const file = event.dataTransfer.files[0]
        if (!file || !canAttach) return
        // Es de Tex: el arrastre general de Administración no se entera.
        event.preventDefault()
        event.stopPropagation()
        attach(file)
      }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.6 }}
      animate={
        reduced
          ? { opacity: 1, y: -lift }
          : {
              opacity: 1,
              y: sunk - lift,
              scale: 1,
              clipPath: `inset(-40rem -40rem ${lift > 0 ? sunk : 0}px -40rem)`,
            }
      }
      exit={reduced || phone ? { opacity: 0 } : { opacity: 0, scale: 1.5, y: -30 }}
      transition={{ type: 'spring', stiffness: 380, damping: 24 }}
      className={cn('tex-dock fixed z-30', away && 'hidden')}
    >
      <AnimatePresence>
        {say ? (
          <motion.button
            key="bubble"
            type="button"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.92 }}
            className="tex-bubble-note absolute bottom-full left-1 mb-2 w-max max-w-[min(14rem,calc(100vw-2rem))] px-3 py-2 text-left text-[13px] leading-snug text-pretty lg:right-2 lg:left-auto"
          >
            {say}
          </motion.button>
        ) : null}
      </AnimatePresence>
      <button
        ref={ref as React.RefObject<HTMLButtonElement>}
        type="button"
        onClick={() => setOpen(true)}
        onPointerEnter={(event) => {
          // Con el dedo no hay «pasar por encima»: el globito aparecería justo al tocar para abrir.
          if (event.pointerType === 'mouse') setBubble((b) => b ?? 'Pedime lo que sea. ⌘J')
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setBubble(null)
        }}
        aria-label="Abrir Tex, tu asistente"
        aria-keyshortcuts="Meta+J"
        className="tex-dock-button group relative block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TexSprite
          pose={pose}
          face={face}
          look={look}
          scale={2}
          className="tex-idle max-lg:hidden"
        />
        <TexSprite pose={pose} face={face} look={look} scale={1.5} className="tex-idle lg:hidden" />
        {asleep ? (
          <span
            aria-hidden
            className="tex-zzz absolute top-0 right-3 font-mono text-xs font-bold text-(--tex-mid)"
          >
            z
          </span>
        ) : null}
      </button>
    </motion.div>
  )
}
