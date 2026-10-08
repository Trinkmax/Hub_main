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
 * Administración · ARCA (migraciones 20261008120000…120120): aislamiento entre bares,
 * contadora de solo lectura, secretos cerrados (ni dueño, ni contadora, ni service_role leen
 * acc_secrets / acc_arca_tickets), cifrado con la clave que manda el servidor, lease del
 * ticket del WSAA y una sola emisión viva por punto de venta y tipo.
 * Corre contra el Supabase local del job `rls` (sin red hacia ARCA: todo lo que
 * «contesta ARCA» se simula con los datos que el código guardaría).
 */

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

/** Claves de prueba (no son la del servidor): las RPC las reciben como argumento. */
const SECRET = 'clave-de-prueba-rls-0123456789'
const OTHER_SECRET = 'otra-clave-de-prueba-rls-98765'
const SAS_CUIT = '30718765435'
const OTHER_SAS_CUIT = '30712345671'
const PERSON_CUIT = '20123456786'
const PROD = 'produccion'
const HOMO = 'homologacion'
const POS = 5

const PRIVATE_KEY_PEM =
  '-----BEGIN PRIVATE KEY-----\nMIIEclaveDePrueba\n-----END PRIVATE KEY-----\n'
const CSR_PEM =
  '-----BEGIN CERTIFICATE REQUEST-----\nMIICpedidoDePrueba\n-----END CERTIFICATE REQUEST-----\n'
const CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIDcertificadoDePrueba\n-----END CERTIFICATE-----\n'
const KEY_HASH = 'a'.repeat(64)

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

