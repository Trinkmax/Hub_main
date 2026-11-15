'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from 'react'
import { cn } from '@/lib/utils'
import {
  clamp,
  type DockGeometry,
  dockGeometry,
  EDGE_ZOOM,
  holeEdges,
  LENS_ZOOM,
  lensScale,
  lerp,
  magnifierTransform,
  nearestIndex,
  rubberBand,
  smoothstep,
  stretchFromVelocity,
} from './dock-geometry'
import { hapticTick } from './haptics'
import {
  createSpring,
  type Spring,
  snapSpring,
  springSettled,
  stepSpring,
  tuneSpring,
} from './spring'
import './dock.css'

export type DockItem = {
  key: string
  /** Lo que se lee en la barra: corto, entra en ~56 px. */
  label: string
  /** El nombre entero, para lectores de pantalla, si el corto no alcanza. */
  title?: string
  icon: LucideIcon
  /** Adónde lleva. Sin `href` es una acción (`onSelect`), como «Más». */
  href?: string
  onSelect?: () => void
  /** El número del globito (0 o null: sin globito). */
  badge?: number | null
  /** Abre una hoja (para lectores de pantalla). */
  opensDialog?: boolean
}

export type DockOrb = {
  /** Nombre accesible del círculo. */
  label: string
  content: ReactNode
  onPress: () => void
}

/** Cómo se mueve cada resorte. La amortiguación baja es el rebote. */
const MOTION = {
  glide: { stiffness: 520, damping: 38 },
  follow: { stiffness: 900, damping: 55 },
  slide: { stiffness: 420, damping: 34 },
  lift: { stiffness: 600, damping: 30 },
  stretch: { stiffness: 320, damping: 22 },
} as const
/** Al soltar, la lente vuela un instante más antes de caer (en iOS cae cuando ya llegó). */
const DROP_DELAY_MS = 110
/** Cuánto hay que correr el dedo para que deje de ser un toque y pase a ser arrastrar. */
const DRAG_SLOP_PX = 6
/** Con la lente bien levantada, la barra entera se infla esto. */
const INFLATE = 0.03

type Sim = {
  geo: DockGeometry | null
  x: Spring
  lift: Spring
  stretch: Spring
  pointer: {
    id: number
    startX: number
    index: number
    hover: number
    dragging: boolean
  } | null
  /** Cuándo cae la lente (0 = no hay caída pendiente). */
  dropAt: number
  raf: number
  last: number
  reduced: boolean
  /** La pestaña marcada, para lo que corre fuera de React (la caída). */
  active: number
  /** El gesto ya eligió: el click que viene detrás no tiene que navegar otra vez. */
  swallowClick: boolean
}

/**
 * La barra de abajo del celular, con el vidrio líquido de iOS 26.
 *
 * Una cápsula flotante con las pestañas y, aparte, un círculo opcional (el lugar del «Buscar» de iOS).
 * La pestaña activa lleva una píldora. Al apoyar el dedo la píldora se levanta y pasa a ser una lente de
 * vidrio, más alta que la barra. La lente sigue al dedo, se estira como una gota cuando corre y agranda lo
 * que tiene debajo (partiendo las palabras en su borde, con un filo de arcoíris). Al soltar, cae con un
 * rebote sobre la pestaña elegida y se navega.
 *
 * - La lupa no usa filtros SVG (Safari los ignora en `backdrop-filter`): es una copia de la fila adentro de
 *   la lente, agrandada alrededor de su centro (`magnifierTransform`). Anda igual en iPhone y Android.
 * - Todo lo que se mueve por cuadro se escribe directo en el DOM desde un único `requestAnimationFrame`
 *   que se apaga cuando los resortes se quedan quietos. React solo se entera de qué pestaña quedó.
 * - Las pestañas son `<Link>` de verdad: el teclado, el lector de pantalla y el clic sin gesto navegan
 *   como siempre, y la píldora se desliza sola cuando cambia la ruta.
 * - Con «reducir movimiento» no hay lente: la píldora se mueve y listo.
 */
