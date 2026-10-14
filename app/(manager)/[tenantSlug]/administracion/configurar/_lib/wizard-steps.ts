/**
 * Los pasos de la puesta en marcha como se VEN (rediseño de octubre 2026),
 * puro. Lo prueba `administracion-configurar-pasos.test.ts`.
 *
 * El asistente guardaba todo en dos pantallas (los datos de la SAS y, en una
 * sola, cajas + cobros + puntos de venta: unas treinta decisiones juntas, con
 * los porcentajes plegados; ahí fue el Enter del 12/10). Ahora son cinco pasos
 * chicos y el sexto son los saldos iniciales. Lo que se manda no cambió: el
 * mismo `WizardState`, el mismo `checkWizard` (que sigue validando en dos
 * tramos, 1 y 2) y UN solo guardado. Este archivo solo dice a qué paso visual
 * pertenece cada campo, cómo se resume cada paso y cómo se lee un borrador.
 */

import { padPv } from '@/lib/fiscal'
import {
  effectiveMethods,
  effectiveTransferDestination,
  enabledTreasuries,
  PLATFORMS,
  WIZARD_METHODS,
  type WizardState,
} from './wizard'

// ─── El riel ─────────────────────────────────────────────────────────────────

/** Los seis pasos del riel: el nombre de cada lugar, igual que en Ajustes. */
export const SETUP_RAIL_STEPS = [
  'Datos de la SAS',
  'Cajas y cuentas',
  'Medios de cobro',
  'Puntos de venta',
  'Revisá y arrancá',
  'Saldos iniciales',
] as const

/** El paso de los saldos iniciales (el último del riel). */
export const OPENING_RAIL_STEP = 6

export type RailState = 'done' | 'current' | 'todo'
export type RailItem = { title: string; state: RailState; summary?: string }

/**
 * El riel con el avance de verdad. `current` es el paso que toca (1 a 6) o
 * `'done'` cuando ya está todo. `summaries[n]` es lo que quedó cargado en el
 * paso `n`, para mostrarlo debajo de su nombre. `doneUpTo` es el último paso
 * ya resuelto cuando se volvió atrás a cambiar uno anterior (el asistente): lo
 * que ya se cargó sigue tildado aunque el paso actual sea otro.
 */
export function setupRailItems(
  current: number | 'done',
  summaries: Readonly<Record<number, string | null | undefined>> = {},
  doneUpTo = 0,
): RailItem[] {
  return SETUP_RAIL_STEPS.map((title, index) => {
    const n = index + 1
    const state: RailState =
      current === 'done'
        ? 'done'
        : n === current
          ? 'current'
          : n < current || n <= doneUpTo
            ? 'done'
            : 'todo'
    const summary = state === 'done' ? (summaries[n] ?? undefined) : undefined
    return summary ? { title, state, summary } : { title, state }
  })
}

// ─── Los cinco pasos del asistente ───────────────────────────────────────────

/** Los pasos que se cargan antes del único guardado. */
export type WizardScreen = 1 | 2 | 3 | 4 | 5
export const WIZARD_SCREENS: readonly WizardScreen[] = [1, 2, 3, 4, 5]
export const REVIEW_SCREEN: WizardScreen = 5

/** La pregunta de cada paso: el riel dice el nombre, la tarjeta pregunta. */
export const WIZARD_QUESTIONS: Readonly<Record<WizardScreen, string>> = {
  1: '¿Cómo figura el bar en los papeles?',
  2: '¿Dónde está la plata?',
  3: '¿Cómo te pagan?',
  4: '¿Con qué número facturás?',
  5: 'Revisá y arrancá',
}

/** El botón que cierra cada paso: dice a dónde va. */
export const WIZARD_NEXT_LABEL: Readonly<Record<1 | 2 | 3 | 4, string>> = {
  1: 'Seguir con las cajas',
  2: 'Seguir con los cobros',
  3: 'Seguir con las facturas',
  4: 'Revisar todo',
}

/**
 * A qué paso visual pertenece el error de un campo (las claves que arma
 * `wizardFieldKey`). Lo que no es de ningún campo (`form`) va al paso 1, como
 * siempre.
 */
export function visualStepOfField(field: string): 1 | 2 | 3 | 4 {
  if (field === 'treasuries' || field.startsWith('treasury.')) return 2
  if (
    field === 'methods' ||
    field === 'transferDestination' ||
    field === 'rates' ||
    field.startsWith('rates.')
  ) {
    return 3
  }
  if (field === 'salesPoints' || field.startsWith('salesPoint.')) return 4
  // `STEP_ONE_FIELDS` y `form`; una clave que no se conoce también va al principio.
  return 1
}

/** Los errores que se muestran al dejar un paso: solo los suyos. */
export function errorsOfScreen(
  errors: Readonly<Record<string, string>>,
  screen: WizardScreen,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [field, message] of Object.entries(errors)) {
    if (visualStepOfField(field) === screen) out[field] = message
  }
  return out
}

/** El primer paso que tiene un error (para abrirlo y llevar el foco a su campo). */
export function firstErrorScreen(errors: Readonly<Record<string, string>>): 1 | 2 | 3 | 4 | null {
  const screens = Object.keys(errors).map(visualStepOfField)
  return screens.length === 0 ? null : (Math.min(...screens) as 1 | 2 | 3 | 4)
}

// ─── La bienvenida ───────────────────────────────────────────────────────────

/** Lo que conviene tener a mano para los cinco pasos (los saldos iniciales piden el resto después). */
const WELCOME_NEEDS: readonly RegExp[] = [
  /constancia de inscripción/i,
  /saldo de Mercado Pago/i,
  /comisión/i,
  /puntos de venta/i,
]

