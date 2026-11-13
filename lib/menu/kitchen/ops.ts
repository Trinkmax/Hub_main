/**
 * Lo que se acaba de cambiar, puro.
 *
 * Cada cosa que la persona hace en la pantalla es una operación (`Op`): marcar una categoría,
 * renombrar una estación, sumar una opción. La pantalla la muestra YA, encima de lo último que
 * se leyó de la base, mientras el servidor guarda:
 *
 * - `applyOp` aplica una operación a una lectura. Volver a aplicarla sobre una lectura que ya
 *   la trae no cambia nada: por eso se puede re-aplicar todo lo pendiente cada vez que llega
 *   una lectura nueva (de este guardado o del de otra persona).
 * - `invertOp` arma la operación que la deshace, mirando cómo estaba todo ANTES.
 * - El registro (`Pending`) guarda lo que todavía no confirmó la base. Si el guardado falla, la
 *   operación se va y vuelve a verse lo que hay en la base. Cuando llega una lectura posterior
 *   al guardado, la operación sobra: la base manda.
 */

import type {
  KitchenSnapshot,
  KitchenStation,
  ModifierGroup,
  ModifierLink,
  ModifierOption,
  RouteChange,
} from './types'
import { linkKey, nodeKey } from './types'

export type StationPatch = Partial<Pick<KitchenStation, 'name' | 'color' | 'active'>>
export type GroupPatch = Partial<Pick<ModifierGroup, 'name' | 'selection' | 'required' | 'active'>>
export type OptionPatch = Partial<Pick<ModifierOption, 'label' | 'priceDeltaCents' | 'active'>>

export type Op =
  /** Poner o sacar la estación de categorías y productos. */
  | { type: 'route'; changes: RouteChange[] }
  | { type: 'station.create'; stations: KitchenStation[] }
  | { type: 'station.patch'; id: string; patch: StationPatch }
  | { type: 'station.delete'; ids: string[] }
  | { type: 'station.order'; ids: string[] }
  | { type: 'group.create'; group: ModifierGroup; options: ModifierOption[]; links: ModifierLink[] }
  | { type: 'group.patch'; id: string; patch: GroupPatch }
  | { type: 'group.delete'; id: string }
  | { type: 'group.order'; ids: string[] }
  | { type: 'option.create'; option: ModifierOption }
  | { type: 'option.patch'; id: string; patch: OptionPatch }
  | { type: 'option.delete'; id: string }
  | { type: 'option.order'; groupId: string; ids: string[] }
  | { type: 'link.set'; link: ModifierLink; linked: boolean }

/** Pone `position` = lugar en la lista a las filas nombradas; el resto queda donde estaba. */
function reposition<Row extends { id: string; position: number }>(
  rows: ReadonlyArray<Row>,
  ids: ReadonlyArray<string>,
): Row[] {
  const place = new Map(ids.map((id, index) => [id, index]))
  return rows.map((row) => {
    const position = place.get(row.id)
    return position === undefined || position === row.position ? row : { ...row, position }
  })
}

function patchRow<Row extends { id: string }>(
  rows: ReadonlyArray<Row>,
  id: string,
  patch: Partial<NoInfer<Row>>,
): Row[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
}

function addMissing<Row extends { id: string }>(
  rows: ReadonlyArray<Row>,
  fresh: ReadonlyArray<Row>,
): Row[] {
  const known = new Set(rows.map((row) => row.id))
  const added = fresh.filter((row) => !known.has(row.id))
  return added.length === 0 ? [...rows] : [...rows, ...added]
}

function addLinks(
  links: ReadonlyArray<ModifierLink>,
  fresh: ReadonlyArray<ModifierLink>,
): ModifierLink[] {
  const known = new Set(links.map(linkKey))
  const added = fresh.filter((link) => !known.has(linkKey(link)))
  return added.length === 0 ? [...links] : [...links, ...added]
}

