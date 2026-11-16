import 'server-only'

import { z } from 'zod'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import {
  createTask,
  type MarketingActionState,
  postTaskUpdate,
  setTaskPeople,
  toggleRoutineCheck,
  updateTask,
} from '@/lib/marketing/actions'
import type { BoardGroup, BoardTask } from '@/lib/marketing/board'
import { STATUS_LABELS, TASK_STATUSES } from '@/lib/marketing/constants'
import { listMarketingTeam, listRoutinesForWeek, loadTaskBoard } from '@/lib/marketing/queries'
import {
  postUpdateSchema,
  routineCheckSchema,
  taskPatchSchema,
  taskTitleSchema,
} from '@/lib/marketing/schemas'
import { isIsoDay, weekStartOf } from '@/lib/marketing/week'
import { MARKETING_TASK_ROLES } from '@/lib/tenant/roles'
import { simpleExecutor } from '../../simple-action'
import { matchByName, noMatchText } from '../actions/_gastos-values'
import {
  dayField,
  defineTool,
  type TexExecutor,
  type TexToolContext,
  zodIssuesText,
} from '../types'
import { actionState, fail, maskedContactProblem, placeOf } from './_common'
import {
  doneNote,
  editTaskTicket,
  filterTasks,
  groupForNewTask,
  groupOfTask,
  NO_DUE,
  newTaskFacts,
  newTaskTicket,
  notesValue,
  orderedGroups,
  peopleChange,
  peopleIds,
  personOf,
  pickGroup,
  pickTask,
  routineSlot,
  routinesData,
  routineTicket,
  STATUS_OF_WORD,
  STATUS_WORDS,
  shownTitle,
  type TaskFacts,
  taskFactsOf,
  taskPatchOf,
  taskStatusTicket,
  tasksData,
  taskUpdateTicket,
  WHEN_WORDS,
} from './_task-values'

/**
 * El tablero de tareas de marketing (estilo Monday) y la rutina de la semana. Las usan los que trabajan
 * el tablero (dueños, Contenido y anfitriona), como su pantalla, sus acciones y su RLS. Los grupos y las
 * rutinas los arma el dueño en la pantalla: acá no se tocan.
 */

const NOT_A_DAY = 'Esa fecha no existe: preguntale cuál es.'

const taskRef = z.string().trim().min(1).max(160)

const peopleField = (who: string) =>
  z
    .array(z.string().trim().min(1).max(80))
    .min(1)
    .max(10)
    .optional()
    .describe(`${who}: nombres o «yo». Es la lista entera; ["nadie"] la vacía.`)

const peopleSchema = z.array(z.uuid()).max(20)

/** Alta: `createTask` y, si hace falta, lo demás. Edición: solo lo que cambia. */
const taskPayload = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('create'),
    groupId: z.uuid(),
    title: taskTitleSchema,
    patch: taskPatchSchema.nullable(),
    responsibleIds: peopleSchema.nullable(),
    involvedIds: peopleSchema.nullable(),
  }),
  z.object({
    mode: z.literal('edit'),
    id: z.uuid(),
    /** Para señalarla al terminar: el título que queda. */
    title: taskTitleSchema,
    patch: taskPatchSchema.nullable(),
    responsibleIds: peopleSchema.nullable(),
    involvedIds: peopleSchema.nullable(),
  }),
])
type TaskPayload = z.infer<typeof taskPayload>

const statusPayload = z.object({
  id: z.uuid(),
  status: z.enum(TASK_STATUSES),
  title: z.string().min(1).max(160),
})

const updatePayload = z.object({
  taskId: z.uuid(),
  body: z.string().trim().min(1).max(10000),
  title: z.string().min(1).max(160),
})

const routinePayload = routineCheckSchema.extend({ title: z.string() })

type Saved = AccSimpleState<{ id: string }>

const failure = (message: string): Saved => ({ ok: false, code: 'error', message })

