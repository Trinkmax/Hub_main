/**
 * Acciones rápidas de Administración (H.0): hojas que se abren sobre la
 * pantalla actual con `?accion=…` y se cierran sacando ese parámetro.
 * Puro (sin React): lo usan el provider, ⌘K y los tests.
 */

export const ACCOUNTING_ACTIONS = [
  'gasto',
  'pagar',
  'cobrar',
  'mover',
  'ajustar',
  'movimiento',
] as const
export type AccountingAction = (typeof ACCOUNTING_ACTIONS)[number]

/** Lo que puede acompañar a `?accion=`: ids que la hoja usa para precargar. */
export const ACTION_PARAM_KEYS = ['proveedor', 'cliente', 'caja', 'partida'] as const
export type ActionParamKey = (typeof ACTION_PARAM_KEYS)[number]
export type ActionParams = Partial<Record<ActionParamKey, string>>

export const ACTION_PARAM = 'accion'

/** Título de cada hoja (y de su botón, ⌘K y la barra del celular). */
export const ACTION_TITLES: Readonly<Record<AccountingAction, string>> = {
  gasto: 'Nuevo gasto',
  pagar: 'Pagar',
  cobrar: 'Registrar un cobro',
  mover: 'Mover plata',
  ajustar: 'Ajustar saldo',
  movimiento: 'Otro ingreso o egreso',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isAccountingAction(value: unknown): value is AccountingAction {
  return typeof value === 'string' && (ACCOUNTING_ACTIONS as readonly string[]).includes(value)
}

type SearchLike = Pick<URLSearchParams, 'get'>

/**
 * `?accion=pagar&proveedor=<uuid>` → `{ action: 'pagar', params: { proveedor } }`.
 * Un parámetro que no es un UUID se descarta (la hoja igual valida con zod).
 */
export function readAction(
  search: SearchLike,
): { action: AccountingAction; params: ActionParams } | null {
  const action = search.get(ACTION_PARAM)
  if (!isAccountingAction(action)) return null
  const params: ActionParams = {}
  for (const key of ACTION_PARAM_KEYS) {
    const value = search.get(key)
    if (value && UUID_RE.test(value)) params[key] = value
  }
  return { action, params }
}

function withoutAction(search: string | URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search)
  next.delete(ACTION_PARAM)
  for (const key of ACTION_PARAM_KEYS) next.delete(key)
  return next
}

function join(pathname: string, search: URLSearchParams): string {
  const query = search.toString()
  return query ? `${pathname}?${query}` : pathname
}

/**
 * La URL actual con la hoja abierta: conserva los demás parámetros de la
 * pantalla (`?tab=`, `?mes=`) y reemplaza los de una acción anterior.
 */
export function actionHref(
  pathname: string,
  search: string | URLSearchParams,
  action: AccountingAction,
  params: ActionParams = {},
): string {
  const next = withoutAction(search)
  next.set(ACTION_PARAM, action)
  for (const key of ACTION_PARAM_KEYS) {
    const value = params[key]
    if (value) next.set(key, value)
  }
  return join(pathname, next)
}

/** La URL actual sin la hoja. */
export function clearActionHref(pathname: string, search: string | URLSearchParams): string {
  return join(pathname, withoutAction(search))
}

/**
 * La acción desde cualquier lado del panel: sobre la pantalla actual si ya se
 * está en Administración, o sobre el Resumen si no (⌘K desde Reservas).
 */
export function actionHrefFrom(
  tenantSlug: string,
  pathname: string,
  search: string | URLSearchParams,
  action: AccountingAction,
  params: ActionParams = {},
): string {
  const base = `/${tenantSlug}/administracion`
  const inside = pathname === base || pathname.startsWith(`${base}/`)
  return inside
    ? actionHref(pathname, search, action, params)
    : actionHref(base, '', action, params)
}

/** Lo que recibe el cuerpo de cada hoja (`acciones/<accion>-sheet.tsx`). */
export type ActionSheetProps = {
  tenantSlug: string
  /** Hoy en Córdoba (`acc_today`), `yyyy-MM-dd`. */
  today: string
  /** Lo que vino en la URL para precargar (ids validados como UUID). */
  params: ActionParams
  /**
   * Cierra la hoja SIN preguntar (después de guardar). Cerrar con Esc, la X o
   * tocando afuera pregunta «¿Descartás lo que cargaste?» si `setDirty(true)`.
   */
  close: () => void
  /** Avisá si hay algo cargado, para no perderlo con un Esc. */
  setDirty: (dirty: boolean) => void
}
