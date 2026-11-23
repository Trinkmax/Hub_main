/**
 * La comanda de cocina en papel — PURO.
 *
 * Sale de la misma comanda que muestra la tele (`KitchenCard`): una tanda de una mesa, con los
 * productos iguales juntos («x2 Cheese Burger») y debajo cómo va cada uno. Arriba, lo que el cocinero
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

export function comandaDoc(card: KitchenCard, context: ComandaContext): PrintDoc {
  const lines: PrintLine[] = []
  const top = [context.stationLabel ?? 'Comanda', context.branch].filter(Boolean).join(' · ')
  lines.push(p.center(top, { size: 'sm', bold: true, upper: true }))
  if (context.reprint) lines.push(p.center('Reimpresión', { size: 'sm', upper: true }))
  lines.push(
    p.center(heading(card), { size: card.titleFit === 'small' ? 'xl' : 'xxl', upper: true }),
  )

  const meta = [
    card.where,
    card.partySize ? `${card.partySize} ${card.partySize === 1 ? 'persona' : 'personas'}` : null,
    card.course > 1 ? `Tanda ${card.course}` : null,
    card.alias,
  ].filter((part): part is string => Boolean(part))
  if (meta.length > 0) lines.push(p.center(meta.join(' · '), { bold: true }))
  if (card.event) lines.push(p.center(card.event, { bold: true, upper: true }))
  lines.push(p.center(`Pedido ${ticketTime(card.firedAt, context.timeZone)}`, { size: 'sm' }))

  if (card.isPractice) lines.push(p.banner('Práctica · no cocinar'))
  const critical = card.alerts.filter((alert) => alert.critical)
  const diet = card.alerts.filter((alert) => !alert.critical)
  if (critical.length > 0) lines.push(p.banner(critical.map((alert) => alert.label).join(' · ')))
  if (diet.length > 0) {
    lines.push(p.center(diet.map((alert) => alert.label).join(' · '), { bold: true, upper: true }))
  }

  lines.push(p.rule('double'))
  for (const group of card.groups) {
    // Lo que sale primero no se puede pasar por alto: va en negativo. Los rubros, como rótulo.
    if (group.priority) lines.push(p.banner(group.label ?? 'Sale primero'))
    else if (group.label) lines.push(p.text(group.label, { size: 'sm', bold: true, upper: true }))
    for (const line of group.lines) lines.push(itemLine(line))
    lines.push(p.rule('solid'))
  }

  if (card.others.length > 0) {
    lines.push(
      p.text(
        `Además: ${card.others.map((other) => `${other.quantity} de ${other.name}`).join(' · ')}`,
        { size: 'sm' },
      ),
    )
  }
  const units = card.lines.reduce((sum, line) => sum + line.quantity, 0)
  lines.push(
    p.row(`${units} ${units === 1 ? 'producto' : 'productos'}`, `#${card.id.slice(0, 4)}`, {
      size: 'sm',
    }),
  )
  return { title: `Comanda ${heading(card)}`, lines }
}
