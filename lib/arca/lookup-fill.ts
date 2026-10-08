/**
 * «Completar con ARCA» (diseño §3.1): de lo que trae ARCA de una CUIT
 * (`PadronLookupData`) a los campos de cada formulario donde se carga un proveedor
 * o un cliente (nombre, condición frente al IVA y dirección).
 *
 * La regla: **no pisar lo que la persona escribió.** Lo vacío se completa solo, lo
 * que ya dice lo mismo queda como está y lo distinto se pregunta antes. Escribir el
 * comienzo del nombre («distri» para «DISTRIBUIDORA EJEMPLO SA», lo que se tipeó en
 * el combo para buscar) cuenta como vacío: es una búsqueda, no una elección.
 *
 * Puro (sin red ni React): lo usa `components/administracion/arca-lookup.tsx` en el
 * navegador y lo prueban los tests.
 */

import { IVA_CONDITIONS, type IvaCondition } from '@/lib/accounting/types'
import { formatDate } from '@/lib/dates'
import { type ArcaGuideStepId, guideStep, isArcaGuideStepId } from './guide'
import {
  ivaConditionText,
  type PadronLookupData,
  type PadronLookupFailureCode,
  type PadronLookupResult,
} from './views'

// ─── Campos ──────────────────────────────────────────────────────────────────

export const LOOKUP_FILL_FIELDS = ['name', 'ivaCondition', 'address'] as const
export type LookupFillField = (typeof LOOKUP_FILL_FIELDS)[number]

/** Los mismos topes que el alta y la ficha de proveedores y clientes (`maxLength`). */
export const LOOKUP_NAME_MAX = 120
export const LOOKUP_ADDRESS_MAX = 200

const DEFAULT_LABELS: Readonly<Record<LookupFillField, string>> = {
  name: 'Razón social',
  ivaCondition: 'Condición frente al IVA',
  address: 'Dirección',
}

/** Lo que tiene hoy el formulario. Un campo `undefined` es uno que el formulario no tiene. */
export type LookupFormValues = {
  readonly name?: string | null
  readonly ivaCondition?: IvaCondition | null
  readonly address?: string | null
}

export type LookupFormSpec = {
  /** Las opciones del combo de condición frente al IVA (por defecto, las seis). */
  readonly ivaOptions?: readonly IvaCondition[]
  /**
   * Los campos que la persona eligió (el combo de la condición que tocó, o lo que
   * ya estaba guardado en la ficha): si ARCA dice otra cosa, se pregunta antes,
   * aunque lo de ahora sea el comienzo de lo de ARCA. Un texto que no está en la
   * lista se pregunta igual si no está vacío, salvo que sea el comienzo de lo de
   * ARCA (lo que se tipeó en el combo para buscar).
   */
  readonly chosen?: readonly LookupFillField[]
  /** Cómo se llama cada campo en ese formulario (para la pregunta y el «Listo»). */
  readonly labels?: Partial<Record<LookupFillField, string>>
}

/** Los valores para poner en el formulario (solo los campos que cambian). */
export type LookupFillPatch = {
  name?: string
  ivaCondition?: IvaCondition
  address?: string
}

export type LookupFillChange = {
  readonly field: LookupFillField
  readonly label: string
  /** Lo que hay hoy, para mostrar (`null`: vacío). */
  readonly from: string | null
  /** Lo que dice ARCA, para mostrar. */
  readonly to: string
}

export type LookupFillPlan = {
  /** Lo que se completa sin preguntar: lo vacío y lo que es el comienzo de lo de ARCA. */
  readonly fill: LookupFillPatch
  /** Lo que pisa algo que la persona eligió: se pregunta antes. */
  readonly replace: LookupFillPatch
  readonly fills: readonly LookupFillChange[]
  readonly conflicts: readonly LookupFillChange[]
  /** Ya dice lo mismo que ARCA. */
  readonly unchanged: readonly LookupFillField[]
  /** Lo que no se puede completar solo, en palabras simples. */
  readonly notes: readonly string[]
}

// ─── Textos ──────────────────────────────────────────────────────────────────

function cleanText(text: string | null | undefined): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat === '' ? null : flat
}