/** Las acciones de siempre, en orden. Si algo falla después de crearla, se dice qué quedó. */
async function saveTask(payload: TaskPayload, ctx: TexToolContext): Promise<Saved> {
  let id: string
  if (payload.mode === 'create') {
    const created = await createTask(ctx.slug, { groupId: payload.groupId, title: payload.title })
    if (!created.ok) return failure(created.message)
    id = created.data.task.id
  } else {
    id = payload.id
  }

  const steps: Array<{ what: string; run: () => Promise<MarketingActionState> }> = []
  const { patch, responsibleIds, involvedIds } = payload
  if (patch) {
    steps.push({
      what: 'ponerle el estado, el vencimiento o las notas',
      run: () => updateTask(ctx.slug, { id, patch }),
    })
  }
  if (responsibleIds) {
    steps.push({
      what: 'poner a los responsables',
      run: () =>
        setTaskPeople(ctx.slug, { taskId: id, role: 'responsible', userIds: responsibleIds }),
    })
  }
  if (involvedIds) {
    steps.push({
      what: 'poner a los involucrados',
      run: () => setTaskPeople(ctx.slug, { taskId: id, role: 'involved', userIds: involvedIds }),
    })
  }

  let saved = payload.mode === 'create'
  for (const step of steps) {
    const state = await step.run()
    if (!state.ok) {
      if (!saved) return failure(state.message)
      const head = payload.mode === 'create' ? 'Creé la tarea' : 'Guardé una parte'
      return failure(`${head}, pero no pude ${step.what}: ${state.message}`)
    }
    saved = true
  }
  return {
    ok: true,
    data: { id },
    message: payload.mode === 'create' ? 'Tarea creada.' : 'Tarea guardada.',
  }
}

