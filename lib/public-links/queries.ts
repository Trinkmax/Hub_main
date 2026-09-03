import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type PublicLinkRow = {
  id: string
  label: string
  description: string | null
  url: string
  icon: string | null
  highlight: boolean
  position: number
  active: boolean
}

export type PublicLinkPage = {
  headline: string | null
  bio: string | null
  active: boolean
}

const LINK_COLUMNS = 'id, label, description, url, icon, highlight, position, active'

function mapLink(row: Record<string, unknown>): PublicLinkRow {
  return {
    id: row.id as string,
    label: row.label as string,
    description: (row.description as string | null) ?? null,
    url: row.url as string,
    icon: (row.icon as string | null) ?? null,
    highlight: row.highlight === true,
    position: (row.position as number) ?? 0,
    active: row.active !== false,
  }
}

// ──────────────────────────────────────────────
// Editor (panel del dueño — RLS del usuario)
// ──────────────────────────────────────────────

export async function listPublicLinks(tenantId: string): Promise<PublicLinkRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('public_links')
    .select(LINK_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[public-links.list]', error.message)
    return []
  }
  return (data ?? []).map((row) => mapLink(row as Record<string, unknown>))
}

/** La cabecera. Si el bar nunca la tocó no hay fila: devolvemos el default. */
export async function getPublicLinkPage(tenantId: string): Promise<PublicLinkPage> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('public_link_pages')
    .select('headline, bio, active')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) {
    console.error('[public-links.page]', error.message)
  }
  return {
    headline: (data?.headline as string | null) ?? null,
    bio: (data?.bio as string | null) ?? null,
    active: data?.active !== false,
  }
}

// ──────────────────────────────────────────────
// Página pública (/l/[slug] — sin sesión)
// ──────────────────────────────────────────────

export type PublicLinkPageData = {
  tenant: { id: string; name: string; logoUrl: string | null; brandAccent: string | null }
  page: PublicLinkPage
  links: PublicLinkRow[]
}

/**
 * Todo lo que /l necesita, resuelto por slug y sin sesión.
 *
 * Va con service-role igual que /carta: `public.tenants` no es legible por
 * `anon` (y abrirlo expondría feature_flags, teléfonos y config de puntos).
 * Por eso mismo acá se filtra por `tenant_id` a mano en cada query y se
 * devuelven SÓLO campos públicos.
 */
export async function getPublicLinkPageBySlug(slug: string): Promise<PublicLinkPageData | null> {
  const service = createServiceClient()

  const { data: tenant } = await service
    .from('tenants')
    .select('id, name, logo_url, brand_accent')
    .eq('slug', slug)
    .maybeSingle()
  if (!tenant) return null

  const [pageRes, linksRes] = await Promise.all([
    service
      .from('public_link_pages')
      .select('headline, bio, active')
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    service
      .from('public_links')
      .select(LINK_COLUMNS)
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  return {
    tenant: {
      id: tenant.id as string,
      name: tenant.name as string,
      logoUrl: (tenant.logo_url as string | null) ?? null,
      brandAccent: (tenant.brand_accent as string | null) ?? null,
    },
    page: {
      headline: (pageRes.data?.headline as string | null) ?? null,
      bio: (pageRes.data?.bio as string | null) ?? null,
      active: pageRes.data?.active !== false,
    },
    links: (linksRes.data ?? []).map((row) => mapLink(row as Record<string, unknown>)),
  }
}
