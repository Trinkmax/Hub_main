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
import { buildScene, chooseCamera, type Scene, type Solid } from '@/lib/pos/floor/scene'
import {
  formatMinutes,
  formatMinutesTight,
  STATE_LABEL,
  type TableState,
  type TableStateKey,
} from '@/lib/pos/table-state'
import type { FloorElement } from '@/lib/pos/types'
import { cn } from '@/lib/utils'

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
}

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

export function FloorModel({ elements, tables, view, onTable, className, label }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const size = useSize(ref)
  const mix = useCameraMix(view)

  // Cómo mirar este sector en esta pantalla: girado o no, y con cuánta inclinación (ver chooseCamera).
  const choice = useMemo(() => chooseCamera(elements, size), [elements, size])
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

  // Cuánto detalle entra según el tamaño real de una mesa en pantalla.
  const tablePx = 80 * scale
  const showWord = tablePx >= 96
  const showTime = tablePx >= 34
  const flagSize = Math.max(11, Math.min(14, 9 + tablePx * 0.05))
  const numSize = Math.max(12, Math.min(30, tablePx * 0.38))
  const pole = Math.max(5, Math.min(16, tablePx * 0.13))

  return (
    <div ref={ref} className={cn('pos-board', className)}>
      {fit ? (
        <>
          <svg
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
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
                style={{ left: sx(decal.x), top: sy(decal.y) }}
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
                className={cn('pos-num', !open && 'pos-is-free')}
                style={{
                  left: sx(anchor.x),
                  top: sy(anchor.y),
                  fontSize: numSize,
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
                className={cn('pos-flag', stateClasses(state), !word && !time && 'is-icon')}
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
            return (
              <button
                key={`h:${anchor.tableId}`}
                type="button"
                className="pos-hit"
                style={{
                  left: cx - w / 2,
                  top: cy - h / 2,
                  width: w,
                  height: h,
                  zIndex: Math.round(anchor.depth) + 2,
                }}
                aria-label={describe(anchor.label, tables[anchor.tableId])}
                onClick={() => onTable(anchor.tableId)}
              />
            )
          })}
        </>
      ) : null}
    </div>
  )
}
