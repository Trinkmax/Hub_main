/**
 * Los mensajes de WhatsApp de Compras: el pedido y el reclamo. Puro.
 *
 * Se mandan desde el WhatsApp de quien compra (wa.me), no desde la API de Meta: es un chat con el
 * proveedor, como hasta ahora, pero con el mensaje ya armado.
 */
import { buildWaMeUrl } from '@/lib/phone'
import { longDayLabel } from './dates'
import { formatQty, packsText } from './units'

export type MessageLine = {
  name: string
  packs: number
  packLabel: string | null
  packSize: number | null
  unit: string
}

function greeting(contactName: string | null | undefined, senderName: string): string {
  const who = contactName?.trim() ? ` ${contactName.trim()}` : ''
  return `¡Hola${who}! Te escribo de ${senderName}.`
}

export function orderMessage(input: {
  senderName: string
  contactName: string | null
  expectedDate: string | null
  lines: readonly MessageLine[]
  note: string | null
}): string {
  const items = input.lines.filter((l) => l.packs > 0).map((l) => `• ${l.name}: ${packsText(l)}`)
  const when = input.expectedDate ? ` para el ${longDayLabel(input.expectedDate)}` : ''
  const note = input.note?.trim() ? `\n\n${input.note.trim()}` : ''
  const ask = input.expectedDate
    ? '¿Me confirmás que llega ese día? ¡Gracias!'
    : '¿Me confirmás disponibilidad y día de entrega? ¡Gracias!'
  return `${greeting(input.contactName, input.senderName)} Te paso el pedido${when}:\n\n${items.join('\n')}${note}\n\n${ask}`
}

export type ClaimLine = MessageLine & { receivedPacks: number }

export function claimMessage(input: {
  senderName: string
  contactName: string | null
  receivedDate: string | null
  lines: readonly ClaimLine[]
}): string {
  const items = input.lines.map((l) => {
    const asked = packsText(l)
    const got =
      l.receivedPacks <= 0 ? 'no llegó' : `llegaron ${packsText({ ...l, packs: l.receivedPacks })}`
    return `• ${l.name}: pedimos ${asked} y ${got}`
  })
  const when = input.receivedDate ? ` que llegó el ${longDayLabel(input.receivedDate)}` : ''
  return `${greeting(input.contactName, input.senderName)} En el pedido${when} hubo diferencias:\n\n${items.join('\n')}\n\n¿Cómo lo resolvemos? ¡Gracias!`
}

/** El link que abre el chat con el mensaje escrito. Sin número, `null` (se copia el mensaje). */
export function whatsappLink(whatsapp: string | null, text: string): string | null {
  if (!whatsapp) return null
  return buildWaMeUrl(whatsapp, text)
}

/** «llegó 0 de 3 kg»: la línea corta del aviso de diferencias. */
export function differenceText(line: ClaimLine): string {
  const expected = packsText(line)
  if (line.receivedPacks <= 0) return `llegó 0 de ${expected}`
  return `llegó ${formatQty(line.receivedPacks)} de ${expected}`
}
