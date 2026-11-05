import 'server-only'

import { z } from 'zod'
import {
  type ConversationDetail,
  getConversation,
  getUnreadTotal,
  listConversations,
} from '@/lib/bandeja/queries'
import { createConversationTag, setConversationTags } from '@/lib/conversation-tags/actions'
import { getTagsForConversationIds, listConversationTags } from '@/lib/conversation-tags/queries'
import {
  createConversationTagSchema,
  setConversationTagsSchema,
  type TAG_COLORS,
} from '@/lib/conversation-tags/schemas'
import { sendTemplateMessage, sendTextMessage } from '@/lib/meta/actions'
import { createQuickMessage, updateQuickMessage } from '@/lib/quick-messages/actions'
import { listQuickMessages } from '@/lib/quick-messages/queries'
import { quickMessageCreateSchema, quickMessageUpdateSchema } from '@/lib/quick-messages/schemas'
import { createClient } from '@/lib/supabase/server'
import { simpleExecutor } from '../../simple-action'
import { matchByName, noMatchText } from '../actions/_gastos-values'
import { cappedBySize } from '../read/common'
import { defineTool, type TexExecutor, type TexToolContext, zodIssuesText } from '../types'
import {
  blockedText,
  CHANNEL_WORD,
  CONVERSATIONS_READ,
  canWriteFreeText,
  conversationData,
  conversationName,
  filledTemplateText,
  inboxData,
  MESSAGES_DEFAULT,
  MESSAGES_MAX,
  type MessageLike,
  nextTagIds,
  sendLabel,
  shortcutFrom,
  templateDataProblem,
  templateOptInProblem,
  windowClosedText,
  windowEnd,
} from './_chat-values'
import {
  actionState,
  CATALOG_ROLES,
  dateTimeText,
  fail,
  failed,
  formDataOf,
  INBOX_ROLES,
  maskedContactProblem,
  NO_UNDO_WARNING,
  placeOf,
  redactContact,
  safeText,
  TICKET_BROKEN,
} from './_common'
import {
  channelOf,
  customerFlags,
  findConversation,
  listTemplates,
  sameMessageJustSent,
} from './_lookups'
import {
  channelProblem,
  matchTemplate,
  type TemplateRow,
  templateHoles,
  templateTitle,
  templateUseProblem,
} from './_template-values'

/** Los chats: leerlos, contestarlos, ordenarlos y las respuestas guardadas. */

const QUICK_TEXT_MAX = 200

const TAG_COLOR_WORDS = {
  gris: '#94a3b8',
  rojo: '#f87171',
  naranja: '#fb923c',
  amarillo: '#fbbf24',
  verde: '#4ade80',
  esmeralda: '#34d399',
  celeste: '#22d3ee',
  azul: '#60a5fa',
  violeta: '#a78bfa',
  rosa: '#f472b6',
} as const satisfies Record<string, (typeof TAG_COLORS)[number]>

type TagColorWord = keyof typeof TAG_COLOR_WORDS

const TAG_COLOR_NAMES = Object.keys(TAG_COLOR_WORDS) as [TagColorWord, ...TagColorWord[]]

const conversationField = z
  .string()
  .min(1)
  .max(120)
  .describe('La conversación: el nombre del cliente, sus últimos 4 dígitos o el id.')

/**
 * El esquema de `sendTextMessage` vive adentro de su archivo de acciones: este es el mismo, y
 * `tex-mensajeria-acciones.test.ts` prueba que la acción de verdad acepte lo que sale de acá.
 */
const replyPayload = z.object({
  conversation_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4096),
})

const templateMessagePayload = z.object({
  conversation_id: z.string().uuid(),
  template_id: z.string().uuid(),
  variables: z.array(z.string()),
})

const tagsPayload = z.object({
  conversation_id: z.string().uuid(),
  name: z.string(),
  add: z.array(z.string().uuid()),
  remove: z.array(z.string().uuid()),
})

const quickMessagePayload = quickMessageCreateSchema.extend({
  id: z.string().uuid().nullable(),
})

