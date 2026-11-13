/**
 * El borde de «Cocina y aclaraciones»: lo que el navegador le puede mandar al servidor. Los
 * largos y los topes son los mismos `check` de la base (`pos_salon_en_vivo`), así lo que pasa
 * por acá no rebota después.
 */

import { z } from 'zod'
import { nodeKey } from './types'

/** `kitchen_stations.name`: de 1 a 30 letras. */
export const STATION_NAME_MAX = 30
/** `menu_modifier_groups.name` y `menu_modifier_options.label`: de 1 a 40. */
export const GROUP_NAME_MAX = 40
export const OPTION_LABEL_MAX = 40
/** `menu_modifier_options.price_delta_cents`: de 0 a $ 1.000.000. */
export const OPTION_DELTA_MAX_CENTS = 100_000_000
/** Hasta cuántas marcas en un pedido: una carta grande entra holgada. */
export const MAX_ROUTE_CHANGES = 3_000
/** Una estación, un grupo o un grupo de opciones no pasan de esto. */
export const MAX_STATIONS = 24
export const MAX_GROUPS = 80
export const MAX_OPTIONS = 40
export const MAX_LINKS = 400

/** Lo tipeado, sin espacios de más: «  Punto   de la carne » → «Punto de la carne». */
export function cleanText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

const text = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform(cleanText)
    .pipe(z.string().min(1).max(max))

const id = z.guid()
const position = z.number().int().min(0).max(100_000)
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((hex) => hex.toLowerCase())
const deltaCents = z.number().int().min(0).max(OPTION_DELTA_MAX_CENTS)

/** Un campo que cambia: lo que la persona veía y lo que tiene que quedar. */
const change = <Schema extends z.ZodType>(schema: Schema) => z.object({ from: schema, to: schema })

// ─── A dónde va cada cosa ────────────────────────────────────────────────────

/** Por qué se cambian: una marca, deshacer, pasar todo de una estación a otra, la propuesta. */
export const ROUTE_REASONS = ['mark', 'undo', 'move', 'proposal', 'tidy'] as const
export type RouteReason = (typeof ROUTE_REASONS)[number]

const routeChange = z.object({
  node: z.enum(['category', 'item']),
  id,
  /** `null` = sin estación propia. */
  to: id.nullable(),
  /** La estación propia que la persona veía ahí. */
  expected: id.nullable(),
})

export const applyRouteSchema = z
  .object({
    changes: z.array(routeChange).min(1).max(MAX_ROUTE_CHANGES),
    reason: z.enum(ROUTE_REASONS),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    for (const [index, each] of value.changes.entries()) {
      const key = nodeKey(each.node, each.id)
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['changes', index], message: 'Marca repetida.' })
      }
      seen.add(key)
    }
  })

export type ApplyRouteInput = z.infer<typeof applyRouteSchema>

// ─── Estaciones ──────────────────────────────────────────────────────────────

const stationRow = z.object({
  id,
  name: text(STATION_NAME_MAX),
  color,
  position,
  active: z.boolean(),
})

export const createStationsSchema = z
  .object({ stations: z.array(stationRow).min(1).max(MAX_STATIONS) })
  .superRefine((value, ctx) => {
    const ids = new Set<string>()
    const names = new Set<string>()
    for (const [index, station] of value.stations.entries()) {
      const name = station.name.toLowerCase()
      if (ids.has(station.id) || names.has(name)) {
        ctx.addIssue({ code: 'custom', path: ['stations', index], message: 'Estación repetida.' })
      }
      ids.add(station.id)
      names.add(name)
    }
  })

export const patchStationSchema = z.object({
  id,
  patch: z
    .object({
      name: change(text(STATION_NAME_MAX)).optional(),
      color: change(color).optional(),
      active: change(z.boolean()).optional(),
    })
    .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
      message: 'No hay nada que cambiar.',
    }),
})

export const deleteStationsSchema = z.object({
  ids: z.array(id).min(1).max(MAX_STATIONS),
})

/** El orden nuevo y el que la persona estaba mirando. */
const orderFields = (max: number) => ({
  ids: z.array(id).min(1).max(max),
  expected: z.array(id).min(1).max(max),
})
type OrderValue = { ids: string[]; expected: string[] }
const noRepeats = (value: OrderValue) => new Set(value.ids).size === value.ids.length
const sameRows = (value: OrderValue) =>
  value.ids.length === value.expected.length &&
  value.ids.every((each) => value.expected.includes(each))
const REPEATED = { message: 'Hay una fila repetida.' }
const OTHER_ROWS = { message: 'El orden nuevo tiene que ser de las mismas filas.' }

export const reorderStationsSchema = z
  .object(orderFields(MAX_STATIONS))
  .refine(noRepeats, REPEATED)
  .refine(sameRows, OTHER_ROWS)

// ─── Aclaraciones ────────────────────────────────────────────────────────────

const selection = z.enum(['single', 'multi'])

const optionRow = z.object({
  id,
  label: text(OPTION_LABEL_MAX),
  priceDeltaCents: deltaCents,
  position,
  active: z.boolean(),
})

const linkTarget = z.object({ target: z.enum(['category', 'item']), targetId: id })

export const createGroupSchema = z
  .object({
    group: z.object({
      id,
      name: text(GROUP_NAME_MAX),
      selection,
      required: z.boolean(),
      position,
      active: z.boolean(),
    }),
    options: z.array(optionRow).max(MAX_OPTIONS),
    links: z.array(linkTarget).max(MAX_LINKS),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>()
    for (const [index, option] of value.options.entries()) {
      if (ids.has(option.id)) {
        ctx.addIssue({ code: 'custom', path: ['options', index], message: 'Opción repetida.' })
      }
      ids.add(option.id)
    }
    const targets = new Set<string>()
    for (const [index, link] of value.links.entries()) {
      const key = `${link.target}:${link.targetId}`
      if (targets.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['links', index], message: 'Enganche repetido.' })
      }
      targets.add(key)
    }
  })

export const patchGroupSchema = z.object({
  id,
  patch: z
    .object({
      name: change(text(GROUP_NAME_MAX)).optional(),
      selection: change(selection).optional(),
      required: change(z.boolean()).optional(),
      active: change(z.boolean()).optional(),
    })
    .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
      message: 'No hay nada que cambiar.',
    }),
})

export const groupIdSchema = z.object({ id })

export const reorderGroupsSchema = z
  .object(orderFields(MAX_GROUPS))
  .refine(noRepeats, REPEATED)
  .refine(sameRows, OTHER_ROWS)

export const createOptionSchema = z.object({ groupId: id, option: optionRow })

export const patchOptionSchema = z.object({
  id,
  patch: z
    .object({
      label: change(text(OPTION_LABEL_MAX)).optional(),
      priceDeltaCents: change(deltaCents).optional(),
      active: change(z.boolean()).optional(),
    })
    .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
      message: 'No hay nada que cambiar.',
    }),
})

export const optionIdSchema = z.object({ id })

export const reorderOptionsSchema = z
  .object({ groupId: id, ...orderFields(MAX_OPTIONS) })
  .refine(noRepeats, REPEATED)
  .refine(sameRows, OTHER_ROWS)

export const setLinkSchema = z.object({
  groupId: id,
  target: z.enum(['category', 'item']),
  targetId: id,
  linked: z.boolean(),
})