/** Un bar con Administración habilitada. El flag va en el INSERT: el UPDATE lo bloquea el guard. */
async function createAccountingTenant(name: string, ownerId: string): Promise<string> {
  const service = getServiceClient()
  const { data, error } = await service
    .from('tenants')
    .insert({ name, slug: uniqueSlug('acc-arca'), feature_flags: { accounting: true } })
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
        sales_points: [{ number: POS }],
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

describeIfRls('Administración · ARCA (acc_arca_*)', () => {
  let ownerA: UserCtx
  let accountant: UserCtx
  let ownerB: UserCtx
  let tenantA: string
  let tenantB: string
  let voucherId: string

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('arcaOwnA') })
    accountant = await createUserClient({ email: uniqueEmail('arcaCont') })
    ownerB = await createUserClient({ email: uniqueEmail('arcaOwnB') })
    tenantA = await createAccountingTenant('Bar A (ARCA)', ownerA.userId)
    tenantB = await createAccountingTenant('Bar B (ARCA)', ownerB.userId)
    // La contadora la suma el servicio (la guardia de membresías deja pasar sin auth.uid()).
    const { error } = await getServiceClient()
      .from('memberships')
      .insert({ tenant_id: tenantA, user_id: accountant.userId, role: 'accountant' })
    if (error) throw new Error(`accountant membership failed: ${error.message}`)
    await bootstrap(ownerA.client, tenantA, SAS_CUIT)
    await bootstrap(ownerB.client, tenantB, OTHER_SAS_CUIT)
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

  async function connection(env: string): Promise<Row> {
    const { data, error } = await ownerA.client
      .from('acc_arca_connections')
      .select('*')
      .eq('tenant_id', tenantA)
      .eq('environment', env)
      .single()
    if (error || !data) throw new Error(`connection ${env}: ${error?.message}`)
    return data as Row
  }

  it('el dueño crea la conexión de producción con la CUIT de la SAS y edita el punto de venta', async () => {
    const { data, error } = await ownerA.client.rpc('acc_arca_save_connection', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_patch: {},
      p_expected_updated_at: null,
    })
    expect(error).toBeNull()
    const row = data as Row
    expect(row.status).toBe('draft')
    expect(row.represented_cuit).toBe(SAS_CUIT)
    expect(row.cert_cuit).toBe(SAS_CUIT)
    expect(row.alias).toBe('hubplataforma')

    const stale = await ownerA.client.rpc('acc_arca_save_connection', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_patch: { point_of_sale: POS },
      p_expected_updated_at: null,
    })
    expectKey(stale.error, 'stale')

    const saved = await ownerA.client.rpc('acc_arca_save_connection', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_patch: { point_of_sale: POS, allowed_classes: ['B', 'A'] },
      p_expected_updated_at: row.updated_at,
    })
    expect(saved.error).toBeNull()
    expect((saved.data as Row).point_of_sale).toBe(POS)
    expect((saved.data as Row).allowed_classes).toEqual(['A', 'B'])
  })

  it('guarda la clave privada cifrada; acc_secrets y acc_arca_tickets no se leen por la API', async () => {
    const wrongCuit = await ownerA.client.rpc('acc_arca_store_keypair', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_alias: 'hubplataforma',
      p_cert_cuit: PERSON_CUIT,
      p_private_key_pem: PRIVATE_KEY_PEM,
      p_csr_pem: CSR_PEM,
      p_public_key_sha256: KEY_HASH,
      p_secret_key: SECRET,
      p_mode: 'new',
    })
    expectKey(wrongCuit.error, 'arca_cuit_mismatch')

    const { data, error } = await ownerA.client.rpc('acc_arca_store_keypair', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_alias: 'hubplataforma',
      p_cert_cuit: SAS_CUIT,
      p_private_key_pem: PRIVATE_KEY_PEM,
      p_csr_pem: CSR_PEM,
      p_public_key_sha256: KEY_HASH,
      p_secret_key: SECRET,
      p_mode: 'new',
    })
    expect(error).toBeNull()
    expect((data as Row).status).toBe('key_ready')

    for (const table of ['acc_secrets', 'acc_arca_tickets']) {
      expectForbidden((await ownerA.client.from(table).select('*').limit(1)).error)
      expectForbidden((await accountant.client.from(table).select('*').limit(1)).error)
      expectForbidden((await getServiceClient().from(table).select('*').limit(1)).error)
    }
    // La conexión es pública para los lectores, pero no tiene ningún secreto.
    const row = await connection(PROD)
    expect(JSON.stringify(row)).not.toContain('PRIVATE KEY')
    expect(row.csr_pem).toBe(CSR_PEM)
  })

  it('el certificado deja la conexión en cert_ready y las credenciales solo salen con la clave correcta', async () => {
    const notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const notAfter = new Date(Date.now() + 700 * 24 * 60 * 60 * 1000).toISOString()
    const meta = {
      serial_hex: '0a1b2c',
      subject_cuit: SAS_CUIT,
      subject_cn: 'hubplataforma',
      issuer: 'CN=Computadores, O=AFIP, C=AR',
      not_before: notBefore,
      not_after: notAfter,
      public_key_sha256: KEY_HASH,
    }
    const mismatch = await ownerA.client.rpc('acc_arca_save_certificate', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_certificate_pem: CERT_PEM,
      p_meta: { ...meta, public_key_sha256: 'b'.repeat(64) },
      p_expected_updated_at: null,
    })
    expectKey(mismatch.error, 'arca_certificate_key_mismatch')

    const { data, error } = await ownerA.client.rpc('acc_arca_save_certificate', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_certificate_pem: CERT_PEM,
      p_meta: meta,
      p_expected_updated_at: null,
    })
    expect(error).toBeNull()
    expect((data as Row).status).toBe('cert_ready')

    const creds = await ownerA.client.rpc('acc_arca_get_credentials', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_secret_key: SECRET,
    })
    expect(creds.error).toBeNull()
    expect((creds.data as Row).private_key_pem).toBe(PRIVATE_KEY_PEM)
    expect((creds.data as Row).certificate_pem).toBe(CERT_PEM)

    const wrongKey = await ownerA.client.rpc('acc_arca_get_credentials', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_secret_key: OTHER_SECRET,
    })
    expectKey(wrongKey.error, 'secret_unreadable')

    const asAccountant = await accountant.client.rpc('acc_arca_get_credentials', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_secret_key: SECRET,
    })
    expectForbidden(asAccountant.error)
  })

  it('ticket del WSAA: una sola instancia toma el lease, el lease ajeno se rechaza y el TA se reusa', async () => {
    const ticketGet = () =>
      ownerA.client.rpc('acc_arca_ticket_get', {
        p_tenant_id: tenantA,
        p_environment: PROD,
        p_service: 'wsfe',
        p_secret_key: SECRET,
      })
    const first = await ticketGet()
    expect(first.error).toBeNull()
    expect((first.data as Row).status).toBe('lease')
    const leaseId = (first.data as Row).lease_id as string

    const second = await ticketGet()
    expect(second.error).toBeNull()
    expect((second.data as Row).status).toBe('busy')

    const expiration = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    const result = {
      ok: true,
      token: 'PD94bWwgdG9rZW4gZGUgcHJ1ZWJh',
      sign: 'ZmlybWEgZGUgcHJ1ZWJh',
      generation_time: new Date().toISOString(),
      expiration_time: expiration,
    }
    const lost = await ownerA.client.rpc('acc_arca_ticket_put', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_service: 'wsfe',
      p_lease_id: randomUUID(),
      p_result: result,
      p_secret_key: SECRET,
    })
    expectKey(lost.error, 'arca_lease_lost')

    const put = await ownerA.client.rpc('acc_arca_ticket_put', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_service: 'wsfe',
      p_lease_id: leaseId,
      p_result: result,
      p_secret_key: SECRET,
    })
    expect(put.error).toBeNull()

    const valid = await ticketGet()
    expect(valid.error).toBeNull()
    expect((valid.data as Row).status).toBe('valid')
    expect((valid.data as Row).token).toBe(result.token)
    expect((valid.data as Row).sign).toBe(result.sign)
  })

  it('«Probar conexión» deja connected y recién ahí se puede prender la emisión', async () => {
    const early = await ownerA.client.rpc('acc_arca_save_connection', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_patch: { emission_enabled: true },
      p_expected_updated_at: (await connection(PROD)).updated_at,
    })
    expectKey(early.error, 'arca_emission_requires_connection')

    const checks = ['service', 'wsfe_ticket', 'relations', 'point_of_sale', 'padron'].map(
      (key) => ({
        key,
        ok: true,
      }),
    )
    const { data, error } = await ownerA.client.rpc('acc_arca_record_test', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_result: { checks },
    })
    expect(error).toBeNull()
    expect((data as Row).status).toBe('connected')

    const enabled = await ownerA.client.rpc('acc_arca_save_connection', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_patch: { emission_enabled: true },
      p_expected_updated_at: (data as Row).updated_at,
    })
    expect(enabled.error).toBeNull()
    expect((enabled.data as Row).emission_enabled).toBe(true)
  })

  it('emisión: una sola reserva viva por punto de venta y tipo, y transiciones de la saga', async () => {
    const payload = {
      form: { kind: 'sales_invoice', detail: 'Catering' },
      total_cents: 12_100_000,
      issue_date: cordobaToday(),
    }
    const reserve = (client: SupabaseClient, pos = POS) =>
      client.rpc('acc_arca_voucher_reserve', {
        p_tenant_id: tenantA,
        p_environment: PROD,
        p_point_of_sale: pos,
        p_cbte_tipo: 6,
        p_payload: payload,
      })

    const first = await reserve(ownerA.client)
    expect(first.error).toBeNull()
    voucherId = (first.data as Row).voucher_id as string
    expect(typeof (first.data as Row).client_ref).toBe('string')

    expectKey((await reserve(ownerA.client)).error, 'arca_voucher_in_flight')
    expectKey((await reserve(ownerA.client, POS + 1)).error, 'arca_point_of_sale_mismatch')
    expectForbidden((await reserve(accountant.client)).error)

    const update = (to: string, patch: Row) =>
      ownerA.client.rpc('acc_arca_voucher_update', {
        p_tenant_id: tenantA,
        p_voucher_id: voucherId,
        p_to: to,
        p_patch: patch,
      })
    expectKey(
      (await update('authorized', { cae: '76412345678901' })).error,
      'arca_voucher_transition',
    )

    const requesting = await update('requesting', {
      number: 1,
      request: { CbteDesde: 1, ImpTotal: '121000.00' },
      request_sha256: 'c'.repeat(64),
      issue_date: cordobaToday(),
    })
    expect(requesting.error).toBeNull()
    expect((requesting.data as Row).status).toBe('requesting')

    const authorized = await update('authorized', {
      cae: '76412345678901',
      cae_due: cordobaToday(),
      observations: [{ code: 10217, msg: 'Observación de prueba' }],
    })
    expect(authorized.error).toBeNull()
    expect((authorized.data as Row).status).toBe('authorized')
    expect((authorized.data as Row).result).toBe('A')

    // Las filas son inmutables por fuera de las RPC: ni el dueño escribe directo.
    const direct = await ownerA.client
      .from('acc_arca_vouchers')
      .update({ status: 'posted' })
      .eq('id', voucherId)
      .select('id')
    expect(direct.error !== null || (direct.data ?? []).length === 0).toBe(true)
  })

  it('la contadora lee conexiones y emisiones pero no escribe', async () => {
    const conns = await accountant.client.from('acc_arca_connections').select('id, status')
    expect(conns.error).toBeNull()
    expect(conns.data?.length).toBeGreaterThan(0)
    const vouchers = await accountant.client
      .from('acc_arca_vouchers')
      .select('id')
      .eq('id', voucherId)
    expect(vouchers.data?.length).toBe(1)

    expectForbidden(
      (
        await accountant.client.rpc('acc_arca_save_connection', {
          p_tenant_id: tenantA,
          p_environment: HOMO,
          p_patch: {},
          p_expected_updated_at: null,
        })
      ).error,
    )
    expectForbidden(
      (
        await accountant.client.rpc('acc_guide_mark', {
          p_tenant_id: tenantA,
          p_guide: 'arca',
          p_step: 's5_csr',
          p_done: true,
        })
      ).error,
    )
    const insert = await accountant.client.from('acc_arca_connections').insert({
      tenant_id: tenantA,
      environment: HOMO,
      represented_cuit: SAS_CUIT,
      cert_cuit: PERSON_CUIT,
      alias: 'hubpruebas',
    })
    expectForbidden(insert.error)
  })

  it('otro bar no ve ni toca la conexión, las emisiones ni la caché del padrón', async () => {
    const put = await ownerA.client.rpc('acc_arca_padron_cache_put', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_rows: [
        { cuit: OTHER_SAS_CUIT, found: true, data: { iva_condition: 'responsable_inscripto' } },
        { cuit: PERSON_CUIT, found: false, data: {} },
      ],
    })
    expect(put.error).toBeNull()
    expect(put.data).toBe(2)
    const asAccountant = await accountant.client
      .from('acc_arca_padron_cache')
      .select('cuit')
      .eq('tenant_id', tenantA)
    expect(asAccountant.data?.length).toBe(2)

    for (const table of ['acc_arca_connections', 'acc_arca_vouchers', 'acc_arca_padron_cache']) {
      const { data, error } = await ownerB.client
        .from(table)
        .select('tenant_id')
        .eq('tenant_id', tenantA)
      expect(error, table).toBeNull()
      expect(data ?? [], table).toEqual([])
    }
    expectForbidden(
      (
        await ownerB.client.rpc('acc_arca_get_credentials', {
          p_tenant_id: tenantA,
          p_environment: PROD,
          p_secret_key: SECRET,
        })
      ).error,
    )
    expectForbidden(
      (
        await ownerB.client.rpc('acc_arca_voucher_reserve', {
          p_tenant_id: tenantA,
          p_environment: PROD,
          p_point_of_sale: POS,
          p_cbte_tipo: 6,
          p_payload: { form: {}, total_cents: 1 },
        })
      ).error,
    )
  })

  it('anon no lee las tablas ni ejecuta las RPC', async () => {
    const anon = getAnonClient()
    for (const table of [
      'acc_arca_connections',
      'acc_arca_vouchers',
      'acc_arca_padron_cache',
      'acc_guide_progress',
      'acc_secrets',
      'acc_arca_tickets',
    ]) {
      const { data, error } = await anon.from(table).select('*').limit(1)
      expect(error !== null || (data ?? []).length === 0, table).toBe(true)
    }
    const rpc = await anon.rpc('acc_arca_get_credentials', {
      p_tenant_id: tenantA,
      p_environment: PROD,
      p_secret_key: SECRET,
    })
    expect(rpc.error).not.toBeNull()
  })

  it('guías y consumidor final: marcar es idempotente y el partícipe se crea una sola vez', async () => {
    const mark = (done: boolean) =>
      ownerA.client.rpc('acc_guide_mark', {
        p_tenant_id: tenantA,
        p_guide: 'arca',
        p_step: 's5_csr',
        p_done: done,
      })
    expect((await mark(true)).error).toBeNull()
    expect((await mark(true)).error).toBeNull()
    const marked = await accountant.client
      .from('acc_guide_progress')
      .select('step')
      .eq('tenant_id', tenantA)
    expect(marked.data?.map((r) => (r as Row).step)).toEqual(['s5_csr'])
    expect((await mark(false)).error).toBeNull()
    const bad = await ownerA.client.rpc('acc_guide_mark', {
      p_tenant_id: tenantA,
      p_guide: 'otra',
      p_step: 's5_csr',
      p_done: true,
    })
    expectKey(bad.error, 'guide_step_invalid')

    const a = await ownerA.client.rpc('acc_ensure_final_consumer', { p_tenant_id: tenantA })
    const b = await ownerA.client.rpc('acc_ensure_final_consumer', { p_tenant_id: tenantA })
    expect(a.error).toBeNull()
    expect(a.data).toBe(b.data)
  })

  it('desconectar exige DESCONECTAR, borra clave y certificado, y es idempotente', async () => {
    // Homologación con el certificado de una persona (en producción tiene que ser la SAS).
    const keypair = await ownerA.client.rpc('acc_arca_store_keypair', {
      p_tenant_id: tenantA,
      p_environment: HOMO,
      p_alias: 'hubpruebas',
      p_cert_cuit: PERSON_CUIT,
      p_private_key_pem: PRIVATE_KEY_PEM,
      p_csr_pem: CSR_PEM,
      p_public_key_sha256: 'd'.repeat(64),
      p_secret_key: SECRET,
      p_mode: 'new',
    })
    expect(keypair.error).toBeNull()
    expect((keypair.data as Row).status).toBe('key_ready')

    const disconnect = (confirm: string) =>
      ownerA.client.rpc('acc_arca_disconnect', {
        p_tenant_id: tenantA,
        p_environment: HOMO,
        p_confirm: confirm,
      })
    expectKey((await disconnect('desconectar')).error, 'confirmation_required')
    expect((await disconnect('DESCONECTAR')).error).toBeNull()
    expect((await disconnect('DESCONECTAR')).error).toBeNull()

    const row = await connection(HOMO)
    expect(row.status).toBe('disconnected')
    expect(row.csr_pem).toBeNull()
    expect(row.public_key_sha256).toBeNull()
    const creds = await ownerA.client.rpc('acc_arca_get_credentials', {
      p_tenant_id: tenantA,
      p_environment: HOMO,
      p_secret_key: SECRET,
    })
    expectKey(creds.error, 'arca_not_ready')
  })

  it('la auditoría registra las operaciones sin la clave privada ni la clave del servidor', async () => {
    const expected = [
      'acc_arca.connection_saved',
      'acc_arca.keypair_generated',
      'acc_arca.certificate_saved',
      'acc_arca.tested',
      'acc_arca.voucher_reserved',
      'acc_arca.voucher_requesting',
      'acc_arca.voucher_authorized',
      'acc_arca.disconnected',
    ]
    const { data, error } = await getServiceClient()
      .from('audit_log')
      .select('action, payload')
      .eq('tenant_id', tenantA)
      .in('action', expected)
    expect(error).toBeNull()
    const actions = new Set((data ?? []).map((r) => (r as Row).action))
    for (const action of expected) expect(actions.has(action), action).toBe(true)
    const text = JSON.stringify(data)
    expect(text).not.toContain('PRIVATE KEY')
    expect(text).not.toContain(SECRET)
  })
})
