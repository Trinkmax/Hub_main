import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { revalidatePath } from 'next/cache'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as actions from '@/lib/points/actions'
import { createClient } from '@/lib/supabase/server'
import { requireTenantAccess } from '@/lib/tenant'
import type { TenantRole } from '@/lib/tenant/types'

// El editor del club es UNA página, `/{slug}/club` (pestañas por `?tab=`).
// `/club/puntos`, `/club/niveles`, `/club/aliados`… quedaron como redirects:
// las acciones tienen que revalidar la página real, no los stubs.

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/tenant/current', () => ({ getCurrentUser: vi.fn(async () => null) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/tenant', async () => {
  // Roles y errores reales: si una acción deja de pedir owner, el test lo ve.
  const roles = await vi.importActual<typeof import('@/lib/tenant/roles')>('@/lib/tenant/roles')
  const errors = await vi.importActual<typeof import('@/lib/tenant/errors')>('@/lib/tenant/errors')
  return {
    ...roles,
    ...errors,
    requireTenantAccess: vi.fn(),
    requireRole: (role: TenantRole, allowed: ReadonlyArray<TenantRole>) => {
      if (!allowed.includes(role)) throw new errors.RoleRequiredError()
    },
  }
})

const SLUG = 'hub'
const TENANT = 'tenant-a'
const ID = '11111111-2222-4333-8444-555555555555'
const OTHER_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa'

type Result = { data: unknown; error: null }

/** Cualquier query encadenada termina bien; `.single()` devuelve una fila con `id`. */
class FakeQuery implements PromiseLike<Result> {
  private readonly result: Result = { data: { id: ID }, error: null }
  select() {
    return this
  }
  insert() {
    return this
  }
  update() {
    return this
  }
  delete() {
    return this
  }
  eq() {
    return this
  }
  single() {
    return Promise.resolve(this.result)
  }
  maybeSingle() {
    return Promise.resolve(this.result)
  }
  // biome-ignore lint/suspicious/noThenProperty: imita el builder thenable de supabase-js.
  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected)
  }
}

function asRole(role: TenantRole) {
  vi.mocked(requireTenantAccess).mockResolvedValue({
    tenant: { id: TENANT },
    role,
    user: { id: 'user-a' },
  } as unknown as Awaited<ReturnType<typeof requireTenantAccess>>)
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.set(key, value)
  return fd
}

const IDLE = { ok: true } as const

// Lo que mandan los formularios: los campos opcionales viajan en `null` (con
// zod 4 una clave ausente no pasa la unión con `z.undefined()` + transform).
const REWARD_EXTRAS = { category: null, min_tier_id: null, image_url: null }
const TIER_EXTRAS = { color: null, badge_icon: null, perks: null }
const TIER_BENEFIT_EXTRAS = {
  description: null,
  icon: null,
  image_url: null,
  reward_id: null,
  discount_pct: null,
  discount_scope: null,
  partner_id: null,
}
const PARTNER_EXTRAS = { logo_url: null, category: null, url: null }
const PARTNER_BENEFIT_EXTRAS = { description: null, discount_pct: null, image_url: null }

