import type { FeatureKey } from '@/lib/platform/features'
import type { TenantRole } from '@/lib/tenant/types'

/** Una pantalla a la que Tex puede llevar. Puro: lo usan el servidor, los tests y las áreas. */

export type TexScreenParam =
  | 'id'
  | 'mes'
  | 'cuenta'
  | 'desde'
  | 'hasta'
  | 'semana'
  | 'fecha'
  | 'tab'
  | 'q'

export type TexScreenDef = {
  /** El nombre que usa Tex: `area.cosa`. */
  id: string
  /** Cómo la llaman en el bar. */
  label: string
  /** Para qué sirve, en una oración: es lo que lee Tex para saber a dónde ir. */
  what: string
  /** Después de `/administracion`, o de `/<bar>` si es `root`. `:id` se reemplaza por el parámetro. */
  path: string
  /** Fuera de Administración: la ruta va directo después de `/<bar>`. */
  root?: boolean
  /** Parte de la URL que no cambia (`?tab=clientes`). */
  query?: string
  params?: readonly TexScreenParam[]
  /** Los valores que esta pantalla acepta en `?tab=`. Sin esto, no se manda ninguno. */
  tabs?: readonly string[]
  /** Quién la ve, si es menos que quienes llegan a esa ruta. */
  roles?: readonly TenantRole[]
  /** Solo si el bar tiene prendida esta función. */
  feature?: FeatureKey
}
