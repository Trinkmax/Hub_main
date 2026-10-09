import { randomUUID } from 'node:crypto'
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
 * Administración · importadores y Mercado Pago (migraciones 20261008120200…120330):
 * idempotencia por archivo (SHA-256) y por fila (clave natural), propuestas con client_ref
 * fijo, aislamiento entre bares, contadora de solo lectura, RPC de servicio solo para
 * service_role y el token de Mercado Pago cifrado con la clave que manda el servidor.
 * Corre contra el Supabase local del job `rls` (sin red hacia Mercado Pago ni ARCA).
 */

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

/** Claves de prueba (no son la del servidor): las RPC las reciben como argumento. */
const SECRET = 'clave-de-prueba-rls-0123456789'
const OTHER_SECRET = 'otra-clave-de-prueba-rls-98765'
const MP_TOKEN = 'APP_USR-fake-token-for-rls-tests-0000006789'
const FILE_NAME = 'mis-comprobantes-recibidos-prueba.zip'
const KEY_1 = 'mc:R:30860913905:1:3:1001'
const KEY_2 = 'mc:R:30860913905:1:3:1002'

type UserCtx = Awaited<ReturnType<typeof createUserClient>>
type Row = Record<string, unknown>

/** Hoy en Córdoba (UTC−3, sin horario de verano), `yyyy-mm-dd`. */
function cordobaToday(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** Primer día del mes anterior en Córdoba: arranque de libros válido para acc_bootstrap. */
function booksStart(): string {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 10)
}

/** SHA-256 de mentira pero con forma válida, distinto en cada corrida. */
function fakeSha(): string {
  return randomUUID().replaceAll('-', '').repeat(2)
}

/** Un bar con Administración habilitada. El flag va en el INSERT: el UPDATE lo bloquea el guard. */
async function createAccountingTenant(name: string, ownerId: string): Promise<string> {
  const service = getServiceClient()
  const { data, error } = await service
    .from('tenants')
    .insert({ name, slug: uniqueSlug('acc-imp'), feature_flags: { accounting: true } })
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
        { key: 'wallet_main', name: 'Mercado Pago SAS', kind: 'wallet' },
        { key: 'bank_main', name: 'Banco', kind: 'bank' },
      ],
      sales: {
        transfer_destination: 'wallet_main',
        enabled_methods: ['cash', 'transfer', 'qr_mp', 'debit', 'credit'],
        sales_points: [{ number: 5 }],
      },
    },
  })
  if (error) throw new Error(`acc_bootstrap failed: ${error.message}`)
}

function expectKey(error: PostgrestError | null, key: string): void {
  expect(error, key).not.toBeNull()
  expect(error?.message ?? '', key).toContain(key)
}

function expectForbidden(error: PostgrestError | null): void {
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')
}

