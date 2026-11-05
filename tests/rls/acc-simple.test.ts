import { createHash, randomUUID } from 'node:crypto'
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createUserClient,
  deleteUser,
  getAnonClient,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

/**
 * Administración simple (migraciones 20261104120000…120700, reunión del 29/10/2026): el plan de la
 * semana, los sueldos, los impuestos, reimputar y la foto por QR. Aislamiento entre bares, contadora
 * de solo lectura en todo menos en reimputar, y el link del QR que abre solo con su token.
 * Corre contra el Supabase local del job `rls`.
 */

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

type UserCtx = Awaited<ReturnType<typeof createUserClient>>

/** Primer día del mes anterior en Córdoba: arranque de libros válido para acc_bootstrap. */
function booksStart(): string {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 10)
}

/** El lunes de esta semana en Córdoba. */
function thisMonday(): string {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const shift = (now.getUTCDay() + 6) % 7
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - shift))
    .toISOString()
    .slice(0, 10)
}

function thisMonth(): string {
  return `${new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)}-01`
}

async function createAccountingTenant(name: string, ownerId: string): Promise<string> {
  const service = getServiceClient()
  const { data, error } = await service
    .from('tenants')
    .insert({ name, slug: uniqueSlug('acc-simple'), feature_flags: { accounting: true } })
    .select('id')
    .single()
  if (error || !data) throw new Error(`create tenant failed: ${error?.message}`)
  const tenantId = (data as { id: string }).id
  const { error: memberError } = await service
    .from('memberships')
    .insert({ tenant_id: tenantId, user_id: ownerId, role: 'owner' })
  if (memberError) throw new Error(`create membership failed: ${memberError.message}`)
  return tenantId
}

