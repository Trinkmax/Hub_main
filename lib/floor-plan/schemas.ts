import { z } from 'zod'

export const KIND = z.enum(['table', 'wall', 'pillar', 'island', 'bar'])
export const SHAPE = z.enum(['rect', 'circle'])

export const areaCreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  number_start: z.coerce.number().int().min(0).max(100000).default(1),
})

export const areaRenameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
})

export const areaCanvasSchema = z.object({
  id: z.string().uuid(),
  width: z.coerce.number().int().min(200).max(6000),
  height: z.coerce.number().int().min(200).max(6000),
  number_start: z.coerce.number().int().min(0).max(100000),
})

export const areaReorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
})

export const elementGeometrySchema = z.object({
  id: z.string().uuid(),
  x: z.number().int().min(-10000).max(10000),
  y: z.number().int().min(-10000).max(10000),
  width: z.number().int().min(8).max(6000),
  height: z.number().int().min(8).max(6000),
  z_index: z.number().int(),
})

export const geometryBatchSchema = z.object({
  items: z.array(elementGeometrySchema).min(1).max(500),
})

export const createTableInPlanSchema = z.object({
  area_id: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
  capacity: z.coerce.number().int().min(1).max(50).nullable(),
  shape: SHAPE.default('rect'),
  x: z.number().int(),
  y: z.number().int(),
})

export const placeTableSchema = z.object({
  table_id: z.string().uuid(),
  area_id: z.string().uuid(),
  x: z.number().int(),
  y: z.number().int(),
})

export const splitTableSchema = z.object({
  source_element_id: z.string().uuid(),
})

export const mergeTablesSchema = z.object({
  survivor_table_id: z.string().uuid(),
  absorbed_table_id: z.string().uuid(),
})

export const setTableActiveSchema = z.object({
  table_id: z.string().uuid(),
  active: z.boolean(),
})

export const addDecorSchema = z.object({
  area_id: z.string().uuid(),
  kind: z.enum(['wall', 'pillar', 'island', 'bar']),
  shape: SHAPE,
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(8).max(6000),
  height: z.number().int().min(8).max(6000),
  label: z.string().max(40).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
})

export const updateDecorSchema = z.object({
  id: z.string().uuid(),
  label: z.string().max(40).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
})

export const elementIdSchema = z.object({
  id: z.string().uuid(),
})

export const setZIndexSchema = z.object({
  id: z.string().uuid(),
  z_index: z.number().int(),
})

export type CreateTableInPlanInput = z.infer<typeof createTableInPlanSchema>
export type ElementGeometry = z.infer<typeof elementGeometrySchema>
export type AddDecorInput = z.infer<typeof addDecorSchema>
