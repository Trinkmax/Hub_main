'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { getAccount, MercadoPagoError } from '@/lib/mercadopago/client'
import { encryptToken } from '@/lib/meta/crypto'
import { uniqueSlugFrom } from '@/lib/salon/slug-dedupe'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import type { CurrentUser } from '@/lib/tenant/current'
import type { Tenant } from '@/lib/tenant/types'
import { pesosToCents } from './pricing'
import {
  createExperienceSchema,
  type ExperienceFormInput,
  experienceFormSchema,
  mercadoPagoCredentialsSchema,
  type TicketingSettingsInput,
  ticketingSettingsSchema,
} from './schemas'

/**
 * Acciones del panel (Marketing → Entradas). Todo es del dueño: es la vidriera
 * pública del bar y es plata.
 *
 * Las películas y la configuración se escriben con la sesión del dueño (RLS
 * owner + GRANTs por columna). La conexión con Mercado Pago va con
 * service_role porque hay que cifrar el token (la clave vive en el server) y
 * porque esas columnas no se pueden escribir desde la API a propósito: solo se
 * guarda una cuenta DESPUÉS de verificarla contra Mercado Pago.
 */

// biome-ignore lint/suspicious/noExplicitAny: tablas nuevas, sin tipos generados todavía
type SBAny = any

export type TicketingActionState =
  | { ok: true; message?: string; data?: Record<string, unknown> }
  | { ok: false; message: string; field?: string }

async function authorizeOwner(slug: string): Promise<{ tenant: Tenant; user: CurrentUser } | null> {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])
    return { tenant: access.tenant, user: access.user }
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

const NO_ACCESS: TicketingActionState = {
  ok: false,
  message: 'Solo el dueño puede cambiar las entradas online.',
}

function revalidateTicketing(slug: string): void {
  revalidatePath(`/${slug}/entradas`, 'layout')
  revalidatePath(`/entradas/${slug}`, 'layout')
}

/** «Venta online» existe desde el primer día: así ya aparece en el combo. */
async function ensureOnlineManager(tenantId: string): Promise<void> {
  const service = createServiceClient() as SBAny
  const { error } = await service.rpc('ticketing_online_manager', { p_tenant_id: tenantId })
  if (error) {
    console.error('[ticketing.ensureOnlineManager]', { tenantId, code: error.code })
  }
}

// ──────────────────────────────────────────────
// Películas
// ──────────────────────────────────────────────

/** Crea la página de un formato del calendario, apagada y con lo básico. */
export async function createExperience(
  slug: string,
  input: { template_id: string; price?: number | null; deposit?: number | null },
): Promise<TicketingActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return NO_ACCESS
  const parsed = createExperienceSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Elegí un formato del calendario.' }

  const supabase = (await createClient()) as SBAny
  const tenantId = access.tenant.id

  const [{ data: template }, { data: existing }] = await Promise.all([
    supabase
      .from('scheduled_event_templates')
      .select('id, name, color_hex')
      .eq('tenant_id', tenantId)
      .eq('id', parsed.data.template_id)
      .maybeSingle(),
    supabase
      .from('event_experiences')
      .select('slug, price_cents, deposit_cents, series, schedule_note, updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false }),
  ])
  if (!template) return { ok: false, message: 'Ese formato ya no existe.' }

  const rows =
    (existing as Array<{
      slug: string
      price_cents: number
      deposit_cents: number
      series: string | null
      schedule_note: string | null
    }> | null) ?? []
  // Los precios y la colección arrancan como los de la última película
  // cargada: en Cine y degustación cambian por edición, no por película.
  const last = rows[0]
  const priceCents =
    input.price && input.price > 0 ? pesosToCents(input.price) : Number(last?.price_cents ?? 0)
  const depositCents =
    input.deposit !== undefined && input.deposit !== null && input.deposit >= 0
      ? pesosToCents(input.deposit)
      : Number(last?.deposit_cents ?? 0)
  if (priceCents < 100) {
    return { ok: false, message: 'Poné el precio por persona.', field: 'price' }
  }
  if (depositCents >= priceCents) {
    return { ok: false, message: 'La seña tiene que ser menor que el precio.', field: 'deposit' }
  }

  const name = (template as { name: string }).name
  const newSlug = uniqueSlugFrom(
    name,
    rows.map((r) => r.slug),
  )

  const { data: created, error } = await supabase
    .from('event_experiences')
    .insert({
      tenant_id: tenantId,
      template_id: parsed.data.template_id,
      slug: newSlug,
      title: name,
      series: last?.series ?? null,
      schedule_note: last?.schedule_note ?? null,
      accent_hex: (template as { color_hex: string }).color_hex.toLowerCase(),
      price_cents: priceCents,
      deposit_cents: depositCents,
      created_by: access.user.id,
      updated_by: access.user.id,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Ese formato ya tiene su página.' }
    }
    console.error('[ticketing.createExperience]', { tenantId, code: error.code })
    return { ok: false, message: 'No pudimos crear la página. Probá de nuevo.' }
  }

  await ensureOnlineManager(tenantId)
  const id = (created as { id: string }).id
  await logAudit({
    tenantId,
    userId: access.user.id,
    action: 'event_experience.created',
    entity: 'event_experience',
    entityId: id,
    payload: {
      template_id: parsed.data.template_id,
      price_cents: priceCents,
      deposit_cents: depositCents,
    },
  })
  revalidateTicketing(slug)
  return { ok: true, message: 'Página creada.', data: { id } }
}

