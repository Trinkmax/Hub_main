'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { openTable } from '@/lib/imports/detect'
import type { Cell } from '@/lib/imports/types'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TEMPLATE_EDIT_ROLES,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  type ExistingEvent,
  type ImportFormat,
  type ImportPlan,
  type ImportProblem,
  monthsRange,
  planImport,
  readImportRows,
} from './calendar-import'
import { todayInCordoba } from './date-presets'
import { humanizeSalonError } from './humanize'
import type { MealType } from './types'

/**
 * Cargar las fechas del calendario con un Excel: primero la vista previa (qué
 * se agrega, qué cambia, qué se quita) y después aplicar. Las dos leen el
 * MISMO archivo (el navegador lo vuelve a mandar) y arman el plan contra el
 * calendario de ese momento: lo que se aplica nunca es un plan viejo.
 *
 * Owner y anfitrión (`TEMPLATE_EDIT_ROLES`): los que arman la agenda. Las
 * escrituras van con su sesión (RLS) y cada fecha queda en `audit_log` con
 * `source: 'excel'`.
 */

// biome-ignore lint/suspicious/noExplicitAny: tablas sin tipos generados (como lib/salon/actions)
type SBAny = any

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 2000
const MAX_COLUMNS = 30

export type CalendarImportItem = {
  key: string
  kind: 'create' | 'same' | 'update' | 'remove' | 'keep'
  date: string
  /** HH:MM */
  time: string
  /** Cómo se la conoce (el título de Entradas si tiene; si no, el del calendario). */
  label: string
  /** El nombre en el calendario, si es otro («Caroline» para Coraline). */
  calendarName: string | null
  capacity: number | null
  newTime: string | null
  newCapacity: number | null
  timeBlocked: boolean
  reservations: number
  lines: number[]
}

export type CalendarImportPreview = {
  fileName: string
  items: CalendarImportItem[]
  problems: ImportProblem[]
  months: string[]
  duplicates: number
  noColumns: boolean
}

export type CalendarImportPreviewState =
  | { ok: true; preview: CalendarImportPreview }
  | { ok: false; message: string }

export type CalendarImportApplyState =
  | {
      ok: true
      created: number
      updated: number
      removed: number
      skipped: Array<{ date: string; label: string; reason: string }>
      firstMonth: string | null
    }
  | { ok: false; message: string }

const NO_ACCESS = 'No tenés permiso para cargar fechas en este bar.'

async function authorize(slug: string) {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, TEMPLATE_EDIT_ROLES)
    return access
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

const FILE_MESSAGES: Record<string, string> = {
  file_empty: 'El archivo está vacío.',
  file_xls_biff: 'Es un Excel viejo (.xls). Guardalo como .xlsx (o CSV) y subilo de nuevo.',
  file_pdf: 'Es un PDF. Subí el Excel (.xlsx) o un CSV.',
  file_xlsx_corrupt: 'No pudimos abrir el Excel. Guardalo de nuevo y probá otra vez.',
  file_too_big: 'El archivo es demasiado grande para una lista de fechas.',
  file_too_many_rows: 'El archivo tiene demasiadas filas para una lista de fechas.',
}

/** El archivo del formulario → sus filas, o el porqué en castellano. */
async function readFile(
  formData: FormData,
): Promise<{ ok: true; rows: Cell[][]; fileName: string } | { ok: false; message: string }> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Elegí el Excel con las fechas.' }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: 'El archivo es demasiado grande para una lista de fechas.' }
  }
  const opened = await openTable({
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
  })
  if (!opened.ok) {
    return {
      ok: false,
      message:
        FILE_MESSAGES[opened.issue.code] ??
        'No pudimos leer el archivo como una tabla. Subí un Excel (.xlsx) o un CSV.',
    }
  }
  const rows = opened.table.rows.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLUMNS))
  return { ok: true, rows, fileName: file.name.slice(0, 120) }
}

type FormatRow = {
  id: string
  name: string
  active: boolean
  default_capacity: number | null
  default_meal_type: MealType
  default_private_group: boolean
}

