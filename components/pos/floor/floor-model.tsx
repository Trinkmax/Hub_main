'use client'

import {
  Armchair,
  BellRing,
  CalendarClock,
  Flame,
  type LucideIcon,
  Receipt,
  UtensilsCrossed,
} from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fitBounds, mixCamera, PLAN_CAMERA, turned } from '@/lib/pos/floor/projection'
import {
  buildScene,
  chooseCamera,
  labelSize,
  nearestAnchor,
  type Scene,
  type Solid,
} from '@/lib/pos/floor/scene'
import {
  formatMinutes,
  formatMinutesTight,
  STATE_LABEL,
  type TableState,
  type TableStateKey,
} from '@/lib/pos/table-state'
import type { FloorElement } from '@/lib/pos/types'
import { cn } from '@/lib/utils'
import './floor-move.css'

/**
 * La maqueta de un sector.
 *
 * Dibuja el plano como un modelo de cartón visto de tres cuartos: mesas con
 * volumen, sillas, y un comensal sentado por cada persona. Lo único que tiene
 * color es el estado, y cada estado va con color + ícono + palabra.
 *
 * La geometría sale de `buildScene` (pura) y solo se recalcula si cambia el
 * plano o cuánta gente hay; un cambio de estado solo cambia clases de CSS.
 * No tiene scroll propio: encuadra el sector en el espacio que le dan.
 */

export const STATE_ICON: Record<TableStateKey, LucideIcon> = {
  free: Armchair,
  reserved: CalendarClock,
  seated: Armchair,
  kitchen: Flame,
  ready: BellRing,
  eating: UtensilsCrossed,
  bill: Receipt,
}

export type FloorTable = {
  state: TableState
  partySize: number | null
  alias: string | null
}

type Props = {
  elements: readonly FloorElement[]
  /** Estado de cada mesa, por id de mesa. */
  tables: Readonly<Record<string, FloorTable>>
  view: 'model' | 'plan'
  onTable: (tableId: string) => void
  className?: string
  /** Texto para lectores de pantalla: «Salón, 12 mesas». */
  label: string
  /** Píxeles de abajo que tapa un control flotante: la maqueta se encuadra sin meterse ahí. */
  insetBottom?: number
  /** Mesas que se apagan (cuando se está mirando solo un grupo: «las que tienen comida lista»). */
  dimmed?: ReadonlySet<string> | null
  /**
   * `auto` gira el sector un cuarto de vuelta si así entra más grande (el salón, en un celular).
   * `never` lo deja como está dibujado: la maqueta al lado del plano, en el editor.
   */
  turn?: 'auto' | 'never'
  /**
   * Cambiar una mesa de lugar. `holdable` son las que se pueden levantar manteniéndolas apretadas (las
   * ocupadas); `onHold` avisa cuál se levantó. Mientras `move` está puesto, la mesa de origen se ve
   * levantada y las de destino se ofrecen; soltar la ficha sobre una llama a `onDrop`. Tocar un destino
   * sigue llegando por `onTable`: arrastrar es un atajo, no el único camino.
   */
  holdable?: ReadonlySet<string> | null
  onHold?: (tableId: string) => void
  move?: { from: string; targets: ReadonlySet<string> } | null
  onDrop?: (tableId: string) => void
}

/** Cuánto hay que mantener apretada una mesa para levantarla. */
const HOLD_MS = 380
/** La ficha va un poco arriba del dedo, para que se vea a dónde apunta. */
const GHOST_LIFT = 46
/** Cuánto tiene que alejarse el dedo, con la mesa ya levantada, para que sea un arrastre. */
const DRAG_START = 14

const TRANSITION_MS = 460

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => {
      const rect = node.getBoundingClientRect()
      setSize((prev) =>
        Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height },
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** De plano a maqueta (y vuelta) animando la cámara. Solo al cambiar de vista: entrar al mapa no anima. */
function useCameraMix(view: 'model' | 'plan'): number {
  const target = view === 'model' ? 1 : 0
  const [mix, setMix] = useState(target)
  const current = useRef(target)

  useEffect(() => {
    if (current.current === target) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = target
      setMix(target)
      return
    }
    const from = current.current
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TRANSITION_MS)
      // ease-in-out fuerte: algo que ya está en pantalla y se mueve.
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      const value = from + (target - from) * eased
      current.current = value
      setMix(value)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target])

  return mix
}

