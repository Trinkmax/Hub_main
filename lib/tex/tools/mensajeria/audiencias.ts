import 'server-only'

import { z } from 'zod'
import { createAudience, updateAudience } from '@/lib/audiences/actions'
import { getAudienceBuilderOptions, listAudiences } from '@/lib/audiences/queries'
import {
  type AudienceFilter,
  audienceCreateSchema,
  audienceFilterSchema,
} from '@/lib/audiences/schemas'
import { createClient } from '@/lib/supabase/server'
import { simpleExecutor } from '../../simple-action'
import { matchByName, noMatchText } from '../actions/_gastos-values'
import { defineTool, type TexExecutor, type TexToolContext, zodIssuesText } from '../types'
import {
  AUDIENCE_COMPARISONS,
  AUDIENCE_FIELD_WORDS,
  AUDIENCES_COUNTED_LIVE,
  audienceFilter,
  audiencesData,
  audienceTicket,
  CONDITIONS_MAX,
  filterSentence,
  hasFixedList,
} from './_audience-values'
import type { AudienceReach } from './_broadcast-values'
import { actionState, fail, formDataOf, OWNER_ROLES, placeOf } from './_common'
import { audienceReach, readBlockedIds } from './_lookups'

/** Las audiencias: las listas de clientes para las difusiones. */

const audiencePayload = audienceCreateSchema.extend({ id: z.string().uuid().nullable() })

/** Lo programado que todavía va a leer esta lista: un cambio le cambia a quién le llega. */
async function scheduledUsing(ctx: TexToolContext, audienceId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('broadcasts')
    .select('name')
    .eq('tenant_id', ctx.tenantId)
    .eq('audience_id', audienceId)
    .eq('status', 'scheduled')
    .limit(5)
  if (error) throw new Error('tex.mensajeria.scheduledUsing')
  return ((data ?? []) as Array<{ name: string }>).map((row) => row.name)
}

