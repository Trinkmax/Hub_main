import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'

/** Ref de `<TransformWrapper>` (estructural: no dependemos de los tipos de React acá). */
type StageRef = { readonly current: ReactZoomPanPinchRef | null }

/**
 * Lee el estado vivo del stage (scale/posición) desde el ref de react-zoom-pan-pinch.
 *
 * OJO (bug sutil, verificado en la fuente de rzpp v3.7): lo que llega a
 * `transformRef.current` vía `ref={...}` es `getControls(instance)` →
 * `{ instance, zoomIn, zoomOut, setTransform, resetTransform, centerView, zoomToElement }`.
 * **NO incluye `.state`** (eso vive sólo en `getContext`/render-prop). El tipo
 * `ReactZoomPanPinchRef` declara `.state`, así que TypeScript no se queja, pero en
 * runtime `ref.current.state` es `undefined` y leer `ref.current.state.scale` lanza
 * "Cannot read properties of undefined (reading 'scale')". El estado vivo está en
 * `instance.transformState`. Este helper centraliza el acceso correcto (y los fallbacks
 * mientras el stage no terminó de montar) para que nadie vuelva a usar el path roto.
 */
export function readStageTransform(transformRef: StageRef): {
  scale: number
  positionX: number
  positionY: number
} {
  const ts = transformRef.current?.instance?.transformState
  return {
    scale: ts?.scale ?? 1,
    positionX: ts?.positionX ?? 0,
    positionY: ts?.positionY ?? 0,
  }
}

export type StageTransform = { scale: number; positionX: number; positionY: number }

/** Franjas del visor que tapa algo que flota encima (herramientas, zoom): ahí no se encaja nada. */
export type StageInset = { top: number; right: number; bottom: number; left: number }

/**
 * La transformación que encaja una caja del plano (en coordenadas lógicas)
 * centrada en el visor, con margen. Es lo que hacen «Ver todo el piso» y
 * «Encajar las mesas», y cómo arranca el lienzo al abrir un sector.
 *
 * El stage se dibuja con `translate(positionX, positionY) scale(scale)` desde su
 * esquina, así que un punto lógico `(x, y)` queda en `positionX + x · scale`.
 * Nunca agranda más allá de `maxScale` (un sector chico no se infla) ni achica
 * por debajo de `minScale` (el límite del zoom). Con `inset`, la caja se encaja y
 * se centra en lo que queda libre del visor (lo que no tapan las herramientas que
 * flotan encima). Pura.
 */
export function fitTransform(
  viewport: { width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
  options: {
    padding?: number
    minScale?: number
    maxScale?: number
    inset?: Partial<StageInset>
  } = {},
): StageTransform {
  const padding = options.padding ?? 0
  const minScale = options.minScale ?? 0
  const maxScale = options.maxScale ?? Number.POSITIVE_INFINITY
  const left = Math.max(0, options.inset?.left ?? 0)
  const top = Math.max(0, options.inset?.top ?? 0)
  const freeW = Math.max(1, viewport.width - left - Math.max(0, options.inset?.right ?? 0))
  const freeH = Math.max(1, viewport.height - top - Math.max(0, options.inset?.bottom ?? 0))
  const boxW = Math.max(1, box.width)
  const boxH = Math.max(1, box.height)
  const roomW = Math.max(1, freeW - padding * 2)
  const roomH = Math.max(1, freeH - padding * 2)
  const scale = Math.max(minScale, Math.min(roomW / boxW, roomH / boxH, maxScale))
  return {
    scale,
    positionX: left + (freeW - boxW * scale) / 2 - box.x * scale,
    positionY: top + (freeH - boxH * scale) / 2 - box.y * scale,
  }
}
