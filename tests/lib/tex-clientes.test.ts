/**
 * Clientes y Club en Tex. Las herramientas corren de punta a punta contra una base simulada, con las
 * funciones de consulta y las server actions DE VERDAD: lo que se prueba es que lo que arma el tique lo
 * acepte la acción real, que ninguna lectura salga del bar y que los datos personales no salgan nunca.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Filter = [op: string, column: string, value: unknown]
type Recorded = {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  filters: Filter[]
  ors: string[]
  payload?: unknown
}

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  queries: [] as unknown[],
  rpcs: [] as Array<{ name: string; args: unknown }>,
  rpcResult: {} as Record<string, { data?: unknown; error?: { message: string } }>,
  role: 'owner',
  listMenu: vi.fn(),
  listActiveMenu: vi.fn(),
  getTopCustomersBySpent: vi.fn(),
  getChurnRisk: vi.fn(),
  getCustomerInsights: vi.fn(),
}))

const TENANT = '00000000-0000-4000-8000-0000000000aa'

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  return String(a) < String(b) ? -1 : 1
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null; count: number | null }> {
  private readonly record: Recorded
  private head = false
  private mode: 'many' | 'maybe' | 'single' = 'many'
  private orders: Array<{ column: string; ascending: boolean }> = []
  private max: number | null = null
  private window: [number, number] | null = null

  constructor(table: string) {
    this.record = { table, op: 'select', filters: [], ors: [] }
    mocks.queries.push(this.record)
  }

  select(_columns?: string, opts?: { head?: boolean }) {
    if (opts?.head) this.head = true
    return this
  }
  insert(payload: unknown) {
    this.record.op = 'insert'
    this.record.payload = payload
    return this
  }
  update(payload: unknown) {
    this.record.op = 'update'
    this.record.payload = payload
    return this
  }
  upsert(payload: unknown) {
    this.record.op = 'upsert'
    this.record.payload = payload
    return this
  }
  delete() {
    this.record.op = 'delete'
    return this
  }
  private add(op: string, column: string, value: unknown) {
    this.record.filters.push([op, column, value])
    return this
  }
  eq(column: string, value: unknown) {
    return this.add('eq', column, value)
  }
  neq(column: string, value: unknown) {
    return this.add('neq', column, value)
  }
  is(column: string, value: unknown) {
    return this.add('is', column, value)
  }
  not(column: string, _op: string, value: unknown) {
    return this.add('not', column, value)
  }
  gt(column: string, value: unknown) {
    return this.add('gt', column, value)
  }
  gte(column: string, value: unknown) {
    return this.add('gte', column, value)
  }
  lt(column: string, value: unknown) {
    return this.add('lt', column, value)
  }
  ilike(column: string, value: string) {
    return this.add('ilike', column, value)
  }
  in(column: string, value: unknown[]) {
    return this.add('in', column, value)
  }
  or(filters: string) {
    this.record.ors.push(filters)
    return this
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: opts?.ascending ?? true })
    return this
  }
  limit(max: number) {
    this.max = max
    return this
  }
  range(from: number, to: number) {
    this.window = [from, to]
    return this
  }
  maybeSingle() {
    this.mode = 'maybe'
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }

  private matches(row: Row): boolean {
    for (const [op, column, value] of this.record.filters) {
      if (column.includes('.') || !(column in row)) continue
      const cell = row[column]
      if (op === 'eq' && cell !== value) return false
      if (op === 'neq' && cell === value) return false
      if (op === 'is' && cell !== value && !(value === null && cell === undefined)) return false
      if (op === 'not' && (cell === value || cell === undefined)) return false
      if (op === 'gt' && !(Number(cell) > Number(value))) return false
      if (op === 'gte' && String(cell) < String(value)) return false
      if (op === 'lt' && String(cell) >= String(value)) return false
      if (op === 'in' && !(value as unknown[]).includes(cell)) return false
      if (op === 'ilike' && !String(cell).includes(String(value).replaceAll('%', ''))) return false
    }
    return this.record.ors.every((filter) =>
      [...filter.matchAll(/(\w+)\.imatch\."([^"]*)"/g)].some(([, column, pattern]) =>
        new RegExp(pattern ?? '', 'i').test(String(row[column ?? ''] ?? '')),
      ),
    )
  }

  private run() {
    if (this.record.op !== 'select') {
      const created = { id: '99999999-9999-4999-8999-999999999999' }
      return { data: this.mode === 'many' ? [created] : created, error: null, count: null }
    }
    let rows = (mocks.tables[this.record.table] ?? []).filter((row) => this.matches(row))
    const count = rows.length
    for (const { column, ascending } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => (ascending ? 1 : -1) * compare(a[column], b[column]))
    }
    if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1)
    if (this.max !== null) rows = rows.slice(0, this.max)
    if (this.head) return { data: null, error: null, count }
    if (this.mode !== 'many') return { data: rows[0] ?? null, error: null, count }
    return { data: rows, error: null, count }
  }

  // biome-ignore lint/suspicious/noThenProperty: es lo que hace awaitable a un builder de PostgREST.
  then<A = { data: unknown; error: null; count: number | null }, B = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null; count: number | null }) => A | PromiseLike<A>)
      | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }
}

const fakeClient = {
  from: (table: string) => new FakeQuery(table),
  rpc: async (name: string, args: unknown) => {
    mocks.rpcs.push({ name, args })
    const result = mocks.rpcResult[name]
    return { data: result?.data ?? null, error: result?.error ?? null }
  },
  auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/ip', () => ({ getRequestIp: async () => '10.0.0.1' }))
vi.mock('@/lib/tenant/current', () => ({ getCurrentUser: async () => ({ id: 'user-1' }) }))
vi.mock('@/lib/tenant', async () => {
  const errors = await vi.importActual<typeof import('@/lib/tenant/errors')>('@/lib/tenant/errors')
  const roles = await vi.importActual<typeof import('@/lib/tenant/roles')>('@/lib/tenant/roles')
  return {
    ...errors,
    ...roles,
    requireTenantAccess: async () => ({
      tenant: { id: TENANT },
      role: mocks.role,
      user: { id: 'user-1' },
    }),
    requireRole: (role: string, allowed: readonly string[]) => {
      if (!allowed.includes(role)) throw new errors.RoleRequiredError()
    },
  }
})
vi.mock('@/lib/menu/queries', () => ({
  listMenu: mocks.listMenu,
  listActiveMenu: mocks.listActiveMenu,
}))
vi.mock('@/lib/stats/queries', () => ({
  getTopCustomersBySpent: mocks.getTopCustomersBySpent,
  getChurnRisk: mocks.getChurnRisk,
  getCustomerInsights: mocks.getCustomerInsights,
}))

import {
  createCustomerSchema,
  listFiltersSchema,
  updateCustomerSchema,
} from '@/lib/customers/schemas'
import { createTierBenefitSchema, createTierSchema } from '@/lib/points/schemas'
import { clientesScreens, TEX_CLUB_TABS } from '@/lib/tex/area-screens/clientes'
import { clientesArea } from '@/lib/tex/areas/clientes'
import { texScreen, texScreenAllowed, texScreenHref } from '@/lib/tex/screens'
import {
  activeAmountRule,
  awardPoints,
  isRecentAward,
  partnerUrl,
  ruleWords,
} from '@/lib/tex/tools/clientes/_club-values'
import {
  ALERT_WORD_KEYS,
  ALERT_WORDS,
  birthdayRows,
  type CustomerFormRow,
  chooseCustomer,
  customerEditForm,
  customerEditValues,
  isRealBirthdate,
  maskEmail,
  nameFilter,
  parseCustomerQuery,
  phoneTail,
  pickByName,
  rankVisits,
} from '@/lib/tex/tools/clientes/_values'
import { clientesActionTools, clientesExecutors } from '@/lib/tex/tools/clientes/actions'
import { clubActionTools, clubExecutors } from '@/lib/tex/tools/clientes/club-actions'
import { clientesManual } from '@/lib/tex/tools/clientes/manual'
import { clientesReadTools } from '@/lib/tex/tools/clientes/read'
import {
  type TexExecutor,
  type TexPrepared,
  type TexToolContext,
  type TexToolResult,
  toInputSchema,
} from '@/lib/tex/tools/types'

const USER_CTX: TexToolContext = {
  slug: 'bar',
  tenantId: TENANT,
  tenantName: 'Un bar',
  userId: 'user-1',
  role: 'owner',
  features: {} as never,
  isAccountant: false,
  access: { read: false, write: false, admin: false },
  today: '2026-11-05',
}

const JUAN = '11111111-1111-4111-8111-111111111111'
const JUANA = '22222222-2222-4222-8222-222222222222'
const ANA = '33333333-3333-4333-8333-333333333333'
const TIER_LOW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const TIER_HIGH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const TAG_VIP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const TAG_WINE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const REWARD_COFFEE = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const REWARD_DINNER = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
const RULE_AMOUNT = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const RULE_ITEM = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'
const ITEM_FERNET = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const ITEM_COFFEE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
const CATEGORY_DRINKS = 'ffffffff-ffff-4fff-8fff-fffffffffff1'
const CATEGORY_EMPTY = 'ffffffff-ffff-4fff-8fff-fffffffffff2'
const PARTNER = '44444444-4444-4444-8444-444444444441'
const PARTNER_BENEFIT = '44444444-4444-4444-8444-444444444442'
const TIER_BENEFIT = '55555555-5555-4555-8555-555555555551'
const PUNCH = '66666666-6666-4666-8666-666666666661'
const CARD = '66666666-6666-4666-8666-666666666662'

const JUAN_PHONE = '+5493515559876'
const JUAN_MAIL = 'juan.perez@correo.test'
const JUAN_NOTE = 'Anotado: DNI 30111222, le gusta la ventana'
const JUAN_QR = 'qr-secreto-de-juan-0000'
const JUAN_IP = '200.1.2.3'

function customer(overrides: Row): Row {
  return {
    tenant_id: TENANT,
    deleted_at: null,
    email: null,
    notes: null,
    birthdate: null,
    opt_in_marketing: false,
    opt_in_ip: null,
    is_blocked: false,
    service_alerts: [],
    points_balance: 0,
    category_points: 0,
    total_visits: 0,
    total_spent_cents: 0,
    last_visit_at: null,
    current_tier_id: null,
    created_at: '2026-10-02T12:00:00+00:00',
    acquisition_channel: 'walkin',
    qr_token: 'qr-otro-0000',
    tags: [],
    ...overrides,
  }
}

function seed() {
  mocks.tables = {
    customers: [
      customer({
        id: JUAN,
        first_name: 'Juan',
        last_name: 'Pérez',
        phone: JUAN_PHONE,
        email: JUAN_MAIL,
        notes: JUAN_NOTE,
        birthdate: '1990-11-05',
        opt_in_marketing: true,
        opt_in_ip: JUAN_IP,
        service_alerts: ['celiac'],
        points_balance: 1200,
        category_points: 1500,
        total_visits: 12,
        total_spent_cents: 12_000_000,
        last_visit_at: '2026-11-01T01:30:00+00:00',
        current_tier_id: TIER_LOW,
        qr_token: JUAN_QR,
        created_at: '2026-11-03T12:00:00+00:00',
        tags: [{ tag: { id: TAG_VIP, name: 'VIP', color: '#000000' } }],
      }),
      customer({
        id: JUANA,
        first_name: 'Juana',
        last_name: 'Gómez',
        phone: '+5493515551111',
        birthdate: '1985-11-20',
        last_visit_at: '2026-10-01T01:30:00+00:00',
      }),
      customer({
        id: ANA,
        first_name: 'Ana',
        last_name: 'Núñez',
        phone: '+5491144441234',
        birthdate: '2000-02-29',
        points_balance: 100,
      }),
    ],
    customer_tags: [
      {
        id: TAG_VIP,
        tenant_id: TENANT,
        name: 'VIP',
        color: '#000000',
      },
      {
        id: TAG_WINE,
        tenant_id: TENANT,
        name: 'Vinos premium',
        color: '#111111',
      },
    ],
    customer_tag_assignments: [
      { tag_id: TAG_VIP, customer_id: JUAN },
      { tag_id: TAG_VIP, customer_id: JUANA },
    ],
    loyalty_tiers: [
      {
        id: TIER_LOW,
        tenant_id: TENANT,
        name: 'Plata',
        color: '#aaaaaa',
        badge_icon: 'Star',
        min_category_points: 1000,
        sort: 1,
        perks: 'Café de bienvenida',
        active: true,
      },
      {
        id: TIER_HIGH,
        tenant_id: TENANT,
        name: 'Oro',
        color: '#bbbbbb',
        badge_icon: null,
        min_category_points: 2000,
        sort: 2,
        perks: null,
        active: true,
      },
    ],
    points_rules: [
      {
        id: RULE_AMOUNT,
        tenant_id: TENANT,
        type: 'per_amount',
        config: { every_cents: 100_000, points: 1 },
        priority: 100,
        active: true,
      },
      {
        id: RULE_ITEM,
        tenant_id: TENANT,
        type: 'per_item',
        config: { item_id: ITEM_FERNET, points: 5 },
        priority: 0,
        active: true,
      },
    ],
    rewards: [
      {
        id: REWARD_COFFEE,
        tenant_id: TENANT,
        name: 'Café gratis',
        description: null,
        cost_points: 500,
        stock: null,
        active: true,
        image_url: 'https://x.test/cafe.jpg',
        min_tier_id: null,
        category: 'desayuno',
        visible_in_catalog: true,
        sort: 1,
      },
      {
        id: REWARD_DINNER,
        tenant_id: TENANT,
        name: 'Cena para dos',
        description: null,
        cost_points: 800,
        stock: 2,
        active: true,
        image_url: null,
        min_tier_id: TIER_HIGH,
        category: null,
        visible_in_catalog: true,
        sort: 2,
      },
    ],
    partners: [
      {
        id: PARTNER,
        tenant_id: TENANT,
        name: 'Peluquería Sol',
        logo_url: 'https://x.test/logo.png',
        discount_label: null,
        category: 'Belleza',
        url: null,
        active: false,
        sort: 3,
      },
    ],
    partner_benefits: [
      {
        id: PARTNER_BENEFIT,
        tenant_id: TENANT,
        partner_id: PARTNER,
        label: '10 % off',
        description: null,
        discount_pct: 10,
        image_url: 'https://x.test/p.png',
        sort: 0,
        active: true,
        partner_benefit_tiers: [{ tier_id: TIER_LOW }],
      },
    ],
    tier_benefits: [
      {
        id: TIER_BENEFIT,
        tenant_id: TENANT,
        tier_id: TIER_LOW,
        kind: 'discount',
        label: '10 % en cafetería',
        description: null,
        icon: 'Percent',
        image_url: null,
        reward_id: null,
        cadence: 'none',
        quantity: 1,
        discount_pct: 10,
        discount_scope: 'cafetería',
        partner_id: null,
        sort: 4,
        active: true,
      },
    ],
    punch_card_templates: [
      {
        id: PUNCH,
        tenant_id: TENANT,
        name: 'Tarjeta del café',
        description: null,
        image_url: 'https://x.test/t.png',
        stamp_icon: 'Coffee',
        reward_label: 'un café gratis',
        trigger_type: 'manual',
        trigger_ref_id: null,
        threshold: 6,
        reward_id: REWARD_COFFEE,
        expires_after_days: null,
        active: true,
        sort: 1,
        config: { max_per_day: 2 },
        created_at: '2026-01-01',
        show_when_locked: true,
        rewards: { name: 'Café gratis' },
      },
    ],
    punch_card_template_tiers: [],
    customer_punch_cards: [
      {
        id: CARD,
        tenant_id: TENANT,
        customer_id: JUAN,
        template_id: PUNCH,
        current_stamps: 5,
        threshold_snapshot: 6,
        completed_at: null,
        expired_at: null,
      },
    ],
    points_transactions: [
      {
        id: 'tx-1',
        tenant_id: TENANT,
        customer_id: JUAN,
        delta: 12,
        reason: 'qr_award',
        payload: { amount_cents: 1_200_000 },
        created_at: '2026-11-01T01:30:00+00:00',
        visit_id: null,
        redemption_id: null,
      },
      {
        id: 'tx-2',
        tenant_id: TENANT,
        customer_id: JUAN,
        delta: -500,
        reason: 'reward_redeem',
        payload: { reward_name: 'Café gratis' },
        created_at: '2026-10-20T15:00:00+00:00',
        visit_id: null,
        redemption_id: null,
      },
    ],
    reward_redemptions: [
      {
        id: 'rr-1',
        tenant_id: TENANT,
        customer_id: JUAN,
        reward_id: REWARD_COFFEE,
        points_spent: 500,
        redeemed_at: '2026-10-20T15:00:00+00:00',
        status: 'delivered',
        reward: { name: 'Café gratis' },
      },
    ],
    visits: [
      {
        id: 'v1',
        tenant_id: TENANT,
        customer_id: JUANA,
        total_amount_cents: 900_000,
        visited_at: '2026-10-10T20:00:00+00:00',
      },
      {
        id: 'v2',
        tenant_id: TENANT,
        customer_id: JUAN,
        total_amount_cents: 100_000,
        visited_at: '2026-10-11T20:00:00+00:00',
      },
      {
        id: 'v3',
        tenant_id: TENANT,
        customer_id: JUAN,
        total_amount_cents: 200_000,
        visited_at: '2026-10-12T20:00:00+00:00',
      },
    ],
    tenants: [
      {
        id: TENANT,
        category_window_months: 4,
        points_redemption_enabled: false,
        points_to_cents_rate: 100,
        points_redemption_max_pct: 50,
        settings: {},
      },
    ],
    welcome_reward_configs: [],
  }
}

const MENU = {
  categories: [
    {
      id: CATEGORY_DRINKS,
      name: 'Tragos',
      position: 1,
      active: true,
      image_url: null,
      parent_id: null,
    },
    {
      id: CATEGORY_EMPTY,
      name: 'Carpeta sin ítems',
      position: 2,
      active: true,
      image_url: null,
      parent_id: null,
    },
  ],
  items: [
    {
      id: ITEM_FERNET,
      category_id: CATEGORY_DRINKS,
      name: 'Fernet',
      description: null,
      price_cents: 800_000,
      points_override: null,
      position: 1,
      active: true,
      image_url: null,
      video_url: null,
      featured: false,
      tags: [],
    },
    {
      id: ITEM_COFFEE,
      category_id: CATEGORY_DRINKS,
      name: 'Café',
      description: null,
      price_cents: 300_000,
      points_override: 2,
      position: 2,
      active: true,
      image_url: null,
      video_url: null,
      featured: false,
      tags: [],
    },
  ],
}

const ACTION_TOOLS = [...clientesActionTools, ...clubActionTools]
const EXECUTORS: Record<string, TexExecutor> = { ...clientesExecutors, ...clubExecutors }
const TOOLS = [...clientesReadTools, ...ACTION_TOOLS]

function toolNamed(name: string) {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`No está la herramienta ${name}`)
  return tool
}

function run(name: string, input: unknown = {}, ctx: TexToolContext = USER_CTX) {
  const tool = toolNamed(name)
  return tool.run(tool.input.parse(input), ctx)
}

function asData(result: TexToolResult): Record<string, never> {
  if (result.kind !== 'data') throw new Error(`Se esperaban datos y vino ${JSON.stringify(result)}`)
  return result.data as Record<string, never>
}

function asError(result: TexToolResult): string {
  if (result.kind !== 'error')
    throw new Error(`Se esperaba un error y vino ${JSON.stringify(result)}`)
  return result.message
}

function asPrepared(result: TexToolResult): TexPrepared {
  if (result.kind !== 'prepared')
    throw new Error(`Se esperaba un tique y vino ${JSON.stringify(result)}`)
  return result.prepared
}

/** Confirmar: el payload pasa por la base (`jsonb`) antes de llegar al ejecutor. */
function confirm(prepared: TexPrepared, ctx: TexToolContext = USER_CTX) {
  const executor = EXECUTORS[prepared.executor]
  if (!executor) throw new Error(`No está el ejecutor ${prepared.executor}`)
  return executor.run(JSON.parse(JSON.stringify(prepared.payload)), ctx)
}

