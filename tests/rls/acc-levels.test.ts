import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

/**
 * Accesos por nivel (migración `acc_accesos_por_nivel`, 23/11/2026). Pedido de los socios de HUB: «dentro de
 * administración, los empleados solo deberían poder ver compra y pagos».
 *
 * Tres personas, las tres con rol dueño en el bar (como los encargados de HUB):
 *  - el socio: acceso completo y da accesos;
 *  - el empleado: acceso «solo compras y pagos»;
 *  - el que no tiene acceso a Administración.
 *
 * Lo que se prueba es la base (RLS y RPC), que es la que manda: la app solo decide qué se dibuja.
 * Corre contra el Supabase local del job `rls`.
 */

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

type UserCtx = Awaited<ReturnType<typeof createUserClient>>

const FORBIDDEN = '42501'

function booksStart(): string {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 10)
}

function thisMonth(): string {
  return `${new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)}-01`
}

async function kindsOfParties(client: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data, error } = await client.from('acc_parties').select('kind').eq('tenant_id', tenantId)
  if (error) throw new Error(`acc_parties: ${error.message}`)
  return [...new Set((data ?? []).map((row) => String((row as { kind: string }).kind)))].sort()
}

async function countOf(client: SupabaseClient, table: string, tenantId: string): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`${table}: ${error.message}`)
  return count ?? 0
}

