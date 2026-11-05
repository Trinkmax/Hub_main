/**
 * Tex en Carta, Estadísticas y Configuración. Lo que se fija: que lo que arma pase los esquemas de la
 * acción real (corriendo la acción de verdad contra una base de mentira), la conversión de pesos a lo
 * que guarda la carta, que los datos personales y los secretos no salgan, y lo que puede tocar `editor`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listMenu: vi.fn(),
  listItemTags: vi.fn(),
  createClient: vi.fn(),
  requireTenantAccess: vi.fn(),
  getKpis: vi.fn(),
  getDailyMetrics: vi.fn(),
  getHeatmap: vi.fn(),
  getTopCustomersBySpent: vi.fn(),
  getChurnRisk: vi.fn(),
  getEventsRanking: vi.fn(),
  getCommunicationStats: vi.fn(),
  getStaffSummaries: vi.fn(),
  getReviewInsights: vi.fn(),
  listReviews: vi.fn(),
  getReviewSettings: vi.fn(),
  getTodaySalonOverview: vi.fn(),
  getZoneCapacityDefaults: vi.fn(),
  getDayReport: vi.fn(),
  getTemplateReport: vi.fn(),
  getMonthMarketingReport: vi.fn(),
  listEventTemplateOptions: vi.fn(),
  listRecentReservationDays: vi.fn(),
  getMonthBirthdayReport: vi.fn(),
  getSegmentEditorData: vi.fn(),
  listLandingPages: vi.fn(),
  getLandingViewSeries: vi.fn(),
  getLandingsBase: vi.fn(),
  getPublicLinkPage: vi.fn(),
  listPublicLinks: vi.fn(),
  getWelcomeRewardConfig: vi.fn(),
  updateWelcomeRewardConfig: vi.fn(),
  getAppUrl: vi.fn(),
  getTenantConfig: vi.fn(),
  updateTotalSeatsAction: vi.fn(),
  setZoneCapacityDefaults: vi.fn(),
  revalidatePath: vi.fn(),
  logAudit: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/tenant', async (actual) => ({
  ...(await actual<typeof import('@/lib/tenant')>()),
  requireTenantAccess: mocks.requireTenantAccess,
}))
vi.mock('@/lib/menu/queries', () => ({ listMenu: mocks.listMenu }))
vi.mock('@/lib/item-tags/queries', () => ({ listItemTags: mocks.listItemTags }))
vi.mock('@/lib/stats/queries', () => ({
  getKpis: mocks.getKpis,
  getDailyMetrics: mocks.getDailyMetrics,
  getHeatmap: mocks.getHeatmap,
  getTopCustomersBySpent: mocks.getTopCustomersBySpent,
  getChurnRisk: mocks.getChurnRisk,
  getEventsRanking: mocks.getEventsRanking,
  getCommunicationStats: mocks.getCommunicationStats,
}))
vi.mock('@/lib/staff-performance/queries', () => ({ getStaffSummaries: mocks.getStaffSummaries }))
vi.mock('@/lib/reviews/queries', () => ({
  getReviewInsights: mocks.getReviewInsights,
  listReviews: mocks.listReviews,
  getReviewSettings: mocks.getReviewSettings,
}))
vi.mock('@/lib/salon/queries', () => ({
  getTodaySalonOverview: mocks.getTodaySalonOverview,
  getZoneCapacityDefaults: mocks.getZoneCapacityDefaults,
  getDayReport: mocks.getDayReport,
  getTemplateReport: mocks.getTemplateReport,
  getMonthMarketingReport: mocks.getMonthMarketingReport,
  listEventTemplateOptions: mocks.listEventTemplateOptions,
  listRecentReservationDays: mocks.listRecentReservationDays,
}))
vi.mock('@/lib/salon/birthday-queries', () => ({
  getMonthBirthdayReport: mocks.getMonthBirthdayReport,
}))
vi.mock('@/lib/salon/segment-queries', () => ({ getSegmentEditorData: mocks.getSegmentEditorData }))
vi.mock('@/lib/salon/actions', () => ({ setZoneCapacityDefaults: mocks.setZoneCapacityDefaults }))
vi.mock('@/lib/landings/queries', () => ({
  listLandingPages: mocks.listLandingPages,
  getLandingViewSeries: mocks.getLandingViewSeries,
}))
vi.mock('@/lib/landings/urls', () => ({ getLandingsBase: mocks.getLandingsBase }))
vi.mock('@/lib/public-links/queries', () => ({
  getPublicLinkPage: mocks.getPublicLinkPage,
  listPublicLinks: mocks.listPublicLinks,
}))
vi.mock('@/lib/welcome-reward/queries', () => ({
  getWelcomeRewardConfig: mocks.getWelcomeRewardConfig,
}))
vi.mock('@/lib/welcome-reward/actions', () => ({
  updateWelcomeRewardConfig: mocks.updateWelcomeRewardConfig,
}))
vi.mock('@/lib/app-url', () => ({ getAppUrl: mocks.getAppUrl }))
vi.mock('@/lib/admin/tenant-config', () => ({ getTenantConfig: mocks.getTenantConfig }))
vi.mock('@/lib/tenant/actions', () => ({
  updateTotalSeatsAction: mocks.updateTotalSeatsAction,
}))

import { NAV_GROUPS } from '@/components/shell/nav-config'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import {
  createCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
} from '@/lib/menu/schemas'
import { buildMonthBirthdayReport } from '@/lib/salon/birthdays-report'
import { buildMonthMarketingReport, type EventMarketingRow } from '@/lib/salon/event-marketing'
import { aggregateDayReport, aggregateTemplateReport } from '@/lib/salon/events-report'
import { MENU_EDIT_ROLES } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { negocioScreens, TEX_ESTADISTICAS_TABS } from '@/lib/tex/area-screens/negocio'
import { negocioArea } from '@/lib/tex/areas/negocio'
import {
  TEX_SCREENS,
  texScreen,
  texScreenAllowed,
  texScreenHref,
  texScreensFor,
} from '@/lib/tex/screens'
import { texActionTools } from '@/lib/tex/tools/actions'
import {
  itemUpdatePayload,
  newItemFormData,
  newPriceCents,
} from '@/lib/tex/tools/negocio/_carta-values'
import { negocioManual } from '@/lib/tex/tools/negocio/_manual'
import { withoutContact } from '@/lib/tex/tools/negocio/_numeros-values'
import { texReadTools } from '@/lib/tex/tools/read'
import {
  type TexPrepared,
  type TexTool,
  type TexToolContext,
  type TexToolResult,
  toInputSchema,
} from '@/lib/tex/tools/types'
import { uiTools } from '@/lib/tex/tools/ui'

// ─── El bar de prueba ────────────────────────────────────────────────────────

const CTX: TexToolContext = {
  slug: 'hub',
  tenantId: '00000000-0000-4000-8000-0000000000aa',
  tenantName: 'Bar',
  userId: '00000000-0000-4000-8000-0000000000cc',
  role: 'owner',
  features: { reviews: true } as never,
  isAccountant: false,
  access: { read: false, write: false, admin: false },
  today: '2026-11-05',
}
const EDITOR: TexToolContext = { ...CTX, role: 'editor', features: {} as never }

const BEBIDAS = '11111111-1111-4111-8111-111111111111'
const VINOS = '22222222-2222-4222-8222-222222222222'
const COMIDA = '33333333-3333-4333-8333-333333333333'
const POSTRES = '44444444-4444-4444-8444-444444444444'
const FERNET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const MALBEC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const AGUA_BEBIDA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const AGUA_COMIDA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'
const ENSALADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'
const CORTESIA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'
const VEGANO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const PICANTE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const PHOTO = 'https://cdn.test/fernet.webp'

function category(over: Partial<MenuCategory> & { id: string; name: string }): MenuCategory {
  return { position: 1, active: true, image_url: null, parent_id: null, ...over }
}

function item(over: Partial<MenuItem> & { id: string; name: string }): MenuItem {
  return {
    category_id: BEBIDAS,
    description: null,
    price_cents: 500_000,
    points_override: null,
    position: 1,
    active: true,
    image_url: PHOTO,
    video_url: null,
    featured: false,
    tags: [],
    ...over,
  }
}

const TAGS = [
  { id: VEGANO, name: 'Vegano', color: '#00ff00', created_at: '', assignment_count: 2 },
  { id: PICANTE, name: 'Picante', color: '#ff0000', created_at: '', assignment_count: 0 },
]

const veganTag = { id: VEGANO, tenant_id: CTX.tenantId, name: 'Vegano', color: '#00ff00' }

const MENU = {
  categories: [
    category({ id: BEBIDAS, name: 'Bebidas' }),
    category({ id: VINOS, name: 'Vinos', parent_id: BEBIDAS }),
    category({ id: COMIDA, name: 'Comida', position: 2 }),
    category({ id: POSTRES, name: 'Postres', position: 3, active: false }),
  ],
  items: [
    item({ id: FERNET, name: 'Fernet con cola', description: 'Con hielo', featured: true }),
    item({
      id: MALBEC,
      name: 'Malbec',
      category_id: VINOS,
      price_cents: 1_250_000,
      image_url: null,
      tags: [veganTag],
    }),
    item({ id: AGUA_BEBIDA, name: 'Agua', price_cents: 200_000, active: false }),
    item({ id: AGUA_COMIDA, name: 'Agua', category_id: COMIDA, price_cents: 210_000 }),
    item({ id: ENSALADA, name: 'Ensalada César', category_id: COMIDA, price_cents: 900_000 }),
    item({ id: CORTESIA, name: 'Pan de cortesía', category_id: COMIDA, price_cents: 0 }),
  ],
}

// ─── Una base de mentira, para correr las acciones de verdad ─────────────────

type Write = { table: string; values: Record<string, unknown> | Array<Record<string, unknown>> }

function fakeSupabase() {
  const inserts: Write[] = []
  const updates: Write[] = []
  const from = (table: string) => {
    const done = { data: null as unknown, error: null, count: 1 }
    let wanted: readonly string[] = []
    const api = {
      select: () => api,
      eq: () => api,
      is: () => api,
      not: () => api,
      in: (_column: string, values: readonly string[]) => {
        wanted = values
        return api
      },
      gte: () => api,
      order: () => api,
      limit: () => api,
      returns: () => api,
      insert: (values: Write['values']) => {
        inserts.push({ table, values })
        done.data = { id: '99999999-9999-4999-8999-999999999999' }
        return api
      },
      update: (values: Record<string, unknown>) => {
        updates.push({ table, values })
        return api
      },
      delete: () => api,
      maybeSingle: async () => ({
        data:
          table === 'menu_categories' || table === 'menu_items'
            ? { id: BEBIDAS, position: 3 }
            : table === 'tenants'
              ? { total_seats: 120, settings: { meta_token: 'EAAB-secreto' } }
              : null,
        error: null,
      }),
      single: async () => ({ data: done.data, error: null }),
      // biome-ignore lint/suspicious/noThenProperty: imita al constructor de consultas de supabase.
      then: (resolve: (value: typeof done) => void) =>
        resolve(
          (table === 'item_tags' || table === 'menu_items') && done.data === null
            ? { ...done, data: wanted.map((id) => ({ id })) }
            : done,
        ),
    }
    return api
  }
  return {
    inserts,
    updates,
    client: {
      from,
      rpc: vi.fn(async (): Promise<{ data: unknown; error: null }> => ({ data: [], error: null })),
      auth: { getUser: async () => ({ data: { user: { id: CTX.userId } } }) },
    },
  }
}

let db: ReturnType<typeof fakeSupabase>

const access = (role: TenantRole) => ({
  tenant: {
    id: CTX.tenantId,
    name: 'Bar',
    slug: 'hub',
    timezone: 'America/Argentina/Cordoba',
    currency: 'ARS',
    logo_url: 'https://cdn.test/logo.png',
    brand_accent: '#112233',
    settings: { meta_token: 'EAAB-secreto', onboarding: { completed: true } },
    feature_flags: {},
  },
  role,
  user: { id: CTX.userId },
})

beforeEach(() => {
  vi.clearAllMocks()
  db = fakeSupabase()
  mocks.createClient.mockResolvedValue(db.client)
  mocks.requireTenantAccess.mockResolvedValue(access('owner'))
  mocks.listMenu.mockResolvedValue(MENU)
  mocks.listItemTags.mockResolvedValue(TAGS)
  mocks.getAppUrl.mockResolvedValue('https://app.test')
  mocks.getLandingsBase.mockResolvedValue('https://app.test/p')
})

// ─── Cómo se corren ──────────────────────────────────────────────────────────

const tools = negocioArea.tools

function toolNamed(name: string): TexTool {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`No está ${name}`)
  return tool
}

async function run(name: string, input: unknown, ctx = CTX): Promise<TexToolResult> {
  const tool = toolNamed(name)
  const parsed = tool.input.safeParse(input)
  if (!parsed.success) throw new Error(`Entrada inválida: ${parsed.error.message}`)
  return tool.run(parsed.data, ctx)
}

async function data(name: string, input: unknown = {}, ctx = CTX): Promise<unknown> {
  const result = await run(name, input, ctx)
  if (result.kind !== 'data') throw new Error(`Se esperaban datos: ${JSON.stringify(result)}`)
  return result.data
}

async function prepared(name: string, input: unknown, ctx = CTX): Promise<TexPrepared> {
  const result = await run(name, input, ctx)
  if (result.kind !== 'prepared') throw new Error(`Se esperaba un tique: ${JSON.stringify(result)}`)
  return result.prepared
}

async function errorOf(name: string, input: unknown, ctx = CTX): Promise<string> {
  const result = await run(name, input, ctx)
  if (result.kind !== 'error') throw new Error(`Se esperaba un error: ${JSON.stringify(result)}`)
  return result.message
}

function execute(ticket: TexPrepared, ctx = CTX) {
  const executor = negocioArea.executors[ticket.executor]
  if (!executor) throw new Error(`No está el ejecutor ${ticket.executor}`)
  return executor.run(ticket.payload, ctx)
}

const updateOf = (table: string) =>
  db.updates.find((write) => write.table === table)?.values as Record<string, unknown> | undefined
const insertOf = (table: string) =>
  db.inserts.find((write) => write.table === table)?.values as Record<string, unknown> | undefined

// ─── Las pantallas ───────────────────────────────────────────────────────────

const MANAGER = resolve(__dirname, '../../app/(manager)/[tenantSlug]')
const pageSource = (file: string) => readFileSync(join(MANAGER, file), 'utf8')
const routeOf = (path: string) => path.replace(':id', '[pageId]')

/** Dónde lee cada pantalla cada parámetro: un parámetro que la pantalla ignora engaña. */
const READS: Readonly<Record<string, Readonly<Record<string, readonly [string, RegExp]>>>> = {
  'estadisticas.resumen': { tab: ['estadisticas/page.tsx', /typeof sp\.tab === 'string'/] },
  'estadisticas.como_nos_fue': {
    fecha: ['estadisticas/como-nos-fue/page.tsx', /typeof sp\.dia === 'string'/],
  },
  'estadisticas.como_nos_fue_evento': {
    evento: ['estadisticas/como-nos-fue/page.tsx', /typeof sp\.evento === 'string'/],
  },
  'estadisticas.resenas': { estrellas: ['reviews/page.tsx', /parseRatingFilter\(sp\.rating\)/] },
  'estadisticas.pauta': {
    mes: ['estadisticas/como-nos-fue/page.tsx', /typeof sp\.mes === 'string'/],
  },
  'estadisticas.cumples': {
    mes: ['estadisticas/como-nos-fue/page.tsx', /typeof sp\.mes === 'string'/],
  },
}