function queries(): Recorded[] {
  return mocks.queries as Recorded[]
}

function writes(table: string, op?: Recorded['op']): Recorded[] {
  return queries().filter((q) => q.table === table && q.op !== 'select' && (!op || q.op === op))
}

function rowValue(prepared: TexPrepared, label: string): string | undefined {
  return prepared.ticket.rows.find((row) => row.label === label)?.value
}

beforeEach(() => {
  seed()
  mocks.queries.length = 0
  mocks.rpcs.length = 0
  mocks.rpcResult = {}
  mocks.role = 'owner'
  mocks.listMenu.mockResolvedValue(MENU)
  mocks.listActiveMenu.mockResolvedValue(MENU)
  mocks.getCustomerInsights.mockResolvedValue({
    total_visits: 12,
    avg_ticket_cents: 1_000_000,
    days_since_last_visit: 4,
    visit_frequency_days: 7.5,
    favorite_item_name: 'Fernet',
    favorite_category_name: 'Tragos',
  })
  mocks.getTopCustomersBySpent.mockResolvedValue([
    {
      customer_id: JUAN,
      first_name: 'Juan',
      last_name: 'Pérez',
      total_visits: 12,
      total_spent_cents: 12_000_000,
      avg_ticket_cents: 1_000_000,
      last_visit_at: '2026-11-01T01:30:00+00:00',
      favorite_item_name: 'Fernet',
    },
  ])
  mocks.getChurnRisk.mockResolvedValue([
    {
      customer_id: JUAN,
      first_name: 'Juan',
      last_name: 'Pérez',
      phone: JUAN_PHONE,
      total_visits: 12,
      visit_frequency_days: 7.5,
      days_since_last_visit: 30,
      last_visit_at: '2026-10-01T01:30:00+00:00',
      total_spent_cents: 12_000_000,
    },
  ])
})

describe('el contrato de cada herramienta', () => {
  it('los nombres son los de siempre y no chocan con nadie', () => {
    const names = TOOLS.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    const toolsDir = resolve(__dirname, '../../lib/tex/tools')
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry)
        return statSync(path).isDirectory() ? files(path) : [path]
      })
    const sources = files(toolsDir).map((file) => readFileSync(file, 'utf8'))
    for (const name of names) {
      const seen = sources.filter((source) => source.includes(`name: '${name}'`))
      expect(seen.length, `«${name}» está en más de un archivo`).toBe(1)
    }
  })

  it('las de mirar y las de preparar se distinguen', () => {
    for (const tool of clientesReadTools) {
      expect(tool.name).toMatch(/^(ver|buscar)_[a-z_]+$/)
      expect(tool.description.length).toBeGreaterThan(30)
    }
    for (const tool of ACTION_TOOLS) {
      expect(tool.name).toMatch(/^preparar_[a-z_]+$/)
      expect(tool.description).toContain('No guarda nada')
      expect(tool.mood).toBe('working')
    }
  })

  it('el esquema se puede describir y no pesa de más', () => {
    for (const tool of TOOLS) {
      const schema = toInputSchema(tool.input)
      expect(schema.type).toBe('object')
      expect(JSON.stringify(schema).length, tool.name).toBeLessThan(2600)
      expect(tool.doing(undefined as never).length).toBeGreaterThan(3)
      expect(tool.done(undefined as never).length).toBeGreaterThan(3)
    }
  })

  it('los ejecutores se llaman como pide el ciclo', () => {
    for (const name of Object.keys(EXECUTORS)) expect(name).toMatch(/^[a-z]+\.[a-z_]+$/)
  })

  it('el área está armada', () => {
    expect(clientesArea.tools.length).toBe(TOOLS.length)
    expect(clientesArea.executors).toEqual(EXECUTORS)
    expect(clientesArea.summary.length).toBeLessThan(200)
    expect(clientesArea.manual).toBe(clientesManual)
  })
})

describe('los permisos', () => {
  const ROLES = ['owner', 'editor', 'host', 'accountant', 'cashier', 'waiter', 'kitchen'] as const

  it('el área la ve solo el dueño', () => {
    for (const role of ROLES) {
      expect(clientesArea.visible({ ...USER_CTX, role })).toBe(role === 'owner')
    }
  })

  it('cada herramienta pide los mismos roles que la acción o la página', () => {
    const expected: Readonly<Record<string, readonly string[]>> = {
      buscar_cliente: ['owner'],
      ver_cliente: ['owner'],
      ver_mejores_clientes: ['owner'],
      ver_cumpleanos: ['owner'],
      ver_clientes_nuevos: ['owner'],
      ver_clientes_que_dejaron_de_venir: ['owner'],
      ver_etiquetas_clientes: ['owner'],
      ver_total_clientes: ['owner'],
      ver_club: ['owner'],
      ver_recompensas: ['owner'],
      ver_aliados: ['owner'],
      ver_punch_cards: ['owner'],
      preparar_cliente: ['owner', 'cashier'],
      preparar_etiqueta_cliente: ['owner', 'cashier'],
      preparar_puntos: ['owner', 'cashier', 'waiter'],
      preparar_canje: ['owner', 'cashier'],
      preparar_visita: ['owner', 'cashier'],
      preparar_sello: ['owner', 'cashier', 'waiter'],
      preparar_regla_puntos: ['owner'],
      preparar_nivel: ['owner'],
      preparar_beneficio_nivel: ['owner'],
      preparar_recompensa: ['owner'],
      preparar_aliado: ['owner'],
      preparar_beneficio_aliado: ['owner'],
      preparar_punch_card: ['owner'],
      preparar_pago_con_puntos: ['owner'],
    }
    expect(TOOLS.map((tool) => tool.name).sort()).toEqual(Object.keys(expected).sort())
    for (const tool of TOOLS) {
      const need = tool.need
      if (typeof need === 'string') throw new Error(`${tool.name} no es de Administración`)
      expect([...need.roles].sort(), tool.name).toEqual([...(expected[tool.name] ?? [])].sort())
    }
  })

  it('el tique no saltea a la acción: un rol sin permiso rebota al confirmar', async () => {
    const prepared = asPrepared(await run('preparar_puntos', { cliente: JUAN, monto: 10_000 }))
    mocks.role = 'host'
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: false,
      kind: 'failed',
      message: 'No tenés permiso.',
    })
    expect(mocks.rpcs).toEqual([])
  })
})

