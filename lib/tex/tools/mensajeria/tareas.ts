import 'server-only'

import { z } from 'zod'
import {
  createMarketingTask,
  setMarketingTaskStatus,
  toggleRoutineCheck,
  updateMarketingTask,
} from '@/lib/marketing/actions'
import type { TaskCategory, TaskStatus } from '@/lib/marketing/constants'
import { listMarketingTasks, listMarketingTeam, listRoutinesForWeek } from '@/lib/marketing/queries'
import {
  marketingTaskCreateSchema,
  marketingTaskStatusSchema,
  routineCheckSchema,
} from '@/lib/marketing/schemas'
import { isIsoDay, weekStartOf } from '@/lib/marketing/week'
import { simpleExecutor } from '../../simple-action'
import { matchByName, noMatchText } from '../actions/_gastos-values'
import {
  dayField,
  defineTool,
  type TexExecutor,
  type TexToolContext,
  zodIssuesText,
} from '../types'
import {
  actionState,
  fail,
  formDataOf,
  maskedContactProblem,
  OWNER_ROLES,
  placeOf,
} from './_common'
import {
  BUCKET_OF_WORD,
  BUCKET_WORDS,
  CATEGORY_SCREEN,
  CATEGORY_WORDS,
  filterTasks,
  KIND_OF_WORD,
  KIND_WORDS,
  routineSlot,
  routinesData,
  routineTicket,
  STATUS_OF_WORD,
  STATUS_WORDS,
  type TaskValues,
  taskStatusTicket,
  tasksData,
  taskTicket,
  taskValuesOf,
} from './_task-values'

/** Las tareas de marketing y el checklist semanal de Orgánico. Owner-only, como su pantalla y su RLS. */

const NOT_A_DAY = 'Esa fecha no existe: preguntale cuál es.'

const personField = (what: string) =>
  z.string().min(1).max(80).optional().describe(`${what}: el nombre o «yo». «nadie» lo saca.`)

const taskPayload = marketingTaskCreateSchema.extend({ id: z.uuid().nullable() })

const statusPayload = marketingTaskStatusSchema.extend({
  title: z.string(),
  category: z.enum(CATEGORY_WORDS),
})

const routinePayload = routineCheckSchema.extend({ title: z.string() })

/** Una persona del equipo: «yo» es quien habla; «nadie» deja el lugar vacío. */
async function personOf(
  ctx: TexToolContext,
  team: Awaited<ReturnType<typeof listMarketingTeam>>,
  wanted: string,
): Promise<{ ok: true; id: string | null } | { ok: false; message: string }> {
  const key = wanted.trim().toLowerCase()
  if (key === 'yo') return { ok: true, id: ctx.userId }
  if (key === 'nadie') return { ok: true, id: null }
  const match = matchByName(team, wanted)
  return match.ok
    ? { ok: true, id: match.value.id }
    : { ok: false, message: noMatchText(match, wanted) }
}

