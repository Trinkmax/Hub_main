'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { isLandingSlugTaken } from './queries'
import {
  landingCreateSchema,
  landingHtmlSchema,
  landingIdSchema,
  landingRestoreSchema,
  landingSettingsSchema,
} from './schemas'

/**
 * Server Actions del editor de páginas HTML.
 *
 * MODELO MENTAL (importante para leer el código): `landing_pages.html` es lo
 * que está EN VIVO. No hay borrador aparte: mientras la página está apagada no
 * la ve nadie, y una vez publicada, guardar es publicar. Por eso cada guardado
 * deja una versión en el historial — es la red que permite volver atrás cuando
 * alguien pega algo roto un viernes a las 23.
 */

export type LandingActionState = { ok: true; id?: string } | { ok: false; message: string }

/** Cuántas versiones se guardan por página. Más que esto es archivo muerto. */
const MAX_VERSIONS = 20

const SLUG_TAKEN_MESSAGE = 'Ese final de link ya está usado. Probá con otro.'

async function authorizeOwner(slug: string) {
  try {
    const { tenant, role, user } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return { tenant, userId: user.id }
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

function revalidate(tenantSlug: string, pageId?: string) {
  revalidatePath(`/${tenantSlug}/paginas`)
  if (pageId) revalidatePath(`/${tenantSlug}/paginas/${pageId}`)
}

/** El unique global del slug es la verdad; el chequeo previo es sólo cortesía. */
function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' || (error.message ?? '').includes('landing_pages_slug_key')
}

/**
 * Guarda una foto del HTML y poda las viejas. Best-effort: si el historial
 * falla, el guardado ya ocurrió y no tiene sentido abortarlo.
 */
async function snapshotVersion(opts: {
  tenantId: string
  pageId: string
  html: string
  label: string
  userId: string
}) {
  const supabase = await createClient()

  const { error } = await supabase.from('landing_page_versions').insert({
    tenant_id: opts.tenantId,
    page_id: opts.pageId,
    html: opts.html,
    label: opts.label,
    created_by: opts.userId,
  })
  if (error) {
    console.error('[landings.snapshot]', error.message)
    return
  }

  // Poda: todo lo que quede después de las 20 más nuevas.
  const { data: stale } = await supabase
    .from('landing_page_versions')
    .select('id')
    .eq('tenant_id', opts.tenantId)
    .eq('page_id', opts.pageId)
    .order('created_at', { ascending: false })
    .range(MAX_VERSIONS, MAX_VERSIONS + 50)

  const ids = (stale ?? []).map((row) => (row as { id: string }).id)
  if (ids.length > 0) {
    await supabase.from('landing_page_versions').delete().in('id', ids)
  }
}

// ──────────────────────────────────────────────
// Alta / baja / ajustes
// ──────────────────────────────────────────────

export async function createLandingPage(
  tenantSlug: string,
  _prev: LandingActionState,
  formData: FormData,
): Promise<LandingActionState> {
  const auth = await authorizeOwner(tenantSlug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = landingCreateSchema.safeParse({
    title: formData.get('title'),
    slug: formData.get('slug'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  if (await isLandingSlugTaken(parsed.data.slug)) {
    return { ok: false, message: SLUG_TAKEN_MESSAGE }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('landing_pages')
    .insert({
      tenant_id: auth.tenant.id,
      title: parsed.data.title,
      slug: parsed.data.slug,
      html: '',
      published: false,
    })
    .select('id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) return { ok: false, message: SLUG_TAKEN_MESSAGE }
    console.error('[landings.create]', error.message)
    return { ok: false, message: 'No pudimos crear la página.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'landing_page.created',
    entity: 'landing_page',
    entityId: data.id,
    payload: { slug: parsed.data.slug },
  })

  revalidate(tenantSlug)
  return { ok: true, id: data.id }
}

export async function updateLandingSettings(
  tenantSlug: string,
  _prev: LandingActionState,
  formData: FormData,
): Promise<LandingActionState> {
  const auth = await authorizeOwner(tenantSlug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = landingSettingsSchema.safeParse({
    id: formData.get('id'),
    title: formData.get('title'),
    slug: formData.get('slug'),
    indexable: formData.get('indexable') === 'on' || formData.get('indexable') === 'true',
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const { id, ...fields } = parsed.data
  if (await isLandingSlugTaken(fields.slug, id)) {
    return { ok: false, message: SLUG_TAKEN_MESSAGE }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('landing_pages')
    .update(fields)
    .eq('id', id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    if (isUniqueViolation(error)) return { ok: false, message: SLUG_TAKEN_MESSAGE }
    console.error('[landings.settings]', error.message)
    return { ok: false, message: 'No pudimos guardar los cambios.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'landing_page.updated',
    entity: 'landing_page',
    entityId: id,
    payload: { slug: fields.slug, indexable: fields.indexable },
  })

  revalidate(tenantSlug, id)
  return { ok: true, id }
}

export async function deleteLandingPage(
  tenantSlug: string,
  input: { id: string },
): Promise<LandingActionState> {
  const auth = await authorizeOwner(tenantSlug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = landingIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Página inválida' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('landing_pages')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    console.error('[landings.delete]', error.message)
    return { ok: false, message: 'No pudimos borrar la página.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'landing_page.deleted',
    entity: 'landing_page',
    entityId: parsed.data.id,
  })

  revalidate(tenantSlug, parsed.data.id)
  return { ok: true }
}

/**
 * Duplicar: el caso real es "la misma landing del mes pasado con otra fecha".
 * Nace apagada y con el link libre más cercano (`promo`, `promo-2`, `promo-3`…).
 */
export async function duplicateLandingPage(
  tenantSlug: string,
  input: { id: string },
): Promise<LandingActionState> {
  const auth = await authorizeOwner(tenantSlug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = landingIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Página inválida' }

  const supabase = await createClient()
  const { data: source, error: readError } = await supabase
    .from('landing_pages')
    .select('slug, title, html')
    .eq('id', parsed.data.id)
    .eq('tenant_id', auth.tenant.id)
    .maybeSingle()

  if (readError || !source) {
    console.error('[landings.duplicate.read]', readError?.message ?? 'sin fila')
    return { ok: false, message: 'No encontramos la página.' }
  }

  const baseSlug = (source.slug as string).replace(/-\d+$/, '').slice(0, 36) || 'pagina'
  let slug = ''
  for (let n = 2; n <= 40; n += 1) {
    const candidate = `${baseSlug}-${n}`
    if (!(await isLandingSlugTaken(candidate))) {
      slug = candidate
      break
    }
  }
  if (!slug) return { ok: false, message: 'No encontramos un link libre. Cambiá el original.' }

  const { data, error } = await supabase
    .from('landing_pages')
    .insert({
      tenant_id: auth.tenant.id,
      // Corte por code points: `.slice()` parte los pares subrogados al medio
      // y un emoji cortado a la mitad no entra en Postgres.
      title: [...`Copia de ${source.title as string}`].slice(0, 80).join(''),
      slug,
      html: (source.html as string | null) ?? '',
      published: false,
    })
    .select('id')
    .single()

  if (error) {
    // El chequeo previo es cortesía: entre el chequeo y el insert otro bar pudo
    // haber tomado el link.
    if (isUniqueViolation(error)) return { ok: false, message: SLUG_TAKEN_MESSAGE }
    console.error('[landings.duplicate]', error.message)
    return { ok: false, message: 'No pudimos duplicar la página.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'landing_page.duplicated',
    entity: 'landing_page',
    entityId: data.id,
    payload: { fromId: parsed.data.id, slug },
  })

  revalidate(tenantSlug)
  return { ok: true, id: data.id }
}

// ──────────────────────────────────────────────
// El código
// ──────────────────────────────────────────────

export async function saveLandingHtml(
  tenantSlug: string,
  input: { id: string; html: string },
): Promise<LandingActionState> {
  const auth = await authorizeOwner(tenantSlug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = landingHtmlSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data: current } = await supabase
    .from('landing_pages')
    .select('html, published')
    .eq('id', parsed.data.id)
    .eq('tenant_id', auth.tenant.id)
    .maybeSingle()

  if (!current) return { ok: false, message: 'No encontramos la página.' }
  // Vaciar el código de una página publicada la dejaría contestando 404 con el
  // switch en "En vivo": un estado que el dueño no puede ver ni explicar.
  if (current.published === true && parsed.data.html.trim().length === 0) {
    return { ok: false, message: 'Para dejarla sin código, primero apagá "En vivo".' }
  }
  // Guardar sin cambios no ensucia el historial ni mueve "última edición".
  if (((current.html as string | null) ?? '') === parsed.data.html) {
    return { ok: true, id: parsed.data.id }
  }

  const { error } = await supabase
    .from('landing_pages')
    .update({ html: parsed.data.html })
    .eq('id', parsed.data.id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    console.error('[landings.save]', error.message)
    return { ok: false, message: 'No pudimos guardar el código.' }
  }

  await snapshotVersion({
    tenantId: auth.tenant.id,
    pageId: parsed.data.id,
    html: parsed.data.html,
    label: current.published === true ? 'Publicada' : 'Guardada',
    userId: auth.userId,
  })

  // El historial guarda el HTML pero lo puede borrar el mismo dueño; audit_log
  // es sólo-lectura para el panel. Nunca el HTML en el payload: es contenido,
  // no metadato.
  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'landing_page.html_saved',
    entity: 'landing_page',
    entityId: parsed.data.id,
    payload: { chars: parsed.data.html.length, published: current.published === true },
  })

  revalidate(tenantSlug, parsed.data.id)
  return { ok: true, id: parsed.data.id }
}

export async function setLandingPublished(
  tenantSlug: string,
  input: { id: string; published: boolean },
): Promise<LandingActionState> {
  const auth = await authorizeOwner(tenantSlug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = landingIdSchema.safeParse({ id: input.id })
  if (!parsed.success) return { ok: false, message: 'Página inválida' }
  const published = input.published === true

  const supabase = await createClient()

  if (published) {
    // No dejamos publicar una página en blanco: sería un 404 con la URL ya
    // repartida por Instagram.
    const { data: current } = await supabase
      .from('landing_pages')
      .select('html')
      .eq('id', parsed.data.id)
      .eq('tenant_id', auth.tenant.id)
      .maybeSingle()

    if (!current) return { ok: false, message: 'No encontramos la página.' }
    if (((current.html as string | null) ?? '').trim().length === 0) {
      return { ok: false, message: 'Cargá el HTML antes de publicar.' }
    }
  }

  const { error } = await supabase
    .from('landing_pages')
    .update({ published, published_at: published ? new Date().toISOString() : null })
    .eq('id', parsed.data.id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    console.error('[landings.publish]', error.message)
    return { ok: false, message: 'No pudimos cambiar el estado.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: published ? 'landing_page.published' : 'landing_page.unpublished',
    entity: 'landing_page',
    entityId: parsed.data.id,
  })

  revalidate(tenantSlug, parsed.data.id)
  return { ok: true, id: parsed.data.id }
}

/**
 * El HTML de una versión, para verla en la previa antes de restaurarla. Es una
 * lectura y no una mutación, pero vive acá porque la pide el editor (cliente) y
 * necesita el mismo guard de dueño que todo lo demás.
 */
export async function fetchLandingVersionHtml(
  tenantSlug: string,
  input: { id: string; versionId: string },
): Promise<{ ok: true; html: string } | { ok: false; message: string }> {
  const auth = await authorizeOwner(tenantSlug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = landingRestoreSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Versión inválida' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('landing_page_versions')
    .select('html')
    .eq('id', parsed.data.versionId)
    .eq('page_id', parsed.data.id)
    .eq('tenant_id', auth.tenant.id)
    .maybeSingle()

  if (error || !data) {
    console.error('[landings.version-html]', error?.message ?? 'sin fila')
    return { ok: false, message: 'No encontramos esa versión.' }
  }
  return { ok: true, html: (data.html as string | null) ?? '' }
}

export async function restoreLandingVersion(
  tenantSlug: string,
  input: { id: string; versionId: string },
): Promise<LandingActionState> {
  const auth = await authorizeOwner(tenantSlug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = landingRestoreSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Versión inválida' }

  const supabase = await createClient()
  const { data: version, error: readError } = await supabase
    .from('landing_page_versions')
    .select('html, created_at')
    .eq('id', parsed.data.versionId)
    .eq('page_id', parsed.data.id)
    .eq('tenant_id', auth.tenant.id)
    .maybeSingle()

  if (readError || !version) {
    console.error('[landings.restore.read]', readError?.message ?? 'sin fila')
    return { ok: false, message: 'No encontramos esa versión.' }
  }

  const html = (version.html as string | null) ?? ''
  const { error } = await supabase
    .from('landing_pages')
    .update({ html })
    .eq('id', parsed.data.id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    console.error('[landings.restore]', error.message)
    return { ok: false, message: 'No pudimos restaurar esa versión.' }
  }

  await snapshotVersion({
    tenantId: auth.tenant.id,
    pageId: parsed.data.id,
    html,
    label: 'Restaurada',
    userId: auth.userId,
  })

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'landing_page.restored',
    entity: 'landing_page',
    entityId: parsed.data.id,
    payload: { versionId: parsed.data.versionId },
  })

  revalidate(tenantSlug, parsed.data.id)
  return { ok: true, id: parsed.data.id }
}
