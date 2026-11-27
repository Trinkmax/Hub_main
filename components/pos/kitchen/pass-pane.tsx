'use client'

import { AlarmClock, BellRing, Check, Expand, Shrink } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ageLevel, elapsedMinutes, formatElapsed } from '@/lib/pos/kitchen/age'
import { type BoardPane, packWall } from '@/lib/pos/kitchen/board'
import { type CardLine, type KitchenCard, totalsOf } from '@/lib/pos/kitchen/cards'
import { stationIcon, stationKind } from '@/lib/pos/kitchen/station-kind'
import type { KitchenQueue } from '@/lib/pos/types'
import { cn } from '@/lib/utils'
import { StationIcon } from '../ui/station-icon'
import { DRAG_TYPE, type DragPayload, PassCard } from './pass-card'

/**
 * El muro de una estación: todas sus comandas sin terminar, colgadas por orden de llegada.
 *
 * Cada comanda mide lo que necesita y baja a la columna donde hay más lugar (`packWall`): la fila de
 * arriba, de izquierda a derecha, es lo próximo que tiene que salir, y entran muchas más que una por
 * columna. Lo que no entra no se achica ni se esconde: espera en «En cola», abajo, con su número y su
 * reloj. Lo que ya salió va a «Listos» hasta que el mozo lo retira (y desde ahí se puede deshacer).
 */

/**
 * Ancho mínimo de una comanda (en la estación grande y en las del costado, que van más apretadas) y
 * separación entre comandas, en unidades (1 = 1 px en la tele).
 */
const CARD_MIN = 286
const CARD_MIN_SIDE = 258
const GAP = 12
/** Hasta cuánto se achica la letra de una comanda larguísima antes de dejar de achicarla. */
const MIN_FIT = 0.56
/**
 * Si a la comanda que sigue le falta poco para entrar en el lugar que queda, se achica apenas (hasta
 * esto) en vez de dejar ese lugar vacío con comandas esperando en la cola.
 */
const SQUEEZE_FIT = 0.84
/** A los cuántos minutos de lista sin retirar se pone ámbar y roja. */
const DONE_WARN_MIN = 3
const DONE_LATE_MIN = 7

/** Lo que se sabe de una comanda ya dibujada: cuánto mide, si ocupa dos columnas y si se achicó. */
type Shape = {
  signature: string
  wide: boolean
  fit: number
  height: number | null
  /** Se achicó para entrar en un lugar justo: cuánto medía entera (para volver si hay más lugar). */
  full?: number
}
/** Las medidas valen para un tamaño de muro: si cambia, se mide todo de nuevo. */
type Shapes = { basis: string; byCard: ReadonlyMap<string, Shape> }
const NO_SHAPES: ReadonlyMap<string, Shape> = new Map()

type Props = {
  pane: BoardPane
  codes: ReadonlyMap<string, string>
  now: number
  settings: KitchenQueue['settings']
  /** La unidad en px y la escala de este panel (densidad × tamaño del panel). */
  unit: number
  scale: number
  /** El teclado está en este panel. */
  focused: boolean
  /** La comanda enmarcada (solo si el teclado está acá). */
  selectedId: string | null
  ackId: string | null
  arriving: ReadonlySet<string>
  /** Celular: una lista que se recorre con el dedo, sin muro. */
  list: boolean
  /** Hay más de una estación en pantalla. */
  multi: boolean
  onFocus: (stationId: string) => void
  onSelect: (stationId: string, cardId: string) => void
  onAdvance: (stationId: string, cardId: string) => void
  onLine: (stationId: string, cardId: string, line: CardLine) => void
  onDropItems: (payload: DragPayload, stationId: string) => void
  /** Agrandar o achicar este panel en el pase. */
  onPromote: (stationId: string) => void
  /** Este panel es grande y hay otro grande: se puede achicar. */
  canShrink?: boolean
}