/** Cada acción del dueño con un input válido. */
const OWNER_ACTIONS = {
  createPerAmountRule: () =>
    actions.createPerAmountRule(SLUG, IDLE, form({ every_cents: '100000', points: '10' })),
  createPerItemRule: () =>
    actions.createPerItemRule(SLUG, { mode: 'item', targetId: ID, points: 5, priority: 0 }),
  toggleRule: () => actions.toggleRule(SLUG, ID, false),
  deleteRule: () => actions.deleteRule(SLUG, ID),
  createReward: () => actions.createReward(SLUG, IDLE, form({ name: 'Café', cost_points: '100' })),
  updateReward: () =>
    actions.updateReward(SLUG, {
      id: ID,
      name: 'Café',
      description: null,
      cost_points: 100,
      stock: null,
      active: true,
      ...REWARD_EXTRAS,
    }),
  deleteReward: () => actions.deleteReward(SLUG, ID),
  createTier: () =>
    actions.createTier(SLUG, { name: 'Gold', min_category_points: 1000, ...TIER_EXTRAS }),
  updateTier: () =>
    actions.updateTier(SLUG, { id: ID, name: 'Gold', min_category_points: 1000, ...TIER_EXTRAS }),
  deleteTier: () => actions.deleteTier(SLUG, ID),
  updatePointsRedemptionConfigAction: () =>
    actions.updatePointsRedemptionConfigAction(SLUG, {
      enabled: true,
      ratePointsToCents: 10,
      maxPct: 50,
    }),
  createTierBenefit: () =>
    actions.createTierBenefit(SLUG, {
      tier_id: ID,
      kind: 'perk',
      label: 'Mesa preferida',
      ...TIER_BENEFIT_EXTRAS,
    }),
  updateTierBenefit: () =>
    actions.updateTierBenefit(SLUG, {
      id: OTHER_ID,
      tier_id: ID,
      kind: 'perk',
      label: 'Mesa preferida',
      ...TIER_BENEFIT_EXTRAS,
    }),
  toggleTierBenefit: () => actions.toggleTierBenefit(SLUG, ID, true),
  deleteTierBenefit: () => actions.deleteTierBenefit(SLUG, ID),
  createPartner: () => actions.createPartner(SLUG, { name: 'Café Martínez', ...PARTNER_EXTRAS }),
  updatePartner: () =>
    actions.updatePartner(SLUG, { id: ID, name: 'Café Martínez', ...PARTNER_EXTRAS }),
  togglePartner: () => actions.togglePartner(SLUG, ID, true),
  deletePartner: () => actions.deletePartner(SLUG, ID),
  clearPartnerLegacyDiscount: () => actions.clearPartnerLegacyDiscount(SLUG, ID),
  createPartnerBenefit: () =>
    actions.createPartnerBenefit(SLUG, {
      partner_id: ID,
      label: '10% off',
      tier_ids: [OTHER_ID],
      ...PARTNER_BENEFIT_EXTRAS,
    }),
  updatePartnerBenefit: () =>
    actions.updatePartnerBenefit(SLUG, {
      id: OTHER_ID,
      partner_id: ID,
      label: '10% off',
      tier_ids: [],
      ...PARTNER_BENEFIT_EXTRAS,
    }),
  togglePartnerBenefit: () => actions.togglePartnerBenefit(SLUG, ID, false),
  deletePartnerBenefit: () => actions.deletePartnerBenefit(SLUG, ID),
  reorderTierBenefits: () => actions.reorderTierBenefits(SLUG, ID, [OTHER_ID]),
  reorderRewards: () => actions.reorderRewards(SLUG, [ID, OTHER_ID]),
  reorderPartnerBenefits: () => actions.reorderPartnerBenefits(SLUG, ID, [OTHER_ID]),
} satisfies Partial<Record<keyof typeof actions, () => Promise<actions.LoyaltyActionState>>>

/** Las de mostrador (staff): acreditan o buscan un socio, no tocan el programa. */
const COUNTER_ACTIONS = ['awardPointsByAmount', 'lookupCustomerByQr']

const revalidated = () => vi.mocked(revalidatePath).mock.calls.map((call) => call[0])

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear()
  vi.mocked(createClient).mockResolvedValue({
    from: vi.fn(() => new FakeQuery()),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  } as unknown as Awaited<ReturnType<typeof createClient>>)
  asRole('owner')
})

describe('acciones del programa del club', () => {
  it('la tabla cubre todas las acciones exportadas', () => {
    const exported = Object.keys(actions).filter((name) => !COUNTER_ACTIONS.includes(name))
    expect(exported.sort()).toEqual(Object.keys(OWNER_ACTIONS).sort())
  })

  it.each(
    Object.entries(OWNER_ACTIONS),
  )('%s revalida /club (no los redirects viejos)', async (_name, run) => {
    const result = await run()
    expect(result).toMatchObject({ ok: true })
    expect(revalidated()).toEqual([`/${SLUG}/club`, `/${SLUG}/menu`])
  })

  it('sin permiso no guarda ni revalida', async () => {
    asRole('waiter')
    const result = await OWNER_ACTIONS.createTier()
    expect(result).toEqual({ ok: false, message: 'No tenés permiso.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('lib/points no apunta a los stubs de /club/*', () => {
  it('ningún revalidatePath a una subruta de /club (todas son redirects menos /club/simular)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../lib/points/actions.ts', import.meta.url)),
      'utf8',
    )
    const calls = source.match(/revalidatePath\(`[^`]*`\)/g) ?? []
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.filter((call) => call.includes('/club/'))).toEqual([])
  })
})