/** Aplica una operación a una lectura. No toca la lectura original. */
export function applyOp(snapshot: KitchenSnapshot, op: Op): KitchenSnapshot {
  switch (op.type) {
    case 'route': {
      const categories = new Map<string, string | null>()
      const items = new Map<string, string | null>()
      for (const change of op.changes) {
        ;(change.node === 'category' ? categories : items).set(change.id, change.to)
      }
      return {
        ...snapshot,
        categories:
          categories.size === 0
            ? snapshot.categories
            : snapshot.categories.map((category) => {
                const to = categories.get(category.id)
                return to === undefined || to === category.stationId
                  ? category
                  : { ...category, stationId: to }
              }),
        items:
          items.size === 0
            ? snapshot.items
            : snapshot.items.map((item) => {
                const to = items.get(item.id)
                return to === undefined || to === item.stationId ? item : { ...item, stationId: to }
              }),
      }
    }
    case 'station.create':
      return { ...snapshot, stations: addMissing(snapshot.stations, op.stations) }
    case 'station.patch':
      return { ...snapshot, stations: patchRow(snapshot.stations, op.id, op.patch) }
    case 'station.delete': {
      const gone = new Set(op.ids)
      // Como la base: lo que tenía esa estación queda sin estación propia.
      return {
        ...snapshot,
        stations: snapshot.stations.filter((station) => !gone.has(station.id)),
        categories: snapshot.categories.map((category) =>
          category.stationId !== null && gone.has(category.stationId)
            ? { ...category, stationId: null }
            : category,
        ),
        items: snapshot.items.map((item) =>
          item.stationId !== null && gone.has(item.stationId) ? { ...item, stationId: null } : item,
        ),
      }
    }
    case 'station.order':
      return { ...snapshot, stations: reposition(snapshot.stations, op.ids) }
    case 'group.create':
      return {
        ...snapshot,
        groups: addMissing(snapshot.groups, [op.group]),
        options: addMissing(snapshot.options, op.options),
        links: addLinks(snapshot.links, op.links),
      }
    case 'group.patch':
      return { ...snapshot, groups: patchRow(snapshot.groups, op.id, op.patch) }
    case 'group.delete':
      // Como la base: se lleva sus opciones y sus enganches.
      return {
        ...snapshot,
        groups: snapshot.groups.filter((group) => group.id !== op.id),
        options: snapshot.options.filter((option) => option.groupId !== op.id),
        links: snapshot.links.filter((link) => link.groupId !== op.id),
      }
    case 'group.order':
      return { ...snapshot, groups: reposition(snapshot.groups, op.ids) }
    case 'option.create':
      // Una opción de un grupo que ya no está no se muestra suelta.
      return snapshot.groups.some((group) => group.id === op.option.groupId)
        ? { ...snapshot, options: addMissing(snapshot.options, [op.option]) }
        : snapshot
    case 'option.patch':
      return { ...snapshot, options: patchRow(snapshot.options, op.id, op.patch) }
    case 'option.delete':
      return { ...snapshot, options: snapshot.options.filter((option) => option.id !== op.id) }
    case 'option.order': {
      const mine = new Set(op.ids)
      const place = new Map(op.ids.map((id, index) => [id, index]))
      return {
        ...snapshot,
        options: snapshot.options.map((option) => {
          if (option.groupId !== op.groupId || !mine.has(option.id)) return option
          const position = place.get(option.id) ?? option.position
          return position === option.position ? option : { ...option, position }
        }),
      }
    }
    case 'link.set': {
      const key = linkKey(op.link)
      const has = snapshot.links.some((link) => linkKey(link) === key)
      if (op.linked === has) return snapshot
      return {
        ...snapshot,
        links: op.linked
          ? [...snapshot.links, op.link]
          : snapshot.links.filter((link) => linkKey(link) !== key),
      }
    }
  }
}

