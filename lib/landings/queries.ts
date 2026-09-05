import 'server-only'
import { todayInCordoba } from '@/lib/salon/date-presets'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type LandingPageRow = {
  id: string
  slug: string
  title: string
  published: boolean
  indexable: boolean
  views: number
  lastViewedAt: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type LandingPageDetail = LandingPageRow & {
  html: string
}

export type LandingVersionRow = {
  id: string
  label: string | null
  createdAt: string
  chars: number
}

/** Un punto del gráfico de visitas: `2026-09-05` → 12. */
export type LandingViewPoint = { day: string; views: number }

const LIST_COLUMNS =
  'id, slug, title, published, indexable, views, last_viewed_at, published_at, created_at, updated_at'

function mapPage(row: Record<string, unknown>): LandingPageRow {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    published: row.published === true,
    indexable: row.indexable === true,
    views: Number(row.views ?? 0),
    lastViewedAt: (row.last_viewed_at as string | null) ?? null,
    publishedAt: (row.published_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

// ──────────────────────────────────────────────
// Editor (panel del dueño — RLS del usuario)
// ──────────────────────────────────────────────

export async function listLandingPages(tenantId: string): Promise<LandingPageRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('landing_pages')
    .select(LIST_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('[landings.list]', error.message)
    return []
  }
  return (data ?? []).map((row) => mapPage(row as Record<string, unknown>))
}

export async function getLandingPage(
  tenantId: string,
  id: string,
): Promise<LandingPageDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('landing_pages')
    .select(`${LIST_COLUMNS}, html`)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) {
    console.error('[landings.get]', error.message)
    return null
  }
  if (!data) return null

  const row = data as Record<string, unknown>
  return { ...mapPage(row), html: (row.html as string | null) ?? '' }
}

/**
 * El historial NO trae el HTML: son hasta 20 documentos de medio mega cada uno
 * y la lista sólo muestra fecha y peso. Para eso está `size_chars`, una columna
 * generada (migración 20260905140000). El HTML se pide recién al mirar o
 * restaurar una versión puntual.
 */
export async function listLandingVersions(
  tenantId: string,
  pageId: string,
): Promise<LandingVersionRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('landing_page_versions')
    .select('id, label, created_at, size_chars')
    .eq('tenant_id', tenantId)
    .eq('page_id', pageId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[landings.versions]', error.message)
    return []
  }

  return (data ?? []).map((row) => {
    const version = row as Record<string, unknown>
    return {
      id: version.id as string,
      label: (version.label as string | null) ?? null,
      createdAt: version.created_at as string,
      chars: Number(version.size_chars ?? 0),
    }
  })
}

/**
 * Últimos `days` días de visitas, con los días sin visitas en cero — así el
 * gráfico no miente comprimiendo el tiempo.
 */
export async function getLandingViewSeries(
  tenantId: string,
  pageId: string,
  days = 14,
): Promise<LandingViewPoint[]> {
  const today = todayInCordoba()
  const from = new Date(`${today}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - (days - 1))
  const fromDay = from.toISOString().slice(0, 10)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('landing_page_views')
    .select('day, views')
    .eq('tenant_id', tenantId)
    .eq('page_id', pageId)
    .gte('day', fromDay)

  if (error) {
    console.error('[landings.views]', error.message)
    return []
  }

  const byDay = new Map<string, number>()
  for (const row of data ?? []) {
    const point = row as Record<string, unknown>
    byDay.set(point.day as string, Number(point.views ?? 0))
  }

  const series: LandingViewPoint[] = []
  for (let i = 0; i < days; i += 1) {
    const cursor = new Date(`${fromDay}T00:00:00Z`)
    cursor.setUTCDate(cursor.getUTCDate() + i)
    const day = cursor.toISOString().slice(0, 10)
    series.push({ day, views: byDay.get(day) ?? 0 })
  }
  return series
}

/**
 * ¿El link está libre? Cross-tenant A PROPÓSITO: el slug es global (dos bares
 * no pueden tener /p/promo) y con el cliente del usuario las filas de otro bar
 * no se ven — diríamos "libre" y el insert reventaría con un 23505 críptico.
 * Por eso va con service_role, devolviendo SÓLO un booleano: ninguna fila de
 * otro tenant sale de esta función.
 */
export async function isLandingSlugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const service = createServiceClient()
  let query = service.from('landing_pages').select('id').eq('slug', slug).limit(1)
  if (exceptId) query = query.neq('id', exceptId)

  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[landings.slug-taken]', error.message)
    // Ante la duda decimos que está ocupado: el unique de la DB es la verdad,
    // y es mejor pedir otro nombre que prometer uno que después falla.
    return true
  }
  return Boolean(data)
}

// ──────────────────────────────────────────────
// Página pública (/p/[slug] — sin sesión)
// ──────────────────────────────────────────────

export type PublishedLanding = {
  id: string
  html: string
  indexable: boolean
}

/**
 * Lo que sirve el Route Handler. `service_role` porque no hay sesión y la
 * tabla no le da nada a `anon`; el filtro `published` es la única puerta.
 */
export async function getPublishedLanding(slug: string): Promise<PublishedLanding | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('landing_pages')
    .select('id, html, indexable')
    .eq('slug', slug)
    .eq('published', true)
    .maybeSingle()

  if (error) {
    console.error('[landings.public]', error.message)
    return null
  }
  if (!data) return null

  const html = (data.html as string | null) ?? ''
  // Publicada pero vacía = no hay nada que mostrar. Mejor 404 que una pantalla
  // en blanco con el dominio del bar.
  if (html.trim().length === 0) return null

  return { id: data.id as string, html, indexable: data.indexable === true }
}

/** Suma una visita. Atómico y en la zona del bar (ver bump_landing_view). */
export async function bumpLandingView(pageId: string): Promise<void> {
  const service = createServiceClient()
  const { error } = await service.rpc('bump_landing_view', { p_page: pageId })
  if (error) {
    // Que falle el contador nunca puede tumbar la página del bar.
    console.error('[landings.bump]', error.message)
  }
}