describe('las pantallas', () => {
  it.each(negocioScreens.map((s) => [s.id, s.path] as const))('%s → %s existe', (_id, path) => {
    expect(existsSync(join(MANAGER, routeOf(path), 'page.tsx'))).toBe(true)
  })

  it('son todas del panel, no de Administración', () => {
    for (const screen of negocioScreens) expect(screen.root, screen.id).toBe(true)
  })

  it('no chocan con las de otra área', () => {
    const ids = TEX_SCREENS.map((screen) => screen.id)
    for (const screen of negocioScreens) {
      expect(ids.filter((id) => id === screen.id).length, screen.id).toBe(1)
    }
  })

  it('el :id de la ruta va declarado, y al revés', () => {
    for (const screen of negocioScreens) {
      expect(screen.path.includes(':id'), screen.id).toBe(screen.params?.includes('id') ?? false)
    }
  })

  const declared = negocioScreens.flatMap((screen) =>
    (screen.params ?? []).filter((p) => p !== 'id').map((param) => [screen.id, param] as const),
  )

  it.each(declared)('%s lee %s', (id, param) => {
    const evidence = READS[id]?.[param]
    expect(evidence, `Falta mirar dónde lee ${param} ${id}`).toBeDefined()
    if (evidence) expect(pageSource(evidence[0])).toMatch(evidence[1])
  })

  it('la tabla de lo que leen no tiene de más', () => {
    for (const [id, params] of Object.entries(READS)) {
      for (const param of Object.keys(params)) {
        expect(
          declared.some(([screen, p]) => screen === id && p === param),
          `${id} ${param}`,
        ).toBe(true)
      }
    }
  })

  it('las solapas de Estadísticas son las de su página', () => {
    const source = pageSource('estadisticas/page.tsx')
    const tabs = [...source.matchAll(/<TabsTrigger value="(\w+)"/g)].map((match) => match[1])
    expect([...tabs].sort()).toEqual([...TEX_ESTADISTICAS_TABS].sort())
    expect(texScreenHref('hub', 'estadisticas.resumen', { tab: 'mozos' })).toMatchObject({
      href: '/hub/estadisticas?tab=mozos',
    })
    expect(texScreenHref('hub', 'estadisticas.resumen', { tab: 'nada' })).toMatchObject({
      href: '/hub/estadisticas',
    })
  })

  it('las vistas fijas de Cómo nos fue son las que la página acepta', () => {
    const source = pageSource('estadisticas/como-nos-fue/page.tsx')
    for (const id of [
      'estadisticas.como_nos_fue_evento',
      'estadisticas.pauta',
      'estadisticas.cumples',
    ]) {
      const vista = new URLSearchParams(texScreen(id)?.query ?? '').get('vista')
      expect(source).toContain(`sp.vista === '${vista}'`)
    }
    expect(texScreenHref('hub', 'estadisticas.pauta', { mes: '2026-10' })).toMatchObject({
      href: '/hub/estadisticas/como-nos-fue?vista=pauta&mes=2026-10',
    })
  })

  it('Bienvenida abre esa pestaña del Club', () => {
    expect(pageSource('configuracion/bienvenida/page.tsx')).toContain('/club?tab=bienvenida')
  })

  it('una página pide su id', () => {
    expect(texScreenHref('hub', 'marketing.pagina').ok).toBe(false)
    expect(texScreenHref('hub', 'marketing.pagina', { id: FERNET })).toMatchObject({
      href: `/hub/paginas/${FERNET}`,
    })
  })

  describe('nunca arma un link fuera del bar', () => {
    const hostile = [
      '../../../login',
      '//evil.test',
      'https://evil.test',
      'javascript:alert(1)',
      '%2e%2e%2f',
      '2026-10\n',
    ]
    const cases = negocioScreens.flatMap((screen) => hostile.map((v) => [screen.id, v] as const))

    it.each(cases)('%s con %j', (id, value) => {
      const screen = texScreen(id)
      const link = texScreenHref('hub', id, {
        id: screen?.path.includes(':id') ? FERNET : value,
        mes: value,
        desde: value,
        hasta: value,
        tab: value,
        q: undefined,
      })
      expect(link.ok).toBe(true)
      if (!link.ok) return
      const url = new URL(link.href, 'https://bar.test')
      expect(url.origin).toBe('https://bar.test')
      expect(url.pathname === '/hub' || url.pathname.startsWith('/hub/')).toBe(true)
      expect(link.href).not.toContain('evil')
      expect(url.search).toBe(screen?.query ? `?${screen.query}` : '')
    })
  })

  describe('cada uno ve las suyas', () => {
    const ids = new Set(negocioScreens.map((screen) => screen.id))
    const seen = (role: TenantRole, features: Record<string, boolean> = {}) =>
      texScreensFor({ role, features, accounting: false })
        .filter((screen) => ids.has(screen.id))
        .map((screen) => screen.id)

    it('Contenido solo la Carta', () => {
      expect(seen('editor').sort()).toEqual(['carta.etiquetas', 'carta.items'])
    })

    it('Anfitrión y Contabilidad, nada de esto', () => {
      expect(seen('host')).toEqual([])
      expect(seen('accountant')).toEqual([])
    })

    it('el dueño, todo menos lo que el bar tiene apagado', () => {
      const owner = seen('owner')
      expect(owner).toContain('inicio')
      expect(owner).toContain('configuracion.equipo')
      expect(owner).not.toContain('estadisticas.resenas')
      expect(owner).not.toContain('local.mesas')
      expect(owner).not.toContain('local.auto_aceptacion')
    })

    it('lo que depende de una función, solo si está prendida', () => {
      const owner = seen('owner', { reviews: true, floor_plan: true, auto_accept: true })
      expect(owner).toContain('estadisticas.resenas')
      expect(owner).toContain('local.mesas')
      expect(owner).toContain('local.auto_aceptacion')
    })

    it('la portada es solo del dueño', () => {
      const home = texScreen('inicio')
      if (!home) throw new Error('falta inicio')
      expect(texScreenAllowed(home, { role: 'editor', features: {}, accounting: false })).toBe(
        false,
      )
    })
  })
})

