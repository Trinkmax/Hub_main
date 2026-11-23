import { randomUUID } from 'node:crypto'
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
 * Administración por sucursal (migración `acc_sucursales`, 23/11/2026): cada comprobante, gasto fijo, caja en
 * efectivo y empleado dice de qué sucursal es; los informes reciben `p_branch_id` (vacío = todo el bar); una caja de
 * otra sucursal no se mueve desde esta; el pago de un gasto fijo va a la sucursal del gasto fijo; «Cambiar de
 * sucursal» solo lo hace un dueño con carga de ese bar. Corre contra el Supabase local del job `rls`.
 */

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

type UserCtx = Awaited<ReturnType<typeof createUserClient>>

function booksStart(): string {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 10)
}

function today(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function nextMonthDay(day: number): string {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day))
    .toISOString()
    .slice(0, 10)
}

async function createAccountingTenant(name: string, ownerId: string): Promise<string> {
  const service = getServiceClient()
  const { data, error } = await service
    .from('tenants')
    .insert({ name, slug: uniqueSlug('acc-suc'), feature_flags: { accounting: true } })
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
        legal_name: 'Bar con dos locales SAS',
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

type Box = { id: string; accountId: string }

describeIfRls('Administración por sucursal', () => {
  let owner: UserCtx
  let ownerB: UserCtx
  let tenant: string
  let tenantB: string
  let mainBranch: string
  let cerro: string
  let expenseAccount: string
  let cash: Box
  let bank: Box

  beforeAll(async () => {
    owner = await createUserClient({ email: uniqueEmail('sucOwn') })
    ownerB = await createUserClient({ email: uniqueEmail('sucOwnB') })
    tenant = await createAccountingTenant('Bar con dos locales', owner.userId)
    tenantB = await createAccountingTenant('Otro bar', ownerB.userId)
    await bootstrap(owner.client, tenant, '30718765435')
    await bootstrap(ownerB.client, tenantB, '30712345671')

    const service = getServiceClient()
    const main = await service
      .from('branches')
      .select('id')
      .eq('tenant_id', tenant)
      .eq('is_default', true)
      .single()
    if (main.error || !main.data) throw new Error(`main branch failed: ${main.error?.message}`)
    mainBranch = (main.data as { id: string }).id
    const second = await service
      .from('branches')
      .insert({ tenant_id: tenant, name: 'Cerro', slug: 'cerro', color: '#a8452d', position: 1 })
      .select('id')
      .single()
    if (second.error || !second.data)
      throw new Error(`second branch failed: ${second.error?.message}`)
    cerro = (second.data as { id: string }).id

    const account = await service
      .from('acc_accounts')
      .select('id')
      .eq('tenant_id', tenant)
      .eq('type', 'expense')
      .eq('postable', true)
      .eq('active', true)
      .eq('requires_party', false)
      .eq('purchase_selectable', true)
      .is('system_key', null)
      .limit(1)
      .single()
    if (account.error || !account.data)
      throw new Error(`expense account failed: ${account.error?.message}`)
    expenseAccount = (account.data as { id: string }).id

    const boxes = await service
      .from('acc_treasury_accounts')
      .select('id, account_id, kind')
      .eq('tenant_id', tenant)
    if (boxes.error || !boxes.data) throw new Error(`treasuries failed: ${boxes.error?.message}`)
    const rows = boxes.data as { id: string; account_id: string; kind: string }[]
    const byKind = (kind: string): Box => {
      const row = rows.find((r) => r.kind === kind)
      if (!row) throw new Error(`no hay caja ${kind}`)
      return { id: row.id, accountId: row.account_id }
    }
    cash = byKind('cash')
    bank = byKind('bank')
  })

  afterAll(async () => {
    const service = getServiceClient()
    for (const id of [tenant, tenantB]) {
      if (id) await service.from('tenants').delete().eq('id', id)
    }
    for (const user of [owner, ownerB]) {
      if (user) await deleteUser(user.userId)
    }
  })

  /** Un gasto chico pagado desde `box`. Sin `branchId` decide la base. */
  function expenseBundle(box: Box, extra: Record<string, unknown> = {}) {
    return {
      preview_hash: 'a'.repeat(64),
      allocations: [],
      new_parties: [],
      documents: [
        {
          ref: 'd1',
          kind: 'expense',
          entry_kind: 'standard',
          voucher_type: 'sin_comprobante',
          issue_date: today(),
          accounting_date: today(),
          description: 'Gasto de prueba',
          total_cents: 1000,
          // El banco de un bar recién armado está en cero (el gasto lo deja en rojo) y la prueba carga varios gastos
          // iguales el mismo día: los dos avisos se aceptan.
          warnings_ack: ['treasury_negative', 'possible_duplicate'],
          fiscal_vouchers: [],
          lines: [
            {
              line_no: 1,
              role: 'gross',
              side: 'debit',
              account_id: expenseAccount,
              amount_cents: 1000,
            },
            {
              line_no: 2,
              role: 'treasury',
              side: 'credit',
              account_id: box.accountId,
              amount_cents: 1000,
              treasury_account_id: box.id,
            },
          ],
          ...extra,
        },
      ],
    }
  }

  async function post(bundle: unknown) {
    return owner.client.rpc('acc_post_bundle', {
      p_tenant_id: tenant,
      p_client_ref: randomUUID(),
      p_bundle: bundle,
    })
  }

  async function lastDocument(): Promise<{ id: string; branch_id: string | null }> {
    const { data, error } = await getServiceClient()
      .from('acc_documents')
      .select('id, branch_id')
      .eq('tenant_id', tenant)
      .order('seq', { ascending: false })
      .limit(1)
      .single()
    if (error || !data) throw new Error(`last document failed: ${error?.message}`)
    return data as { id: string; branch_id: string | null }
  }

  it('la caja en efectivo se asigna a una sucursal y el banco sigue siendo de todo el bar', async () => {
    const { data: row } = await getServiceClient()
      .from('acc_treasury_accounts')
      .select('updated_at')
      .eq('id', cash.id)
      .single()
    const saved = await owner.client.rpc('acc_save_treasury_account', {
      p_tenant_id: tenant,
      p_treasury: { id: cash.id, branch_id: mainBranch },
      p_expected_updated_at: (row as { updated_at: string }).updated_at,
    })
    expect(saved.error).toBeNull()
    expect((saved.data as { branch_id: string | null }).branch_id).toBe(mainBranch)
    const balances = await owner.client.rpc('acc_report_treasury_balances', {
      p_tenant_id: tenant,
      p_as_of: today(),
      p_branch_id: cerro,
    })
    expect(balances.error).toBeNull()
    const ids = (balances.data as { treasury_id: string }[]).map((r) => r.treasury_id)
    expect(ids).toContain(bank.id)
    expect(ids).not.toContain(cash.id)
  })

  it('un gasto del Cerro pagado con el banco queda en el Cerro', async () => {
    const res = await post(expenseBundle(bank, { branch_id: cerro }))
    expect(res.error).toBeNull()
    expect((await lastDocument()).branch_id).toBe(cerro)
  })

  it('la caja de otra sucursal no se mueve desde el Cerro', async () => {
    const res = await post(expenseBundle(cash, { branch_id: cerro }))
    expect(res.error?.message).toBe('treasury_other_branch')
  })

  it('sin sucursal, el comprobante va a la principal', async () => {
    const res = await post(expenseBundle(cash))
    expect(res.error).toBeNull()
    expect((await lastDocument()).branch_id).toBe(mainBranch)
  })

  it('el gasto fijo: mismo nombre en cada sucursal y su pago queda en la suya', async () => {
    const make = (branchId: string) =>
      owner.client.rpc('acc_save_recurring_expense', {
        p_tenant_id: tenant,
        p_expense: {
          name: 'Alquiler',
          account_id: expenseAccount,
          due_day: 10,
          next_due_date: nextMonthDay(10),
          branch_id: branchId,
        },
        p_expected_updated_at: null,
      })
    const inCerro = await make(cerro)
    expect(inCerro.error).toBeNull()
    const inMain = await make(mainBranch)
    expect(inMain.error).toBeNull()
    const again = await make(cerro)
    expect(again.error?.message).toBe('recurring_name_taken')

    const recurringId = (inCerro.data as { id: string }).id
    const paid = await post(expenseBundle(bank, { recurring_expense_id: recurringId }))
    expect(paid.error).toBeNull()
    expect((await lastDocument()).branch_id).toBe(cerro)

    const wrong = await post(
      expenseBundle(bank, { recurring_expense_id: recurringId, branch_id: mainBranch }),
    )
    expect(wrong.error?.message).toBe('recurring_branch_mismatch')

    const statusCerro = await owner.client.rpc('acc_report_recurring_status', {
      p_tenant_id: tenant,
      p_branch_id: cerro,
    })
    const statusMain = await owner.client.rpc('acc_report_recurring_status', {
      p_tenant_id: tenant,
      p_branch_id: mainBranch,
    })
    const idsOf = (data: unknown) =>
      (data as { recurring_expense_id: string }[]).map((r) => r.recurring_expense_id)
    expect(idsOf(statusCerro.data)).toContain(recurringId)
    expect(idsOf(statusMain.data)).not.toContain(recurringId)
  })

  it('«Cambiar de sucursal» mueve el comprobante y lo hace solo un dueño del bar', async () => {
    const res = await post(expenseBundle(bank, { branch_id: cerro }))
    expect(res.error).toBeNull()
    const doc = await lastDocument()
    const moved = await owner.client.rpc('acc_set_document_branch', {
      p_tenant_id: tenant,
      p_document_id: doc.id,
      p_branch_id: mainBranch,
      p_reason: 'era de la principal',
    })
    expect(moved.error).toBeNull()
    expect((await lastDocument()).branch_id).toBe(mainBranch)

    const outsider = await ownerB.client.rpc('acc_set_document_branch', {
      p_tenant_id: tenant,
      p_document_id: doc.id,
      p_branch_id: cerro,
    })
    expect(outsider.error).not.toBeNull()
    expect((await lastDocument()).branch_id).toBe(mainBranch)
  })
})