/**
 * Los cuatro renglones de «Tené a mano» de la bienvenida, tomados de la lista
 * de la guía «Cómo arrancar» (`ONBOARDING_HAVE_AT_HAND`): una sola redacción.
 */
export function welcomeChecklist(all: readonly string[]): string[] {
  return WELCOME_NEEDS.map((needle) => all.find((line) => needle.test(line))).filter(
    (line): line is string => line !== undefined,
  )
}

// ─── El borrador ─────────────────────────────────────────────────────────────

export const WIZARD_DRAFT_VERSION = 1

/**
 * El tramo de `checkWizard` de cada paso visual, que es lo que el borrador
 * guardó siempre en `step`: 1 = datos de la SAS; 2 = todo lo demás.
 */
export function draftStepOf(screen: WizardScreen): 1 | 2 {
  return screen === 1 ? 1 : 2
}

export type WizardDraft = { step: 1 | 2; screen: WizardScreen; state: unknown }

/**
 * Lo guardado en el navegador (`hub:acc:draft:configurar:{slug}`) → dónde
 * retomar. Un borrador de antes del rediseño (`{ v: 1, step: 2, state }`, sin
 * `screen`) se sigue leyendo: retoma en el primer paso de su tramo. `null` si
 * es de otra versión o no se entiende.
 */
export function readWizardDraft(raw: unknown): WizardDraft | null {
  if (typeof raw !== 'object' || raw === null) return null
  const draft = raw as { v?: unknown; step?: unknown; screen?: unknown; state?: unknown }
  if (draft.v !== WIZARD_DRAFT_VERSION) return null
  const step: 1 | 2 = draft.step === 2 ? 2 : 1
  const saved = draft.screen
  const screen: WizardScreen =
    typeof saved === 'number' &&
    (WIZARD_SCREENS as readonly number[]).includes(saved) &&
    draftStepOf(saved as WizardScreen) === step
      ? (saved as WizardScreen)
      : step === 2
        ? 2
        : 1
  return { step, screen, state: draft.state }
}

/** Lo que se guarda: la clave, la versión y `step` de siempre, más `screen`. */
export function wizardDraftValue(
  screen: WizardScreen,
  state: WizardState,
): { v: number; step: 1 | 2; screen: WizardScreen; state: WizardState } {
  return { v: WIZARD_DRAFT_VERSION, step: draftStepOf(screen), screen, state }
}

// ─── El resumen de cada paso (plegado, y en el ticket del final) ─────────────

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

/** `'2026-10-01'` → `'01/10/2026'` (sin pasar por una fecha: es un día civil). */
function day(iso: string | null): string | null {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null
}

/** «Hub bar SAS · cargás desde el 01/10/2026». */
export function sasSummary(state: Pick<WizardState, 'legalName' | 'booksStartDate'>): string {
  const name = state.legalName.trim() || 'Sin razón social'
  const from = day(state.booksStartDate)
  return from ? `${name} · cargás desde el ${from}` : name
}

/** Los nombres de las cajas que se van a crear: «Caja, Mercado Pago y Banco Nación». */
export function treasuryNames(state: Pick<WizardState, 'treasuries'>): string[] {
  return enabledTreasuries(state as WizardState).map((t) => t.name.trim() || 'Sin nombre')
}

export function cajasSummary(state: Pick<WizardState, 'treasuries'>): string {
  const names = treasuryNames(state)
  return names.length === 0 ? 'Ninguna caja' : joinNames(names)
}

/** Cuántos medios quedan prendidos (los del cierre más las apps de delivery). */
export function enabledMethodCount(state: WizardState): number {
  const methods = effectiveMethods(state)
  return (
    WIZARD_METHODS.filter((m) => methods[m]).length +
    PLATFORMS.filter((p) => state.platforms[p.key]).length
  )
}

/** «6 medios · transferencias a Mercado Pago». */
export function cobrosSummary(state: WizardState): string {
  const n = enabledMethodCount(state)
  const count = n === 0 ? 'Ningún medio' : `${n} ${n === 1 ? 'medio' : 'medios'}`
  if (!effectiveMethods(state).transfer) return count
  const key = effectiveTransferDestination(state)
  const destination = state.treasuries.find((t) => t.key === key)?.name.trim()
  return destination ? `${count} · transferencias a ${destination}` : count
}

/** Los puntos de venta que van a viajar (los renglones en blanco no cuentan). */
export function filledSalesPoints(
  state: Pick<WizardState, 'salesPoints'>,
): WizardState['salesPoints'] {
  return state.salesPoints.filter((p) => p.number.trim() !== '' || p.label.trim() !== '')
}

const CHANNEL_WORD = { salon: 'Salón', delivery: 'Delivery', events: 'Eventos' } as const

/** «0003» si es un número; lo que se escribió, si no. */
function pointNumber(text: string): string {
  const t = text.trim()
  return /^\d{1,5}$/.test(t) ? padPv(Number(t), 4) : t || '—'
}

/** «Punto de venta 0003 · Salón» · «2 puntos de venta: 0003 y 0005» · «Sin puntos de venta». */
export function puntosSummary(state: Pick<WizardState, 'salesPoints'>): string {
  const points = filledSalesPoints(state)
  const first = points[0]
  if (first === undefined) return 'Sin puntos de venta'
  if (points.length === 1) {
    return `Punto de venta ${pointNumber(first.number)} · ${first.label.trim() || CHANNEL_WORD[first.channel]}`
  }
  return `${points.length} puntos de venta: ${joinNames(points.map((p) => pointNumber(p.number)))}`
}