async function bootstrap(client: SupabaseClient, tenantId: string, cuit: string): Promise<void> {
  const { error } = await client.rpc('acc_bootstrap', {
    p_tenant_id: tenantId,
    p_payload: {
      settings: {
        legal_name: 'Bar de Prueba SAS',
        cuit,
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
  if (error) throw new Error(`acc_bootstrap failed: ${error.message}`)
}

function expectForbidden(error: PostgrestError | null): void {
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')
}

describeIfRls('Administración simple', () => {
  let ownerA: UserCtx
  let accountant: UserCtx
  let ownerB: UserCtx
  let tenantA: string
  let tenantB: string
  let supplierA: string
  const monday = thisMonday()
  const month = thisMonth()

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('simOwnA') })
    accountant = await createUserClient({ email: uniqueEmail('simCont') })
    ownerB = await createUserClient({ email: uniqueEmail('simOwnB') })
    tenantA = await createAccountingTenant('Bar A (simple)', ownerA.userId)
    tenantB = await createAccountingTenant('Bar B (simple)', ownerB.userId)
    const { error } = await getServiceClient()
      .from('memberships')
      .insert({ tenant_id: tenantA, user_id: accountant.userId, role: 'accountant' })
    if (error) throw new Error(`accountant membership failed: ${error.message}`)
    await bootstrap(ownerA.client, tenantA, '30718765435')
    await bootstrap(ownerB.client, tenantB, '30712345671')

    const { data: party, error: partyError } = await getServiceClient()
      .from('acc_parties')
      .insert({
        tenant_id: tenantA,
        kind: 'supplier',
        name: 'Proveedor de prueba',
        payable_account_id: await accountOf(tenantA, 'payable_suppliers'),
        receivable_account_id: await accountOf(tenantA, 'receivable_customers'),
      })
      .select('id')
      .single()
    if (partyError || !party) throw new Error(`create party failed: ${partyError?.message}`)
    supplierA = (party as { id: string }).id
  })

  afterAll(async () => {
    const service = getServiceClient()
    for (const tenantId of [tenantA, tenantB]) {
      if (tenantId) await service.from('tenants').delete().eq('id', tenantId)
    }
    for (const user of [ownerA, accountant, ownerB]) {
      if (user) await deleteUser(user.userId)
    }
  })

  async function accountOf(tenantId: string, systemKey: string): Promise<string> {
    const { data, error } = await getServiceClient()
      .from('acc_accounts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('system_key', systemKey)
      .single()
    if (error || !data) throw new Error(`account ${systemKey} failed: ${error?.message}`)
    return (data as { id: string }).id
  }

  describe('plan de la semana', () => {
    it('el dueño guarda y lee su presupuesto', async () => {
      const saved = await ownerA.client.rpc('acc_save_payment_budget', {
        p_tenant_id: tenantA,
        p_week_start: monday,
        p_items: [{ party_id: supplierA, amount_cents: 12_500_000 }],
      })
      expect(saved.error).toBeNull()
      const plan = await ownerA.client.rpc('acc_report_week_plan', {
        p_tenant_id: tenantA,
        p_week_start: monday,
      })
      expect(plan.error).toBeNull()
      const row = (plan.data as { party_id: string; budget_cents: number }[]).find(
        (r) => r.party_id === supplierA,
      )
      expect(row?.budget_cents).toBe(12_500_000)
    })

    it('la semana arranca el lunes', async () => {
      const tuesday = new Date(`${monday}T12:00:00Z`)
      tuesday.setUTCDate(tuesday.getUTCDate() + 1)
      const { error } = await ownerA.client.rpc('acc_save_payment_budget', {
        p_tenant_id: tenantA,
        p_week_start: tuesday.toISOString().slice(0, 10),
        p_items: [{ party_id: supplierA, amount_cents: 1 }],
      })
      expect(error?.message ?? '').toContain('invalid_payload')
    })

    it('la contadora lee y no escribe; el otro bar, ni una cosa ni la otra', async () => {
      const read = await accountant.client.rpc('acc_report_week_plan', {
        p_tenant_id: tenantA,
        p_week_start: monday,
      })
      expect(read.error).toBeNull()
      expectForbidden(
        (
          await accountant.client.rpc('acc_save_payment_budget', {
            p_tenant_id: tenantA,
            p_week_start: monday,
            p_items: [{ party_id: supplierA, amount_cents: 1 }],
          })
        ).error,
      )
      expectForbidden(
        (
          await ownerB.client.rpc('acc_report_week_plan', {
            p_tenant_id: tenantA,
            p_week_start: monday,
          })
        ).error,
      )
      const direct = await ownerB.client
        .from('acc_payment_budgets')
        .select('party_id')
        .eq('tenant_id', tenantA)
      expect(direct.data ?? []).toEqual([])
    })

    it('la tabla no se escribe directo, ni siendo dueño', async () => {
      expectForbidden(
        (
          await ownerA.client.from('acc_payment_budgets').insert({
            tenant_id: tenantA,
            week_start: monday,
            party_id: supplierA,
            amount_cents: 1,
          })
        ).error,
      )
    })
  })

  describe('sueldos', () => {
    let employeeId: string

    it('el dueño carga un empleado y su sueldo, y sale en la planilla', async () => {
      const saved = await ownerA.client.rpc('acc_save_employee', {
        p_tenant_id: tenantA,
        p_employee: { name: 'Empleada de prueba', pay_frequency: 'monthly', active: true },
      })
      expect(saved.error).toBeNull()
      employeeId = (saved.data as { id: string }).id
      const salary = await ownerA.client.rpc('acc_save_employee_salary', {
        p_tenant_id: tenantA,
        p_employee_id: employeeId,
        p_month: month,
        p_salary_cents: 80_000_000,
      })
      expect(salary.error).toBeNull()
      const report = await accountant.client.rpc('acc_report_payroll', {
        p_tenant_id: tenantA,
        p_month: month,
      })
      expect(report.error).toBeNull()
      const data = report.data as {
        accrual: unknown
        employees: { id: string; salary_cents: number; movements: unknown[] }[]
      }
      expect(data.accrual).toBeNull()
      const row = data.employees.find((e) => e.id === employeeId)
      expect(row?.salary_cents).toBe(80_000_000)
      expect(row?.movements).toEqual([])
    })

    it('la contadora no escribe; el otro bar no ve ni escribe', async () => {
      expectForbidden(
        (
          await accountant.client.rpc('acc_save_employee_salary', {
            p_tenant_id: tenantA,
            p_employee_id: employeeId,
            p_month: month,
            p_salary_cents: 1,
          })
        ).error,
      )
      expectForbidden(
        (await ownerB.client.rpc('acc_report_payroll', { p_tenant_id: tenantA, p_month: month }))
          .error,
      )
      expectForbidden(
        (
          await ownerB.client.rpc('acc_save_employee', {
            p_tenant_id: tenantA,
            p_employee: { name: 'Intruso', pay_frequency: 'monthly', active: true },
          })
        ).error,
      )
      for (const table of ['acc_employees', 'acc_employee_salaries']) {
        const direct = await ownerB.client.from(table).select('tenant_id').eq('tenant_id', tenantA)
        expect(direct.data ?? [], table).toEqual([])
      }
    })
  })

  describe('impuestos', () => {
    it('el dueño guarda; la contadora y el otro bar, no', async () => {
      const settings = {
        auto: true,
        iibb_bp: 250,
        municipal_bp: 70,
        bank_tax_bp: 60,
        base: 'all_sales',
      }
      const saved = await ownerA.client.rpc('acc_save_tax_settings', {
        p_tenant_id: tenantA,
        p_settings: settings,
      })
      expect(saved.error).toBeNull()
      const { data } = await ownerA.client
        .from('acc_settings')
        .select('tax_settings')
        .eq('tenant_id', tenantA)
        .single()
      expect((data as { tax_settings: unknown }).tax_settings).toEqual(settings)
      for (const client of [accountant.client, ownerB.client]) {
        expectForbidden(
          (
            await client.rpc('acc_save_tax_settings', {
              p_tenant_id: tenantA,
              p_settings: settings,
            })
          ).error,
        )
      }
    })
  })

  describe('reimputar', () => {
    it('otro bar no llega; la contadora sí pasa el permiso', async () => {
      const args = {
        p_tenant_id: tenantA,
        p_line_id: randomUUID(),
        p_account_id: randomUUID(),
        p_reason: null,
      }
      expectForbidden((await ownerB.client.rpc('acc_reimpute_line', args)).error)
      const { error } = await accountant.client.rpc('acc_reimpute_line', args)
      // Pasa el permiso y frena porque el renglón no existe.
      expect(error?.code).not.toBe('42501')
      expect(error?.message ?? '').toContain('document_not_found')
    })

    it('las banderas de imputación las lee quien lee el bar', async () => {
      const args = { p_tenant_id: tenantA, p_from: month, p_to: month }
      expect((await accountant.client.rpc('acc_report_imputation_flags', args)).error).toBeNull()
      expectForbidden((await ownerB.client.rpc('acc_report_imputation_flags', args)).error)
    })
  })

  describe('la foto por QR', () => {
    const token = `qa-${randomUUID()}`
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const linkId = randomUUID()
    const path = () => `${tenantA}/${linkId}/${randomUUID()}.jpg`
    let slotPath: string

    it('el dueño lo crea; la contadora y el otro bar, no', async () => {
      slotPath = path()
      const args = {
        p_tenant_id: tenantA,
        p_link_id: linkId,
        p_token_hash: tokenHash,
        p_slots: [{ path: slotPath, token: 'firmado' }],
        p_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }
      expectForbidden((await accountant.client.rpc('acc_upload_link_create', args)).error)
      expectForbidden((await ownerB.client.rpc('acc_upload_link_create', args)).error)
      const { error } = await ownerA.client.rpc('acc_upload_link_create', args)
      expect(error).toBeNull()
    })

    it('sin sesión abre solo con el token, y no ve nada más', async () => {
      const anon = getAnonClient()
      const wrong = await anon.rpc('acc_upload_link_open', { p_token: 'no-es-el-token' })
      expect((wrong.data as { ok: boolean }).ok).toBe(false)
      const open = await anon.rpc('acc_upload_link_open', { p_token: token })
      expect(open.error).toBeNull()
      const link = open.data as { ok: boolean; bucket: string; slots: { path: string }[] }
      expect(link.ok).toBe(true)
      expect(link.bucket).toBe('acc-comprobantes')
      expect(link.slots.map((s) => s.path)).toEqual([slotPath])
      expectForbidden((await anon.from('acc_upload_links').select('id')).error)
      expectForbidden(
        (await anon.rpc('acc_upload_link_files_list', { p_tenant_id: tenantA, p_link_id: linkId }))
          .error,
      )
    })

    it('lo que sube el celular aparece en la compu; con otro token, no', async () => {
      const anon = getAnonClient()
      const args = {
        p_path: slotPath,
        p_file_name: 'foto.jpg',
        p_mime_type: 'image/jpeg',
        p_size_bytes: 1000,
      }
      const bad = await anon.rpc('acc_upload_link_add', { ...args, p_token: 'no-es-el-token' })
      expect(bad.error ?? (bad.data as { ok: boolean }).ok === false).toBeTruthy()
      const good = await anon.rpc('acc_upload_link_add', { ...args, p_token: token })
      expect(good.error).toBeNull()
      const listed = await ownerA.client.rpc('acc_upload_link_files_list', {
        p_tenant_id: tenantA,
        p_link_id: linkId,
      })
      expect(listed.error).toBeNull()
      expect((listed.data as { path: string }[]).map((f) => f.path)).toEqual([slotPath])
      expectForbidden(
        (
          await ownerB.client.rpc('acc_upload_link_files_list', {
            p_tenant_id: tenantA,
            p_link_id: linkId,
          })
        ).error,
      )
    })

    it('cerrado, el token ya no abre', async () => {
      const closed = await ownerA.client.rpc('acc_upload_link_close', {
        p_tenant_id: tenantA,
        p_link_id: linkId,
      })
      expect(closed.error).toBeNull()
      const open = await getAnonClient().rpc('acc_upload_link_open', { p_token: token })
      expect((open.data as { ok: boolean }).ok).toBe(false)
    })
  })
})
