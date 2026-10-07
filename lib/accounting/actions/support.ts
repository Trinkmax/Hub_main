import 'server-only'

/**
 * Piezas comunes de las acciones de puesta en marcha, datos maestros, accesos y
 * cierres (G.3). Fuera de los archivos `'use server'` (esos solo exportan
 * funciones async que el navegador puede llamar).
 *
 * Nunca se loguean datos personales (CLAUDE.md §9): solo la operación, la
 * clave del error y el SQLSTATE. Ni `error.details` (puede traer un CUIT) ni el
 * contenido del formulario.
 */

import { revalidatePath } from 'next/cache'
import type { AccFailureState } from '../action-state'
import {
  ACC_ERRORS,
  ACC_GENERIC_ERROR,
  type AccErrorKey,
  accErrorMessage,
  type MapAccErrorOptions,
  mapAccError,
  type PgLikeError,
} from '../errors'

// ─── Entrada ─────────────────────────────────────────────────────────────────

/** FormData → objeto (un valor por clave); cualquier otra cosa pasa igual. */
export function formInput(raw: unknown): unknown {
  if (typeof FormData !== 'undefined' && raw instanceof FormData) {
    const out: Record<string, FormDataEntryValue> = {}
    for (const [key, value] of raw.entries()) out[key] = value
    return out
  }
  return raw
}

/**
 * Las claves que mandó el formulario. En una EDICIÓN solo se mandan a la base
 * esas: un formulario parcial (p. ej. el CUIT y las tasas de un partícipe del
 * sistema) no pisa con defaults lo que no muestra.
 */
export function presentKeys(raw: unknown): ReadonlySet<string> {
  if (typeof FormData !== 'undefined' && raw instanceof FormData) {
    return new Set(raw.keys())
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return new Set(
      Object.entries(raw as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k),
    )
  }
  return new Set()
}

/** Pares `campo del formulario → columna` para armar el jsonb de una RPC. */
export type FieldMap = ReadonlyArray<readonly [string, string]>

/**
 * Arma el jsonb de una RPC de datos maestros. `keep` decide qué campos van
 * (todos en un alta; los presentes en una edición). Los `undefined` no viajan.
 */
export function rpcPayload(
  data: Readonly<Record<string, unknown>>,
  fields: FieldMap,
  keep: (field: string) => boolean = () => true,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [field, column] of fields) {
    if (!keep(field)) continue
    const value = data[field]
    if (value !== undefined) out[column] = value
  }
  return out
}

// ─── Estados ─────────────────────────────────────────────────────────────────

/** Un error del catálogo como estado de la acción. */
export function accFailure(
  key: AccErrorKey,
  vars: Readonly<Record<string, string>> = {},
  fieldErrors?: Record<string, string>,
): AccFailureState {
  const message = accErrorMessage(key, vars)
  return {
    ok: false,
    code: ACC_ERRORS[key].code,
    message,
    ...(fieldErrors ? { fieldErrors } : {}),
    detail: { key },
  }
}

/** Error de un campo puntual (validación que zod no puede hacer sola). */
export function fieldFailure(field: string, message: string): AccFailureState {
  return { ok: false, code: 'invalid', message, fieldErrors: { [field]: message } }
}

/**
 * Error de una RPC → estado con el texto del catálogo. Los que son de
 * programación (`bug`) o no se reconocen se loguean con la operación y el
 * código, sin datos personales.
 */
export function rpcFailure(
  op: string,
  error: PgLikeError,
  opts: MapAccErrorOptions = {},
): AccFailureState {
  const state = mapAccError(error, opts)
  const key = typeof state.detail?.key === 'string' ? state.detail.key : null
  if (state.detail?.bug === true || state.code === 'error') {
    console.error(`[accounting.${op}]`, key ?? 'sin_clave', error.code ?? '')
  }
  return state
}

/** Algo que no esperábamos (una excepción): se loguea y se muestra el genérico. */
export function unexpectedFailure(op: string, error: unknown): AccFailureState {
  console.error(
    `[accounting.${op}] inesperado`,
    error instanceof Error ? `${error.name}: ${error.message}` : 'unknown',
  )
  return { ok: false, code: 'error', message: ACC_GENERIC_ERROR }
}

// ─── Revalidación (G.6) ──────────────────────────────────────────────────────

/**
 * Toda escritura termina acá. `tenant` además refresca el shell del bar (el
 * menú cambia al configurar o al dar y quitar accesos).
 */
export function revalidateAccounting(slug: string, scope: 'section' | 'tenant' = 'section'): void {
  try {
    revalidatePath(scope === 'tenant' ? `/${slug}` : `/${slug}/administracion`, 'layout')
  } catch (error) {
    // Fuera de un request (tests) no hay a quién revalidar: lo guardado ya está.
    console.error('[accounting.revalidate]', error instanceof Error ? error.message : 'unknown')
  }
}

// ─── Lectura de lo que devuelven las RPC ─────────────────────────────────────

export type Rec = Record<string, unknown>

export function asRecord(v: unknown): Rec | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null
}

export function textOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** Entero (un `bigint` de Postgres puede llegar como texto). */
export function intOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  if (typeof v === 'string' && /^-?\d{1,16}$/.test(v.trim())) {
    const n = Number(v.trim())
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

export function boolOf(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** `'2026-10-01'` (o el día de un timestamp). */
export function dayOf(v: unknown): string | null {
  const t = textOf(v)
  if (!t) return null
  const day = t.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}