describe('los datos personales no salen', () => {
  const SECRETS = [
    JUAN_PHONE,
    '5493515559876',
    '3515559876',
    JUAN_MAIL,
    'correo.test',
    JUAN_NOTE,
    '30111222',
    JUAN_QR,
    JUAN_IP,
    '1990',
    'celiac',
    'Celíaco',
  ]

  function expectClean(value: unknown) {
    const text = JSON.stringify(value)
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret)
  }

  it.each([
    ['buscar_cliente', { buscar: 'Juan Pérez' }],
    ['buscar_cliente', { buscar: '9876' }],
    ['buscar_cliente', { nivel: 'Plata' }],
    ['ver_cliente', { cliente: 'Juan Pérez' }],
    ['ver_cliente', { cliente: JUAN }],
    ['ver_mejores_clientes', {}],
    ['ver_mejores_clientes', { por: 'visitas' }],
    ['ver_mejores_clientes', { por: 'puntos' }],
    ['ver_mejores_clientes', { mes: '2026-10' }],
    ['ver_cumpleanos', { mes: '2026-11' }],
    ['ver_clientes_nuevos', { mes: '2026-11' }],
    ['ver_clientes_que_dejaron_de_venir', {}],
    ['ver_total_clientes', {}],
  ])('%s con %j', async (name, input) => {
    const result = await run(name, input)
    expect(result.kind).toBe('data')
    expectClean(result)
  })

  it('tampoco en las opciones cuando hay varios', async () => {
    const message = asError(await run('ver_cliente', { cliente: 'Juan' }))
    expect(message).toContain('Juan Pérez …9876')
    expect(message).toContain(`id ${JUAN}`)
    expect(message).toContain('Juana Gómez …1111')
    expectClean(message)
  })

  it('un mail que no está no se repite', async () => {
    const message = asError(await run('ver_cliente', { cliente: 'nadie@correo.test' }))
    expect(message).not.toContain('nadie')
    expect(message).toContain('ese mail')
  })

  it('un teléfono que no está no se repite', async () => {
    const message = asError(await run('ver_cliente', { cliente: '+54 9 351 000 0000' }))
    expect(message).not.toContain('351')
    expect(message).toContain('ese teléfono')
  })

  it('el tique muestra el teléfono y el mail enmascarados', async () => {
    const prepared = asPrepared(
      await run('preparar_cliente', {
        nombre: 'Pedro',
        apellido: 'Sosa',
        telefono: '351 666 1234',
        mail: 'pedro.sosa@correo.test',
      }),
    )
    expect(rowValue(prepared, 'Teléfono')).toBe('…1234')
    expect(rowValue(prepared, 'Mail')).toBe('p…@correo.test')
    const ticket = JSON.stringify(prepared.ticket)
    expect(ticket).not.toContain('6661234')
    expect(ticket).not.toContain('pedro.sosa')
  })

  it('lo que le vuelve a Tex al confirmar tampoco los trae', async () => {
    const prepared = asPrepared(
      await run('preparar_cliente', {
        cliente: JUAN,
        telefono: '351 777 5678',
        mail: 'nuevo@correo.test',
      }),
    )
    const execution = await confirm(prepared)
    expect(execution.ok).toBe(true)
    const said = JSON.stringify(execution)
    expect(said).not.toContain('7775678')
    expect(said).not.toContain('nuevo@correo.test')
  })

  it('en un error de la ficha va el motivo, no el dato', async () => {
    const message = asError(
      await run('preparar_cliente', {
        nombre: 'Pedro',
        apellido: 'Sosa',
        telefono: 'no-es-un-numero',
      }),
    )
    expect(message).toContain('Teléfono')
    expect(message).not.toContain('no-es-un-numero')
  })

  it('las máscaras', () => {
    expect(phoneTail(JUAN_PHONE)).toBe('…9876')
    expect(phoneTail('12')).toBeNull()
    expect(phoneTail(null)).toBeNull()
    expect(maskEmail(JUAN_MAIL)).toBe('j…@correo.test')
    expect(maskEmail(null)).toBeNull()
    expect(maskEmail('sin-arroba')).toBe('…')
  })

  it('en la ficha se sabe que hay notas y avisos, no qué dicen', async () => {
    const data = asData(await run('ver_cliente', { cliente: JUAN }))
    expect(data).toMatchObject({
      tel: '…9876',
      tiene_mail: true,
      tiene_notas: true,
      tiene_avisos: true,
      cumple: '05/11',
    })
  })
})

describe('cada lectura se queda en el bar', () => {
  /** La tabla del bar se filtra por su propio id. */
  const NO_TENANT_COLUMN = new Set(['tenants'])

  it.each([
    ['buscar_cliente', { buscar: 'Juan', nivel: 'Plata', etiqueta: 'VIP' }],
    ['ver_cliente', { cliente: JUAN }],
    ['ver_mejores_clientes', { por: 'visitas' }],
    ['ver_mejores_clientes', { mes: '2026-10' }],
    ['ver_cumpleanos', {}],
    ['ver_clientes_nuevos', {}],
    ['ver_etiquetas_clientes', {}],
    ['ver_total_clientes', {}],
    ['ver_club', {}],
    ['ver_recompensas', {}],
    ['ver_aliados', {}],
    ['ver_punch_cards', {}],
  ])('%s', async (name, input) => {
    await run(name, input)
    expect(queries().length).toBeGreaterThan(0)
    for (const query of queries()) {
      if (NO_TENANT_COLUMN.has(query.table)) {
        expect(query.filters).toContainEqual(['eq', 'id', TENANT])
      } else if (query.table === 'customer_tag_assignments') {
        // No tiene `tenant_id`: se lee por las etiquetas de este bar, que sí lo tienen.
        expect(query.filters).toContainEqual(['in', 'tag_id', [TAG_VIP, TAG_WINE]])
      } else {
        expect(query.filters, query.table).toContainEqual(['eq', 'tenant_id', TENANT])
      }
    }
  })

  it('no se usa el cliente de servicio en ningún archivo del área', () => {
    const dir = resolve(__dirname, '../../lib/tex/tools/clientes')
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source, file).not.toContain('createServiceClient')
      expect(source, file).not.toContain('supabase/service')
      expect(source, file).not.toMatch(/console\.\w+\([^)]*(phone|email|first_name)/)
    }
  })
})

