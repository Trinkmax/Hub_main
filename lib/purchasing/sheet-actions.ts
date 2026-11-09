'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { openTable } from '@/lib/imports/detect'
import type { Cell } from '@/lib/imports/types'
import { isFeatureEnabled } from '@/lib/platform/features'
import { createClient } from '@/lib/supabase/server'
import {
  PURCHASING_MANAGE_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { toItem, toSupplier, toZone } from './rows'
import { type ItemValues, readItemsSheet, type SheetPlan, sheetFingerprint } from './sheet'

/**
 * Subir la planilla de insumos (`lib/purchasing/sheet.ts`): la vista previa y el guardado. Guardar vuelve a leer
 * el archivo y a compararlo con HUB en ese momento; si lo que se va a guardar no es lo que se vio (alguien cambió
 * un insumo mientras tanto), no guarda y devuelve la vista previa nueva. Solo el dueño (RLS `pur_items_owner_write`).
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 3000
const MAX_COLUMNS = 40

const NO_ACCESS = 'Solo los dueños editan los insumos.'

const slugSchema = z.string().trim().min(1).max(80)
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/)

/** Lo que ve la pantalla antes de guardar (sin ids ni valores crudos). */
export type ItemsSheetPreview = {
  fileName: string
  fingerprint: string
  rows: number
  updates: Array<{
    key: string
    line: number
    label: string
    changes: string[]
    deactivates: boolean
  }>
  creates: Array<{ key: string; line: number; label: string; detail: string }>
  problems: Array<{ key: string; line: number; label: string; reasons: string[] }>
  same: number
  notInSheet: number
  /** Las columnas que no vinieron en el archivo: quedan como están. */
  missing: string[]
  noColumns: boolean
}

export type ItemsSheetPreviewState =
  | { ok: true; preview: ItemsSheetPreview }
  | { ok: false; message: string }

export type ItemsSheetApplyState =
  | { ok: true; updated: number; created: number; skipped: number }
  | { ok: false; message: string; preview?: ItemsSheetPreview }

async function authorize(slug: string) {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, PURCHASING_MANAGE_ROLES)
    if (!access.isPlatformAdmin && !isFeatureEnabled(access.tenant, 'purchasing')) return null
    return { tenantId: access.tenant.id, userId: access.user.id }
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
  file_pdf: 'Es un PDF. Subí la planilla en Excel (.xlsx) o CSV.',
  file_xlsx_corrupt: 'No pudimos abrir el Excel. Guardalo de nuevo y probá otra vez.',
  file_too_big: 'El archivo es demasiado grande para una lista de insumos.',
  file_too_many_rows: 'El archivo tiene demasiadas filas para una lista de insumos.',
  file_zip_many: 'Ese ZIP trae varios archivos. Subí solo la planilla (.xlsx o CSV).',
}

/** El archivo del formulario → sus filas, o el porqué en castellano. */
async function readFile(
  formData: FormData,
): Promise<{ ok: true; rows: Cell[][]; fileName: string } | { ok: false; message: string }> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Elegí la planilla con los insumos.' }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: 'El archivo es demasiado grande para una lista de insumos.' }
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
        'No pudimos leer el archivo como una tabla. Subí la planilla en Excel (.xlsx) o CSV.',
    }
  }
  if (opened.table.rows.length > MAX_ROWS + 15) {
    return { ok: false, message: 'La planilla tiene demasiadas filas para una lista de insumos.' }
  }
  const rows = opened.table.rows.map((row) => row.slice(0, MAX_COLUMNS))
  return { ok: true, rows, fileName: file.name.slice(0, 120) }
}

type Loaded = {
  plan: SheetPlan
  /** Quién creó cada insumo (para que el guardado no lo pise). */
  createdBy: Map<string, string | null>
}

async function load(
  db: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  rows: Cell[][],
): Promise<Loaded> {
  const [items, zones, suppliers] = await Promise.all([
    db.from('pur_items').select('*').eq('tenant_id', tenantId),
    db.from('pur_zones').select('*').eq('tenant_id', tenantId).order('sort_order'),
    db.from('pur_suppliers').select('*').eq('tenant_id', tenantId).order('name'),
  ])
  const failed = items.error ?? zones.error ?? suppliers.error
  if (failed || !items.data || !zones.data || !suppliers.data) {
    console.error('[purchasing.sheet.load]', { code: failed?.code })
    throw new Error('No pudimos leer los insumos de HUB. Probá de nuevo en un momento.')
  }
  const plan = readItemsSheet(rows, {
    items: items.data.map(toItem),
    zones: zones.data.map(toZone),
    suppliers: suppliers.data.map(toSupplier),
  })
  return { plan, createdBy: new Map(items.data.map((row) => [row.id, row.created_by])) }
}

