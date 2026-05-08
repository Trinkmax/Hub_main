'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const BUCKET = 'tenant-logos'

export type LogoActionResult = { ok: true; logoUrl: string } | { ok: false; message: string }

/**
 * Sube un logo al bucket `tenant-logos` y actualiza `tenants.logo_url`.
 * Path: `{tenant_id}/logo.{ext}` — un único logo por tenant, los uploads
 * sobrescriben.
 *
 * Validaciones:
 * - Owner del tenant (RLS lo refuerza también).
 * - Tipo MIME en {png, jpeg, webp, svg}.
 * - Tamaño ≤ 2MB.
 */
export async function uploadTenantLogoAction(
  tenantSlug: string,
  formData: FormData,
): Promise<LogoActionResult> {
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof RoleRequiredError) {
      return { ok: false, message: 'Solo el owner puede cambiar el logo.' }
    }
    if (error instanceof TenantNotFoundError) {
      return { ok: false, message: 'No encontramos el bar.' }
    }
    throw error
  }

  const file = formData.get('logo')
  if (!(file instanceof File)) {
    return { ok: false, message: 'Falta el archivo.' }
  }
  if (file.size === 0) {
    return { ok: false, message: 'El archivo está vacío.' }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: 'Máximo 2 MB. Comprimí o reducí el tamaño.' }
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return {
      ok: false,
      message: 'Formato no soportado. Usá PNG, JPG, WebP o SVG.',
    }
  }

  const ext = (() => {
    if (file.type === 'image/png') return 'png'
    if (file.type === 'image/jpeg') return 'jpg'
    if (file.type === 'image/webp') return 'webp'
    return 'svg'
  })()

  const path = `${access.tenant.id}/logo.${ext}`
  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)

  const supabase = createServiceClient()

  // Borrar logo previo (si existe en otra extensión) para no acumular archivos
  // huérfanos. Listamos los objects del tenant y borramos los distintos al
  // que vamos a escribir.
  const { data: existing } = await supabase.storage.from(BUCKET).list(access.tenant.id)
  const stale = (existing ?? [])
    .map((o) => `${access.tenant.id}/${o.name}`)
    .filter((p) => p !== path)
  if (stale.length > 0) {
    await supabase.storage.from(BUCKET).remove(stale)
  }

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: true,
    cacheControl: '3600',
  })

  if (uploadError) {
    console.error('[tenant.uploadLogo] upload', uploadError.message)
    return { ok: false, message: 'No pudimos subir el archivo. Probá de nuevo.' }
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path)

  // Cache-buster para que el browser refresque inmediatamente sin esperar TTL.
  const logoUrl = `${publicUrl}?v=${Date.now()}`

  const { error: updateError } = await supabase
    .from('tenants')
    .update({ logo_url: logoUrl })
    .eq('id', access.tenant.id)

  if (updateError) {
    console.error('[tenant.uploadLogo] update tenant', updateError.message)
    return { ok: false, message: 'Subimos el archivo pero no pudimos guardarlo.' }
  }

  // Invalidar todas las páginas del tenant (sidebar y emails dependen de esto).
  revalidatePath(`/${tenantSlug}`, 'layout')

  return { ok: true, logoUrl }
}

/**
 * Elimina el logo del tenant — borra archivos del bucket + nullea
 * tenants.logo_url. Idempotente.
 */
export async function deleteTenantLogoAction(tenantSlug: string): Promise<LogoActionResult> {
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof RoleRequiredError) {
      return { ok: false, message: 'Solo el owner puede borrar el logo.' }
    }
    if (error instanceof TenantNotFoundError) {
      return { ok: false, message: 'No encontramos el bar.' }
    }
    throw error
  }

  const supabase = createServiceClient()

  const { data: existing } = await supabase.storage.from(BUCKET).list(access.tenant.id)
  const paths = (existing ?? []).map((o) => `${access.tenant.id}/${o.name}`)
  if (paths.length > 0) {
    await supabase.storage.from(BUCKET).remove(paths)
  }

  const { error: updateError } = await supabase
    .from('tenants')
    .update({ logo_url: null })
    .eq('id', access.tenant.id)

  if (updateError) {
    console.error('[tenant.deleteLogo] update', updateError.message)
    return { ok: false, message: 'No pudimos quitar el logo.' }
  }

  revalidatePath(`/${tenantSlug}`, 'layout')

  return { ok: true, logoUrl: '' }
}
