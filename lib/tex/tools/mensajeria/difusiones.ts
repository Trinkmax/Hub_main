import 'server-only'

import { z } from 'zod'
import { getAudience, listAudiences } from '@/lib/audiences/queries'
import {
  cancelBroadcast,
  resendFailedRecipients,
  scheduleBroadcast,
  sendBroadcastNow,
} from '@/lib/broadcasts/actions'
import { getBroadcastDetail, listBroadcasts } from '@/lib/broadcasts/queries'
import { broadcastCreateSchema } from '@/lib/broadcasts/schemas'
import { VARIABLE_SOURCES } from '@/lib/broadcasts/variables'
import { isTokenExpiringSoon } from '@/lib/meta/token-refresh'
import { createClient } from '@/lib/supabase/server'
import type { BroadcastStatus, ChannelType } from '@/types/database'
import { matchByName, noMatchText } from '../actions/_gastos-values'
import { cappedBySize } from '../read/common'
import { defineTool, type TexExecutor, type TexToolContext, zodIssuesText } from '../types'
import {
  type AudienceReach,
  BROADCAST_STATE_FILTER,
  BROADCAST_STATUS_LABEL,
  type BroadcastDetailLike,
  broadcastActions,
  broadcastConfirmLabel,
  broadcastData,
  broadcastFunnel,
  broadcastsData,
  broadcastTicket,
  buildMapping,
  defaultBroadcastName,
  noReachText,
  parseWhen,
  type RecipientLike,
  reachChanged,
  staleCountWarnings,
} from './_broadcast-values'
import {
  countText,
  dateTimeText,
  fail,
  failed,
  formDataOf,
  OWNER_ROLES,
  peopleText,
  placeOf,
  TICKET_BROKEN,
} from './_common'
import { audienceReach, CHANNEL_COLUMNS, channelOf, listTemplates } from './_lookups'
import {
  channelProblem,
  matchTemplate,
  type TemplateRow,
  templateData,
  templateUseProblem,
} from './_template-values'

/** Las difusiones, y lo que hace falta para mandarlas: plantillas y canales. */

const TEMPLATES_MAX = 40
/** Una difusión igual, tan reciente, es un doble toque o el mismo tique armado dos veces. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000

const TEMPLATE_STATE_WORDS = {
  aprobadas: 'approved',
  en_revision: 'pending',
  rechazadas: 'rejected',
  pausadas: 'disabled',
  borradores: 'draft',
} as const

type TemplateStateWord = keyof typeof TEMPLATE_STATE_WORDS
const TEMPLATE_STATES = Object.keys(TEMPLATE_STATE_WORDS) as [
  TemplateStateWord,
  ...TemplateStateWord[],
]

type BroadcastStateWord = keyof typeof BROADCAST_STATE_FILTER
const BROADCAST_STATES = Object.keys(BROADCAST_STATE_FILTER) as [
  BroadcastStateWord,
  ...BroadcastStateWord[],
]

/** Lo que recibe el ejecutor: lo del formulario y lo que se le prometió a la persona. */
const broadcastPayload = broadcastCreateSchema.extend({
  promised_reach: z.number().int().min(0),
})

const broadcastAction = z.object({
  id: z.string().uuid(),
  name: z.string(),
  accion: z.enum(['mandar_ahora', 'cancelar', 'reenviar_fallidos']),
  promised_reach: z.number().int().min(0).nullable(),
})

type BroadcastCore = {
  id: string
  name: string
  status: BroadcastStatus
  stats: Record<string, number>
  audience_id: string
  template_id: string
}

async function readBroadcast(ctx: TexToolContext, id: string): Promise<BroadcastCore | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('broadcasts')
    .select('id, name, status, stats, audience_id, template_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('tex.mensajeria.readBroadcast')
  if (!data) return null
  const row = data as BroadcastCore & { stats: Record<string, number> | null }
  return { ...row, stats: row.stats ?? {} }
}

async function sameBroadcastJustMade(
  ctx: TexToolContext,
  broadcast: { name: string; template_id: string; audience_id: string },
  nowMs: number,
): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('broadcasts')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('name', broadcast.name)
    .eq('template_id', broadcast.template_id)
    .eq('audience_id', broadcast.audience_id)
    .neq('status', 'cancelled')
    .gte('created_at', new Date(nowMs - DUPLICATE_WINDOW_MS).toISOString())
    .limit(1)
  if (error) throw new Error('tex.mensajeria.sameBroadcast')
  return (data ?? []).length > 0
}

