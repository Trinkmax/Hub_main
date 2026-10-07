/**
 * Las pestañas del plano y su valor en la URL (`?vista=`). Sin `'use client'`:
 * la página (server) lee el parámetro con `floorViewFromParam` y el editor
 * (cliente) usa los mismos valores en `Tabs syncParam`.
 */
export const FLOOR_VIEWS = ['editar', 'vivo', 'lista'] as const

export type FloorView = (typeof FLOOR_VIEWS)[number]

/** El parámetro de la URL que lleva la pestaña. */
export const FLOOR_VIEW_PARAM = 'vista'

export function isFloorView(value: unknown): value is FloorView {
  return typeof value === 'string' && (FLOOR_VIEWS as readonly string[]).includes(value)
}

/** `?vista=` → pestaña; cualquier otra cosa (o nada) abre el editor. */
export function floorViewFromParam(value: string | string[] | undefined): FloorView {
  const first = Array.isArray(value) ? value[0] : value
  return isFloorView(first) ? first : 'editar'
}
