'use client'

import { LogOut, X } from 'lucide-react'
import Image from 'next/image'
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { clubLogout } from '@/lib/club-auth/actions'
import { cn } from '@/lib/utils'
import { useDismissOnBack } from '../../_components/use-dismiss-on-back'

/** Datos mínimos para las dos caras del cajón (el cuerpo llega en `children`). */
export type WalletSummary = {
  tenantName: string
  logoUrl: string | null
  firstName: string
  tierName: string | null
  tierColor: string | null
}

// ── Física del cajón ────────────────────────────────────────────────────────
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)' // easeOutQuint: desaceleración larga y suave (no brusca)
const FLICK = 0.4 // px/ms — un "envión" rápido decide el snap aunque el arrastre sea corto
const CLOSE_AT = 0.3 // fracción arrastrada hacia abajo para confirmar cierre (más difícil: evita cierres accidentales)
const MIN_MS = 340 // piso de duración: incluso un flick rápido se siente suave
const MAX_MS = 560 // recorrido completo: apertura/cierre calmos, premium

// Reposo cerrado por CSS (no px): el panel entero queda debajo de la pantalla, y se adapta solo cuando
// iOS muestra u oculta la barra de URL (cambia dvh). El px sólo se usa DURANTE el gesto/animación.
const REST_TRANSFORM = 'translateY(100%)'

// useLayoutEffect avisa en SSR; en cliente lo necesitamos para posicionar antes del paint.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/** Resistencia elástica al pasarse de los límites (asíntota suave hacia `max`). */
function rubber(overshoot: number, max = 120): number {
  return (1 - 1 / ((overshoot * 0.5) / max + 1)) * max
}

/**
 * Pie de la billetera: cerrar sesión + la línea legal.
 *
 * Va al FINAL del cuerpo scrolleable a propósito. El socio abre esto en la mesa
 * para que le escaneen el QR; un botón de salir cerca del carnet sería un
 * desastre táctil. Acá hay que scrollear hasta el fondo y además confirmar.
 */
