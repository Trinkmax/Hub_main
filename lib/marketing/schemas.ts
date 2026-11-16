import { z } from 'zod'
import { GROUP_COLORS, TASK_PERSON_ROLES, TASK_STATUSES } from './constants'
import { MAX_FILES_PER_BATCH, MAX_TASK_FILE_BYTES } from './files'

/**
 * Bordes del tablero de tareas (estilo Monday). Cada cambio del tablero es una
 * action chica y optimista (el título, el estado, una persona…), así que cada
 * una tiene su schema. Los textos de error salen tal cual en un toast.
 */

const id = z.uuid('ID inválido')

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Fecha inválida')

export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, 'Escribí qué hay que hacer')
  .max(160, 'El título no puede superar 160 caracteres')

/** Notas: vacío → null (la DB nunca ve un string vacío disfrazado de dato). */
export const taskNotesSchema = z
  .union([z.string(), z.null()])
  .transform((value) => {
    const text = typeof value === 'string' ? value.trim() : ''
    return text.length === 0 ? null : text
  })
  .refine((value) => value === null || value.length <= 10000, 'Las notas son demasiado largas')

// ──────────────────────────────────────────────
// Tareas
// ──────────────────────────────────────────────

export const createTaskSchema = z.object({
  groupId: id,
  title: taskTitleSchema,
  where: z.enum(['top', 'bottom']).default('bottom'),
})

export const taskPatchSchema = z
  .object({
    title: taskTitleSchema.optional(),
    status: z.enum(TASK_STATUSES).optional(),
    dueDate: z.union([isoDay, z.null()]).optional(),
    notes: taskNotesSchema.optional(),
    groupId: id.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'No hay nada para cambiar',
  })

export const updateTaskSchema = z.object({
  id,
  patch: taskPatchSchema,
})

export const setTaskPeopleSchema = z.object({
  taskId: id,
  role: z.enum(TASK_PERSON_ROLES),
  userIds: z.array(id).max(20, 'Demasiadas personas'),
})

export const reorderTasksSchema = z.object({
  groupId: id,
  ids: z.array(id).min(1).max(1000),
})

// ──────────────────────────────────────────────
// Grupos
// ──────────────────────────────────────────────

export const groupNameSchema = z
  .string()
  .trim()
  .min(1, 'Ponele un nombre al grupo')
  .max(60, 'El nombre no puede superar 60 caracteres')

export const createGroupSchema = z.object({
  name: groupNameSchema,
  color: z.enum(GROUP_COLORS),
})

export const updateGroupSchema = z
  .object({
    id,
    name: groupNameSchema.optional(),
    color: z.enum(GROUP_COLORS).optional(),
  })
  .refine((value) => value.name !== undefined || value.color !== undefined, {
    message: 'No hay nada para cambiar',
  })

export const reorderGroupsSchema = z.object({
  ids: z.array(id).min(1).max(100),
})

// ──────────────────────────────────────────────
// Actualizaciones y archivos
// ──────────────────────────────────────────────

export const updateBodySchema = z
  .string()
  .max(10000, 'La actualización es demasiado larga')
  .transform((value) => value.trim())

const uploadedFileSchema = z.object({
  path: z.string().min(1).max(200),
  fileName: z.string().min(1).max(400),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().min(1).max(MAX_TASK_FILE_BYTES),
})

export type UploadedTaskFile = z.infer<typeof uploadedFileSchema>

export const postUpdateSchema = z
  .object({
    taskId: id,
    body: updateBodySchema,
    files: z.array(uploadedFileSchema).max(MAX_FILES_PER_BATCH).default([]),
  })
  .refine((value) => value.body.length > 0 || value.files.length > 0, {
    message: 'Escribí algo o sumá un archivo',
  })

export const editUpdateSchema = z.object({
  id,
  body: updateBodySchema.refine((value) => value.length > 0, 'Escribí algo'),
})

export const prepareUploadsSchema = z.object({
  taskId: id,
  files: z
    .array(
      z.object({
        fileName: z.string().min(1).max(400),
        mimeType: z.string().min(1).max(120),
        sizeBytes: z.number().int().min(1).max(MAX_TASK_FILE_BYTES),
      }),
    )
    .min(1)
    .max(MAX_FILES_PER_BATCH),
})

export const registerFilesSchema = z.object({
  taskId: id,
  files: z.array(uploadedFileSchema).min(1).max(MAX_FILES_PER_BATCH),
})

/**
 * Link al material. Solo http/https: un `javascript:` acá terminaría en un
 * `<a href>` del panel.
 */
export const addLinkSchema = z.object({
  taskId: id,
  url: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/i, 'El link tiene que empezar con http:// o https://')
    .max(2000, 'El link es demasiado largo'),
  title: z
    .string()
    .trim()
    .max(160, 'El nombre es demasiado largo')
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
})

// ──────────────────────────────────────────────
// Rutina de la semana (Orgánico)
// ──────────────────────────────────────────────

/** `'' | null | undefined` → null; cualquier otra cosa → string recortado. */
const optionalText = z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length === 0 ? null : text
})

export const routineUpsertSchema = z.object({
  id: z.uuid('ID inválido').nullable().optional(),
  title: z
    .string()
    .trim()
    .min(1, 'Poné un nombre')
    .max(160, 'El nombre no puede superar 160 caracteres'),
  description: optionalText.refine(
    (value) => value === null || value.length <= 400,
    'No puede superar 400 caracteres',
  ),
  slots: z.coerce
    .number()
    .int('Tiene que ser un número entero')
    .min(1, 'Al menos 1 vez por semana')
    .max(14, 'Máximo 14 veces por semana'),
})

export const routineCheckSchema = z.object({
  routine_id: z.uuid('ID inválido'),
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Semana inválida'),
  slot: z.coerce.number().int().min(0).max(13),
  done: z.boolean(),
})

export type CreateTaskInput = z.input<typeof createTaskSchema>
export type TaskPatch = z.input<typeof taskPatchSchema>
export type RoutineUpsert = z.infer<typeof routineUpsertSchema>
export type RoutineCheck = z.infer<typeof routineCheckSchema>
