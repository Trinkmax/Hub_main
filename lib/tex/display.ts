import type { TexDisplayItem, TexDisplayStep, TexTicket } from './protocol'
import { TEX_CONTEXT_PREFIX } from './system-prompt'

const TEX_ATTACHMENT_PREFIX = '<adjunto '

/**
 * De la charla guardada (los bloques de la API) a lo que se dibuja. Puro. Lo que está en <contexto>
 * no se muestra: es para Tex.
 */

export type StoredBlock = {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  is_error?: boolean
}

export type StoredMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string | StoredBlock[]
}

export function storedBlocks(content: string | StoredBlock[]): StoredBlock[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

/** Lo que escribió la persona en un mensaje (sin el contexto ni los resultados de herramientas). */
export function userTextOf(content: string | StoredBlock[]): string {
  return storedBlocks(content)
    .filter(
      (b) =>
        b.type === 'text' &&
        !(b.text ?? '').startsWith(TEX_CONTEXT_PREFIX) &&
        !(b.text ?? '').startsWith(TEX_ATTACHMENT_PREFIX),
    )
    .map((b) => b.text ?? '')
    .join('\n')
    .trim()
}

/** El nombre del archivo que venía en ese mensaje, si venía uno. */
function attachmentNameOf(blocks: readonly StoredBlock[]): string | null {
  for (const block of blocks) {
    if (block.type !== 'text' || !block.text?.startsWith(TEX_ATTACHMENT_PREFIX)) continue
    return /nombre="([^"]*)"/.exec(block.text)?.[1] ?? null
  }
  return null
}

export function toDisplayItems(
  messages: readonly StoredMessage[],
  tickets: ReadonlyMap<string, TexTicket>,
  stepLabel: (name: string, input: unknown) => string,
): TexDisplayItem[] {
  const items: TexDisplayItem[] = []
  const stepByUse = new Map<string, TexDisplayStep>()
  let current: Extract<TexDisplayItem, { kind: 'tex' }> | null = null

  const texItem = (id: string) => {
    if (!current) {
      current = { kind: 'tex', id, text: '', steps: [] }
      items.push(current)
    }
    return current
  }

  for (const message of messages) {
    const blocks = storedBlocks(message.content)
    if (message.role === 'assistant') {
      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          const item = texItem(message.id)
          item.text = item.text ? `${item.text}\n\n${block.text}` : block.text
        } else if (block.type === 'tool_use' && block.id) {
          const ticket = tickets.get(block.id)
          if (ticket) {
            items.push({ kind: 'ticket', id: ticket.actionId, ticket })
            current = null
          } else {
            const step: TexDisplayStep = {
              id: block.id,
              label: stepLabel(block.name ?? '', block.input),
              state: 'done',
            }
            stepByUse.set(block.id, step)
            texItem(message.id).steps.push(step)
          }
        }
      }
      continue
    }
    for (const block of blocks) {
      if (block.type === 'tool_result' && block.tool_use_id && block.is_error) {
        const step = stepByUse.get(block.tool_use_id)
        if (step) step.state = 'error'
      }
    }
    const text = userTextOf(blocks)
    if (text) {
      items.push({ kind: 'user', id: message.id, text, attachment: attachmentNameOf(blocks) })
      current = null
    }
  }
  return items
}

const YES =
  /^(s[ií]+|sip|dale+|ok+|oka+y?|okey|de una|hacelo|hacele|mand[aá]le|confirmo|confirmado|listo|perfecto|va|vamos|correcto|est[aá] bien|todo bien)[\s.!]*$/i

const NO = /^(no+|nop|cancel[aá]|cancelalo|dej[aá]|dejalo|dejá nomás|mejor no)[\s.!]*$/i

/** ¿Lo que escribió, con tiques adelante, es un «sí» o un «no» a secas? */
export function plainAnswer(text: string): 'yes' | 'no' | null {
  const clean = text.trim()
  if (clean.length > 24) return null
  if (YES.test(clean)) return 'yes'
  if (NO.test(clean)) return 'no'
  return null
}

/**
 * Lo que decide un «sí» o un «no» escrito sobre los tiques que esperan. Un «sí» no confirma lo que abre
 * WhatsApp: lo marcaría enviado sin abrir el chat. Ese va con su botón, y `tapToSend` avisa.
 */
export function typedDecisions(
  actions: ReadonlyArray<{
    id: string
    toolUseId: string
    status: string
    ticket: Pick<TexTicket, 'send'>
  }>,
  waiting: readonly string[],
  answer: 'yes' | 'no',
): { decisions: Array<{ actionId: string; approve: boolean }>; tapToSend: boolean } {
  const open = actions.filter((a) => a.status === 'pending' && waiting.includes(a.toolUseId))
  const typed = answer === 'yes' ? open.filter((a) => !a.ticket.send) : open
  return {
    decisions: typed.map((a) => ({ actionId: a.id, approve: answer === 'yes' })),
    tapToSend: typed.length < open.length,
  }
}