describe('buscar a alguien', () => {
  it('parte lo que dice la gente en nombre y teléfono', () => {
    expect(parseCustomerQuery('Juan Pérez')).toEqual({ names: ['juan', 'perez'], phone: null })
    expect(parseCustomerQuery('Pérez, Juan')).toEqual({ names: ['perez', 'juan'], phone: null })
    expect(parseCustomerQuery('…1234')).toEqual({ names: [], phone: '1234' })
    expect(parseCustomerQuery('Juan …1234')).toEqual({ names: ['juan'], phone: '1234' })
    expect(parseCustomerQuery('12')).toEqual({ names: [], phone: null })
    // Lo que distingue un teléfono, con 0, 15, 54 o 9 adelante.
    for (const phone of ['351 555-9876', '0351 15 555 9876', '+54 9 351 555 9876']) {
      expect(parseCustomerQuery(phone)).toEqual({ names: [], phone: '5559876' })
    }
  })

  it('no deja pasar sintaxis de PostgREST', () => {
    for (const hostile of ['a),tenant_id.neq.(x', 'a"b', 'x.eq.1', '%_*', 'a\\b', '(tenant_id']) {
      const { names } = parseCustomerQuery(hostile)
      for (const token of names) {
        const filter = nameFilter(token)
        const inner = filter.replace(/first_name\.imatch\."|",last_name\.imatch\."|"$/g, '')
        expect(inner, hostile).not.toMatch(/[()",%*\\]/)
      }
    }
  })

  it('el filtro no distingue acentos', () => {
    const filter = nameFilter('perez')
    expect(filter).toContain('first_name.imatch."p[eéèêë]r[eéèêë]z"')
    expect(filter).toContain('last_name.imatch."p[eéèêë]r[eéèêë]z"')
  })

  it('«Perez» encuentra a «Pérez» y «nunez» a «Núñez»', async () => {
    expect(asData(await run('ver_cliente', { cliente: 'perez' }))).toMatchObject({
      cliente_id: JUAN,
    })
    expect(asData(await run('ver_cliente', { cliente: 'nunez' }))).toMatchObject({
      cliente_id: ANA,
    })
  })

  it('varias palabras van con Y: cada una en el nombre o en el apellido', async () => {
    await run('buscar_cliente', { buscar: 'Juan Pérez' })
    const search = queries().find((q) => q.table === 'customers')
    expect(search?.ors).toHaveLength(2)
    expect(search?.filters).toContainEqual(['eq', 'tenant_id', TENANT])
    expect(search?.filters).toContainEqual(['is', 'deleted_at', null])
  })

  it('el nombre exacto gana sobre los que se le parecen', async () => {
    expect(asData(await run('ver_cliente', { cliente: 'juan perez' }))).toMatchObject({
      cliente_id: JUAN,
    })
  })

  it('los últimos números del teléfono alcanzan', async () => {
    expect(asData(await run('ver_cliente', { cliente: '…1234' }))).toMatchObject({
      cliente_id: ANA,
    })
    expect(asData(await run('ver_cliente', { cliente: 'Juan …1111' }))).toMatchObject({
      cliente_id: JUANA,
    })
  })

  it('con el id lee directo y filtra por bar', async () => {
    mocks.tables.customers = (mocks.tables.customers ?? []).map((row) =>
      row.id === JUAN ? { ...row, tenant_id: 'otro-bar' } : row,
    )
    expect(asError(await run('ver_cliente', { cliente: JUAN }))).toContain('No encontré')
  })

  it('sin nadie o con varios, vuelve con el motivo', () => {
    const lite = (id: string, first: string, last: string) => ({
      id,
      first_name: first,
      last_name: last,
      phone: '+5493510000001',
      points_balance: 0,
      category_points: 0,
      total_visits: 0,
      last_visit_at: null,
      current_tier_id: null,
    })
    const none = chooseCustomer([], 0, 'Zoe')
    expect(none).toMatchObject({ ok: false })
    expect(none.ok ? '' : none.message).toContain('Preguntale si es nuevo')

    const rows = Array.from({ length: 10 }, (_, i) => lite(`id-${i}`, 'Juan', `Apellido${i}`))
    const many = chooseCustomer(rows, 40, 'Juan')
    expect(many.ok ? '' : many.message).toContain('y 32 más')
    expect(many.ok ? '' : many.message).toContain('Preguntale cuál')

    const twins = chooseCustomer([lite('a', 'Ana', 'Paz'), lite('b', 'Ana', 'Paz')], 2, 'Ana Paz')
    expect(twins.ok).toBe(false)
  })

  it('lo del club se elige por nombre o por id, y nunca a ojo', () => {
    const rows = [
      { id: REWARD_COFFEE, name: 'Café gratis' },
      { id: REWARD_DINNER, name: 'Café con medialuna' },
    ]
    const nameOf = (row: { name: string }) => row.name
    expect(pickByName(rows, 'cafe gratis', nameOf, 'la recompensa')).toMatchObject({
      ok: true,
      value: { id: REWARD_COFFEE },
    })
    expect(pickByName(rows, REWARD_DINNER, nameOf, 'la recompensa')).toMatchObject({
      ok: true,
      value: { name: 'Café con medialuna' },
    })
    const many = pickByName(rows, 'café', nameOf, 'la recompensa')
    expect(many.ok ? '' : many.message).toContain('puede ser')
    const none = pickByName(rows, 'Pizza', nameOf, 'la recompensa')
    expect(none.ok ? '' : none.message).toContain('No encontré la recompensa «Pizza»')
  })
})

describe('mirar', () => {
  it('buscar_cliente pide algo y da las filas con el total', async () => {
    expect(asError(await run('buscar_cliente', {}))).toContain('a quién busca')
    expect(asData(await run('buscar_cliente', { buscar: 'Juan' }))).toMatchObject({
      cuantos: 2,
      hay_mas: false,
    })
  })

  it('buscar_cliente lista a los de un nivel y a los de una etiqueta', async () => {
    const byTier = asData(await run('buscar_cliente', { nivel: 'plata' }))
    expect(byTier).toMatchObject({ cuantos: 1 })
    await run('buscar_cliente', { etiqueta: 'vip' })
    const search = queries()
      .filter((q) => q.table === 'customers')
      .at(-1)
    expect(search?.filters).toContainEqual(['eq', 'customer_tag_assignments.tag_id', TAG_VIP])
    expect(asError(await run('buscar_cliente', { nivel: 'Diamante' }))).toContain('No encontré')
  })

  it('la ficha: dos tipos de puntos, nivel, lo que le falta y los números de siempre', async () => {
    const data = asData(await run('ver_cliente', { cliente: JUAN })) as unknown as Row
    expect(data).toMatchObject({
      cliente_id: JUAN,
      nombre: 'Juan Pérez',
      puntos_canjeables: 1200,
      puntos_de_categoria: 1500,
      nivel: 'Plata',
      proximo_nivel: { nombre: 'Oro', faltan_puntos: 500 },
      visitas: 12,
      gastado: '$ 120.000',
      ticket_promedio: '$ 10.000',
      plato_favorito: 'Fernet',
      etiquetas: ['VIP'],
      acepta_promos: true,
      viene_cada_dias: 8,
    })
    // Los puntos no son plata; la última visita es la del reloj del bar, no la de la base.
    expect(data.ultima_visita).toBe('31/10/2026')
    expect(data.movimientos).toEqual([
      { fecha: '31/10/2026', puntos: '+12', motivo: 'Consumo acreditado' },
      { fecha: '20/10/2026', puntos: '-500', motivo: 'Canje · Café gratis' },
    ])
    expect(data.canjes).toEqual([
      { que: 'Café gratis', puntos: 500, fecha: '20/10/2026', estado: 'Entregado' },
    ])
    expect(data.tarjetas).toEqual([{ nombre: 'Tarjeta del café', sellos: '5 de 6' }])
  })

  it('los mejores clientes: por lo gastado, por visitas y de un período', async () => {
    expect(asData(await run('ver_mejores_clientes'))).toMatchObject({
      filas: [{ cliente_id: JUAN, gastado: '$ 120.000', plato_favorito: 'Fernet' }],
    })
    expect(asData(await run('ver_mejores_clientes', { por: 'visitas', cuantos: 1 }))).toMatchObject(
      {
        filas: [{ cliente_id: JUAN, visitas: 12 }],
        hay_mas: false,
      },
    )
    expect(asData(await run('ver_mejores_clientes', { mes: '2026-10' }))).toMatchObject({
      periodo: 'Octubre 2026',
      clientes_con_visitas: 2,
      filas: [
        { cliente_id: JUANA, gastado: '$ 9.000', visitas: 1 },
        { cliente_id: JUAN, gastado: '$ 3.000', visitas: 2 },
      ],
    })
    expect(
      asData(await run('ver_mejores_clientes', { mes: '2026-10', por: 'visitas' })),
    ).toMatchObject({ filas: [{ cliente_id: JUAN }, { cliente_id: JUANA }] })
    expect(asError(await run('ver_mejores_clientes', { mes: '2026-10', por: 'puntos' }))).toContain(
      'no se miran por período',
    )
  })

  it('rankVisits cuenta las visitas de cada uno', () => {
    expect(
      rankVisits(
        [
          { customer_id: 'a', total_amount_cents: 100 },
          { customer_id: 'b', total_amount_cents: 500 },
          { customer_id: 'a', total_amount_cents: 100 },
        ],
        'visitas',
      ),
    ).toEqual([
      { customerId: 'a', visits: 2, cents: 200 },
      { customerId: 'b', visits: 1, cents: 500 },
    ])
  })

  it('los cumples: del período, en orden, y hoy se marca', async () => {
    const data = asData(await run('ver_cumpleanos', { mes: '2026-11' })) as unknown as Row
    expect(data).toMatchObject({ periodo: 'Noviembre 2026', cuantos: 2 })
    expect(data.filas).toMatchObject([
      { cliente_id: JUAN, cumple: '05/11', es_hoy: true },
      { cliente_id: JUANA, cumple: '20/11' },
    ])
    expect(
      asData(await run('ver_cumpleanos', { desde: '2026-11-20', hasta: '2026-11-20' })),
    ).toMatchObject({ cuantos: 1 })
  })

  it('el 29/02 se festeja el 28 si el año no es bisiesto', () => {
    const row = {
      id: ANA,
      first_name: 'Ana',
      last_name: 'Núñez',
      birthdate: '2000-02-29',
      total_visits: 0,
      last_visit_at: null,
      current_tier_id: null,
    }
    const names = new Map<string, string>()
    expect(
      birthdayRows([row], { from: '2027-02-28', to: '2027-02-28' }, '2027-02-28', names),
    ).toMatchObject([{ cumple: '28/02', es_hoy: true }])
    expect(
      birthdayRows([row], { from: '2028-02-28', to: '2028-02-28' }, '2028-02-28', names),
    ).toEqual([])
    expect(
      birthdayRows([row], { from: '2028-02-29', to: '2028-02-29' }, '2028-02-29', names),
    ).toMatchObject([{ cumple: '29/02' }])
  })

  it('el período cruza el fin de año', () => {
    const rows = ['1990-12-31', '1990-01-02', '1990-06-15'].map((birthdate, i) => ({
      id: `c${i}`,
      first_name: 'X',
      last_name: String(i),
      birthdate,
      total_visits: 0,
      last_visit_at: null,
      current_tier_id: null,
    }))
    const found = birthdayRows(
      rows,
      { from: '2026-12-30', to: '2027-01-05' },
      '2026-12-30',
      new Map(),
    )
    expect(found.map((row) => row.cumple)).toEqual(['31/12', '02/01'])
  })

  it('los clientes nuevos: cuántos, de dónde y contra el mes anterior', async () => {
    const data = asData(await run('ver_clientes_nuevos', { mes: '2026-11' })) as unknown as Row
    expect(data).toMatchObject({ periodo: 'Noviembre 2026', nuevos: 1 })
    expect(data.filas).toEqual([
      { cliente_id: JUAN, nombre: 'Juan Pérez', alta: '03/11/2026', origen: 'Walk-in' },
    ])
    expect(data.periodo_anterior).toBe(2)
    expect(data.por_origen).toMatchObject({
      reservas: expect.any(Number),
      walk_in: expect.any(Number),
    })
    const bounds = queries().find((q) => q.filters.some(([op]) => op === 'gte'))?.filters
    // El borde es la medianoche de Córdoba, no la de la base.
    expect(bounds).toContainEqual(['gte', 'created_at', '2026-11-01T03:00:00.000Z'])
    expect(bounds).toContainEqual(['lt', 'created_at', '2026-12-01T03:00:00.000Z'])
  })

  it('cuántos clientes hay: en total, por pestaña, por origen y a cuántos se les puede escribir', async () => {
    expect(asData(await run('ver_total_clientes'))).toMatchObject({
      total: 3,
      con_puntos: 1,
      solo_contacto: 2,
      reservas: 0,
      walk_in: 3,
      aceptan_promos: 1,
    })
  })

  it('quién dejó de venir sale sin el teléfono', async () => {
    expect(asData(await run('ver_clientes_que_dejaron_de_venir'))).toMatchObject({
      cuantos: 1,
      filas: [{ cliente_id: JUAN, venia_cada_dias: 8, dias_sin_venir: 30, gastado: '$ 120.000' }],
    })
  })

  it('las etiquetas con cuántos clientes tienen', async () => {
    expect(asData(await run('ver_etiquetas_clientes'))).toMatchObject({
      filas: [
        { id: TAG_VIP, nombre: 'VIP', clientes: 2 },
        { id: TAG_WINE, nombre: 'Vinos premium', clientes: 0 },
      ],
    })
  })

  it('el club: socios por nivel, beneficios, reglas con su id y la tasa', async () => {
    const data = asData(await run('ver_club')) as unknown as Row
    expect(data.niveles).toMatchObject([
      {
        id: TIER_LOW,
        nombre: 'Plata',
        desde_puntos_de_categoria: 1000,
        socios: 1,
        beneficios: [{ id: TIER_BENEFIT, tipo: 'Descuento', descuento: '10 %', en: 'cafetería' }],
      },
      { id: TIER_HIGH, nombre: 'Oro', socios: 0, beneficios: [] },
    ])
    expect(data.sin_nivel).toBe(2)
    expect(data.puntos_de_categoria_duran_meses).toBe(4)
    expect(data.reglas).toMatchObject([
      { id: RULE_AMOUNT, regla: '1 punto cada $ 1.000', tipo: 'Por monto' },
      { id: RULE_ITEM, regla: '5 puntos por cada Fernet', tipo: 'Por producto' },
    ])
    expect(data.tasa).toBe('1 punto cada $ 1.000')
    expect(data.pagar_con_puntos).toEqual({ activo: false })
    expect(data.bienvenida).toMatchObject({ activa: false })
    expect(data.recompensas).toEqual({ activas: 2, total: 2 })
    expect(data.aliados).toEqual({ activos: 0, total: 1 })
    expect(data.punch_cards).toEqual({ activas: 1, total: 1 })
  })

  it('con dos reglas por monto no se inventa una tasa', async () => {
    mocks.tables.points_rules?.push({
      id: RULE_ITEM,
      tenant_id: TENANT,
      type: 'per_amount',
      config: { every_cents: 200_000, points: 3 },
      priority: 1,
      active: true,
    })
    const data = asData(await run('ver_club')) as unknown as Row
    expect(data.tasa).toBeUndefined()
  })

  it('las recompensas, los aliados y las punch cards', async () => {
    expect(asData(await run('ver_recompensas'))).toMatchObject({
      filas: [
        { id: REWARD_COFFEE, nombre: 'Café gratis', puntos: 500, stock: 'Sin límite' },
        { id: REWARD_DINNER, puntos: 800, stock: 2, desde_nivel: 'Oro' },
      ],
    })
    expect(asData(await run('ver_aliados'))).toMatchObject({
      filas: [
        {
          id: PARTNER,
          nombre: 'Peluquería Sol',
          rubro: 'Belleza',
          en_borrador: true,
          beneficios: [{ id: PARTNER_BENEFIT, descuento: '10 %', niveles: ['Plata'] }],
          niveles_sin_beneficio: ['Oro'],
        },
      ],
    })
    expect(asData(await run('ver_punch_cards'))).toMatchObject({
      filas: [
        {
          id: PUNCH,
          sellos: 6,
          premio: 'un café gratis',
          tope_por_dia: 2,
          en_curso: 1,
          completadas: 0,
        },
      ],
    })
  })
})

describe('preparar_cliente: alta', () => {
  it('lo que arma pasa el esquema real y lo guarda la acción real', async () => {
    const prepared = asPrepared(
      await run('preparar_cliente', {
        nombre: 'Pedro',
        apellido: 'Sosa',
        telefono: '351 666 1234',
        mail: 'Pedro@Correo.test',
        nacimiento: '1992-03-04',
        acepta_promos: true,
      }),
    )
    expect(prepared.executor).toBe('clientes.alta')
    expect(prepared.ticket).toMatchObject({
      kind: 'cliente',
      title: 'Nuevo cliente',
      subtitle: 'Pedro Sosa',
      confirmLabel: 'Crear el cliente',
    })
    expect(prepared.ticket.entry).toEqual([])
    expect(prepared.ticket.warnings.map((w) => w.key)).toEqual(['consent'])
    const payload = prepared.payload as Row
    expect(createCustomerSchema.safeParse(payload).success).toBe(true)
    expect(payload.phone).toBe('+5493516661234')
    expect(queries().filter((q) => q.op !== 'select')).toEqual([])

    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      message: 'Cliente creado.',
      href: expect.stringMatching(/^\/bar\/clientes\/[0-9a-f-]{36}$/),
    })
    const [insert] = writes('customers', 'insert')
    expect(insert?.payload).toMatchObject({
      tenant_id: TENANT,
      phone: '+5493516661234',
      first_name: 'Pedro',
      last_name: 'Sosa',
      email: 'pedro@correo.test',
      birthdate: '1992-03-04',
      source: 'manual',
      opt_in_marketing: true,
      opt_in_ip: '10.0.0.1',
    })
  })

  it('sin aceptar promos no se marca nada', async () => {
    const prepared = asPrepared(
      await run('preparar_cliente', {
        nombre: 'Pedro',
        apellido: 'Sosa',
        telefono: '351 666 1234',
      }),
    )
    expect(prepared.ticket.warnings).toEqual([])
    expect(rowValue(prepared, 'Acepta promos')).toBe('No')
    await confirm(prepared)
    expect(writes('customers', 'insert')[0]?.payload).toMatchObject({
      opt_in_marketing: false,
      opt_in_at: null,
      opt_in_ip: null,
    })
  })

  it('pide lo que falta, sin inventar', async () => {
    expect(asError(await run('preparar_cliente', { nombre: 'Pedro' }))).toContain('apellido')
    expect(asError(await run('preparar_cliente', { nombre: 'Pedro', apellido: 'Sosa' }))).toContain(
      'teléfono',
    )
    expect(
      asError(
        await run('preparar_cliente', {
          nombre: 'Pedro',
          apellido: 'Sosa',
          telefono: '351 666 1234',
          nacimiento: '1992-02-31',
        }),
      ),
    ).toContain('no existe')
    expect(
      asError(
        await run('preparar_cliente', {
          nombre: 'Pedro',
          apellido: 'Sosa',
          telefono: '351 666 1234',
          mail: 'no-es-un-mail',
        }),
      ),
    ).toContain('Mail')
  })

  it('el teléfono se guarda limpio, como lo manda el formulario', async () => {
    // El esquema deja pasar tal cual lo que arranca con +: se guardaría con espacios y guiones.
    const dictated = asPrepared(
      await run('preparar_cliente', {
        nombre: 'Pedro',
        apellido: 'Sosa',
        telefono: '+54 9 351 666-1234',
      }),
    )
    expect((dictated.payload as Row).phone).toBe('+5493516661234')
    const foreign = asPrepared(
      await run('preparar_cliente', {
        nombre: 'Marta',
        apellido: 'Ruiz',
        telefono: '+34 600 123 456',
      }),
    )
    expect((foreign.payload as Row).phone).toBe('+34600123456')
    const edit = asPrepared(
      await run('preparar_cliente', { cliente: ANA, telefono: '0351 15 666-1234' }),
    )
    expect(edit.payload).toEqual({ id: ANA, change: { phone: '+5493516661234' } })
  })

  it('no promete un alta de alguien que ya está', async () => {
    const byPhone = asError(
      await run('preparar_cliente', {
        nombre: 'Juan',
        apellido: 'Pérez',
        telefono: '+54 9 351 555-9876',
      }),
    )
    expect(byPhone).toContain('Ya hay un cliente con ese teléfono: Juan Pérez …9876')
    expect(byPhone).toContain(JUAN)
    expect(
      asError(
        await run('preparar_cliente', {
          nombre: 'Otro',
          apellido: 'Nombre',
          telefono: '351 666 1234',
          mail: JUAN_MAIL,
        }),
      ),
    ).toContain('con ese mail')
  })

  it('lo que el alta no tiene se guarda después, como en la ficha', async () => {
    mocks.tables.customers?.push(
      customer({
        id: '99999999-9999-4999-8999-999999999999',
        first_name: 'Pedro',
        last_name: 'Sosa',
        phone: '+5493516661234',
      }),
    )
    const prepared = asPrepared(
      await run('preparar_cliente', {
        nombre: 'Rocío',
        apellido: 'Díaz',
        telefono: '351 888 4321',
        nota: 'Cumple en la ventana',
        sumar_avisos: ['celiaco'],
      }),
    )
    expect(rowValue(prepared, 'Avisos')).toBe('Celíaco/a')
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true })
    expect(writes('customers', 'insert')).toHaveLength(1)
    expect(writes('customers', 'update')[0]?.payload).toMatchObject({
      notes: 'Cumple en la ventana',
      service_alerts: ['celiac'],
    })
  })
})