// ─── Las herramientas ────────────────────────────────────────────────────────

describe('las herramientas', () => {
  it('no se pisan con las que ya existen', () => {
    const others = new Set(
      [...texReadTools, ...texActionTools, ...uiTools].map((tool) => tool.name),
    )
    const names = tools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(others.has(name), name).toBe(false)
  })

  it('ningún nombre se repite en todo Tex: la API rechazaría el pedido entero', () => {
    const root = resolve(__dirname, '../../lib/tex/tools')
    const sources = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(join(root, file), 'utf8'))
    const names = sources.flatMap((source) =>
      [...source.matchAll(/^\s*name: '((?:ver|buscar|preparar)_[a-z_]+)',$/gm)].map((m) => m[1]),
    )
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([])
  })

  it.each(tools.map((tool) => [tool.name, tool] as const))('%s está bien armada', (_name, tool) => {
    expect(tool.name).toMatch(/^(ver|buscar|preparar)_[a-z_]+$/)
    expect(tool.description.length).toBeGreaterThan(40)
    const schema = toInputSchema(tool.input)
    expect(schema.type).toBe('object')
    expect(typeof tool.need).toBe('object')
    // Lo mismo que las de Administración: una herramienta que Tex trae se paga en cada pedido que sigue.
    if (tool.name.startsWith('preparar_')) {
      expect(tool.description).toContain('No guarda nada')
      expect(tool.mood).toBe('working')
      expect(JSON.stringify(schema).length).toBeLessThan(2600)
    } else {
      expect(tool.description.length).toBeLessThanOrEqual(240)
      expect(JSON.stringify(schema).length).toBeLessThan(900)
    }
  })

  it('los nombres de los ejecutores tienen la forma de siempre', () => {
    for (const name of Object.keys(negocioArea.executors)) {
      expect(name).toMatch(/^[a-z]+\.[a-z_]+$/)
    }
  })

  const allowedFor = (role: TenantRole, features: Record<string, boolean> = {}) =>
    tools
      .filter((tool) => {
        const need = tool.need as { roles: readonly TenantRole[]; feature?: string }
        if (need.feature && !features[need.feature]) return false
        return need.roles.includes(role)
      })
      .map((tool) => tool.name)

  it('Contenido usa solo lo de la carta', () => {
    expect(allowedFor('editor').sort()).toEqual(
      [
        'buscar_producto',
        'preparar_cambio_producto',
        'preparar_categoria',
        'preparar_etiqueta',
        'preparar_etiquetar',
        'preparar_precios',
        'preparar_producto',
        'ver_carta',
        'ver_etiquetas',
        'ver_productos_por_estado',
      ].sort(),
    )
    for (const name of allowedFor('editor')) {
      expect((toolNamed(name).need as { roles: unknown }).roles).toBe(MENU_EDIT_ROLES)
    }
  })

  it('el dueño usa todo, y las reseñas solo si el bar las tiene', () => {
    expect(allowedFor('owner', { reviews: true }).length).toBe(tools.length)
    expect(allowedFor('owner')).not.toContain('ver_resenas')
  })

  it('el área la ven el dueño y Contenido', () => {
    expect(negocioArea.visible(CTX)).toBe(true)
    expect(negocioArea.visible(EDITOR)).toBe(true)
    expect(negocioArea.visible({ ...CTX, role: 'host' })).toBe(false)
    expect(negocioArea.visible({ ...CTX, role: 'accountant' })).toBe(false)
    expect(allowedFor('host')).toEqual([])
    expect(allowedFor('accountant')).toEqual([])
  })
})

// ─── Mirar la carta ──────────────────────────────────────────────────────────

describe('mirar la carta', () => {
  it('por arriba: las categorías con sus cuentas', async () => {
    const out = (await data('ver_carta')) as Record<string, unknown>
    expect(out).toMatchObject({ categorias: 4, productos: 6, pausados: 1, sin_foto: 1 })
    expect(out.filas).toEqual([
      { id: BEBIDAS, nombre: 'Bebidas', subcategorias: 1, productos: 3 },
      { id: COMIDA, nombre: 'Comida', productos: 3 },
      { id: POSTRES, nombre: 'Postres', pausada: true, productos: 0 },
    ])
  })

  it('una categoría, con tildes o sin ellas', async () => {
    const out = await data('ver_carta', { categoria: 'ÇOMIDA'.replace('Ç', 'C').toLowerCase() })
    expect(out).toMatchObject({ categoria: 'Comida' })
    expect((out as { productos: unknown[] }).productos).toHaveLength(3)
  })

  it('un producto muestra su precio en pesos, sin la foto ni centavos', async () => {
    const out = (await data('ver_carta', { categoria: 'Vinos' })) as {
      categoria: string
      productos: Array<Record<string, unknown>>
    }
    expect(out.categoria).toBe('Bebidas › Vinos')
    expect(out.productos[0]).toEqual({
      id: MALBEC,
      nombre: 'Malbec',
      categoria: 'Bebidas › Vinos',
      precio: '$ 12.500',
      sin_foto: true,
      etiquetas: ['Vegano'],
    })
    expect(JSON.stringify(out)).not.toContain('cdn.test')
  })

  it('busca por nombre, sin tildes y en cualquier orden', async () => {
    const out = (await data('buscar_producto', { buscar: 'cesar ensalada' })) as {
      filas: Array<{ id: string }>
      cuantos: number
    }
    expect(out.cuantos).toBe(1)
    expect(out.filas[0]?.id).toBe(ENSALADA)
  })

  it('lo sin foto, lo pausado y lo sin precio', async () => {
    const ids = async (estado: string) =>
      (
        (await data('ver_productos_por_estado', { estado })) as { filas: Array<{ id: string }> }
      ).filas.map((row) => row.id)
    expect(await ids('sin_foto')).toEqual([MALBEC])
    expect(await ids('pausados')).toEqual([AGUA_BEBIDA])
    expect(await ids('sin_precio')).toEqual([CORTESIA])
    expect(await ids('destacados')).toEqual([FERNET])
  })

  it('un video cuenta como foto: en la carta se ve su cuadro', async () => {
    mocks.listMenu.mockResolvedValue({
      ...MENU,
      items: [item({ id: FERNET, name: 'Fernet', image_url: null, video_url: 'https://v.test/a' })],
    })
    const out = (await data('ver_productos_por_estado', { estado: 'sin_foto' })) as {
      cuantos: number
    }
    expect(out.cuantos).toBe(0)
  })

  it('un producto disponible en una categoría pausada se avisa', async () => {
    mocks.listMenu.mockResolvedValue({
      ...MENU,
      items: [item({ id: FERNET, name: 'Flan', category_id: POSTRES })],
    })
    const out = (await data('ver_carta', { categoria: 'Postres' })) as {
      productos: Array<Record<string, unknown>>
    }
    expect(out.productos[0]?.categoria_pausada).toBe(true)
  })

  it('si no encuentra la categoría, dice las que hay', async () => {
    const message = await errorOf('ver_carta', { categoria: 'Tragos' })
    expect(message).toContain('Bebidas')
    expect(message).toContain('Comida')
  })

  it('las etiquetas con cuántos productos tienen', async () => {
    expect(await data('ver_etiquetas')).toMatchObject({
      filas: [
        { id: VEGANO, nombre: 'Vegano', productos: 2 },
        { id: PICANTE, nombre: 'Picante', productos: 0 },
      ],
    })
  })
})

// ─── Un producto nuevo ───────────────────────────────────────────────────────

describe('preparar_producto', () => {
  const INPUT = { nombre: 'Negroni', categoria: 'Bebidas', precio: 15500 }

  it('pasa de pesos a lo que guarda la carta', async () => {
    const ticket = await prepared('preparar_producto', INPUT)
    const { item: payload } = ticket.payload as { item: { price_cents: number } }
    expect(payload.price_cents).toBe(1_550_000)
    expect(createMenuItemSchema.safeParse(payload).success).toBe(true)
    expect(ticket.ticket.total).toEqual({ label: 'Precio', value: '$ 15.500' })
    expect(ticket.ticket.confirmLabel).toBe('Agregar a la carta')
    expect(ticket.ticket.entry).toEqual([])
  })

  it('no acepta centavos: la carta maneja pesos enteros', () => {
    const parsed = toolNamed('preparar_producto').input.safeParse({ ...INPUT, precio: 15500.5 })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toContain('pesos enteros')
  })

  it('avisa que se ve ya, que queda sin foto y si ya hay uno igual', async () => {
    const keys = async (input: unknown) =>
      (await prepared('preparar_producto', input)).ticket.warnings.map((w) => w.key)
    expect(await keys(INPUT)).toEqual(['carta_publica', 'sin_foto'])
    expect(await keys({ ...INPUT, nombre: 'FERNET CON COLA' })).toContain('duplicado')
    expect(await keys({ ...INPUT, categoria: 'Postres' })).toContain('categoria_pausada')
    expect(await keys({ ...INPUT, categoria: 'Postres' })).not.toContain('carta_publica')
  })

  it('si la categoría no es una sola, vuelve con las opciones', async () => {
    mocks.listMenu.mockResolvedValue({
      ...MENU,
      categories: [...MENU.categories, category({ id: POSTRES, name: 'Vinos', parent_id: COMIDA })],
    })
    const message = await errorOf('preparar_producto', { ...INPUT, categoria: 'Vinos' })
    expect(message).toContain('Bebidas › Vinos')
    expect(message).toContain('Comida › Vinos')
    expect(message).toContain(VINOS)
  })

  it('al confirmar, la acción de verdad inserta lo que se vio', async () => {
    const ticket = await prepared('preparar_producto', {
      ...INPUT,
      descripcion: 'Con vermut',
      puntos_extra: 5,
      destacado: true,
      etiquetas: ['Vegano'],
    })
    const done = await execute(ticket)
    expect(done).toMatchObject({
      ok: true,
      message: 'Ítem creado.',
      href: '/hub/menu',
      point: 'Bebidas',
    })
    expect(insertOf('menu_items')).toMatchObject({
      tenant_id: CTX.tenantId,
      category_id: BEBIDAS,
      name: 'Negroni',
      description: 'Con vermut',
      price_cents: 1_550_000,
      points_override: 5,
      image_url: null,
      video_url: null,
      featured: true,
    })
  })

  it('«destacado» apagado no viaja: el esquema de la acción lee cualquier texto como verdadero', async () => {
    const form = newItemFormData({
      category_id: BEBIDAS,
      name: 'Negroni',
      description: null,
      price_cents: 100,
      points_override: null,
      featured: false,
      tag_ids: [],
    })
    expect(form.has('featured')).toBe(false)
    expect(form.get('points_override')).toBeNull()
    const ticket = await prepared('preparar_producto', { ...INPUT, destacado: false })
    await execute(ticket)
    expect(insertOf('menu_items')).toMatchObject({ featured: false, points_override: null })
  })

  it('Contenido puede; otro rol lo frena la acción', async () => {
    mocks.requireTenantAccess.mockResolvedValue(access('editor'))
    const editor = await prepared('preparar_producto', INPUT, EDITOR)
    expect(await execute(editor, EDITOR)).toMatchObject({ ok: true })

    db = fakeSupabase()
    mocks.createClient.mockResolvedValue(db.client)
    mocks.requireTenantAccess.mockResolvedValue(access('host'))
    expect(await execute(editor)).toEqual({
      ok: false,
      kind: 'failed',
      message: 'No tenés permiso.',
    })
    expect(db.inserts).toEqual([])
  })
})