function clip(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('').trim() : text
}

/**
 * Las palabras de un nombre para compararlo: sin tildes, sin mayúsculas y sin los
 * puntos de las siglas («S.A.» = «SA»).
 */
export function lookupWords(text: string | null | undefined): string[] {
  return (text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\./g, '')
    .split(/[^a-z0-9&]+/)
    .filter((word) => word !== '')
}

/** «Distribuidora Ejemplo S.A.» y «DISTRIBUIDORA EJEMPLO SA» dicen lo mismo. */
export function sameLookupText(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = lookupWords(a)
  return x.length > 0 && x.join(' ') === lookupWords(b).join(' ')
}

/**
 * Lo que escribió la persona es el comienzo de lo que dice ARCA: cada palabra
 * escrita empieza una palabra de ARCA («distri ejemplo» → «DISTRIBUIDORA EJEMPLO SA»).
 * Completarlo no pisa nada.
 */
export function completesTyped(
  typed: string | null | undefined,
  full: string | null | undefined,
): boolean {
  const words = lookupWords(typed)
  const target = lookupWords(full)
  if (words.length === 0 || target.length === 0) return false
  return words.every((word) => target.some((candidate) => candidate.startsWith(word)))
}

/** Une con comas y una «y» al final: «a, b y c». */
export function joinEs(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

/**
 * El domicilio fiscal en una línea: «AV COLON 1234, CORDOBA» (sin repetir la
 * localidad cuando es igual a la provincia). `null` si ARCA no trae nada.
 */
export function padronAddressText(
  data: Pick<PadronLookupData, 'address' | 'locality' | 'province'>,
): string | null {
  const parts: string[] = []
  for (const raw of [data.address, data.locality, data.province]) {
    const part = cleanText(raw)
    if (!part || parts.some((p) => sameLookupText(p, part))) continue
    parts.push(part)
  }
  return parts.length === 0 ? null : clip(parts.join(', '), LOOKUP_ADDRESS_MAX)
}

/** `fisica` → «Persona» · `juridica` → «Empresa». */
export function personKindText(kind: PadronLookupData['personKind']): string | null {
  return kind === 'fisica' ? 'Persona' : kind === 'juridica' ? 'Empresa' : null
}

/**
 * Qué quiere decir cada condición frente al IVA, en palabras simples. No promete
 * letras de factura ni crédito fiscal: eso depende también de la condición del bar.
 */
const IVA_PLAIN_TEXT: Readonly<Record<IvaCondition, string>> = {
  responsable_inscripto: 'Está inscripto en el IVA: cobra IVA en lo que vende.',
  monotributo: 'Está en el monotributo: paga una cuota fija por mes y no cobra IVA aparte.',
  exento: 'Está exento: no cobra IVA en lo que vende.',
  no_alcanzado: 'Lo que hace no paga IVA.',
  consumidor_final: 'No está inscripto en el IVA ni en el monotributo.',
  sin_datos: 'ARCA no dice si está inscripto en el IVA.',
}

export function ivaPlainText(condition: IvaCondition): string {
  return IVA_PLAIN_TEXT[condition]
}

// ─── Condición frente al IVA ─────────────────────────────────────────────────

/**
 * Las condiciones que son una respuesta firme de ARCA: se completan aunque el combo
 * del formulario no las tenga (el formulario la suma con `ivaOptionsWith`). Las
 * otras dos (`sin_datos` y `consumidor_final` de una persona sin inscripciones) son
 * falta de datos: solo se usan si el combo ya las ofrece.
 */
const FIRM_CONDITIONS: ReadonlySet<IvaCondition> = new Set<IvaCondition>([
  'responsable_inscripto',
  'monotributo',
  'exento',
  'no_alcanzado',
])

/** La condición para el combo del formulario, o `null` si conviene que la elija la persona. */
export function lookupIvaTarget(
  arca: IvaCondition,
  options: readonly IvaCondition[] = IVA_CONDITIONS,
): IvaCondition | null {
  if (arca === 'sin_datos') return null
  if (options.includes(arca)) return arca
  return FIRM_CONDITIONS.has(arca) ? arca : null
}

function ivaNote(arca: IvaCondition): string {
  return arca === 'sin_datos'
    ? 'ARCA no dice la condición frente al IVA: elegila vos.'
    : 'Según ARCA no está inscripto en el IVA ni en el monotributo: elegí la condición vos.'
}

/**
 * Las opciones del combo de la condición con la que tiene el formulario si no está
 * entre ellas (p. ej. «No alcanzado» que vino de ARCA), para que el combo la muestre.
 */
export function ivaOptionsWith<T extends { readonly value: IvaCondition; readonly label: string }>(
  options: readonly T[],
  current: IvaCondition | null | undefined,
): ReadonlyArray<{ readonly value: IvaCondition; readonly label: string }> {
  if (!current || options.some((o) => o.value === current)) return options
  return [...options, { value: current, label: ivaConditionText(current) ?? current }]
}

// ─── El plan ─────────────────────────────────────────────────────────────────

/**
 * Qué se completa, qué se pregunta y qué ya está igual, comparando lo que trae ARCA
 * con lo que tiene el formulario.
 */
export function planLookupFill(
  data: PadronLookupData,
  values: LookupFormValues,
  spec: LookupFormSpec = {},
): LookupFillPlan {
  const labels = { ...DEFAULT_LABELS, ...spec.labels }
  const chosen = new Set<LookupFillField>(spec.chosen ?? [])
  const fill: LookupFillPatch = {}
  const replace: LookupFillPatch = {}
  const fills: LookupFillChange[] = []
  const conflicts: LookupFillChange[] = []
  const unchanged: LookupFillField[] = []
  const notes: string[] = []

  const change = (field: LookupFillField, from: string | null, to: string): LookupFillChange => ({
    field,
    label: labels[field],
    from,
    to,
  })

  // Un texto: vacío o el comienzo → se completa; igual → nada; distinto → se pregunta.
  const text = (field: 'name' | 'address', current: string | null | undefined, to: string) => {
    const from = cleanText(current)
    if (from !== null && sameLookupText(from, to)) {
      unchanged.push(field)
      return
    }
    if (from === null || (!chosen.has(field) && completesTyped(from, to))) {
      fill[field] = to
      fills.push(change(field, from, to))
      return
    }
    replace[field] = to
    conflicts.push(change(field, from, to))
  }

  if (values.name !== undefined) {
    const name = cleanText(data.name)
    if (name) text('name', values.name, clip(name, LOOKUP_NAME_MAX))
  }

  if (values.ivaCondition !== undefined) {
    const target = lookupIvaTarget(data.ivaCondition, spec.ivaOptions ?? IVA_CONDITIONS)
    const current = values.ivaCondition
    if (target === null) {
      notes.push(ivaNote(data.ivaCondition))
    } else if (current === target) {
      unchanged.push('ivaCondition')
    } else {
      const item = change(
        'ivaCondition',
        current ? (ivaConditionText(current) ?? current) : null,
        ivaConditionText(target) ?? target,
      )
      if (current && chosen.has('ivaCondition')) {
        replace.ivaCondition = target
        conflicts.push(item)
      } else {
        fill.ivaCondition = target
        fills.push(item)
      }
    }
  }

  // La dirección solo si ARCA trae la calle: «CORDOBA» sola no es una dirección.
  if (values.address !== undefined && cleanText(data.address)) {
    const address = padronAddressText(data)
    if (address) text('address', values.address, address)
  }

  return { fill, replace, fills, conflicts, unchanged, notes }
}

/**
 * Lo que se pone en el formulario: solo lo vacío, o también lo que se preguntó.
 * `kept` es lo distinto que queda como estaba.
 */
export function lookupPatch(
  plan: LookupFillPlan,
  replace: boolean,
): {
  readonly patch: LookupFillPatch
  readonly changes: readonly LookupFillChange[]
  readonly kept: readonly LookupFillChange[]
} {
  return replace
    ? {
        patch: { ...plan.fill, ...plan.replace },
        changes: [...plan.fills, ...plan.conflicts],
        kept: [],
      }
    : { patch: { ...plan.fill }, changes: plan.fills, kept: plan.conflicts }
}

/**
 * «Listo: completamos razón social y condición frente al IVA con lo que dice ARCA.»
 * `kept`: lo distinto que la persona prefirió dejar como estaba («Dejar lo mío»).
 */
export function lookupAppliedMessage(
  changes: readonly LookupFillChange[],
  kept: readonly LookupFillChange[] = [],
): string {
  if (changes.length === 0) {
    return kept.length > 0
      ? 'Listo: dejamos lo que tenías.'
      : 'Listo: ya coincidía con lo que dice ARCA.'
  }
  const done = `Listo: completamos ${joinEs(changes.map((c) => lowerFirst(c.label)))} con lo que dice ARCA.`
  return kept.length > 0 ? `${done} Lo demás quedó como estaba.` : done
}

// ─── Resultado de la consulta ────────────────────────────────────────────────

/** Lo que se anuncia al lector de pantalla cuando llega la respuesta. */
export function lookupAnnouncement(result: PadronLookupResult): string {
  if (!result.ok) return result.message
  const data = result.data
  return [
    `ARCA encontró a ${data.name}${data.testData ? ' (datos de prueba)' : ''}.`,
    data.active ? null : 'Ojo: la CUIT está inactiva.',
  ]
    .filter(Boolean)
    .join(' ')
}

/** «Recién consultado en ARCA.» o «Consultado en ARCA el 03/10/2026.» (lo guardado). */
export function lookupSourceText(data: Pick<PadronLookupData, 'source' | 'fetchedAt'>): string {
  if (data.source === 'arca') return 'Recién consultado en ARCA.'
  const day = formatDate(data.fetchedAt)
  return day ? `Consultado en ARCA el ${day}.` : 'Consultado en ARCA antes.'
}

/** Ajustes › ARCA (la pestaña), para «Conectá ARCA para completar esto solo». */
export function arcaSettingsHref(tenantSlug: string): string {
  return `/${tenantSlug}/administracion/ajustes?tab=arca`
}

/** La guía «Conectar ARCA», en el paso que arregla el problema (`#paso-8`). */
export function arcaGuideStepHref(tenantSlug: string, step: ArcaGuideStepId | null): string {
  const base = `/${tenantSlug}/administracion/ajustes/arca`
  return step && isArcaGuideStepId(step) ? `${base}#paso-${guideStep(step).n}` : base
}

export type LookupFailureView = {
  /** `warning`: algo para revisar (la CUIT) · `error`: la consulta no anduvo. */
  readonly tone: 'warning' | 'error'
  readonly message: string
  /** «Cómo arreglarlo» → el paso de la guía. */
  readonly fixHref: string | null
  /** «Conectar ARCA» → Ajustes › ARCA. */
  readonly connectHref: string | null
  /** `again`: probar de nuevo · `refresh`: volver a preguntarle a ARCA (sin lo guardado). */
  readonly retry: 'again' | 'refresh' | null
}

const WARNING_CODES: ReadonlySet<PadronLookupFailureCode> = new Set<PadronLookupFailureCode>([
  'invalid_cuit',
  'not_found',
  'arca_not_connected',
  'rate_limited',
])

/** Cómo se muestra una consulta que no trajo datos: el texto, el tono y qué se puede hacer. */
export function lookupFailureView(
  tenantSlug: string,
  failure: Extract<PadronLookupResult, { ok: false }>,
): LookupFailureView {
  const code = failure.code
  const step =
    failure.step ?? (code === 'arca_not_authorized' ? ('s8_padron' as ArcaGuideStepId) : null)
  return {
    tone: WARNING_CODES.has(code) ? 'warning' : 'error',
    message: failure.message,
    fixHref:
      step && code !== 'arca_not_connected' && code !== 'forbidden'
        ? arcaGuideStepHref(tenantSlug, step)
        : null,
    connectHref: code === 'arca_not_connected' ? arcaSettingsHref(tenantSlug) : null,
    retry:
      code === 'not_found'
        ? 'refresh'
        : code === 'arca_unavailable' || code === 'rate_limited' || code === 'error'
          ? 'again'
          : null,
  }
}