describe('preparar_cliente: edición', () => {
  it('no pierde lo que no se dijo: la acción pisa toda la fila', async () => {
    const prepared = asPrepared(
      await run('preparar_cliente', { cliente: JUAN, nombre: 'Juancito' }),
    )
    expect(prepared.executor).toBe('clientes.edicion')
    expect(prepared.ticket.rows).toEqual([{ label: 'Nombre', value: 'Juancito' }])
    expect(prepared.payload).toEqual({ id: JUAN, change: { first_name: 'Juancito' } })

    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      message: 'Guardado.',
      href: `/bar/clientes/${JUAN}`,
    })
    const [update] = writes('customers', 'update')
    expect(update?.payload).toMatchObject({
      first_name: 'Juancito',
      last_name: 'Pérez',
      phone: JUAN_PHONE,
      email: JUAN_MAIL,
      notes: JUAN_NOTE,
      birthdate: '1990-11-05',
      opt_in_marketing: true,
      is_blocked: false,
      service_alerts: ['celiac'],
    })
    expect(update?.filters).toContainEqual(['eq', 'tenant_id', TENANT])
  })

  it('al confirmar lee la ficha de ese momento, no la de cuando armó el tique', async () => {
    const prepared = asPrepared(
      await run('preparar_cliente', { cliente: JUAN, nombre: 'Juancito' }),
    )
    mocks.tables.customers = (mocks.tables.customers ?? []).map((row) =>
      row.id === JUAN ? { ...row, notes: 'Nota de otro' } : row,
    )
    await confirm(prepared)
    expect(writes('customers', 'update')[0]?.payload).toMatchObject({ notes: 'Nota de otro' })
  })

  it('la nota se suma, los avisos se suman y se sacan', async () => {
    const prepared = asPrepared(
      await run('preparar_cliente', {
        cliente: JUAN,
        nota: 'Viene los jueves',
        sumar_avisos: ['vegano', 'celiaco'],
        sacar_avisos: ['celiaco'],
      }),
    )
    expect(rowValue(prepared, 'Suma el aviso')).toBe('Vegano/a')
    expect(rowValue(prepared, 'Saca el aviso')).toBe('Celíaco/a')
    await confirm(prepared)
    expect(writes('customers', 'update')[0]?.payload).toMatchObject({
      notes: `${JUAN_NOTE}\nViene los jueves`,
      service_alerts: ['vegan'],
    })
  })

  it('el mail y el nacimiento se pueden sacar', async () => {
    const prepared = asPrepared(
      await run('preparar_cliente', { cliente: JUAN, mail: '', nacimiento: '' }),
    )
    expect(rowValue(prepared, 'Mail')).toBe('Sin mail')
    expect(rowValue(prepared, 'Nacimiento')).toBe('Sin fecha')
    await confirm(prepared)
    expect(writes('customers', 'update')[0]?.payload).toMatchObject({
      email: null,
      birthdate: null,
    })
  })

  it('aceptar promos avisa y deja registro; no contactar avisa', async () => {
    const accept = asPrepared(
      await run('preparar_cliente', { cliente: ANA, acepta_promos: true, no_contactar: true }),
    )
    expect(accept.ticket.warnings.map((w) => w.key)).toEqual(['consent', 'blocked'])
    await confirm(accept)
    expect(writes('customers', 'update')[0]?.payload).toMatchObject({
      opt_in_marketing: true,
      opt_in_at: expect.any(String),
      opt_in_ip: '10.0.0.1',
      is_blocked: true,
    })
  })

  it('cambiar el teléfono a uno ajeno no se promete', async () => {
    expect(
      asError(await run('preparar_cliente', { cliente: ANA, telefono: '351 555 9876' })),
    ).toContain('Ya hay otro cliente con ese teléfono')
  })

  it('si no cambia nada, lo dice', async () => {
    expect(
      asError(
        await run('preparar_cliente', { cliente: JUAN, nombre: 'Juan', acepta_promos: true }),
      ),
    ).toContain('No hay nada para cambiar')
  })

  it('una nota que no entra se frena en el tique', async () => {
    expect(
      asError(await run('preparar_cliente', { cliente: JUAN, nota: 'x'.repeat(480) })),
    ).toContain('500 letras')
  })

  it('los valores de la ficha pasan el esquema real', () => {
    const current: CustomerFormRow = {
      id: JUAN,
      first_name: 'Juan',
      last_name: 'Pérez',
      phone: JUAN_PHONE,
      email: null,
      notes: null,
      birthdate: null,
      opt_in_marketing: false,
      is_blocked: true,
      service_alerts: ['vegan', 'no-existe'],
    }
    const values = customerEditValues(current, {})
    expect(values.service_alerts).toEqual(['vegan'])
    expect(updateCustomerSchema.safeParse(values).success).toBe(true)
    const form = customerEditForm(values)
    expect(form.get('is_blocked')).toBe('on')
    expect(form.get('opt_in_marketing')).toBeNull()
    expect(form.getAll('service_alerts')).toEqual(['vegan'])
    expect(form.get('email')).toBe('')
  })

  it('cada palabra de aviso es uno de los de la ficha', () => {
    expect(ALERT_WORD_KEYS.length).toBe(5)
    for (const word of ALERT_WORD_KEYS) expect(typeof ALERT_WORDS[word]).toBe('string')
    expect(isRealBirthdate('1990-02-29', '2026-11-05')).toBe(false)
    expect(isRealBirthdate('2030-01-01', '2026-11-05')).toBe(false)
    expect(isRealBirthdate('1990-11-05', '2026-11-05')).toBe(true)
  })
})

describe('preparar_etiqueta_cliente', () => {
  it('pone una que ya existe, sin importar mayúsculas', async () => {
    const prepared = asPrepared(
      await run('preparar_etiqueta_cliente', { cliente: ANA, etiqueta: 'vip' }),
    )
    expect(prepared.ticket).toMatchObject({
      title: 'Poner etiqueta',
      subtitle: 'Ana Núñez',
      confirmLabel: 'Poner «VIP»',
    })
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      message: 'Le puse «VIP».',
      href: `/bar/clientes/${ANA}`,
      point: 'VIP',
    })
    expect(writes('customer_tag_assignments', 'upsert')[0]?.payload).toEqual({
      customer_id: ANA,
      tag_id: TAG_VIP,
    })
  })

  it('saca una que tiene', async () => {
    const prepared = asPrepared(
      await run('preparar_etiqueta_cliente', { cliente: JUAN, etiqueta: 'VIP', accion: 'sacar' }),
    )
    expect(prepared.ticket.confirmLabel).toBe('Sacar «VIP»')
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true, message: 'Le saqué «VIP».' })
    expect(writes('customer_tag_assignments', 'delete')[0]?.filters).toEqual([
      ['eq', 'customer_id', JUAN],
      ['eq', 'tag_id', TAG_VIP],
    ])
  })

  it('no promete lo que no se puede', async () => {
    expect(
      asError(await run('preparar_etiqueta_cliente', { cliente: JUAN, etiqueta: 'VIP' })),
    ).toContain('ya tiene')
    expect(
      asError(
        await run('preparar_etiqueta_cliente', {
          cliente: JUAN,
          etiqueta: 'Vinos',
          accion: 'sacar',
        }),
      ),
    ).toContain('No encontré')
    expect(
      asError(
        await run('preparar_etiqueta_cliente', { cliente: ANA, etiqueta: 'VIP', accion: 'sacar' }),
      ),
    ).toContain('no tiene ninguna etiqueta')
  })

  it('si se parece a otra pregunta, y con crear: true la crea', async () => {
    expect(
      asError(await run('preparar_etiqueta_cliente', { cliente: ANA, etiqueta: 'Vinos' })),
    ).toContain('Hay etiquetas parecidas: «Vinos premium»')
    const prepared = asPrepared(
      await run('preparar_etiqueta_cliente', { cliente: ANA, etiqueta: 'Vinos', crear: true }),
    )
    expect(prepared.ticket.warnings.map((w) => w.key)).toEqual(['new_tag'])
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true })
    expect(writes('customer_tags', 'insert')[0]?.payload).toMatchObject({
      tenant_id: TENANT,
      name: 'Vinos',
    })
  })

  it('una nueva sin parecidas se crea', async () => {
    const prepared = asPrepared(
      await run('preparar_etiqueta_cliente', { cliente: ANA, etiqueta: 'Cumpleañera' }),
    )
    expect(prepared.ticket.confirmLabel).toBe('Crear y poner «Cumpleañera»')
  })
})