const SolidPaths = memo(function SolidPaths({
  solid,
  className,
}: {
  solid: Solid
  className: string
}) {
  return (
    <g className={className}>
      {solid.sides[0] ? <path className="pos-side-0" d={solid.sides[0]} /> : null}
      {solid.sides[1] ? <path className="pos-side-1" d={solid.sides[1]} /> : null}
      {solid.sides[2] ? <path className="pos-side-2" d={solid.sides[2]} /> : null}
      <path className="pos-top" d={solid.top} />
      {solid.head ? (
        <circle className="pos-head" cx={solid.head.x} cy={solid.head.y} r={solid.head.r} />
      ) : null}
    </g>
  )
})

function stateClasses(state: TableState | undefined): string {
  if (!state) return 'pos-st-free'
  return cn(
    `pos-st-${state.key}`,
    state.urgency === 'late' && 'pos-urg-late',
    state.key !== 'free' && 'pos-is-open',
  )
}

function describe(label: string, table: FloorTable | undefined): string {
  if (!table) return `Mesa ${label}, libre`
  const { state, partySize } = table
  const parts = [`Mesa ${label}`, STATE_LABEL[state.key].toLowerCase()]
  if (state.key === 'reserved' && state.reservation) {
    parts.push(
      `${state.reservation.time}, ${state.reservation.name}, ${state.reservation.guests} personas`,
    )
  }
  if (partySize && state.key !== 'free' && state.key !== 'reserved')
    parts.push(`${partySize} personas`)
  if (state.minutes !== null && state.key !== 'reserved')
    parts.push(`hace ${formatMinutes(state.minutes)}`)
  if (state.urgency === 'late') parts.push('demorada')
  if (state.nextCourseDue) parts.push('hay una tanda para marchar')
  return parts.join(', ')
}

