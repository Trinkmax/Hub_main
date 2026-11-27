/**
 * La comanda de cocina en papel — PURO.
 *
 * Sale de la misma comanda que muestra la tele (`KitchenCard`): una tanda de una mesa, con los
 * productos iguales juntos («x2 Cheese Burger») y debajo cómo va cada uno. Arriba, lo que el mozo
 * busca con la vista: el número de mesa, enorme. Los avisos de salud van en negativo.
 */
import { type CardLine, type KitchenCard, PLAIN_VARIANT } from '@/lib/pos/kitchen/cards'
import { type PrintDoc, type PrintLine, p, ticketTime } from './doc'

export type ComandaContext = {
  /** «Cerro», «Alta Córdoba». */
  branch: string
  timeZone: string
  /** Qué estaciones imprime esta comandera, para el encabezado («PLANCHA»). `null` = todo. */
  stationLabel: string | null
  /** Es una copia pedida a mano, no la primera impresión. */
  reprint?: boolean
}

function marksOf(modifiers: readonly string[], notes: string | null): string[] {
  return [...modifiers, ...(notes ? [`«${notes}»`] : [])]
}

function itemLine(line: CardLine): PrintLine {
  return {
    kind: 'item',
    qty: `x${line.quantity}`,
    name: line.name,
    marks: marksOf(line.modifiers, line.notes),
    variants: line.variants.map((variant) => {
      const marks = marksOf(variant.modifiers, variant.notes)
      return { qty: `x${variant.quantity}`, marks: marks.length > 0 ? marks : [PLAIN_VARIANT] }
    }),
    done: line.status === 'served',
  }
}

/** A quién es la comanda, en una línea grande: «MESA 12», «MARTÍN», «DELIVERY». */
function heading(card: KitchenCard): string {
  // `titleFit` chico = no es un número de mesa (un nombre, «Mostrador», «Delivery»).
  return card.titleFit === 'small' ? card.title : `Mesa ${card.title}`
}

/**
 * El tique de cada comanda (pedido de Nacho, 27/11/2026): «debe tener el logo de HUB y ser bien
 * vistosa la info, solo lo necesario, porque es para que el mozo identifique a qué mesa pertenece el
 * pedido». Va con el plato: de arriba a abajo, el logo, de qué estación sale, la MESA enorme, quién la
 * atiende y qué es. Los avisos de salud siguen en negativo: eso no se puede perder.
 */
export function comandaDoc(card: KitchenCard, context: ComandaContext): PrintDoc {
  const lines: PrintLine[] = [{ kind: 'logo' }]
  if (context.stationLabel) lines.push(p.banner(context.stationLabel))
  if (context.reprint) lines.push(p.center('Reimpresión', { size: 'sm', bold: true, upper: true }))

  const numbered = card.titleFit !== 'small'
  lines.push({ kind: 'hero', caption: numbered ? 'Mesa' : null, text: card.title })
  if (card.waiter) lines.push(p.center(`Mozo: ${card.waiter}`, { size: 'lg', bold: true }))

  const meta = [
    ticketTime(card.firedAt, context.timeZone),
    card.course > 1 ? `Tanda ${card.course}` : null,
    // El nombre de la mesa ayuda cuando hay mesas juntas; sin número, ya es el título.
    numbered ? card.alias : null,
  ].filter((part): part is string => Boolean(part))
  lines.push(p.center(meta.join(' · '), { bold: true }))
  if (card.event) lines.push(p.center(card.event, { bold: true, upper: true }))

  if (card.isPractice) lines.push(p.banner('Práctica · no cocinar'))
  const critical = card.alerts.filter((alert) => alert.critical)
  const diet = card.alerts.filter((alert) => !alert.critical)
  if (critical.length > 0) lines.push(p.banner(critical.map((alert) => alert.label).join(' · ')))
  if (diet.length > 0) {
    lines.push(p.center(diet.map((alert) => alert.label).join(' · '), { bold: true, upper: true }))
  }

  lines.push(p.rule('double'))
  for (const group of card.groups) {
    for (const line of group.lines) lines.push(itemLine(line))
  }
  lines.push(p.rule('solid'))
  return { title: `Comanda ${heading(card)}`, lines }
}