describe('preparar_puntos', () => {
  it('calcula con la misma regla que la base y acredita con la acción real', async () => {
    const prepared = asPrepared(await run('preparar_puntos', { cliente: JUAN, monto: 12_500 }))
    expect(prepared.payload).toEqual({ customer_id: JUAN, amount_cents: 1_250_000 })
    expect(prepared.ticket).toMatchObject({
      kind: 'puntos',
      subtitle: 'Juan Pérez',
      total: { label: 'Suma', value: '12 puntos' },
      confirmLabel: 'Acreditar 12 puntos',
    })
    expect(rowValue(prepared, 'Regla')).toBe('1 punto cada $ 1.000')
    expect(rowValue(prepared, 'Tiene')).toBe('1.200 puntos')
    expect(rowValue(prepared, 'Queda en')).toBe('1.212 puntos')
    expect(prepared.ticket.warnings.map((w) => w.key)).toEqual(['visit'])

    mocks.rpcResult.award_points_by_amount = {
      data: { points_awarded: 12, amount_cents: 1_250_000, new_balance: 1212 },
    }
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      message: 'Se acreditaron 12 puntos. Le quedan 1.212 puntos.',
      data: { cliente_id: JUAN, puntos_sumados: 12, saldo: 1212 },
      href: `/bar/clientes/${JUAN}`,
      point: 'Puntos disponibles',
      undoUntil: null,
    })
    expect(mocks.rpcs).toEqual([
      {
        name: 'award_points_by_amount',
        args: { p_customer_id: JUAN, p_amount_cents: 1_250_000 },
      },
    ])
  })

  it('sin regla o sin llegar al monto, avisa y no promete puntos', async () => {
    const low = asPrepared(await run('preparar_puntos', { cliente: JUAN, monto: 500 }))
    expect(low.ticket.total?.value).toBe('0 puntos')
    expect(low.ticket.confirmLabel).toBe('Cargar la visita')
    expect(low.ticket.warnings.map((w) => w.key)).toEqual(['visit', 'below_step'])

    mocks.tables.points_rules = []
    const none = asPrepared(await run('preparar_puntos', { cliente: JUAN, monto: 12_000 }))
    expect(none.ticket.warnings.map((w) => w.key)).toEqual(['visit', 'no_rule'])
  })

  it('si la acción lo va a rechazar por repetido, ya lo dice', async () => {
    mocks.tables.points_transactions?.push({
      id: 'tx-now',
      tenant_id: TENANT,
      customer_id: JUAN,
      delta: 12,
      reason: 'qr_award',
      payload: { amount_cents: 1_200_000 },
      created_at: new Date().toISOString(),
      visit_id: null,
      redemption_id: null,
    })
    expect(asError(await run('preparar_puntos', { cliente: JUAN, monto: 12_000 }))).toContain(
      'ya se le acreditó',
    )
  })

  it('el cálculo es el de la base: la regla de más prioridad, con la cuenta hacia abajo', () => {
    const rule = (priority: number, every: number, points: number, active = true) => ({
      id: `r${priority}`,
      type: 'per_amount' as const,
      config: { every_cents: every, points },
      priority,
      active,
    })
    const top = activeAmountRule([rule(1, 100, 1), rule(9, 1000, 2), rule(99, 1, 1, false)])
    expect(top?.id).toBe('r9')
    expect(awardPoints(top, 2500)).toBe(4)
    expect(awardPoints(null, 2500)).toBe(0)
    expect(activeAmountRule([])).toBeNull()
    expect(ruleWords(rule(1, 100_000, 2), null)).toBe('2 puntos cada $ 1.000')
  })

  it('isRecentAward mira 3 minutos y solo ese monto', () => {
    const now = Date.parse('2026-11-05T12:00:00Z')
    const award = (minutesAgo: number, cents: number) => ({
      reason: 'qr_award',
      payload: { amount_cents: cents },
      created_at: new Date(now - minutesAgo * 60_000).toISOString(),
    })
    expect(isRecentAward([award(1, 100)], 100, now)).toBe(true)
    expect(isRecentAward([award(4, 100)], 100, now)).toBe(false)
    expect(isRecentAward([award(1, 200)], 100, now)).toBe(false)
  })

  it('no hay forma de cargar o restar puntos sueltos', () => {
    const tool = toolNamed('preparar_puntos')
    expect(tool.input.safeParse({ cliente: JUAN, monto: -100 }).success).toBe(false)
    expect(tool.input.safeParse({ cliente: JUAN, puntos: 500 }).success).toBe(false)
  })
})

describe('preparar_canje', () => {
  it('descuenta con la acción real', async () => {
    const prepared = asPrepared(await run('preparar_canje', { cliente: JUAN, recompensa: 'cafe' }))
    expect(prepared.payload).toEqual({ customer_id: JUAN, reward_id: REWARD_COFFEE })
    expect(prepared.ticket).toMatchObject({
      subtitle: 'Juan Pérez · Café gratis',
      total: { label: 'Descuenta', value: '500 puntos' },
      confirmLabel: 'Canjear 500 puntos',
    })
    expect(rowValue(prepared, 'Queda en')).toBe('700 puntos')
    mocks.rpcResult.redeem_reward = { data: [{ redemption_id: 'r', balance_after: 700 }] }
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      data: { cliente_id: JUAN, saldo: 700 },
      href: `/bar/clientes/${JUAN}`,
    })
  })

  it('no promete un canje que la base va a rechazar', async () => {
    expect(
      asError(await run('preparar_canje', { cliente: ANA, recompensa: 'Café gratis' })),
    ).toContain('no le alcanza')
    expect(asError(await run('preparar_canje', { cliente: JUAN, recompensa: 'Cena' }))).toContain(
      'es desde el nivel Oro',
    )
    const dinner = mocks.tables.rewards?.find((row) => row.id === REWARD_DINNER) as Row
    dinner.min_tier_id = null
    dinner.stock = 0
    expect(asError(await run('preparar_canje', { cliente: JUAN, recompensa: 'Cena' }))).toContain(
      'sin stock',
    )
    dinner.active = false
    expect(asError(await run('preparar_canje', { cliente: JUAN, recompensa: 'Cena' }))).toContain(
      'pausada',
    )
    expect(asError(await run('preparar_canje', { cliente: JUAN, recompensa: 'Pizza' }))).toContain(
      'No encontré',
    )
  })

  it('un error de la base llega en palabras', async () => {
    const prepared = asPrepared(await run('preparar_canje', { cliente: JUAN, recompensa: 'cafe' }))
    mocks.rpcResult.redeem_reward = { error: { message: 'insufficient_balance' } }
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: false,
      kind: 'failed',
      message: 'El cliente no tiene puntos suficientes.',
    })
  })
})

describe('preparar_visita', () => {
  it('arma los ítems por nombre, adelanta los puntos y registra con la acción real', async () => {
    const prepared = asPrepared(
      await run('preparar_visita', {
        cliente: JUAN,
        consumo: [
          { item: 'fernet', cantidad: 2 },
          { item: 'Café', cantidad: 1 },
          { item: 'FERNET', cantidad: 1 },
        ],
        nota: 'Mesa 4',
      }),
    )
    expect(prepared.payload).toEqual({
      customer_id: JUAN,
      items: [
        { item_id: ITEM_FERNET, quantity: 3 },
        { item_id: ITEM_COFFEE, quantity: 1 },
      ],
      notes: 'Mesa 4',
    })
    expect(prepared.ticket.total).toEqual({ label: 'Total', value: '$ 27.000' })
    expect(rowValue(prepared, '3 × Fernet')).toBe('$ 24.000')
    // 27 por monto + 15 por regla de Fernet + 2 de bonus del café.
    expect(rowValue(prepared, 'Suma')).toBe('44 puntos')

    mocks.rpcResult.close_table = {
      data: [{ visit_id: 'v', points_awarded: 44, breakdown: [] }],
    }
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      message: 'Visita registrada. Sumó 44 puntos.',
      data: { cliente_id: JUAN, puntos_sumados: 44 },
    })
    expect(mocks.rpcs[0]?.name).toBe('close_table')
  })

  it('un ítem que no está vuelve a preguntar', async () => {
    expect(
      asError(
        await run('preparar_visita', { cliente: JUAN, consumo: [{ item: 'Pizza', cantidad: 1 }] }),
      ),
    ).toContain('No encontré en la carta el ítem «Pizza»')
  })
})

describe('preparar_sello', () => {
  it('sella con la acción real y avisa si completa', async () => {
    const prepared = asPrepared(await run('preparar_sello', { cliente: JUAN }))
    expect(prepared.payload).toEqual({ accion: 'sumar', customer_id: JUAN, template_id: PUNCH })
    expect(prepared.ticket.warnings[0]?.title).toContain('gana un café gratis')
    expect(rowValue(prepared, 'Queda en')).toBe('6 de 6')
    mocks.rpcResult.add_punch_stamp = {
      data: { template_name: 'Tarjeta del café', remaining: 0, completed: true },
    }
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      message: 'Completó «Tarjeta del café»: le queda el premio para retirar.',
    })
    expect(mocks.rpcs.at(-1)).toMatchObject({
      name: 'add_punch_stamp',
      args: { p_customer_id: JUAN, p_template_id: PUNCH, p_qty: 1, p_source: 'manual' },
    })
  })

  it('saca un sello de la tarjeta en curso', async () => {
    const prepared = asPrepared(await run('preparar_sello', { cliente: JUAN, sacar: true }))
    expect(prepared.payload).toEqual({ accion: 'sacar', customer_id: JUAN, card_id: CARD })
    mocks.rpcResult.remove_punch_stamp = { data: { current_stamps: 4 } }
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true })
    expect(mocks.rpcs.at(-1)).toMatchObject({
      name: 'remove_punch_stamp',
      args: { p_card_id: CARD, p_qty: 1 },
    })
  })

  it('no promete sellar lo que no se puede', async () => {
    expect(asError(await run('preparar_sello', { cliente: ANA, sacar: true }))).toContain(
      'no tiene sellos',
    )
    mocks.tables.punch_card_template_tiers = [
      { tenant_id: TENANT, template_id: PUNCH, tier_id: TIER_HIGH, loyalty_tiers: { name: 'Oro' } },
    ]
    mocks.rpcResult.customer_effective_tier = { data: TIER_LOW }
    expect(asError(await run('preparar_sello', { cliente: JUAN }))).toContain('es solo para Oro')
    mocks.tables.punch_card_templates = []
    expect(asError(await run('preparar_sello', { cliente: JUAN }))).toContain(
      'no tiene punch cards',
    )
  })
})

describe('preparar_regla_puntos', () => {
  it('cambiar la tasa es crear la nueva y pausar la anterior, en ese orden', async () => {
    const prepared = asPrepared(await run('preparar_regla_puntos', { puntos: 2, cada: 1500 }))
    expect(prepared.ticket).toMatchObject({
      title: 'Cambiar la regla de puntos',
      subtitle: '2 puntos cada $ 1.500',
    })
    expect(rowValue(prepared, 'Queda pausada')).toBe('1 punto cada $ 1.000')
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      href: '/bar/club?tab=programa',
      point: 'Cómo ganan puntos',
    })
    const ops = queries().filter((q) => q.table === 'points_rules' && q.op !== 'select')
    expect(ops.map((q) => q.op)).toEqual(['insert', 'update'])
    expect(ops[0]?.payload).toMatchObject({
      tenant_id: TENANT,
      type: 'per_amount',
      config: { every_cents: 150_000, points: 2 },
      priority: 100,
      active: true,
    })
    expect(ops[1]?.payload).toEqual({ active: false })
    expect(ops[1]?.filters).toContainEqual(['eq', 'id', RULE_AMOUNT])
    expect(ops[1]?.filters).toContainEqual(['eq', 'tenant_id', TENANT])
  })

  it('la misma tasa no es un cambio', async () => {
    expect(asError(await run('preparar_regla_puntos', { puntos: 1, cada: 1000 }))).toContain(
      'La regla ya es',
    )
  })

  it('por ítem: reemplaza la que había de ese ítem', async () => {
    const prepared = asPrepared(await run('preparar_regla_puntos', { puntos: 8, item: 'fernet' }))
    expect(prepared.ticket.subtitle).toBe('8 puntos por cada Fernet')
    expect(rowValue(prepared, 'Queda pausada')).toBe('5 puntos por cada Fernet')
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true })
    const ops = queries().filter((q) => q.table === 'points_rules' && q.op !== 'select')
    expect(ops[0]?.payload).toMatchObject({
      type: 'per_item',
      config: { item_id: ITEM_FERNET, points: 8 },
    })
    expect(ops[1]?.filters).toContainEqual(['eq', 'id', RULE_ITEM])
  })

  it('por categoría: solo las que tienen ítems directos', async () => {
    const prepared = asPrepared(
      await run('preparar_regla_puntos', { puntos: 3, categoria: 'Tragos' }),
    )
    expect(prepared.ticket.subtitle).toBe('3 puntos por cada ítem de Tragos')
    await confirm(prepared)
    expect(writes('points_rules', 'insert')[0]?.payload).toMatchObject({
      config: { category_id: CATEGORY_DRINKS, points: 3 },
    })
    expect(
      asError(await run('preparar_regla_puntos', { puntos: 3, categoria: 'Carpeta sin ítems' })),
    ).toContain('No encontré')
  })

  it('una regla también se elige como se lee', async () => {
    expect(
      asPrepared(await run('preparar_regla_puntos', { regla: 'fernet', activa: false })).payload,
    ).toEqual({ accion: 'estado', rule_id: RULE_ITEM, active: false })
  })

  it('pausar y activar', async () => {
    const paused = asPrepared(
      await run('preparar_regla_puntos', { regla: RULE_ITEM, activa: false }),
    )
    expect(paused.ticket.confirmLabel).toBe('Pausar la regla')
    expect(paused.ticket.subtitle).toBe('5 puntos por cada Fernet')
    await expect(confirm(paused)).resolves.toMatchObject({ ok: true, message: 'Regla pausada.' })
    expect(writes('points_rules', 'update')[0]?.payload).toEqual({ active: false })

    expect(asError(await run('preparar_regla_puntos', { regla: RULE_ITEM }))).toContain(
      'pausás o la activás',
    )
    expect(
      asError(await run('preparar_regla_puntos', { regla: RULE_ITEM, activa: true })),
    ).toContain('ya está activa')
    expect(asError(await run('preparar_regla_puntos', { regla: ANA, activa: true }))).toContain(
      'No encontré la regla',
    )
  })

  it('prender una segunda regla por monto avisa qué pasa', async () => {
    mocks.tables.points_rules?.push({
      id: ANA,
      tenant_id: TENANT,
      type: 'per_amount',
      config: { every_cents: 200_000, points: 3 },
      priority: 1,
      active: false,
    })
    const prepared = asPrepared(await run('preparar_regla_puntos', { regla: ANA, activa: true }))
    expect(prepared.ticket.warnings.map((w) => w.key)).toEqual(['two_amount_rules'])
  })

  it('pide lo que falta', async () => {
    expect(asError(await run('preparar_regla_puntos', {}))).toContain('cuántos puntos')
    expect(asError(await run('preparar_regla_puntos', { puntos: 3 }))).toContain(
      'cada cuántos pesos',
    )
    expect(
      asError(
        await run('preparar_regla_puntos', { puntos: 3, item: 'Fernet', categoria: 'Tragos' }),
      ),
    ).toContain('de qué ítem o categoría')
  })
})