export const tareasTools = [
  defineTool({
    name: 'ver_tareas',
    description:
      'Las tareas de marketing del tablero: qué hay que hacer, quién y para cuándo. Filtra por sección, estado, persona o fecha. Usala para «qué tareas tengo» o «qué está atrasado».',
    input: z.object({
      seccion: z.enum(CATEGORY_WORDS).optional(),
      estado: z.enum(STATUS_WORDS).optional().describe('Sin esto, las que no están terminadas.'),
      persona: z.string().min(1).max(80).optional().describe('Responsable o involucrado; «yo».'),
      cuando: z.enum(BUCKET_WORDS).optional(),
      texto: z.string().min(1).max(60).optional().describe('En el título o el detalle.'),
      con_terminadas: z.boolean().optional(),
    }),
    need: { roles: OWNER_ROLES },
    doing: () => 'Mirando las tareas',
    done: () => 'Miré las tareas',
    run: async (input, ctx) => {
      const [tasks, team] = await Promise.all([
        listMarketingTasks(ctx.tenantId),
        listMarketingTeam(ctx.tenantId),
      ])
      let personId: string | undefined
      if (input.persona) {
        const person = await personOf(ctx, team, input.persona)
        if (!person.ok) return fail(person.message)
        personId = person.id ?? undefined
      }
      const found = filterTasks(
        tasks,
        {
          category: input.seccion,
          status: input.estado ? STATUS_OF_WORD[input.estado] : undefined,
          personId,
          bucket: input.cuando ? BUCKET_OF_WORD[input.cuando] : undefined,
          text: input.texto,
          includeDone: input.con_terminadas === true,
        },
        ctx.today,
      )
      return { kind: 'data', data: tasksData(found, team, ctx.today) }
    },
  }),

  defineTool({
    name: 'ver_checklist_organico',
    description:
      'El checklist semanal de Orgánico (historias, reels, lo que se repite todas las semanas): qué se hizo y qué falta. Si no se dice la semana, esta.',
    input: z.object({
      semana: dayField('Cualquier día de esa semana, yyyy-MM-dd.').optional(),
    }),
    need: { roles: OWNER_ROLES },
    doing: () => 'Mirando el checklist',
    done: () => 'Miré el checklist',
    run: async (input, ctx) => {
      if (input.semana && !isIsoDay(input.semana)) return fail(NOT_A_DAY)
      const weekStart = weekStartOf(input.semana ?? ctx.today)
      const routines = await listRoutinesForWeek(ctx.tenantId, weekStart)
      return { kind: 'data', data: routinesData(routines, weekStart) }
    },
  }),

  defineTool({
    name: 'preparar_tarea',
    description:
      'Prepara el alta o la edición de una tarea de marketing: qué hay que hacer, sección, responsable y fechas. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      tarea: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('La que se edita: título o id. Sin esto, es un alta.'),
      titulo: z.string().trim().min(1).max(160).optional().describe('En un alta, obligatorio.'),
      seccion: z.enum(CATEGORY_WORDS).optional().describe('En un alta, obligatoria.'),
      tipo: z.enum(KIND_WORDS).optional().describe('Si no lo dijo, otro.'),
      estado: z.enum(STATUS_WORDS).optional().describe('Si no lo dijo, por_hacer.'),
      responsable: personField('Quién la hace'),
      involucrado: personField('Quién más'),
      fecha_ideal: dayField('Cuándo estaría bueno que salga, yyyy-MM-dd.').optional(),
      fecha_definida: dayField(
        'Cuando ya hay compromiso, yyyy-MM-dd. Manda sobre la ideal.',
      ).optional(),
      especificaciones: z.string().trim().max(2000).optional(),
      comentarios: z.string().trim().max(4000).optional(),
      link: z.string().trim().max(2000).optional().describe('El link del material: http(s).'),
    }),
    need: { roles: OWNER_ROLES },
    mood: 'working',
    doing: () => 'Preparando la tarea',
    done: () => 'Preparé la tarea',
    run: async (input, ctx) => {
      for (const day of [input.fecha_ideal, input.fecha_definida]) {
        if (day && !isIsoDay(day)) return fail(NOT_A_DAY)
      }
      const masked =
        maskedContactProblem(input.especificaciones) ?? maskedContactProblem(input.comentarios)
      if (masked) return fail(masked)
      const [tasks, team] = await Promise.all([
        listMarketingTasks(ctx.tenantId),
        listMarketingTeam(ctx.tenantId),
      ])
      let existing: (typeof tasks)[number] | null = null
      if (input.tarea) {
        const match = matchByName(
          tasks.map((task) => ({ ...task, name: task.title })),
          input.tarea,
        )
        if (!match.ok) return fail(noMatchText(match, input.tarea))
        existing = match.value
      } else {
        if (!input.titulo) return fail('Preguntale qué hay que hacer.')
        if (!input.seccion) {
          return fail('Preguntale de qué sección es: Eventos, Promociones o Impresiones.')
        }
      }

      const base: TaskValues = existing
        ? taskValuesOf(existing)
        : {
            title: input.titulo ?? '',
            category: input.seccion as TaskCategory,
            kind: 'other',
            status: 'todo',
            specifications: null,
            notes: null,
            file_url: null,
            responsible_user_id: null,
            involved_user_id: null,
            ideal_date: null,
            defined_date: null,
          }
      const values: TaskValues = {
        ...base,
        title: input.titulo ?? base.title,
        category: input.seccion ?? base.category,
        kind: input.tipo ? KIND_OF_WORD[input.tipo] : base.kind,
        status: input.estado ? STATUS_OF_WORD[input.estado] : base.status,
        specifications: input.especificaciones ?? base.specifications,
        notes: input.comentarios ?? base.notes,
        file_url: input.link ?? base.file_url,
        ideal_date: input.fecha_ideal ?? base.ideal_date,
        defined_date: input.fecha_definida ?? base.defined_date,
      }
      if (input.responsable) {
        const person = await personOf(ctx, team, input.responsable)
        if (!person.ok) return fail(person.message)
        values.responsible_user_id = person.id
      }
      if (input.involucrado) {
        const person = await personOf(ctx, team, input.involucrado)
        if (!person.ok) return fail(person.message)
        values.involved_user_id = person.id
      }

      const payload = taskPayload.safeParse({ ...values, id: existing?.id ?? null })
      if (!payload.success) {
        return fail(payload.error.issues[0]?.message ?? zodIssuesText(payload.error))
      }
      const nameOf = (id: string | null) => team.find((member) => member.id === id)?.name ?? null
      return {
        kind: 'prepared',
        prepared: {
          executor: 'marketing.tarea',
          payload: payload.data,
          ticket: taskTicket(payload.data, {
            editing: existing !== null,
            responsible: nameOf(payload.data.responsible_user_id),
            involved: nameOf(payload.data.involved_user_id),
          }),
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_estado_tarea',
    description:
      'Prepara cambiar el estado de una tarea de marketing: completarla, marcarla terminada, en proceso o interrumpida. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      tarea: z.string().min(1).max(160).describe('Su título o id.'),
      estado: z.enum(STATUS_WORDS),
    }),
    need: { roles: OWNER_ROLES },
    mood: 'working',
    doing: () => 'Preparando el cambio de estado',
    done: () => 'Preparé el cambio de estado',
    run: async (input, ctx) => {
      const tasks = await listMarketingTasks(ctx.tenantId)
      const match = matchByName(
        tasks.map((task) => ({ ...task, name: task.title })),
        input.tarea,
      )
      if (!match.ok) return fail(noMatchText(match, input.tarea))
      const task = match.value
      const status: TaskStatus = STATUS_OF_WORD[input.estado]
      if (task.status === status) return fail(`«${task.title}» ya está en ese estado.`)
      const payload = statusPayload.safeParse({
        id: task.id,
        status,
        title: task.title,
        category: task.category,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'marketing.estado_tarea',
          payload: payload.data,
          ticket: taskStatusTicket(task, status),
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_tilde_rutina',
    description:
      'Prepara tildar o destildar una rutina del checklist semanal de Orgánico: ya subí la historia, ya publiqué el reel. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      rutina: z.string().min(1).max(160).describe('Su nombre o id.'),
      hecho: z.boolean().optional().describe('false: destildar. Por defecto, tildar.'),
      semana: dayField('Cualquier día de esa semana, yyyy-MM-dd. Sin esto, esta.').optional(),
    }),
    need: { roles: OWNER_ROLES },
    mood: 'working',
    doing: () => 'Preparando el tilde',
    done: () => 'Preparé el tilde',
    run: async (input, ctx) => {
      if (input.semana && !isIsoDay(input.semana)) return fail(NOT_A_DAY)
      const weekStart = weekStartOf(input.semana ?? ctx.today)
      const routines = await listRoutinesForWeek(ctx.tenantId, weekStart)
      const match = matchByName(
        routines.map((routine) => ({ ...routine, name: routine.title })),
        input.rutina,
      )
      if (!match.ok) return fail(noMatchText(match, input.rutina))
      const routine = match.value
      const done = input.hecho !== false
      const slot = routineSlot(routine, done)
      if (slot === null) {
        return fail(
          done
            ? `«${routine.title}» ya está completa esta semana: ${routine.slots} de ${routine.slots}.`
            : `«${routine.title}» no tiene nada tildado esa semana.`,
        )
      }
      const payload = routinePayload.safeParse({
        routine_id: routine.id,
        week_start: weekStart,
        slot,
        done,
        title: routine.title,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'marketing.rutina',
          payload: payload.data,
          ticket: routineTicket(routine, done, weekStart),
        },
      }
    },
  }),
]