// ─── Cambiar un producto ─────────────────────────────────────────────────────

describe('preparar_cambio_producto', () => {
  it('el precio: antes, después, y el botón con verbo', async () => {
    const ticket = await prepared('preparar_cambio_producto', {
      producto: 'Fernet',
      precio: 6000,
    })
    expect(ticket.ticket).toMatchObject({
      kind: 'cambio_producto',
      rows: [{ label: 'Precio', value: '$ 5.000 → $ 6.000' }],
      total: { label: 'Precio nuevo', value: '$ 6.000' },
      confirmLabel: 'Cambiar el precio',
      entry: [],
    })
    expect(ticket.ticket.warnings.map((w) => w.key)).toEqual(['carta_publica'])
    expect((ticket.payload as { change: unknown }).change).toEqual({ price_cents: 600_000 })
  })

  it('al confirmar pasa la validación de la acción y guarda en centavos', async () => {
    const ticket = await prepared('preparar_cambio_producto', { producto: FERNET, precio: 6000 })
    expect(await execute(ticket)).toMatchObject({
      ok: true,
      href: '/hub/menu',
      point: 'Bebidas',
    })
    expect(updateOf('menu_items')).toMatchObject({
      category_id: BEBIDAS,
      name: 'Fernet con cola',
      description: 'Con hielo',
      price_cents: 600_000,
      image_url: PHOTO,
      active: true,
    })
    // Lo que no se pidió, no se toca.
    expect(updateOf('menu_items')).not.toHaveProperty('featured')
    expect(updateOf('menu_items')?.video_url).toBeNull()
  })

  it('lo que se le manda pasa el esquema de la acción, también sin ningún cambio más', () => {
    for (const product of MENU.items) {
      const payload = itemUpdatePayload(product, { price_cents: 700_000 })
      expect(updateMenuItemSchema.safeParse(payload).success, product.name).toBe(true)
    }
  })

  it('una foto o un video subidos mientras el tique esperaba no se pisan', async () => {
    const ticket = await prepared('preparar_cambio_producto', { producto: 'Malbec', precio: 13000 })
    const uploaded = 'https://cdn.test/nueva.webp'
    const clip = 'https://cdn.test/nueva_v.mp4'
    mocks.listMenu.mockResolvedValue({
      ...MENU,
      items: MENU.items.map((other) =>
        other.id === MALBEC ? { ...other, image_url: uploaded, video_url: clip } : other,
      ),
    })
    await execute(ticket)
    expect(updateOf('menu_items')).toMatchObject({
      image_url: uploaded,
      video_url: clip,
      price_cents: 1_300_000,
    })
  })

  it('sacarlo y volverlo a poner', async () => {
    const out = await prepared('preparar_cambio_producto', { producto: FERNET, disponible: false })
    expect(out.ticket).toMatchObject({
      title: 'Sacar de la carta',
      confirmLabel: 'Sacar de la carta',
    })
    expect(out.ticket.warnings[0]?.title).toContain('Deja de verse')
    expect(await execute(out)).toMatchObject({
      ok: true,
      message: 'Saqué «Fernet con cola» de la carta.',
    })
    expect(updateOf('menu_items')).toMatchObject({ active: false, price_cents: 500_000 })

    const back = await prepared('preparar_cambio_producto', {
      producto: AGUA_BEBIDA,
      disponible: true,
    })
    expect(back.ticket.confirmLabel).toBe('Volver a la carta')
  })

  it('volver a la carta en una categoría pausada no se ve: lo avisa', async () => {
    mocks.listMenu.mockResolvedValue({
      ...MENU,
      items: [item({ id: FERNET, name: 'Flan', category_id: POSTRES, active: false })],
    })
    const out = await prepared('preparar_cambio_producto', { producto: 'Flan', disponible: true })
    expect(out.ticket.warnings.map((w) => w.key)).toEqual(['categoria_pausada'])
  })

  it('un precio que se duplica o se parte al medio pide mirar el número', async () => {
    const out = await prepared('preparar_cambio_producto', { producto: FERNET, precio: 50000 })
    expect(out.ticket.warnings.map((w) => w.key)).toContain('precio_salto')
  })

  it('las etiquetas se suman y se sacan sobre las que tiene cuando se confirma', async () => {
    const out = await prepared('preparar_cambio_producto', {
      producto: 'Malbec',
      suma_etiquetas: ['Picante'],
      saca_etiquetas: ['Vegano'],
    })
    expect(out.ticket.rows).toEqual([
      { label: 'Suma etiquetas', value: 'Picante' },
      { label: 'Saca etiquetas', value: 'Vegano' },
    ])
    expect((out.payload as { change: unknown }).change).toEqual({
      tags_add: [PICANTE],
      tags_remove: [VEGANO],
    })
  })

  it('si no cambia nada, lo dice en vez de armar un tique', async () => {
    const message = await errorOf('preparar_cambio_producto', { producto: FERNET, precio: 5000 })
    expect(message).toContain('no hay nada para cambiar')
  })

  it('con dos «Agua» pregunta cuál, con los ids para seguir', async () => {
    const message = await errorOf('preparar_cambio_producto', { producto: 'agua', precio: 3000 })
    expect(message).toContain('Bebidas')
    expect(message).toContain('Comida')
    expect(message).toContain(AGUA_BEBIDA)
    expect(message).toContain(AGUA_COMIDA)
    expect(mocks.listMenu).toHaveBeenCalledTimes(1)
    const byId = await prepared('preparar_cambio_producto', {
      producto: AGUA_COMIDA,
      precio: 3000,
    })
    expect((byId.payload as { id: string }).id).toBe(AGUA_COMIDA)
  })

  it('si el producto ya no está al confirmar, no escribe', async () => {
    const ticket = await prepared('preparar_cambio_producto', { producto: FERNET, precio: 6000 })
    mocks.listMenu.mockResolvedValue({ ...MENU, items: [] })
    expect(await execute(ticket)).toMatchObject({ ok: false, kind: 'failed' })
    expect(db.updates).toEqual([])
  })
})

// ─── El aumento de precios ───────────────────────────────────────────────────