describeIfRls('Administración: accesos por nivel', () => {
  let partner: UserCtx
  let employee: UserCtx
  let outsider: UserCtx
  let tenant: string

  beforeAll(async () => {
    partner = await createUserClient({ email: uniqueEmail('lvlSocio') })
    employee = await createUserClient({ email: uniqueEmail('lvlEmpleado') })
    outsider = await createUserClient({ email: uniqueEmail('lvlSinAcceso') })

    const service = getServiceClient()
    const created = await service
      .from('tenants')
      .insert({
        name: 'Bar con niveles',
        slug: uniqueSlug('acc-lvl'),
        feature_flags: { accounting: true },
      })
      .select('id')
      .single()
    if (created.error || !created.data) {
      throw new Error(`create tenant failed: ${created.error?.message}`)
    }
    tenant = (created.data as { id: string }).id
    const members = await service.from('memberships').insert([
      { tenant_id: tenant, user_id: partner.userId, role: 'owner' },
      { tenant_id: tenant, user_id: employee.userId, role: 'owner' },
      { tenant_id: tenant, user_id: outsider.userId, role: 'owner' },
    ])
    if (members.error) throw new Error(`create memberships failed: ${members.error.message}`)

    const boot = await partner.client.rpc('acc_bootstrap', {
      p_tenant_id: tenant,
      p_payload: {
        settings: {
          legal_name: 'Bar con niveles SAS',
          cuit: '30718765435',
          books_start_date: booksStart(),
          iva_condition: 'responsable_inscripto',
          fiscal_year_end_month: 12,
        },
        treasuries: [
          { key: 'cash_main', name: 'Caja', kind: 'cash' },
          { key: 'bank_main', name: 'Banco', kind: 'bank' },
        ],
        sales: {
          transfer_destination: 'bank_main',
          enabled_methods: ['cash', 'transfer', 'debit', 'credit'],
          sales_points: [{ number: 5 }],
        },
      },
    })
    if (boot.error) throw new Error(`acc_bootstrap failed: ${boot.error.message}`)

    const supplier = await partner.client.rpc('acc_save_party', {
      p_tenant_id: tenant,
      p_party: { kind: 'supplier', name: 'Distribuidora de prueba' },
      p_expected_updated_at: null,
    })
    if (supplier.error) throw new Error(`acc_save_party failed: ${supplier.error.message}`)

    const grant = await partner.client.rpc('acc_set_access', {
      p_tenant_id: tenant,
      p_user_id: employee.userId,
      p_scope: 'purchases',
    })
    if (grant.error) throw new Error(`acc_set_access failed: ${grant.error.message}`)
  })

  afterAll(async () => {
    const service = getServiceClient()
    if (tenant) await service.from('tenants').delete().eq('id', tenant)
    for (const user of [partner, employee, outsider]) {
      if (user) await deleteUser(user.userId)
    }
  })

  it('el empleado entra a Compras y pagos y a nada más', async () => {
    const { data, error } = await employee.client.rpc('acc_my_access', { p_tenant: tenant })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      enabled: true,
      set_up: true,
      read: false,
      write: false,
      admin: false,
      buy_read: true,
      buy_write: true,
      scope: 'purchases',
    })
  })

  it('al socio no le cambia nada: lee, carga y da accesos', async () => {
    const { data, error } = await partner.client.rpc('acc_my_access', { p_tenant: tenant })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      read: true,
      write: true,
      admin: true,
      buy_read: true,
      buy_write: true,
      scope: 'full',
    })
  })

  it('el empleado ve los proveedores y ningún otro partícipe', async () => {
    expect(await kindsOfParties(employee.client, tenant)).toEqual(['supplier'])
    // El socio ve también al personal, los organismos, las billeteras…
    const all = await kindsOfParties(partner.client, tenant)
    expect(all).toContain('supplier')
    expect(all.length).toBeGreaterThan(1)
  })

  it('el empleado ve los nombres de las cuentas y de las cajas, pero no quién tiene acceso ni los sueldos', async () => {
    expect(await countOf(employee.client, 'acc_accounts', tenant)).toBeGreaterThan(0)
    expect(await countOf(employee.client, 'acc_treasury_accounts', tenant)).toBeGreaterThan(0)
    expect(await countOf(employee.client, 'acc_access', tenant)).toBe(0)
    expect(await countOf(employee.client, 'acc_employees', tenant)).toBe(0)
    expect(await countOf(employee.client, 'acc_sales_methods', tenant)).toBe(0)
    expect(await countOf(employee.client, 'acc_bundles', tenant)).toBe(0)
    // El socio sí.
    expect(await countOf(partner.client, 'acc_access', tenant)).toBe(2)
    expect(await countOf(partner.client, 'acc_sales_methods', tenant)).toBeGreaterThan(0)
  })

  it('lo que arma un formulario de compra le llega sin saldos ni clientes', async () => {
    const { data, error } = await employee.client.rpc('acc_posting_context', {
      p_tenant_id: tenant,
    })
    expect(error).toBeNull()
    const ctx = data as {
      parties: { kind: string }[]
      treasuries: { balance_cents: number }[]
      methods: unknown[]
      sales_points: unknown[]
      accounts: unknown[]
    }
    expect(ctx.accounts.length).toBeGreaterThan(0)
    expect(ctx.treasuries.length).toBeGreaterThan(0)
    expect(ctx.treasuries.every((t) => Number(t.balance_cents) === 0)).toBe(true)
    expect(ctx.parties.length).toBeGreaterThan(0)
    expect(ctx.parties.every((p) => p.kind === 'supplier')).toBe(true)
    expect(ctx.methods).toEqual([])
    expect(ctx.sales_points).toEqual([])
  })

  it('el empleado no lee sueldos, no se da accesos ni carga empleados', async () => {
    const payroll = await employee.client.rpc('acc_report_payroll', {
      p_tenant_id: tenant,
      p_month: thisMonth(),
    })
    expect(payroll.error?.code).toBe(FORBIDDEN)

    const admins = await employee.client.rpc('acc_set_access', {
      p_tenant_id: tenant,
      p_user_id: employee.userId,
      p_scope: 'full',
      p_is_admin: true,
    })
    expect(admins.error?.code).toBe(FORBIDDEN)

    const salary = await employee.client.rpc('acc_save_employee', {
      p_tenant_id: tenant,
      p_employee: { id: null, name: 'Nadie', pay_frequency: 'monthly', active: true, notes: null },
    })
    expect(salary.error?.code).toBe(FORBIDDEN)
  })

  it('el empleado carga proveedores, no otros partícipes', async () => {
    const supplier = await employee.client.rpc('acc_save_party', {
      p_tenant_id: tenant,
      p_party: { kind: 'supplier', name: 'Verdulería de prueba' },
      p_expected_updated_at: null,
    })
    expect(supplier.error).toBeNull()

    const customer = await employee.client.rpc('acc_save_party', {
      p_tenant_id: tenant,
      p_party: { kind: 'customer', name: 'Cliente de prueba' },
      p_expected_updated_at: null,
    })
    expect(customer.error?.code).toBe(FORBIDDEN)
  })

  it('las cuentas de los proveedores se las puede pedir; las de otro partícipe no existen para él', async () => {
    const balances = await employee.client.rpc('acc_report_party_balances', {
      p_tenant_id: tenant,
      p_as_of: null,
      p_group: 'payables',
    })
    expect(balances.error).toBeNull()
    const rows = (balances.data ?? []) as { party_kind: string }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.party_kind === 'supplier')).toBe(true)

    const receivables = await employee.client.rpc('acc_report_party_balances', {
      p_tenant_id: tenant,
      p_as_of: null,
      p_group: 'receivables',
    })
    expect(receivables.error).toBeNull()
    expect(receivables.data ?? []).toEqual([])
  })

  it('dar accesos pide el nivel completo, y quien no tiene acceso no entra', async () => {
    const both = await partner.client.rpc('acc_set_access', {
      p_tenant_id: tenant,
      p_user_id: employee.userId,
      p_scope: 'purchases',
      p_is_admin: true,
    })
    expect(both.error?.message).toContain('admin_needs_full')

    const none = await outsider.client.rpc('acc_my_access', { p_tenant: tenant })
    expect(none.data).toMatchObject({ read: false, buy_read: false, buy_write: false })
    expect(await kindsOfParties(outsider.client, tenant)).toEqual([])
    const context = await outsider.client.rpc('acc_posting_context', { p_tenant_id: tenant })
    expect(context.error?.code).toBe(FORBIDDEN)
  })

  it('subir de nivel abre todo; bajarlo lo vuelve a cerrar', async () => {
    const up = await partner.client.rpc('acc_set_access', {
      p_tenant_id: tenant,
      p_user_id: employee.userId,
      p_scope: 'full',
    })
    expect(up.error).toBeNull()
    expect((await kindsOfParties(employee.client, tenant)).length).toBeGreaterThan(1)

    const down = await partner.client.rpc('acc_set_access', {
      p_tenant_id: tenant,
      p_user_id: employee.userId,
      p_scope: 'purchases',
    })
    expect(down.error).toBeNull()
    expect(await kindsOfParties(employee.client, tenant)).toEqual(['supplier'])
  })
})