export const audienciasTools = [
  defineTool({
    name: 'ver_audiencias',
    description:
      'Las audiencias o listas de clientes para las difusiones: quiénes entran, cuántos son y a cuántos les llegaría una difusión. Usala para «qué listas tengo».',
    input: z.object({}),
    need: { roles: OWNER_ROLES },
    doing: () => 'Mirando las audiencias',
    done: () => 'Miré las audiencias',
    run: async (_input, ctx) => {
      const [rows, options, blockedIds] = await Promise.all([
        listAudiences(ctx.tenantId),
        getAudienceBuilderOptions(ctx.tenantId),
        readBlockedIds(ctx),
      ])
      const live = new Map<string, AudienceReach>()
      await Promise.all(
        rows.slice(0, AUDIENCES_COUNTED_LIVE).map(async (row) => {
          const reach = await audienceReach(ctx, row.filters, blockedIds)
          if (reach.ok) live.set(row.id, reach.value)
        }),
      )
      return { kind: 'data', data: audiencesData(rows, options, live) }
    },
  }),

  defineTool({
    name: 'ver_audiencia',
    description:
      'Una audiencia o lista contada ahora mismo: cuántos clientes son, a cuántos les llegaría una difusión hoy (los que aceptan promos) y qué difusiones programadas la usan.',
    input: z.object({
      audiencia: z.string().min(1).max(80).describe('Su nombre o id.'),
    }),
    need: { roles: OWNER_ROLES },
    doing: () => 'Contando la audiencia',
    done: () => 'Conté la audiencia',
    run: async (input, ctx) => {
      const [rows, options] = await Promise.all([
        listAudiences(ctx.tenantId),
        getAudienceBuilderOptions(ctx.tenantId),
      ])
      const match = matchByName(rows, input.audiencia)
      if (!match.ok) return fail(noMatchText(match, input.audiencia))
      const audience = match.value
      const [reach, scheduled] = await Promise.all([
        audienceReach(ctx, audience.filters),
        scheduledUsing(ctx, audience.id),
      ])
      if (!reach.ok) return fail(reach.message)
      const sentence = filterSentence(audience.filters, options)
      return {
        kind: 'data',
        data: {
          id: audience.id,
          nombre: audience.name,
          ...(sentence ? { quienes: sentence } : {}),
          clientes_hoy: reach.value.total,
          les_llegaria: reach.value.reach,
          quedan_afuera: reach.value.total - reach.value.reach,
          por_que_quedan_afuera: 'No aceptan promos o están en «No contactar».',
          ...(scheduled.length > 0 ? { difusiones_programadas: scheduled } : {}),
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_audiencia',
    description:
      'Prepara el alta o la edición de una audiencia o lista de clientes, por condiciones: los que no vienen hace 30 días, los frecuentes, los que cumplen este mes. Cuenta cuántos son. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      audiencia: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe('La que se edita: nombre o id. Sin esto, es un alta.'),
      nombre: z.string().trim().min(1).max(80).optional().describe('En un alta, obligatorio.'),
      condiciones: z
        .array(
          z.object({
            campo: z.enum(AUDIENCE_FIELD_WORDS),
            comparacion: z.enum(AUDIENCE_COMPARISONS).optional(),
            valor: z
              .union([z.number(), z.string(), z.boolean()])
              .optional()
              .describe(
                'Número; gasto_total en pesos; mes de 1 a 12; nivel, etiqueta y evento por nombre; acepta_promos true o false.',
              ),
          }),
        )
        .max(CONDITIONS_MAX)
        .optional()
        .describe(
          'Quiénes entran. Vacío: todos los clientes. En una edición, sin esto no cambian.',
        ),
      alguna: z
        .boolean()
        .optional()
        .describe('true: alcanza con cumplir alguna. Por defecto, todas.'),
    }),
    need: { roles: OWNER_ROLES },
    mood: 'working',
    doing: () => 'Preparando la audiencia',
    done: () => 'Preparé la audiencia',
    run: async (input, ctx) => {
      const [rows, options] = await Promise.all([
        listAudiences(ctx.tenantId),
        getAudienceBuilderOptions(ctx.tenantId),
      ])
      let existing: (typeof rows)[number] | null = null
      if (input.audiencia) {
        const match = matchByName(rows, input.audiencia)
        if (!match.ok) return fail(noMatchText(match, input.audiencia))
        existing = match.value
      } else {
        if (!input.nombre) return fail('Preguntale cómo quiere llamar a la audiencia.')
        if (input.condiciones === undefined) return fail('Preguntale quiénes entran en la lista.')
        const repeated = rows.find((row) => row.name.toLowerCase() === input.nombre?.toLowerCase())
        if (repeated) {
          return fail(
            `Ya hay una audiencia «${repeated.name}». Para cambiarla, mandá audiencia; si es otra, otro nombre.`,
          )
        }
      }

      let filter: AudienceFilter
      if (input.condiciones !== undefined) {
        const built = audienceFilter(input.condiciones, input.alguna === true, options)
        if (!built.ok) return fail(built.message)
        filter = built.filter
        const current = existing ? audienceFilterSchema.safeParse(existing.filters) : null
        if (current?.success && hasFixedList(current.data)) {
          return fail(
            `«${existing?.name}» tiene una lista fija de clientes y se perdería: se edita en su pantalla (ir_a a mensajeria.audiencia).`,
          )
        }
      } else {
        const current = audienceFilterSchema.safeParse(existing?.filters)
        if (!current.success) {
          return fail('No pude leer las condiciones de esa audiencia: se revisa en su pantalla.')
        }
        filter = current.data
      }

      const name = input.nombre ?? existing?.name ?? ''
      const payload = audiencePayload.safeParse({
        id: existing?.id ?? null,
        name,
        filters: filter,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))

      const [reach, scheduled] = await Promise.all([
        audienceReach(ctx, filter),
        existing ? scheduledUsing(ctx, existing.id) : Promise.resolve([]),
      ])
      if (!reach.ok) return fail(reach.message)
      return {
        kind: 'prepared',
        prepared: {
          executor: 'mensajeria.audiencia',
          payload: payload.data,
          ticket: audienceTicket({
            name,
            editing: existing !== null,
            sentence: filterSentence(filter, options) ?? 'Condiciones a medida.',
            reach: reach.value,
            scheduledNames: scheduled,
          }),
        },
      }
    },
  }),
]

export const audienciasExecutors: Readonly<Record<string, TexExecutor>> = {
  'mensajeria.audiencia': simpleExecutor(
    audiencePayload,
    async (payload, ctx) => {
      const form = formDataOf({
        ...(payload.id ? { id: payload.id } : {}),
        name: payload.name,
        filters: JSON.stringify(payload.filters),
      })
      const state = payload.id
        ? await updateAudience(ctx.slug, { ok: true }, form)
        : await createAudience(ctx.slug, { ok: true }, form)
      const id = state.ok ? (state.id ?? null) : null
      return actionState(state, `Guardé «${payload.name}».`, { id })
    },
    (data, payload, ctx) =>
      data.id
        ? placeOf(ctx, 'mensajeria.audiencia', { id: data.id })
        : placeOf(ctx, 'mensajeria.audiencias', {}, payload.name),
  ),
}