describe('preparar_precios', () => {
  it('redondea en pesos y nunca deja centavos', () => {
    expect(newPriceCents(500_000, { kind: 'percent', percent: 10 }, 1)).toBe(550_000)
    expect(newPriceCents(435_000, { kind: 'percent', percent: 10 }, 100)).toBe(480_000)
    expect(newPriceCents(435_000, { kind: 'percent', percent: 7.5 }, 1)).toBe(467_600)
    expect(newPriceCents(500_000, { kind: 'amount', cents: 50_000 }, 1)).toBe(550_000)
    expect(newPriceCents(500_000, { kind: 'amount', cents: -50_000 }, 1000)).toBe(500_000)
  })

  it('el tique dice cuántos cambian, con ejemplos del antes y el después', async () => {
    const ticket = await prepared('preparar_precios', { categoria: 'Comida', porcentaje: 10 })
    expect(ticket.ticket).toMatchObject({
      kind: 'precios',
      title: 'Aumento de precios',
      subtitle: 'Comida · +10 %',
      total: { label: 'Productos que cambian', value: '2' },
      confirmLabel: 'Subir 2 precios',
      entry: [],
    })
    expect(ticket.ticket.rows).toEqual([
      { label: 'Agua', value: '$ 2.100 → $ 2.310' },
      { label: 'Ensalada César', value: '$ 9.000 → $ 9.900' },
    ])
    expect(ticket.ticket.warnings.map((w) => w.key)).toEqual([
      'carta_publica',
      'sin_deshacer',
      'sin_precio',
    ])
  })

  it('una categoría incluye sus subcategorías y los pausados, y lo avisa', async () => {
    const ticket = await prepared('preparar_precios', { categoria: 'Bebidas', porcentaje: 10 })
    expect(ticket.ticket.total?.value).toBe('3')
    expect(ticket.ticket.rows.map((row) => row.label)).toContain('Malbec')
    const paused = ticket.ticket.warnings.find((w) => w.key === 'pausados')
    expect(paused?.title).toBe('Incluye 1 producto pausado: no se ve hasta que vuelva a la carta.')
  })

  it('se pueden dejar afuera los pausados', async () => {
    const ticket = await prepared('preparar_precios', {
      categoria: 'Bebidas',
      porcentaje: 10,
      sin_pausados: true,
    })
    expect(ticket.ticket.total?.value).toBe('2')
  })

  it('con muchos, cinco ejemplos repartidos y «Y N más»', async () => {
    mocks.listMenu.mockResolvedValue({
      ...MENU,
      items: Array.from({ length: 12 }, (_, i) =>
        item({
          id: `cccccccc-cccc-4ccc-8ccc-cccccccccc${String(i).padStart(2, '0')}`,
          name: `Trago ${i}`,
          price_cents: (i + 1) * 100_000,
        }),
      ),
    })
    const ticket = await prepared('preparar_precios', { toda_la_carta: true, porcentaje: 10 })
    expect(ticket.ticket.rows).toHaveLength(6)
    expect(ticket.ticket.rows[0]).toEqual({ label: 'Trago 0', value: '$ 1.000 → $ 1.100' })
    expect(ticket.ticket.rows[4]).toEqual({ label: 'Trago 11', value: '$ 12.000 → $ 13.200' })
    expect(ticket.ticket.rows[5]).toEqual({ label: 'Y 7 más', value: 'con la misma cuenta' })
    expect(ticket.ticket.total?.value).toBe('12')
  })

  it('una baja: otro título, otro botón', async () => {
    const ticket = await prepared('preparar_precios', {
      productos: [FERNET],
      monto: -500,
    })
    expect(ticket.ticket).toMatchObject({
      title: 'Baja de precios',
      subtitle: 'Fernet con cola · -$ 500',
      confirmLabel: 'Bajar el precio',
    })
  })

  it('con productos sueltos, por nombre o id, sin repetir', async () => {
    const ticket = await prepared('preparar_precios', {
      productos: ['Fernet', FERNET, 'Malbec'],
      porcentaje: 5,
    })
    expect(ticket.ticket.total?.value).toBe('2')
  })

  it('pide a qué y cuánto, uno solo de cada', async () => {
    expect(await errorOf('preparar_precios', { porcentaje: 10 })).toContain('a qué')
    expect(
      await errorOf('preparar_precios', {
        categoria: 'Comida',
        toda_la_carta: true,
        porcentaje: 1,
      }),
    ).toContain('a qué')
    expect(await errorOf('preparar_precios', { categoria: 'Comida' })).toContain('cuánto')
    expect(
      await errorOf('preparar_precios', { categoria: 'Comida', porcentaje: 5, monto: 100 }),
    ).toContain('cuánto')
    expect(await errorOf('preparar_precios', { categoria: 'Comida', porcentaje: 0 })).toContain(
      'cero',
    )
  })

  it('si con eso no cambia nada, o bajaría a cero, lo dice', async () => {
    expect(await errorOf('preparar_precios', { productos: [CORTESIA], porcentaje: 10 })).toContain(
      'no cambia ningún precio',
    )
    const ticket = await prepared('preparar_precios', {
      productos: [FERNET, AGUA_COMIDA],
      monto: -3000,
    })
    expect(ticket.ticket.total?.value).toBe('1')
    expect(ticket.ticket.warnings.map((w) => w.key)).toContain('muy_bajo')
  })

  it('al confirmar, cada precio pasa por la acción de verdad y conserva lo demás', async () => {
    const ticket = await prepared('preparar_precios', { categoria: 'Comida', porcentaje: 10 })
    const done = await execute(ticket)
    expect(done).toMatchObject({
      ok: true,
      message: 'Cambié 2 precios.',
      href: '/hub/menu',
      point: 'Comida',
      undoUntil: null,
    })
    const written = db.updates.map((write) => write.values as Record<string, unknown>)
    expect(written.map((values) => values.price_cents)).toEqual([231_000, 990_000])
    for (const values of written) {
      expect(values.image_url).toBe(PHOTO)
      expect(values.category_id).toBe(COMIDA)
    }
  })

  it('un precio que cambió mientras el tique esperaba no se toca', async () => {
    const ticket = await prepared('preparar_precios', { categoria: 'Comida', porcentaje: 10 })
    mocks.listMenu.mockResolvedValue({
      ...MENU,
      items: MENU.items.map((other) =>
        other.id === ENSALADA ? { ...other, price_cents: 950_000 } : other,
      ),
    })
    const done = await execute(ticket)
    expect(done).toMatchObject({ ok: true })
    if (done.ok) {
      expect(done.message).toContain('Cambié 1 precio')
      expect(done.message).toContain('Ensalada César')
    }
    expect(db.updates).toHaveLength(1)
  })

  it('si la acción se corta a la mitad, dice qué quedó de cada lado', async () => {
    mocks.listMenu.mockResolvedValue({
      ...MENU,
      items: Array.from({ length: 7 }, (_, i) =>
        item({
          id: `cccccccc-cccc-4ccc-8ccc-cccccccccc${String(i).padStart(2, '0')}`,
          name: `Trago ${i}`,
          price_cents: 100_000,
        }),
      ),
    })
    const ticket = await prepared('preparar_precios', { toda_la_carta: true, porcentaje: 10 })
    // La tercera escritura falla: la primera tanda (5) termina y la segunda ya no arranca.
    let writes = 0
    const client = db.client
    mocks.createClient.mockResolvedValue({
      ...client,
      from: (table: string) => {
        const query = client.from(table)
        return {
          ...query,
          update: () => {
            writes += 1
            const failing = writes === 3
            const chain = {
              eq: () => chain,
              // biome-ignore lint/suspicious/noThenProperty: imita al constructor de consultas de supabase.
              then: (resolve: (value: unknown) => void) =>
                resolve({ error: failing ? { message: 'boom' } : null }),
            }
            return chain
          },
        }
      },
    })
    const done = await execute(ticket)
    expect(done).toMatchObject({ ok: false, kind: 'failed' })
    if (!done.ok && done.kind === 'failed') {
      expect(done.message).toContain('Cambié 4 de 7')
      expect(done.message).toContain('no hay que volver a aumentarlos')
      expect(done.message).toContain('Trago 5')
      expect(done.message).toContain('Trago 6')
    }
    expect(writes).toBe(5)
  })

  it('un tique roto no escribe', async () => {
    const executor = negocioArea.executors['negocio.precios']
    expect(await executor?.run({ lines: [] }, CTX)).toMatchObject({ ok: false, kind: 'failed' })
    expect(db.updates).toEqual([])
  })
})

// ─── Las categorías y las etiquetas ──────────────────────────────────────────

describe('preparar_categoria', () => {
  it('una nueva, adentro de otra, pasa el esquema y la acción la crea', async () => {
    const ticket = await prepared('preparar_categoria', { nombre: 'Tragos', dentro_de: 'Bebidas' })
    expect(ticket.ticket).toMatchObject({
      title: 'Subcategoría nueva',
      confirmLabel: 'Crear la categoría',
    })
    expect(createCategorySchema.safeParse(ticket.payload).success).toBe(true)
    expect(await execute(ticket)).toMatchObject({ ok: true, point: 'Bebidas', href: '/hub/menu' })
    expect(insertOf('menu_categories')).toMatchObject({
      tenant_id: CTX.tenantId,
      name: 'Tragos',
      parent_id: BEBIDAS,
      image_url: null,
    })
  })

  it('pausarla cuenta qué deja de verse y que sus subcategorías quedan a la vista', async () => {
    const ticket = await prepared('preparar_categoria', {
      categoria: 'Bebidas',
      disponible: false,
    })
    expect(ticket.ticket.confirmLabel).toBe('Pausar la categoría')
    expect(ticket.ticket.warnings.map((w) => w.title)).toEqual([
      'Sus 2 productos dejan de verse en la carta pública apenas confirmes.',
      'Sus subcategorías activas siguen a la vista y pasan al primer nivel de la carta. Para ocultarlas, hay que pausarlas también.',
    ])
    await execute(ticket)
    expect(updateOf('menu_categories')).toEqual({ name: 'Bebidas', active: false, image_url: null })
  })

  it('renombrarla conserva la foto que tenga al confirmar', async () => {
    const ticket = await prepared('preparar_categoria', { categoria: COMIDA, nombre: 'Platos' })
    const photo = 'https://cdn.test/categoria.webp'
    mocks.listMenu.mockResolvedValue({
      ...MENU,
      categories: MENU.categories.map((c) => (c.id === COMIDA ? { ...c, image_url: photo } : c)),
    })
    expect(await execute(ticket)).toMatchObject({ ok: true, point: 'Platos' })
    expect(updateOf('menu_categories')).toEqual({ name: 'Platos', active: true, image_url: photo })
  })

  it('moverla usa la acción de mover, nunca adentro de sí misma', async () => {
    expect(
      await errorOf('preparar_categoria', { categoria: 'Bebidas', dentro_de: 'Vinos' }),
    ).toContain('adentro de sí misma')
    const ticket = await prepared('preparar_categoria', {
      categoria: 'Vinos',
      al_primer_nivel: true,
    })
    expect(ticket.ticket.rows).toEqual([{ label: 'Queda en', value: 'Primer nivel' }])
    expect(await execute(ticket)).toMatchObject({ ok: true, point: 'Vinos' })
    expect(db.client.rpc).toHaveBeenCalledWith('move_category', {
      p_category_id: VINOS,
      p_new_parent_id: null,
    })
    expect(db.updates).toEqual([])
  })

  it('sin nombre no hay categoría nueva; sin cambios no hay tique', async () => {
    expect(await errorOf('preparar_categoria', {})).toContain('cómo se llama')
    expect(
      await errorOf('preparar_categoria', { categoria: 'Comida', nombre: 'Comida' }),
    ).toContain('no hay nada para cambiar')
  })
})

describe('las etiquetas', () => {
  it('una nueva llega a la acción con su color', async () => {
    const ticket = await prepared('preparar_etiqueta', { nombre: 'Sin TACC' })
    expect(ticket.ticket.confirmLabel).toBe('Crear la etiqueta')
    expect(await execute(ticket)).toMatchObject({
      ok: true,
      href: '/hub/menu/tags',
      point: '#Sin TACC',
    })
    expect(insertOf('item_tags')).toEqual({
      tenant_id: CTX.tenantId,
      name: 'Sin TACC',
      color: '#94a3b8',
    })
  })

  it('no repite una que ya está, aunque cambien las mayúsculas', async () => {
    expect(await errorOf('preparar_etiqueta', { nombre: 'VEGANO' })).toContain('Ya hay')
  })

  it('cambiarla avisa a cuántos productos les cambia', async () => {
    const ticket = await prepared('preparar_etiqueta', {
      etiqueta: 'Vegano',
      nombre: 'Plant based',
    })
    expect(ticket.ticket.warnings[0]?.title).toContain('los 2 productos')
    await execute(ticket)
    expect(updateOf('item_tags')).toEqual({ name: 'Plant based', color: '#00ff00' })
  })

  it('poner una etiqueta a varios saltea los que ya la tienen', async () => {
    const ticket = await prepared('preparar_etiquetar', {
      etiqueta: 'Vegano',
      categoria: 'Bebidas',
    })
    expect(ticket.ticket.total?.value).toBe('2')
    expect((ticket.payload as { item_ids: string[] }).item_ids.sort()).toEqual(
      [AGUA_BEBIDA, FERNET].sort(),
    )
  })

  it('al confirmar, la acción de verdad las asigna', async () => {
    const ticket = await prepared('preparar_etiquetar', {
      etiqueta: 'Picante',
      productos: ['Malbec', 'Fernet'],
    })
    expect(await execute(ticket)).toMatchObject({
      ok: true,
      href: '/hub/menu/tags',
      point: '#Picante',
    })
    expect(db.inserts.find((write) => write.table === 'menu_item_tag_assignments')?.values).toEqual(
      expect.arrayContaining([
        { menu_item_id: MALBEC, tag_id: PICANTE },
        { menu_item_id: FERNET, tag_id: PICANTE },
      ]),
    )
  })

  it('una etiqueta que no existe no se inventa', async () => {
    const message = await errorOf('preparar_etiquetar', {
      etiqueta: 'Keto',
      productos: ['Malbec'],
    })
    expect(message).toContain('preparar_etiqueta')
  })
})

