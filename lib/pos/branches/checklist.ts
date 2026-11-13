/**
 * La lista de apertura de una sucursal — PURO y testeado
 * (`tests/lib/pos-branches-checklist.test.ts`).
 *
 * Abrir una sucursal es una lista corta con lo que falta a la vista: el plano, la carta, la
 * cocina, la caja, el equipo y el cobro. Nadie tilda nada a mano: cada paso sale de lo que ya
 * está cargado, y se tilda solo cuando el dueño vuelve de cargarlo.
 *
 * El avance es una cuenta honesta («faltan 2 de 5»), no un porcentaje: un paso que todavía no
 * se puede hacer (la caja, que llega con el cobro) se muestra pero no entra en la cuenta.
 */

import { formatPercent } from '@/lib/pos/settings/percent'
import type { PosSettings } from '@/lib/pos/settings/types'
import type { Branch, BranchFacts, MenuFacts, TeamFacts } from './types'

export type StepId = 'plan' | 'menu' | 'kitchen' | 'cash' | 'team' | 'charge'

/** `done` hecho · `todo` falta · `soon` todavía no se puede hacer (no cuenta). */
export type StepState = 'done' | 'todo' | 'soon'

/** Qué le falta a un paso, para decidir a dónde lleva su botón. */
export type StepIssue =
  | 'no_sectors'
  | 'no_tables'
  | 'empty_menu'
  | 'nothing_sold'
  | 'unassigned'
  | 'never_seen'
  | 'no_register'
  | 'owners_only'
  | 'no_alias'

export type OpeningStep = {
  id: StepId
  state: StepState
  /** «El plano». */
  title: string
  /** Qué hay o qué falta, en una o dos oraciones. */
  detail: string
  /** Con `todo`: lo que falta, para la oración de arriba («dibujar el plano»). */
  missing: string | null
  /** Con `todo`: por qué falta. */
  issue: StepIssue | null
  /** Avisos que no frenan la apertura. */
  notes: string[]
  /** Es de todo el bar: vale igual para cada sucursal. */
  shared: boolean
}

export type Opening = {
  steps: OpeningStep[]
  /** Cuántos pasos entran en la cuenta (los que hoy se pueden hacer). */
  counted: number
  done: number
  /** Los que faltan, en el orden de la lista. */
  pending: OpeningStep[]
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/** «y», o «e» delante de «i» o «hi» («plano e instalación»), como se dice. */
export function lastConnector(last: string): 'y' | 'e' {
  return /^h?i(?!e)/i.test(last.trim()) ? 'e' : 'y'
}

/** «a», «a y b», «a, b y c». */
export function joinList(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items[0] ?? ''
  const last = items[items.length - 1] ?? ''
  return `${items.slice(0, -1).join(', ')} ${lastConnector(last)} ${last}`
}

const NUMBER_WORDS = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho']

/** «un», «dos», «tres»: los números chicos se leen mejor con letras en un título. */
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}

// ─── La carta: qué se vende y a qué estación va cada cosa ────────────────────────────────────

type CategoryNode = { id: string; name: string; parentId: string | null; stationId: string | null }
type ItemNode = { id: string; categoryId: string | null; stationId: string | null; active: boolean }

/** Una categoría no puede colgar de sí misma, pero la base no lo impide: se corta acá. */
const MAX_DEPTH = 12

/** Lo que el salón puede pedir: activo y con categoría (lo mismo que arma `pos_menu`). */
export function sellableItems<T extends Pick<ItemNode, 'categoryId' | 'active'>>(
  items: ReadonlyArray<T>,
): T[] {
  return items.filter((item) => item.active && item.categoryId !== null)
}

/**
 * Qué categorías tienen productos que no llegan a ninguna estación. La estación se pone en la
 * categoría y la heredan sus productos y sus subcategorías; un producto puede tener la suya
 * (misma regla que `private.pos_item_station`).
 */
