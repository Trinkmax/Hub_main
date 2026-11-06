/**
 * «Datos para corregir»: lo que falta o no coincide en insumos, recetas, proveedores y eventos, con un
 * link a donde se arregla. Se vacía sola a medida que se corrige. Puro.
 */
import type { PlannedEvent } from './events'
import type { PurItem, PurRecipe, PurSupplier } from './types'
import { convertQty, unitShort } from './units'

export type IssueGroup = 'eventos' | 'insumos' | 'recetas' | 'proveedores'

export const ISSUE_GROUP_LABELS: Record<IssueGroup, string> = {
  eventos: 'Eventos',
  insumos: 'Insumos',
  recetas: 'Recetas',
  proveedores: 'Proveedores',
}

export type IssueTarget =
  | { kind: 'item'; id: string }
  | { kind: 'supplier'; id: string }
  | { kind: 'recipe'; id: string }
  | { kind: 'event'; id: string }

export type DataIssue = {
  group: IssueGroup
  /** Para ordenar y para no repetir el mismo aviso. */
  key: string
  text: string
  target: IssueTarget
}

function recipeTitle(r: PurRecipe): string {
  return r.variant && r.variant !== 'Única' ? `${r.name} · ${r.variant}` : r.name
}

export function dataIssues(input: {
  items: readonly PurItem[]
  suppliers: readonly PurSupplier[]
  recipes: readonly PurRecipe[]
  /** Los eventos de los próximos días, ya planificados. */
  upcoming: readonly PlannedEvent[]
}): DataIssue[] {
  const issues: DataIssue[] = []
  const items = new Map(input.items.map((i) => [i.id, i]))
  const activeItems = input.items.filter((i) => i.active)

  // Proveedores con algo para pedir: sin WhatsApp no se abre el chat; sin días no hay fecha de entrega.
  const used = new Set(activeItems.map((i) => i.supplierId).filter(Boolean))
  for (const s of input.suppliers) {
    if (!s.active || !used.has(s.id)) continue
    const noWa = !s.whatsapp
    const noDays = !s.deliveryWeekdays.length
    if (!noWa && !noDays) continue
    issues.push({
      group: 'proveedores',
      key: `s-${s.id}`,
      text:
        noWa && noDays
          ? `${s.name}: faltan el WhatsApp y los días de entrega.`
          : noWa
            ? `${s.name}: falta el WhatsApp (sin él no se abre el chat con el pedido).`
            : `${s.name}: faltan los días de entrega (sin ellos no se calcula cuándo llega).`,
      target: { kind: 'supplier', id: s.id },
    })
  }

  for (const i of activeItems) {
    if (!i.supplierId) {
      issues.push({
        group: 'insumos',
        key: `i-sup-${i.id}`,
        text: `${i.name}: falta el proveedor.`,
        target: { kind: 'item', id: i.id },
      })
    }
    if (i.frequency !== 'occasional' && i.targetQty == null) {
      issues.push({
        group: 'insumos',
        key: `i-target-${i.id}`,
        text: `${i.name}: es ${i.frequency === 'frequent' ? 'frecuente' : 'secundario'} y no tiene stock objetivo.`,
        target: { kind: 'item', id: i.id },
      })
    }
    if (i.frequency !== 'occasional' && !i.zoneId) {
      issues.push({
        group: 'insumos',
        key: `i-zone-${i.id}`,
        text: `${i.name}: no tiene zona (la cocina lo cuenta al final, en «Sin zona»).`,
        target: { kind: 'item', id: i.id },
      })
    }
    // Los eventuales se piden en su unidad (3 kg de batata): solo se avisa en los de todos los días.
    if (i.frequency !== 'occasional' && !i.packSize) {
      issues.push({
        group: 'insumos',
        key: `i-pack-${i.id}`,
        text: `${i.name}: falta la presentación o lo que trae (se pide en ${unitShort(i.unit)}).`,
        target: { kind: 'item', id: i.id },
      })
    }
  }

  for (const r of input.recipes) {
    if (!r.active) continue
    const title = recipeTitle(r)
    if (!r.lines.length && !r.notes) {
      issues.push({
        group: 'recetas',
        key: `r-empty-${r.id}`,
        text: `${title}: la receta no tiene insumos.`,
        target: { kind: 'recipe', id: r.id },
      })
    }
    for (const l of r.lines) {
      if (l.inHouse) continue
      const item = l.itemId ? items.get(l.itemId) : undefined
      if (!item) {
        issues.push({
          group: 'recetas',
          key: `r-missing-${l.id}`,
          text: `${title}: «${l.name}» no está en la lista de insumos.`,
          target: { kind: 'recipe', id: r.id },
        })
        continue
      }
      if (!item.active) {
        issues.push({
          group: 'recetas',
          key: `r-inactive-${l.id}`,
          text: `${title}: «${item.name}» está desactivado en la lista de insumos (no se pide).`,
          target: { kind: 'recipe', id: r.id },
        })
      }
      if (l.quantity == null) {
        issues.push({
          group: 'recetas',
          key: `r-qty-${l.id}`,
          text: `${title}: «${item.name}» no tiene cantidad.`,
          target: { kind: 'recipe', id: r.id },
        })
      } else if (l.unit && convertQty(l.quantity, l.unit, item.unit) == null) {
        issues.push({
          group: 'recetas',
          key: `r-unit-${l.id}`,
          text: `${title}: «${item.name}» está en ${unitShort(l.unit)} y en la lista se cuenta en ${unitShort(item.unit)}.`,
          target: { kind: 'recipe', id: r.id },
        })
      }
    }
  }

  for (const e of input.upcoming) {
    if (e.status === 'needs_variant') {
      issues.push({
        group: 'eventos',
        key: `e-variant-${e.event.id}`,
        text: `${e.label}: elegí la variante (${e.variants.map((v) => v.variant).join(', ')}). Hasta entonces no suma insumos.`,
        target: { kind: 'event', id: e.event.id },
      })
    }
  }

  return issues
}

export function countByGroup(issues: readonly DataIssue[]): Record<IssueGroup, number> {
  const out: Record<IssueGroup, number> = { eventos: 0, insumos: 0, recetas: 0, proveedores: 0 }
  for (const i of issues) out[i.group] += 1
  return out
}
