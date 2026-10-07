/**
 * Estado que devuelven las server actions de Administración (G.3) y el
 * resultado de `acc_post_bundle` (C.3.3 paso 10).
 *
 * Vive fuera de los archivos `'use server'` porque esos solo pueden exportar
 * funciones async: los tipos y los textos compartidos van acá.
 */

import type { z } from 'zod'
import type { WarningCopy } from './errors'
import type { EntryPreview } from './types'

/** Lo que devuelve `acc_post_bundle` (y, con `replayed: true`, un reintento con el mismo `clientRef`). */
export type PostBundleResult = {
  bundle_id: string
  replayed: boolean
  documents: Array<{
    ref: string
    id: string
    seq: number
    entry_id: string
    provisional_number: number | null
    lines: Array<{ line_no: number; journal_line_id: string }>
  }>
  allocations: string[]
}

export type AccFailureCode =
  | 'forbidden'
  | 'disabled'
  | 'invalid'
  | 'preview_stale'
  | 'needs_confirmation'
  | 'stale'
  | 'conflict'
  | 'error'

export type AccFailureState = {
  ok: false
  code: AccFailureCode
  message: string
  /** Primer error por campo (ruta con puntos: `'lines.2.accountId'`). */
  fieldErrors?: Record<string, string>
  /** Avisos sin aceptar (`needs_confirmation`), todos juntos. */
  warnings?: WarningCopy[]
  /** `preview_stale`: la vista previa recalculada desde la base y su hash. */
  preview?: EntryPreview[]
  hash?: string
  /** Datos para el log o para la UI (`key`, `bug`, ids). Nunca datos personales. */
  detail?: Record<string, unknown>
}

export type AccActionState =
  | { ok: true; result: PostBundleResult; message: string }
  | AccFailureState

/** Estado de las acciones que no guardan comprobantes (ajustes, accesos, cierres). */
export type AccSimpleState<T = undefined> = { ok: true; data: T; message: string } | AccFailureState

/**
 * Textos de cuando el servidor no contesta o la acción no existe todavía
 * (código desplegado antes que la migración). Los usa el formulario además de
 * `mapAccError`, que devuelve los mismos para `PGRST202`/`42883` y la red.
 */
export const ACC_UNREACHABLE = {
  offline: 'Sin conexión: no se guardó. Quedó cargado para reintentar.',
  notDeployed: 'Esta función todavía no está disponible. Actualizá la página en unos minutos.',
  retryLabel: 'Reintentar',
  unknown: 'No pudimos guardar. Probá de nuevo; si sigue, avisanos.',
} as const

/** Ruta de un issue de zod como la usan los formularios: `['lines', 2, 'accountId']` → `'lines.2.accountId'`. */
export function issuePath(path: ReadonlyArray<PropertyKey>): string {
  return path.map((p) => (typeof p === 'symbol' ? (p.description ?? '') : String(p))).join('.')
}

/**
 * Un `ZodError` → estado `invalid` con el primer error de cada campo. El
 * mensaje general es el del primer issue (los esquemas escriben todos sus
 * mensajes a mano en rioplatense).
 */
export function invalidState(error: z.ZodError): AccFailureState {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issuePath(issue.path)
    if (!(key in fieldErrors)) fieldErrors[key] = issue.message
  }
  return {
    ok: false,
    code: 'invalid',
    message: error.issues[0]?.message ?? 'Revisá los datos del formulario.',
    fieldErrors,
  }
}