export const tareasTools = [
  defineTool({
    name: 'ver_tareas',
    description:
      'Las tareas de marketing del tablero: grupo, estado, quién la lleva, cuándo vence y si tiene actualizaciones o archivos. Filtra por grupo, estado, persona, vencimiento o texto. Para «qué tengo que hacer» o «qué está vencido».',
    input: z.object({
      grupo: z.string().trim().min(1).max(60).optional().describe('Su nombre.'),
      estado: z.enum(STATUS_WORDS).optional().describe('Sin esto, las que no están terminadas.'),
      persona: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('Responsable o involucrada; «yo»; «nadie»: sin responsable.'),
      cuando: z.enum(WHEN_WORDS).optional().describe('Por el vencimiento.'),
      texto: z.string().trim().min(1).max(60).optional().describe('En el título o las notas.'),
      con_terminadas: z.boolean().optional(),
    }),
    need: { roles: MARKETING_TASK_ROLES },
    doing: () => 'Mirando las tareas',
    done: () => 'Miré las tareas',
    run: async (input, ctx) => {
      const [board, team] = await Promise.all([
        loadTaskBoard(ctx.tenantId),
        listMarketingTeam(ctx.tenantId),
      ])
      let groupId: string | undefined
      if (input.grupo) {
        const group = pickGroup(board.groups, input.grupo)
        if (!group.ok) return fail(group.message)
        groupId = group.value.id
      }
      let personId: string | null | undefined
      if (input.persona) {
        const person = personOf(team, input.persona, ctx.userId)
        if (!person.ok) return fail(person.message)
        personId = person.value
      }
      const status = input.estado ? STATUS_OF_WORD[input.estado] : undefined
      const includeDone = input.con_terminadas === true
      const found = filterTasks(
        board.tasks,
        board.groups,
        { groupId, status, personId, when: input.cuando, text: input.texto, includeDone },
        ctx.today,
      )
      const data = tasksData(found, board.groups, team, ctx.today)
      const loadedDone = board.tasks.filter((task) => task.status === 'done').length
      const note = includeDone || status === 'done' ? doneNote(board.doneTotal, loadedDone) : null
      return { kind: 'data', data: note ? { ...data, terminadas: note } : data }
    },
  }),

  defineTool({
    name: 'ver_checklist_organico',
    description:
      'La rutina de la semana (el checklist de Orgánico: historias, reels, lo que se repite todas las semanas): qué se hizo y qué falta. Si no se dice la semana, esta.',
    input: z.object({
      semana: dayField('Cualquier día de esa semana, yyyy-MM-dd.').optional(),
    }),
    need: { roles: MARKETING_TASK_ROLES },
    doing: () => 'Mirando la rutina',
    done: () => 'Miré la rutina',
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
      'Prepara el alta o la edición de una tarea de marketing: título, grupo, estado, responsables, involucrados, vencimiento y notas. Una edición cambia solo lo que se dice. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      tarea: taskRef.optional().describe('La que se edita: su título o id. Sin esto, es un alta.'),
      titulo: taskTitleSchema.optional().describe('En un alta, obligatorio.'),
      grupo: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .optional()
        .describe('Su nombre. En un alta, si hay varios y no lo dijo, preguntá.'),
      estado: z.enum(STATUS_WORDS).optional().describe('En un alta, por_hacer si no lo dijo.'),
      responsables: peopleField('De quién es'),
      involucrados: peopleField('Quién más está metido'),
      vencimiento: z
        .string()
        .regex(/^(\d{4}-\d{2}-\d{2}|sin_fecha)$/)
        .optional()
        .describe('yyyy-MM-dd; «sin_fecha» lo saca.'),
      notas: z
        .string()
        .max(4000)
        .optional()
        .describe(
          'Reemplazan las que tiene; vacío las borra. Un comentario va con preparar_actualizacion_tarea.',
        ),
    }),
    need: { roles: MARKETING_TASK_ROLES },
    mood: 'working',
    doing: () => 'Preparando la tarea',
    done: () => 'Preparé la tarea',
    run: async (input, ctx) => {
      if (input.vencimiento && input.vencimiento !== NO_DUE && !isIsoDay(input.vencimiento)) {
        return fail(NOT_A_DAY)
      }
      const masked = maskedContactProblem(input.titulo) ?? maskedContactProblem(input.notas)
      if (masked) return fail(masked)
      if (!input.tarea && !input.titulo) return fail('Preguntale qué hay que hacer.')

      const [board, team] = await Promise.all([
        loadTaskBoard(ctx.tenantId),
        listMarketingTeam(ctx.tenantId),
      ])

      // Una edición parte de lo que la tarea tiene hoy; un alta, de lo que pone el tablero.
      let task: BoardTask | null = null
      let target: BoardGroup | null = null
      let before: TaskFacts
      if (input.tarea) {
        const match = pickTask(board.tasks, board.groups, input.tarea)
        if (!match.ok) return fail(match.message)
        task = match.value
        if (input.grupo) {
          const group = pickGroup(board.groups, input.grupo)
          if (!group.ok) return fail(group.message)
          target = group.value
        }
        before = taskFactsOf(task, board.groups)
      } else {
        const group = groupForNewTask(board.groups, input.grupo)
        if (!group.ok) return fail(group.message)
        target = group.value
        before = newTaskFacts(input.titulo ?? '', target)
      }

      let responsibleIds: string[] | undefined
      if (input.responsables) {
        const people = peopleIds(team, input.responsables, ctx.userId)
        if (!people.ok) return fail(people.message)
        responsibleIds = people.value
      }
      let involvedIds: string[] | undefined
      if (input.involucrados) {
        const people = peopleIds(team, input.involucrados, ctx.userId)
        if (!people.ok) return fail(people.message)
        involvedIds = people.value
      }

      const after: TaskFacts = {
        title: input.titulo ?? before.title,
        groupId: target?.id ?? before.groupId,
        groupName: target?.name ?? before.groupName,
        status: input.estado ? STATUS_OF_WORD[input.estado] : before.status,
        dueDate:
          input.vencimiento === undefined
            ? before.dueDate
            : input.vencimiento === NO_DUE
              ? null
              : input.vencimiento,
        notes: input.notas === undefined ? before.notes : notesValue(input.notas),
        responsibleIds: responsibleIds ?? before.responsibleIds,
        involvedIds: involvedIds ?? before.involvedIds,
      }

      const patch = taskPatchOf(before, after)
      const people = {
        responsibleIds: peopleChange(before.responsibleIds, after.responsibleIds),
        involvedIds: peopleChange(before.involvedIds, after.involvedIds),
      }
      if (task && !patch && !people.responsibleIds && !people.involvedIds) {
        return fail(`«${shownTitle(task)}» ya está así: no hay nada para cambiar.`)
      }

      const payload = taskPayload.safeParse(
        task
          ? { mode: 'edit', id: task.id, title: after.title, patch, ...people }
          : { mode: 'create', groupId: after.groupId, title: after.title, patch, ...people },
      )
      if (!payload.success) {
        return fail(payload.error.issues[0]?.message ?? zodIssuesText(payload.error))
      }
      return {
        kind: 'prepared',
        prepared: {
          executor: 'marketing.tarea',
          payload: payload.data,
          ticket: task
            ? editTaskTicket(before, after, team, ctx.today)
            : newTaskTicket(after, team, ctx.today),
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_estado_tarea',
    description:
      'Prepara cambiar el estado de una tarea de marketing: terminarla, reabrirla o pasarla a en curso, interrumpida, backlog o esperando feedback. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      tarea: taskRef.describe('Su título o id.'),
      estado: z.enum(STATUS_WORDS),
    }),
    need: { roles: MARKETING_TASK_ROLES },
    mood: 'working',
    doing: () => 'Preparando el cambio de estado',
    done: () => 'Preparé el cambio de estado',
    run: async (input, ctx) => {
      const board = await loadTaskBoard(ctx.tenantId)
      const match = pickTask(board.tasks, board.groups, input.tarea)
      if (!match.ok) return fail(match.message)
      const task = match.value
      const status = STATUS_OF_WORD[input.estado]
      if (task.status === status) {
        return fail(`«${shownTitle(task)}» ya está en ${STATUS_LABELS[status]}.`)
      }
      const payload = statusPayload.safeParse({ id: task.id, status, title: task.title })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      const group = groupOfTask(task, orderedGroups(board.groups))?.name ?? 'Sin grupo'
      return {
        kind: 'prepared',
        prepared: {
          executor: 'marketing.estado_tarea',
          payload: payload.data,
          ticket: taskStatusTicket(task, group, status),
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_actualizacion_tarea',
    description:
      'Prepara dejar una actualización en el hilo de una tarea de marketing, como en Monday: lo entregado, una duda, un aviso. Solo texto: los archivos se suben en su panel. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      tarea: taskRef.describe('Su título o id.'),
      texto: z.string().trim().min(1).max(4000).describe('Lo que queda escrito, tal cual.'),
    }),
    need: { roles: MARKETING_TASK_ROLES },
    mood: 'working',
    doing: () => 'Preparando la actualización',
    done: () => 'Preparé la actualización',
    run: async (input, ctx) => {
      const masked = maskedContactProblem(input.texto)
      if (masked) return fail(masked)
      const board = await loadTaskBoard(ctx.tenantId)
      const match = pickTask(board.tasks, board.groups, input.tarea)
      if (!match.ok) return fail(match.message)
      const task = match.value
      // Lo mismo que valida la acción, para que el tique no prometa algo que después no entra.
      const check = postUpdateSchema.safeParse({ taskId: task.id, body: input.texto, files: [] })
      if (!check.success) return fail(zodIssuesText(check.error))
      const payload = updatePayload.safeParse({
        taskId: task.id,
        body: check.data.body,
        title: task.title,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'marketing.actualizacion_tarea',
          payload: payload.data,
          ticket: taskUpdateTicket(task, payload.data.body),
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_tilde_rutina',
    description:
      'Prepara tildar o destildar una rutina de la semana (el checklist de Orgánico): ya subí la historia, ya publiqué el reel. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      rutina: z.string().min(1).max(160).describe('Su nombre o id.'),
      hecho: z.boolean().optional().describe('false: destildar. Por defecto, tildar.'),
      semana: dayField('Cualquier día de esa semana, yyyy-MM-dd. Sin esto, esta.').optional(),
    }),
    need: { roles: MARKETING_TASK_ROLES },
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

/** Después de guardar, el panel de esa tarea: ahí se ve lo que quedó. */
const onBoard = (ctx: Pick<TexToolContext, 'slug'>, taskId: string, title: string) =>
  placeOf(ctx, 'marketing.tareas', { tarea: taskId }, title)

export const tareasExecutors: Readonly<Record<string, TexExecutor>> = {
  'marketing.tarea': simpleExecutor(taskPayload, saveTask, (data, payload, ctx) =>
    onBoard(ctx, data.id, payload.title),
  ),

  'marketing.estado_tarea': simpleExecutor(
    statusPayload,
    async (payload, ctx) => {
      const state = await updateTask(ctx.slug, {
        id: payload.id,
        patch: { status: payload.status },
      })
      const message =
        payload.status === 'done'
          ? 'Listo, quedó terminada.'
          : `Listo, quedó en ${STATUS_LABELS[payload.status]}.`
      return actionState(state, message, { id: payload.id })
    },
    (data, payload, ctx) => onBoard(ctx, data.id, payload.title),
  ),

  'marketing.actualizacion_tarea': simpleExecutor(
    updatePayload,
    async (payload, ctx): Promise<Saved> => {
      const state = await postTaskUpdate(ctx.slug, { taskId: payload.taskId, body: payload.body })
      return state.ok
        ? { ok: true, data: { id: payload.taskId }, message: 'Listo, quedó en la tarea.' }
        : failure(state.message)
    },
    (data, payload, ctx) => onBoard(ctx, data.id, payload.title),
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
