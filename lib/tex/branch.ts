import { z } from 'zod'
import { treasuryFitsBranch } from '@/lib/accounting/branch'
import { accErrorMessage } from '@/lib/accounting/errors'
import { branchFilterOf } from '@/lib/branches/filter'
import type { BranchScope } from '@/lib/branches/types'
import type { TexTicketRow, TexTicketWarning } from './protocol'
import type { TexBranch, TexBranchView } from './tools/types'

/**
 * La sucursal en Tex (Administración por sucursal, entrega 1). Puro: lo usan las herramientas y las pruebas.
 *
 * Compras y pagos, Gastos fijos y Caja son de cada local: Tex lee lo de la sucursal que se mira (en «Todas»,
 * todo) y lo que prepara ahí lleva su sucursal (`branchToWrite`). Mercado Pago y los bancos son de todo el bar:
 * sirven en todas. El resto de Administración (Resumen, Ventas, Sueldos, Contabilidad) sigue siendo de todo el
 * bar y no manda sucursal: la pone la base.
 */

export function texBranchView(scope: BranchScope): TexBranchView {
  return {
    isAll: scope.isAll,
    currentId: scope.current?.id ?? null,
    branches: scope.branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      shortName: branch.shortName,
      isDefault: branch.isDefault,
    })),
    filter: branchFilterOf(scope),
  }
}

// ─── Leer ────────────────────────────────────────────────────────────────────

/** El `p_branch_id` de los informes por sucursal: la que se mira; `null` = todas las que ve (lo de siempre). */
export function branchReadId(view: TexBranchView): string | null {
  return view.isAll ? null : view.currentId
}

/** ¿Hay más de una a la vista? Con una sola, Tex no la nombra ni la pregunta (como los formularios). */
export function isMultiBranch(view: TexBranchView): boolean {
  return view.branches.length > 1
}

export function branchById(view: TexBranchView, id: string | null | undefined): TexBranch | null {
  return id ? (view.branches.find((branch) => branch.id === id) ?? null) : null
}

/** El nombre para Tex; sin sucursal, «Todo el bar». */
export function branchName(view: TexBranchView, id: string | null | undefined): string {
  if (!id) return 'Todo el bar'
  return branchById(view, id)?.name ?? 'Otra sucursal'
}

/** De qué sucursal es lo que se leyó: la que se mira o «Todas». Con una sola sucursal, nada. */
export function viewedBranchLabel(view: TexBranchView): string | null {
  if (!isMultiBranch(view)) return null
  return view.isAll || !view.currentId ? 'Todas' : branchName(view, view.currentId)
}

/** Una lectura por sucursal con «de cuál es» adelante, para que Tex no confunda una con otra. */
export function withViewedBranch<T extends object>(
  data: T,
  view: TexBranchView,
  label: string | null = viewedBranchLabel(view),
): T | ({ sucursal: string } & T) {
  return label ? { sucursal: label, ...data } : data
}

/**
 * De qué sucursal es cada fila, cuando la lectura trae más de una (mirando «Todas», o lo que es de todo el bar
 * mirando una). `null`: no hace falta decirlo.
 */
export function rowBranchTag(
  view: TexBranchView,
  mixed: boolean,
): (branchId: string | null | undefined) => string | null {
  const tag = isMultiBranch(view) && mixed
  return (branchId) => (tag ? branchName(view, branchId) : null)
}

// ─── Escribir ────────────────────────────────────────────────────────────────

/** El campo de las herramientas que preparan algo de una sucursal. */
export const sucursalField = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .optional()
  .describe('La sucursal, por su nombre: solo si mira «Todas» o si dijo otra.')

