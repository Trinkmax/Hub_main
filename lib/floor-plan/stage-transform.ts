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