export async function saveExperience(
  slug: string,
  input: ExperienceFormInput,
): Promise<TicketingActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return NO_ACCESS
  const parsed = experienceFormSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      message: first?.message ?? 'Revisá los datos.',
      field: first?.path.join('.'),
    }
  }
  const v = parsed.data
  const supabase = (await createClient()) as SBAny

  const { data, error } = await supabase
    .from('event_experiences')
    .update({
      slug: v.slug,
      published: v.published,
      series: v.series,
      title: v.title,
      tagline: v.tagline,
      synopsis: v.synopsis,
      schedule_note: v.schedule_note,
      poster_url: v.poster_url,
      hero_url: v.hero_url,
      accent_hex: v.accent_hex,
      steps: v.steps,
      steps_note: v.steps_note,
      gallery: v.gallery,
      price_cents: v.price,
      deposit_cents: v.deposit,
      max_party_size: v.max_party_size,
      terms: v.terms,
      updated_by: access.user.id,
    })
    .eq('tenant_id', access.tenant.id)
    .eq('id', v.id)
    .select('id')
    .maybeSingle()
  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Ese link ya lo usa otra película.', field: 'slug' }
    }
    console.error('[ticketing.saveExperience]', { tenantId: access.tenant.id, code: error.code })
    return { ok: false, message: 'No pudimos guardar. Probá de nuevo.' }
  }
  if (!data) return { ok: false, message: 'Esa película ya no existe.' }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.user.id,
    action: 'event_experience.updated',
    entity: 'event_experience',
    entityId: v.id,
    payload: {
      published: v.published,
      price_cents: v.price,
      deposit_cents: v.deposit,
      slug: v.slug,
    },
  })
  revalidateTicketing(slug)
  return { ok: true, message: v.published ? 'Guardado y publicado.' : 'Guardado.' }
}

export async function setExperiencePublished(
  slug: string,
  id: string,
  published: boolean,
): Promise<TicketingActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return NO_ACCESS
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: 'Película inválida.' }
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('event_experiences')
    .update({ published, updated_by: access.user.id })
    .eq('tenant_id', access.tenant.id)
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error || !data) {
    if (error) {
      console.error('[ticketing.setExperiencePublished]', {
        tenantId: access.tenant.id,
        code: error.code,
      })
    }
    return { ok: false, message: 'No pudimos cambiarla. Probá de nuevo.' }
  }
  await logAudit({
    tenantId: access.tenant.id,
    userId: access.user.id,
    action: published ? 'event_experience.published' : 'event_experience.unpublished',
    entity: 'event_experience',
    entityId: id,
  })
  revalidateTicketing(slug)
  return { ok: true, message: published ? 'Publicada en la cartelera.' : 'Sacada de la cartelera.' }
}

export async function deleteExperience(slug: string, id: string): Promise<TicketingActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return NO_ACCESS
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: 'Película inválida.' }
  const supabase = (await createClient()) as SBAny
  // Los pedidos quedan (es plata): la FK los deja sin película pero con su foto.
  const { data, error } = await supabase
    .from('event_experiences')
    .delete()
    .eq('tenant_id', access.tenant.id)
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error || !data) {
    if (error) {
      console.error('[ticketing.deleteExperience]', {
        tenantId: access.tenant.id,
        code: error.code,
      })
    }
    return { ok: false, message: 'No pudimos borrarla. Probá de nuevo.' }
  }
  await logAudit({
    tenantId: access.tenant.id,
    userId: access.user.id,
    action: 'event_experience.deleted',
    entity: 'event_experience',
    entityId: id,
  })
  revalidateTicketing(slug)
  return { ok: true, message: 'Página borrada.' }
}

// ──────────────────────────────────────────────
// Configuración
// ──────────────────────────────────────────────

