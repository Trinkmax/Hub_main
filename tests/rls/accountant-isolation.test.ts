import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
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

type UserClient = Awaited<ReturnType<typeof createUserClient>>

const HOOK_TIMEOUT = 240_000
const TEST_TIMEOUT = 90_000

/**
 * Las 64 tablas con `tenant_id` que llevan la RESTRICTIVE `<tabla>_no_accountant`
 * (catálogo vivo del 06/10/2026: las 70 con tenant_id menos memberships,
 * user_active_tenant, audit_log, customer_credentials, customer_password_resets
 * y job_queue). Misma lista que 20261007120200_accountant_isolation.sql; si
 * aparece una tabla nueva, el detector `acc_isolation_gaps()` falla primero.
 */
const TENANT_TABLES = [
  'audiences',
  'birthday_marketing',
  'broadcasts',
  'cake_options',
  'channels',
  'commission_bonus_rules',
  'commission_ledger',
  'commission_rate_tiers',
  'conversation_tags',
  'conversations',
  'customer_capture_links',
  'customer_capture_submissions',
  'customer_punch_cards',
  'customer_tags',
  'customers',
  'floor_plan_areas',
  'floor_plan_elements',
  'flow_execution_events',
  'flow_executions',
  'flows',
  'invitations',
  'item_tags',
  'landing_page_versions',
  'landing_page_views',
  'landing_pages',
  'loyalty_tiers',
  'marketing_routine_checks',
  'marketing_routines',
  'marketing_tasks',
  'menu_categories',
  'menu_items',
  'message_templates',
  'messages',
  'partner_benefit_tiers',
  'partner_benefits',
  'partners',
  'physical_tables',
  'points_rules',
  'points_transactions',
  'public_link_pages',
  'public_links',
  'punch_card_stamps',
  'punch_card_template_tiers',
  'punch_card_templates',
  'quick_messages',
  'reservation_managers',
  'reviews',
  'reward_redemptions',
  'rewards',
  'salon_reservations',
  'salon_segment_capacities',
  'salon_segment_capacity_overrides',
  'salon_segment_settings',
  'salon_zone_capacity_overrides',
  'scheduled_event_marketing',
  'scheduled_event_templates',
  'scheduled_events',
  'table_sessions',
  'tickets',
  'tier_benefit_grants',
  'tier_benefits',
  'visits',
  'welcome_reward_configs',
  'welcome_reward_grants',
] as const

/** Las 4 vistas SECURITY DEFINER con el filtro `role <> 'accountant'`. */
const STATS_VIEWS = [
  'v_customer_stats',
  'v_churn_risk',
  'v_tenant_daily_metrics',
  'v_visit_heatmap',
] as const

type QueryResult = { data: unknown; error: PostgrestError | null }

/**
 * «No ve nada»: o la consulta vuelve vacía, o Postgres la rechaza por permisos
 * (42501). Cualquier otro error es un bug del test (columna mal escrita, etc.)
 * y tiene que verse, no pasar por aislamiento.
 */
function leakOf(name: string, res: QueryResult): string | null {
  if (res.error) return res.error.code === '42501' ? null : `${name}: ${res.error.message}`
  const rows = Array.isArray(res.data) ? res.data : []
  return rows.length === 0 ? null : `${name}: ${rows.length} fila(s)`
}

function expectErrorContaining(error: PostgrestError | null, text: string) {
  expect(error).not.toBeNull()
  expect(error?.message).toContain(text)
}

/**
 * Aislamiento de la contadora (`accountant`) en la base — migración
 * 20261007120200_accountant_isolation, fase 0 del Sprint 1 (spec §B.7, §B.9).
 *
 * Bar A sembrado con cliente, etiqueta, reserva, conversación y mensaje,
 * ticket, visita y membresía extra. Personas: dueño administrador de
 * Administración (A), contadora (A), dueño sin acceso (A), dueño con acceso que
 * no administra (A), cajero (A), dueño de B. El acceso por persona
 * (`acc_access`) se siembra con el service role: en la fase 0 todavía no
 * existen las RPC de accesos (llegan con la #6).
 *
 * Los casos 4 y 7 de §B.9 y las partes `acc_*` de 3, 5 y 8 dependen de las
 * tablas, políticas y RPC contables de la fase 1 (migraciones #4 a #11):
 * quedan como `it.todo` con la referencia, para completarlos en ese PR.
 *
 * Caso 11 («nadie se rompe») no es un test de este archivo: es la suite RLS
 * completa corriendo sin cambios con la #1 y la #3 aplicadas.
 */