export function LiquidDock({
  items,
  activeKey,
  label,
  orb = null,
  hidden = false,
  mobileOnly = false,
  scope,
  className,
}: {
  items: DockItem[]
  /** La pestaña de la página abierta (`null`: ninguna). */
  activeKey: string | null
  /** Nombre accesible de la barra. */
  label: string
  orb?: DockOrb | null
  hidden?: boolean
  /** Desde 1024 px no se muestra (en la compu manda el menú lateral). */
  mobileOnly?: boolean
  /** Para las reglas de CSS que dependen de qué barra es (`app`, `salon`, `wa`). */
  scope: string
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [navigating, startNavigation] = useTransition()
  const [keyboard, setKeyboard] = useState(false)

  const barRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLUListElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const lensRef = useRef<HTMLDivElement>(null)
  const coreRef = useRef<HTMLDivElement>(null)
  const edgeRef = useRef<HTMLDivElement>(null)

  const shownKey = pendingKey ?? activeKey
  const activeIndex = items.findIndex((item) => item.key === shownKey)

  const sim = useRef<Sim>({
    geo: null,
    x: createSpring(0, { ...MOTION.glide, precision: 0.05 }),
    lift: createSpring(0, { ...MOTION.lift, precision: 0.002 }),
    stretch: createSpring(0, { ...MOTION.stretch, precision: 0.002 }),
    pointer: null,
    dropAt: 0,
    raf: 0,
    last: 0,
    reduced: false,
    active: activeIndex,
    swallowClick: false,
  })
  sim.current.active = activeIndex

  /** Dibuja el estado de los resortes. Es lo único que toca el DOM en cada cuadro. */
  const paint = useCallback(() => {
    const s = sim.current
    const { geo } = s
    const bar = barRef.current
    const row = rowRef.current
    const pill = pillRef.current
    const lens = lensRef.current
    const core = coreRef.current
    const edge = edgeRef.current
    if (!geo || !bar || !row || !pill || !lens || !core || !edge) return

    const lift = clamp(s.lift.value, -0.25, 1.3)
    const up = clamp(lift, 0, 1)
    const stretch = s.stretch.value
    const x = s.x.value
    // Cuánto de lo que se ve es lente (y cuánto sigue siendo píldora).
    const reveal = smoothstep(0.04, 0.42, lift)
    const { sx, sy } = lensScale(geo, lift, stretch)

    const showPill = s.active >= 0 || s.pointer !== null
    pill.style.transform = `translate3d(${x - geo.pill.width / 2}px, ${geo.centerY - geo.pill.height / 2}px, 0) scale(${1 + stretch * 0.7}, ${1 - stretch * 0.3})`
    pill.style.opacity = String(showPill ? 1 - reveal : 0)

    lens.style.transform = `translate3d(${x - geo.lens.width / 2}px, ${geo.centerY - geo.lens.height / 2}px, 0) scale(${sx}, ${sy})`
    lens.style.opacity = String(reveal)
    lens.style.visibility = reveal > 0.002 ? 'visible' : 'hidden'

    if (reveal > 0.002) {
      core.style.transform = magnifierTransform(geo, x, { sx, sy }, lerp(1, LENS_ZOOM, up))
      edge.style.transform = magnifierTransform(geo, x, { sx, sy }, lerp(1, EDGE_ZOOM, up))
      // Lo que queda debajo de la lente se ve agrandado adentro: el original se tapa para no verlo doble.
      const hole = holeEdges(geo, x, sx)
      row.style.setProperty('--hole-l', `${hole.left.toFixed(1)}px`)
      row.style.setProperty('--hole-r', `${hole.right.toFixed(1)}px`)
      row.style.setProperty('--hole-a', (1 - reveal).toFixed(3))
      row.dataset.holed = ''
    } else if (row.dataset.holed !== undefined) {
      delete row.dataset.holed
    }

    bar.style.transform = lift > 0.001 ? `scale(${1 + INFLATE * lift})` : ''
  }, [])

  const frame = useCallback(
    (now: number) => {
      const s = sim.current
      const dt = s.last ? (now - s.last) / 1000 : 1 / 60
      s.last = now
      if (s.dropAt && now >= s.dropAt) {
        s.dropAt = 0
        s.lift.target = 0
        // Cae sobre la pestaña que quedó marcada (la elegida, o la de antes si fue «Más»).
        const target = s.geo?.centers[s.active]
        if (target !== undefined) s.x.target = target
      }
      stepSpring(s.x, dt)
      stepSpring(s.lift, dt)
      s.stretch.target = s.reduced ? 0 : stretchFromVelocity(s.x.velocity)
      stepSpring(s.stretch, dt)
      paint()
      const moving =
        s.pointer !== null ||
        s.dropAt !== 0 ||
        !springSettled(s.x) ||
        !springSettled(s.lift) ||
        !springSettled(s.stretch)
      if (moving) {
        s.raf = requestAnimationFrame(frame)
      } else {
        s.raf = 0
        s.last = 0
        snapSpring(s.x)
        snapSpring(s.lift)
        snapSpring(s.stretch)
        paint()
      }
    },
    [paint],
  )

  const kick = useCallback(() => {
    const s = sim.current
    if (s.raf) return
    s.last = 0
    s.raf = requestAnimationFrame(frame)
  }, [frame])

  // Medir la fila (y volver a medir si cambia el ancho: giro del celular, la tablet).
  useLayoutEffect(() => {
    const bar = barRef.current
    const row = rowRef.current
    if (!bar || !row) return
    const measure = () => {
      const s = sim.current
      const geo = dockGeometry({
        rowLeft: row.offsetLeft,
        rowTop: row.offsetTop,
        rowWidth: row.offsetWidth,
        rowHeight: row.offsetHeight,
        count: items.length,
      })
      s.geo = geo
      bar.style.setProperty('--row-w', `${geo.rowWidth}px`)
      bar.style.setProperty('--row-h', `${geo.rowHeight}px`)
      bar.style.setProperty('--pill-w', `${geo.pill.width}px`)
      bar.style.setProperty('--pill-h', `${geo.pill.height}px`)
      bar.style.setProperty('--lens-w', `${geo.lens.width}px`)
      bar.style.setProperty('--lens-h', `${geo.lens.height}px`)
      if (!s.pointer) snapSpring(s.x, geo.centers[Math.max(s.active, 0)] ?? 0)
      // Desde acá la píldora la ubica la física, no el CSS del primer dibujo.
      bar.dataset.live = ''
      paint()
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [items.length, paint])

  // «Reducir movimiento»: sin lente ni estiramiento.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      sim.current.reduced = query.matches
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // Cambió la pestaña marcada sin el dedo (teclado, un link de la página, «atrás»): la píldora se desliza.
  useEffect(() => {
    const s = sim.current
    if (!s.geo || s.pointer || s.dropAt) return
    const target = s.geo.centers[activeIndex]
    if (target === undefined) {
      paint()
      return
    }
    if (s.reduced) {
      snapSpring(s.x, target)
      paint()
      return
    }
    tuneSpring(s.x, MOTION.slide.stiffness, MOTION.slide.damping)
    s.x.target = target
    kick()
  }, [activeIndex, kick, paint])

  // La ruta ya cambió (o la navegación terminó): manda otra vez lo que dice la URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hay que soltar la pestaña optimista cada vez que cambia la ruta o termina la navegación
  useEffect(() => {
    if (!navigating) setPendingKey(null)
  }, [navigating, pathname])

  // Con el teclado del celular abierto, la barra se va: le deja todo el lugar al campo y al teclado.
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const editable = (node: EventTarget | null) =>
      node instanceof HTMLElement &&
      (node.isContentEditable ||
        node instanceof HTMLTextAreaElement ||
        (node instanceof HTMLInputElement &&
          !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(
            node.type,
          )))
    const onFocusIn = (event: FocusEvent) => {
      if (timer) clearTimeout(timer)
      if (editable(event.target)) setKeyboard(true)
    }
    const onFocusOut = () => {
      if (timer) clearTimeout(timer)
      // Pasar de un campo al siguiente no es cerrar el teclado: se mira un instante después.
      timer = setTimeout(() => setKeyboard(editable(document.activeElement)), 120)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  useEffect(
    () => () => {
      if (sim.current.raf) cancelAnimationFrame(sim.current.raf)
    },
    [],
  )

  /** Del dedo (pantalla) a la cápsula, descontando lo que está inflada. */
  const toLocal = useCallback((clientX: number) => {
    const bar = barRef.current
    if (!bar) return 0
    const box = bar.getBoundingClientRect()
    const scale = box.width / Math.max(bar.offsetWidth, 1)
    return (clientX - box.left) / scale
  }, [])

  const markHover = useCallback((index: number) => {
    const lens = lensRef.current
    if (!lens) return
    for (const cell of lens.querySelectorAll<HTMLElement>('[data-cell]')) {
      if (Number(cell.dataset.cell) === index) cell.dataset.hover = ''
      else delete cell.dataset.hover
    }
  }, [])

  const select = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item) return
      hapticTick()
      if (!item.href) {
        item.onSelect?.()
        return
      }
      if (index === sim.current.active && item.key === activeKey) {
        // La pestaña en la que ya estás: si estás más adentro (una ficha) vuelve a su raíz; si no, sube.
        if (pathname !== item.href) startNavigation(() => router.push(item.href as string))
        else window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      setPendingKey(item.key)
      sim.current.active = index
      startNavigation(() => router.push(item.href as string))
    },
    [activeKey, items, pathname, router],
  )

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const s = sim.current
    if (!s.geo || items.length === 0) return
    const index = nearestIndex(toLocal(event.clientX), s.geo.centers)
    s.pointer = { id: event.pointerId, startX: event.clientX, index, hover: index, dragging: false }
    s.swallowClick = false
    s.dropAt = 0
    event.currentTarget.setPointerCapture(event.pointerId)
    tuneSpring(s.x, MOTION.glide.stiffness, MOTION.glide.damping)
    s.x.target = s.geo.centers[index] ?? s.x.target
    s.lift.target = s.reduced ? 0 : 1
    markHover(index)
    const href = items[index]?.href
    if (href) router.prefetch(href)
    kick()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const s = sim.current
    const pointer = s.pointer
    if (!pointer || pointer.id !== event.pointerId || !s.geo) return
    if (!pointer.dragging) {
      if (Math.abs(event.clientX - pointer.startX) < DRAG_SLOP_PX) return
      pointer.dragging = true
      tuneSpring(s.x, MOTION.follow.stiffness, MOTION.follow.damping)
    }
    const centers = s.geo.centers
    const local = toLocal(event.clientX)
    s.x.target = rubberBand(local, centers[0] ?? 0, centers[centers.length - 1] ?? 0)
    const hover = nearestIndex(local, centers)
    if (hover !== pointer.hover) {
      pointer.hover = hover
      markHover(hover)
      hapticTick()
      const href = items[hover]?.href
      if (href) router.prefetch(href)
    }
    kick()
  }

  const release = (event: React.PointerEvent<HTMLDivElement>, chosen: boolean) => {
    const s = sim.current
    const pointer = s.pointer
    if (!pointer || pointer.id !== event.pointerId) return
    s.pointer = null
    tuneSpring(s.x, MOTION.glide.stiffness, MOTION.glide.damping)
    const index = pointer.dragging ? pointer.hover : pointer.index
    if (chosen) {
      s.swallowClick = true
      // Después de arrastrar el navegador no manda click: que no quede «tragado» el próximo (el teclado).
      setTimeout(() => {
        s.swallowClick = false
      }, 450)
      s.x.target = s.geo?.centers[index] ?? s.x.target
      select(index)
    }
    // La lente vuela un instante y cae (sobre la elegida, o vuelve a la de antes si se canceló).
    s.dropAt = performance.now() + (s.reduced || !chosen ? 0 : DROP_DELAY_MS)
    kick()
  }

  const dockStyle = { '--i': Math.max(activeIndex, 0), '--n': items.length } as CSSProperties

  return (
    <nav
      aria-label={label}
      className={cn('lg-dock', className)}
      data-scope={scope}
      data-mobile-only={mobileOnly ? '' : undefined}
      data-hidden={hidden ? '' : undefined}
      data-keyboard={keyboard ? '' : undefined}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: es la superficie del gesto (arrastrar la lente); lo que se activa son los links y botones de adentro, que siguen andando con teclado y lector de pantalla */}
      <div
        ref={barRef}
        className="lg-bar"
        style={dockStyle}
        data-pending={navigating ? '' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => release(event, true)}
        onPointerCancel={(event) => release(event, false)}
        onLostPointerCapture={(event) => release(event, false)}
        onClickCapture={(event) => {
          // El gesto ya eligió y navegó: el click que el navegador manda después no tiene que repetirlo.
          if (sim.current.swallowClick) {
            sim.current.swallowClick = false
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span aria-hidden className="lg-glass" />
        <span
          ref={pillRef}
          aria-hidden
          className="lg-pill"
          data-empty={activeIndex < 0 ? '' : undefined}
        />
        <ul ref={rowRef} className="lg-row">
          {items.map((item, index) => {
            const active = index === activeIndex
            const face = <ItemFace item={item} active={active} />
            return (
              <li key={item.key} className="lg-cell">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="lg-item"
                    aria-current={active ? 'page' : undefined}
                    aria-label={item.title}
                    draggable={false}
                  >
                    {face}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="lg-item"
                    aria-label={item.title ?? item.label}
                    aria-haspopup={item.opensDialog ? 'dialog' : undefined}
                    data-current={active ? '' : undefined}
                    onClick={() => item.onSelect?.()}
                  >
                    {face}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        <div ref={lensRef} aria-hidden className="lg-lens">
          <span className="lg-lens-fill" />
          <div className="lg-lens-zoom" data-part="core">
            <div ref={coreRef} className="lg-lens-core">
              <Replica items={items} activeIndex={activeIndex} />
            </div>
          </div>
          <div className="lg-lens-zoom" data-part="edge">
            <div ref={edgeRef} className="lg-lens-core">
              <Replica items={items} activeIndex={activeIndex} />
            </div>
          </div>
          <span className="lg-lens-rim" />
          <span className="lg-lens-glint" />
        </div>
      </div>

      {orb ? (
        <button type="button" className="lg-orb" aria-label={orb.label} onClick={orb.onPress}>
          <span aria-hidden className="lg-glass" />
          <span className="lg-orb-content">{orb.content}</span>
        </button>
      ) : null}
    </nav>
  )
}

/** La copia de la fila que se ve a través de la lente (decorativa: el lector de pantalla no la lee). */
function Replica({ items, activeIndex }: { items: DockItem[]; activeIndex: number }) {
  return (
    <ul className="lg-replica">
      {items.map((item, index) => (
        <li key={item.key} className="lg-cell" data-cell={index}>
          <span className="lg-item" data-current={index === activeIndex ? '' : undefined}>
            <ItemFace item={item} active={index === activeIndex} />
          </span>
        </li>
      ))}
    </ul>
  )
}

function ItemFace({ item, active }: { item: DockItem; active: boolean }) {
  const Icon = item.icon
  const badge = item.badge && item.badge > 0 ? (item.badge > 99 ? '99+' : String(item.badge)) : null
  return (
    <>
      <span className="lg-icon">
        <Icon aria-hidden strokeWidth={active ? 2.2 : 1.85} />
        {badge ? <span className="lg-badge">{badge}</span> : null}
      </span>
      <span className="lg-label">{item.label}</span>
    </>
  )
}
