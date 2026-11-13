'use client'

import { type CSSProperties, memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { bodyRadius, ChairsSvg } from '@/components/floor-plan/table-glyph'
import { inkOn } from '@/lib/floor-plan/branches'
import { MAX_CHAIRS } from '@/lib/floor-plan/chairs'
import { clampToAreaRotated, freeDragPosition, snapToGrid } from '@/lib/floor-plan/grid'
import {
  DEFAULT_SEATS,
  elementName,
  type LiveGeometry,
  tableNumberSize,
} from '@/lib/floor-plan/model'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { type Box, computeSnap, type Guide } from '@/lib/floor-plan/snap'
import { readStageTransform } from '@/lib/floor-plan/stage-transform'
import { cn } from '@/lib/utils'
import { DoorGlyph } from './glyphs'
import { ResizeHandles } from './resize-handles'
import { RotateHandle } from './rotate-handle'

type TransformRef = React.RefObject<ReactZoomPanPinchRef | null>

export type FloorElementProps = {
  element: ElementRow
  selected: boolean
  transformRef: TransformRef
  /** Dimensiones lógicas del área (para clampToArea durante el drag). */
  areaWidth: number
  areaHeight: number
  /** Selección (additive = shift/cmd para multi-selección). */
  onSelect: (id: string, additive: boolean) => void
  /** Cajas de los hermanos (para snap-a-objeto) al iniciar el gesto. */
  getSiblings: (id: string) => Box[]
  /** Registra el nodo DOM (para que el editor mueva los pares en grupo). */
  registerNode: (id: string, node: HTMLDivElement | null) => void
  /** Delta lógico vivo durante el drag (el editor mueve los pares seleccionados). */
  onMoveLive: (id: string, dx: number, dy: number) => void
  /** Commit del move al SOLTAR: delta lógico (el editor aplica al grupo + persiste). */
  onMoveEnd: (id: string, dx: number, dy: number) => void
  onResizeEnd: (id: string, size: { width: number; height: number }) => void
  /** Commit de la rotación al soltar el handle (grados 0..359). */
  onRotateEnd: (id: string, rotation: number) => void
  /** Tamaño o giro «en el aire» mientras dura el gesto: lo sigue la maqueta. */
  onLive?: (id: string, geometry: LiveGeometry) => void
  /** Guías de alineación vivas (se dibujan en el stage); [] al terminar. */
  onGuides: (guides: Guide[]) => void
  /**
   * Inicio de gesto: el editor frena el re-seed del RSC y asegura la selección
   * (`additive` = con Shift/Cmd se suma a lo elegido en vez de reemplazarlo).
   * Devuelve `true` si el elemento quedó elegido recién ahora, al apretar.
   */
  onDragStart?: (id: string, additive: boolean) => boolean
  onDragEnd?: () => void
}

// Umbral (px de pantalla) para distinguir click (selección) de drag (mover).
const DRAG_THRESHOLD = 4

type DragState = {
  startClientX: number
  startClientY: number
  origX: number
  origY: number
  scale: number
  moved: boolean
  lastDx: number
  lastDy: number
  siblings: Box[]
  /** Con Shift/Cmd apretado: el toque suma o saca de la selección. */
  additive: boolean
  /** Quedó elegido recién al apretar (no hay que volver a alternarlo al soltar). */
  selectedOnPress: boolean
}

/**
 * Un elemento del plano, en papel: la mesa es cartón blanco con el número en
 * tinta y sus sillas; lo construido (paredes, barra, islas) va en los mismos
 * materiales que la maqueta del salón, visto desde arriba.
 *
 * El arrastre mueve el nodo a mano (`translate3d`) y recién al soltar avisa al
 * editor: nada pasa por el estado de React mientras dura el gesto.
 */
function FloorElementImpl({
  element,
  selected,
  transformRef,
  areaWidth,
  areaHeight,
  onSelect,
  getSiblings,
  registerNode,
  onMoveLive,
  onMoveEnd,
  onResizeEnd,
  onRotateEnd,
  onLive,
  onGuides,
  onDragStart,
  onDragEnd,
}: FloorElementProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Etiqueta (número/rótulo): se contra-rota para quedar derecha; durante el gesto
  // de rotación se actualiza imperativamente para no quedar inclinada.
  const labelRef = useRef<HTMLSpanElement>(null)
  const drag = useRef<DragState | null>(null)
  const rafRef = useRef<number | null>(null)
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null)

  // Callback ref: setea el wrapper local + registra el nodo en el editor.
  const setWrapper = useCallback(
    (node: HTMLDivElement | null) => {
      wrapperRef.current = node
      registerNode(element.id, node)
    },
    [registerNode, element.id],
  )

  const lastCommittedRef = useRef({ width: element.width, height: element.height })
  if (
    lastCommittedRef.current.width !== element.width ||
    lastCommittedRef.current.height !== element.height
  ) {
    lastCommittedRef.current = { width: element.width, height: element.height }
    if (liveSize) setLiveSize(null)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync sólo cuando cambia la posición canónica del elemento
  useLayoutEffect(() => {
    if (wrapperRef.current) wrapperRef.current.style.transform = ''
  }, [element.x, element.y])

  useLayoutEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const kind = element.kind
  const isTable = kind === 'table'
  const isBanquette = element.shape === 'banquette'

  const displayWidth = liveSize?.width ?? element.width
  const displayHeight = liveSize?.height ?? element.height
  const rotation = element.rotation ?? 0
  const radius = bodyRadius(
    element.shape,
    isTable ? element.corner_radius || 8 : element.corner_radius,
  )
  // Sin lugares cargados se dibuja como la ve el salón: con cuatro sillas.
  const seats = isTable ? (element.table?.capacity ?? DEFAULT_SEATS) : null

  // Posición imantada vigente (free + snap-a-objeto). Devuelve {x,y,guides}.
  const resolveSnap = (state: DragState) => {
    const free = freeDragPosition(
      state.origX,
      state.origY,
      state.lastDx,
      state.lastDy,
      state.scale,
      element.width,
      element.height,
      areaWidth,
      areaHeight,
      rotation,
    )
    return computeSnap(
      { x: free.x, y: free.y, width: element.width, height: element.height },
      state.siblings,
    )
  }

  const applyLiveTransform = () => {
    rafRef.current = null
    const state = drag.current
    const node = wrapperRef.current
    if (!state || !node) return
    const snap = resolveSnap(state)
    node.style.transform = `translate3d(${snap.x - state.origX}px, ${snap.y - state.origY}px, 0)`
    onGuides(snap.guides)
    onMoveLive(element.id, snap.x - state.origX, snap.y - state.origY)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const selectedOnPress = onDragStart?.(element.id, additive) ?? false
    drag.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: element.x,
      origY: element.y,
      scale: readStageTransform(transformRef).scale,
      moved: false,
      lastDx: 0,
      lastDy: 0,
      siblings: getSiblings(element.id),
      additive,
      selectedOnPress,
    }
    if (wrapperRef.current) wrapperRef.current.style.willChange = 'transform'
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    if (!state) return
    const dx = e.clientX - state.startClientX
    const dy = e.clientY - state.startClientY
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    if (!state.moved) wrapperRef.current?.classList.add('is-dragging')
    state.moved = true
    state.lastDx = dx
    state.lastDy = dy
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(applyLiveTransform)
  }

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    drag.current = null
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    const node = wrapperRef.current
    if (state?.moved) {
      // Snap final: por eje, gana el snap-a-objeto; si no, snap-a-grilla
      // (Alt = libre). Luego clamp al área.
      const free = freeDragPosition(
        state.origX,
        state.origY,
        state.lastDx,
        state.lastDy,
        state.scale,
        element.width,
        element.height,
        areaWidth,
        areaHeight,
        rotation,
      )
      const snap = computeSnap(
        { x: free.x, y: free.y, width: element.width, height: element.height },
        state.siblings,
      )
      const hasV = snap.guides.some((g) => g.axis === 'v')
      const hasH = snap.guides.some((g) => g.axis === 'h')
      const fx = hasV ? snap.x : e.altKey ? Math.round(free.x) : snapToGrid(free.x)
      const fy = hasH ? snap.y : e.altKey ? Math.round(free.y) : snapToGrid(free.y)
      const c = clampToAreaRotated(
        fx,
        fy,
        element.width,
        element.height,
        rotation,
        areaWidth,
        areaHeight,
      )
      if (node) {
        node.style.transform = `translate3d(${c.x - state.origX}px, ${c.y - state.origY}px, 0)`
      }
      onGuides([])
      onMoveEnd(element.id, c.x - state.origX, c.y - state.origY)
    } else if (state) {
      // Toque sin arrastrar. Solo: queda elegido este. Con Shift/Cmd: se suma a lo
      // elegido (eso ya pasó al apretar) o, si ya estaba, se saca.
      if (!state.additive) onSelect(element.id, false)
      else if (!state.selectedOnPress) onSelect(element.id, true)
    }
    if (node) {
      node.style.willChange = 'auto'
      node.classList.remove('is-dragging')
    }
    onDragEnd?.()
  }

  const wrapperStyle: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: displayWidth,
    height: displayHeight,
    zIndex: selected ? element.z_index + 1000 : element.z_index,
    touchAction: 'none',
  }

  // El color que eligió el dueño pisa al material (y el texto se acomoda a ese fondo).
  const bodyStyle: CSSProperties = isTable
    ? { borderRadius: radius }
    : {
        borderRadius: element.shape === 'circle' ? '50%' : kind === 'bar' ? 6 : 4,
        ...(element.color && kind !== 'text' && kind !== 'door'
          ? {
              backgroundColor: element.color,
              color: inkOn(element.color) === 'light' ? 'var(--pos-on-dark)' : 'var(--pos-ink)',
            }
          : null),
      }

  const counterRotate = rotation ? { transform: `rotate(${-rotation}deg)` } : undefined
  const tableLabel = element.table?.label ?? element.label ?? '—'
  const number = tableNumberSize(displayWidth, displayHeight, tableLabel, rotation)

  return (
    <div
      ref={setWrapper}
      className={cn('floor-element', selected && 'is-selected')}
      style={wrapperStyle}
    >
      {/* Capa que rota: cuerpo + sillas giran juntos; el número se contra-rota. */}
      <div
        ref={contentRef}
        className="fpe-el-layer"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        {(isTable || kind === 'bar') && (
          <ChairsSvg
            shape={element.shape}
            kind={kind}
            width={displayWidth}
            height={displayHeight}
            capacity={seats}
          />
        )}

        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          // Con teclado (Enter / Espacio) no hay puntero: el click sin detalle elige.
          onClick={(e) => {
            if (e.detail === 0) onSelect(element.id, e.shiftKey || e.metaKey || e.ctrlKey)
          }}
          aria-label={elementName(element)}
          aria-pressed={selected}
          style={bodyStyle}
          className={cn(
            'fpe-el-body',
            `fpe-el--${kind}`,
            kind === 'text' && !element.label && 'is-blank',
          )}
        >
          {isBanquette && isTable ? <span aria-hidden className="fpe-el-backrest" /> : null}
          {isTable ? (
            <span ref={labelRef} className="fpe-el-label" style={counterRotate}>
              <span
                className="fpe-el-num"
                // Con el plano alejado el número no baja de 12 px en pantalla (como en el
                // salón), salvo que así ya no entre en la mesa: una etiqueta larga se achica.
                style={{
                  fontSize: `min(${number.cap}px, max(${number.size}px, calc(12px * var(--fpe-inv, 1))))`,
                }}
              >
                {tableLabel}
              </span>
              {/* Más lugares que sillas dibujadas: se dice con número. */}
              {seats !== null && seats > MAX_CHAIRS ? (
                <span className="fpe-el-cap">{seats} lugares</span>
              ) : null}
            </span>
          ) : kind === 'door' ? (
            <span ref={labelRef} className="fpe-el-decal" style={counterRotate}>
              <DoorGlyph />
              {element.label ? <span>{element.label}</span> : null}
            </span>
          ) : kind === 'text' ? (
            <span ref={labelRef} className="fpe-el-decal" style={counterRotate}>
              {element.label || 'Texto'}
            </span>
          ) : element.label || kind === 'stage' ? (
            <span ref={labelRef} className="fpe-el-tag" style={counterRotate}>
              {element.label || 'Escenario'}
            </span>
          ) : null}
        </button>

        {/* Marco + manijas DENTRO de la capa que rota → siguen el giro del elemento. */}
        {selected && <span aria-hidden className="fpe-el-ring" />}

        {selected && (
          <>
            <ResizeHandles
              width={displayWidth}
              height={displayHeight}
              transformRef={transformRef}
              rotation={rotation}
              onResize={(size) => {
                setLiveSize(size)
                onLive?.(element.id, size)
              }}
              onResizeEnd={(size) => {
                setLiveSize(null)
                onResizeEnd(element.id, size)
              }}
            />
            <RotateHandle
              boxRef={wrapperRef}
              onRotate={(deg) => {
                if (contentRef.current) contentRef.current.style.transform = `rotate(${deg}deg)`
                // Mantener la etiqueta derecha durante el gesto (contra-rotación viva).
                if (labelRef.current) labelRef.current.style.transform = `rotate(${-deg}deg)`
                onLive?.(element.id, { rotation: deg })
              }}
              onRotateEnd={(deg) => onRotateEnd(element.id, deg)}
              onStep={() => onRotateEnd(element.id, (rotation + 15) % 360)}
            />
          </>
        )}
      </div>
    </div>
  )
}