export const tareasExecutors: Readonly<Record<string, TexExecutor>> = {
  'marketing.tarea': simpleExecutor(
    taskPayload,
    async (payload, ctx) => {
      const { id, ...values } = payload
      const form = formDataOf({ ...values, ...(id ? { id } : {}) })
      const state = id
        ? await updateMarketingTask(ctx.slug, { ok: true }, form)
        : await createMarketingTask(ctx.slug, { ok: true }, form)
      return actionState(state, id ? 'Tarea actualizada.' : 'Tarea creada.', undefined)
    },
    (_data, payload, ctx) => placeOf(ctx, CATEGORY_SCREEN[payload.category], {}, payload.title),
  ),

  'marketing.estado_tarea': simpleExecutor(
    statusPayload,
    async (payload, ctx) => {
      const state = await setMarketingTaskStatus(ctx.slug, {
        id: payload.id,
        status: payload.status,
      })
      return actionState(state, 'Listo, cambié el estado.', undefined)
    },
    (_data, payload, ctx) => placeOf(ctx, CATEGORY_SCREEN[payload.category], {}, payload.title),
  ),

  'marketing.rutina': simpleExecutor(
    routinePayload,
    async (payload, ctx) => {
      const state = await toggleRoutineCheck(ctx.slug, {
        routineId: payload.routine_id,
        weekStart: payload.week_start,
        slot: payload.slot,
        done: payload.done,
      })
      return actionState(state, payload.done ? 'Listo, tildado.' : 'Listo, destildado.', undefined)
    },
    (_data, payload, ctx) =>
      placeOf(ctx, 'marketing.tareas_organico', { semana: payload.week_start }, payload.title),
  ),
}