/** Los formatos del bar, con los títulos de Entradas y la hora y el cupo de su última fecha. */
async function loadFormats(supabase: SBAny, tenantId: string): Promise<ImportFormat[]> {
  const [{ data: templates, error }, { data: films }, { data: recent }] = await Promise.all([
    supabase
      .from('scheduled_event_templates')
      .select('id, name, active, default_capacity, default_meal_type, default_private_group')
      .eq('tenant_id', tenantId),
    // Si el rol no ve Entradas (RLS), solo se reconocen los nombres del calendario.
    supabase.from('event_experiences').select('template_id, title').eq('tenant_id', tenantId),
    supabase
      .from('scheduled_events')
      .select('template_id, starts_at_local, capacity, event_date')
      .eq('tenant_id', tenantId)
      .order('event_date', { ascending: false })
      .limit(1000),
  ])
  if (error) {
    console.error('[calendar-import.loadFormats]', { tenantId, code: error.code })
    throw new Error('No pudimos cargar los formatos del calendario.')
  }
  const titles = new Map<string, string[]>()
  for (const f of (films as Array<{ template_id: string; title: string }> | null) ?? []) {
    titles.set(f.template_id, [...(titles.get(f.template_id) ?? []), f.title])
  }
  const usual = new Map<string, { time: string; capacity: number }>()
  for (const e of (recent as Array<{
    template_id: string
    starts_at_local: string
    capacity: number
  }> | null) ?? []) {
    if (!usual.has(e.template_id)) {
      usual.set(e.template_id, {
        time: String(e.starts_at_local).slice(0, 5),
        capacity: e.capacity,
      })
    }
  }
  return ((templates as FormatRow[] | null) ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    aliases: titles.get(t.id) ?? [],
    active: t.active,
    defaultCapacity: t.default_capacity,
    defaultMealType: t.default_meal_type,
    defaultPrivateGroup: t.default_private_group,
    usualTime: usual.get(t.id)?.time ?? null,
    usualCapacity: usual.get(t.id)?.capacity ?? null,
  }))
}

/** Las fechas de esas películas en esos meses, de hoy en adelante, con sus reservas activas. */
async function loadExisting(
  supabase: SBAny,
  tenantId: string,
  formatIds: string[],
  months: string[],
  today: string,
): Promise<ExistingEvent[]> {
  const range = monthsRange(months)
  if (!range || formatIds.length === 0) return []
  const { data, error } = await supabase
    .from('scheduled_events')
    .select('id, template_id, event_date, starts_at_local, capacity')
    .eq('tenant_id', tenantId)
    .in('template_id', formatIds)
    .gte('event_date', range.from > today ? range.from : today)
    .lte('event_date', range.to)
  if (error) {
    console.error('[calendar-import.loadExisting]', { tenantId, code: error.code })
    throw new Error('No pudimos leer el calendario.')
  }
  const events =
    (data as Array<{
      id: string
      template_id: string
      event_date: string
      starts_at_local: string
      capacity: number
    }> | null) ?? []
  const counts = await activeReservations(
    supabase,
    tenantId,
    events.map((e) => e.id),
  )
  return events.map((e) => ({
    id: e.id,
    templateId: e.template_id,
    date: e.event_date,
    time: String(e.starts_at_local).slice(0, 5),
    capacity: e.capacity,
    activeReservations: counts.get(e.id) ?? 0,
  }))
}

/** Reservas que no están canceladas ni «no vino», por fecha (el mismo criterio que borrar una). */
async function activeReservations(
  supabase: SBAny,
  tenantId: string,
  eventIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (eventIds.length === 0) return counts
  const { data, error } = await supabase
    .from('salon_reservations')
    .select('scheduled_event_id')
    .eq('tenant_id', tenantId)
    .in('scheduled_event_id', eventIds)
    .not('status', 'in', '(cancelled,no_show)')
  if (error) {
    console.error('[calendar-import.activeReservations]', { tenantId, code: error.code })
    throw new Error('No pudimos leer las reservas del calendario.')
  }
  for (const r of (data as Array<{ scheduled_event_id: string }> | null) ?? []) {
    counts.set(r.scheduled_event_id, (counts.get(r.scheduled_event_id) ?? 0) + 1)
  }
  return counts
}