describeIfRls('Aislamiento de la contadora (fase 0)', () => {
  let service: SupabaseClient
  let adminA: UserClient
  let accountantA: UserClient
  let ownerNoAccessA: UserClient
  let ownerWithAccessA: UserClient
  let cashierA: UserClient
  let ownerB: UserClient
  let inviteeAccountant: UserClient
  let viaPostgrestAccountant: UserClient
  let roleSwapper: UserClient
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let customerA: string
  let channelA: string
  let conversationA: string
  let reservationA: string
  let ticketA: string
  let visitA: string
  let sessionA: string
  let menuItemA: string

  async function seed<T extends Record<string, unknown>>(
    table: string,
    row: Record<string, unknown>,
    columns = 'id',
  ): Promise<T> {
    const { data, error } = await service.from(table).insert(row).select(columns).single()
    if (error || !data) throw new Error(`seed ${table} falló: ${error?.message}`)
    return data as unknown as T
  }

  async function membershipRole(tenantId: string, userId: string): Promise<string | null> {
    const { data } = await service
      .from('memberships')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle()
    return (data as { role: string } | null)?.role ?? null
  }

  async function activeManagers(tenantId: string, userId: string): Promise<boolean[]> {
    const { data } = await service
      .from('reservation_managers')
      .select('active')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
    return ((data ?? []) as Array<{ active: boolean }>).map((r) => r.active)
  }

  beforeAll(async () => {
    service = getServiceClient()
    adminA = await createUserClient({ email: uniqueEmail('acc-adminA') })
    accountantA = await createUserClient({ email: uniqueEmail('acc-contadoraA') })
    ownerNoAccessA = await createUserClient({ email: uniqueEmail('acc-sinaccesoA') })
    ownerWithAccessA = await createUserClient({ email: uniqueEmail('acc-conaccesoA') })
    cashierA = await createUserClient({ email: uniqueEmail('acc-cajeroA') })
    ownerB = await createUserClient({ email: uniqueEmail('acc-ownerB') })
    inviteeAccountant = await createUserClient({ email: uniqueEmail('acc-invitada') })
    viaPostgrestAccountant = await createUserClient({ email: uniqueEmail('acc-postgrest') })
    roleSwapper = await createUserClient({ email: uniqueEmail('acc-swap') })

    tenantA = await createTenant({
      name: 'Bar Contable A',
      slug: uniqueSlug('acct-a'),
      ownerId: adminA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar Contable B',
      slug: uniqueSlug('acct-b'),
      ownerId: ownerB.userId,
    })

    const { error: memberError } = await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: ownerNoAccessA.userId, role: 'owner' },
      { tenant_id: tenantA.id, user_id: ownerWithAccessA.userId, role: 'owner' },
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: roleSwapper.userId, role: 'cashier' },
    ])
    if (memberError) throw new Error(`memberships insert falló: ${memberError.message}`)

    // Acceso por persona: el admin (designado) y un dueño con acceso que no
    // administra. Con el service role porque las RPC de accesos son de la fase 1.
    const { error: accessError } = await service.from('acc_access').insert([
      {
        tenant_id: tenantA.id,
        user_id: adminA.userId,
        display_name: 'Admin Contable',
        is_admin: true,
        source: 'platform',
        granted_by_name: 'Soporte HUB',
      },
      {
        tenant_id: tenantA.id,
        user_id: ownerWithAccessA.userId,
        display_name: 'Dueño con acceso',
        is_admin: false,
        source: 'grant',
      },
    ])
    if (accessError) throw new Error(`acc_access insert falló: ${accessError.message}`)

    // La contadora se suma con el cliente de servicio (auth.uid() nulo: en la app
    // lo cubre la guardia TS de Equipo, que exige accounting.admin).
    const { error: accountantError } = await service
      .from('memberships')
      .insert({ tenant_id: tenantA.id, user_id: accountantA.userId, role: 'accountant' })
    if (accountantError) throw new Error(`contadora insert falló: ${accountantError.message}`)

    // Datos del bar A: lo que la contadora NO tiene que ver.
    customerA = (
      await seed<{ id: string }>('customers', {
        tenant_id: tenantA.id,
        phone: '+5493515550202',
        first_name: 'Cliente',
        last_name: 'Aislado',
      })
    ).id
    const tag = await seed<{ id: string }>('customer_tags', {
      tenant_id: tenantA.id,
      name: 'VIP contable',
    })
    await seed(
      'customer_tag_assignments',
      { customer_id: customerA, tag_id: tag.id },
      'customer_id',
    )

    channelA = (
      await seed<{ id: string }>('channels', {
        tenant_id: tenantA.id,
        type: 'whatsapp',
        external_account_id: `acct-wa-${tenantA.id}`,
      })
    ).id
    conversationA = (
      await seed<{ id: string }>('conversations', {
        tenant_id: tenantA.id,
        channel_id: channelA,
        external_user_id: 'acct-user-1',
      })
    ).id
    await seed('messages', {
      tenant_id: tenantA.id,
      conversation_id: conversationA,
      direction: 'inbound',
    })
    const conversationTag = await seed<{ id: string }>('conversation_tags', {
      tenant_id: tenantA.id,
      name: 'Pendiente contable',
    })
    await seed(
      'conversation_tag_assignments',
      { conversation_id: conversationA, tag_id: conversationTag.id },
      'conversation_id',
    )

    const manager = await seed<{ id: string }>('reservation_managers', {
      tenant_id: tenantA.id,
      display_name: 'Gestora Contable',
      commission_eligible: false,
      active: true,
    })
    reservationA = (
      await seed<{ id: string }>('salon_reservations', {
        tenant_id: tenantA.id,
        guest_name: 'Reserva Aislada',
        meal_type: 'dinner',
        reservation_date: '2026-12-29',
        reservation_time_local: '21:00',
        zone: 'planta_alta',
        estimated_guests: 3,
        origin: 'whatsapp',
        primary_manager_id: manager.id,
      })
    ).id

    const category = await seed<{ id: string }>('menu_categories', {
      tenant_id: tenantA.id,
      name: 'Tragos contables',
    })
    menuItemA = (
      await seed<{ id: string }>('menu_items', {
        tenant_id: tenantA.id,
        category_id: category.id,
        name: 'Fernet contable',
        price_cents: 350_000,
      })
    ).id
    const itemTag = await seed<{ id: string }>('item_tags', {
      tenant_id: tenantA.id,
      name: 'Sin TACC',
    })
    await seed(
      'menu_item_tag_assignments',
      { menu_item_id: menuItemA, tag_id: itemTag.id },
      'menu_item_id',
    )

    const table = await seed<{ id: string }>('physical_tables', {
      tenant_id: tenantA.id,
      label: 'ACCT-1',
    })
    sessionA = (
      await seed<{ id: string }>('table_sessions', {
        tenant_id: tenantA.id,
        physical_table_id: table.id,
      })
    ).id
    await seed('session_guests', { session_id: sessionA, browser_token: `acct-${sessionA}` })
    ticketA = (
      await seed<{ id: string }>('tickets', {
        tenant_id: tenantA.id,
        session_id: sessionA,
        created_by_user_id: adminA.userId,
      })
    ).id
    await seed('ticket_items', {
      ticket_id: ticketA,
      menu_item_id: menuItemA,
      quantity: 1,
      unit_price_cents: 350_000,
      line_total_cents: 350_000,
    })

    visitA = (
      await seed<{ id: string }>('visits', {
        tenant_id: tenantA.id,
        customer_id: customerA,
        total_amount_cents: 350_000,
      })
    ).id
    await seed('visit_items', {
      visit_id: visitA,
      menu_item_id: menuItemA,
      quantity: 1,
      unit_price_cents: 350_000,
      line_total_cents: 350_000,
    })
  }, HOOK_TIMEOUT)

  afterAll(async () => {
    if (service) {
      // Borrar los bares cascadea todo (membresías incluidas: el trigger de
      // gobierno deja pasar la cascada del bar entero) y acc_access.
      await service.from('tenants').delete().in('id', [tenantA?.id, tenantB?.id].filter(Boolean))
    }
    for (const user of [
      adminA,
      accountantA,
      ownerNoAccessA,
      ownerWithAccessA,
      cashierA,
      ownerB,
      inviteeAccountant,
      viaPostgrestAccountant,
      roleSwapper,
    ]) {
      if (user) await deleteUser(user.userId)
    }
  }, HOOK_TIMEOUT)

  describe('1 · la contadora no lee ni escribe fuera de Administración', () => {
    it(
      'SELECT de las 64 tablas con tenant_id del bar A → [] (el dueño sí ve lo sembrado)',
      async () => {
        const leaks: string[] = []
        for (const table of TENANT_TABLES) {
          const res = await accountantA.client
            .from(table)
            .select('tenant_id')
            .eq('tenant_id', tenantA.id)
            .limit(1)
          const leak = leakOf(table, res)
          if (leak) leaks.push(leak)
        }
        expect(leaks).toEqual([])

        // Control: lo sembrado existe y el dueño lo ve (si no, el test no prueba nada).
        for (const table of ['customers', 'conversations', 'messages', 'salon_reservations']) {
          const { data, error } = await adminA.client
            .from(table)
            .select('id')
            .eq('tenant_id', tenantA.id)
          expect(error).toBeNull()
          expect((data ?? []).length).toBeGreaterThan(0)
        }
      },
      TEST_TIMEOUT,
    )

    it(
      'SELECT de las 11 tablas hijas sin tenant_id → [] (bloqueadas por la madre)',
      async () => {
        const childQueries: Array<[string, () => PromiseLike<QueryResult>]> = [
          [
            'customer_tag_assignments',
            () =>
              accountantA.client
                .from('customer_tag_assignments')
                .select('customer_id')
                .eq('customer_id', customerA),
          ],
          [
            'conversation_tag_assignments',
            () =>
              accountantA.client
                .from('conversation_tag_assignments')
                .select('conversation_id')
                .eq('conversation_id', conversationA),
          ],
          [
            'menu_item_tag_assignments',
            () =>
              accountantA.client
                .from('menu_item_tag_assignments')
                .select('menu_item_id')
                .eq('menu_item_id', menuItemA),
          ],
          [
            'ticket_items',
            () => accountantA.client.from('ticket_items').select('id').eq('ticket_id', ticketA),
          ],
          [
            'visit_items',
            () => accountantA.client.from('visit_items').select('id').eq('visit_id', visitA),
          ],
          [
            'session_guests',
            () => accountantA.client.from('session_guests').select('id').eq('session_id', sessionA),
          ],
          [
            'table_session_events',
            () =>
              accountantA.client
                .from('table_session_events')
                .select('id')
                .eq('session_id', sessionA),
          ],
          // Sin madre sembrada: la contadora solo es miembro de A, así que sin filtro
          // tampoco tiene que ver nada.
          [
            'broadcast_recipients',
            () => accountantA.client.from('broadcast_recipients').select('id').limit(1),
          ],
          ['flow_edges', () => accountantA.client.from('flow_edges').select('id').limit(1)],
          ['flow_nodes', () => accountantA.client.from('flow_nodes').select('id').limit(1)],
          ['flow_steps', () => accountantA.client.from('flow_steps').select('id').limit(1)],
        ]
        const leaks: string[] = []
        for (const [name, query] of childQueries) {
          const leak = leakOf(name, await query())
          if (leak) leaks.push(leak)
        }
        expect(leaks).toEqual([])

        // Control: el dueño ve las hijas sembradas.
        const { data: ownerItems } = await adminA.client
          .from('ticket_items')
          .select('id')
          .eq('ticket_id', ticketA)
        expect((ownerItems ?? []).length).toBe(1)
      },
      TEST_TIMEOUT,
    )

    it(
      'INSERT en customers, customer_tags, conversations y messages → error',
      async () => {
        const inserts: Array<[string, Record<string, unknown>]> = [
          [
            'customers',
            {
              tenant_id: tenantA.id,
              phone: '+5493515550303',
              first_name: 'No',
              last_name: 'Debe',
            },
          ],
          ['customer_tags', { tenant_id: tenantA.id, name: 'No debe' }],
          [
            'conversations',
            {
              tenant_id: tenantA.id,
              channel_id: channelA,
              external_user_id: 'acct-no-debe',
            },
          ],
          [
            'messages',
            { tenant_id: tenantA.id, conversation_id: conversationA, direction: 'outbound' },
          ],
        ]
        for (const [table, row] of inserts) {
          const { error } = await accountantA.client.from(table).insert(row)
          expect(error, table).not.toBeNull()
        }
      },
      TEST_TIMEOUT,
    )

    it(
      'UPDATE de customers → [] y el cliente no cambia',
      async () => {
        const { data } = await accountantA.client
          .from('customers')
          .update({ first_name: 'Pisado' })
          .eq('id', customerA)
          .select('id')
        expect(data ?? []).toEqual([])

        const { data: row } = await service
          .from('customers')
          .select('first_name')
          .eq('id', customerA)
          .single()
        expect((row as { first_name: string } | null)?.first_name).toBe('Cliente')
      },
      TEST_TIMEOUT,
    )
  })

  describe('2 · RPC del salón y vistas de estadísticas', () => {
    it(
      'transition, update_actual_guests, evaluate_day_capacity, get_salon_occupancy y customer_effective_tier → forbidden',
      async () => {
        const calls: Array<[string, Record<string, unknown>]> = [
          ['transition_reservation_status', { p_reservation_id: reservationA, p_to: 'arrived' }],
          [
            'update_reservation_actual_guests',
            { p_reservation_id: reservationA, p_actual_guests: 2 },
          ],
          ['evaluate_day_capacity', { p_tenant_id: tenantA.id, p_date: '2026-12-29' }],
          ['get_salon_occupancy', { p_tenant_id: tenantA.id }],
          ['customer_effective_tier', { p_customer_id: customerA }],
        ]
        for (const [fn, args] of calls) {
          const { error } = await accountantA.client.rpc(fn, args)
          expect(error?.message, fn).toContain('forbidden')
        }
      },
      TEST_TIMEOUT,
    )

    it(
      'las 4 vistas v_* → []',
      async () => {
        const leaks: string[] = []
        for (const view of STATS_VIEWS) {
          const res = await accountantA.client.from(view).select('tenant_id').limit(1)
          const leak = leakOf(view, res)
          if (leak) leaks.push(leak)
        }
        expect(leaks).toEqual([])
      },
      TEST_TIMEOUT,
    )
  })

  describe('3 · lo único que ve: su membresía y su bar', () => {
    it(
      'memberships → solo su fila; tenants → su bar',
      async () => {
        const { data: memberships, error } = await accountantA.client
          .from('memberships')
          .select('user_id, role, tenant_id')
        expect(error).toBeNull()
        expect(memberships).toEqual([
          { user_id: accountantA.userId, role: 'accountant', tenant_id: tenantA.id },
        ])

        const { data: tenants } = await accountantA.client.from('tenants').select('id')
        expect(((tenants ?? []) as Array<{ id: string }>).map((t) => t.id)).toEqual([tenantA.id])
      },
      TEST_TIMEOUT,
    )

    it(
      'get_tenant_access(slug de A) → role = accountant',
      async () => {
        const { data, error } = await accountantA.client.rpc('get_tenant_access', {
          p_slug: tenantA.slug,
        })
        expect(error).toBeNull()
        expect((data as { role?: string } | null)?.role).toBe('accountant')
      },
      TEST_TIMEOUT,
    )

    // Fase 1 (migración #6, acc_access_rls): get_tenant_access suma la clave
    // `accounting` (acc_my_access). Con el flag prendido y el módulo configurado:
    // read = true, write = false, admin = false.
    it.todo('get_tenant_access → accounting.read = true, write = false, admin = false (fase 1)')

    it(
      'no tiene gestor de reservas activo (la provisión la saltea)',
      async () => {
        expect(await activeManagers(tenantA.id, accountantA.userId)).toEqual([])
      },
      TEST_TIMEOUT,
    )
  })

  describe('4 · Administración para la contadora', () => {
    it(
      'acc_access: INSERT, UPDATE y DELETE directos → 42501 (sin privilegio, para cualquiera)',
      async () => {
        const insert = await accountantA.client.from('acc_access').insert({
          tenant_id: tenantA.id,
          user_id: accountantA.userId,
          display_name: 'Me lo doy',
        })
        expect(insert.error?.code).toBe('42501')

        const update = await adminA.client
          .from('acc_access')
          .update({ is_admin: true })
          .eq('tenant_id', tenantA.id)
        expect(update.error?.code).toBe('42501')

        const remove = await adminA.client.from('acc_access').delete().eq('tenant_id', tenantA.id)
        expect(remove.error?.code).toBe('42501')
      },
      TEST_TIMEOUT,
    )

    // Fase 1: tablas acc_* (#5), política acc_select_readers (#6), RPC de escritura
    // (#8, #9) y reportes (#11).
    it.todo('SELECT de cada tabla acc_* del bar A → filas (fase 1)')
    it.todo('cada RPC de escritura acc_* → forbidden (fase 1)')
    it.todo('cada acc_report_* → ok (fase 1)')
    it.todo('audit_log → solo filas acc_* (fase 1, audit_log_acc_select)')
  })

  describe('5 · dueño SIN acceso: no crea contadoras ni toca a quien tiene acceso', () => {
    it(
      'INSERT por PostgREST en memberships con role accountant → accountant_requires_acc_admin',
      async () => {
        const { error } = await ownerNoAccessA.client.from('memberships').insert({
          tenant_id: tenantA.id,
          user_id: ownerB.userId,
          role: 'accountant',
        })
        expectErrorContaining(error, 'accountant_requires_acc_admin')
        expect(await membershipRole(tenantA.id, ownerB.userId)).toBeNull()
      },
      TEST_TIMEOUT,
    )

    it(
      'UPDATE del cajero a accountant → accountant_requires_acc_admin',
      async () => {
        const { error } = await ownerNoAccessA.client
          .from('memberships')
          .update({ role: 'accountant' })
          .eq('tenant_id', tenantA.id)
          .eq('user_id', cashierA.userId)
          .select('id')
        expectErrorContaining(error, 'accountant_requires_acc_admin')
        expect(await membershipRole(tenantA.id, cashierA.userId)).toBe('cashier')
      },
      TEST_TIMEOUT,
    )

    it(
      'INSERT en invitations con role accountant (también con invited_by = el admin) → accountant_requires_acc_admin',
      async () => {
        for (const invitedBy of [ownerNoAccessA.userId, adminA.userId]) {
          const { error } = await ownerNoAccessA.client.from('invitations').insert({
            tenant_id: tenantA.id,
            email: uniqueEmail('acc-inv-no'),
            role: 'accountant',
            invited_by: invitedBy,
          })
          expectErrorContaining(error, 'accountant_requires_acc_admin')
        }
      },
      TEST_TIMEOUT,
    )

    it(
      'UPDATE de rol o DELETE de la membresía del admin → protected_accounting_member',
      async () => {
        const demote = await ownerNoAccessA.client
          .from('memberships')
          .update({ role: 'cashier' })
          .eq('tenant_id', tenantA.id)
          .eq('user_id', adminA.userId)
          .select('id')
        expectErrorContaining(demote.error, 'protected_accounting_member')

        const remove = await ownerNoAccessA.client
          .from('memberships')
          .delete()
          .eq('tenant_id', tenantA.id)
          .eq('user_id', adminA.userId)
          .select('id')
        expectErrorContaining(remove.error, 'protected_accounting_member')

        // Tampoco a la contadora, ni a un dueño con acceso que no administra.
        const accountant = await ownerNoAccessA.client
          .from('memberships')
          .update({ role: 'cashier' })
          .eq('tenant_id', tenantA.id)
          .eq('user_id', accountantA.userId)
          .select('id')
        expectErrorContaining(accountant.error, 'protected_accounting_member')

        expect(await membershipRole(tenantA.id, adminA.userId)).toBe('owner')
        expect(await membershipRole(tenantA.id, accountantA.userId)).toBe('accountant')
      },
      TEST_TIMEOUT,
    )

    it(
      'un dueño con acceso que NO administra tampoco toca al admin',
      async () => {
        const { error } = await ownerWithAccessA.client
          .from('memberships')
          .update({ role: 'cashier' })
          .eq('tenant_id', tenantA.id)
          .eq('user_id', adminA.userId)
          .select('id')
        expectErrorContaining(error, 'protected_accounting_member')
      },
      TEST_TIMEOUT,
    )

    it(
      'acc_member_is_protected: true para el admin y la contadora, false para el cajero; el cajero → forbidden',
      async () => {
        for (const [userId, expected] of [
          [adminA.userId, true],
          [accountantA.userId, true],
          [cashierA.userId, false],
        ] as const) {
          const { data, error } = await ownerNoAccessA.client.rpc('acc_member_is_protected', {
            p_tenant_id: tenantA.id,
            p_user_id: userId,
          })
          expect(error).toBeNull()
          expect(data).toBe(expected)
        }

        const cashier = await cashierA.client.rpc('acc_member_is_protected', {
          p_tenant_id: tenantA.id,
          p_user_id: adminA.userId,
        })
        expectErrorContaining(cashier.error, 'forbidden')

        const otherBar = await ownerB.client.rpc('acc_member_is_protected', {
          p_tenant_id: tenantA.id,
          p_user_id: adminA.userId,
        })
        expectErrorContaining(otherBar.error, 'forbidden')
      },
      TEST_TIMEOUT,
    )

    it.todo('SELECT acc_* → [] y cada RPC acc_* → forbidden (fase 1)')
    it.todo('audit_log sin filas acc_* (fase 1, RESTRICTIVE audit_log_acc_scope)')
  })

  describe('6 · el admin de Administración sí suma a la contadora', () => {
    it(
      'por PostgREST: INSERT de una membresía accountant → ok',
      async () => {
        const { error } = await adminA.client.from('memberships').insert({
          tenant_id: tenantA.id,
          user_id: viaPostgrestAccountant.userId,
          role: 'accountant',
        })
        expect(error).toBeNull()
        expect(await membershipRole(tenantA.id, viaPostgrestAccountant.userId)).toBe('accountant')
        // Sin gestor: la contadora no toma reservas.
        expect(await activeManagers(tenantA.id, viaPostgrestAccountant.userId)).toEqual([])
      },
      TEST_TIMEOUT,
    )

    it(
      'por invitación: el admin invita y la invitada acepta → membresía accountant',
      async () => {
        const { data: invitation, error } = await adminA.client
          .from('invitations')
          .insert({
            tenant_id: tenantA.id,
            email: inviteeAccountant.email,
            role: 'accountant',
            invited_by: adminA.userId,
          })
          .select('token')
          .single()
        expect(error).toBeNull()
        const token = (invitation as { token: string } | null)?.token
        expect(token).toBeTruthy()

        const accepted = await inviteeAccountant.client.rpc('accept_invitation', {
          p_token: token,
        })
        expect(accepted.error).toBeNull()
        expect(await membershipRole(tenantA.id, inviteeAccountant.userId)).toBe('accountant')
      },
      TEST_TIMEOUT,
    )
  })

  describe('7 · dueño de OTRO bar', () => {
    it(
      'no lee la membresía de la contadora de A ni su acceso',
      async () => {
        const { data } = await ownerB.client
          .from('memberships')
          .select('user_id')
          .eq('tenant_id', tenantA.id)
        expect(data ?? []).toEqual([])
      },
      TEST_TIMEOUT,
    )

    // Fase 1: tablas acc_* (#5-#6) y acc_post_bundle (#9).
    it.todo('SELECT acc_* del bar A → [] (fase 1)')
    it.todo('acc_post_bundle(p_tenant_id = A) → forbidden (fase 1)')
    it.todo('acc_post_bundle con su bar y ids de A → *_not_found o 23503 (fase 1)')
  })

  describe('8 · sincronía con el equipo', () => {
    it(
      'el admin pasa a cajero a un dueño con acceso → acc_access revocado («Dejó de ser dueño»)',
      async () => {
        const { error } = await adminA.client
          .from('memberships')
          .update({ role: 'cashier' })
          .eq('tenant_id', tenantA.id)
          .eq('user_id', ownerWithAccessA.userId)
          .select('id')
        expect(error).toBeNull()

        const { data } = await service
          .from('acc_access')
          .select('revoked_at, revoked_by, revoke_reason')
          .eq('tenant_id', tenantA.id)
          .eq('user_id', ownerWithAccessA.userId)
          .single()
        const access = data as {
          revoked_at: string | null
          revoked_by: string | null
          revoke_reason: string | null
        } | null
        expect(access?.revoked_at).not.toBeNull()
        expect(access?.revoked_by).toBe(adminA.userId)
        expect(access?.revoke_reason).toBe('Dejó de ser dueño')

        // Ya no está protegido: cualquier dueño lo puede volver a mover.
        const { data: isProtected } = await ownerNoAccessA.client.rpc('acc_member_is_protected', {
          p_tenant_id: tenantA.id,
          p_user_id: ownerWithAccessA.userId,
        })
        expect(isProtected).toBe(false)
      },
      TEST_TIMEOUT,
    )

    it.todo('lecturas acc_* del ex dueño → [] (fase 1)')
  })

  describe('9 · gestores de reservas al pasar a/desde contadora', () => {
    it(
      'pasar a contadora apaga su gestor; volver a cajero lo reprovisiona',
      async () => {
        expect(await activeManagers(tenantA.id, roleSwapper.userId)).toEqual([true])

        const toAccountant = await adminA.client
          .from('memberships')
          .update({ role: 'accountant' })
          .eq('tenant_id', tenantA.id)
          .eq('user_id', roleSwapper.userId)
          .select('id')
        expect(toAccountant.error).toBeNull()
        expect(await activeManagers(tenantA.id, roleSwapper.userId)).toEqual([false])

        // Mover a la contadora es solo del admin (gobierno), y la fila del gestor
        // nunca se borra: se reactiva la misma.
        const back = await adminA.client
          .from('memberships')
          .update({ role: 'cashier' })
          .eq('tenant_id', tenantA.id)
          .eq('user_id', roleSwapper.userId)
          .select('id')
        expect(back.error).toBeNull()
        expect(await activeManagers(tenantA.id, roleSwapper.userId)).toEqual([true])
      },
      TEST_TIMEOUT,
    )
  })

  describe('10 · detectores de huecos', () => {
    it(
      'acc_isolation_gaps() y acc_rpc_isolation_gaps() con service role → vacíos',
      async () => {
        const tables = await service.rpc('acc_isolation_gaps')
        expect(tables.error).toBeNull()
        expect(tables.data).toEqual([])

        const rpcs = await service.rpc('acc_rpc_isolation_gaps')
        expect(rpcs.error).toBeNull()
        expect(rpcs.data).toEqual([])
      },
      TEST_TIMEOUT,
    )

    it(
      'los detectores no son para usuarios: authenticated → permission denied',
      async () => {
        const { error } = await adminA.client.rpc('acc_isolation_gaps')
        expect(error?.code).toBe('42501')
      },
      TEST_TIMEOUT,
    )
  })
})