export function unassignedCategories(
  categories: ReadonlyArray<CategoryNode>,
  items: ReadonlyArray<ItemNode>,
): MenuFacts['unassigned'] {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const inherited = new Map<string, boolean>()
  const hasStation = (categoryId: string): boolean => {
    const known = inherited.get(categoryId)
    if (known !== undefined) return known
    let current = byId.get(categoryId)
    let found = false
    for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
      if (current.stationId !== null) {
        found = true
        break
      }
      current = current.parentId === null ? undefined : byId.get(current.parentId)
    }
    inherited.set(categoryId, found)
    return found
  }

  const loose = new Map<string, number>()
  for (const item of sellableItems(items)) {
    if (item.stationId !== null || item.categoryId === null) continue
    if (hasStation(item.categoryId)) continue
    loose.set(item.categoryId, (loose.get(item.categoryId) ?? 0) + 1)
  }
  return [...loose]
    .map(([id, products]) => ({ id, name: byId.get(id)?.name ?? 'Sin nombre', products }))
    .sort((a, b) => b.products - a.products || a.name.localeCompare(b.name, 'es'))
}

// ─── Cuándo ──────────────────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0)
  const year = part('year')
  const month = part('month')
  const day = part('day')
  return {
    year,
    month,
    day,
    hour: part('hour') % 24,
    minute: part('minute'),
    /** El día como número corrido, para restar días sin pensar en meses. */
    dayNumber: Math.floor(Date.UTC(year, month - 1, day) / 86_400_000),
  }
}

const two = (n: number) => String(n).padStart(2, '0')

/** «hoy a las 21:40», «ayer a las 23:05», «el martes a las 20:10», «el 03/11». */
export function whenText(iso: string, now: Date, timeZone: string): string | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const then = localParts(at, timeZone)
  const today = localParts(now, timeZone)
  const time = `a las ${two(then.hour)}:${two(then.minute)}`
  const days = today.dayNumber - then.dayNumber
  if (days <= 0) return `hoy ${time}`
  if (days === 1) return `ayer ${time}`
  if (days < 7) {
    const weekday = WEEKDAYS[new Date(Date.UTC(then.year, then.month - 1, then.day)).getUTCDay()]
    return `el ${weekday} ${time}`
  }
  return `el ${two(then.day)}/${two(then.month)}`
}

// ─── Los pasos ───────────────────────────────────────────────────────────────────────────────

function planStep(facts: BranchFacts): OpeningStep {
  const base = { id: 'plan' as const, title: 'El plano', shared: false }
  const sectors = count(facts.sectors, 'sector', 'sectores')
  const loose =
    facts.looseTables > 0
      ? `${count(facts.looseTables, 'mesa cargada', 'mesas cargadas')} sin ubicar en el plano.`
      : null

  if (facts.sectors === 0) {
    return {
      ...base,
      state: 'todo',
      detail: 'Todavía no hay nada dibujado. Armá los sectores y poné las mesas.',
      missing: 'dibujar el plano',
      issue: 'no_sectors',
      notes: loose ? [loose] : [],
    }
  }
  if (facts.tables === 0) {
    return {
      ...base,
      state: 'todo',
      detail: `${sectors} sin mesas todavía. Poné las mesas para que el salón las vea.`,
      missing: 'poner las mesas en el plano',
      issue: 'no_tables',
      notes: loose ? [loose] : [],
    }
  }
  return {
    ...base,
    state: 'done',
    detail: `${sectors} y ${count(facts.tables, 'mesa', 'mesas')} en el plano.`,
    missing: null,
    issue: null,
    notes: loose ? [loose] : [],
  }
}

