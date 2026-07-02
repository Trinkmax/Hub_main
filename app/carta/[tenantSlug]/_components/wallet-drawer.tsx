'use client'

import { ChevronUp, Wallet, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useDismissOnBack } from './use-dismiss-on-back'

/** Datos mínimos para las dos caras del cajón (el cuerpo llega en `children`). */
export type WalletSummary = {
  tenantName: string
  logoUrl: string | null
  firstName: string
  tierName: string | null
  tierColor: string | null
}

// ── Física del cajón ────────────────────────────────────────────────────────
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)' // curva de sheet de iOS (la misma que usa Vaul)
const FLICK = 0.4 // px/ms — un "envión" rápido decide el snap aunque el arrastre sea corto
const OPEN_AT = 0.16 // fracción arrastrada hacia arriba para confirmar apertura
const CLOSE_AT = 0.3 // fracción arrastrada hacia abajo para confirmar cierre (más difícil: evita cierres accidentales)
const LIP_FALLBACK = 76 // alto del labio antes de medirlo (evita flash en el primer paint)
const MIN_MS = 200
const MAX_MS = 460

// useLayoutEffect avisa en SSR; en cliente lo necesitamos para posicionar antes del paint.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/** Resistencia elástica al pasarse de los límites (asíntota suave hacia `max`). */
function rubber(overshoot: number, max = 120): number {
  return (1 - 1 / ((overshoot * 0.5) / max + 1)) * max
}

/** Chip compacto del nivel: color del nivel si es hex, sino el acento de marca. */
function TierChip({ name, color }: { name: string; color: string | null }): React.JSX.Element {
  const isHex = color !== null && /^#[0-9a-fA-F]{6}$/.test(color)
  return (
    <span
      style={isHex ? { backgroundColor: color, color: '#fff' } : undefined}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        !isHex &&
          'bg-[color:var(--brand-accent,var(--primary))] text-[color:var(--brand-accent-foreground,var(--primary-foreground))]',
      )}
    >
      {name}
    </span>
  )
}

/**
 * Cajón (drawer) de la billetera del cliente en la carta.
 *
 * A diferencia de un Sheet clásico (botón → diálogo full-screen), acá el borde
 * verde SIEMPRE está montado "asomando" desde abajo (estado `peek`) y se arrastra
 * hacia arriba hasta `open`. Una sola superficie física, el gesto se lleva 1:1 con
 * el dedo, y al soltar hace snap por distancia + velocidad con la curva de iOS.
 *
 * Nota iOS (Fraunces): NO dejamos `transform` en reposo abierto. Un transform
 * persistente promueve una capa compositada y Safari rasteriza la serif fina
 * lavada. Por eso: transform SÓLO durante el gesto/animación; al asentar en
 * abierto lo QUITAMOS (`transform=''`) → sin capa, serif nítida. En `peek` sí hay
 * transform, pero el cuerpo serif está fuera de pantalla, así que no importa.
 *
 * El cross-fade verde↔crema, el chevron y el scrim se derivan de una custom
 * property animable `--wallet-p` (0 = peek, 1 = open), registrada con @property
 * en globals.css para poder transicionarla junto con el transform.
 */