describe('preparar_nivel', () => {
  it('uno nuevo pasa el esquema real y lo crea la acción real', async () => {
    const prepared = asPrepared(
      await run('preparar_nivel', { nombre: 'Diamante', desde_puntos: 5000, detalle: 'Mesa fija' }),
    )
    expect(prepared.ticket).toMatchObject({ title: 'Nuevo nivel', subtitle: 'Diamante' })
    expect(rowValue(prepared, 'Desde')).toBe('5.000 puntos de categoría')
    expect(prepared.ticket.warnings.map((w) => w.key)).toEqual(['recompute'])
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      message: 'Nivel creado.',
      href: '/bar/club?tab=programa',
    })
    const insert = writes('loyalty_tiers', 'insert')[0]?.payload as Row
    expect(insert).toMatchObject({
      tenant_id: TENANT,
      name: 'Diamante',
      min_category_points: 5000,
      perks: 'Mesa fija',
      active: true,
      sort: 3,
    })
    expect(createTierSchema.safeParse(insert).success).toBe(true)
  })

  it('editar no pierde el color ni el ícono', async () => {
    const prepared = asPrepared(await run('preparar_nivel', { nivel: 'plata', desde_puntos: 1200 }))
    expect(prepared.ticket.rows).toEqual([
      { label: 'Desde', value: '1.200 puntos de categoría' },
      { label: 'Socios hoy', value: '1' },
    ])
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true })
    expect(writes('loyalty_tiers', 'update')[0]?.payload).toMatchObject({
      name: 'Plata',
      color: '#aaaaaa',
      badge_icon: 'Star',
      min_category_points: 1200,
      perks: 'Café de bienvenida',
      sort: 1,
      active: true,
    })
  })

  it('no promete lo que la base rechaza', async () => {
    expect(asError(await run('preparar_nivel', { nivel: 'Oro', desde_puntos: 1000 }))).toContain(
      '«Plata» ya arranca en 1.000 puntos',
    )
    expect(asError(await run('preparar_nivel', { nombre: 'X' }))).toContain('desde cuántos puntos')
    expect(asError(await run('preparar_nivel', { desde_puntos: 3 }))).toContain('cómo se llama')
    expect(asError(await run('preparar_nivel', { nivel: 'Plata' }))).toContain('nada para cambiar')
    expect(asError(await run('preparar_nivel', { nivel: 'Plata', activo: true }))).toContain(
      'nada para cambiar',
    )
  })
})

describe('preparar_beneficio_nivel', () => {
  it('un ítem gratis pide su recompensa y avisa que sale solo', async () => {
    expect(
      asError(
        await run('preparar_beneficio_nivel', {
          nivel: 'Plata',
          tipo: 'item_gratis',
          nombre: 'Café del mes',
        }),
      ),
    ).toContain('Elegí la recompensa')
    const prepared = asPrepared(
      await run('preparar_beneficio_nivel', {
        nivel: 'Plata',
        tipo: 'item_gratis',
        nombre: 'Café del mes',
        recompensa: 'Café gratis',
        cuando: 'mensual',
      }),
    )
    expect(prepared.ticket.warnings.map((w) => w.key)).toEqual(['recurring'])
    expect(rowValue(prepared, 'Regalo')).toBe('Café gratis')
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true })
    const insert = writes('tier_benefits', 'insert')[0]?.payload as Row
    expect(insert).toMatchObject({
      tenant_id: TENANT,
      tier_id: TIER_LOW,
      kind: 'recurring_reward',
      reward_id: REWARD_COFFEE,
      cadence: 'monthly',
      sort: 5,
    })
    expect(createTierBenefitSchema.safeParse(insert).success).toBe(true)
  })

  it('editar no pierde el ícono ni la foto', async () => {
    const prepared = asPrepared(
      await run('preparar_beneficio_nivel', { nivel: 'Plata', beneficio: '10 %', porcentaje: 15 }),
    )
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true })
    expect(writes('tier_benefits', 'update')[0]?.payload).toMatchObject({
      kind: 'discount',
      label: '10 % en cafetería',
      icon: 'Percent',
      discount_pct: 15,
      discount_scope: 'cafetería',
      sort: 4,
    })
  })

  it('pide lo que falta', async () => {
    expect(asError(await run('preparar_beneficio_nivel', { nivel: 'Plata' }))).toContain('qué tipo')
    expect(
      asError(
        await run('preparar_beneficio_nivel', {
          nivel: 'Plata',
          tipo: 'descuento',
          nombre: 'Algo',
        }),
      ),
    ).toContain('% de descuento')
  })
})

describe('preparar_recompensa', () => {
  it('una nueva, sin stock es sin límite', async () => {
    const prepared = asPrepared(
      await run('preparar_recompensa', { nombre: 'Postre', puntos: 300, desde_nivel: 'oro' }),
    )
    expect(prepared.ticket.subtitle).toBe('Postre')
    expect(rowValue(prepared, 'Nivel')).toBe('Oro')
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true })
    expect(writes('rewards', 'insert')[0]?.payload).toMatchObject({
      tenant_id: TENANT,
      name: 'Postre',
      cost_points: 300,
      stock: null,
      visible_in_catalog: true,
      min_tier_id: TIER_HIGH,
      image_url: null,
    })
  })

  it('editar no pierde la foto', async () => {
    const prepared = asPrepared(
      await run('preparar_recompensa', { recompensa: 'cafe', puntos: 650, stock: 10 }),
    )
    expect(rowValue(prepared, 'Cuesta')).toBe('650 puntos')
    await confirm(prepared)
    expect(writes('rewards', 'update')[0]?.payload).toMatchObject({
      name: 'Café gratis',
      cost_points: 650,
      stock: 10,
      active: true,
      category: 'desayuno',
      image_url: 'https://x.test/cafe.jpg',
    })
  })

  it('pausar y volver a sin límite', async () => {
    const paused = asPrepared(
      await run('preparar_recompensa', {
        recompensa: 'cena',
        activa: false,
        stock: null,
        desde_nivel: null,
      }),
    )
    expect(rowValue(paused, 'Stock')).toBe('Sin límite')
    expect(rowValue(paused, 'Nivel')).toBe('Para todos')
    await confirm(paused)
    expect(writes('rewards', 'update')[0]?.payload).toMatchObject({
      active: false,
      stock: null,
      min_tier_id: null,
    })
  })

  it('pide lo que falta', async () => {
    expect(asError(await run('preparar_recompensa', { puntos: 3 }))).toContain('cómo se llama')
    expect(asError(await run('preparar_recompensa', { nombre: 'X' }))).toContain('cuántos puntos')
    expect(asError(await run('preparar_recompensa', { recompensa: 'cafe' }))).toContain('nada para')
  })
})

describe('preparar_aliado y preparar_beneficio_aliado', () => {
  it('una marca nueva arranca en borrador y lo avisa', async () => {
    const prepared = asPrepared(
      await run('preparar_aliado', { nombre: 'Gimnasio', rubro: 'Deporte', web: 'gimnasio.test' }),
    )
    expect(prepared.ticket.warnings.map((w) => w.key)).toEqual(['draft'])
    expect(rowValue(prepared, 'Estado')).toBe('En borrador')
    await confirm(prepared)
    expect(writes('partners', 'insert')[0]?.payload).toMatchObject({
      tenant_id: TENANT,
      name: 'Gimnasio',
      category: 'Deporte',
      url: 'https://gimnasio.test',
      active: false,
    })
  })

  it('editar no pierde el logo; activarla la muestra', async () => {
    const prepared = asPrepared(
      await run('preparar_aliado', { aliado: 'peluqueria', activo: true }),
    )
    expect(prepared.ticket.warnings).toEqual([])
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      href: '/bar/club?tab=aliados',
    })
    expect(writes('partners', 'update')[0]?.payload).toMatchObject({
      name: 'Peluquería Sol',
      logo_url: 'https://x.test/logo.png',
      category: 'Belleza',
      active: true,
      sort: 3,
    })
  })

  it('una web que no se abre no entra', async () => {
    expect(
      asError(await run('preparar_aliado', { nombre: 'X', web: 'javascript:alert(1)' })),
    ).toContain('no se puede abrir')
    expect(partnerUrl('https://a.test')).toBe('https://a.test')
    expect(partnerUrl('')).toBeNull()
    expect(partnerUrl('ftp://a.test')).toBeNull()
  })

  it('el beneficio de una marca llega a los niveles elegidos', async () => {
    const prepared = asPrepared(
      await run('preparar_beneficio_aliado', {
        aliado: 'Peluquería Sol',
        nombre: '20 % off',
        descuento: 20,
        niveles: ['oro'],
      }),
    )
    expect(rowValue(prepared, 'Llega a')).toBe('Oro')
    expect(prepared.ticket.warnings.map((w) => w.key)).toEqual(['draft'])
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true })
    expect(writes('partner_benefits', 'insert')[0]?.payload).toMatchObject({
      partner_id: PARTNER,
      label: '20 % off',
      discount_pct: 20,
    })
    expect(writes('partner_benefit_tiers', 'insert')[0]?.payload).toEqual([
      { tenant_id: TENANT, benefit_id: '99999999-9999-4999-8999-999999999999', tier_id: TIER_HIGH },
    ])
  })

  it('«todos» son los niveles activos; sin niveles avisa', async () => {
    const all = asPrepared(
      await run('preparar_beneficio_aliado', {
        aliado: 'Peluquería Sol',
        nombre: 'Algo',
        niveles: ['todos'],
      }),
    )
    expect(rowValue(all, 'Llega a')).toBe('Plata y Oro')
    const none = asPrepared(
      await run('preparar_beneficio_aliado', { aliado: 'Peluquería Sol', nombre: 'Algo' }),
    )
    expect(none.ticket.warnings.map((w) => w.key)).toContain('no_tiers')
  })

  it('editar no pierde la foto ni sus niveles', async () => {
    const prepared = asPrepared(
      await run('preparar_beneficio_aliado', {
        aliado: 'Peluquería Sol',
        beneficio: '10 % off',
        descuento: 15,
      }),
    )
    await confirm(prepared)
    expect(writes('partner_benefits', 'update')[0]?.payload).toMatchObject({
      label: '10 % off',
      discount_pct: 15,
      image_url: 'https://x.test/p.png',
    })
    expect(writes('partner_benefit_tiers', 'insert')[0]?.payload).toEqual([
      { tenant_id: TENANT, benefit_id: PARTNER_BENEFIT, tier_id: TIER_LOW },
    ])
  })
})