describeIfRls('Administración · importadores y Mercado Pago (acc_import_*, acc_mp_*)', () => {
  let ownerA: UserCtx
  let accountant: UserCtx
  let ownerB: UserCtx
  let tenantA: string
  let tenantB: string
  let sha: string
  let batchId: string
  let itemIds: string[] = []

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('impOwnA') })
    accountant = await createUserClient({ email: uniqueEmail('impCont') })
    ownerB = await createUserClient({ email: uniqueEmail('impOwnB') })
    tenantA = await createAccountingTenant('Bar A (importadores)', ownerA.userId)
    tenantB = await createAccountingTenant('Bar B (importadores)', ownerB.userId)
    const { error } = await getServiceClient()
      .from('memberships')
      .insert({ tenant_id: tenantA, user_id: accountant.userId, role: 'accountant' })
    if (error) throw new Error(`accountant membership failed: ${error.message}`)
    await bootstrap(ownerA.client, tenantA, '30718765435')
    await bootstrap(ownerB.client, tenantB, '30712345671')
    sha = fakeSha()
  })

  afterAll(async () => {
    const service = getServiceClient()
    for (const id of [tenantA, tenantB]) {
      if (id) await service.from('tenants').delete().eq('id', id)
    }
    for (const user of [ownerA, accountant, ownerB]) {
      if (user) await deleteUser(user.userId)
    }
  })

  const batchPayload = (fileSha: string) => ({
    source: 'arca_recibidos',
    file_name: FILE_NAME,
    file_sha256: fileSha,
    file_size: 2048,
    detected_format: 'mc_g3',
    period_from: booksStart(),
    period_to: cordobaToday(),
    meta: { generation: 'g3' },
  })

  const items = [
    { row_no: 1, natural_key: KEY_1, data: { total_cents: 121_000 } },
    { row_no: 2, natural_key: KEY_2, data: { total_cents: 60_500 } },
    { row_no: 3, natural_key: KEY_1, data: { total_cents: 121_000 } },
  ]

  it('un lote por archivo: el mismo archivo no entra dos veces y el error dice cuál es', async () => {
    const { data, error } = await ownerA.client.rpc('acc_import_create_batch', {
      p_tenant_id: tenantA,
      p_batch: batchPayload(sha),
    })
    expect(error).toBeNull()
    const batch = data as Row
    expect(batch.status).toBe('staging')
    expect(batch.origin).toBe('upload')
    batchId = batch.id as string

    const again = await ownerA.client.rpc('acc_import_create_batch', {
      p_tenant_id: tenantA,
      p_batch: batchPayload(sha),
    })
    expectKey(again.error, 'import_file_already')
    const detail = JSON.parse(again.error?.details ?? '{}') as Row
    expect(detail.batch_id).toBe(batchId)
    expect(typeof detail.name).toBe('string')
    expect(detail.date).toBe(cordobaToday())
  })

  it('las filas repetidas quedan duplicate y reintentar la misma tanda no duplica', async () => {
    const first = await ownerA.client.rpc('acc_import_add_items', {
      p_tenant_id: tenantA,
      p_batch_id: batchId,
      p_items: items,
    })
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({ new: 2, duplicate: 1, skipped: 0 })

    const retry = await ownerA.client.rpc('acc_import_add_items', {
      p_tenant_id: tenantA,
      p_batch_id: batchId,
      p_items: items,
    })
    expect(retry.error).toBeNull()
    expect(retry.data).toMatchObject({ new: 0, duplicate: 0, skipped: 3 })

    const { data } = await ownerA.client
      .from('acc_import_items')
      .select('id, row_no, status, duplicate_of')
      .eq('batch_id', batchId)
      .order('row_no')
    const rows = (data ?? []) as Row[]
    expect(rows.map((r) => r.status)).toEqual(['new', 'new', 'duplicate'])
    expect(rows[2]?.duplicate_of).toBe(rows[0]?.id)
    itemIds = rows.map((r) => r.id as string)
  })

  it('propuestas: upsert por clave con client_ref fijo; las filas pasan a new o review', async () => {
    const ref1 = randomUUID()
    const proposals = [
      {
        key: KEY_1,
        form: 'purchase',
        form_values: { voucherType: 'factura_a' },
        summary: { label: 'FA 0003-00001001' },
        client_ref: ref1,
        status: 'ready',
        preview_hash: 'f'.repeat(64),
        item_ids: [itemIds[0]],
      },
      {
        key: KEY_2,
        form: 'purchase',
        form_values: {},
        summary: { label: 'FA 0003-00001002' },
        client_ref: randomUUID(),
        status: 'needs_input',
        item_ids: [itemIds[1]],
      },
    ]
    const put = await ownerA.client.rpc('acc_import_put_proposals', {
      p_tenant_id: tenantA,
      p_batch_id: batchId,
      p_proposals: proposals,
    })
    expect(put.error).toBeNull()
    expect(put.data).toMatchObject({ inserted: 2, updated: 0 })

    const readyWithoutHash = await ownerA.client.rpc('acc_import_put_proposals', {
      p_tenant_id: tenantA,
      p_batch_id: batchId,
      p_proposals: [{ ...proposals[1], status: 'ready' }],
    })
    expectKey(readyWithoutHash.error, 'invalid_payload')

    const update = await ownerA.client.rpc('acc_import_put_proposals', {
      p_tenant_id: tenantA,
      p_batch_id: batchId,
      p_proposals: [{ ...proposals[0], client_ref: randomUUID(), preview_hash: 'a'.repeat(64) }],
    })
    expect(update.error).toBeNull()
    expect(update.data).toMatchObject({ inserted: 0, updated: 1 })

    const { data: stored } = await ownerA.client
      .from('acc_import_proposals')
      .select('key, client_ref, status')
      .eq('batch_id', batchId)
      .eq('key', KEY_1)
      .single()
    expect((stored as Row).client_ref).toBe(ref1)

    const { data: rows } = await ownerA.client
      .from('acc_import_items')
      .select('status')
      .eq('batch_id', batchId)
      .order('row_no')
    expect(((rows ?? []) as Row[]).map((r) => r.status)).toEqual(['new', 'review', 'duplicate'])
    const { data: batch } = await ownerA.client
      .from('acc_import_batches')
      .select('status')
      .eq('id', batchId)
      .single()
    expect((batch as Row).status).toBe('review')
  })

  it('«no es nuestro» se marca y se deshace; marcar contabilizado exige el comprobante del client_ref', async () => {
    const setItems = (kind: string) =>
      ownerA.client.rpc('acc_import_set_items', {
        p_tenant_id: tenantA,
        p_batch_id: batchId,
        p_changes: [{ kind, item_ids: [itemIds[1]], reason: 'No es nuestro' }],
      })
    const ignored = await setItems('ignore')
    expect(ignored.error).toBeNull()
    expect((ignored.data as Row).changed).toBe(1)
    const unignored = await setItems('unignore')
    expect(unignored.error).toBeNull()
    expect((unignored.data as Row).changed).toBe(1)

    const mismatch = await ownerA.client.rpc('acc_import_mark_posted', {
      p_tenant_id: tenantA,
      p_batch_id: batchId,
      p_key: KEY_1,
      p_document_id: randomUUID(),
    })
    expectKey(mismatch.error, 'import_document_mismatch')
  })

  it('la contadora lee lotes, filas y propuestas pero no escribe', async () => {
    for (const table of ['acc_import_batches', 'acc_import_items', 'acc_import_proposals']) {
      const { data, error } = await accountant.client
        .from(table)
        .select('id')
        .eq('tenant_id', tenantA)
      expect(error, table).toBeNull()
      expect((data ?? []).length, table).toBeGreaterThan(0)
    }
    expectForbidden(
      (
        await accountant.client.rpc('acc_import_create_batch', {
          p_tenant_id: tenantA,
          p_batch: batchPayload(fakeSha()),
        })
      ).error,
    )
    expectForbidden(
      (
        await accountant.client.rpc('acc_import_add_items', {
          p_tenant_id: tenantA,
          p_batch_id: batchId,
          p_items: items,
        })
      ).error,
    )
    expectForbidden(
      (
        await accountant.client.rpc('acc_import_cancel_batch', {
          p_tenant_id: tenantA,
          p_batch_id: batchId,
          p_reason: null,
        })
      ).error,
    )
    const direct = await accountant.client
      .from('acc_import_batches')
      .update({ status: 'done' })
      .eq('id', batchId)
      .select('id')
    expect(direct.error !== null || (direct.data ?? []).length === 0).toBe(true)
  })

  it('otro bar no ve ni toca los lotes, las reglas ni Mercado Pago', async () => {
    for (const table of [
      'acc_import_batches',
      'acc_import_items',
      'acc_import_proposals',
      'acc_import_rules',
      'acc_import_layouts',
      'acc_mp_connections',
    ]) {
      const { data, error } = await ownerB.client
        .from(table)
        .select('tenant_id')
        .eq('tenant_id', tenantA)
      expect(error, table).toBeNull()
      expect(data ?? [], table).toEqual([])
    }
    expectForbidden(
      (
        await ownerB.client.rpc('acc_import_create_batch', {
          p_tenant_id: tenantA,
          p_batch: batchPayload(fakeSha()),
        })
      ).error,
    )
    expectForbidden(
      (
        await ownerB.client.rpc('acc_import_match_purchases', {
          p_tenant_id: tenantA,
          p_rows: [],
        })
      ).error,
    )
  })

  it('anon no lee las tablas ni ejecuta las RPC', async () => {
    const anon = getAnonClient()
    for (const table of [
      'acc_import_batches',
      'acc_import_items',
      'acc_import_proposals',
      'acc_import_rules',
      'acc_import_layouts',
      'acc_mp_connections',
    ]) {
      const { data, error } = await anon.from(table).select('*').limit(1)
      expect(error !== null || (data ?? []).length === 0, table).toBe(true)
    }
    const rpc = await anon.rpc('acc_import_create_batch', {
      p_tenant_id: tenantA,
      p_batch: batchPayload(fakeSha()),
    })
    expect(rpc.error).not.toBeNull()
  })

  it('cancelar el lote libera las claves y el mismo archivo se puede volver a importar', async () => {
    const cancel = await ownerA.client.rpc('acc_import_cancel_batch', {
      p_tenant_id: tenantA,
      p_batch_id: batchId,
      p_reason: 'Archivo equivocado',
    })
    expect(cancel.error).toBeNull()
    const { data: rows } = await ownerA.client
      .from('acc_import_items')
      .select('status')
      .eq('batch_id', batchId)
      .order('row_no')
    expect(((rows ?? []) as Row[]).map((r) => r.status)).toEqual([
      'cancelled',
      'cancelled',
      'duplicate',
    ])

    const closed = await ownerA.client.rpc('acc_import_add_items', {
      p_tenant_id: tenantA,
      p_batch_id: batchId,
      p_items: items,
    })
    expectKey(closed.error, 'import_batch_closed')

    const again = await ownerA.client.rpc('acc_import_create_batch', {
      p_tenant_id: tenantA,
      p_batch: batchPayload(sha),
    })
    expect(again.error).toBeNull()
    const added = await ownerA.client.rpc('acc_import_add_items', {
      p_tenant_id: tenantA,
      p_batch_id: (again.data as Row).id,
      p_items: items.slice(0, 1),
    })
    expect(added.error).toBeNull()
    expect(added.data).toMatchObject({ new: 1, duplicate: 0 })
  })

  it('las RPC de la sincronización automática solo las ejecuta service_role', async () => {
    const batch = { source: 'mp_release', period_from: booksStart(), period_to: cordobaToday() }
    expectForbidden(
      (
        await ownerA.client.rpc('acc_import_create_batch_service', {
          p_tenant_id: tenantA,
          p_batch: batch,
        })
      ).error,
    )
    const service = getServiceClient()
    const { data, error } = await service.rpc('acc_import_create_batch_service', {
      p_tenant_id: tenantA,
      p_batch: batch,
    })
    expect(error).toBeNull()
    const apiBatch = data as Row
    expect(apiBatch.origin).toBe('api')
    expect(apiBatch.created_by).toBeNull()

    const added = await service.rpc('acc_import_add_items_service', {
      p_tenant_id: tenantA,
      p_batch_id: apiBatch.id,
      p_items: [{ row_no: 1, natural_key: `mp:${cordobaToday()}:collection:qr`, data: {} }],
    })
    expect(added.error).toBeNull()
    expect(added.data).toMatchObject({ new: 1 })

    const uploadBatch = await service.rpc('acc_import_add_items_service', {
      p_tenant_id: tenantA,
      p_batch_id: batchId,
      p_items: items,
    })
    expectKey(uploadBatch.error, 'import_batch_closed')
  })

  it('reglas y formatos de extracto: alta, edición con concurrencia y borrado; la contadora no escribe', async () => {
    const rule = {
      source: 'bank_statement',
      label: 'Comisiones del banco',
      priority: 10,
      match: { direction: 'debit', pattern: '^COMISION', amount_min: 0, amount_max: 100_000 },
      action: { kind: 'bank_expense', component: 'commission' },
    }
    const created = await ownerA.client.rpc('acc_import_save_rule', {
      p_tenant_id: tenantA,
      p_rule: rule,
      p_expected_updated_at: null,
    })
    expect(created.error).toBeNull()
    const saved = created.data as Row

    const badRegex = await ownerA.client.rpc('acc_import_save_rule', {
      p_tenant_id: tenantA,
      p_rule: { ...rule, match: { ...rule.match, pattern: '(abc' } },
      p_expected_updated_at: null,
    })
    expectKey(badRegex.error, 'invalid_payload')

    const stale = await ownerA.client.rpc('acc_import_save_rule', {
      p_tenant_id: tenantA,
      p_rule: { id: saved.id, label: 'Gastos bancarios' },
      p_expected_updated_at: null,
    })
    expectKey(stale.error, 'stale')

    const edited = await ownerA.client.rpc('acc_import_save_rule', {
      p_tenant_id: tenantA,
      p_rule: { id: saved.id, label: 'Gastos bancarios', active: false },
      p_expected_updated_at: saved.updated_at,
    })
    expect(edited.error).toBeNull()
    expect((edited.data as Row).label).toBe('Gastos bancarios')

    expectForbidden(
      (
        await accountant.client.rpc('acc_import_save_rule', {
          p_tenant_id: tenantA,
          p_rule: rule,
          p_expected_updated_at: null,
        })
      ).error,
    )
    for (let i = 0; i < 2; i++) {
      const removed = await ownerA.client.rpc('acc_import_delete_rule', {
        p_tenant_id: tenantA,
        p_rule_id: saved.id,
      })
      expect(removed.error).toBeNull()
    }

    const { data: bank } = await ownerA.client
      .from('acc_treasury_accounts')
      .select('id')
      .eq('tenant_id', tenantA)
      .eq('kind', 'bank')
      .limit(1)
      .single()
    const layout = (mapping: Row) =>
      ownerA.client.rpc('acc_import_save_layout', {
        p_tenant_id: tenantA,
        p_layout: { signature: '1'.repeat(64), mapping, treasury_account_id: (bank as Row).id },
      })
    const first = await layout({ date: 0 })
    const second = await layout({ date: 1, description: 2 })
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect((second.data as Row).id).toBe((first.data as Row).id)
    expect(((second.data as Row).mapping as Row).date).toBe(1)
    expectForbidden(
      (
        await accountant.client.rpc('acc_import_save_layout', {
          p_tenant_id: tenantA,
          p_layout: { signature: '2'.repeat(64), mapping: {} },
        })
      ).error,
    )
  })

  it('coincidencias de compras y guía «Cómo arrancar»: dueño y contadora sí, otro bar no', async () => {
    const rows = [
      {
        key: 'k1',
        party_id: randomUUID(),
        voucher_type: 'factura_a',
        point_of_sale: 3,
        number: 1001,
        total_cents: 121_000,
        issue_date: cordobaToday(),
      },
    ]
    for (const client of [ownerA.client, accountant.client]) {
      const match = await client.rpc('acc_import_match_purchases', {
        p_tenant_id: tenantA,
        p_rows: rows,
      })
      expect(match.error).toBeNull()
      expect(match.data).toEqual([])
      const onboarding = await client.rpc('acc_report_onboarding', { p_tenant_id: tenantA })
      expect(onboarding.error).toBeNull()
      expect(onboarding.data).toHaveProperty('imports')
      expect(onboarding.data).toHaveProperty('arca')
    }
    expectForbidden(
      (await ownerB.client.rpc('acc_report_onboarding', { p_tenant_id: tenantA })).error,
    )
  })

  it('Mercado Pago: el token queda cifrado y solo sale con la clave del servidor', async () => {
    const created = await ownerA.client.rpc('acc_mp_save_connection', {
      p_tenant_id: tenantA,
      p_patch: {},
      p_expected_updated_at: null,
    })
    expect(created.error).toBeNull()
    expect((created.data as Row).status).toBe('csv_only')

    const stored = await ownerA.client.rpc('acc_mp_store_token', {
      p_tenant_id: tenantA,
      p_token: MP_TOKEN,
      p_meta: { mp_user_id: 123_456_789, site_id: 'MLA', scopes: ['read', 'offline_access'] },
      p_secret_key: SECRET,
    })
    expect(stored.error).toBeNull()
    expect((stored.data as Row).status).toBe('connected')
    expect((stored.data as Row).token_last4).toBe('6789')

    const conn = await accountant.client
      .from('acc_mp_connections')
      .select('*')
      .eq('tenant_id', tenantA)
      .single()
    expect(conn.error).toBeNull()
    expect(JSON.stringify(conn.data)).not.toContain(MP_TOKEN)
    expectForbidden((await ownerA.client.from('acc_secrets').select('*').limit(1)).error)

    const token = await ownerA.client.rpc('acc_mp_get_token', {
      p_tenant_id: tenantA,
      p_secret_key: SECRET,
    })
    expect(token.error).toBeNull()
    expect(token.data).toBe(MP_TOKEN)
    expectKey(
      (
        await ownerA.client.rpc('acc_mp_get_token', {
          p_tenant_id: tenantA,
          p_secret_key: OTHER_SECRET,
        })
      ).error,
      'secret_unreadable',
    )
    expectForbidden(
      (
        await accountant.client.rpc('acc_mp_get_token', {
          p_tenant_id: tenantA,
          p_secret_key: SECRET,
        })
      ).error,
    )
    expectForbidden(
      (
        await ownerB.client.rpc('acc_mp_get_token', {
          p_tenant_id: tenantA,
          p_secret_key: SECRET,
        })
      ).error,
    )
  })

  it('Mercado Pago: el cron (service_role) trae los bares conectados y registra el resultado', async () => {
    expect(
      (await ownerA.client.rpc('acc_mp_sync_targets_service', { p_secret_key: SECRET })).error,
    ).not.toBeNull()

    const service = getServiceClient()
    const targets = await service.rpc('acc_mp_sync_targets_service', { p_secret_key: SECRET })
    expect(targets.error).toBeNull()
    const mine = ((targets.data ?? []) as Row[]).filter((t) => t.tenant_id === tenantA)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.access_token).toBe(MP_TOKEN)

    const recorded = await service.rpc('acc_mp_sync_record_service', {
      p_tenant_id: tenantA,
      p_patch: {
        status: 'reconnect',
        last_error_key: 'mp_unauthorized',
        last_sync_status: 'error',
        last_sync_at: new Date().toISOString(),
        synced_through: cordobaToday(),
      },
    })
    expect(recorded.error).toBeNull()
    expectKey(
      (await ownerA.client.rpc('acc_mp_get_token', { p_tenant_id: tenantA, p_secret_key: SECRET }))
        .error,
      'mp_not_connected',
    )
  })

  it('Mercado Pago: desconectar borra el token y es idempotente', async () => {
    for (let i = 0; i < 2; i++) {
      const { error } = await ownerA.client.rpc('acc_mp_disconnect', { p_tenant_id: tenantA })
      expect(error).toBeNull()
    }
    const { data } = await ownerA.client
      .from('acc_mp_connections')
      .select('status, token_last4')
      .eq('tenant_id', tenantA)
      .single()
    expect(data).toMatchObject({ status: 'disconnected', token_last4: null })
  })

  it('la auditoría registra lotes, reglas y Mercado Pago sin nombres de archivo ni tokens', async () => {
    const expected = [
      'acc_import.batch_created',
      'acc_import.batch_cancelled',
      'acc_import.rule_saved',
      'acc_import.rule_deleted',
      'acc_mp.connection_saved',
      'acc_mp.connected',
      'acc_mp.status_changed',
      'acc_mp.disconnected',
    ]
    const { data, error } = await getServiceClient()
      .from('audit_log')
      .select('action, payload')
      .eq('tenant_id', tenantA)
      .in('action', expected)
    expect(error).toBeNull()
    const actions = new Set(((data ?? []) as Row[]).map((r) => r.action))
    for (const action of expected) expect(actions.has(action), action).toBe(true)
    const text = JSON.stringify(data)
    expect(text).not.toContain(MP_TOKEN)
    expect(text).not.toContain(FILE_NAME)
    expect(text).not.toContain(SECRET)
  })
})