/** Por qué no puede salir ahora: la plantilla pudo cambiar después de programarla. */
async function broadcastSendProblem(
  ctx: TexToolContext,
  templateId: string,
): Promise<string | null> {
  const templates = await listTemplates(ctx)
  const template = templates.find((row) => row.id === templateId)
  if (!template) return 'Su plantilla ya no está: se arma de nuevo.'
  return (
    templateUseProblem(template) ??
    channelProblem(await channelOf(ctx, template.channel_id), 'whatsapp')
  )
}

async function reachOfAudience(
  ctx: TexToolContext,
  audienceId: string,
): Promise<
  { ok: true; name: string; saved: number; reach: AudienceReach } | { ok: false; message: string }
> {
  const audience = await getAudience(ctx.tenantId, audienceId)
  if (!audience) return { ok: false, message: 'Su audiencia ya no está: se arma de nuevo.' }
  const reach = await audienceReach(ctx, audience.filters)
  return reach.ok
    ? { ok: true, name: audience.name, saved: audience.customer_count_cached, reach: reach.value }
    : { ok: false, message: reach.message }
}

/** La difusión que pide, por nombre o por id. */
async function findBroadcast(ctx: TexToolContext, wanted: string) {
  const rows = await listBroadcasts(ctx.tenantId)
  return matchByName(rows, wanted)
}