/** Lo de la pantalla de chat: ventana, canal conectado y «No contactar». */
async function replyProblem(
  ctx: TexToolContext,
  conversation: ConversationDetail,
  nowMs: number,
): Promise<string | null> {
  const name = conversationName(conversation)
  if (!canWriteFreeText(conversation.channel_type, conversation.last_inbound_at, nowMs)) {
    return windowClosedText(name)
  }
  const channel = await channelOf(ctx, conversation.channel_id)
  const problem = channelProblem(channel)
  if (problem) return problem
  const flags = await customerFlags(ctx, conversation.customer_id)
  return flags?.is_blocked ? blockedText(name) : null
}

/** Una plantilla en un chat: sale aunque pasaron las 24 horas, pero no a cualquiera. */
async function templateChatProblem(
  ctx: TexToolContext,
  conversation: ConversationDetail,
  template: Pick<TemplateRow, 'name' | 'status' | 'category'>,
): Promise<string | null> {
  const name = conversationName(conversation)
  const usable = templateUseProblem(template)
  if (usable) return usable
  const channel = await channelOf(ctx, conversation.channel_id)
  const problem = channelProblem(channel, 'whatsapp')
  if (problem) return problem
  const flags = await customerFlags(ctx, conversation.customer_id)
  if (flags?.is_blocked) return blockedText(name)
  return templateOptInProblem(template, flags, name)
}