// ─── Los números ─────────────────────────────────────────────────────────────

const PHONE = '+5493512839101'
const EMAIL = 'socia@bar.test'
const SECRET = 'EAAB-secreto'

const expectClean = (value: unknown) => {
  const text = JSON.stringify(value)
  expect(text).not.toContain(PHONE)
  expect(text).not.toContain('3512839101')
  expect(text).not.toContain(EMAIL)
  expect(text).not.toContain(SECRET)
  expect(text).not.toContain('"phone"')
  expect(text).not.toContain('"email"')
}

const KPIS = {
  customers_total: 200,
  customers_active_30d: 12,
  visits_30d: 60,
  revenue_30d_cents: 6_000_000,
  avg_ticket_30d_cents: 100_000,
}
const DAILY = [
  {
    day: '2026-09-20',
    visits: 10,
    revenue_cents: 1_000_000,
    customers_active: 5,
    customers_new: 2,
  },
  {
    day: '2026-10-20',
    visits: 20,
    revenue_cents: 2_000_000,
    customers_active: 6,
    customers_new: 3,
  },
]
const TOP = [
  {
    customer_id: FERNET,
    first_name: 'Ana',
    last_name: 'Pérez',
    total_visits: 9,
    total_spent_cents: 900_000,
    avg_ticket_cents: 100_000,
    last_visit_at: '2026-10-31T23:30:00-03:00',
    favorite_item_name: 'Fernet',
    phone: PHONE,
    email: EMAIL,
  },
]
const CHURN = [
  {
    customer_id: MALBEC,
    first_name: 'Beto',
    last_name: 'Gómez',
    phone: PHONE,
    total_visits: 5,
    visit_frequency_days: 7,
    days_since_last_visit: 30,
    last_visit_at: '2026-10-06T12:00:00Z',
    total_spent_cents: 500_000,
  },
]
const TODAY_OVERVIEW = {
  date: '2026-11-05',
  reservationsCount: 3,
  estimatedGuests: 8,
  peak: { startMin: 0, endMin: 0, startHHMM: '21:00', endHHMM: '22:30', guests: 6 },
  byStatus: { pending: 2, arrived: 1, seated: 0, closed: 0 },
  byMeal: {
    breakfast: { count: 0, guests: 0 },
    lunch: { count: 0, guests: 0 },
    tea_time: { count: 0, guests: 0 },
    dinner: { count: 3, guests: 8 },
    hub_event: { count: 0, guests: 0 },
  },
}

describe('ver_inicio', () => {
  beforeEach(() => {
    mocks.getKpis.mockResolvedValue(KPIS)
    mocks.getDailyMetrics.mockResolvedValue(DAILY)
    mocks.getTopCustomersBySpent.mockResolvedValue(TOP)
    mocks.getTodaySalonOverview.mockResolvedValue(TODAY_OVERVIEW)
    mocks.getZoneCapacityDefaults.mockResolvedValue({ planta_alta: 60, planta_baja: 0 })
  })

  it('lo que muestra la portada, en pesos', async () => {
    const out = (await data('ver_inicio')) as Record<string, unknown>
    expect(out.hoy).toEqual({
      fecha: '05/11/2026',
      reservas: 3,
      personas: 8,
      pendientes: 2,
      llegaron: 1,
      pico: '21:00 a 22:30, 6 personas',
      por_servicio: [{ servicio: 'Cena', reservas: 3, personas: 8 }],
    })
    expect(out.ultimos_30_dias).toMatchObject({
      clientes: 200,
      facturacion: '$ 60.000',
      ticket_promedio: '$ 1.000',
      visitas_contra_antes: 'sin base',
    })
    expect(out.falta_configurar).toEqual(['Definí la capacidad del salón'])
    expectClean(out)
  })

  it('el top lleva el nombre y el id, sin contacto; la fecha es la de Córdoba', async () => {
    const out = (await data('ver_inicio')) as {
      top_clientes_por_consumo_total: Array<Record<string, unknown>>
    }
    expect(out.top_clientes_por_consumo_total[0]).toEqual({
      id: FERNET,
      nombre: 'Ana Pérez',
      visitas: 9,
      consumo_total: '$ 9.000',
      ticket_promedio: '$ 1.000',
      ultima_visita: '31/10/2026',
      lo_que_mas_pide: 'Fernet',
    })
  })
})

describe('ver_estadisticas', () => {
  beforeEach(() => {
    mocks.getKpis.mockResolvedValue(KPIS)
    mocks.getDailyMetrics.mockResolvedValue(DAILY)
    mocks.getHeatmap.mockResolvedValue([
      { dow: 5, hour: 21, visit_count: 30 },
      { dow: 6, hour: 22, visit_count: 40 },
      { dow: 1, hour: 12, visit_count: 0 },
    ])
    mocks.getTopCustomersBySpent.mockResolvedValue(TOP)
    mocks.getChurnRisk.mockResolvedValue(CHURN)
    mocks.getEventsRanking.mockResolvedValue([
      {
        event_id: FERNET,
        event_name: 'Pizza libre',
        starts_at: '2026-11-20',
        reservations: 10,
        attended: 0,
        no_show: 0,
        no_show_rate: 0,
      },
    ])
    mocks.getCommunicationStats.mockResolvedValue({
      total_recipients: 10,
      sent: 2,
      delivered: 3,
      read: 4,
      failed: 1,
      opt_outs: 0,
    })
    mocks.getStaffSummaries.mockResolvedValue([
      {
        user_id: FERNET,
        email: EMAIL,
        full_name: 'Luz Soria',
        sessions_count: 4,
        party_size_share: 10,
        revenue_share_cents: 400_000,
        items_share: 7.5,
      },
      {
        user_id: MALBEC,
        email: EMAIL,
        full_name: null,
        sessions_count: 1,
        party_size_share: 2,
        revenue_share_cents: 100_000,
        items_share: 1,
      },
    ])
  })

  it('el resumen: por mes y los horarios fuertes', async () => {
    const out = (await data('ver_estadisticas')) as Record<string, unknown>
    expect(out.ultimos_90_dias).toEqual({
      facturacion: '$ 30.000',
      por_mes: [
        { mes: '2026-09', visitas: 10, facturacion: '$ 10.000' },
        { mes: '2026-10', visitas: 20, facturacion: '$ 20.000' },
      ],
    })
    expect(out.franjas_con_mas_visitas).toEqual([
      { franja: 'Sáb 22:00', visitas: 40 },
      { franja: 'Vie 21:00', visitas: 30 },
    ])
  })

  it('clientes: top y en riesgo, sin teléfonos', async () => {
    const out = await data('ver_estadisticas', { seccion: 'clientes', cantidad: 5 })
    expect(out).toMatchObject({
      en_riesgo_de_irse: {
        cuantos: 1,
        filas: [{ id: MALBEC, nombre: 'Beto Gómez', venia_cada_dias: 7, dias_sin_venir: 30 }],
      },
    })
    expectClean(out)
  })

  it('mozos: sin el mail, ni siquiera si no cargó su nombre', async () => {
    const out = (await data('ver_estadisticas', {
      seccion: 'mozos',
      periodo: 'este_mes',
    })) as { filas: Array<{ mozo: string }> }
    expect(out.filas.map((row) => row.mozo)).toEqual(['Luz Soria', 'Sin nombre cargado'])
    expectClean(out)
  })

  it('mozos: las fechas a medida quedan en el día de Córdoba', async () => {
    const out = await data('ver_estadisticas', {
      seccion: 'mozos',
      desde: '2026-10-01',
      hasta: '2026-10-15',
    })
    expect(out).toMatchObject({ desde: '01/10/2026', hasta: '15/10/2026' })
    expect(await errorOf('ver_estadisticas', { seccion: 'mozos', desde: '2026-10-01' })).toContain(
      'las dos fechas',
    )
  })

  it('eventos: marca lo que todavía no pasó', async () => {
    expect(await data('ver_estadisticas', { seccion: 'eventos' })).toMatchObject({
      filas: [{ evento: 'Pizza libre', fecha: '20/11/2026', todavia_no_paso: true, reservas: 10 }],
    })
  })

  it('comunicación: los conteos, sin un porcentaje que no cierra', async () => {
    const out = await data('ver_estadisticas', { seccion: 'comunicacion' })
    expect(out).toMatchObject({ destinatarios: 10, enviados: 2, entregados: 3, leidos: 4 })
    expect(JSON.stringify(out)).not.toContain('%')
  })
})