describe('preparar_punch_card', () => {
  it('una nueva se sella a mano y la crea la acción real', async () => {
    const prepared = asPrepared(
      await run('preparar_punch_card', {
        nombre: 'Tarjeta de la cerveza',
        sellos: 8,
        recompensa: 'cafe',
        premio: 'una pinta gratis',
        tope_por_dia: 2,
      }),
    )
    expect(rowValue(prepared, 'Se sella')).toBe('A mano, desde Acreditar')
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      href: '/bar/club?tab=punch',
    })
    expect(writes('punch_card_templates', 'insert')[0]?.payload).toMatchObject({
      tenant_id: TENANT,
      name: 'Tarjeta de la cerveza',
      threshold: 8,
      reward_id: REWARD_COFFEE,
      reward_label: 'una pinta gratis',
      trigger_type: 'manual',
      trigger_ref_id: null,
      config: { max_per_day: 2 },
    })
  })

  it('editar no pierde la foto, el disparador ni su tope', async () => {
    const prepared = asPrepared(await run('preparar_punch_card', { tarjeta: 'cafe', sellos: 8 }))
    expect(prepared.ticket.warnings.map((w) => w.key)).toEqual(['snapshot'])
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true })
    expect(writes('punch_card_templates', 'update')[0]?.payload).toMatchObject({
      name: 'Tarjeta del café',
      threshold: 8,
      image_url: 'https://x.test/t.png',
      stamp_icon: 'Coffee',
      reward_label: 'un café gratis',
      trigger_type: 'manual',
      config: { max_per_day: 2 },
      active: true,
    })
  })

  it('pausarla es un solo toque, sin pasar por el editor', async () => {
    const prepared = asPrepared(
      await run('preparar_punch_card', { tarjeta: 'cafe', activa: false }),
    )
    expect(prepared.payload).toEqual({ accion: 'estado', id: PUNCH, active: false })
    expect(prepared.ticket.warnings.map((w) => w.key)).toEqual(['paused'])
    await expect(confirm(prepared)).resolves.toMatchObject({
      ok: true,
      message: 'Tarjeta pausada.',
    })
    expect(writes('punch_card_templates', 'update')[0]?.payload).toEqual({ active: false })
  })

  it('los niveles reemplazan; «todos» la abre', async () => {
    const prepared = asPrepared(
      await run('preparar_punch_card', { tarjeta: 'cafe', niveles: ['Oro'] }),
    )
    expect(rowValue(prepared, 'Niveles')).toBe('Oro')
    await confirm(prepared)
    expect(writes('punch_card_template_tiers', 'insert')[0]?.payload).toEqual([
      { template_id: PUNCH, tier_id: TIER_HIGH, tenant_id: TENANT },
    ])
    const all = asPrepared(
      await run('preparar_punch_card', { tarjeta: 'cafe', niveles: ['todos'] }),
    )
    expect(rowValue(all, 'Niveles')).toBe('Para todos')
  })

  it('pide lo que falta', async () => {
    expect(asError(await run('preparar_punch_card', {}))).toContain('cómo se llama')
    expect(asError(await run('preparar_punch_card', { nombre: 'X' }))).toContain('cuántos sellos')
    expect(asError(await run('preparar_punch_card', { nombre: 'X', sellos: 3 }))).toContain(
      'qué recompensa',
    )
    expect(asError(await run('preparar_punch_card', { tarjeta: 'cafe' }))).toContain('nada para')
    expect(
      asError(await run('preparar_punch_card', { tarjeta: 'cafe', activa: false, sellos: 3 })),
    ).toContain('otro tique')
    expect(asError(await run('preparar_punch_card', { tarjeta: 'cafe', activa: true }))).toContain(
      'ya está activa',
    )
  })
})

describe('preparar_pago_con_puntos', () => {
  it('guarda en pesos lo que la acción quiere en centavos', async () => {
    const prepared = asPrepared(
      await run('preparar_pago_con_puntos', { activo: true, pesos_por_punto: 0.5, tope: 30 }),
    )
    expect(prepared.payload).toEqual({ enabled: true, ratePointsToCents: 50, maxPct: 30 })
    expect(rowValue(prepared, 'Un punto vale')).toBe('$ 0,50')
    expect(rowValue(prepared, 'Hasta')).toBe('30 % de su parte de la cuenta')
    await expect(confirm(prepared)).resolves.toMatchObject({ ok: true })
    expect(writes('tenants', 'update')[0]?.payload).toEqual({
      points_redemption_enabled: true,
      points_to_cents_rate: 50,
      points_redemption_max_pct: 30,
    })
  })

  it('sin cambios, lo dice', async () => {
    expect(asError(await run('preparar_pago_con_puntos', {}))).toContain('nada para cambiar')
    expect(asError(await run('preparar_pago_con_puntos', { activo: false }))).toContain('nada para')
  })
})

describe('las pantallas', () => {
  const ROOT = resolve(__dirname, '../../app/(manager)/[tenantSlug]')
  const source = (file: string) => readFileSync(join(ROOT, file), 'utf8')
  const pageOf = (path: string) => `${path.replace(':id', '[id]').slice(1)}/page.tsx`

  /** Dónde lee cada pantalla cada parámetro: lo mismo que `READS` de `tex-screens.test.ts`. */
  const READS: Readonly<Record<string, Readonly<Record<string, readonly [string, RegExp]>>>> = {
    'clientes.lista': {
      q: ['clientes/page.tsx', /q: sp\.q,/],
      etiqueta: ['clientes/page.tsx', /tag: sp\.tag,/],
    },
    'club.inicio': { tab: ['club/page.tsx', /typeof sp\.tab === 'string'/] },
  }

  it('todas son del panel y existen', () => {
    expect(clientesScreens.length).toBeGreaterThan(10)
    for (const screen of clientesScreens) {
      expect(screen.root, screen.id).toBe(true)
      expect(screen.id, screen.id).toMatch(/^(clientes|club)\.[a-z_]+$/)
      expect(existsSync(join(ROOT, pageOf(screen.path))), screen.path).toBe(true)
      expect(screen.what.length, screen.id).toBeGreaterThan(10)
    }
  })

  it('cada parámetro declarado lo lee su pantalla, y al revés', () => {
    const declared = clientesScreens.flatMap((screen) =>
      (screen.params ?? []).filter((p) => p !== 'id').map((param) => [screen.id, param] as const),
    )
    for (const [id, param] of declared) {
      const evidence = READS[id]?.[param]
      expect(evidence, `Falta mirar dónde lee ${param} ${id}`).toBeDefined()
      if (evidence) expect(source(evidence[0])).toMatch(evidence[1])
    }
    for (const [id, params] of Object.entries(READS)) {
      for (const param of Object.keys(params)) {
        expect(
          declared.some(([s, p]) => s === id && p === param),
          `${id} ${param}`,
        ).toBe(true)
      }
    }
  })

  it('el :id va declarado', () => {
    for (const screen of clientesScreens) {
      expect(screen.path.includes(':id'), screen.id).toBe(screen.params?.includes('id') ?? false)
    }
  })

  it('las solapas son las de la página', () => {
    const match = /CLUB_TABS = new Set<ClubTab>\(\[(.*?)\]\)/.exec(source('club/page.tsx'))
    const tabs = [...(match?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1])
    expect([...TEX_CLUB_TABS].sort()).toEqual(tabs.sort())
    for (const id of [
      'club.puntos',
      'club.niveles',
      'club.aliados',
      'club.bienvenida',
      'club.punch_cards',
    ]) {
      const tab = new URLSearchParams(texScreen(id)?.query ?? '').get('tab') as never
      expect(TEX_CLUB_TABS).toContain(tab)
    }
  })

  it('lo fijo de la lista es lo que acepta su filtro', () => {
    for (const id of [
      'clientes.con_puntos',
      'clientes.solo_contacto',
      'clientes.reservas',
      'clientes.walkin',
    ]) {
      const fixed = Object.fromEntries(new URLSearchParams(texScreen(id)?.query ?? ''))
      expect(Object.keys(fixed).length, id).toBe(1)
      expect(listFiltersSchema.safeParse(fixed).success, id).toBe(true)
      expect(listFiltersSchema.parse(fixed), id).toMatchObject(fixed)
    }
  })

  it('arma los links y no deja pasar lo que no entiende', () => {
    expect(texScreenHref('bar', 'clientes.lista', { q: 'Juan' })).toMatchObject({
      href: '/bar/clientes?q=Juan',
    })
    expect(texScreenHref('bar', 'clientes.ficha', { id: JUAN })).toMatchObject({
      href: `/bar/clientes/${JUAN}`,
    })
    expect(texScreenHref('bar', 'clientes.canjear', { id: JUAN })).toMatchObject({
      href: `/bar/clientes/${JUAN}/canjear`,
    })
    expect(texScreenHref('bar', 'clientes.ficha', { id: '../../login' }).ok).toBe(false)
    expect(texScreenHref('bar', 'club.inicio', { tab: 'aliados' })).toMatchObject({
      href: '/bar/club?tab=aliados',
    })
    expect(texScreenHref('bar', 'club.inicio', { tab: 'noexiste' })).toMatchObject({
      href: '/bar/club',
    })
    expect(texScreenHref('bar', 'club.punch_cards')).toMatchObject({ href: '/bar/club?tab=punch' })
    expect(texScreenHref('bar', 'clientes.reservas')).toMatchObject({
      href: '/bar/clientes?segment=reserva',
    })
  })

  it('nunca arma un link que se vaya del bar', () => {
    const hostile = [
      '../../../login',
      '//evil.test',
      'https://evil.test',
      'javascript:alert(1)',
      `${JUAN}/../../..`,
      '?x=1#y',
      '%2e%2e%2f',
      '\\\\evil.test',
    ]
    for (const screen of clientesScreens) {
      const needsId = screen.path.includes(':id')
      for (const value of hostile) {
        const link = texScreenHref('bar', screen.id, {
          id: needsId ? JUAN : value,
          q: value,
          tab: value,
          mes: value,
        })
        expect(link.ok, screen.id).toBe(true)
        if (!link.ok) continue
        const url = new URL(link.href, 'https://bar.test')
        expect(url.origin).toBe('https://bar.test')
        expect(url.pathname === '/bar' || url.pathname.startsWith('/bar/'), screen.id).toBe(true)
        expect(url.pathname).not.toContain('..')
        if (needsId) expect(texScreenHref('bar', screen.id, { id: value }).ok).toBe(false)
      }
    }
  })

  it('las ve quien las ve en el panel', () => {
    const features = {}
    for (const screen of clientesScreens) {
      expect(
        texScreenAllowed(screen, { role: 'owner', features, accounting: false }),
        screen.id,
      ).toBe(true)
      for (const role of ['editor', 'host', 'accountant'] as const) {
        expect(
          texScreenAllowed(screen, { role, features, accounting: true }),
          `${screen.id} ${role}`,
        ).toBe(false)
      }
    }
  })

  it('el rol de cada una es el que exige su página', () => {
    const roleOf: Readonly<Record<string, readonly string[]>> = {
      REDEMPTION_STAFF_ROLES: ['owner', 'cashier', 'waiter'],
    }
    for (const screen of clientesScreens) {
      const required = /requireRole\([\w.]*role, ([^)]+)\)/.exec(source(pageOf(screen.path)))?.[1]
      expect(required, screen.id).toBeDefined()
      const allowed =
        roleOf[required ?? ''] ?? [...(required ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1])
      expect([...(screen.roles ?? [])].sort(), screen.id).toEqual([...allowed].sort())
    }
  })

  it('después de hacer algo, lleva a una pantalla que existe', () => {
    const source = ['actions.ts', 'club-actions.ts']
      .map((file) => readFileSync(resolve(__dirname, '../../lib/tex/tools/clientes', file), 'utf8'))
      .join('\n')
    const used = [...source.matchAll(/place\(ctx, '([a-z_.]+)'/g)].map((m) => m[1] ?? '')
    expect(used.length).toBeGreaterThan(5)
    for (const id of used) expect(texScreen(id), id).not.toBeNull()
  })
})

describe('el manual', () => {
  it('entra en lo que se le pidió', () => {
    expect(clientesManual.length).toBeLessThan(6600)
  })

  it('no habla de ningún bar en particular', () => {
    for (const word of ['HUB', 'Nacho', 'Gold', 'Black', 'Select', 'Classic', 'Córdoba', 'Luz']) {
      expect(clientesManual, word).not.toContain(word)
    }
  })

  it('cuenta lo que hay que saber', () => {
    for (const fact of [
      'Puntos canjeables',
      'Puntos de categoría',
      'no vencen',
      'ventana',
      'mayor prioridad',
      'todas las reglas activas',
      'No existe cargar ni restar puntos sueltos',
      'Borrar un cliente',
      'difusión',
      'borrador',
    ]) {
      expect(clientesManual, fact).toContain(fact)
    }
  })

  it('las herramientas que nombra existen', () => {
    const named = [...clientesManual.matchAll(/\b(preparar_[a-z_]+|ver_[a-z_]+|buscar_[a-z_]+)\b/g)]
    for (const match of named) {
      expect(
        TOOLS.map((tool) => tool.name),
        match[1],
      ).toContain(match[1])
    }
  })
})