export function FloorModel({
  elements,
  tables,
  view,
  onTable,
  className,
  label,
  insetBottom = 0,
  dimmed = null,
  turn = 'auto',
  holdable = null,
  onHold,
  move = null,
  onDrop,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const full = useSize(ref)
  // El espacio donde entra la maqueta: todo el tablero menos lo que tapa el control flotante.
  const size = useMemo(
    () => ({ width: full.width, height: Math.max(0, full.height - insetBottom) }),
    [full, insetBottom],
  )
  const mix = useCameraMix(view)

  // Cómo mirar este sector en esta pantalla: girado o no, y con cuánta inclinación (ver chooseCamera).
  const choice = useMemo(
    () => chooseCamera(elements, size, undefined, undefined, turn === 'auto'),
    [elements, size, turn],
  )
  const camera = useMemo(
    () => mixCamera(turned(PLAN_CAMERA, choice.turns), choice.camera, mix),
    [mix, choice],
  )

  // Cuánta gente hay sentada en cada mesa: lo único del estado que cambia la geometría.
  const occupancyKey = useMemo(
    () =>
      Object.entries(tables)
        .filter(
          ([, t]) => t.state.key !== 'free' && t.state.key !== 'reserved' && (t.partySize ?? 0) > 0,
        )
        .map(([id, t]) => `${id}:${t.partySize}`)
        .sort()
        .join('|'),
    [tables],
  )
  const occupancy = useMemo(() => {
    const out: Record<string, number> = {}
    if (!occupancyKey) return out
    for (const pair of occupancyKey.split('|')) {
      const [id, people] = pair.split(':')
      if (id) out[id] = Number(people)
    }
    return out
  }, [occupancyKey])

  // Primero se arma sin sillas para saber a qué escala entra; si queda grande, con sillas y comensales.
  const bare = useMemo(() => buildScene(camera, elements, { chairs: false }), [camera, elements])
  const roughScale = useMemo(() => {
    if (size.width === 0 || size.height === 0) return 0
    return fitBounds(bare.bounds, size, 24, 1.7).scale
  }, [bare.bounds, size])
  const detailed = roughScale >= 0.3
  const scene: Scene = useMemo(
    () => (detailed ? buildScene(camera, elements, { chairs: true, occupancy }) : bare),
    [detailed, camera, elements, occupancy, bare],
  )

  const fit = useMemo(() => {
    if (size.width === 0 || size.height === 0) return null
    // Aire arriba para las banderas de la fila del fondo.
    const padded = { ...scene.bounds, minY: scene.bounds.minY - 30 / Math.max(roughScale, 0.2) }
    return fitBounds(padded, size, 14, 1.7)
  }, [scene.bounds, size, roughScale])

  const scale = fit?.scale ?? 1
  const sx = (x: number) => (fit ? x * scale + fit.offsetX : 0)
  const sy = (y: number) => (fit ? y * scale + fit.offsetY : 0)
  // Los rótulos del piso («ENTRADA», «VISTA AL CERRO») miden lo mismo con el plano chico o grande: en un
  // celular, uno cerca del borde se cortaba. Se corre lo justo para quedar entero dentro del mapa.
  const decalLeft = (x: number, label: string) => {
    const half = (label.length * 7.2 + 4) / 2
    const edge = 8
    if (half * 2 + edge * 2 >= size.width) return size.width / 2
    return Math.min(Math.max(sx(x), half + edge), size.width - half - edge)
  }

  // Cuánto detalle entra según el tamaño real de una mesa en pantalla.
  const tablePx = 80 * scale
  const showWord = tablePx >= 66
  const showTime = tablePx >= 34
  const flagSize = Math.max(11, Math.min(14, 9 + tablePx * 0.05))
  const numSize = Math.max(12, Math.min(30, tablePx * 0.38))
  const pole = Math.max(5, Math.min(16, tablePx * 0.13))

  // ── Levantar una mesa y arrastrarla ──
  const press = useRef<{
    pointer: number
    tableId: string
    /** Dónde arrancó el dedo: soltar sin haberse alejado de ahí no es arrastrar. */
    startX: number
    startY: number
    x: number
    y: number
    timer: number
    held: boolean
    dragged: boolean
  } | null>(null)
  // El toque que el navegador manda al soltar un «mantener apretado»: se ignora, pero solo el de ESA mesa
  // y por un instante. Hay teléfonos que no lo mandan, y no puede comerse el toque siguiente (el destino).
  const skipClick = useRef<{ tableId: string; until: number } | null>(null)
  const [ghost, setGhost] = useState<{
    tableId: string
    x: number
    y: number
    dragged: boolean
  } | null>(null)

  const stagePoint = (event: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }
  const dropTargetAt = (x: number, y: number): string | null => {
    if (!move || !fit) return null
    const candidates = scene.anchors.filter((anchor) => move.targets.has(anchor.tableId))
    // La ficha apunta con su centro, que va arriba del dedo.
    const hit = nearestAnchor(
      candidates,
      (x - fit.offsetX) / scale,
      (y - GHOST_LIFT - fit.offsetY) / scale,
      Math.max(46, tablePx * 0.8) / scale,
    )
    return hit?.tableId ?? null
  }
  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  // Si la maqueta se desmonta con una mesa apretada, que no quede un reloj corriendo.
  useEffect(() => () => window.clearTimeout(press.current?.timer), [])

  const holdHandlers = (tableId: string) => {
    if (!onHold || !holdable?.has(tableId)) return null
    return {
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
        skipClick.current = null
        if (event.pointerType === 'mouse' && event.button !== 0) return
        endPress()
        const target = event.currentTarget
        const at = stagePoint(event)
        const pointer = event.pointerId
        const timer = window.setTimeout(() => {
          const current = press.current
          if (!current || current.pointer !== pointer) return
          current.held = true
          try {
            navigator.vibrate?.(14)
          } catch {
            // Los iPhone no vibran desde la web.
          }
          try {
            target.setPointerCapture(pointer)
          } catch {
            // Sin captura se sigue igual: tocar un destino también mueve.
          }
          setGhost({ tableId, x: current.x, y: current.y, dragged: false })
          onHold(tableId)
        }, HOLD_MS)
        press.current = {
          pointer,
          tableId,
          startX: at.x,
          startY: at.y,
          x: at.x,
          y: at.y,
          timer,
          held: false,
          dragged: false,
        }
      },
      onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
        const current = press.current
        if (!current || current.pointer !== event.pointerId) return
        const at = stagePoint(event)
        if (!current.held) {
          // Se movió antes de tiempo: no era «mantener», era otra cosa.
          if (Math.hypot(at.x - current.x, at.y - current.y) > 10) endPress()
          return
        }
        current.x = at.x
        current.y = at.y
        // Recién cuenta como arrastre cuando el dedo se aleja de donde levantó la mesa.
        if (Math.hypot(at.x - current.startX, at.y - current.startY) > DRAG_START) {
          current.dragged = true
        }
        setGhost({ tableId: current.tableId, x: at.x, y: at.y, dragged: current.dragged })
      },
      onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
        const current = press.current
        if (!current || current.pointer !== event.pointerId) return
        endPress()
        if (!current.held) return
        skipClick.current = { tableId: current.tableId, until: Date.now() + 700 }
        setGhost(null)
        // Soltar sin haber arrastrado solo deja la mesa levantada: la ficha va arriba del dedo y, si no,
        // caería sola sobre la mesa de arriba.
        if (!current.dragged) return
        const at = stagePoint(event)
        const target = dropTargetAt(at.x, at.y)
        if (target) onDrop?.(target)
      },
      onPointerCancel: () => {
        endPress()
        setGhost(null)
      },
      onPointerLeave: () => {
        if (press.current && !press.current.held) endPress()
      },
      onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
    }
  }
  const hot = ghost?.dragged && move ? dropTargetAt(ghost.x, ghost.y) : null
  const moveClass = (tableId: string | null) =>
    !move || !tableId
      ? null
      : tableId === move.from
        ? 'pos-lifted'
        : move.targets.has(tableId)
          ? cn('pos-target', hot === tableId && 'pos-target-hot')
          : null

  return (
    <div ref={ref} className={cn('pos-board', className)}>
      {fit ? (
        <>
          <svg
            width={full.width}
            height={full.height}
            viewBox={`0 0 ${full.width} ${full.height}`}
            role="img"
            aria-label={label}
            className="absolute inset-0 block"
          >
            <defs>
              <filter id="pos-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation={Math.max(1.2, 5 * scale)} />
              </filter>
            </defs>
            <g transform={`translate(${fit.offsetX} ${fit.offsetY}) scale(${scale})`}>
              <g>
                {scene.floor.sides[0] ? (
                  <path className="pos-floor-side-0" d={scene.floor.sides[0]} />
                ) : null}
                {scene.floor.sides[1] ? (
                  <path className="pos-floor-side-1" d={scene.floor.sides[1]} />
                ) : null}
                {scene.floor.sides[2] ? (
                  <path className="pos-floor-side-2" d={scene.floor.sides[2]} />
                ) : null}
                <path className="pos-floor-top" d={scene.floor.top} />
              </g>
              <g filter="url(#pos-soft)">
                {scene.solids.map((solid) =>
                  solid.shadow ? (
                    <path key={`sh:${solid.key}`} className="pos-shadow" d={solid.shadow} />
                  ) : null,
                )}
              </g>
              {scene.anchors.map((anchor) => {
                const state = tables[anchor.tableId]?.state
                if (!state || (state.key !== 'ready' && state.urgency !== 'late')) return null
                if (dimmed?.has(anchor.tableId)) return null
                const w = anchor.bounds.maxX - anchor.bounds.minX
                const h = anchor.bounds.maxY - anchor.bounds.minY
                return (
                  <ellipse
                    key={`halo:${anchor.tableId}`}
                    className={cn('pos-halo', stateClasses(state))}
                    cx={(anchor.bounds.minX + anchor.bounds.maxX) / 2}
                    cy={anchor.bounds.maxY - h * 0.36}
                    rx={w * 0.56}
                    ry={h * 0.42}
                  />
                )
              })}
              {scene.solids.map((solid) => (
                <SolidPaths
                  key={solid.key}
                  solid={solid}
                  className={cn(
                    'pos-solid',
                    `pos-r-${solid.role}`,
                    solid.tableId ? stateClasses(tables[solid.tableId]?.state) : null,
                    solid.tableId && dimmed?.has(solid.tableId) ? 'pos-dim' : null,
                    moveClass(solid.tableId),
                  )}
                />
              ))}
            </g>
          </svg>

          {scene.decals.map((decal) =>
            decal.label ? (
              <span
                key={decal.key}
                className="pos-decal"
                style={{ left: decalLeft(decal.x, decal.label), top: sy(decal.y) }}
              >
                {decal.label}
              </span>
            ) : null,
          )}

          {scene.anchors.map((anchor) => {
            const table = tables[anchor.tableId]
            const state = table?.state
            const open = state && state.key !== 'free' && state.key !== 'reserved'
            return (
              <span
                key={`n:${anchor.tableId}`}
                className={cn(
                  'pos-num',
                  !open && 'pos-is-free',
                  dimmed?.has(anchor.tableId) && 'pos-dim',
                  move?.from === anchor.tableId && 'pos-lifted',
                )}
                style={{
                  left: sx(anchor.x),
                  top: sy(anchor.y),
                  fontSize: labelSize(anchor.label, anchor.topWidth * scale, numSize),
                  zIndex: Math.round(anchor.depth),
                }}
                aria-hidden
              >
                {anchor.label}
                {open && table?.partySize && tablePx >= 60 ? (
                  <small>×{table.partySize}</small>
                ) : null}
              </span>
            )
          })}

          {scene.anchors.map((anchor) => {
            const table = tables[anchor.tableId]
            const state = table?.state
            if (!state) return null
            const Icon = STATE_ICON[state.key]
            const top = sy(anchor.topY) - 2
            if (state.key === 'free') {
              // Libre, pero con una reserva más tarde: se avisa en chico para no sentar a quien no llega a irse.
              if (!state.reservation || !showTime) return null
              return (
                <span
                  key={`f:${anchor.tableId}`}
                  className="pos-flag"
                  style={{
                    left: sx(anchor.x),
                    top,
                    zIndex: Math.round(anchor.depth) + 1,
                    ['--flag-size' as string]: `${flagSize}px`,
                  }}
                  aria-hidden
                >
                  <span className="pos-flag-note">
                    {state.reservation.time} ×{state.reservation.guests}
                  </span>
                </span>
              )
            }
            const reservation = state.key === 'reserved' ? state.reservation : null
            // Con lugar: ícono + palabra + reloj. Con menos: ícono + reloj. Sin lugar: solo el ícono.
            const word = reservation
              ? showWord
                ? `${reservation.time} ${reservation.name.split(' ')[0]} ×${reservation.guests}`
                : showTime
                  ? reservation.time
                  : null
              : showWord
                ? STATE_LABEL[state.key]
                : null
            const time = reservation || !showTime ? '' : formatMinutesTight(state.minutes)
            const note = state.nextCourseDue
              ? 'Marchar tanda'
              : state.heldTickets > 0
                ? `En espera · ${state.heldTickets}`
                : null
            return (
              <span
                key={`f:${anchor.tableId}`}
                className={cn(
                  'pos-flag',
                  stateClasses(state),
                  !word && !time && 'is-icon',
                  dimmed?.has(anchor.tableId) && 'pos-dim',
                  move?.from === anchor.tableId && 'pos-lifted',
                )}
                style={{
                  left: sx(anchor.x),
                  top,
                  zIndex: Math.round(anchor.depth) + 1,
                  ['--flag-size' as string]: `${flagSize}px`,
                  ['--pole' as string]: `${pole}px`,
                }}
                aria-hidden
              >
                {note && showWord ? <span className="pos-flag-note">{note}</span> : null}
                <span className="pos-flag-plate">
                  <Icon aria-hidden strokeWidth={2.4} />
                  {word ? <span>{word}</span> : null}
                  {time ? <span className="pos-flag-time">{time}</span> : null}
                  {note && !showWord ? <i className="pos-flag-dot" /> : null}
                </span>
                <span className="pos-flag-pole" />
              </span>
            )
          })}

          {scene.anchors.map((anchor) => {
            // La zona de toque nunca baja de 48 px, aunque la mesa se vea más chica.
            const w = Math.max(48, (anchor.bounds.maxX - anchor.bounds.minX) * scale)
            const h = Math.max(48, (anchor.bounds.maxY - anchor.bounds.minY) * scale + 26)
            const cx = sx((anchor.bounds.minX + anchor.bounds.maxX) / 2)
            const cy = sy((anchor.bounds.minY + anchor.bounds.maxY) / 2) - 13
            const hold = holdHandlers(anchor.tableId)
            return (
              <button
                key={`h:${anchor.tableId}`}
                type="button"
                className={cn('pos-hit', hold && 'is-holdable')}
                style={{
                  left: cx - w / 2,
                  top: cy - h / 2,
                  width: w,
                  height: h,
                  zIndex: Math.round(anchor.depth) + 2,
                }}
                aria-label={describe(anchor.label, tables[anchor.tableId])}
                {...hold}
                onClick={() => {
                  // El toque que cierra un «mantener apretado» no abre la mesa.
                  const skip = skipClick.current
                  skipClick.current = null
                  if (skip && skip.tableId === anchor.tableId && Date.now() < skip.until) return
                  onTable(anchor.tableId)
                }}
              />
            )
          })}

          {ghost ? (
            <span
              className={cn('pos-ghost', hot && 'is-hot')}
              style={{ left: ghost.x, top: ghost.y - GHOST_LIFT }}
              aria-hidden
            >
              {scene.anchors.find((anchor) => anchor.tableId === ghost.tableId)?.label}
              {hot ? (
                // Sobre un destino, la ficha lo tapa: lo dice ella.
                <small>→ {scene.anchors.find((anchor) => anchor.tableId === hot)?.label}</small>
              ) : tables[ghost.tableId]?.partySize ? (
                <small>×{tables[ghost.tableId]?.partySize}</small>
              ) : null}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