describe('ver_como_nos_fue', () => {
  const marketing = (over: Partial<EventMarketingRow> = {}): EventMarketingRow => ({
    scheduledEventId: FERNET,
    adSpendUsdCents: 17_526,
    messages: 51,
    reach: 8420,
    revenueArsCents: null,
    usdArsRate: 1450,
    revenuePerGuestArsCents: 2_700_000,
    costPerGuestArsCents: 1_500_000,
    drinkRevenuePerGuestArsCents: null,
    drinkCostPerGuestArsCents: null,
    notes: null,
    updatedAt: '2026-09-10T17:32:00Z',
    updatedByName: 'Socio S.',
    ...over,
  })
  const EVENT = {
    id: FERNET,
    template_id: MALBEC,
    name_override: null,
    event_date: '2026-10-20',
    starts_at_local: '21:00',
    capacity: 40,
    template: { id: MALBEC, name: 'Ramen', color_hex: '#ff0000' },
  }
  const ROWS = [
    {
      id: 'r1',
      reservation_date: '2026-10-20',
      scheduled_event_id: FERNET,
      estimated_guests: 4,
      actual_guests: 4,
      status: 'closed' as const,
    },
    {
      id: 'r2',
      reservation_date: '2026-10-20',
      scheduled_event_id: FERNET,
      estimated_guests: 2,
      actual_guests: null,
      status: 'pending' as const,
    },
    {
      id: 'r3',
      reservation_date: '2026-10-20',
      scheduled_event_id: null,
      estimated_guests: 3,
      actual_guests: null,
      status: 'cancelled' as const,
    },
  ]

  it('un día: por bloque, con la pauta y la cuenta redactadas', async () => {
    mocks.getDayReport.mockResolvedValue({
      ...aggregateDayReport({ day: '2026-10-20', events: [EVENT], rows: ROWS }),
      marketing: { [FERNET]: marketing() },
    })
    const out = (await data('ver_como_nos_fue', { vista: 'dia', fecha: '2026-10-20' })) as {
      personas: number
      bloques: Array<Record<string, unknown>>
    }
    expect(out.personas).toBe(6)
    const [evento, sinEvento] = out.bloques
    expect(evento).toMatchObject({
      titulo: 'Ramen',
      tipo: 'evento',
      personas: 6,
      reservas: 2,
      contadas_al_cerrar: 4,
      mesas_contadas: '1 de 2',
    })
    expect(evento?.pauta).toMatchObject({ mensajes: 51, invertido: 'US$ 175,26', cierre: '3,9 %' })
    expect(evento?.cuenta).toMatchObject({
      estado: 'completa',
      aclaracion: 'No es la ganancia del bar: no descuenta sueldos, alquiler ni impuestos.',
    })
    expect(sinEvento).toMatchObject({ tipo: 'sin evento', canceladas: 1 })
    expect(JSON.stringify(out)).not.toContain(' ')
    expect(JSON.stringify(out)).not.toContain('Socio')
  })

  it('sin pauta cargada no da cero: lo dice', async () => {
    mocks.getDayReport.mockResolvedValue({
      ...aggregateDayReport({ day: '2026-10-20', events: [EVENT], rows: ROWS }),
      marketing: {},
    })
    const out = (await data('ver_como_nos_fue', { fecha: '2026-10-20' })) as {
      bloques: Array<Record<string, unknown>>
    }
    expect(out.bloques[0]?.pauta).toBe('Sin cargar')
  })

  it('sin fecha abre en la última noche con gente, como la pantalla', async () => {
    mocks.listRecentReservationDays.mockResolvedValue([{ day: '2026-10-20', reservations: 2 }])
    mocks.getDayReport.mockResolvedValue({
      ...aggregateDayReport({ day: '2026-10-20', events: [], rows: [] }),
      marketing: {},
    })
    await data('ver_como_nos_fue', {})
    expect(mocks.getDayReport).toHaveBeenCalledWith({ tenantId: CTX.tenantId, day: '2026-10-20' })
    expect(await errorOf('ver_como_nos_fue', { fecha: '2026-02-30' })).toContain('no existe')
  })

  it('por evento: sin nombre la lista; con nombre, sus fechas y su rentabilidad', async () => {
    mocks.listEventTemplateOptions.mockResolvedValue({
      options: [
        {
          id: MALBEC,
          name: 'Ramen',
          colorHex: null,
          editions: 2,
          pastEditions: 1,
          guests: 6,
          upcoming: 1,
        },
      ],
      truncated: false,
    })
    expect(await data('ver_como_nos_fue', { vista: 'evento' })).toMatchObject({
      filas: [{ id: MALBEC, evento: 'Ramen', fechas_hechas: 1, personas: 6, proximas: 1 }],
    })
    mocks.getTemplateReport.mockResolvedValue({
      ...aggregateTemplateReport({
        templateId: MALBEC,
        templateName: 'Ramen',
        colorHex: null,
        today: CTX.today,
        events: [EVENT],
        rows: ROWS,
      }),
      marketing: { [FERNET]: marketing() },
    })
    const out = (await data('ver_como_nos_fue', { vista: 'evento', evento: 'ramen' })) as {
      evento: string
      rentabilidad: { frase: string }
      filas: Array<Record<string, unknown>>
    }
    expect(mocks.getTemplateReport).toHaveBeenCalledWith({
      tenantId: CTX.tenantId,
      templateId: MALBEC,
      today: CTX.today,
    })
    expect(out.evento).toBe('Ramen')
    expect(out.filas[0]).toMatchObject({
      evento_id: FERNET,
      fecha: '20/10/2026',
      personas: 6,
      reservas: 2,
    })
    expect(String(out.filas[0]?.resultado)).toMatch(/La noche/)
    expect(await errorOf('ver_como_nos_fue', { vista: 'evento', evento: 'Sushi' })).toContain(
      'No encontré',
    )
  })

  it('la pauta de un mes, con lo que falta cargar', async () => {
    mocks.getMonthMarketingReport.mockResolvedValue({
      ...buildMonthMarketingReport({
        ym: '2026-10',
        today: CTX.today,
        editions: [
          {
            key: FERNET,
            eventId: FERNET,
            date: '2026-10-20',
            title: 'Ramen',
            colorHex: null,
            reservations: 2,
            guests: 6,
            billableGuests: 6,
            attendedGuests: 4,
            startsAtLocal: '21:00',
          },
          {
            key: MALBEC,
            eventId: MALBEC,
            date: '2026-10-21',
            title: 'Pizza',
            colorHex: null,
            reservations: 1,
            guests: 2,
            billableGuests: 2,
            attendedGuests: 0,
            startsAtLocal: '21:00',
          },
        ],
        marketing: { [FERNET]: marketing() },
        truncated: false,
      }),
      privateGroups: [],
    })
    const out = (await data('ver_como_nos_fue', { vista: 'pauta', mes: '2026-10' })) as {
      mes: string
      resumen: string[]
      faltan_cargar: { titulo: string; fechas: unknown[] }
      filas: unknown[]
    }
    expect(out.mes).toBe('Octubre de 2026')
    expect(out.resumen[0]).toContain('US$ 175,26')
    expect(out.faltan_cargar.titulo).toBe('Falta cargar 1 fecha que ya pasó')
    expect(out.filas).toHaveLength(1)
    expect(JSON.stringify(out)).not.toContain(' ')
  })

  it('los cumpleaños de un mes, sin nombres', async () => {
    mocks.getMonthBirthdayReport.mockResolvedValue(
      buildMonthBirthdayReport({
        ym: '2026-10',
        today: CTX.today,
        celebrated: [
          {
            id: 'c1',
            reservation_date: '2026-10-10',
            created_at: '2026-10-01T12:00:00Z',
            status: 'closed',
            estimated_guests: 6,
            actual_guests: 5,
            scheduled_event_id: null,
          },
        ],
        bookedInMonth: [],
        marketing: null,
        truncated: false,
      }),
    )
    const out = (await data('ver_como_nos_fue', { vista: 'cumples', mes: '2026-10' })) as {
      pauta: unknown
      filas: Array<Record<string, unknown>>
      frase: string
    }
    expect(out.frase).toContain('1 cumpleaños')
    expect(out.pauta).toBe('Sin cargar')
    expect(out.filas).toEqual([{ dia: 'sáb 10/10', cumples: 1, personas: 5 }])
  })

  it('un mes que no existe vuelve con su error', async () => {
    expect(await errorOf('ver_como_nos_fue', { vista: 'pauta', mes: '2026-13' })).toBeTruthy()
  })
})

describe('ver_resenas', () => {
  beforeEach(() => {
    mocks.getReviewInsights.mockResolvedValue({
      total: 3,
      average: 4.3,
      fiveStarPct: 67,
      distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 2 },
    })
    mocks.listReviews.mockResolvedValue([
      {
        id: FERNET,
        rating: 3,
        comment: `Mal atendidos. Llamame al ${PHONE} o a 351 283-9101, o escribime a ${EMAIL} o a @ana.perez`,
        createdAt: '2026-11-01T02:00:00Z',
        redirectedToMaps: false,
        customerId: MALBEC,
        customerName: 'Ana María Pérez',
      },
      {
        id: AGUA_BEBIDA,
        rating: 5,
        comment: null,
        createdAt: '2026-10-30T12:00:00Z',
        redirectedToMaps: true,
        customerId: null,
        customerName: null,
      },
    ])
  })

  it('el puntaje y los comentarios, sin datos de contacto', async () => {
    const out = (await data('ver_resenas', { estrellas: 3 })) as Record<string, unknown> & {
      filas: Array<Record<string, unknown>>
    }
    expect(out).toMatchObject({
      total: 3,
      promedio: 4.3,
      cinco_estrellas: '67 %',
      filtro: '3 estrellas',
    })
    expect(out.filas[0]).toMatchObject({
      id: FERNET,
      estrellas: 3,
      // En Córdoba todavía era el 31.
      fecha: '31/10/2026',
      cliente: 'Ana P.',
      cliente_id: MALBEC,
    })
    expect(String(out.filas[0]?.comentario)).toContain('Mal atendidos')
    expect(String(out.filas[0]?.comentario)).toContain('[teléfono]')
    expect(String(out.filas[0]?.comentario)).toContain('[mail]')
    expect(String(out.filas[0]?.comentario)).not.toContain('ana.perez')
    expect(out.filas[1]).toMatchObject({ cliente: 'Anónimo', fue_a_google: true })
    expectClean(out)
    expect(JSON.stringify(out)).not.toContain('283-9101')
    expect(mocks.listReviews).toHaveBeenCalledWith({
      tenantId: CTX.tenantId,
      rating: 3,
      limit: 15,
    })
  })

  it('un número común en un comentario no se tapa', () => {
    expect(withoutContact('Esperamos 20 minutos, mesa 12, 2 cafés')).toBe(
      'Esperamos 20 minutos, mesa 12, 2 cafés',
    )
  })
})

// ─── Marketing y configuración ───────────────────────────────────────────────

describe('las páginas y el link de Instagram', () => {
  const PAGE = {
    id: FERNET,
    slug: 'halloween',
    title: 'Halloween',
    published: true,
    indexable: false,
    views: 120,
    lastViewedAt: '2026-11-01T02:00:00Z',
    publishedAt: '2026-10-01T12:00:00Z',
    createdAt: '2026-09-30T12:00:00Z',
    updatedAt: '2026-10-02T12:00:00Z',
    html: '<html>no debería salir</html>',
  }

  it('la lista: link y visitas, nunca el HTML', async () => {
    mocks.listLandingPages.mockResolvedValue([PAGE, { ...PAGE, id: MALBEC, published: false }])
    const out = await data('ver_paginas')
    expect(out).toMatchObject({
      cuantas: 2,
      publicadas: 1,
      filas: [
        {
          id: FERNET,
          titulo: 'Halloween',
          link: 'https://app.test/p/halloween',
          publicada: true,
          visitas: 120,
          ultima_visita: '31/10/2026',
        },
        expect.anything(),
      ],
    })
    expect(JSON.stringify(out)).not.toContain('<html>')
  })

  it('una página: sus visitas de los últimos días', async () => {
    mocks.listLandingPages.mockResolvedValue([PAGE])
    mocks.getLandingViewSeries.mockResolvedValue([
      { day: '2026-11-01', views: 0 },
      { day: '2026-11-02', views: 7 },
    ])
    const out = await data('ver_paginas', { pagina: 'halloween' })
    expect(out).toMatchObject({
      visitas_ultimos_dias: 7,
      por_dia: [{ fecha: '02/11/2026', visitas: 7 }],
    })
    expect(JSON.stringify(out)).not.toContain('<html>')
  })

  it('el link de Instagram y sus botones', async () => {
    mocks.getPublicLinkPage.mockResolvedValue({ headline: 'Hola', bio: null, active: true })
    mocks.listPublicLinks.mockResolvedValue([
      {
        id: FERNET,
        label: 'Reservar',
        description: null,
        url: 'https://reservas.test',
        icon: null,
        highlight: true,
        position: 1,
        active: false,
      },
    ])
    expect(await data('ver_link_instagram')).toEqual({
      link: 'https://app.test/l/hub',
      pagina_prendida: true,
      titulo: 'Hola',
      botones: [
        {
          id: FERNET,
          texto: 'Reservar',
          a_donde: 'https://reservas.test',
          destacado: true,
          apagado: true,
        },
      ],
    })
  })
})