/** Sin tildes ni mayúsculas, como se comparan los nombres de los proveedores. */
function textKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** «Alta Córdoba o Cerro», «A, B o C». */
function orList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} o ${names.at(-1)}`
}

/** Lo que no es una sucursal sino todas: lo que se carga va a una sola. */
const ALL_WORDS: ReadonlySet<string> = new Set(['todas', 'todo', 'todo el bar', 'las dos', 'ambas'])

export type BranchMatch = { ok: true; branch: TexBranch } | { ok: false; message: string }

/**
 * Lo que dijo la persona («Cerro», «alta cordoba», el nombre corto o el id) → una sucursal que ve. Primero el
 * nombre entero; después, una parte. Nunca elige entre dos.
 */
export function matchBranch(view: TexBranchView, wanted: string): BranchMatch {
  const said = wanted.trim()
  const byId = view.branches.find((branch) => branch.id === said)
  if (byId) return { ok: true, branch: byId }
  const names = view.branches.map((branch) => branch.name)
  const key = textKey(said)
  if (ALL_WORDS.has(key)) {
    return { ok: false, message: `Lo que se carga va a una sola sucursal: ¿${orList(names)}?` }
  }
  const keysOf = (branch: TexBranch) =>
    [branch.name, branch.shortName].flatMap((name) => (name ? [textKey(name)] : []))
  const exact = view.branches.filter((branch) => keysOf(branch).includes(key))
  const pool =
    exact.length > 0
      ? exact
      : view.branches.filter((branch) =>
          keysOf(branch).some(
            (name) =>
              (key.length >= 3 && name.includes(key)) || (name.length >= 4 && key.includes(name)),
          ),
        )
  const [only] = pool
  if (only && pool.length === 1) return { ok: true, branch: only }
  if (pool.length > 1) {
    return {
      ok: false,
      message: `«${said}» puede ser ${orList(pool.map((branch) => branch.name))}. Preguntale cuál.`,
    }
  }
  return {
    ok: false,
    message:
      names.length > 0
        ? `No hay una sucursal «${said}». Las que hay: ${names.join(', ')}.`
        : 'Este bar no tiene sucursales a la vista.',
  }
}

/** Lo que mandó Tex en `sucursal`, ya resuelto a un id. Sin nada, `null`. */
export function saidBranch(
  view: TexBranchView,
  wanted: string | null | undefined,
): { ok: true; id: string | null } | { ok: false; message: string } {
  if (!wanted?.trim()) return { ok: true, id: null }
  const match = matchBranch(view, wanted)
  return match.ok ? { ok: true, id: match.branch.id } : match
}

/** Mirando «Todas» con más de una: la pregunta, con las sucursales. */
export function branchQuestion(view: TexBranchView): string {
  return `¿En qué sucursal? ${orList(view.branches.map((branch) => branch.name))}. Preguntale y mandala en sucursal.`
}

export type BranchHint = {
  /** La que dijo (`sucursal`), ya resuelta. */
  said?: string | null
  /** Un gasto fijo: se paga siempre desde su sucursal, se mire la que se mire. */
  fixed?: { name: string; branchId: string | null | undefined } | null
  /** La sucursal de la caja que se usa, si es de una: mirando «Todas», es la única que puede ser. */
  box?: string | null
}

export type BranchPick = { ok: true; branchId: string | null } | { ok: false; message: string }

/**
 * La sucursal de lo que prepara Tex, en este orden: la del gasto fijo (siempre) → la que dijo → la que se mira →
 * la única → mirando «Todas», la de la caja si es de una sucursal. Si no, la pregunta: nunca se carga a ciegas
 * en la principal. `branchId: null` (un bar sin sucursales a la vista, o un gasto fijo sin la suya) no se manda:
 * la decide la base.
 */
export function branchToWrite(view: TexBranchView, hint: BranchHint = {}): BranchPick {
  const said = hint.said ?? null
  if (hint.fixed) {
    const own = hint.fixed.branchId ?? null
    if (own && said && said !== own) {
      return {
        ok: false,
        message: `«${hint.fixed.name}» es un gasto fijo de ${branchName(view, own)}: se paga desde su sucursal.`,
      }
    }
    return { ok: true, branchId: own }
  }
  if (said) return { ok: true, branchId: said }
  if (view.currentId) return { ok: true, branchId: view.currentId }
  const [only] = view.branches
  if (only && view.branches.length === 1) return { ok: true, branchId: only.id }
  if (view.branches.length === 0) return { ok: true, branchId: null }
  if (hint.box) return { ok: true, branchId: hint.box }
  return { ok: false, message: branchQuestion(view) }
}

/** El renglón «Sucursal» del tique. Con una sola sucursal no se dice, como en los formularios. */
export function branchRow(view: TexBranchView, branchId: string | null): TexTicketRow | null {
  if (!branchId || !isMultiBranch(view)) return null
  return { label: 'Sucursal', value: branchName(view, branchId) }
}

/** Los renglones del tique con «Sucursal» primero. */
export function withBranchRow(
  rows: readonly TexTicketRow[],
  view: TexBranchView,
  branchId: string | null,
): TexTicketRow[] {
  const row = branchRow(view, branchId)
  return row ? [row, ...rows] : [...rows]
}

/** El tique (todavía sin el asiento) con «Sucursal» primero. */
export function withBranchTicket<T extends { rows: TexTicketRow[] }>(
  ticket: T,
  view: TexBranchView,
  branchId: string | null,
): T {
  return { ...ticket, rows: withBranchRow(ticket.rows, view, branchId) }
}

/** Si queda en otra sucursal que la que se mira (un gasto fijo de otra, o la que dijo), el tique lo avisa. */
export function branchNotices(view: TexBranchView, branchId: string | null): TexTicketWarning[] {
  if (!branchId || !view.currentId || branchId === view.currentId || !isMultiBranch(view)) return []
  return [
    {
      key: 'tex_otra_sucursal',
      title: `Queda en ${branchName(view, branchId)}, no en ${branchName(view, view.currentId)}, que es la que estás mirando.`,
      body: null,
    },
  ]
}

// ─── Las cajas ───────────────────────────────────────────────────────────────

type BranchBox = { name: string; branchId?: string | null }

/** Una caja en una lista para Tex: con su sucursal entre paréntesis cuando hay más de una. */
export function boxLabel(view: TexBranchView, box: BranchBox): string {
  if (!isMultiBranch(view)) return box.name
  return `${box.name} (${box.branchId ? branchName(view, box.branchId) : 'todo el bar'})`
}

/**
 * Entre varias que se llaman igual (cada local tiene su «Caja»), la de esa sucursal o la de todo el bar, si queda
 * una sola. Si no, todas: Tex pregunta.
 */
export function preferFitting<T extends { branchId?: string | null }>(
  items: readonly T[],
  branchId: string | null,
): readonly T[] {
  if (!branchId || items.length < 2) return items
  const fit = items.filter((item) => treasuryFitsBranch(item, branchId))
  return fit.length === 1 ? fit : items
}

/**
 * Una caja de otra sucursal no se usa (`treasury_other_branch`): el mismo mensaje de los formularios, con las que
 * sí sirven para que Tex pregunte.
 */
export function otherBranchBoxMessage(
  view: TexBranchView,
  branchId: string | null,
  usable: readonly BranchBox[],
): string {
  const message = accErrorMessage('treasury_other_branch')
  const fits = usable.filter((box) => treasuryFitsBranch(box, branchId)).map((box) => box.name)
  return fits.length > 0
    ? `${message} En ${branchName(view, branchId)} sirven: ${fits.slice(0, 8).join(', ')}.`
    : message
}
