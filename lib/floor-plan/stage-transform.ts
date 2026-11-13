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

/**
 * La transformación que encaja una caja del plano (en coordenadas lógicas)
 * centrada en el visor, con margen. Es lo que hacen «Ver todo el piso» y
 * «Encajar las mesas», y cómo arranca el lienzo al abrir un sector.
 *
 * El stage se dibuja con `translate(positionX, positionY) scale(scale)` desde su
 * esquina, así que un punto lógico `(x, y)` queda en `positionX + x · scale`.
 * Nunca agranda más allá de `maxScale` (un sector chico no se infla) ni achica
 * por debajo de `minScale` (el límite del zoom). Pura.
 */
export function fitTransform(
  viewport: { width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
  options: { padding?: number; minScale?: number; maxScale?: number } = {},
): StageTransform {
  const padding = options.padding ?? 0
  const minScale = options.minScale ?? 0
  const maxScale = options.maxScale ?? Number.POSITIVE_INFINITY
  const boxW = Math.max(1, box.width)
  const boxH = Math.max(1, box.height)
  const roomW = Math.max(1, viewport.width - padding * 2)
  const roomH = Math.max(1, viewport.height - padding * 2)
  const scale = Math.max(minScale, Math.min(roomW / boxW, roomH / boxH, maxScale))
  return {
    scale,
    positionX: (viewport.width - boxW * scale) / 2 - box.x * scale,
    positionY: (viewport.height - boxH * scale) / 2 - box.y * scale,
  }
}