function menuStep(facts: BranchFacts, menu: MenuFacts): OpeningStep {
  const base = { id: 'menu' as const, title: 'La carta', shared: false }
  const sold = Math.max(0, menu.products - facts.unavailable)
  const soldText = `${count(sold, 'producto se vende', 'productos se venden')} acá`

  if (menu.products === 0) {
    return {
      ...base,
      state: 'todo',
      detail: 'La carta está vacía. Cargá lo que vendés: es la misma para todas las sucursales.',
      missing: 'cargar la carta',
      issue: 'empty_menu',
      notes: [],
    }
  }
  if (sold === 0) {
    return {
      ...base,
      state: 'todo',
      detail: 'Ningún producto de la carta se vende en esta sucursal.',
      missing: 'elegir qué se vende acá',
      issue: 'nothing_sold',
      notes: [],
    }
  }

  const notes: string[] = []
  if (facts.unavailable > 0) {
    notes.push(
      `${count(facts.unavailable, 'producto de la carta no se vende', 'productos de la carta no se venden')} acá.`,
    )
  }
  if (facts.ownPrices > 0) {
    notes.push(`${count(facts.ownPrices, 'tiene', 'tienen')} precio propio en esta sucursal.`)
  }

  // Sin estaciones no falta nada: con una sola pantalla, todo sale ahí.
  if (menu.stations.length === 0) {
    return {
      ...base,
      state: 'done',
      detail: `${soldText}. No hay estaciones de cocina: todos los pedidos salen en una misma pantalla.`,
      missing: null,
      issue: null,
      notes,
    }
  }
  if (menu.unassigned.length > 0) {
    const categories = count(menu.unassigned.length, 'categoría', 'categorías')
    const verb = menu.unassigned.length === 1 ? 'no tiene' : 'no tienen'
    return {
      ...base,
      state: 'todo',
      detail: `${soldText}. ${categories} todavía ${verb} estación: sus pedidos salen en todas las pantallas de cocina.`,
      missing: `darle estación a ${categories}`,
      issue: 'unassigned',
      notes,
    }
  }
  return {
    ...base,
    state: 'done',
    detail: `${soldText}, y cada uno sabe a qué estación va: ${joinList(menu.stations.map((station) => station.name))}.`,
    missing: null,
    issue: null,
    notes,
  }
}

function kitchenStep(
  facts: BranchFacts,
  team: TeamFacts,
  now: Date,
  timeZone: string,
): OpeningStep {
  const base = { id: 'kitchen' as const, title: 'La cocina', shared: false }
  const notes =
    team.kitchen === 0
      ? ['No hay nadie con rol Cocina: la tele necesita un usuario propio para entrar.']
      : []
  if (facts.kitchenSeenAt) {
    const when = whenText(facts.kitchenSeenAt, now, timeZone)
    return {
      ...base,
      state: 'done',
      detail: `La pantalla de la cocina ya mostró pedidos de acá${when ? `. El último, ${when}` : ''}.`,
      missing: null,
      issue: null,
      notes,
    }
  }
  return {
    ...base,
    state: 'todo',
    detail:
      'Abrí el link en la tele de la cocina. Este paso se tilda solo cuando la pantalla muestre el primer pedido.',
    missing: 'prender la pantalla de la cocina',
    issue: 'never_seen',
    notes,
  }
}

function cashStep(facts: BranchFacts): OpeningStep {
  const base = { id: 'cash' as const, title: 'La caja', shared: false, notes: [] }
  if (facts.registers === null) {
    return {
      ...base,
      state: 'soon',
      detail: 'Llega con el cobro. No hay nada que armar: se crea sola al abrir el primer turno.',
      missing: null,
      issue: null,
    }
  }
  if (facts.registers === 0) {
    return {
      ...base,
      state: 'todo',
      detail: 'Todavía no se abrió ningún turno acá. La caja se crea sola con el primero.',
      missing: 'abrir el primer turno de caja',
      issue: 'no_register',
    }
  }
  return {
    ...base,
    state: 'done',
    detail: `${count(facts.registers, 'caja lista', 'cajas listas')} para abrir turno.`,
    missing: null,
    issue: null,
  }
}

/** «3 dueños, 2 mozos y 1 en la cocina». Solo los roles que tienen a alguien. */
export function teamSentence(team: TeamFacts): string {
  const parts = [
    team.owner > 0 ? count(team.owner, 'dueño', 'dueños') : null,
    team.cashier > 0 ? `${team.cashier} en la caja` : null,
    team.waiter > 0 ? count(team.waiter, 'mozo', 'mozos') : null,
    team.kitchen > 0 ? `${team.kitchen} en la cocina` : null,
    team.host > 0 ? count(team.host, 'anfitrión', 'anfitriones') : null,
  ].filter((part): part is string => part !== null)
  return joinList(parts)
}