type Built = {
  plan: ImportPlan
  formats: Map<string, ImportFormat>
  problems: ImportProblem[]
  noColumns: boolean
}

async function build(supabase: SBAny, tenantId: string, rows: Cell[][]): Promise<Built> {
  const today = todayInCordoba()
  const formats = await loadFormats(supabase, tenantId)
  const read = readImportRows(rows, formats, today)
  const months = [...new Set(read.entries.map((e) => e.date.slice(0, 7)))].sort()
  const formatIds = [...new Set(read.entries.map((e) => e.formatId))]
  const existing = await loadExisting(supabase, tenantId, formatIds, months, today)
  return {
    plan: planImport(read.entries, existing, today),
    formats: new Map(formats.map((f) => [f.id, f])),
    problems: read.problems,
    noColumns: read.noColumns,
  }
}

function labelOf(format: ImportFormat | undefined): { label: string; calendarName: string | null } {
  if (!format) return { label: 'Formato', calendarName: null }
  const title = format.aliases[0]
  if (title && title.trim() !== format.name.trim())
    return { label: title, calendarName: format.name }
  return { label: format.name, calendarName: null }
}

function toItems(plan: ImportPlan, formats: Map<string, ImportFormat>): CalendarImportItem[] {
  const base = (
    kind: CalendarImportItem['kind'],
    date: string,
    time: string,
    formatId: string,
  ) => ({
    kind,
    date,
    time,
    ...labelOf(formats.get(formatId)),
    capacity: null,
    newTime: null,
    newCapacity: null,
    timeBlocked: false,
    reservations: 0,
    lines: [] as number[],
  })
  return [
    ...plan.creates.map((c) => ({
      ...base('create', c.date, c.time, c.formatId),
      key: `create-${c.formatId}-${c.date}-${c.time}`,
      capacity: c.capacity,
      lines: c.lines,
    })),
    ...plan.updates.map((u) => ({
      ...base('update', u.date, u.time, u.formatId),
      key: `update-${u.eventId}`,
      capacity: u.capacity,
      newTime: u.newTime,
      newCapacity: u.newCapacity,
      timeBlocked: u.timeBlocked,
    })),
    ...plan.removes.map((r) => ({
      ...base('remove', r.date, r.time, r.formatId),
      key: `remove-${r.eventId}`,
    })),
    ...plan.keeps.map((k) => ({
      ...base('keep', k.date, k.time, k.formatId),
      key: `keep-${k.eventId}`,
      reservations: k.reservations,
    })),
    ...plan.sames.map((s) => ({
      ...base('same', s.date, s.time, s.formatId),
      key: `same-${s.eventId}`,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
}

export async function previewCalendarImport(
  slug: string,
  formData: FormData,
): Promise<CalendarImportPreviewState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: NO_ACCESS }
  const file = await readFile(formData)
  if (!file.ok) return file
  const supabase = (await createClient()) as SBAny
  try {
    const built = await build(supabase, access.tenant.id, file.rows)
    return {
      ok: true,
      preview: {
        fileName: file.fileName,
        items: toItems(built.plan, built.formats),
        problems: built.problems,
        months: built.plan.months,
        duplicates: built.plan.duplicates,
        noColumns: built.noColumns,
      },
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'No pudimos leer el archivo.',
    }
  }
}

const applyOptionsSchema = z.object({ removeMissing: z.enum(['1', '0']).default('1') })

export async function applyCalendarImport(
  slug: string,
  formData: FormData,
): Promise<CalendarImportApplyState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: NO_ACCESS }
  const options = applyOptionsSchema.safeParse({
    removeMissing: formData.get('removeMissing') ?? '1',
  })
  if (!options.success) return { ok: false, message: 'Pedido inválido.' }
  const removeMissing = options.data.removeMissing === '1'
  const file = await readFile(formData)
  if (!file.ok) return file
  const supabase = (await createClient()) as SBAny
  const tenantId = access.tenant.id

  let built: Built
  try {
    built = await build(supabase, tenantId, file.rows)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'No pudimos leer el archivo.',
    }
  }
  const { plan, formats } = built
  const label = (formatId: string) => labelOf(formats.get(formatId)).label
  const skipped: Array<{ date: string; label: string; reason: string }> = []
  const audit = (action: string, entityId: string, payload: Record<string, unknown>) =>
    logAudit({
      tenantId,
      userId: access.user.id,
      action,
      entity: 'scheduled_event',
      entityId,
      payload: { source: 'excel', file: file.fileName, ...payload },
    })

  // 1. Las nuevas, todas juntas: o entran todas o ninguna.
  let created = 0
  if (plan.creates.length > 0) {
    const { data, error } = await supabase
      .from('scheduled_events')
      .insert(
        plan.creates.map((c) => {
          const format = formats.get(c.formatId)
          return {
            tenant_id: tenantId,
            template_id: c.formatId,
            event_date: c.date,
            starts_at_local: c.time,
            capacity: c.capacity,
            meal_type: format?.defaultMealType ?? 'dinner',
            private_group: format?.defaultPrivateGroup ?? false,
          }
        }),
      )
      .select('id, event_date, template_id')
    if (error) {
      console.error('[calendar-import.create]', { tenantId, code: error.code })
      return {
        ok: false,
        message: `No pudimos agregar las fechas: ${humanizeSalonError(error.message)}`,
      }
    }
    const rows =
      (data as Array<{ id: string; event_date: string; template_id: string }> | null) ?? []
    created = rows.length
    await Promise.all(
      rows.map((r) => audit('scheduled_event.created', r.id, { event_date: r.event_date })),
    )
  }

  // 2. Hora y cupo de las que ya estaban.
  let updated = 0
  for (const u of plan.updates) {
    const changes: Record<string, unknown> = {}
    if (u.newTime) changes.starts_at_local = u.newTime
    if (u.newCapacity) changes.capacity = u.newCapacity
    if (u.timeBlocked) {
      skipped.push({
        date: u.date,
        label: label(u.formatId),
        reason: 'La hora no se cambió: tiene reservas. Cambiala desde el calendario.',
      })
    }
    if (Object.keys(changes).length === 0) continue
    const { error } = await supabase
      .from('scheduled_events')
      .update(changes)
      .eq('tenant_id', tenantId)
      .eq('id', u.eventId)
    if (error) {
      skipped.push({
        date: u.date,
        label: label(u.formatId),
        reason: humanizeSalonError(error.message),
      })
      continue
    }
    updated++
    await audit('scheduled_event.updated', u.eventId, changes)
  }

  // 3. Las que ya no están, si se pidió y siguen sin reservas.
  let removed = 0
  if (removeMissing) {
    const fresh = await activeReservations(
      supabase,
      tenantId,
      plan.removes.map((r) => r.eventId),
    ).catch(() => null)
    for (const r of plan.removes) {
      if (!fresh || (fresh.get(r.eventId) ?? 0) > 0) {
        skipped.push({ date: r.date, label: label(r.formatId), reason: 'Tiene reservas: queda.' })
        continue
      }
      const { error } = await supabase
        .from('scheduled_events')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('id', r.eventId)
      if (error) {
        // La pauta de «Cómo nos fue» frena el borrado (FK sin cascade, a propósito).
        const reason =
          error.code === '23503' &&
          String(error.message ?? '').includes('scheduled_event_marketing')
            ? 'Tiene pauta cargada en «Cómo nos fue»: queda.'
            : humanizeSalonError(error.message)
        skipped.push({ date: r.date, label: label(r.formatId), reason })
        continue
      }
      removed++
      await audit('scheduled_event.deleted', r.eventId, { event_date: r.date })
    }
  }
  for (const k of plan.keeps) {
    skipped.push({
      date: k.date,
      label: label(k.formatId),
      reason: `Tiene ${k.reservations === 1 ? '1 reserva' : `${k.reservations} reservas`}: queda.`,
    })
  }

  revalidatePath(`/${slug}/eventos/programados`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  revalidatePath(`/${slug}/entradas`, 'layout')
  revalidatePath(`/entradas/${slug}`, 'layout')
  return {
    ok: true,
    created,
    updated,
    removed,
    skipped: skipped.sort((a, b) => a.date.localeCompare(b.date)),
    firstMonth: plan.months[0] ?? null,
  }
}