export const difusionesTools = [
  defineTool({
    name: 'ver_difusiones',
    description:
      'Las difusiones o campañas masivas, de la más nueva a la más vieja: estado, cuándo salen y resultados (enviados, entregados, leídos, respondieron, fallidos). Usala para «cómo le fue a la campaña».',
    input: z.object({ estado: z.enum(BROADCAST_STATES).optional().describe('Sin esto, todas.') }),
    need: { roles: OWNER_ROLES },
    doing: () => 'Mirando las difusiones',
    done: () => 'Miré las difusiones',
    run: async (input, ctx) => {
      const rows = await listBroadcasts(ctx.tenantId)
      const wanted = input.estado
        ? (BROADCAST_STATE_FILTER[input.estado] as readonly string[])
        : null
      return {
        kind: 'data',
        data: broadcastsData(wanted ? rows.filter((row) => wanted.includes(row.status)) : rows),
      }
    },
  }),

  defineTool({
    name: 'ver_difusion',
    description:
      'Una difusión o campaña en detalle: su plantilla, su audiencia, los resultados, por qué falló lo que falló, quiénes respondieron y qué se puede hacer (cancelar, adelantar, reintentar).',
    input: z.object({
      difusion: z.string().min(1).max(120).describe('Su nombre o id.'),
    }),
    need: { roles: OWNER_ROLES },
    doing: () => 'Mirando la difusión',
    done: () => 'Miré la difusión',
    run: async (input, ctx) => {
      const match = await findBroadcast(ctx, input.difusion)
      if (!match.ok) return fail(noMatchText(match, input.difusion))
      const detail = await getBroadcastDetail(ctx.tenantId, match.value.id)
      if (!detail) return fail('Esa difusión no está.')
      const raw = detail.broadcast as unknown as BroadcastDetailLike & {
        channel: unknown
        template: unknown
        audience: unknown
      }
      const one = <T>(value: unknown): T | null =>
        ((Array.isArray(value) ? value[0] : value) as T | undefined) ?? null
      let pendingReach: number | null = null
      if (raw.status === 'scheduled' || raw.status === 'draft') {
        const core = await readBroadcast(ctx, raw.id)
        const counted = core ? await reachOfAudience(ctx, core.audience_id) : null
        if (counted?.ok) pendingReach = counted.reach.reach
      }
      return {
        kind: 'data',
        data: broadcastData(
          {
            ...raw,
            stats: raw.stats ?? {},
            channel: one(raw.channel),
            template: one(raw.template),
            audience: one(raw.audience),
          },
          detail.recipients as RecipientLike[],
          pendingReach,
        ),
      }
    },
  }),

  defineTool({
    name: 'ver_plantillas',
    description:
      'Las plantillas de WhatsApp (mensajes aprobados) y su estado de aprobación: aprobada, en revisión, rechazada. Con su texto y qué lleva cada hueco {{1}}.',
    input: z.object({ estado: z.enum(TEMPLATE_STATES).optional().describe('Sin esto, todas.') }),
    need: { roles: OWNER_ROLES },
    doing: () => 'Mirando las plantillas',
    done: () => 'Miré las plantillas',
    run: async (input, ctx) => {
      const rows: TemplateRow[] = await listTemplates(ctx)
      const wanted = input.estado ? TEMPLATE_STATE_WORDS[input.estado] : null
      const shown = wanted ? rows.filter((row) => row.status === wanted) : rows
      return {
        kind: 'data',
        data: {
          cuantas: rows.length,
          aprobadas: rows.filter((row) => row.status === 'approved').length,
          ...cappedBySize(shown.map(templateData), TEMPLATES_MAX),
        },
      }
    },
  }),

  defineTool({
    name: 'ver_canales',
    description:
      '¿Está conectado el WhatsApp? ¿Y el Instagram? Dice si cada canal está conectado, desde cuándo y si la autorización está por vencer.',
    input: z.object({}),
    need: { roles: OWNER_ROLES },
    doing: () => 'Mirando los canales',
    done: () => 'Miré los canales',
    run: async (_input, ctx) => {
      const supabase = await createClient()
      const { data, error } = await supabase
        .from('channels')
        .select(CHANNEL_COLUMNS)
        .eq('tenant_id', ctx.tenantId)
      if (error) throw new Error('tex.mensajeria.channels')
      const rows = (data ?? []) as ChannelReadRow[]
      const now = new Date()
      return {
        kind: 'data',
        data: {
          canales: (['whatsapp', 'instagram'] as const).map((type) =>
            channelRow(
              type,
              rows.find((row) => row.type === type),
              now,
            ),
          ),
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_difusion',
    description:
      'Prepara una difusión o campaña: mandarle un mensaje a toda una audiencia, ahora o programado, con una plantilla aprobada. Calcula a cuántos les llega. No guarda nada ni manda nada: muestra un tique para confirmar.',
    input: z.object({
      plantilla: z.string().min(1).max(120).describe('La plantilla aprobada: su nombre o id.'),
      audiencia: z.string().min(1).max(80).describe('A quién: el nombre o id de la audiencia.'),
      cuando: z
        .string()
        .min(1)
        .max(20)
        .describe(
          '«ahora», o fecha y hora de Córdoba: yyyy-MM-ddTHH:mm. Si no lo dijo, preguntale: nunca lo asumas.',
        ),
      nombre: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe('Para reconocerla después; el cliente no lo ve. Si no lo dijo, se arma solo.'),
      huecos: z
        .array(
          z.object({
            numero: z.number().int().min(1).max(20),
            dato: z.enum(VARIABLE_SOURCES).optional().describe('custom es un texto fijo.'),
            texto: z.string().trim().min(1).max(200).optional().describe('El texto fijo.'),
            si_falta: z
              .string()
              .trim()
              .min(1)
              .max(60)
              .optional()
              .describe('Qué poner si a un cliente le falta el dato.'),
          }),
        )
        .max(20)
        .optional()
        .describe('Solo si cambia lo que la plantilla ya dice que va en cada hueco {{n}}.'),
    }),
    need: { roles: OWNER_ROLES },
    mood: 'working',
    doing: () => 'Preparando la difusión',
    done: () => 'Preparé la difusión',
    run: async (input, ctx) => {
      const when = parseWhen(input.cuando, Date.now())
      if (!when.ok) return fail(when.message)
      const [templates, audiences] = await Promise.all([
        listTemplates(ctx),
        listAudiences(ctx.tenantId),
      ])
      const templateMatch = matchTemplate(templates, input.plantilla)
      if (!templateMatch.ok) return fail(noMatchText(templateMatch, input.plantilla))
      const template = templateMatch.value
      const usable = templateUseProblem(template)
      if (usable) return fail(usable)
      const channelIssue = channelProblem(await channelOf(ctx, template.channel_id), 'whatsapp')
      if (channelIssue) return fail(channelIssue)

      const audienceMatch = matchByName(audiences, input.audiencia)
      if (!audienceMatch.ok) return fail(noMatchText(audienceMatch, input.audiencia))
      const audience = audienceMatch.value

      const mapping = buildMapping(template, input.huecos ?? [])
      if (!mapping.ok) return fail(mapping.message)

      const reach = await audienceReach(ctx, audience.filters)
      if (!reach.ok) return fail(reach.message)
      if (reach.value.reach === 0) return fail(noReachText(audience.name, reach.value.total))

      const name = input.nombre ?? defaultBroadcastName(template, when, ctx.today)
      const payload = broadcastPayload.safeParse({
        name,
        channel_id: template.channel_id,
        template_id: template.id,
        audience_id: audience.id,
        ...(when.mode === 'at' ? { scheduled_at: when.iso } : {}),
        variable_mapping: mapping.mapping,
        promised_reach: reach.value.reach,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'mensajeria.difusion',
          payload: payload.data,
          ticket: broadcastTicket({
            name,
            audienceName: audience.name,
            reach: reach.value,
            savedCount: audience.customer_count_cached,
            template,
            mapping: mapping.mapping,
            assumedName: mapping.assumedName,
            when,
          }),
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_accion_difusion',
    description:
      'Prepara cancelar una difusión programada, adelantarla para que salga ahora o reintentar los envíos que fallaron. No guarda nada ni manda nada: muestra un tique para confirmar.',
    input: z.object({
      difusion: z.string().min(1).max(120).describe('Su nombre o id.'),
      accion: z.enum(['mandar_ahora', 'cancelar', 'reenviar_fallidos']),
    }),
    need: { roles: OWNER_ROLES },
    mood: 'working',
    doing: () => 'Preparando la difusión',
    done: () => 'Preparé la difusión',
    run: async (input, ctx) => {
      const match = await findBroadcast(ctx, input.difusion)
      if (!match.ok) return fail(noMatchText(match, input.difusion))
      const broadcast = await readBroadcast(ctx, match.value.id)
      if (!broadcast) return fail('Esa difusión no está.')
      const funnel = broadcastFunnel(broadcast.stats)
      const allowed = broadcastActions(broadcast.status, funnel.fallidos)
      const state = BROADCAST_STATUS_LABEL[broadcast.status]
      if (!allowed[input.accion]) {
        return fail(
          input.accion === 'reenviar_fallidos'
            ? `«${broadcast.name}» está ${state.toLowerCase()} y no tiene envíos fallidos para reintentar.`
            : `«${broadcast.name}» está ${state.toLowerCase()}: solo se cancela o se adelanta antes de que empiece a salir.`,
        )
      }

      if (input.accion === 'cancelar') {
        return {
          kind: 'prepared',
          prepared: {
            executor: 'mensajeria.accion_difusion',
            payload: {
              id: broadcast.id,
              name: broadcast.name,
              accion: input.accion,
              promised_reach: null,
            },
            ticket: {
              kind: 'difusion_cancelar',
              title: 'Cancelar una difusión',
              subtitle: broadcast.name,
              rows: [{ label: 'Estado', value: state }],
              total: null,
              entry: [],
              warnings: [
                {
                  key: 'cancel_final',
                  title: 'No se puede volver a programar: para mandarla hay que armarla de nuevo.',
                  body: null,
                },
              ],
              confirmLabel: 'Cancelar la difusión',
            },
          },
        }
      }

      const problem = await broadcastSendProblem(ctx, broadcast.template_id)
      if (problem) return fail(problem)

      if (input.accion === 'reenviar_fallidos') {
        return {
          kind: 'prepared',
          prepared: {
            executor: 'mensajeria.accion_difusion',
            payload: {
              id: broadcast.id,
              name: broadcast.name,
              accion: input.accion,
              promised_reach: null,
            },
            ticket: {
              kind: 'difusion_reintento',
              title: 'Reintentar los envíos fallidos',
              subtitle: broadcast.name,
              rows: [],
              total: { label: 'Se reintentan', value: countText(funnel.fallidos) },
              entry: [],
              warnings: [
                {
                  key: 'no_undo',
                  title:
                    'Lo que salga no se puede deshacer. A quien ya no acepta promos no le llega.',
                  body: null,
                },
              ],
              confirmLabel: `Reintentar ${countText(funnel.fallidos)} ${funnel.fallidos === 1 ? 'envío' : 'envíos'}`,
            },
          },
        }
      }

      const counted = await reachOfAudience(ctx, broadcast.audience_id)
      if (!counted.ok) return fail(counted.message)
      if (counted.reach.reach === 0) return fail(noReachText(counted.name, counted.reach.total))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'mensajeria.accion_difusion',
          payload: {
            id: broadcast.id,
            name: broadcast.name,
            accion: input.accion,
            promised_reach: counted.reach.reach,
          },
          ticket: {
            kind: 'difusion_ahora',
            title: 'Mandar ahora una difusión programada',
            subtitle: broadcast.name,
            rows: [
              { label: 'A quién', value: `La lista «${counted.name}»` },
              { label: 'Cuándo sale', value: 'Apenas confirmes' },
            ],
            total: { label: 'Le llega a', value: peopleText(counted.reach.reach) },
            entry: [],
            warnings: [
              {
                key: 'no_undo',
                title: 'Cuando sale no se puede deshacer: le llega a toda esa gente.',
                body: null,
              },
              ...staleCountWarnings(counted.saved, counted.reach),
            ],
            confirmLabel: broadcastConfirmLabel('now', counted.reach.reach),
          },
        },
      }
    },
  }),
]

type ChannelReadRow = {
  type: ChannelType
  status: string
  display_name: string | null
  connected_at: string | null
  token_expires_at: string | null
  last_error: string | null
}

/** Meta a veces devuelve el teléfono como nombre de cuenta: ese no sale. */
function accountName(type: ChannelType, name: string | null): string | null {
  if (!name) return null
  if (/^\+?\d{8,15}$/.test(name.replace(/[\s-]/g, ''))) return null
  return type === 'instagram' ? `@${name}` : name
}

const CHANNEL_STATE: Readonly<Record<string, string>> = {
  connected: 'Conectado',
  error: 'Necesita atención',
  disconnected: 'Sin conectar',
}

/** Si está conectado y nada más: ni tokens, ni ids de Meta, ni el error crudo. */
export function channelRow(type: ChannelType, row: ChannelReadRow | undefined, now: Date) {
  const word = type === 'whatsapp' ? 'WhatsApp' : 'Instagram'
  if (!row) return { canal: word, estado: 'Sin conectar', conectado: false }
  const connected = row.status === 'connected'
  const account = accountName(type, row.display_name)
  return {
    canal: word,
    estado: CHANNEL_STATE[row.status] ?? row.status,
    conectado: connected,
    ...(account ? { cuenta: account } : {}),
    ...(connected && row.connected_at ? { desde: dateTimeText(row.connected_at) } : {}),
    ...(connected && isTokenExpiringSoon(row.token_expires_at, now)
      ? { autorizacion_por_vencer: true }
      : {}),
    ...(row.last_error ? { tuvo_un_error: 'El detalle se ve en Mensajería › Canales.' } : {}),
  }
}

/** La lista cambió: el total y el botón del tique dicen el número nuevo. */
function reachTicketPatch(reach: number) {
  return {
    total: { label: 'Le llega a', value: peopleText(reach) },
    confirmLabel: broadcastConfirmLabel('now', reach),
  }
}

export const difusionesExecutors: Readonly<Record<string, TexExecutor>> = {
  'mensajeria.difusion': {
    run: async (raw, ctx) => {
      const parsed = broadcastPayload.safeParse(raw)
      if (!parsed.success) return failed(TICKET_BROKEN)
      const { promised_reach: promised, ...broadcast } = parsed.data
      const nowMs = Date.now()
      // El tique pudo quedar esperando: una hora ya pasada saldría en el acto, sin que nadie lo pidió.
      if (broadcast.scheduled_at && Date.parse(broadcast.scheduled_at) <= nowMs) {
        return failed('La hora que se eligió ya pasó, y saldría en el acto. Armala de nuevo.')
      }
      if (await sameBroadcastJustMade(ctx, broadcast, nowMs)) {
        return failed(
          `Ya hay una difusión igual, «${broadcast.name}», creada hace un rato: no la dupliqué. Si es otra, ponele otro nombre.`,
        )
      }
      const counted = await reachOfAudience(ctx, broadcast.audience_id)
      if (!counted.ok) return failed(counted.message)
      if (counted.reach.reach === 0) {
        return failed(noReachText(counted.name, counted.reach.total))
      }
      // El botón prometió un número. Si cambió mucho, lo tiene que ver antes de que salga.
      if (!broadcast.scheduled_at && reachChanged(promised, counted.reach.reach)) {
        return {
          ok: false,
          kind: 'review',
          message: `La lista cambió: ahora le llega a ${peopleText(counted.reach.reach)}.`,
          warnings: [
            {
              key: 'reach_changed',
              title: `Cuando armé el tique le llegaba a ${peopleText(promised)}. Ahora le llega a ${peopleText(counted.reach.reach)}. Si está bien, confirmá de nuevo.`,
              body: null,
            },
          ],
          ticket: reachTicketPatch(counted.reach.reach),
          payload: { ...parsed.data, promised_reach: counted.reach.reach },
        }
      }
      const state = await scheduleBroadcast(
        ctx.slug,
        { ok: true },
        formDataOf({
          name: broadcast.name,
          channel_id: broadcast.channel_id,
          template_id: broadcast.template_id,
          audience_id: broadcast.audience_id,
          scheduled_at: broadcast.scheduled_at,
          variable_mapping: JSON.stringify(broadcast.variable_mapping),
        }),
      )
      if (!state.ok) return failed(state.message)
      const place = state.id
        ? placeOf(ctx, 'mensajeria.difusion', { id: state.id })
        : placeOf(ctx, 'mensajeria.difusiones', {}, broadcast.name)
      return {
        ok: true,
        message: broadcast.scheduled_at
          ? `Quedó programada para el ${dateTimeText(broadcast.scheduled_at)}.`
          : `Ya está saliendo, a ${peopleText(counted.reach.reach)}.`,
        ...place,
        undoUntil: null,
        data: { id: state.id ?? null },
      }
    },
  },

  'mensajeria.accion_difusion': {
    run: async (raw, ctx) => {
      const parsed = broadcastAction.safeParse(raw)
      if (!parsed.success) return failed(TICKET_BROKEN)
      const { id, accion, promised_reach: promised } = parsed.data
      const broadcast = await readBroadcast(ctx, id)
      if (!broadcast) return failed('Esa difusión ya no está.')
      const funnel = broadcastFunnel(broadcast.stats)
      // Las acciones no dicen nada si ya no aplica: se mira antes de tocar el botón de verdad.
      if (!broadcastActions(broadcast.status, funnel.fallidos)[accion]) {
        return failed(
          `«${broadcast.name}» ya está ${BROADCAST_STATUS_LABEL[broadcast.status].toLowerCase()}: no se hizo nada.`,
        )
      }
      if (accion !== 'cancelar') {
        const problem = await broadcastSendProblem(ctx, broadcast.template_id)
        if (problem) return failed(problem)
      }
      if (accion === 'mandar_ahora') {
        const counted = await reachOfAudience(ctx, broadcast.audience_id)
        if (!counted.ok) return failed(counted.message)
        if (counted.reach.reach === 0) {
          return failed(noReachText(counted.name, counted.reach.total))
        }
        if (promised !== null && reachChanged(promised, counted.reach.reach)) {
          return {
            ok: false,
            kind: 'review',
            message: `La lista cambió: ahora le llega a ${peopleText(counted.reach.reach)}.`,
            warnings: [
              {
                key: 'reach_changed',
                title: `Cuando armé el tique le llegaba a ${peopleText(promised)}. Ahora le llega a ${peopleText(counted.reach.reach)}. Si está bien, confirmá de nuevo.`,
                body: null,
              },
            ],
            ticket: reachTicketPatch(counted.reach.reach),
            payload: { ...parsed.data, promised_reach: counted.reach.reach },
          }
        }
      }
      const form = formDataOf({ id })
      const state =
        accion === 'cancelar'
          ? await cancelBroadcast(ctx.slug, { ok: true }, form)
          : accion === 'mandar_ahora'
            ? await sendBroadcastNow(ctx.slug, { ok: true }, form)
            : await resendFailedRecipients(ctx.slug, { ok: true }, form)
      if (!state.ok) return failed(state.message)
      if (accion === 'cancelar') {
        // `cancelBroadcast` no se queja si ya había empezado a salir: se confirma leyendo.
        const after = await readBroadcast(ctx, id)
        if (after?.status !== 'cancelled') {
          return failed(`No se pudo cancelar: «${broadcast.name}» ya empezó a salir.`)
        }
      }
      const message =
        accion === 'cancelar'
          ? `Cancelé «${broadcast.name}»: no sale.`
          : accion === 'mandar_ahora'
            ? `«${broadcast.name}» ya está saliendo.`
            : `Reintentando los envíos fallidos de «${broadcast.name}».`
      return {
        ok: true,
        message,
        ...placeOf(ctx, 'mensajeria.difusion', { id }),
        undoUntil: null,
      }
    },
  },
}