export function applyOps(snapshot: KitchenSnapshot, ops: ReadonlyArray<Op>): KitchenSnapshot {
  let current = snapshot
  for (const op of ops) current = applyOp(current, op)
  return current
}

function pick<Row extends object, Key extends keyof Row>(
  row: Row,
  keys: ReadonlyArray<Key>,
): Pick<Row, Key> {
  const out = {} as Pick<Row, Key>
  for (const key of keys) out[key] = row[key]
  return out
}

/** Los ids de una lista, en el orden en que se ven. */
function idsInOrder<Row extends { id: string; position: number }>(
  rows: ReadonlyArray<Row>,
  tie: (row: Row) => string,
): string[] {
  return [...rows]
    .sort((a, b) => a.position - b.position || tie(a).localeCompare(tie(b), 'es'))
    .map((row) => row.id)
}

/**
 * La operación que deshace a `op`, armada con cómo estaba todo ANTES de aplicarla. `null` si no
 * hay nada que deshacer (no cambiaba nada) o si no tiene vuelta desde acá (borrar un grupo).
 */
export function invertOp(before: KitchenSnapshot, op: Op): Op | null {
  switch (op.type) {
    case 'route': {
      const categories = new Map(before.categories.map((row) => [row.id, row.stationId]))
      const items = new Map(before.items.map((row) => [row.id, row.stationId]))
      const changes: RouteChange[] = []
      for (const change of op.changes) {
        const was = (change.node === 'category' ? categories : items).get(change.id)
        if (was === undefined || was === change.to) continue
        changes.push({ node: change.node, id: change.id, to: was })
      }
      return changes.length === 0 ? null : { type: 'route', changes }
    }
    case 'station.create': {
      const known = new Set(before.stations.map((station) => station.id))
      const ids = op.stations.filter((station) => !known.has(station.id)).map((s) => s.id)
      return ids.length === 0 ? null : { type: 'station.delete', ids }
    }
    case 'station.patch': {
      const station = before.stations.find((row) => row.id === op.id)
      if (!station) return null
      const keys = Object.keys(op.patch) as Array<keyof StationPatch>
      return { type: 'station.patch', id: op.id, patch: pick(station, keys) }
    }
    case 'station.delete': {
      const gone = new Set(op.ids)
      const stations = before.stations.filter((station) => gone.has(station.id))
      return stations.length === 0 ? null : { type: 'station.create', stations }
    }
    case 'station.order':
      return { type: 'station.order', ids: idsInOrder(before.stations, (row) => row.name) }
    case 'group.create':
      return before.groups.some((group) => group.id === op.group.id)
        ? null
        : { type: 'group.delete', id: op.group.id }
    case 'group.patch': {
      const group = before.groups.find((row) => row.id === op.id)
      if (!group) return null
      const keys = Object.keys(op.patch) as Array<keyof GroupPatch>
      return { type: 'group.patch', id: op.id, patch: pick(group, keys) }
    }
    case 'group.delete':
      // Borrar un grupo se confirma antes: no se deshace.
      return null
    case 'group.order':
      return { type: 'group.order', ids: idsInOrder(before.groups, (row) => row.name) }
    case 'option.create':
      return before.options.some((option) => option.id === op.option.id)
        ? null
        : { type: 'option.delete', id: op.option.id }
    case 'option.patch': {
      const option = before.options.find((row) => row.id === op.id)
      if (!option) return null
      const keys = Object.keys(op.patch) as Array<keyof OptionPatch>
      return { type: 'option.patch', id: op.id, patch: pick(option, keys) }
    }
    case 'option.delete': {
      const option = before.options.find((row) => row.id === op.id)
      return option ? { type: 'option.create', option } : null
    }
    case 'option.order':
      return {
        type: 'option.order',
        groupId: op.groupId,
        ids: idsInOrder(
          before.options.filter((option) => option.groupId === op.groupId),
          (row) => row.label,
        ),
      }
    case 'link.set': {
      const key = linkKey(op.link)
      const has = before.links.some((link) => linkKey(link) === key)
      return has === op.linked ? null : { type: 'link.set', link: op.link, linked: has }
    }
  }
}