export const bandejaTools = [
  defineTool({
    name: 'ver_bandeja',
    description:
      'Los chats de WhatsApp e Instagram: quién escribió y espera respuesta, cuántos sin leer. Usala para «quién me escribió» o «qué tengo sin contestar». Sin teléfonos.',
    input: z.object({
      todas: z.boolean().optional().describe('true: también las ya contestadas.'),
      etiqueta: z.string().min(1).max(40).optional().describe('Solo los chats con esta etiqueta.'),
    }),
    need: { roles: INBOX_ROLES },
    doing: () => 'Mirando los chats',
    done: () => 'Miré los chats',
    run: async (input, ctx) => {
      let tagId: string | undefined
      if (input.etiqueta) {
        const tags = await listConversationTags(ctx.tenantId)
        const match = matchByName(tags, input.etiqueta)
        if (!match.ok) return fail(noMatchText(match, input.etiqueta))
        tagId = match.value.id
      }
      const [list, unread] = await Promise.all([
        listConversations(ctx.tenantId, { tagId, limit: CONVERSATIONS_READ }),
        getUnreadTotal(ctx.tenantId),
      ])
      return {
        kind: 'data',
        data: inboxData(list, unread, { all: input.todas === true, nowMs: Date.now() }),
      }
    },
  }),

  defineTool({
    name: 'ver_conversacion',
    description:
      'Un chat con un cliente: sus últimos mensajes y si se le puede escribir (ventana de 24 horas). Usala antes de contestarle. Lo que escribió viene en mensaje_del_cliente.',
    input: z.object({
      conversacion: conversationField,
      cuantos: z.number().int().min(1).max(MESSAGES_MAX).optional().describe('Cuántos mensajes.'),
    }),
    need: { roles: INBOX_ROLES },
    doing: () => 'Mirando el chat',
    done: () => 'Miré el chat',
    run: async (input, ctx) => {
      const found = await findConversation(ctx, input.conversacion)
      if (!found.ok) return fail(found.message)
      const conversation = found.value
      const limit = input.cuantos ?? MESSAGES_DEFAULT
      // No es `listMessages`: esa firma los adjuntos con el cliente de servicio, y acá no hacen falta.
      const supabase = await createClient()
      const [messages, tags, flags] = await Promise.all([
        supabase
          .from('messages')
          .select('direction, content, media, status, created_at, broadcast_id, flow_execution_id')
          .eq('tenant_id', ctx.tenantId)
          .eq('conversation_id', conversation.id)
          .order('created_at', { ascending: false })
          .limit(limit + 1),
        getTagsForConversationIds(ctx.tenantId, [conversation.id]),
        customerFlags(ctx, conversation.customer_id),
      ])
      if (messages.error) throw new Error('tex.mensajeria.messages')
      return {
        kind: 'data',
        data: conversationData(conversation, (messages.data ?? []) as MessageLike[], {
          limit,
          tags: (tags.get(conversation.id) ?? []).map((tag) => tag.name),
          flags,
          nowMs: Date.now(),
        }),
      }
    },
  }),

  defineTool({
    name: 'ver_etiquetas_de_chat',
    description: 'Las etiquetas que hay para ordenar los chats: Reservas, Quejas, VIP.',
    input: z.object({}),
    need: { roles: CATALOG_ROLES },
    doing: () => 'Mirando las etiquetas',
    done: () => 'Miré las etiquetas',
    run: async (_input, ctx) => {
      const tags = await listConversationTags(ctx.tenantId)
      return { kind: 'data', data: { etiquetas: tags.map((tag) => tag.name) } }
    },
  }),

  defineTool({
    name: 'ver_mensajes_rapidos',
    description:
      'Los mensajes rápidos: las respuestas guardadas para el chat, con su atajo. En el chat se usan escribiendo / y el atajo.',
    input: z.object({}),
    need: { roles: CATALOG_ROLES },
    doing: () => 'Mirando los mensajes rápidos',
    done: () => 'Miré los mensajes rápidos',
    run: async (_input, ctx) => {
      const rows = await listQuickMessages(ctx.tenantId)
      return {
        kind: 'data',
        data: cappedBySize(
          rows.map((row) => ({
            id: row.id,
            titulo: row.title,
            atajo: `/${row.shortcut}`,
            texto: safeText(row.body, QUICK_TEXT_MAX),
          })),
          40,
        ),
      }
    },
  }),

  defineTool({
    name: 'preparar_respuesta',
    description:
      'Prepara contestarle o escribirle a un cliente en su chat: mandarle un mensaje de texto por WhatsApp o Instagram. En WhatsApp, solo dentro de las 24 horas de su último mensaje. No guarda nada ni manda nada: muestra un tique para confirmar.',
    input: z.object({
      conversacion: conversationField,
      texto: z.string().trim().min(1).max(4096).describe('El mensaje, completo, tal como sale.'),
    }),
    need: { roles: INBOX_ROLES },
    mood: 'working',
    doing: () => 'Preparando la respuesta',
    done: () => 'Preparé la respuesta',
    run: async (input, ctx) => {
      const masked = maskedContactProblem(input.texto)
      if (masked) return fail(masked)
      const found = await findConversation(ctx, input.conversacion)
      if (!found.ok) return fail(found.message)
      const conversation = found.value
      const nowMs = Date.now()
      const problem = await replyProblem(ctx, conversation, nowMs)
      if (problem) return fail(problem)
      const payload = replyPayload.safeParse({
        conversation_id: conversation.id,
        body: input.texto,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      const name = conversationName(conversation)
      const until =
        conversation.channel_type === 'whatsapp' && conversation.last_inbound_at
          ? dateTimeText(windowEnd(conversation.last_inbound_at))
          : null
      return {
        kind: 'prepared',
        prepared: {
          executor: 'mensajeria.respuesta',
          payload: payload.data,
          ticket: {
            kind: 'respuesta',
            title: `Responder por ${CHANNEL_WORD[conversation.channel_type]}`,
            subtitle: name,
            rows: [
              { label: 'A quién', value: name },
              { label: 'Mensaje', value: payload.data.body },
              ...(until ? [{ label: 'Se puede escribir hasta', value: until }] : []),
            ],
            total: null,
            entry: [],
            warnings: [NO_UNDO_WARNING],
            confirmLabel: sendLabel(conversation),
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_plantilla_en_chat',
    description:
      'Prepara mandarle a un cliente una plantilla aprobada en su chat: es la forma de retomar la charla cuando pasaron más de 24 horas. No guarda nada ni manda nada: muestra un tique para confirmar.',
    input: z.object({
      conversacion: conversationField,
      plantilla: z.string().min(1).max(120).describe('La plantilla: su nombre o id.'),
      datos: z
        .array(z.string().trim().min(1).max(200))
        .max(20)
        .optional()
        .describe('Qué va en cada hueco {{n}}, en orden. Se lee con ver_plantillas.'),
    }),
    need: { roles: INBOX_ROLES },
    mood: 'working',
    doing: () => 'Preparando la plantilla',
    done: () => 'Preparé la plantilla',
    run: async (input, ctx) => {
      const [found, templates] = await Promise.all([
        findConversation(ctx, input.conversacion),
        listTemplates(ctx),
      ])
      if (!found.ok) return fail(found.message)
      const match = matchTemplate(templates, input.plantilla)
      if (!match.ok) return fail(noMatchText(match, input.plantilla))
      const template = match.value
      const conversation = found.value
      const problem = await templateChatProblem(ctx, conversation, template)
      if (problem) return fail(problem)
      const values = input.datos ?? []
      const dataProblem = templateDataProblem(template, templateHoles(template), values)
      if (dataProblem) return fail(dataProblem)
      const payload = templateMessagePayload.safeParse({
        conversation_id: conversation.id,
        template_id: template.id,
        variables: values,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      const name = conversationName(conversation)
      return {
        kind: 'prepared',
        prepared: {
          executor: 'mensajeria.plantilla_chat',
          payload: payload.data,
          ticket: {
            kind: 'plantilla_chat',
            title: 'Mandar un mensaje aprobado',
            subtitle: name,
            rows: [
              { label: 'A quién', value: name },
              { label: 'Plantilla', value: templateTitle(template) },
              { label: 'Mensaje', value: filledTemplateText(template.components, values) },
            ],
            total: null,
            entry: [],
            warnings: [NO_UNDO_WARNING],
            confirmLabel: sendLabel(conversation),
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_etiquetas_de_chat',
    description:
      'Prepara etiquetar un chat: ponerle o sacarle etiquetas a una conversación, para ordenar la bandeja. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      conversacion: conversationField,
      poner: z.array(z.string().min(1).max(40)).max(10).optional().describe('Nombres.'),
      sacar: z.array(z.string().min(1).max(40)).max(10).optional().describe('Nombres.'),
    }),
    need: { roles: INBOX_ROLES },
    mood: 'working',
    doing: () => 'Preparando las etiquetas',
    done: () => 'Preparé las etiquetas',
    run: async (input, ctx) => {
      const [found, tags] = await Promise.all([
        findConversation(ctx, input.conversacion),
        listConversationTags(ctx.tenantId),
      ])
      if (!found.ok) return fail(found.message)
      const resolve = (names: readonly string[]) => {
        const ids: Array<{ id: string; name: string }> = []
        for (const wanted of names) {
          const match = matchByName(tags, wanted)
          if (!match.ok) return { ok: false as const, message: noMatchText(match, wanted) }
          ids.push(match.value)
        }
        return { ok: true as const, ids }
      }
      const put = resolve(input.poner ?? [])
      if (!put.ok) return fail(`${put.message} Se crea con preparar_etiqueta_nueva.`)
      const take = resolve(input.sacar ?? [])
      if (!take.ok) return fail(take.message)
      if (put.ids.length === 0 && take.ids.length === 0) {
        return fail('Preguntale qué etiqueta poner o sacar.')
      }
      const conversation = found.value
      const assigned = await getTagsForConversationIds(ctx.tenantId, [conversation.id])
      const current = (assigned.get(conversation.id) ?? []).map((tag) => tag.id)
      const add = put.ids.map((tag) => tag.id)
      const remove = take.ids.map((tag) => tag.id)
      const next = nextTagIds(current, add, remove)
      if (next.length === current.length && next.every((id) => current.includes(id))) {
        return fail('Ese chat ya está así: no hay nada para cambiar.')
      }
      const check = setConversationTagsSchema.safeParse({
        conversation_id: conversation.id,
        tag_ids: next,
      })
      if (!check.success) return fail(zodIssuesText(check.error))
      const name = conversationName(conversation)
      return {
        kind: 'prepared',
        prepared: {
          executor: 'mensajeria.etiquetas',
          payload: { conversation_id: conversation.id, name, add, remove },
          ticket: {
            kind: 'etiquetas_chat',
            title: 'Etiquetar un chat',
            subtitle: name,
            rows: [
              ...(put.ids.length > 0
                ? [{ label: 'Poner', value: put.ids.map((tag) => tag.name).join(', ') }]
                : []),
              ...(take.ids.length > 0
                ? [{ label: 'Sacar', value: take.ids.map((tag) => tag.name).join(', ') }]
                : []),
            ],
            total: null,
            entry: [],
            warnings: [],
            confirmLabel: 'Guardar las etiquetas',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_etiqueta_nueva',
    description:
      'Prepara crear una etiqueta nueva para ordenar los chats. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      nombre: z.string().trim().min(1).max(40),
      color: z.enum(TAG_COLOR_NAMES).optional(),
    }),
    need: { roles: CATALOG_ROLES },
    mood: 'working',
    doing: () => 'Preparando la etiqueta',
    done: () => 'Preparé la etiqueta',
    run: async (input, ctx) => {
      const tags = await listConversationTags(ctx.tenantId)
      if (tags.some((tag) => tag.name.toLowerCase() === input.nombre.toLowerCase())) {
        return fail(`Ya hay una etiqueta «${input.nombre}»: no hace falta crearla.`)
      }
      const payload = createConversationTagSchema.safeParse({
        name: input.nombre,
        color: input.color ? TAG_COLOR_WORDS[input.color] : undefined,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'mensajeria.etiqueta_nueva',
          payload: payload.data,
          ticket: {
            kind: 'etiqueta_nueva',
            title: 'Nueva etiqueta de chat',
            subtitle: payload.data.name,
            rows: [...(input.color ? [{ label: 'Color', value: input.color }] : [])],
            total: null,
            entry: [],
            warnings: [],
            confirmLabel: 'Crear la etiqueta',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_mensaje_rapido',
    description:
      'Prepara el alta o la edición de un mensaje rápido: una respuesta guardada, con su atajo, para el chat. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      mensaje: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe('El que se edita: título, atajo o id. Sin esto, es un alta.'),
      titulo: z.string().trim().min(1).max(80).optional().describe('En un alta, obligatorio.'),
      atajo: z
        .string()
        .trim()
        .min(1)
        .max(40)
        .optional()
        .describe('Si no lo dijo, sale del título.'),
      texto: z.string().trim().min(1).max(1024).optional().describe('En un alta, obligatorio.'),
    }),
    need: { roles: CATALOG_ROLES },
    mood: 'working',
    doing: () => 'Preparando el mensaje rápido',
    done: () => 'Preparé el mensaje rápido',
    run: async (input, ctx) => {
      const masked = maskedContactProblem(input.texto)
      if (masked) return fail(masked)
      const rows = await listQuickMessages(ctx.tenantId)
      const named = rows.map((row) => ({ ...row, name: row.title }))
      let row: (typeof named)[number] | null = null
      if (input.mensaje) {
        const wanted = input.mensaje.replace(/^\//, '')
        const byShortcut = named.find((candidate) => candidate.shortcut === wanted)
        if (byShortcut) row = byShortcut
        else {
          const match = matchByName(named, wanted)
          if (!match.ok) return fail(noMatchText(match, input.mensaje))
          row = match.value
        }
      } else {
        if (!input.titulo) return fail('Preguntale cómo se llama el mensaje rápido.')
        if (!input.texto) return fail('Preguntale qué dice el mensaje rápido.')
      }
      const title = input.titulo ?? row?.title ?? ''
      const shortcut = (
        input.atajo?.replace(/^\//, '') ??
        row?.shortcut ??
        shortcutFrom(title)
      ).trim()
      const body = input.texto ?? row?.body ?? ''
      const taken = named.find(
        (candidate) => candidate.shortcut === shortcut && candidate.id !== row?.id,
      )
      if (taken) return fail(`El atajo /${shortcut} ya es de «${taken.title}»: elegí otro.`)
      const check = row
        ? quickMessageUpdateSchema.safeParse({ id: row.id, title, shortcut, body })
        : quickMessageCreateSchema.safeParse({ title, shortcut, body })
      if (!check.success) return fail(check.error.issues[0]?.message ?? zodIssuesText(check.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'mensajeria.mensaje_rapido',
          payload: { id: row?.id ?? null, title, shortcut, body },
          ticket: {
            kind: 'mensaje_rapido',
            title: row ? 'Editar mensaje rápido' : 'Nuevo mensaje rápido',
            subtitle: title,
            rows: [
              { label: 'Atajo', value: `/${shortcut}` },
              { label: 'Texto', value: body },
            ],
            total: null,
            entry: [],
            warnings: [],
            confirmLabel: row ? 'Guardar los cambios' : 'Guardar el mensaje',
          },
        },
      }
    },
  }),
]

export const bandejaExecutors: Readonly<Record<string, TexExecutor>> = {
  'mensajeria.respuesta': {
    run: async (raw, ctx) => {
      const parsed = replyPayload.safeParse(raw)
      if (!parsed.success) return failed(TICKET_BROKEN)
      const { conversation_id: id, body } = parsed.data
      const conversation = await getConversation(ctx.tenantId, id)
      if (!conversation) return failed('Esa conversación ya no está.')
      // El tique pudo quedar esperando: la ventana y «No contactar» se miran al momento de mandar.
      const nowMs = Date.now()
      const problem = await replyProblem(ctx, conversation, nowMs)
      if (problem) return failed(problem)
      if (await sameMessageJustSent(ctx, id, body, nowMs)) {
        return failed('Ese mismo mensaje ya salió recién: no lo mandé de nuevo.')
      }
      const state = await sendTextMessage(
        ctx.slug,
        { ok: true },
        formDataOf({ conversation_id: id, body }),
      )
      if (!state.ok) return failed(`No se pudo mandar: ${redactContact(state.message)}`)
      const name = conversationName(conversation)
      const place = placeOf(ctx, 'mensajeria.inbox', {}, name)
      return { ok: true, message: `Le mandé el mensaje a ${name}.`, ...place, undoUntil: null }
    },
  },

  'mensajeria.plantilla_chat': {
    run: async (raw, ctx) => {
      const parsed = templateMessagePayload.safeParse(raw)
      if (!parsed.success) return failed(TICKET_BROKEN)
      const { conversation_id: id, template_id: templateId, variables } = parsed.data
      const [conversation, templates] = await Promise.all([
        getConversation(ctx.tenantId, id),
        listTemplates(ctx),
      ])
      if (!conversation) return failed('Esa conversación ya no está.')
      const template = templates.find((row) => row.id === templateId)
      if (!template) return failed('Esa plantilla ya no está.')
      const problem = await templateChatProblem(ctx, conversation, template)
      if (problem) return failed(problem)
      const sentAs = `[template:${template.name}] ${variables.join(' | ')}`
      if (await sameMessageJustSent(ctx, id, sentAs, Date.now())) {
        return failed('Esa misma plantilla ya salió recién: no la mandé de nuevo.')
      }
      const form = formDataOf({
        conversation_id: id,
        template_name: template.name,
        template_language: template.language,
      })
      for (const value of variables) form.append('variable', value)
      const state = await sendTemplateMessage(ctx.slug, { ok: true }, form)
      if (!state.ok) return failed(`No se pudo mandar: ${redactContact(state.message)}`)
      const name = conversationName(conversation)
      const place = placeOf(ctx, 'mensajeria.inbox', {}, name)
      return { ok: true, message: `Le mandé la plantilla a ${name}.`, ...place, undoUntil: null }
    },
  },

  'mensajeria.etiquetas': simpleExecutor(
    tagsPayload,
    async (payload, ctx) => {
      // Lo que otra persona haya puesto mientras tanto no se pisa: se aplica sobre lo que hay ahora.
      const assigned = await getTagsForConversationIds(ctx.tenantId, [payload.conversation_id])
      const current = (assigned.get(payload.conversation_id) ?? []).map((tag) => tag.id)
      const state = await setConversationTags(
        ctx.slug,
        payload.conversation_id,
        nextTagIds(current, payload.add, payload.remove),
      )
      return actionState(state, 'Listo, quedó etiquetado.', undefined)
    },
    (_data, payload, ctx) => placeOf(ctx, 'mensajeria.inbox', {}, payload.name),
  ),

  'mensajeria.etiqueta_nueva': simpleExecutor(
    createConversationTagSchema,
    async (payload, ctx) => {
      const state = await createConversationTag(
        ctx.slug,
        { ok: true },
        formDataOf({ name: payload.name, color: payload.color }),
      )
      return actionState(state, `Creé la etiqueta «${payload.name}».`, undefined)
    },
    (_data, payload, ctx) => placeOf(ctx, 'mensajeria.etiquetas', {}, payload.name),
  ),

  'mensajeria.mensaje_rapido': simpleExecutor(
    quickMessagePayload,
    async (payload, ctx) => {
      const form = formDataOf({
        ...(payload.id ? { id: payload.id } : {}),
        title: payload.title,
        shortcut: payload.shortcut,
        body: payload.body,
      })
      const state = payload.id
        ? await updateQuickMessage(ctx.slug, { ok: true }, form)
        : await createQuickMessage(ctx.slug, { ok: true }, form)
      return actionState(
        state,
        payload.id ? 'Guardé los cambios.' : `Guardé «${payload.title}».`,
        undefined,
      )
    },
    (_data, payload, ctx) => placeOf(ctx, 'mensajeria.mensajes_rapidos', {}, payload.title),
  ),
}