export async function saveTicketingSettings(
  slug: string,
  input: TicketingSettingsInput,
): Promise<TicketingActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return NO_ACCESS
  const parsed = ticketingSettingsSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      message: first?.message ?? 'Revisá los datos.',
      field: first?.path[0]?.toString(),
    }
  }
  const supabase = (await createClient()) as SBAny
  const { error } = await supabase.from('ticketing_settings').upsert(
    {
      tenant_id: access.tenant.id,
      headline: parsed.data.headline,
      intro: parsed.data.intro,
      venue_address: parsed.data.venue_address,
      contact_whatsapp: parsed.data.contact_whatsapp,
      hold_minutes: parsed.data.hold_minutes,
      online_manager_id: parsed.data.online_manager_id,
      updated_by: access.user.id,
    },
    { onConflict: 'tenant_id' },
  )
  if (error) {
    // 23503: el gestor elegido no es de este bar (FK compuesta).
    console.error('[ticketing.saveTicketingSettings]', {
      tenantId: access.tenant.id,
      code: error.code,
    })
    return { ok: false, message: 'No pudimos guardar la configuración.' }
  }
  if (!parsed.data.online_manager_id) await ensureOnlineManager(access.tenant.id)
  await logAudit({
    tenantId: access.tenant.id,
    userId: access.user.id,
    action: 'ticketing.settings_updated',
    entity: 'ticketing_settings',
    payload: {
      hold_minutes: parsed.data.hold_minutes,
      online_manager_id: parsed.data.online_manager_id,
    },
  })
  revalidateTicketing(slug)
  return { ok: true, message: 'Configuración guardada.' }
}

// ──────────────────────────────────────────────
// Mercado Pago
// ──────────────────────────────────────────────

export async function connectMercadoPago(
  slug: string,
  input: { access_token: string; webhook_secret?: string | null },
): Promise<TicketingActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return NO_ACCESS
  const parsed = mercadoPagoCredentialsSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      message: first?.message ?? 'Revisá las credenciales.',
      field: first?.path[0]?.toString(),
    }
  }

  let account: Awaited<ReturnType<typeof getAccount>>
  try {
    account = await getAccount(parsed.data.access_token)
  } catch (error) {
    if (error instanceof MercadoPagoError && error.isAuth) {
      return {
        ok: false,
        message: 'Mercado Pago no reconoce ese Access Token. Copialo de nuevo.',
        field: 'access_token',
      }
    }
    console.error('[ticketing.connectMercadoPago] getAccount', {
      tenantId: access.tenant.id,
      error: error instanceof Error ? error.message : 'unknown',
    })
    return { ok: false, message: 'No pudimos hablar con Mercado Pago. Probá en un ratito.' }
  }
  // Los precios son en pesos: la cuenta tiene que ser de Mercado Pago Argentina.
  if (account.siteId && account.siteId !== 'MLA') {
    return {
      ok: false,
      message: 'Esa cuenta no es de Mercado Pago Argentina: no puede cobrar en pesos.',
      field: 'access_token',
    }
  }

  const [tokenEnc, secretEnc] = await Promise.all([
    encryptToken(parsed.data.access_token),
    parsed.data.webhook_secret ? encryptToken(parsed.data.webhook_secret) : Promise.resolve(null),
  ])

  const service = createServiceClient() as SBAny
  const { error } = await service.from('ticketing_settings').upsert(
    {
      tenant_id: access.tenant.id,
      mp_access_token_enc: tokenEnc,
      mp_webhook_secret_enc: secretEnc,
      mp_user_id: account.id,
      mp_nickname: account.nickname,
      mp_live: account.live,
      mp_connected_at: new Date().toISOString(),
      mp_connected_by: access.user.id,
      updated_by: access.user.id,
    },
    { onConflict: 'tenant_id' },
  )
  if (error) {
    console.error('[ticketing.connectMercadoPago] upsert', {
      tenantId: access.tenant.id,
      code: error.code,
    })
    return { ok: false, message: 'No pudimos guardar la cuenta. Probá de nuevo.' }
  }
  await ensureOnlineManager(access.tenant.id)

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.user.id,
    action: 'ticketing.mp_connected',
    entity: 'ticketing_settings',
    payload: {
      mp_user_id: account.id,
      live: account.live,
      has_webhook_secret: Boolean(secretEnc),
    },
  })
  revalidateTicketing(slug)
  return {
    ok: true,
    message: account.live
      ? `Conectado con ${account.nickname ?? 'tu cuenta de Mercado Pago'}.`
      : 'Conectado en modo prueba: los pagos no son de verdad.',
  }
}

export async function disconnectMercadoPago(slug: string): Promise<TicketingActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return NO_ACCESS
  const service = createServiceClient() as SBAny
  const { error } = await service
    .from('ticketing_settings')
    .update({
      mp_access_token_enc: null,
      mp_webhook_secret_enc: null,
      mp_user_id: null,
      mp_nickname: null,
      mp_live: null,
      mp_connected_at: null,
      mp_connected_by: null,
      updated_by: access.user.id,
    })
    .eq('tenant_id', access.tenant.id)
  if (error) {
    console.error('[ticketing.disconnectMercadoPago]', {
      tenantId: access.tenant.id,
      code: error.code,
    })
    return { ok: false, message: 'No pudimos desconectar la cuenta.' }
  }
  await logAudit({
    tenantId: access.tenant.id,
    userId: access.user.id,
    action: 'ticketing.mp_disconnected',
    entity: 'ticketing_settings',
  })
  revalidateTicketing(slug)
  return { ok: true, message: 'Mercado Pago desconectado. La cartelera sigue visible.' }
}