// ─── Lo que todavía no confirmó la base ──────────────────────────────────────

export type Pending = {
  /** El pedido que la escribió. */
  token: number
  op: Op
  saving: boolean
  /** Reloj del servidor cuando terminó de guardarse. */
  savedAt: number | null
}

export const NO_PENDING: ReadonlyArray<Pending> = []

/** Lo que se acaba de cambiar se ve ya, marcado como «guardando». */
export function pendStart(log: ReadonlyArray<Pending>, token: number, op: Op): Pending[] {
  return [...log, { token, op, saving: true, savedAt: null }]
}

/**
 * El servidor contestó que se guardó. `op` reemplaza a la operación si no entró entera (de
 * veinte marcas, quedaron dieciocho). `loadedAt` es la lectura que la pantalla tiene en este
 * momento: si ya es posterior al guardado, la operación sobra.
 */
export function pendSettle(
  log: ReadonlyArray<Pending>,
  token: number,
  args: { savedAt: number; loadedAt: number; op?: Op | null },
): Pending[] {
  const covered = args.savedAt <= args.loadedAt
  const out: Pending[] = []
  for (const entry of log) {
    if (entry.token !== token) {
      out.push(entry)
      continue
    }
    if (covered || args.op === null) continue
    out.push({ ...entry, op: args.op ?? entry.op, saving: false, savedAt: args.savedAt })
  }
  return out
}

/** El pedido falló: lo suyo vuelve a lo leído. */
export function pendDrop(log: ReadonlyArray<Pending>, token: number): Pending[] {
  return log.filter((entry) => entry.token !== token)
}

/**
 * Llegó una lectura nueva: lo guardado ANTES de esa lectura está incluido en ella y se descarta.
 * Lo que todavía se está guardando, o se guardó después, se queda encima.
 */
export function pendSync(log: ReadonlyArray<Pending>, loadedAt: number): ReadonlyArray<Pending> {
  const kept = log.filter(
    (entry) => entry.saving || entry.savedAt === null || entry.savedAt > loadedAt,
  )
  return kept.length === log.length ? log : kept
}

/** Lo que se ve: la última lectura con lo pendiente encima, en el orden en que se hizo. */
export function buildView(base: KitchenSnapshot, log: ReadonlyArray<Pending>): KitchenSnapshot {
  return log.length === 0
    ? base
    : applyOps(
        base,
        log.map((entry) => entry.op),
      )
}

/** Las llaves de lo que toca una operación, para marcar qué se está guardando. */
export function opKeys(op: Op): string[] {
  switch (op.type) {
    case 'route':
      return op.changes.map((change) => nodeKey(change.node, change.id))
    case 'station.create':
      return op.stations.map((station) => `station:${station.id}`)
    case 'station.patch':
      return [`station:${op.id}`]
    case 'station.delete':
    case 'station.order':
      return op.ids.map((id) => `station:${id}`)
    case 'group.create':
      return [`group:${op.group.id}`]
    case 'group.patch':
    case 'group.delete':
      return [`group:${op.id}`]
    case 'group.order':
      return op.ids.map((id) => `group:${id}`)
    case 'option.create':
      return [`option:${op.option.id}`]
    case 'option.patch':
    case 'option.delete':
      return [`option:${op.id}`]
    case 'option.order':
      return op.ids.map((id) => `option:${id}`)
    case 'link.set':
      return [`link:${linkKey(op.link)}`]
  }
}

/** Todo lo que se está guardando ahora. */
export function savingKeys(log: ReadonlyArray<Pending>): Set<string> {
  const keys = new Set<string>()
  for (const entry of log) {
    if (!entry.saving) continue
    for (const key of opKeys(entry.op)) keys.add(key)
  }
  return keys
}