function toPreview(plan: SheetPlan, fileName: string): ItemsSheetPreview {
  return {
    fileName,
    fingerprint: sheetFingerprint(plan),
    rows: plan.rows,
    updates: plan.updates.map((u) => ({
      key: `u-${u.line}`,
      line: u.line,
      label: u.label,
      changes: u.changes.map((c) => c.text),
      deactivates: u.changes.some((c) => c.field === 'active' && !u.next.active),
    })),
    creates: plan.creates.map((c) => ({
      key: `c-${c.line}`,
      line: c.line,
      label: c.label,
      detail: c.detail,
    })),
    problems: plan.problems.map((p) => ({
      key: `p-${p.line}`,
      line: p.line,
      label: p.label,
      reasons: [...p.reasons],
    })),
    same: plan.same,
    notInSheet: plan.notInSheet,
    missing: [...plan.missing],
    noColumns: plan.noColumns,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No pudimos leer el archivo.'
}

export async function previewItemsSheet(
  slug: string,
  formData: FormData,
): Promise<ItemsSheetPreviewState> {
  const parsedSlug = slugSchema.safeParse(slug)
  if (!parsedSlug.success) return { ok: false, message: 'Pedido inválido.' }
  const auth = await authorize(parsedSlug.data)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const file = await readFile(formData)
  if (!file.ok) return file
  try {
    const db = await createClient()
    const { plan } = await load(db, auth.tenantId, file.rows)
    return { ok: true, preview: toPreview(plan, file.fileName) }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

/** `ItemValues` → columnas de `pur_items`. */
function toRow(v: ItemValues) {
  return {
    code: v.code,
    name: v.name,
    brand: v.brand,
    zone_id: v.zoneId,
    unit: v.unit,
    frequency: v.frequency,
    target_qty: v.targetQty,
    pack_label: v.packLabel,
    pack_size: v.packSize,
    supplier_id: v.supplierId,
    notes: v.notes,
    active: v.active,
  }
}

export async function applyItemsSheet(
  slug: string,
  formData: FormData,
): Promise<ItemsSheetApplyState> {
  const parsedSlug = slugSchema.safeParse(slug)
  const fingerprint = fingerprintSchema.safeParse(formData.get('fingerprint'))
  if (!parsedSlug.success || !fingerprint.success) return { ok: false, message: 'Pedido inválido.' }
  const auth = await authorize(parsedSlug.data)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const file = await readFile(formData)
  if (!file.ok) return file

  const db = await createClient()
  let loaded: Loaded
  try {
    loaded = await load(db, auth.tenantId, file.rows)
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
  const { plan, createdBy } = loaded
  if (sheetFingerprint(plan) !== fingerprint.data) {
    return {
      ok: false,
      message:
        'Mientras mirabas cambió algún insumo en HUB. Revisá de nuevo lo que se va a guardar.',
      preview: toPreview(plan, file.fileName),
    }
  }

  // Todo en una sola escritura: o entran todos los cambios o ninguno.
  const rows = [
    ...plan.updates.map((u) => ({
      id: u.itemId,
      tenant_id: auth.tenantId,
      ...toRow(u.next),
      created_by: createdBy.get(u.itemId) ?? null,
      updated_by: auth.userId,
    })),
    ...plan.creates.map((c) => ({
      id: crypto.randomUUID(),
      tenant_id: auth.tenantId,
      ...toRow(c.next),
      created_by: auth.userId,
      updated_by: auth.userId,
    })),
  ]
  if (rows.length > 0) {
    const { error } = await db.from('pur_items').upsert(rows, { onConflict: 'id' })
    if (error) {
      console.error('[purchasing.sheet.apply]', { code: error.code })
      return {
        ok: false,
        message:
          error.code === '23505'
            ? 'Dos insumos quedarían con el mismo código. Revisá la columna Código y subila de nuevo.'
            : 'No se pudo guardar. No cambió nada: probá de nuevo en un momento.',
      }
    }
  }

  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'purchasing.items_sheet_imported',
    entity: 'pur_item',
    payload: {
      source: 'planilla',
      file: file.fileName,
      updated: plan.updates.length,
      created: plan.creates.length,
      skipped: plan.problems.length,
    },
  })
  revalidatePath(`/${parsedSlug.data}/compras`, 'layout')
  revalidatePath(`/${parsedSlug.data}/salon/stock`, 'layout')
  return {
    ok: true,
    updated: plan.updates.length,
    created: plan.creates.length,
    skipped: plan.problems.length,
  }
}
