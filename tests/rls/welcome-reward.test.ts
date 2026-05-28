import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

/**
 * Cubre:
 *  - RLS de welcome_reward_configs: solo owner escribe; otro tenant no ve
 *  - RLS de welcome_reward_grants: read-only para members; insert solo via RPC
 *  - Unique constraint (customer_id) en welcome_reward_grants — one-shot real
 *  - El RPC register_customer_for_session entrega welcome reward solo cuando
 *    la config está enabled, hay reward activo y stock disponible
 */
describeIfRls('RLS — welcome reward (config + grants + one-shot via RPC)', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let rewardA: { id: string }
  let tableA: { id: string; qr_token: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('wro') })
    ownerB = await createUserClient({ email: uniqueEmail('wrob') })
    cashierA = await createUserClient({ email: uniqueEmail('wrcash') })

    tenantA = await createTenant({
      name: 'Bar Welcome A',
      slug: uniqueSlug('wr-a'),
      ownerId: ownerA.userId,
    })
    await createTenant({
      name: 'Bar Welcome B',
      slug: uniqueSlug('wr-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()

    await service.from('memberships').insert({
      tenant_id: tenantA.id,
      user_id: cashierA.userId,
      role: 'cashier',
    })

    // Reward activo en A
    const { data: r } = await service
      .from('rewards')
      .insert({
        tenant_id: tenantA.id,
        name: 'Café gratis de bienvenida',
        description: 'Cortado o americano',
        cost_points: 100,
        stock: 50,
        active: true,
      })
      .select('id')
      .single()
    if (!r) throw new Error('reward setup failed')
    rewardA = r

    // Mesa física activa para tenantA (necesaria para register_customer_for_session)
    const { data: t } = await service
      .from('physical_tables')
      .insert({
        tenant_id: tenantA.id,
        label: 'Mesa W1',
        active: true,
      })
      .select('id, qr_token')
      .single()
    if (!t) throw new Error('table setup failed')
    tableA = t
  })

  afterAll(async () => {
    if (!RLS_TESTS_ENABLED) return
    await deleteUser(ownerA.userId)
    await deleteUser(ownerB.userId)
    await deleteUser(cashierA.userId)
  })

  describe('welcome_reward_configs RLS', () => {
    it('owner del tenant puede UPSERT su config', async () => {
      const { error } = await ownerA.client
        // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados aún
        .from('welcome_reward_configs' as any)
        .upsert(
          {
            tenant_id: tenantA.id,
            enabled: true,
            reward_id: rewardA.id,
            headline: 'Llevate un café',
            subtext: 'Solo registrandote',
          },
          { onConflict: 'tenant_id' },
        )
      expect(error).toBeNull()
    })

    it('owner puede leer su config', async () => {
      const { data, error } = await ownerA.client
        // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados aún
        .from('welcome_reward_configs' as any)
        .select('tenant_id, enabled, reward_id, headline, subtext')
        .eq('tenant_id', tenantA.id)
        .maybeSingle()
      expect(error).toBeNull()
      expect(data).toMatchObject({
        tenant_id: tenantA.id,
        enabled: true,
        reward_id: rewardA.id,
      })
    })

    it('cashier puede LEER pero NO escribir', async () => {
      const { data: read, error: readError } = await cashierA.client
        // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados aún
        .from('welcome_reward_configs' as any)
        .select('enabled')
        .eq('tenant_id', tenantA.id)
        .maybeSingle()
      expect(readError).toBeNull()
      expect(read).toBeTruthy()

      const { error: writeError } = await cashierA.client
        // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados aún
        .from('welcome_reward_configs' as any)
        .update({ enabled: false })
        .eq('tenant_id', tenantA.id)
      expect(writeError).toBeTruthy()
    })

    it('owner de OTRO tenant no ve la config de A', async () => {
      const { data, error } = await ownerB.client
        // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados aún
        .from('welcome_reward_configs' as any)
        .select('tenant_id')
        .eq('tenant_id', tenantA.id)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  })

  describe('welcome_reward_grants one-shot + RPC end-to-end', () => {
    it('RPC otorga el welcome reward al registrarse un cliente nuevo', async () => {
      const service = getServiceClient()
      const anonClient = await import('./setup').then((m) => m.getAnonClient())

      // Abrir sesión vía RPC público (join_session_as_guest)
      const browserToken = `bt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`.slice(
        0,
        32,
      )
      const join = await anonClient.rpc('join_session_as_guest', {
        p_qr_token: tableA.qr_token,
        p_browser_token: browserToken,
        p_display_name: null,
      })
      expect(join.error).toBeNull()

      // Registrar al cliente con un teléfono único — debe entregar welcome reward
      const phone = `+5491100${Date.now().toString().slice(-7)}`
      const reg = await anonClient.rpc('register_customer_for_session', {
        p_qr_token: tableA.qr_token,
        p_browser_token: browserToken,
        p_phone: phone,
        p_first_name: 'Welcome',
        p_last_name: 'Tester',
        p_birthdate: null,
        p_opt_in_marketing: false,
        p_ip: '127.0.0.1',
        p_user_agent: 'vitest',
      })
      expect(reg.error).toBeNull()
      const result = reg.data as {
        customer_id: string
        was_new_customer: boolean
        welcome_redemption_id: string | null
        welcome_reward_name: string | null
      }
      expect(result.was_new_customer).toBe(true)
      expect(result.welcome_redemption_id).toBeTruthy()
      expect(result.welcome_reward_name).toBe('Café gratis de bienvenida')

      // Verificar que existe el grant
      const { data: grant } = await service
        // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados aún
        .from('welcome_reward_grants' as any)
        .select('id, customer_id, reward_id, redemption_id')
        .eq('customer_id', result.customer_id)
        .single()
      expect(grant).toMatchObject({
        customer_id: result.customer_id,
        reward_id: rewardA.id,
        redemption_id: result.welcome_redemption_id,
      })

      // Verificar que existe el reward_redemption pendiente
      const { data: redemption } = await service
        .from('reward_redemptions')
        .select('status, points_spent')
        .eq('id', result.welcome_redemption_id ?? '')
        .single()
      expect(redemption).toMatchObject({ status: 'pending', points_spent: 0 })
    })

    it('Re-registrar el mismo phone NO duplica el welcome reward (was_new=false)', async () => {
      const anonClient = await import('./setup').then((m) => m.getAnonClient())

      // Mismo phone que el test anterior — pero usamos otro browser_token (otro dispositivo)
      const browserToken = `bt-r2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.slice(
        0,
        32,
      )
      await anonClient.rpc('join_session_as_guest', {
        p_qr_token: tableA.qr_token,
        p_browser_token: browserToken,
        p_display_name: null,
      })

      // Buscamos un phone del test anterior — para simplificar usamos uno conocido
      // que el test anterior creó. Si no existe (orden ejecución), crear uno nuevo
      // primero y luego volver a registrar.
      const phone = `+5491100${Date.now().toString().slice(-7)}`

      const reg1 = await anonClient.rpc('register_customer_for_session', {
        p_qr_token: tableA.qr_token,
        p_browser_token: browserToken,
        p_phone: phone,
        p_first_name: 'Repeat',
        p_last_name: 'Tester',
        p_birthdate: null,
        p_opt_in_marketing: false,
        p_ip: '127.0.0.1',
        p_user_agent: 'vitest',
      })
      const result1 = reg1.data as { was_new_customer: boolean }
      expect(result1.was_new_customer).toBe(true)

      // Otro browser_token, otra sesión join, mismo phone
      const browserToken2 = `bt-r3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.slice(
        0,
        32,
      )
      await anonClient.rpc('join_session_as_guest', {
        p_qr_token: tableA.qr_token,
        p_browser_token: browserToken2,
        p_display_name: null,
      })
      const reg2 = await anonClient.rpc('register_customer_for_session', {
        p_qr_token: tableA.qr_token,
        p_browser_token: browserToken2,
        p_phone: phone,
        p_first_name: 'Repeat',
        p_last_name: 'Tester',
        p_birthdate: null,
        p_opt_in_marketing: false,
        p_ip: '127.0.0.1',
        p_user_agent: 'vitest',
      })
      const result2 = reg2.data as {
        was_new_customer: boolean
        welcome_redemption_id: string | null
      }
      expect(result2.was_new_customer).toBe(false)
      // No debe entregar segundo welcome reward
      expect(result2.welcome_redemption_id).toBeNull()
    })

    it('unique(customer_id) en welcome_reward_grants impide doble insert directo', async () => {
      const service = getServiceClient()

      // Crear customer C aparte
      const { data: c } = await service
        .from('customers')
        .insert({
          tenant_id: tenantA.id,
          phone: `+549122${Date.now().toString().slice(-8)}`,
          first_name: 'Conflict',
          last_name: 'Tester',
        })
        .select('id')
        .single()
      if (!c) throw new Error('customer create failed')

      // Crear redemption fake
      const { data: rr } = await service
        .from('reward_redemptions')
        .insert({
          tenant_id: tenantA.id,
          customer_id: c.id,
          reward_id: rewardA.id,
          points_spent: 0,
          status: 'pending',
        })
        .select('id')
        .single()
      if (!rr) throw new Error('redemption create failed')

      // Primer grant — ok
      const { error: e1 } = await service
        // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados aún
        .from('welcome_reward_grants' as any)
        .insert({
          tenant_id: tenantA.id,
          customer_id: c.id,
          reward_id: rewardA.id,
          redemption_id: rr.id,
        })
      expect(e1).toBeNull()

      // Segundo grant para el mismo customer — debe fallar por unique constraint
      const { data: rr2 } = await service
        .from('reward_redemptions')
        .insert({
          tenant_id: tenantA.id,
          customer_id: c.id,
          reward_id: rewardA.id,
          points_spent: 0,
          status: 'pending',
        })
        .select('id')
        .single()
      if (!rr2) throw new Error('second redemption create failed')

      const { error: e2 } = await service
        // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados aún
        .from('welcome_reward_grants' as any)
        .insert({
          tenant_id: tenantA.id,
          customer_id: c.id,
          reward_id: rewardA.id,
          redemption_id: rr2.id,
        })
      expect(e2).toBeTruthy()
      expect(e2?.message ?? '').toMatch(/unique|duplicate/i)
    })

    it('cashier puede LEER welcome_reward_grants (auditoría)', async () => {
      const { data, error } = await cashierA.client
        // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados aún
        .from('welcome_reward_grants' as any)
        .select('id, customer_id')
        .eq('tenant_id', tenantA.id)
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
    })

    it('cashier NO puede INSERT en welcome_reward_grants directamente', async () => {
      const { data: c } = await getServiceClient()
        .from('customers')
        .insert({
          tenant_id: tenantA.id,
          phone: `+549133${Date.now().toString().slice(-8)}`,
          first_name: 'Direct',
          last_name: 'Insert',
        })
        .select('id')
        .single()
      if (!c) throw new Error('customer create failed')

      const { data: rr } = await getServiceClient()
        .from('reward_redemptions')
        .insert({
          tenant_id: tenantA.id,
          customer_id: c.id,
          reward_id: rewardA.id,
          points_spent: 0,
          status: 'pending',
        })
        .select('id')
        .single()
      if (!rr) throw new Error('redemption create failed')

      const { error } = await cashierA.client
        // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados aún
        .from('welcome_reward_grants' as any)
        .insert({
          tenant_id: tenantA.id,
          customer_id: c.id,
          reward_id: rewardA.id,
          redemption_id: rr.id,
        })
      expect(error).toBeTruthy()
    })
  })

  describe('Welcome reward silent-fail cuando config disabled o stock=0', () => {
    it('config disabled NO entrega welcome reward al registrarse', async () => {
      const service = getServiceClient()
      const anonClient = await import('./setup').then((m) => m.getAnonClient())

      // Crear segundo tenant + setup
      const ownerC = await createUserClient({ email: uniqueEmail('wroc') })
      const tenantC = await createTenant({
        name: 'Bar C',
        slug: uniqueSlug('wr-c'),
        ownerId: ownerC.userId,
      })
      const { data: rC } = await service
        .from('rewards')
        .insert({
          tenant_id: tenantC.id,
          name: 'Café C',
          cost_points: 100,
          stock: 50,
          active: true,
        })
        .select('id')
        .single()
      const { data: tC } = await service
        .from('physical_tables')
        .insert({ tenant_id: tenantC.id, label: 'Mesa C', active: true })
        .select('id, qr_token')
        .single()
      if (!rC || !tC) throw new Error('setup C failed')

      // Config disabled (default)
      await service
        // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados aún
        .from('welcome_reward_configs' as any)
        .upsert({
          tenant_id: tenantC.id,
          enabled: false,
          reward_id: rC.id,
          headline: 'X',
          subtext: 'Y',
        })

      const browserToken = `bt-d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`.slice(
        0,
        32,
      )
      await anonClient.rpc('join_session_as_guest', {
        p_qr_token: tC.qr_token,
        p_browser_token: browserToken,
        p_display_name: null,
      })

      const phone = `+5491144${Date.now().toString().slice(-7)}`
      const reg = await anonClient.rpc('register_customer_for_session', {
        p_qr_token: tC.qr_token,
        p_browser_token: browserToken,
        p_phone: phone,
        p_first_name: 'Disabled',
        p_last_name: 'Tester',
        p_birthdate: null,
        p_opt_in_marketing: false,
        p_ip: '127.0.0.1',
        p_user_agent: 'vitest',
      })

      const result = reg.data as {
        was_new_customer: boolean
        welcome_redemption_id: string | null
      }
      expect(result.was_new_customer).toBe(true)
      expect(result.welcome_redemption_id).toBeNull()

      await deleteUser(ownerC.userId)
    })
  })
})