export function PassPane({
  pane,
  codes,
  now,
  settings,
  unit,
  scale,
  focused,
  selectedId,
  ackId,
  arriving,
  list,
  multi,
  onFocus,
  onSelect,
  onAdvance,
  onLine,
  onDropItems,
  onPromote,
  canShrink = false,
}: Props) {
  const { station, wall, done, main } = pane
  const stationId = station.id
  const wallRef = useRef<HTMLOListElement>(null)
  const [cols, setCols] = useState(main ? 4 : 2)
  const [measured, setMeasured] = useState<Shapes>({ basis: '', byCard: NO_SHAPES })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [dropping, setDropping] = useState(false)

  // Cuánto lugar hay: de ahí salen las columnas.
  useLayoutEffect(() => {
    const element = wallRef.current
    if (!element) return
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight }
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (list || size.width === 0) return
    const px = unit * scale
    const min = main ? CARD_MIN : CARD_MIN_SIDE
    // El muro tiene un margen igual a la separación de cada lado.
    const inner = size.width - 2 * GAP * px
    const next = Math.max(1, Math.floor((inner + GAP * px) / ((min + GAP) * px)))
    setCols((prev) => (prev === next ? prev : next))
  }, [list, main, size.width, unit, scale])

  // Cuánto mide cada comanda, y las que no entran ni solas en el alto del muro (esas ocupan dos columnas
  // y, si hace falta, achican la letra). Se mide después de dibujar y antes de pintar: nunca se ve una
  // comanda cortada ni fuera de lugar.
  const px = unit * scale
  const gap = GAP * px
  const wallKey = wall.map((card) => card.signature).join('|')
  const basis = `${size.width}x${size.height}x${cols}x${px}`
  const shapes = measured.basis === basis ? measured.byCard : NO_SHAPES
  // biome-ignore lint/correctness/useExhaustiveDependencies: `wallKey` dice cuándo cambió lo que se dibuja
  useLayoutEffect(() => {
    const element = wallRef.current
    if (!element || list) return
    const room = element.clientHeight - 2 * gap
    if (room <= 0 || element.clientWidth <= 0) return
    const items = Array.from(element.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    )
    let changed = false
    const next = new Map<string, Shape>()
    for (const [index, item] of items.entries()) {
      const card = wall[index]
      if (!card) continue
      const current = shapes.get(card.id)
      // Si cambió lo que lleva la comanda se vuelve a medir desde cero, pero mientras tanto vale el alto
      // que tenía: así las de al lado no saltan de lugar por un instante.
      let shape: Shape =
        current && current.signature === card.signature
          ? current
          : { signature: card.signature, wide: false, fit: 1, height: current?.height ?? null }
      if (shape !== current) changed = true
      const height = item.offsetHeight
      if (height > room + 1 && !shape.wide && cols >= 2) {
        shape = { ...shape, wide: true }
        changed = true
      } else if (height > room + 1 && shape.fit > MIN_FIT) {
        const fit = Math.max(MIN_FIT, Math.floor(shape.fit * (room / height) * 0.97 * 100) / 100)
        if (fit < shape.fit) {
          shape = { ...shape, fit }
          changed = true
        }
      } else if (shape.height === null || Math.abs(shape.height - height) > 0.5) {
        shape = { ...shape, height }
        changed = true
      }
      next.set(card.id, shape)
    }
    // Con todo medido: la que sigue, ¿entra achicándola apenas? ¿Y las achicadas ya entran enteras?
    if (!changed) {
      const sized = (id: string) => next.get(id)
      const pack = packWall(
        wall.map((card) => ({
          id: card.id,
          height: sized(card.id)?.height ?? null,
          span: sized(card.id)?.wide ? (2 as const) : (1 as const),
        })),
        cols,
        room,
        gap,
      )
      const waiting = wall[pack.fits]
      const shape = waiting ? sized(waiting.id) : undefined
      if (waiting && shape && shape.height !== null && pack.nextRoom !== null && !shape.wide) {
        const wanted = Math.floor((pack.nextRoom / shape.height) * shape.fit * 0.975 * 100) / 100
        if (shape.fit === 1 && wanted >= SQUEEZE_FIT && wanted < 1) {
          next.set(waiting.id, { ...shape, fit: wanted, full: shape.height })
          changed = true
        }
      }
      if (!changed) {
        for (const place of pack.placed) {
          const placed = sized(place.id)
          if (placed?.full === undefined || placed.wide) continue
          if (place.top + placed.full <= room + 0.5) {
            next.set(place.id, {
              signature: placed.signature,
              wide: false,
              fit: 1,
              height: placed.full,
            })
            changed = true
            break
          }
        }
      }
    }
    if (changed || next.size !== shapes.size || measured.basis !== basis) {
      setMeasured({ basis, byCard: next })
    }
  }, [wallKey, basis, list, shapes, measured.basis, gap])

  // Dónde cuelga cada una, y cuántas entran.
  const columnWidth = cols > 0 ? (size.width - 2 * gap - (cols - 1) * gap) / cols : 0
  const packed = useMemo(() => {
    if (list) return null
    const room = size.height - 2 * gap
    const items = wall.map((card) => {
      const shape = shapes.get(card.id)
      return {
        id: card.id,
        height: shape?.height ?? null,
        span: shape?.wide ? (2 as const) : (1 as const),
      }
    })
    const result = packWall(items, cols, room, gap)
    return { fits: result.fits, byId: new Map(result.placed.map((place) => [place.id, place])) }
  }, [list, wall, shapes, cols, size.height, gap])
  const fits = packed?.fits ?? Number.MAX_SAFE_INTEGER

  const totals = useMemo(() => totalsOf(wall), [wall])
  const waiting = list ? [] : wall.slice(fits)
  const ageOf = useCallback(
    (card: KitchenCard) => {
      const minutes = elapsedMinutes(card.firedMs, now)
      return { minutes, level: ageLevel(minutes, settings) }
    },
    [now, settings],
  )

  const select = useCallback((cardId: string) => onSelect(stationId, cardId), [onSelect, stationId])
  const advance = useCallback(
    (cardId: string) => onAdvance(stationId, cardId),
    [onAdvance, stationId],
  )
  const line = useCallback(
    (cardId: string, target: CardLine) => onLine(stationId, cardId, target),
    [onLine, stationId],
  )

  const icon = stationIcon(station)
  const late = wall.filter((card) => ageOf(card).level === 'late').length

  return (
    <section
      className={cn('kds-pane', main && 'is-main')}
      data-pane={stationId}
      data-kind={stationKind(station.kind)}
      data-focus={focused ? 'true' : undefined}
      data-drop={dropping ? 'true' : undefined}
      style={{
        ['--st' as string]: station.color,
        ['--k' as string]: String(scale),
      }}
      aria-label={`${station.name}: ${wall.length} comandas sin terminar`}
      onPointerDownCapture={() => onFocus(stationId)}
      onDragOver={(event) => {
        if (!multi || !event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        if (!dropping) setDropping(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDropping(false)
      }}
      onDrop={(event) => {
        setDropping(false)
        const raw = event.dataTransfer.getData(DRAG_TYPE)
        if (!raw) return
        event.preventDefault()
        try {
          const payload = JSON.parse(raw) as DragPayload
          if (payload.station !== stationId && Array.isArray(payload.itemIds)) {
            onDropItems(payload, stationId)
          }
        } catch {
          // Algo arrastrado desde otro lado: no es una comanda.
        }
      }}
    >
      <header className="kds-pane-head">
        <h2 className="kds-pane-name">
          <span className="kds-pane-icon" aria-hidden>
            <StationIcon icon={icon} strokeWidth={2.3} />
          </span>
          {station.name}
        </h2>
        <p className="kds-pane-counts">
          <span>
            <b>{pane.counts.open}</b>
            <i>{pane.counts.open === 1 ? 'comanda' : 'comandas'}</i>
          </span>
          {pane.counts.queued > 0 ? (
            <span className="is-new">
              <BellRing aria-hidden strokeWidth={2.6} />
              <b>{pane.counts.queued}</b>
              <i>sin empezar</i>
            </span>
          ) : null}
          {late > 0 ? (
            <span className="is-late">
              <AlarmClock aria-hidden strokeWidth={2.6} />
              <b>{late}</b>
              <i>{late === 1 ? 'demorada' : 'demoradas'}</i>
            </span>
          ) : null}
        </p>
        {multi && (!main || canShrink) ? (
          <button
            type="button"
            className="kds-pane-grow"
            onClick={() => onPromote(stationId)}
            aria-label={`${main ? 'Achicar' : 'Agrandar'} ${station.name}`}
            title={`${main ? 'Achicar' : 'Agrandar'} ${station.name}`}
          >
            {main ? (
              <Shrink aria-hidden strokeWidth={2.6} />
            ) : (
              <Expand aria-hidden strokeWidth={2.6} />
            )}
          </button>
        ) : null}
      </header>

      {main && totals.length > 0 ? (
        <p className="kds-totals">
          <span className="sr-only">Lo que hay que hacer ahora, entre todas las comandas: </span>
          {totals.map((total) => (
            <span key={total.menuItemId}>
              <b>{total.quantity}</b> {/^\d/.test(total.name.trim()) ? '× ' : ''}
              {total.name}
            </span>
          ))}
        </p>
      ) : null}

      <ol ref={wallRef} className="kds-wall" data-list={list ? 'true' : undefined}>
        {wall.map((card) => {
          const shape = shapes.get(card.id)
          const sized = shape && shape.signature === card.signature ? shape : null
          const place = packed?.byId.get(card.id) ?? null
          return (
            <PassCard
              key={card.id}
              card={card}
              left={place ? gap + place.column * (columnWidth + gap) : null}
              top={place ? gap + place.top : null}
              width={
                list
                  ? null
                  : (sized?.wide ?? shape?.wide) && cols >= 2
                    ? columnWidth * 2 + gap
                    : columnWidth
              }
              station={station}
              code={codes.get(card.id) ?? card.title}
              {...ageOf(card)}
              selected={focused && card.id === selectedId}
              arriving={arriving.has(card.id)}
              ack={focused && card.id === ackId}
              wide={(sized?.wide ?? false) && cols >= 2}
              fit={sized?.fit ?? 1}
              hidden={!list && place === null}
              draggable={multi}
              onSelect={select}
              onAdvance={advance}
              onLine={line}
            />
          )
        })}
      </ol>
      {wall.length === 0 ? (
        <p className="kds-pane-empty">
          {done.length > 0 ? 'Todo salió.' : 'Sin comandas.'}
          <small>Lo que entre aparece acá.</small>
        </p>
      ) : null}

      <footer
        className="kds-strip"
        data-empty={done.length + waiting.length === 0 ? 'true' : undefined}
      >
        {done.length > 0 ? (
          <div className="kds-strip-group is-done">
            <h3>
              <Check aria-hidden strokeWidth={3} />
              Listos <b>{done.length}</b>
            </h3>
            <ul>
              {done.map((card) => {
                const minutes = elapsedMinutes(card.doneMs ?? now, now)
                const { value, unit: word } = formatElapsed(minutes)
                return (
                  <li key={card.id}>
                    <button
                      type="button"
                      className="kds-chip is-done"
                      data-card={card.id}
                      data-selected={focused && card.id === selectedId ? 'true' : undefined}
                      data-ack={focused && card.id === ackId ? 'true' : undefined}
                      data-level={
                        minutes >= DONE_LATE_MIN ? 'late' : minutes >= DONE_WARN_MIN ? 'warn' : 'ok'
                      }
                      aria-label={`${card.spoken}: lista hace ${value} ${word}${card.waiter ? `, la retira ${card.waiter}` : ''}. Elegir para deshacer.`}
                      aria-pressed={focused && card.id === selectedId}
                      onClick={() => select(card.id)}
                    >
                      <b>{codes.get(card.id) ?? card.title}</b>
                      {card.waiter ? <span>{card.waiter}</span> : null}
                      <em>
                        {value}
                        {word ? '′' : ''}
                      </em>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
        {waiting.length > 0 ? (
          <div className="kds-strip-group is-waiting">
            <h3>
              En cola <b>{waiting.length}</b>
            </h3>
            <ul>
              {waiting.map((card) => {
                const { minutes, level } = ageOf(card)
                const { value, unit: word } = formatElapsed(minutes)
                return (
                  <li key={card.id}>
                    <button
                      type="button"
                      className={cn('kds-chip is-waiting', `is-${card.status}`)}
                      data-card={card.id}
                      data-selected={focused && card.id === selectedId ? 'true' : undefined}
                      data-arriving={arriving.has(card.id) ? 'true' : undefined}
                      data-level={level}
                      aria-label={`${card.spoken}: en cola hace ${value} ${word}. Elegir.`}
                      aria-pressed={focused && card.id === selectedId}
                      onClick={() => select(card.id)}
                    >
                      <b>{codes.get(card.id) ?? card.title}</b>
                      <em>
                        {value}
                        {word ? '′' : ''}
                      </em>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </footer>
    </section>
  )
}