describe('ver_configuracion', () => {
  beforeEach(() => {
    mocks.getWelcomeRewardConfig.mockResolvedValue({
      tenant_id: CTX.tenantId,
      enabled: true,
      reward_id: FERNET,
      headline: 'Regalo de bienvenida',
      subtext: 'Registrate y llevátelo gratis',
      bonus_points: 50,
      updated_at: null,
      reward: {
        id: FERNET,
        name: 'Un café',
        description: null,
        image_url: null,
        stock: null,
        active: true,
        cost_points: 0,
      },
    })
    mocks.getReviewSettings.mockResolvedValue({
      googleMapsReviewUrl: 'https://g.page/r/bar/review',
      feedbackWhatsappPhone: PHONE,
      reviewGatingEnabled: true,
      reviewRewardPoints: 10,
    })
    mocks.getZoneCapacityDefaults.mockResolvedValue({ planta_alta: 60, planta_baja: 70 })
    mocks.getSegmentEditorData.mockResolvedValue({
      weekly: [
        { segment: 'dinner', iso_dow: 5, capacity: 120, warn_at: null },
        { segment: 'dinner', iso_dow: 1, capacity: 80, warn_at: null },
      ],
      settings: [{ segment: 'dinner', default_time: '21:00', warn_note: null }],
      overrides: [
        {
          segment: 'dinner',
          override_date: '2026-12-24',
          capacity: 40,
          warn_at: null,
          reason: 'Nochebuena',
        },
      ],
      fallbackTotal: 130,
    })
    db.client.rpc.mockResolvedValue({
      data: [
        {
          id: '1',
          user_id: '2',
          email: EMAIL,
          full_name: 'Luz Soria',
          role: 'host',
          created_at: '',
        },
        { id: '3', user_id: '4', email: EMAIL, full_name: null, role: 'editor', created_at: '' },
      ],
      error: null,
    })
  })

  it('todo junto, sin secretos ni contactos', async () => {
    const out = (await data('ver_configuracion')) as Record<string, Record<string, unknown>>
    expect(out.bar).toEqual({
      nombre: 'Bar',
      zona_horaria: 'America/Argentina/Cordoba',
      moneda: 'ARS',
      carta_publica: 'https://app.test/carta/hub',
      funciones_prendidas: ['Reseñas'],
    })
    expect(out.bienvenida).toMatchObject({
      regalo: 'Activo',
      recompensa: 'Un café',
      puntos_de_regalo: 50,
    })
    expect(out.resenas).toEqual({
      enlace_de_google: 'https://g.page/r/bar/review',
      whatsapp_de_feedback: 'Cargado',
      derivar_solo_5_estrellas: true,
      puntos_por_opinar: 10,
    })
    expect(out.salon).toMatchObject({
      capacidad_total: 120,
      planta_alta: 60,
      cupo_general_por_servicio: 130,
      cupo_por_servicio: [
        { servicio: 'Cena', hora_sugerida: '21:00', cupo_por_dia: { lunes: 80, viernes: 120 } },
      ],
    })
    expect(out.apariencia).toEqual({ logo: 'Cargado', color_de_marca: '#112233' })
    expect(out).not.toHaveProperty('equipo')
    expectClean(out)
  })

  it('una sección sola no lee lo demás', async () => {
    const out = await data('ver_configuracion', { seccion: 'resenas' })
    expect(Object.keys(out as object)).toEqual(['resenas'])
    expect(mocks.requireTenantAccess).not.toHaveBeenCalled()
    expect(mocks.getSegmentEditorData).not.toHaveBeenCalled()
  })

  it('el equipo: nombre y rol, nunca el mail', async () => {
    const out = await data('ver_configuracion', { seccion: 'equipo' })
    expect(out).toEqual({
      equipo: {
        cuantos: 2,
        filas: [
          { nombre: 'Luz Soria', rol: 'Anfitrión' },
          { nombre: 'Sin nombre cargado', rol: 'Contenido' },
        ],
      },
    })
    expectClean(out)
  })

  it('la auto-aceptación solo si el bar la tiene', async () => {
    mocks.getTenantConfig.mockResolvedValue({
      guest_idle_hours_to_rescan: 2,
      session_auto_abandon_hours: 8,
      ticket_auto_accept_enabled: true,
      ticket_auto_accept_max_cents: 5_000_000,
      ticket_auto_accept_max_items: null,
      kitchen_flow_enabled: false,
    })
    const off = (await data('ver_configuracion')) as object
    expect(off).not.toHaveProperty('auto_aceptacion')
    const on = (await data(
      'ver_configuracion',
      {},
      {
        ...CTX,
        features: { auto_accept: true } as never,
      },
    )) as Record<string, unknown>
    expect(on.auto_aceptacion).toMatchObject({
      comandas_automaticas: true,
      hasta_monto: '$ 50.000',
    })
  })
})

describe('preparar_bienvenida', () => {
  const CONFIG = {
    tenant_id: CTX.tenantId,
    enabled: false,
    reward_id: null,
    headline: 'Regalo de bienvenida',
    subtext: 'Registrate y llevátelo gratis',
    bonus_points: 0,
    updated_at: null,
    reward: null,
  }

  beforeEach(() => {
    mocks.getWelcomeRewardConfig.mockResolvedValue(CONFIG)
    mocks.updateWelcomeRewardConfig.mockResolvedValue({
      ok: true,
      message: 'Configuración guardada.',
    })
  })

  it('cambia el texto y manda lo mismo que el formulario', async () => {
    const ticket = await prepared('preparar_bienvenida', { titulo: 'Bienvenido al club' })
    expect(ticket.ticket.rows).toEqual([
      { label: 'Título', value: 'Regalo de bienvenida → Bienvenido al club' },
      { label: 'Regalo', value: 'Sigue apagado' },
    ])
    expect(await execute(ticket)).toMatchObject({
      ok: true,
      href: '/hub/configuracion/bienvenida',
    })
    const form = mocks.updateWelcomeRewardConfig.mock.calls[0]?.[2] as FormData
    expect(form.get('enabled')).toBe('false')
    expect(form.get('reward_id')).toBe('')
    expect(form.get('headline')).toBe('Bienvenido al club')
    expect(form.get('subtext')).toBe('Registrate y llevátelo gratis')
    expect(form.get('bonus_points')).toBe('0')
  })

  it('sin recompensa elegida no se activa: lleva a la pantalla', async () => {
    const message = await errorOf('preparar_bienvenida', { activa: true })
    expect(message).toContain('Club › Bienvenida')
    expect(mocks.updateWelcomeRewardConfig).not.toHaveBeenCalled()
  })

  it('con recompensa se activa, con su botón', async () => {
    mocks.getWelcomeRewardConfig.mockResolvedValue({
      ...CONFIG,
      reward_id: FERNET,
      reward: { name: 'Un café' },
    })
    const ticket = await prepared('preparar_bienvenida', { activa: true })
    expect(ticket.ticket.confirmLabel).toBe('Activar el regalo')
    expect(ticket.ticket.subtitle).toBe('Un café')
  })

  it('si ya está así, no arma nada', async () => {
    expect(await errorOf('preparar_bienvenida', { titulo: CONFIG.headline })).toContain(
      'no hay nada para cambiar',
    )
  })
})

describe('preparar_capacidad', () => {
  beforeEach(() => {
    mocks.getZoneCapacityDefaults.mockResolvedValue({ planta_alta: 60, planta_baja: 70 })
    mocks.updateTotalSeatsAction.mockResolvedValue({ ok: true, totalSeats: 150 })
    mocks.setZoneCapacityDefaults.mockResolvedValue({ ok: true, message: 'Listo.' })
  })

  it('la capacidad total', async () => {
    const ticket = await prepared('preparar_capacidad', { capacidad_total: 150 })
    expect(ticket.ticket.rows).toEqual([{ label: 'Capacidad total', value: '120 → 150' }])
    expect(await execute(ticket)).toMatchObject({ ok: true, href: '/hub/configuracion/salon' })
    expect(mocks.updateTotalSeatsAction).toHaveBeenCalledWith('hub', 150)
    expect(mocks.setZoneCapacityDefaults).not.toHaveBeenCalled()
  })

  it('una planta manda también la otra, porque la acción guarda las dos', async () => {
    const ticket = await prepared('preparar_capacidad', { planta_alta: 80 })
    expect(ticket.ticket.rows).toEqual([{ label: 'Planta alta', value: '60 → 80' }])
    expect(ticket.ticket.warnings.map((w) => w.key)).toEqual(['cupo_general'])
    await execute(ticket)
    expect(mocks.setZoneCapacityDefaults).toHaveBeenCalledWith('hub', {
      planta_alta: 80,
      planta_baja: 70,
    })
  })

  it('si la otra planta da cero, pregunta: no se pisa algo que no se pudo leer', async () => {
    mocks.getZoneCapacityDefaults.mockResolvedValue({ planta_alta: 0, planta_baja: 0 })
    expect(await errorOf('preparar_capacidad', { planta_alta: 80 })).toContain('planta baja')
    expect(mocks.setZoneCapacityDefaults).not.toHaveBeenCalled()
  })
})

// ─── El manual ───────────────────────────────────────────────────────────────

describe('el manual', () => {
  it('es lo que dice el área y entra en lo que se pidió', () => {
    expect(negocioArea.manual).toBe(negocioManual)
    expect(negocioManual.length).toBeLessThanOrEqual(6250)
  })

  it('orienta por todo el menú lateral', () => {
    for (const group of NAV_GROUPS) {
      for (const entry of group.items) expect(negocioManual, entry.label).toContain(entry.label)
    }
  })

  it('las herramientas que nombra existen', () => {
    const names = new Set(tools.map((tool) => tool.name))
    for (const [name] of negocioManual.matchAll(/\b(?:ver|buscar|preparar)_[a-z_]+\b/g)) {
      expect(names.has(name), name).toBe(true)
    }
  })

  it('no habla de un bar en particular', () => {
    expect(negocioManual).not.toMatch(/\bHUB\b|Ramen|Nacho|Córdoba/)
  })
})