export function WalletDrawer({
  summary,
  children,
  initialOpen = false,
}: {
  summary: WalletSummary
  children: React.ReactNode
  initialOpen?: boolean
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const lipRef = useRef<HTMLButtonElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const [open, setOpen] = useState(initialOpen)
  const [collapsed, setCollapsed] = useState(false)
  const openRef = useRef(open)
  const geom = useRef({ peekY: 0 }) // desplazamiento en px del panel para el estado peek
  const curY = useRef(0) // posición actual del panel (para duración/decisiones al soltar)
  const settleTimer = useRef(0)

  useEffect(() => {
    openRef.current = open
  }, [open])

  // ── Primitivas de posición ────────────────────────────────────────────────
  const setVar = useCallback((p: number) => {
    rootRef.current?.style.setProperty('--wallet-p', String(p))
  }, [])

  /** Coloca el panel en `y` px y sincroniza la openness `p` (0..1). */
  const place = useCallback(
    (y: number, p: number) => {
      curY.current = y
      const panel = panelRef.current
      if (panel) panel.style.transform = `translateY(${y}px)`
      setVar(p)
    },
    [setVar],
  )

  /** Mide alto de labio/panel y recalcula el desplazamiento de peek. */
  const measure = useCallback(() => {
    const panel = panelRef.current
    if (!panel) return
    const h = panel.getBoundingClientRect().height
    const lip = lipRef.current?.offsetHeight || LIP_FALLBACK
    geom.current.peekY = Math.max(0, h - lip)
  }, [])

  /** Asienta el cajón en reposo (sin transición). En abierto QUITA el transform. */
  const settleRest = useCallback(
    (toOpen: boolean) => {
      const panel = panelRef.current
      const root = rootRef.current
      if (!panel || !root) return
      panel.style.transition = 'none'
      root.style.transition = 'none'
      if (toOpen) {
        panel.style.transform = '' // sin capa compositada → serif nítida
        curY.current = 0
        setVar(1)
      } else {
        place(geom.current.peekY, 0)
      }
      panel.style.willChange = ''
    },
    [place, setVar],
  )

  /** Anima hacia `open` o `peek` con la curva de iOS; duración según distancia/velocidad. */
  const animateTo = useCallback(
    (target: 'open' | 'peek', velocity = 0) => {
      const panel = panelRef.current
      const root = rootRef.current
      if (!panel || !root) return
      const { peekY } = geom.current
      const toOpen = target === 'open'
      const targetY = toOpen ? 0 : peekY
      const dist = Math.abs(targetY - curY.current)
      // envión rápido → animación corta; arrastre lento → cercana al tiempo natural.
      const byVel = velocity ? dist / (Math.abs(velocity) * 1.6) : MAX_MS
      const ms = Math.max(MIN_MS, Math.min(MAX_MS, Math.round(byVel)))

      panel.style.willChange = 'transform'
      panel.style.transition = `transform ${ms}ms ${EASE}`
      root.style.transition = `--wallet-p ${ms}ms ${EASE}`
      place(targetY, toOpen ? 1 : 0)
      setOpen(toOpen)

      window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => {
        if (toOpen) panel.style.transform = '' // asentado abierto: soltar la capa
        panel.style.willChange = ''
        panel.style.transition = ''
        root.style.transition = ''
      }, ms + 30)
    },
    [place],
  )

  const openDrawer = useCallback((v = 0) => animateTo('open', v), [animateTo])
  const closeDrawer = useCallback((v = 0) => animateTo('peek', v), [animateTo])

  // ── Posición inicial antes del primer paint (sin flash del panel entero) ────
  useIsoLayoutEffect(() => {
    measure()
    settleRest(openRef.current)
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Remedir en resize / rotación; si está en peek, reubicar.
  useEffect(() => {
    const onResize = () => {
      measure()
      if (!openRef.current) place(geom.current.peekY, 0)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measure, place])

  // Bloquear scroll de fondo + mover foco al abrir; restaurar al cerrar.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 80)
    return () => {
      document.body.style.overflow = prevOverflow
      window.clearTimeout(t)
      lipRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  // "Atrás" del teléfono cierra el cajón en vez de abandonar la carta.
  useDismissOnBack(open, closeDrawer)

  // Colapso del header por scroll (aparece la barra compacta).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setCollapsed(el.scrollTop > 48)
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  // ── Gesto por puntero (labio = abrir desde peek; asa = cerrar desde open) ───
  const drag = useRef<{
    from: 'peek' | 'open'
    startY: number
    baseY: number
    lastY: number
    lastT: number
    v: number
    moved: boolean
  } | null>(null)

  const onPointerDown = useCallback(
    (from: 'peek' | 'open') => (e: React.PointerEvent) => {
      if (e.button !== 0) return
      measure()
      const panel = panelRef.current
      const root = rootRef.current
      if (panel) {
        panel.style.transition = 'none'
        panel.style.willChange = 'transform'
      }
      if (root) root.style.transition = 'none'
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = {
        from,
        startY: e.clientY,
        baseY: from === 'peek' ? geom.current.peekY : 0,
        lastY: e.clientY,
        lastT: e.timeStamp,
        v: 0,
        moved: false,
      }
    },
    [measure],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current
      if (!d) return
      const { peekY } = geom.current
      const dy = e.clientY - d.startY
      let y = d.baseY + dy
      if (y < 0)
        y = -rubber(-y) // resistencia al pasar de abierto
      else if (y > peekY) y = peekY + rubber(y - peekY) // resistencia al pasar de peek
      const clamped = Math.max(0, Math.min(peekY, y))
      place(y, peekY ? 1 - clamped / peekY : 0)
      d.v = (e.clientY - d.lastY) / Math.max(1, e.timeStamp - d.lastT)
      d.lastY = e.clientY
      d.lastT = e.timeStamp
      if (Math.abs(dy) > 4) d.moved = true
    },
    [place],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current
      if (!d) return
      drag.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // el puntero ya pudo haberse liberado
      }
      const { peekY } = geom.current
      const p = peekY ? 1 - curY.current / peekY : d.from === 'open' ? 1 : 0
      if (!d.moved) {
        // Tap: en el labio abre; en el asa se queda abierto (reasienta).
        if (d.from === 'peek') openDrawer()
        else settleRest(true)
        return
      }
      if (d.from === 'peek') {
        if (p > OPEN_AT || d.v < -FLICK) openDrawer(d.v)
        else closeDrawer(d.v)
      } else {
        if (1 - p > CLOSE_AT || d.v > FLICK) closeDrawer(d.v)
        else openDrawer(d.v)
      }
    },
    [openDrawer, closeDrawer, settleRest],
  )

  // ── Arrastrar el CUERPO hacia abajo para cerrar (touch; sólo si el scroll está
  //    en el tope). Va por touch events para poder `preventDefault` el overscroll. ─
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let startY = 0
    let lastY = 0
    let lastT = 0
    let v = 0
    let active = false
    let pulling = false

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !openRef.current) return
      const t = e.touches[0]
      if (!t) return
      startY = lastY = t.clientY
      lastT = e.timeStamp
      v = 0
      active = true
      pulling = false
    }
    const onMove = (e: TouchEvent) => {
      if (!active) return
      const t = e.touches[0]
      if (!t) return
      const dy = t.clientY - startY
      if (!pulling) {
        if (dy > 6 && scroller.scrollTop <= 0) {
          pulling = true
          measure()
          const panel = panelRef.current
          const root = rootRef.current
          if (panel) {
            panel.style.transition = 'none'
            panel.style.willChange = 'transform'
          }
          if (root) root.style.transition = 'none'
        } else if (dy < -2 || scroller.scrollTop > 0) {
          active = false // es scroll normal
          return
        } else {
          return
        }
      }
      e.preventDefault()
      const { peekY } = geom.current
      const y = dy > peekY ? peekY + rubber(dy - peekY) : dy
      const clamped = Math.max(0, Math.min(peekY, y))
      place(y, peekY ? 1 - clamped / peekY : 0)
      v = (t.clientY - lastY) / Math.max(1, e.timeStamp - lastT)
      lastY = t.clientY
      lastT = e.timeStamp
    }
    const onEnd = () => {
      if (!active) return
      active = false
      if (!pulling) return
      pulling = false
      const { peekY } = geom.current
      const traveled = peekY ? curY.current / peekY : 0
      if (traveled > CLOSE_AT || v > FLICK) closeDrawer(v)
      else openDrawer(v)
    }

    scroller.addEventListener('touchstart', onStart, { passive: true })
    scroller.addEventListener('touchmove', onMove, { passive: false })
    scroller.addEventListener('touchend', onEnd, { passive: true })
    scroller.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      scroller.removeEventListener('touchstart', onStart)
      scroller.removeEventListener('touchmove', onMove)
      scroller.removeEventListener('touchend', onEnd)
      scroller.removeEventListener('touchcancel', onEnd)
    }
  }, [measure, place, openDrawer, closeDrawer])

  // Trampa de foco mínima + ESC mientras está abierto.
  const onPanelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDrawer()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const nodes = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])',
      )
      const focusable = Array.from(nodes).filter((n) => n.offsetParent !== null)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [open, closeDrawer],
  )

  return (
    <div
      ref={rootRef}
      className="force-light pointer-events-none fixed inset-0 z-40"
      style={{ '--wallet-p': initialOpen ? 1 : 0 } as React.CSSProperties}
    >
      {/* SCRIM — se oscurece con la openness; sólo intercepta toques cuando abre. */}
      <button
        type="button"
        aria-label="Cerrar mi billetera"
        tabIndex={open ? 0 : -1}
        onClick={() => closeDrawer()}
        className={cn(
          'absolute inset-0 cursor-default bg-black',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        style={{ opacity: 'calc(var(--wallet-p) * 0.5)' }}
      />

      {/* PANEL — alto completo; transform lo lleva de peek a open. */}
      <section
        ref={panelRef}
        aria-label="Mi billetera"
        aria-modal={open || undefined}
        role="dialog"
        onKeyDown={onPanelKeyDown}
        style={{ transform: initialOpen ? undefined : 'translateY(calc(100% - 4.75rem))' }}
        className="bg-app-gradient pointer-events-auto absolute inset-x-0 bottom-0 flex h-[100dvh] flex-col overflow-hidden rounded-t-[1.75rem] shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.5)] outline-none"
      >
        {/* CHROME (cara abierta): asa + barra compacta al scrollear. */}
        <div
          aria-hidden={!open}
          className="pointer-events-none absolute inset-x-0 top-0 z-20"
          style={{ opacity: 'var(--wallet-p)' }}
        >
          <div
            aria-hidden
            className={cn(
              'absolute inset-0 transition-opacity duration-200',
              collapsed
                ? 'border-b border-border/60 bg-background/80 opacity-100 backdrop-blur-md'
                : 'opacity-0',
            )}
          />
          <div className="relative pt-[max(env(safe-area-inset-top),10px)]">
            {/* Asa: también es tirador para cerrar (arrastrá hacia abajo). */}
            <button
              ref={handleRef}
              type="button"
              aria-label="Arrastrá para cerrar"
              tabIndex={-1}
              onPointerDown={onPointerDown('open')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="pointer-events-auto mx-auto flex h-6 w-16 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
            >
              <span className="h-1.5 w-10 rounded-full bg-foreground/25" />
            </button>
            <div
              aria-hidden={!collapsed}
              className={cn(
                'mt-1 flex items-center gap-2 pb-2.5 pl-4 pr-14 transition-opacity duration-200',
                collapsed ? 'opacity-100' : 'opacity-0',
              )}
            >
              {summary.logoUrl ? (
                <Image
                  src={summary.logoUrl}
                  alt={summary.tenantName}
                  width={140}
                  height={40}
                  className="h-6 w-auto max-w-[150px] shrink-0 object-contain"
                  unoptimized
                />
              ) : (
                <span className="min-w-0 truncate font-serif text-base font-semibold tracking-tight">
                  {summary.tenantName}
                </span>
              )}
              <span className="flex-1" />
              {summary.tierName ? (
                <TierChip name={summary.tierName} color={summary.tierColor} />
              ) : null}
            </div>
          </div>
        </div>

        {/* CERRAR — aparece al abrir. */}
        <button
          ref={closeRef}
          type="button"
          onClick={() => closeDrawer()}
          aria-label="Cerrar"
          tabIndex={open ? 0 : -1}
          className="absolute right-3.5 top-[max(env(safe-area-inset-top),10px)] z-40 flex size-9 items-center justify-center rounded-full bg-foreground/10 text-foreground/70 backdrop-blur-sm transition-colors hover:bg-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
          style={{ opacity: 'var(--wallet-p)', pointerEvents: open ? 'auto' : 'none' }}
        >
          <X className="size-5" />
        </button>

        {/* CUERPO scrolleable (cara abierta). */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <header className="mx-auto flex max-w-md flex-col items-center px-4 pb-1 pt-[calc(env(safe-area-inset-top)+3.75rem)] text-center">
            {summary.logoUrl ? (
              <Image
                src={summary.logoUrl}
                alt={summary.tenantName}
                width={200}
                height={85}
                className="h-11 w-auto max-w-[190px] object-contain"
                unoptimized
                priority
              />
            ) : (
              <p className="font-serif text-2xl font-semibold tracking-tight">
                {summary.tenantName}
              </p>
            )}
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">
              Hola, {summary.firstName}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Tu billetera de beneficios</p>
          </header>

          {children}

          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>

        {/* LABIO (cara peek): el borde verde que asoma. Botón + tirador para abrir. */}
        <button
          ref={lipRef}
          type="button"
          aria-label="Abrir mi billetera"
          aria-hidden={open}
          tabIndex={open ? -1 : 0}
          onPointerDown={onPointerDown('peek')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn(
            'absolute inset-x-0 top-0 z-30 flex touch-none select-none flex-col items-center gap-1.5 rounded-t-[1.75rem] bg-[color:var(--brand-accent,var(--primary))] px-4 pb-4 pt-2.5 text-[color:var(--brand-accent-foreground,var(--primary-foreground))] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70',
            open ? 'pointer-events-none' : 'pointer-events-auto cursor-grab active:cursor-grabbing',
          )}
          style={{ opacity: 'calc(1 - var(--wallet-p))' }}
        >
          <span className="h-1.5 w-10 rounded-full bg-current/40" aria-hidden />
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Wallet className="size-4" aria-hidden />
            Mi billetera
            <ChevronUp className="wallet-hint-bob size-4" aria-hidden />
          </span>
        </button>
      </section>
    </div>
  )
}