function WalletFooter({
  tenantSlug,
  firstName,
}: {
  tenantSlug: string
  firstName: string
}): React.JSX.Element {
  return (
    <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-2 px-4 text-center">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="size-4" aria-hidden />
            Cerrar sesión
          </button>
        </AlertDialogTrigger>
        {/* El AlertDialog se portaliza al body, fuera del `force-light` del cajón:
            sin la clase acá saldría con el tema del sistema. */}
        <AlertDialogContent className="force-light">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar sesión, {firstName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a tener que volver a entrar con tu teléfono y tu contraseña. Tus puntos y
              beneficios quedan intactos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Seguir con mi sesión</AlertDialogCancel>
            <form action={clubLogout}>
              <input type="hidden" name="tenant_slug" value={tenantSlug} />
              <AlertDialogAction type="submit" className="h-11 w-full">
                Cerrar sesión
              </AlertDialogAction>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
        Tu billetera es personal. No compartas tu QR ni tu contraseña.
      </p>
    </div>
  )
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

/** Lo que la carta puede pedirle al cajón desde afuera (la barra de abajo lo abre). */
export type WalletDrawerHandle = { open: () => void }

/**
 * Cajón (drawer) de la billetera del cliente en la carta.
 *
 * Vive montado debajo de la pantalla y sube entero al abrirlo desde la barra de vidrio de la carta
 * (`carta-dock.tsx`, pestaña «Billetera»). Una sola superficie física: para cerrarlo el gesto se lleva
 * 1:1 con el dedo (el asa de arriba o el cuerpo, tirando hacia abajo) y al soltar hace snap por
 * distancia + velocidad con la curva de iOS.
 *
 * (Hasta el rediseño de noviembre 2026 asomaba un «labio» verde fijo abajo, que se arrastraba hacia
 * arriba. Lo reemplazó la barra, que además lleva el buscador.)
 *
 * Nota iOS (Fraunces): NO dejamos `transform` en reposo abierto. Un transform
 * persistente promueve una capa compositada y Safari rasteriza la serif fina
 * lavada. Por eso: transform SÓLO durante el gesto/animación; al asentar en
 * abierto lo QUITAMOS (`transform=''`) → sin capa, serif nítida.
 *
 * El scrim y el cromo de arriba se derivan de una custom property animable `--wallet-p`
 * (0 = cerrado, 1 = abierto), registrada con @property en globals.css para poder
 * transicionarla junto con el transform.
 */
export function WalletDrawer({
  summary,
  tenantSlug,
  children,
  initialOpen = false,
  onOpenChange,
  ref,
}: {
  summary: WalletSummary
  /** Necesario para cerrar sesión: la cookie de identidad es tenant-scoped. */
  tenantSlug: string
  children: React.ReactNode
  initialOpen?: boolean
  /** Avisa cuando abre o cierra (la carta esconde su barra mientras está abierto). */
  onOpenChange?: (open: boolean) => void
  ref?: Ref<WalletDrawerHandle>
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const [open, setOpen] = useState(initialOpen)
  const [collapsed, setCollapsed] = useState(false)
  const openRef = useRef(open)
  const geom = useRef({ peekY: 0 }) // cuánto baja el panel para quedar cerrado (su alto)
  /** Quién tenía el foco antes de abrir: se le devuelve al cerrar. */
  const returnFocus = useRef<HTMLElement | null>(null)
  /** Cuándo se abrió (ms): el fondo ignora el toque que todavía está en el aire (ver el SCRIM). */
  const openedAt = useRef(0)
  const curY = useRef(0) // posición actual del panel (para duración/decisiones al soltar)
  const settleTimer = useRef(0)

  useEffect(() => {
    openRef.current = open
  }, [open])

  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])
  useEffect(() => {
    onOpenChangeRef.current?.(open)
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

  /** Mide el alto del panel: es lo que tiene que bajar para quedar cerrado. */
  const measure = useCallback(() => {
    const panel = panelRef.current
    if (!panel) return
    geom.current.peekY = Math.max(0, panel.getBoundingClientRect().height)
  }, [])

  /** Asienta el cajón en reposo (sin transición). Abierto: sin transform (serif nítida).
   *  Cerrado: debajo de la pantalla por CSS (adaptativo a dvh) y sin dibujarse. */
  const settleRest = useCallback(
    (toOpen: boolean) => {
      const panel = panelRef.current
      const root = rootRef.current
      if (!panel || !root) return
      panel.style.transition = 'none'
      root.style.transition = 'none'
      if (toOpen) {
        panel.style.visibility = 'visible'
        panel.style.transform = '' // sin capa compositada → serif nítida
        curY.current = 0
        setVar(1)
      } else {
        panel.style.transform = REST_TRANSFORM
        // Cerrado no se dibuja: su sombra no asoma por el borde de abajo ni se puede tocar.
        panel.style.visibility = 'hidden'
        curY.current = geom.current.peekY
        setVar(0)
      }
      panel.style.willChange = ''
    },
    [setVar],
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
      // Duración proporcional a la distancia (recorrido corto = rápido, completo = calmo).
      // La velocidad sólo puede acortar levemente, con piso MIN_MS → nunca brusco.
      const frac = peekY ? Math.min(1, dist / peekY) : 1
      const base = MIN_MS + (MAX_MS - MIN_MS) * frac
      const ms = Math.round(
        velocity ? Math.max(MIN_MS, Math.min(base, dist / (Math.abs(velocity) * 0.6))) : base,
      )

      panel.style.visibility = 'visible'
      panel.style.willChange = 'transform'
      panel.style.transition = `transform ${ms}ms ${EASE}`
      root.style.transition = `--wallet-p ${ms}ms ${EASE}`
      place(targetY, toOpen ? 1 : 0)
      setOpen(toOpen)

      window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => {
        // Abierto: soltar la capa (serif nítida). Cerrado: abajo por CSS y sin dibujarse.
        panel.style.transform = toOpen ? '' : REST_TRANSFORM
        if (!toOpen) panel.style.visibility = 'hidden'
        panel.style.willChange = ''
        panel.style.transition = ''
        root.style.transition = ''
      }, ms + 40)
    },
    [place],
  )

  const openDrawer = useCallback(
    (v = 0) => {
      if (!openRef.current) {
        openedAt.current = performance.now()
        if (document.activeElement instanceof HTMLElement)
          returnFocus.current = document.activeElement
      }
      // Se mide y se parte de abajo recién al abrir: cerrado, el panel no tiene por qué estar al día.
      measure()
      if (!openRef.current) {
        const panel = panelRef.current
        if (panel) {
          panel.style.transition = 'none'
          panel.style.visibility = 'visible'
          panel.style.transform = `translateY(${geom.current.peekY}px)`
          curY.current = geom.current.peekY
          // Sin esto el navegador junta este estado con el de llegada y no anima.
          void panel.offsetHeight
        }
      }
      animateTo('open', v)
    },
    [animateTo, measure],
  )
  const closeDrawer = useCallback((v = 0) => animateTo('peek', v), [animateTo])

  useImperativeHandle(ref, () => ({ open: () => openDrawer() }), [openDrawer])

  // ── Posición inicial antes del primer paint (sin flash del panel entero) ────
  useIsoLayoutEffect(() => {
    measure()
    settleRest(openRef.current)
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Remedir en resize / rotación / toggle de la barra de URL de iOS; cerrado, se reasienta por CSS.
  useEffect(() => {
    const onResize = () => {
      measure()
      if (!openRef.current) settleRest(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measure, settleRest])

  // Bloquear scroll de fondo + mover foco al abrir; restaurar al cerrar.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Re-dispara el barrido de brillo del carnet cada vez que se abre la billetera
    // (su animación de montaje ya corrió invisible mientras estaba en peek).
    const card = panelRef.current?.querySelector<HTMLElement>('.carnet-sheen')
    if (card) {
      card.classList.remove('carnet-sheen')
      void card.offsetWidth // fuerza reflow → reinicia la animación del ::after
      card.classList.add('carnet-sheen')
    }

    const t = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 80)
    return () => {
      document.body.style.overflow = prevOverflow
      window.clearTimeout(t)
      returnFocus.current?.focus({ preventScroll: true })
      returnFocus.current = null
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

  // ── Gesto por puntero (el asa de arriba: tirar hacia abajo para cerrar) ───
  const drag = useRef<{
    startY: number
    lastY: number
    lastT: number
    v: number
    moved: boolean
  } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      measure()
      const panel = panelRef.current
      const root = rootRef.current
      if (panel) {
        panel.style.transition = 'none'
        panel.style.willChange = 'transform'
      }
      if (root) root.style.transition = 'none'
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // sin puntero activo (ej. evento sintético) → seguimos sin captura
      }
      drag.current = {
        startY: e.clientY,
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
      let y = dy
      if (y < 0)
        y = -rubber(-y) // resistencia al tirar hacia arriba de lo abierto
      else if (y > peekY) y = peekY + rubber(y - peekY)
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
      if (!d.moved) {
        // Un toque en el asa no hace nada: se queda abierto (reasienta).
        settleRest(true)
        return
      }
      const { peekY } = geom.current
      const traveled = peekY ? curY.current / peekY : 0
      if (traveled > CLOSE_AT || d.v > FLICK) closeDrawer(d.v)
      else animateTo('open', d.v)
    },
    [animateTo, closeDrawer, settleRest],
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
      else animateTo('open', v)
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
  }, [measure, place, animateTo, closeDrawer])

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
      {/* SCRIM — se oscurece con la openness; sólo intercepta toques cuando abre.
          La barra de la carta abre el cajón al LEVANTAR el dedo, y el navegador manda después el
          `click` de ese mismo toque: cae acá (el fondo ya está encima de la barra) y lo cerraba en el
          acto. Por eso un toque que llega pegado a la apertura no cuenta. */}
      <button
        type="button"
        aria-label="Cerrar mi billetera"
        tabIndex={open ? 0 : -1}
        onClick={() => {
          if (performance.now() - openedAt.current < 450) return
          closeDrawer()
        }}
        className={cn(
          'fixed inset-0 cursor-default bg-black',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        style={{ opacity: 'calc(var(--wallet-p) * 0.5)' }}
      />

      {/* PANEL — alto completo; transform lo lleva de cerrado (debajo de la pantalla) a abierto. */}
      <section
        ref={panelRef}
        aria-label="Mi billetera"
        aria-modal={open || undefined}
        role="dialog"
        // Cerrado, nada de adentro recibe foco ni lo lee el lector de pantalla.
        inert={!open}
        onKeyDown={onPanelKeyDown}
        style={initialOpen ? undefined : { transform: REST_TRANSFORM, visibility: 'hidden' }}
        className="bg-app-gradient pointer-events-auto fixed inset-x-0 bottom-0 flex h-[100dvh] flex-col overflow-hidden rounded-t-[1.75rem] shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.5)] outline-none"
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
              onPointerDown={onPointerDown}
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

          <WalletFooter tenantSlug={tenantSlug} firstName={summary.firstName} />

          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </section>
    </div>
  )
}