export const FloorElement = memo(FloorElementImpl, (a, b) => {
  const ea = a.element
  const eb = b.element
  return (
    a.selected === b.selected &&
    a.areaWidth === b.areaWidth &&
    a.areaHeight === b.areaHeight &&
    a.transformRef === b.transformRef &&
    a.onSelect === b.onSelect &&
    a.getSiblings === b.getSiblings &&
    a.registerNode === b.registerNode &&
    a.onMoveLive === b.onMoveLive &&
    a.onMoveEnd === b.onMoveEnd &&
    a.onResizeEnd === b.onResizeEnd &&
    a.onRotateEnd === b.onRotateEnd &&
    a.onLive === b.onLive &&
    a.onGuides === b.onGuides &&
    a.onDragStart === b.onDragStart &&
    a.onDragEnd === b.onDragEnd &&
    ea.id === eb.id &&
    ea.x === eb.x &&
    ea.y === eb.y &&
    ea.width === eb.width &&
    ea.height === eb.height &&
    ea.rotation === eb.rotation &&
    ea.corner_radius === eb.corner_radius &&
    ea.z_index === eb.z_index &&
    ea.kind === eb.kind &&
    ea.shape === eb.shape &&
    ea.color === eb.color &&
    ea.label === eb.label &&
    (ea.table?.active ?? null) === (eb.table?.active ?? null) &&
    (ea.table?.label ?? null) === (eb.table?.label ?? null) &&
    (ea.table?.capacity ?? null) === (eb.table?.capacity ?? null)
  )
})