function teamStep(team: TeamFacts): OpeningStep {
  const base = { id: 'team' as const, title: 'El equipo', shared: true }
  const staff = team.cashier + team.waiter + team.kitchen + team.host
  if (staff === 0) {
    return {
      ...base,
      state: 'todo',
      detail: `Hoy solo ${team.owner === 1 ? 'entra 1 dueño' : `entran ${team.owner} dueños`}. Sumá a quienes atienden las mesas y a la cocina.`,
      missing: 'sumar al equipo',
      issue: 'owners_only',
      notes: [],
    }
  }
  return {
    ...base,
    state: 'done',
    detail: `${teamSentence(team)}.`,
    missing: null,
    issue: null,
    notes: team.waiter + team.cashier === 0 ? ['Todavía nadie con rol de mozo ni de caja.'] : [],
  }
}

function chargeStep(settings: PosSettings): OpeningStep {
  const base = { id: 'charge' as const, title: 'El cobro', shared: true, notes: [] }
  const surcharge =
    settings.creditSurchargeBp > 0
      ? `Crédito con ${formatPercent(settings.creditSurchargeBp)} de recargo`
      : 'Crédito sin recargo'
  const bills = `${count(settings.billDenominations.length, 'billete', 'billetes')} para contar la caja`
  const alias = settings.transferAlias?.trim()
  if (!alias) {
    return {
      ...base,
      state: 'todo',
      detail: `Falta el alias para que los clientes transfieran. ${surcharge} y ${bills}.`,
      missing: 'cargar el alias para transferencias',
      issue: 'no_alias',
    }
  }
  return {
    ...base,
    state: 'done',
    detail: `Alias ${alias}. ${surcharge} y ${bills}.`,
    missing: null,
    issue: null,
  }
}

/** La lista de apertura de una sucursal, con su cuenta. */
export function buildOpening(input: {
  facts: BranchFacts
  menu: MenuFacts
  team: TeamFacts
  settings: PosSettings
  now: Date
  timeZone: string
}): Opening {
  const steps = [
    planStep(input.facts),
    menuStep(input.facts, input.menu),
    kitchenStep(input.facts, input.team, input.now, input.timeZone),
    cashStep(input.facts),
    teamStep(input.team),
    chargeStep(input.settings),
  ]
  const counted = steps.filter((step) => step.state !== 'soon')
  const pending = counted.filter((step) => step.state === 'todo')
  return { steps, counted: counted.length, done: counted.length - pending.length, pending }
}

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase('es') + text.slice(1)

export type OpeningHeadline = {
  /** «Faltan dos pasos», «Lista para abrir». */
  title: string
  /** La oración que lo explica. */
  sentence: string
  /** «Faltan 2», «Lista»: para donde no entra más. */
  short: string
}

/**
 * El titular de la ficha: cuánto falta y qué. `alone` = el bar tiene una sola sucursal y no
 * hace falta nombrarla.
 */
export function openingHeadline(
  opening: Opening,
  branch: Pick<Branch, 'name'>,
  alone: boolean,
): OpeningHeadline {
  const missing = opening.pending.length
  const soon = opening.steps.some((step) => step.state === 'soon')
  if (missing === 0) {
    const ready = opening.steps
      .filter((step) => step.state === 'done')
      .map((step) => lowerFirst(step.title))
    const names = joinList(ready)
    return {
      title: 'Lista para abrir',
      sentence: `${names.charAt(0).toLocaleUpperCase('es')}${names.slice(1)} están en su lugar.${soon ? ' La caja llega con el cobro.' : ''}`,
      short: 'Lista',
    }
  }
  const what = joinList(opening.pending.map((step) => step.missing ?? lowerFirst(step.title)))
  const where = alone ? 'Para abrir' : `Para abrir ${branch.name}`
  return {
    title: missing === 1 ? 'Falta un paso' : `Faltan ${numberWord(missing)} pasos`,
    sentence: `${where} falta ${what}.`,
    short: missing === 1 ? 'Falta 1' : `Faltan ${missing}`,
  }
}
