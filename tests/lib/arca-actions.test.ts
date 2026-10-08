/**
 * Acciones de ARCA (diseño §2.3, §2.6 y §3.1) de punta a punta con la base y ARCA
 * simulados: el permiso, la sesión de Supabase y el transporte son falsos; la
 * cripto (clave, pedido, lectura del certificado, firma del TRA) es la de verdad.
 *
 * Lo que importa: que al navegador vuelva solo lo que tiene que volver (el pedido,
 * nunca la clave ni el certificado ni el ticket), que la base reciba exactamente lo
 * que exige el contrato de las RPC, que «Probar conexión» corra los chequeos en
 * orden y los traduzca a palabras simples con su paso de la guía (y que el 602 de
 * homologación no falle), y que nada sensible termine en un log.
 */

import { createHash, createPublicKey, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/accounting/access', () => ({ authorizeAccounting: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/arca/transport', () => ({ getTransport: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { authorizeAccounting } from '@/lib/accounting/access'
import { ACC_ERRORS } from '@/lib/accounting/errors'
import {
  disconnectArca,
  downloadArcaCsr,
  fetchArcaOverview,
  lookupCuit,
  markGuideStep,
  saveArcaPointOfSale,
  saveArcaSettings,
  startArcaCertificate,
  testArcaConnection,
  uploadArcaCertificate,
} from '@/lib/arca/actions'
import { parseCertificate } from '@/lib/arca/cert'
import { runConnectionTest, sameLegalName } from '@/lib/arca/connection-test'
import { ARCA_ERRORS } from '@/lib/arca/errors'
import { padronCacheRow, parsePersona } from '@/lib/arca/padron'
import { CERT_UPLOAD_MAX_BYTES, fromPem } from '@/lib/arca/pem'
import { CERT_FILE_MAX_BYTES, decodeUploadedFile } from '@/lib/arca/schemas'
import { arcaDeadline, createArcaSession } from '@/lib/arca/session'
import { getTransport } from '@/lib/arca/transport'
import type { ArcaTestView } from '@/lib/arca/views'
import { formatDate } from '@/lib/dates'
import { _resetRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import {
  ARCA_CRYPTO_FILES as CRYPTO,
  fixtureBytes,
  fixtureText,
} from '@/tests/fixtures/arca/crypto-fixtures'
import { ARCA_XML, arcaXml, XML_CUITS } from '@/tests/fixtures/arca/xml/fixtures'
import {
  CONNECTION_ID,
  FakeTicketDb,
  type FakeTransport,
  FIXTURE_TOKEN,
  fakeSupabase,
  fixtureResponse,
  happyTransport,
  loginResponse,
  PERSON_CUIT,
  SAS_CUIT,
  SECRET,
  ssoToken,
  type TableRows,
  TENANT,
  ultimoTipos,
  wsaaFault,
} from './arca-fakes'

const SLUG = 'hub'
const START = new Date('2026-10-08T12:00:00.000Z')
const DAY = 86_400_000
const KEY = fixtureText(CRYPTO.testKey)
const CERT = fixtureText(CRYPTO.issuedCrt)
const KEY_HASH = createHash('sha256')
  .update(createPublicKey(KEY).export({ type: 'spki', format: 'der' }))
  .digest('hex')
const UPDATED_AT = '2026-10-08T11:00:00.123+00:00'
const CSR_PEM = fixtureText(CRYPTO.opensslCsr)

type Row = Record<string, unknown>
type CheckArg = { key: string; ok: boolean; detail?: Row | null; error?: string | null }

let tables: TableRows
let db: FakeTicketDb
let transport: FakeTransport
let logs: string[]

const nowIso = () => new Date().toISOString()
const ok = (data: unknown) => ({ data, error: null })
const fail = (message: string) => ({ data: null, error: { message, code: 'P0001' } })

function connRow(over: Row = {}): Row {
  return {
    id: CONNECTION_ID,
    tenant_id: TENANT,
    environment: 'produccion',
    status: 'connected',
    represented_cuit: SAS_CUIT,
    cert_cuit: SAS_CUIT,
    alias: 'hubplataforma',
    csr_pem: CSR_PEM,
    public_key_sha256: KEY_HASH,
    pending_csr_pem: null,
    pending_public_key_sha256: null,
    certificate_pem: CERT,
    cert_serial: '8f3a5c7e9b1d2f40',
    cert_issuer: 'C=AR, O=AC de Prueba, CN=AC de Prueba Computadores',
    cert_not_before: '2026-09-10T00:00:00+00:00',
    cert_not_after: '2028-09-10T00:00:00+00:00',
    point_of_sale: 5,
    allowed_classes: ['B'],
    default_concepto: 1,
    emission_enabled: false,
    services: {},
    last_test_at: null,
    last_test: null,
    last_error_key: null,
    updated_at: UPDATED_AT,
    ...over,
  }
}

function connection(environment: unknown): Row | undefined {
  return tables.acc_arca_connections?.find((r) => r.environment === environment)
}

function setConnections(...rows: Row[]) {
  tables.acc_arca_connections = rows
}

/** Las RPC de escritura con las reglas de las migraciones que importan acá. */
function installHandlers() {
  db.others.set('acc_arca_store_keypair', (args) => {
    let row = connection(args.p_environment)
    if (!row) {
      row = connRow({
        environment: args.p_environment,
        status: 'draft',
        certificate_pem: null,
        cert_not_after: null,
        cert_not_before: null,
        cert_serial: null,
        public_key_sha256: null,
        csr_pem: null,
      })
      tables.acc_arca_connections?.push(row)
    }
    Object.assign(row, {
      status: 'key_ready',
      alias: args.p_alias,
      cert_cuit: args.p_cert_cuit,
      csr_pem: args.p_csr_pem,
      public_key_sha256: args.p_public_key_sha256,
      certificate_pem: null,
      cert_not_after: null,
      updated_at: nowIso(),
    })
    return ok({
      connection_id: row.id,
      environment: row.environment,
      status: 'key_ready',
      alias: row.alias,
      mode: args.p_mode,
      updated_at: row.updated_at,
    })
  })
  db.others.set('acc_arca_save_certificate', (args) => {
    const row = connection(args.p_environment)
    if (!row) return fail('arca_key_missing')
    const meta = args.p_meta as Row
    Object.assign(row, {
      certificate_pem: args.p_certificate_pem,
      cert_serial: String(meta.serial_hex).toLowerCase(),
      cert_issuer: meta.issuer,
      cert_not_before: meta.not_before,
      cert_not_after: meta.not_after,
      public_key_sha256: meta.public_key_sha256,
      status: 'cert_ready',
      updated_at: nowIso(),
    })
    return ok({ ...row })
  })
  db.others.set('acc_arca_save_connection', (args) => {
    let row = connection(args.p_environment)
    if (!row) {
      row = connRow({ environment: args.p_environment, status: 'draft', public_key_sha256: null })
      tables.acc_arca_connections?.push(row)
    } else if (args.p_expected_updated_at !== row.updated_at) {
      return fail('stale')
    }
    const patch = args.p_patch as Row
    for (const key of Object.keys(patch)) {
      if (
        ![
          'alias',
          'point_of_sale',
          'allowed_classes',
          'default_concepto',
          'emission_enabled',
        ].includes(key)
      ) {
        return fail('invalid_payload')
      }
    }
    if ('point_of_sale' in patch && patch.point_of_sale !== row.point_of_sale) {
      if (row.status === 'connected') {
        row.status = 'cert_ready'
        if (!('emission_enabled' in patch)) row.emission_enabled = false
      }
    }
    Object.assign(row, patch, { updated_at: nowIso() })
    if (
      row.emission_enabled === true &&
      !(row.environment === 'produccion' && row.status === 'connected' && row.point_of_sale)
    ) {
      return fail('arca_emission_requires_connection')
    }
    return ok({ ...row })
  })
  db.others.set('acc_save_sales_point', (args) => {
    const point = args.p_point as Row
    const row = { id: randomUUID(), tenant_id: TENANT, ...point, active: true }
    tables.acc_sales_points?.push(row)
    return ok(row)
  })
  db.others.set('acc_arca_record_test', (args) => {
    const row = connection(args.p_environment)
    if (!row || !['cert_ready', 'connected', 'error'].includes(String(row.status))) {
      return fail('arca_not_ready')
    }
    const checks = (args.p_result as { checks: CheckArg[] }).checks
    for (const c of checks) {
      const extra = Object.keys(c).some((k) => !['key', 'ok', 'detail', 'error'].includes(k))
      const badError = c.error != null && !/^[a-z][a-z0-9_]{1,59}$/.test(c.error)
      const badDetail =
        c.detail != null && (typeof c.detail !== 'object' || Array.isArray(c.detail))
      if (extra || badError || badDetail || typeof c.ok !== 'boolean')
        return fail('invalid_payload')
    }
    if (checks.length < 1 || checks.length > 12 || JSON.stringify(checks).length > 12_000) {
      return fail('invalid_payload')
    }
    const passed = new Set(checks.filter((c) => c.ok).map((c) => c.key))
    const status = ['service', 'wsfe_ticket', 'relations', 'point_of_sale', 'padron'].every((k) =>
      passed.has(k),
    )
      ? 'connected'
      : 'error'
    const firstError = checks.find((c) => !c.ok && c.error)?.error ?? null
    const at = nowIso()
    Object.assign(row, {
      status,
      last_test_at: at,
      last_test: { at, environment: args.p_environment, status, checks },
      last_error_key: status === 'connected' ? null : firstError,
      updated_at: at,
    })
    return ok({ ...row })
  })
  db.others.set('acc_arca_disconnect', () => ok(null))
  db.others.set('acc_guide_mark', () => ok(null))
  // Migración 20261008120400: borra el TA guardado del servicio (sin tocar lease ni cooldown).
  db.others.set('acc_arca_ticket_drop', (args) => {
    const row = db.row(String(args.p_environment), String(args.p_service))
    const had = row.token !== null
    Object.assign(row, { token: null, sign: null, expiresAt: null })
    return ok(had)
  })
  db.others.set('acc_arca_padron_cache_put', (args) => {
    const rows = args.p_rows as Row[]
    for (const r of rows) {
      tables.acc_arca_padron_cache = (tables.acc_arca_padron_cache ?? []).filter(
        (c) => !(c.environment === args.p_environment && c.cuit === r.cuit),
      )
      tables.acc_arca_padron_cache.push({
        tenant_id: TENANT,
        environment: args.p_environment,
        cuit: r.cuit,
        found: r.found,
        data: r.data,
        fetched_at: nowIso(),
      })
    }
    return ok(rows.length)
  })
}

function allowWrite() {
  vi.mocked(authorizeAccounting).mockResolvedValue({
    ok: true,
    tenantId: TENANT,
    userId: '00000000-0000-4000-8000-0000000000cc',
    slug: SLUG,
    access: {} as never,
  })
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

/** Lo que no puede viajar al navegador ni a un log. */
function expectNoSecrets(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  expect(text).not.toContain(SECRET)
  expect(text).not.toContain('PRIVATE KEY')
  expect(text).not.toContain(KEY.slice(40, 100))
  expect(text).not.toContain(FIXTURE_TOKEN.slice(0, 40))
}

// ─── Contrato con la base ────────────────────────────────────────────────────

/**
 * Las firmas de las RPC según las migraciones (el contrato contra el que se
 * programa mientras no estén aplicadas): nombre → parámetros y cuáles no tienen
 * default. PostgREST resuelve la función por los nombres de los parámetros.
 */
function migrationSignatures(): Map<string, { all: Set<string>; required: Set<string> }> {
  const dir = new URL('../../supabase/migrations/', import.meta.url)
  const files = readdirSync(dir).filter(
    (f) => f.startsWith('20261008120') || f === '20261007120720_acc_rpc_setup_master_catalogs.sql',
  )
  const out = new Map<string, { all: Set<string>; required: Set<string> }>()
  for (const file of files) {
    const sql = readFileSync(new URL(file, dir), 'utf8')
    for (const m of sql.matchAll(/create function public\.(\w+)\(([\s\S]*?)\)\s*returns/g)) {
      const params = (m[2] ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
      const name = (p: string) => p.split(/\s+/)[0] ?? ''
      out.set(m[1] ?? '', {
        all: new Set(params.map(name)),
        required: new Set(params.filter((p) => !/\bdefault\b/.test(p)).map(name)),
      })
    }
  }
  return out
}

const SIGNATURES = migrationSignatures()

function expectMatchesSignature(fn: string, args: Record<string, unknown>) {
  const signature = SIGNATURES.get(fn)
  expect(signature, `${fn} no está en las migraciones`).toBeDefined()
  if (!signature) return
  const keys = Object.keys(args)
  for (const key of keys) expect(signature.all.has(key), `${fn}.${key}`).toBe(true)
  for (const key of signature.required) expect(keys, `${fn}.${key}`).toContain(key)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START)
  vi.stubEnv('META_TOKEN_KEY', SECRET)
  _resetRateLimit()
  tables = {
    acc_settings: [{ tenant_id: TENANT, legal_name: 'Bar de Prueba SAS', cuit: SAS_CUIT }],
    acc_arca_connections: [],
    acc_guide_progress: [],
    acc_arca_vouchers: [],
    acc_arca_padron_cache: [],
    acc_sales_points: [],
  }
  db = new FakeTicketDb(() => new Date(), { privateKeyPem: KEY, certificatePem: CERT })
  installHandlers()
  transport = happyTransport(() => new Date())
  vi.mocked(createClient).mockImplementation(async () => fakeSupabase(tables, db.rpc) as never)
  vi.mocked(getTransport).mockImplementation(() => transport)
  allowWrite()
  logs = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  // Cada llamada del test usa exactamente los parámetros de la firma de la migración.
  for (const call of db.calls) expectMatchesSignature(call.fn, call.args)
  for (const line of logs) expectNoSecrets(line)
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// ─── Paso 5 ──────────────────────────────────────────────────────────────────

describe('startArcaCertificate (clave y pedido)', () => {
  it('producción: clave + pedido con la CUIT de la SAS; al navegador vuelve solo el pedido', async () => {
    const state = await startArcaCertificate(SLUG, {
      environment: 'produccion',
      alias: ' HubPlataforma ',
    })
    expect(state.ok).toBe(true)
    if (!state.ok) return

    const [args] = db.callsTo('acc_arca_store_keypair')
    expect(args).toMatchObject({
      p_tenant_id: TENANT,
      p_environment: 'produccion',
      p_alias: 'hubplataforma',
      p_cert_cuit: SAS_CUIT,
      p_secret_key: SECRET,
      p_mode: 'new',
    })
    const privateKeyPem = String(args?.p_private_key_pem)
    expect(privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/)
    const spki = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' })
    expect(args?.p_public_key_sha256).toBe(createHash('sha256').update(spki).digest('hex'))
    const csrDer = fromPem(String(args?.p_csr_pem))?.der.toString('latin1') ?? ''
    expect(csrDer).toContain(`CUIT ${SAS_CUIT}`)
    expect(csrDer).toContain('hubplataforma')
    expect(csrDer).toContain('Bar de Prueba SAS')

    expect(Object.keys(state.data).sort()).toEqual([
      'alias',
      'csrPem',
      'environment',
      'fileName',
      'mode',
      'status',
      'updatedAt',
    ])
    expect(state.data).toMatchObject({
      environment: 'produccion',
      alias: 'hubplataforma',
      fileName: 'arca-hubplataforma.csr',
      mode: 'new',
      status: 'key_ready',
    })
    expect(state.data.csrPem).toBe(args?.p_csr_pem)
    expectNoSecrets(state)
    expect(revalidatePath).toHaveBeenCalledWith('/hub/administracion', 'layout')
  })

  it('producción no acepta la CUIT de otra persona para el certificado', async () => {
    const state = await startArcaCertificate(SLUG, {
      environment: 'produccion',
      alias: 'hubplataforma',
      certCuit: PERSON_CUIT,
    })
    expect(state).toMatchObject({ ok: false, code: 'invalid' })
    if (state.ok) return
    expect(state.fieldErrors?.certCuit).toContain('la de Ajustes › Datos de la SAS')
    expect(db.callsTo('acc_arca_store_keypair')).toHaveLength(0)
  })

  it('homologación pide la CUIT personal (WSASS); con un pedido anterior reusa esa', async () => {
    const missing = await startArcaCertificate(SLUG, {
      environment: 'homologacion',
      alias: 'hubpruebas',
    })
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.fieldErrors?.certCuit).toContain('CUIT personal')

    const first = await startArcaCertificate(SLUG, {
      environment: 'homologacion',
      alias: 'hubpruebas',
      certCuit: '20-12345678-6',
    })
    expect(first.ok).toBe(true)
    expect(db.callsTo('acc_arca_store_keypair')[0]?.p_cert_cuit).toBe(PERSON_CUIT)

    const again = await startArcaCertificate(SLUG, {
      environment: 'homologacion',
      alias: 'hubpruebas',
      mode: 'replace',
    })
    expect(again.ok).toBe(true)
    expect(db.callsTo('acc_arca_store_keypair')[1]).toMatchObject({
      p_cert_cuit: PERSON_CUIT,
      p_mode: 'replace',
    })
  })

  it('una razón social de más de 64 caracteres se recorta (ARCA reescribe el sujeto igual)', async () => {
    const long = 'Bar de Prueba con un Nombre Larguísimo Sociedad por Acciones Simplificada'
    expect(Array.from(long).length).toBeGreaterThan(64)
    const settings = tables.acc_settings?.[0]
    if (settings) settings.legal_name = long
    const state = await startArcaCertificate(SLUG, {
      environment: 'produccion',
      alias: 'hubplataforma',
    })
    expect(state.ok).toBe(true)
    const der = fromPem(String(db.callsTo('acc_arca_store_keypair')[0]?.p_csr_pem))?.der
    const subject = der?.toString('utf8') ?? ''
    expect(subject).toContain(Array.from(long).slice(0, 64).join('').trim())
    expect(subject).not.toContain(long)
  })

  it('sin CUIT en Datos de la SAS no se genera nada', async () => {
    const settings = tables.acc_settings?.[0]
    if (settings) settings.cuit = null
    const state = await startArcaCertificate(SLUG, {
      environment: 'produccion',
      alias: 'hubplataforma',
    })
    expect(state).toMatchObject({ ok: false, detail: { key: 'sas_cuit_missing' } })
    expect(db.calls).toHaveLength(0)
  })

  it('si ya hay un certificado, la base pide confirmar el reemplazo', async () => {
    db.others.set('acc_arca_store_keypair', () => fail('arca_key_replace_requires_confirm'))
    const state = await startArcaCertificate(SLUG, {
      environment: 'produccion',
      alias: 'hubplataforma',
    })
    expect(state).toMatchObject({
      ok: false,
      code: 'conflict',
      message: ACC_ERRORS.arca_key_replace_requires_confirm.message,
    })
  })

  it('sin la clave del servidor no se genera nada (y queda en el log, sin datos)', async () => {
    vi.stubEnv('META_TOKEN_KEY', '')
    const state = await startArcaCertificate(SLUG, {
      environment: 'produccion',
      alias: 'hubplataforma',
    })
    expect(state).toMatchObject({
      ok: false,
      code: 'error',
      detail: { key: 'secrets_key_missing' },
    })
    expect(db.callsTo('acc_arca_store_keypair')).toHaveLength(0)
    expect(logs).toContain('[arca.startCertificate] secrets_key_missing')
  })

  it('sin permiso devuelve el estado de la puerta y no toca nada', async () => {
    vi.mocked(authorizeAccounting).mockResolvedValue({
      ok: false,
      state: { ok: false, code: 'forbidden', message: 'No tenés permiso.' },
    })
    const state = await startArcaCertificate(SLUG, {
      environment: 'produccion',
      alias: 'hubplataforma',
    })
    expect(state).toMatchObject({ ok: false, code: 'forbidden' })
    expect(createClient).not.toHaveBeenCalled()
    expect(authorizeAccounting).toHaveBeenCalledWith(SLUG, 'write')
  })

  it('«Descargar de nuevo» devuelve el mismo pedido (el vigente o el de la renovación)', async () => {
    setConnections(connRow({ pending_csr_pem: '-----BEGIN CERTIFICATE REQUEST-----\nNUEVO\n' }))
    const current = await downloadArcaCsr(SLUG, { environment: 'produccion' })
    expect(current).toMatchObject({
      ok: true,
      data: { alias: 'hubplataforma', csrPem: CSR_PEM, fileName: 'arca-hubplataforma.csr' },
    })
    const pending = await downloadArcaCsr(SLUG, { environment: 'produccion', pending: true })
    expect(pending.ok && pending.data.csrPem).toContain('NUEVO')
    const none = await downloadArcaCsr(SLUG, { environment: 'homologacion' })
    expect(none).toMatchObject({ ok: false, detail: { key: 'arca_key_missing' } })
  })
})

// ─── Paso 6 ──────────────────────────────────────────────────────────────────

describe('uploadArcaCertificate (el .crt de ARCA)', () => {
  const pending = () =>
    connRow({
      status: 'key_ready',
      certificate_pem: null,
      cert_serial: null,
      cert_issuer: null,
      cert_not_before: null,
      cert_not_after: null,
    })

  it('producción: valida el certificado y lo guarda con la lista exacta de datos', async () => {
    setConnections(pending())
    const state = await uploadArcaCertificate(SLUG, {
      environment: 'produccion',
      fileBase64: b64(CERT),
      expectedUpdatedAt: UPDATED_AT,
    })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    const [args] = db.callsTo('acc_arca_save_certificate')
    expect(args?.p_certificate_pem).toBe(parseCertificate(CERT).pem)
    expect(args?.p_meta).toEqual({
      serial_hex: '8F3A5C7E9B1D2F40',
      subject_cuit: SAS_CUIT,
      subject_cn: 'hubplataforma',
      issuer: 'C=AR, O=AC de Prueba, CN=AC de Prueba Computadores',
      not_before: '2026-09-10T00:00:00.000Z',
      not_after: '2028-09-10T00:00:00.000Z',
      public_key_sha256: KEY_HASH,
    })
    expect(args?.p_expected_updated_at).toBe(UPDATED_AT)
    expect(state.data).toMatchObject({
      environment: 'produccion',
      serial: '8F3A5C7E9B1D2F40',
      renewal: false,
      warnings: [],
      notAfter: '2028-09-10T00:00:00.000Z',
    })
    expect(state.data.connection?.status).toBe('cert_ready')
    expect(state.message).toBe(
      `Listo: certificado válido hasta el ${formatDate(new Date('2028-09-10T00:00:00.000Z'))}.`,
    )
    expect(JSON.stringify(state)).not.toContain('BEGIN CERTIFICATE')
  })

  it('acepta DER y el data URL del navegador (homologación, certificado de la persona)', async () => {
    setConnections(
      connRow({
        ...pending(),
        environment: 'homologacion',
        cert_cuit: PERSON_CUIT,
        alias: 'plataformatest',
      }),
    )
    const der = fixtureBytes(CRYPTO.testCrtDer).toString('base64')
    const state = await uploadArcaCertificate(SLUG, {
      environment: 'homologacion',
      fileBase64: `data:application/x-x509-ca-cert;base64,${der}`,
    })
    expect(state.ok).toBe(true)
    expect(db.callsTo('acc_arca_save_certificate')[0]?.p_meta).toMatchObject({
      subject_cuit: PERSON_CUIT,
      subject_cn: 'plataformatest',
    })
  })

  it('reconoce lo que no es un certificado y no guarda nada', async () => {
    setConnections(pending())
    const cases: Array<[string, string]> = [
      [b64(CSR_PEM), 'Subiste el pedido (.csr)'],
      [b64(KEY), 'Eso es una clave privada'],
      [fixtureBytes(CRYPTO.testP12).toString('base64'), 'trae clave y certificado juntos'],
      [b64('hola, esto no es un certificado'), 'No pudimos leer el archivo'],
      ['no es base64!!', 'No pudimos leer el archivo'],
    ]
    for (const [file, message] of cases) {
      const state = await uploadArcaCertificate(SLUG, {
        environment: 'produccion',
        fileBase64: file,
      })
      expect(state.ok).toBe(false)
      if (state.ok) continue
      expect(state.fieldErrors?.fileBase64).toContain(message)
      expectNoSecrets(state)
    }
    expect(db.callsTo('acc_arca_save_certificate')).toHaveLength(0)
  })

  it('un certificado de otro pedido: dice qué alias subir', async () => {
    setConnections(connRow({ ...pending(), public_key_sha256: 'a'.repeat(64) }))
    const state = await uploadArcaCertificate(SLUG, {
      environment: 'produccion',
      fileBase64: b64(CERT),
    })
    expect(state.ok).toBe(false)
    if (state.ok) return
    expect(state.fieldErrors?.fileBase64).toBe(
      'Este certificado es de otro pedido. Volvé a ARCA y subí el .csr de este paso (alias «hubplataforma»).',
    )
  })

  it('renovación: el certificado de la clave pendiente se acepta', async () => {
    setConnections(
      connRow({ public_key_sha256: 'b'.repeat(64), pending_public_key_sha256: KEY_HASH }),
    )
    const state = await uploadArcaCertificate(SLUG, {
      environment: 'produccion',
      fileBase64: b64(CERT),
    })
    expect(state).toMatchObject({ ok: true, data: { renewal: true } })
    expect(state.ok && state.message).toContain('La renovación quedó hecha.')
  })

  it('producción: un certificado que no es de la SAS', async () => {
    setConnections(connRow({ ...pending(), cert_cuit: XML_CUITS.exento }))
    const state = await uploadArcaCertificate(SLUG, {
      environment: 'produccion',
      fileBase64: b64(CERT),
    })
    expect(state.ok).toBe(false)
    if (state.ok) return
    expect(state.fieldErrors?.fileBase64).toBe(
      'El certificado es de la CUIT 30-71234567-1, no de la SAS. En el paso 6, en «¿En nombre de quién?», elegí la SAS.',
    )
  })

  it('vencido: lo dice con la fecha y no lo guarda', async () => {
    vi.setSystemTime(new Date('2029-01-01T12:00:00.000Z'))
    setConnections(pending())
    const state = await uploadArcaCertificate(SLUG, {
      environment: 'produccion',
      fileBase64: b64(CERT),
    })
    expect(state.ok).toBe(false)
    if (state.ok) return
    expect(state.fieldErrors?.fileBase64).toContain('El certificado venció el')
    expect(db.callsTo('acc_arca_save_certificate')).toHaveLength(0)
  })

  it('el alias del certificado distinto del pedido es un aviso, no un error', async () => {
    setConnections(connRow({ ...pending(), alias: 'otroalias' }))
    const state = await uploadArcaCertificate(SLUG, {
      environment: 'produccion',
      fileBase64: b64(CERT),
    })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(state.data.warnings[0]).toContain('«hubplataforma»')
    expect(state.data.warnings[0]).toContain('«otroalias»')
  })

  it('sin pedido generado: arca_key_missing', async () => {
    const state = await uploadArcaCertificate(SLUG, {
      environment: 'produccion',
      fileBase64: b64(CERT),
    })
    expect(state).toMatchObject({ ok: false, detail: { key: 'arca_key_missing' } })
  })

  it('el tope del archivo es el mismo que el de pem.ts (16 KB)', () => {
    expect(CERT_FILE_MAX_BYTES).toBe(CERT_UPLOAD_MAX_BYTES)
    expect(decodeUploadedFile(Buffer.alloc(CERT_FILE_MAX_BYTES + 1, 1).toString('base64'))).toBe(
      null,
    )
    expect(decodeUploadedFile(b64(CERT))?.byteLength).toBe(Buffer.byteLength(CERT))
  })
})

// ─── Paso 2 y datos de la conexión ───────────────────────────────────────────

describe('saveArcaPointOfSale y saveArcaSettings', () => {
  it('producción: guarda el punto y lo da de alta como «Plataforma (ARCA)», canal Eventos', async () => {
    setConnections(connRow())
    const state = await saveArcaPointOfSale(SLUG, { environment: 'produccion', pointOfSale: 7 })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(db.callsTo('acc_arca_save_connection')).toEqual([
      {
        p_tenant_id: TENANT,
        p_environment: 'produccion',
        p_patch: { point_of_sale: 7 },
        p_expected_updated_at: UPDATED_AT,
      },
    ])
    expect(db.callsTo('acc_save_sales_point')).toEqual([
      {
        p_tenant_id: TENANT,
        p_point: { number: 7, label: 'Plataforma (ARCA)', default_channel: 'events' },
        p_expected_updated_at: null,
      },
    ])
    expect(state.data.salesPoint).toEqual({
      status: 'created',
      number: 7,
      label: 'Plataforma (ARCA)',
    })
    // Estaba conectada: el punto nuevo hay que probarlo.
    expect(state.data.connection?.status).toBe('cert_ready')
    expect(state.message).toBe('Listo: punto de venta guardado. Volvé a probar la conexión.')
  })

  it('si el número ya está cargado con otro nombre, avisa (puede ser el del sistema de caja actual)', async () => {
    setConnections(connRow({ status: 'cert_ready' }))
    tables.acc_sales_points = [{ id: randomUUID(), tenant_id: TENANT, number: 3, label: 'Salón' }]
    const fd = new FormData()
    fd.set('environment', 'produccion')
    fd.set('pointOfSale', '3')
    const state = await saveArcaPointOfSale(SLUG, fd)
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(db.callsTo('acc_save_sales_point')).toHaveLength(0)
    expect(state.data.salesPoint).toEqual({ status: 'existing', number: 3, label: 'Salón' })
    expect(state.data.warnings[0]).toContain('«Salón»')
    // Multi-bar: sin nombres de sistemas ni de bares en el texto.
    expect(state.data.warnings[0]).toContain('el sistema de caja que tenés hoy')
    expect(state.data.warnings[0]).not.toMatch(/thinkeon|hub/i)
  })

  it('homologación no toca Ajustes › Puntos de venta', async () => {
    const state = await saveArcaPointOfSale(SLUG, { environment: 'homologacion', pointOfSale: 1 })
    expect(state).toMatchObject({ ok: true, data: { salesPoint: null } })
    expect(db.callsTo('acc_save_sales_point')).toHaveLength(0)
  })

  it('valida el número y respeta la concurrencia de la base', async () => {
    const bad = await saveArcaPointOfSale(SLUG, { environment: 'produccion', pointOfSale: 0 })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.fieldErrors?.pointOfSale).toBe('Revisá el punto de venta: va de 1 a 99998.')

    setConnections(connRow())
    const stale = await saveArcaPointOfSale(SLUG, {
      environment: 'produccion',
      pointOfSale: 8,
      expectedUpdatedAt: '2026-10-01T00:00:00.000Z',
    })
    expect(stale).toMatchObject({ ok: false, code: ACC_ERRORS.stale.code })
  })

  it('datos de la conexión: solo viajan las claves que mandó la pantalla (y la B siempre)', async () => {
    setConnections(connRow())
    const state = await saveArcaSettings(SLUG, { environment: 'produccion', allowedClasses: ['A'] })
    expect(state.ok).toBe(true)
    expect(db.callsTo('acc_arca_save_connection')[0]?.p_patch).toEqual({
      allowed_classes: ['A', 'B'],
    })
    if (state.ok) expect(state.data.allowedClasses).toEqual(['A', 'B'])
  })

  it('la emisión se prende solo en producción', async () => {
    const homo = await saveArcaSettings(SLUG, {
      environment: 'homologacion',
      emissionEnabled: true,
    })
    expect(homo.ok).toBe(false)
    if (!homo.ok) expect(homo.fieldErrors?.emissionEnabled).toContain('solo en producción')

    setConnections(connRow())
    const prod = await saveArcaSettings(SLUG, { environment: 'produccion', emissionEnabled: true })
    expect(prod).toMatchObject({ ok: true, data: { emissionEnabled: true } })
    expect(prod.ok && prod.message).toContain('ya podés emitir')
  })
})

// ─── Paso 9: «Probar conexión» ───────────────────────────────────────────────

const keysOf = (view: ArcaTestView) => view.checks.map((c) => c.key)

describe('testArcaConnection («Probar conexión»)', () => {
  it('producción, todo bien: los 7 chequeos en orden y queda conectado', async () => {
    setConnections(connRow({ status: 'cert_ready', allowed_classes: ['A', 'B'] }))
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(state.data.status).toBe('connected')
    expect(keysOf(state.data)).toEqual([
      'service',
      'wsfe_ticket',
      'relations',
      'point_of_sale',
      'numbering',
      'padron',
      'certificate',
    ])
    expect(state.data.checks.every((c) => c.ok && c.tone === 'ok')).toBe(true)
    expect(state.data.notRun).toEqual([])
    expect(state.message).toBe('¡Listo! ARCA quedó conectado.')

    // Lo que se guardó: la forma de acc_arca_record_test.
    const checks = (db.callsTo('acc_arca_record_test')[0]?.p_result as { checks: CheckArg[] })
      .checks
    expect(checks.find((c) => c.key === 'point_of_sale')).toEqual({
      key: 'point_of_sale',
      ok: true,
      detail: { nro: 5, emision_tipo: 'CAE', bloqueado: 'N' },
    })
    expect(checks.find((c) => c.key === 'numbering')?.detail).toEqual({ '6': 104, '1': 0 })
    expect(checks.find((c) => c.key === 'padron')?.detail).toMatchObject({
      found: true,
      name: 'BAR DE PRUEBA SAS',
      iva: 'responsable_inscripto',
      active: true,
      name_matches: true,
    })
    expect(checks.find((c) => c.key === 'relations')?.detail).toEqual({ listed: true })

    // En orden, y una sola vez cada login (wsfe y padrón).
    expect(transport.calls.map((c) => `${c.service}:${c.method}:${c.wsn ?? ''}`)).toEqual([
      'wsfe:FEDummy:wsfe',
      'wsaa:loginCms:wsfe',
      'wsfe:FEParamGetPtosVenta:wsfe',
      'wsfe:FECompUltimoAutorizado:wsfe',
      'wsfe:FECompUltimoAutorizado:wsfe',
      'padron:dummy:ws_sr_constancia_inscripcion',
      'wsaa:loginCms:ws_sr_constancia_inscripcion',
      'padron:getPersona_v2:ws_sr_constancia_inscripcion',
    ])
    expect(ultimoTipos(transport)).toEqual([6, 1])
    // «Probar conexión» borra el cooldown manual del ticket de cada servicio.
    expect(db.callsTo('acc_arca_ticket_get').map((a) => a.p_clear_manual_cooldown)).toEqual([
      true,
      true,
    ])
    expect(state.data.checks.find((c) => c.key === 'numbering')?.message).toBe(
      'Última Factura B: 0005-00000104 · Última Factura A: 0005-00000000 (todavía ninguna).',
    )
    expectNoSecrets(state)
    expect(JSON.stringify(state)).not.toContain('BEGIN CERTIFICATE')
  })

  it('homologación: el 602 «Sin Resultados» de los puntos de venta no es una falla', async () => {
    setConnections(connRow({ environment: 'homologacion', status: 'cert_ready' }))
    transport.routes['wsfe:FEParamGetPtosVenta'] = fixtureResponse(ARCA_XML.wsfePtosVenta602)
    const state = await testArcaConnection(SLUG, { environment: 'homologacion' })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(state.data.status).toBe('connected')
    const pos = state.data.checks.find((c) => c.key === 'point_of_sale')
    expect(pos).toMatchObject({ ok: true, tone: 'ok' })
    expect(pos?.message).toContain('En homologación ARCA no lista los puntos de venta')
  })

  it('producción: un punto de venta que ARCA no tiene corta en el chequeo 4 y lleva al paso 2', async () => {
    setConnections(connRow({ status: 'cert_ready' }))
    transport.routes['wsfe:FEParamGetPtosVenta'] = fixtureResponse(ARCA_XML.wsfePtosVenta602)
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(state.data.status).toBe('error')
    expect(keysOf(state.data)).toEqual(['service', 'wsfe_ticket', 'relations', 'point_of_sale'])
    expect(state.data.notRun.map((c) => c.key)).toEqual(['numbering', 'padron', 'certificate'])
    expect(state.data.firstProblem).toMatchObject({
      key: 'point_of_sale',
      errorKey: 'arca_pos_not_enabled',
      step: 's2_punto_venta',
      tone: 'error',
    })
    expect(state.data.firstProblem?.message).toContain('El punto de venta 0005 no está habilitado')
    expect(state.message).toBe(
      'La prueba encontró un problema: El punto de venta no es de web services.',
    )
    expect(connection('produccion')?.last_error_key).toBe('arca_pos_not_enabled')
  })

  it('un punto de venta bloqueado, dado de baja o de CAEA dice cuál es el problema', async () => {
    for (const [pv, errorKey, text] of [
      [9, 'arca_pos_blocked', 'regularizalo'],
      [11, 'arca_pos_not_enabled', 'dado de baja'],
      [7, 'arca_pos_not_enabled', 'CAEA'],
    ] as const) {
      _resetRateLimit()
      setConnections(connRow({ status: 'cert_ready', point_of_sale: pv }))
      const state = await testArcaConnection(SLUG, { environment: 'produccion' })
      expect(state.ok).toBe(true)
      if (!state.ok) continue
      expect(state.data.firstProblem?.errorKey).toBe(errorKey)
      expect(state.data.firstProblem?.message).toContain(text)
      expect(state.data.firstProblem?.step).toBe('s2_punto_venta')
    }
  })

  it('sin punto de venta guardado, pide el paso 2', async () => {
    setConnections(connRow({ status: 'cert_ready', point_of_sale: null }))
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state.ok && state.data.firstProblem).toMatchObject({
      key: 'point_of_sale',
      title: 'Falta el punto de venta',
      step: 's2_punto_venta',
    })
  })

  it('certificado no autorizado: corta en el chequeo 2, lleva al paso 7 y deja cooldown manual', async () => {
    setConnections(connRow({ status: 'cert_ready' }))
    transport.routes.wsaa = () => wsaaFault('notAuthorized')
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(keysOf(state.data)).toEqual(['service', 'wsfe_ticket'])
    expect(state.data.firstProblem).toMatchObject({
      errorKey: 'arca_not_authorized',
      step: 's7_wsfe',
      code: 'coe.notAuthorized',
    })
    expect(state.data.firstProblem?.message).toContain('«hubplataforma»')
    expect(db.callsTo('acc_arca_ticket_put')[0]?.p_result).toEqual({
      ok: false,
      key: 'arca_not_authorized',
      cooldown: 'manual',
    })
  })

  it('la SAS no está en el permiso del certificado: chequeo 3, paso 7', async () => {
    setConnections(connRow({ status: 'cert_ready' }))
    transport.routes.wsaa = () => loginResponse(new Date(), { token: ssoToken([PERSON_CUIT]) })
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(keysOf(state.data)).toEqual(['service', 'wsfe_ticket', 'relations'])
    expect(state.data.firstProblem).toMatchObject({
      key: 'relations',
      errorKey: 'arca_cuit_not_in_token',
      step: 's7_wsfe',
    })
    expect(state.data.firstProblem?.message).toContain('Bar de Prueba SAS')
    // No se guarda la lista de CUIT del token (pueden ser de personas).
    const saved = db.callsTo('acc_arca_record_test')[0]?.p_result as { checks: CheckArg[] }
    expect(JSON.stringify(saved)).not.toContain(PERSON_CUIT)
    // Ese ticket nunca va a servir para la SAS: se descarta (solo el de wsfe).
    expect(db.callsTo('acc_arca_ticket_drop')).toEqual([
      { p_tenant_id: TENANT, p_environment: 'produccion', p_service: 'wsfe' },
    ])
    expect(saved.checks.find((c) => c.key === 'relations')?.detail).toEqual({
      listed: false,
      ticket_dropped: true,
    })
    expect(state.message).toBe(
      'La prueba encontró un problema: La SAS no está en el permiso. ARCA rechazó el permiso guardado y ya lo descartamos. Esperá unos minutos y volvé a probar.',
    )
  })

  it('autorizado a nombre de la persona: después de arreglarlo en ARCA, la prueba pide otro ticket', async () => {
    // El caso real del paso 7: el permiso salió sin la SAS. Primera prueba: falla y descarta.
    setConnections(connRow({ status: 'cert_ready' }))
    transport.routes.wsaa = () => loginResponse(new Date(), { token: ssoToken([PERSON_CUIT]) })
    const first = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(first.ok && first.data.firstProblem?.errorKey).toBe('arca_cuit_not_in_token')
    expect(db.tickets.get('produccion:wsfe')?.token).toBeNull()

    // La persona lo arregla en ARCA y vuelve a probar: login nuevo, ahora con la SAS.
    transport.routes.wsaa = () => loginResponse(new Date(), { token: ssoToken([SAS_CUIT]) })
    const second = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(second.ok && second.data.status).toBe('connected')
    expect(
      transport.calls.filter((c) => c.service === 'wsaa' && c.wsn === 'wsfe').map((c) => c.method),
    ).toEqual(['loginCms', 'loginCms'])
    expect(second.ok && second.data.checks.find((c) => c.key === 'wsfe_ticket')?.ok).toBe(true)
  })

  it('sin la RPC de descarte (migración sin aplicar) todo sigue como antes y el texto no promete nada', async () => {
    db.others.set('acc_arca_ticket_drop', () => ({
      data: null,
      error: {
        message: 'Could not find the function public.acc_arca_ticket_drop',
        code: 'PGRST202',
      },
    }))
    setConnections(connRow({ status: 'cert_ready' }))
    transport.routes.wsaa = () => loginResponse(new Date(), { token: ssoToken([PERSON_CUIT]) })
    const first = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.message).toBe('La prueba encontró un problema: La SAS no está en el permiso.')
    const saved = db.callsTo('acc_arca_record_test')[0]?.p_result as { checks: CheckArg[] }
    expect(saved.checks.find((c) => c.key === 'relations')?.detail).toEqual({ listed: false })
    // El ticket quedó (como hoy): la segunda prueba lo reusa, sin login.
    _resetRateLimit()
    await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(transport.calls.filter((c) => c.service === 'wsaa')).toHaveLength(1)
    // `function_unavailable` es esperable hasta aplicar la migración: no ensucia el log.
    expect(logs.filter((l) => l.includes('drop'))).toEqual([])
  })

  it('numeración con Err 600 (token): descarta el ticket de wsfe y no pide la otra letra', async () => {
    setConnections(connRow({ status: 'cert_ready', allowed_classes: ['A', 'B'] }))
    transport.routes['wsfe:FECompUltimoAutorizado'] = fixtureResponse(ARCA_XML.wsfeUltimoErr600)
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(state.data.status).toBe('connected')
    const numbering = state.data.checks.find((c) => c.key === 'numbering')
    expect(numbering).toMatchObject({ ok: false, errorKey: 'arca_token_rejected', code: '600' })
    expect(ultimoTipos(transport)).toEqual([6])
    expect(db.callsTo('acc_arca_ticket_drop').map((a) => a.p_service)).toEqual(['wsfe'])
    // El padrón tiene su propio ticket: no se toca.
    expect(db.tickets.get('produccion:ws_sr_constancia_inscripcion')?.token).toBe(FIXTURE_TOKEN)
    const saved = db.callsTo('acc_arca_record_test')[0]?.p_result as { checks: CheckArg[] }
    expect(saved.checks.find((c) => c.key === 'numbering')?.detail).toMatchObject({
      code: '600',
      ticket_dropped: true,
    })
  })

  it('si el token no se puede leer, decide WSFE (600: la SAS no está en la lista)', async () => {
    setConnections(connRow({ status: 'cert_ready' }))
    const unreadable = Buffer.from('no-es-un-sso').toString('base64')
    transport.routes.wsaa = () => loginResponse(new Date(), { token: unreadable })
    const okState = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(okState.ok && okState.data.status).toBe('connected')
    const saved = db.callsTo('acc_arca_record_test')[0]?.p_result as { checks: CheckArg[] }
    expect(saved.checks.find((c) => c.key === 'relations')).toEqual({
      key: 'relations',
      ok: true,
      detail: { listed: null, confirmed_by: 'wsfe' },
    })

    _resetRateLimit()
    setConnections(connRow({ status: 'cert_ready' }))
    db = new FakeTicketDb(() => new Date(), { privateKeyPem: KEY, certificatePem: CERT })
    installHandlers()
    transport.routes['wsfe:FEParamGetPtosVenta'] = () => ({
      status: 200,
      body:
        '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
        '<FEParamGetPtosVentaResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEParamGetPtosVentaResult><Errors><Err><Code>600</Code>' +
        `<Msg>ValidacionDeToken: No aparecio CUIT en lista de relaciones: ${SAS_CUIT}</Msg></Err></Errors>` +
        '</FEParamGetPtosVentaResult></FEParamGetPtosVentaResponse></soap:Body></soap:Envelope>',
    })
    const failed = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(failed.ok).toBe(true)
    if (!failed.ok) return
    expect(keysOf(failed.data)).toEqual(['service', 'wsfe_ticket', 'relations'])
    expect(failed.data.firstProblem).toMatchObject({
      errorKey: 'arca_cuit_not_in_token',
      code: '600',
    })
    // WSFE rechazó el ticket guardado: se descarta (la próxima prueba pide otro) y se avisa.
    expect(db.callsTo('acc_arca_ticket_drop').map((a) => a.p_service)).toEqual(['wsfe'])
    expect(db.tickets.get('produccion:wsfe')?.token).toBeNull()
    const savedFail = db.callsTo('acc_arca_record_test')[0]?.p_result as { checks: CheckArg[] }
    expect(savedFail.checks.find((c) => c.key === 'relations')?.detail).toEqual({
      listed: null,
      code: '600',
      ticket_dropped: true,
    })
    expect(failed.message).toContain('ARCA rechazó el permiso guardado y ya lo descartamos.')
  })

  it('falta autorizar el padrón: el chequeo 6 lleva al paso 8 y no queda conectado', async () => {
    setConnections(connRow({ status: 'cert_ready' }))
    transport.routes['wsaa:ws_sr_constancia_inscripcion'] = () => wsaaFault('notAuthorized')
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(state.data.status).toBe('error')
    expect(keysOf(state.data)).toEqual([
      'service',
      'wsfe_ticket',
      'relations',
      'point_of_sale',
      'numbering',
      'padron',
      'certificate',
    ])
    const padron = state.data.checks.find((c) => c.key === 'padron')
    expect(padron).toMatchObject({ ok: false, errorKey: 'arca_not_authorized', step: 's8_padron' })
    expect(padron?.message).toContain('paso 8')
    expect(padron?.title).toBe('Falta autorizar la consulta del padrón')
  })

  it('el certificado vence en menos de 30 días: aviso, pero sigue conectado', async () => {
    const soon = new Date(START.getTime() + 20 * DAY).toISOString()
    setConnections(connRow({ status: 'cert_ready', cert_not_after: soon }))
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(state.data.status).toBe('connected')
    expect(state.data.checks.find((c) => c.key === 'certificate')).toMatchObject({
      ok: false,
      tone: 'warning',
      errorKey: null,
      step: 's6_certificado',
    })
    expect(state.message).toBe('¡Listo! ARCA quedó conectado. Revisá los avisos.')
  })

  it('ARCA caído: un solo chequeo, «probá en unos minutos»', async () => {
    setConnections(connRow({ status: 'cert_ready' }))
    transport.routes['wsfe:FEDummy'] = () => ({
      status: 200,
      body:
        '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
        '<FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult><AppServer>OK</AppServer><DbServer>NO</DbServer>' +
        '<AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse></soap:Body></soap:Envelope>',
    })
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(keysOf(state.data)).toEqual(['service'])
    expect(state.data.firstProblem).toMatchObject({ errorKey: 'arca_unavailable', step: null })
    expect(state.data.firstProblem?.message).toContain('probá de nuevo en unos minutos')
  })

  it('sin certificado no se prueba (arca_not_ready) ni se llama a ARCA', async () => {
    setConnections(connRow({ status: 'key_ready', cert_not_after: null }))
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state).toMatchObject({ ok: false, detail: { key: 'arca_not_ready' } })
    expect(transport.calls).toHaveLength(0)
  })

  it('si la clave del servidor no abre lo guardado, corta sin guardar una prueba falsa', async () => {
    setConnections(connRow({ status: 'connected' }))
    db.ticketGetError = { message: 'secret_unreadable', code: 'P0001' }
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state).toMatchObject({
      ok: false,
      code: 'error',
      message: ACC_ERRORS.secret_unreadable.message,
    })
    expect(db.callsTo('acc_arca_record_test')).toHaveLength(0)
    expect(connection('produccion')?.status).toBe('connected')
  })

  it('ARCA lento: el plazo de 50 s corre desde el pedido y el login del padrón no se empieza sin tiempo', async () => {
    setConnections(connRow({ status: 'cert_ready' }))
    // Cada llamada a ARCA tarda 9 s del reloj (falso) del sistema.
    vi.mocked(getTransport).mockImplementation(() => async (req) => {
      vi.setSystemTime(new Date(Date.now() + 9_000))
      return transport(req)
    })
    const state = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(state.ok).toBe(true)
    if (!state.ok) return
    // 9 (dummy) + 9 (login wsfe) + 9 (puntos de venta) + 9 (numeración) + 9 (dummy del padrón)
    // = 45 s: quedan 5 s y el login del padrón no se empieza.
    expect(Date.now() - START.getTime()).toBe(45_000)
    expect(state.data.status).toBe('error')
    expect(state.data.firstProblem).toMatchObject({ key: 'padron', errorKey: 'arca_unavailable' })
    expect(state.message).toBe(
      'No se llegó a probar todo: ARCA venía lento y cortamos la prueba a tiempo para no trabar la conexión. Volvé a tocar «Probar conexión».',
    )
    expect(transport.calls.filter((c) => c.service === 'wsaa').map((c) => c.wsn)).toEqual(['wsfe'])
    const saved = db.callsTo('acc_arca_record_test')[0]?.p_result as { checks: CheckArg[] }
    expect(saved.checks.find((c) => c.key === 'padron')).toEqual({
      key: 'padron',
      ok: false,
      error: 'arca_unavailable',
      detail: { timeout: true, not_started: true },
    })
    // Sin cooldown: la próxima prueba (con un ARCA normal) hace el login del padrón enseguida.
    expect(db.callsTo('acc_arca_ticket_put').at(-1)?.p_result).toEqual({
      ok: false,
      key: 'arca_unavailable',
      cooldown: null,
    })
    vi.mocked(getTransport).mockImplementation(() => transport)
    const again = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(again.ok && again.data.status).toBe('connected')
  })

  it('no deja probar más de 10 veces por minuto', async () => {
    setConnections(connRow({ status: 'key_ready', cert_not_after: null }))
    for (let i = 0; i < 10; i++) {
      const state = await testArcaConnection(SLUG, { environment: 'produccion' })
      expect(state).toMatchObject({ ok: false, detail: { key: 'arca_not_ready' } })
    }
    const limited = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(limited).toMatchObject({ ok: false, detail: { key: 'rate_limited' } })
  })
})

describe('runConnectionTest (casos de borde)', () => {
  const base = (over: Partial<Parameters<typeof runConnectionTest>[0]> = {}) => {
    const session = createArcaSession({
      rpc: db.rpc,
      tenantId: TENANT,
      environment: 'produccion',
      representedCuit: SAS_CUIT,
      secretKey: SECRET,
      transport,
      sleep: async () => {},
    })
    return runConnectionTest({
      session,
      environment: 'produccion',
      representedCuit: SAS_CUIT,
      pointOfSale: 5,
      allowedClasses: ['B'],
      certNotAfter: new Date('2028-09-10T00:00:00.000Z'),
      sasLegalName: 'Bar de Prueba SAS',
      ...over,
    })
  }

  it('con el plazo vencido, lo que falta queda «no se llegó a probar» y no se corre', async () => {
    // El reloj de la prueba avanza 20 s cada vez que se lo mira: el plazo (50 s) se acaba
    // después del ticket (se mira al armarlo y antes de cada chequeo que va a ARCA).
    let t = START.getTime()
    const clock = () => {
      t += 20_000
      return new Date(t)
    }
    const run = await base({ now: clock, deadline: arcaDeadline(50_000, clock) })
    expect(run.status).toBe('error')
    expect(run.checks.map((c) => [c.key, c.ok, c.error ?? null])).toEqual([
      ['service', true, null],
      ['wsfe_ticket', true, null],
      ['relations', true, null],
      ['point_of_sale', false, 'arca_unavailable'],
    ])
    expect(run.checks.at(-1)?.detail).toEqual({ timeout: true, not_started: true })
    // No se llegó a preguntar los puntos de venta.
    expect(transport.calls.map((c) => c.method)).not.toContain('FEParamGetPtosVenta')
  })

  it('una SAS inactiva en el padrón no deja conectar en producción', async () => {
    const ri = arcaXml(ARCA_XML.padronPersonaRi).replace(
      '<estadoClave>ACTIVO</estadoClave>',
      '<estadoClave>INACTIVO</estadoClave>',
    )
    transport.routes['padron:getPersona_v2'] = () => ({ status: 200, body: ri })
    const run = await base()
    const padron = run.checks.find((c) => c.key === 'padron')
    expect(padron).toMatchObject({ ok: false, error: 'arca_issuer_problem' })
    expect(padron?.detail).toMatchObject({ active: false })
    expect(run.status).toBe('error')
  })

  it('el padrón de homologación sin los datos de la SAS no es una falla', async () => {
    transport.routes['padron:getPersona_v2'] = fixtureResponse(ARCA_XML.padronPersonaNoExiste)
    const run = await base({ environment: 'homologacion' })
    expect(run.checks.find((c) => c.key === 'padron')).toEqual({
      key: 'padron',
      ok: true,
      detail: { found: false },
    })
  })

  it('la razón social se compara sin puntos, mayúsculas ni tildes', () => {
    expect(sameLegalName('HUB COFFEE & BAR S.A.S.', 'Hub Coffee & Bar SAS')).toBe(true)
    expect(sameLegalName('CAFÉ DEL SUR SAS', 'Cafe del Sur S.A.S.')).toBe(true)
    expect(sameLegalName('OTRA SAS', 'Bar de Prueba SAS')).toBe(false)
    expect(sameLegalName(null, 'Bar de Prueba SAS')).toBe(null)
  })
})

// ─── Desconectar y guía ──────────────────────────────────────────────────────

describe('disconnectArca y markGuideStep', () => {
  it('desconectar exige DESCONECTAR tal cual', async () => {
    const bad = await disconnectArca(SLUG, { environment: 'produccion', confirm: 'desconectar' })
    expect(bad).toMatchObject({
      ok: false,
      code: 'invalid',
      message: 'Para confirmar, escribí DESCONECTAR tal cual.',
    })
    expect(db.callsTo('acc_arca_disconnect')).toHaveLength(0)

    const done = await disconnectArca(SLUG, { environment: 'produccion', confirm: 'DESCONECTAR' })
    expect(done).toMatchObject({ ok: true, data: { environment: 'produccion' } })
    expect(db.callsTo('acc_arca_disconnect')).toEqual([
      { p_tenant_id: TENANT, p_environment: 'produccion', p_confirm: 'DESCONECTAR' },
    ])
  })

  it('con una emisión en curso la base no deja desconectar', async () => {
    db.others.set('acc_arca_disconnect', () => fail('arca_voucher_in_flight'))
    const state = await disconnectArca(SLUG, { environment: 'produccion', confirm: 'DESCONECTAR' })
    expect(state).toMatchObject({
      ok: false,
      message: ACC_ERRORS.arca_voucher_in_flight.message,
    })
  })

  it('marca un paso manual de la guía (y rechaza los que no existen)', async () => {
    const bad = await markGuideStep(SLUG, { guide: 'arca', step: 's99_inventado', done: true })
    expect(bad).toMatchObject({ ok: false, code: 'invalid' })
    expect(db.callsTo('acc_guide_mark')).toHaveLength(0)

    const fd = new FormData()
    fd.set('guide', 'arca')
    fd.set('step', 's1_elegir_sas')
    fd.set('done', 'on')
    expect(await markGuideStep(SLUG, fd)).toMatchObject({
      ok: true,
      data: { guide: 'arca', step: 's1_elegir_sas', done: true },
    })
    await markGuideStep(SLUG, { guide: 'arranque', step: 'datos_sas', done: false })
    expect(db.callsTo('acc_guide_mark')).toEqual([
      { p_tenant_id: TENANT, p_guide: 'arca', p_step: 's1_elegir_sas', p_done: true },
      { p_tenant_id: TENANT, p_guide: 'arranque', p_step: 'datos_sas', p_done: false },
    ])
  })
})

// ─── «Completar con ARCA» ────────────────────────────────────────────────────

describe('lookupCuit («Completar con ARCA»)', () => {
  const MONO = XML_CUITS.monotributista

  it('sin ARCA conectado: arca_not_connected (la pantalla muestra el link a la guía)', async () => {
    setConnections(connRow({ status: 'cert_ready' }))
    const result = await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })
    expect(result).toMatchObject({ ok: false, code: 'arca_not_connected' })
    expect(transport.calls).toHaveLength(0)
  })

  it('sin caché: consulta ARCA, guarda la constancia y devuelve los datos para el alta', async () => {
    setConnections(connRow())
    transport.routes['padron:getPersona_v2'] = fixtureResponse(ARCA_XML.padronPersonaMonotributo)
    const result = await lookupCuit(SLUG, { cuit: '27-12345678-0', purpose: 'supplier' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({
      cuit: MONO,
      ivaCondition: 'monotributo',
      condicionIvaReceptorId: 6,
      source: 'arca',
      environment: 'produccion',
      testData: false,
      fetchedAt: START.toISOString(),
    })
    expect(result.data.warnings.map((w) => w.key)).toContain('monotributo')
    const lookup = parsePersona(arcaXml(ARCA_XML.padronPersonaMonotributo))
    expect(db.callsTo('acc_arca_padron_cache_put')).toEqual([
      { p_tenant_id: TENANT, p_environment: 'produccion', p_rows: [padronCacheRow(lookup, MONO)] },
    ])
    // Con el ticket del padrón (login bajo el lease).
    expect(transport.calls.map((c) => `${c.service}:${c.method}`)).toEqual([
      'wsaa:loginCms',
      'padron:getPersona_v2',
    ])
  })

  it('con la caché fresca no va a ARCA; vieja (más de 30 días), vuelve a consultar', async () => {
    setConnections(connRow())
    const lookup = parsePersona(arcaXml(ARCA_XML.padronPersonaMonotributo))
    const row = padronCacheRow(lookup, MONO)
    tables.acc_arca_padron_cache = [
      {
        tenant_id: TENANT,
        environment: 'produccion',
        cuit: MONO,
        found: true,
        data: row.data,
        fetched_at: new Date(START.getTime() - 5 * DAY).toISOString(),
      },
    ]
    const cached = await lookupCuit(SLUG, { cuit: MONO, purpose: 'customer' })
    expect(cached).toMatchObject({
      ok: true,
      data: { source: 'cache', ivaCondition: 'monotributo' },
    })
    expect(transport.calls).toHaveLength(0)

    const entry = tables.acc_arca_padron_cache[0]
    if (entry) entry.fetched_at = new Date(START.getTime() - 31 * DAY).toISOString()
    transport.routes['padron:getPersona_v2'] = fixtureResponse(ARCA_XML.padronPersonaMonotributo)
    const fresh = await lookupCuit(SLUG, { cuit: MONO, purpose: 'customer' })
    expect(fresh).toMatchObject({ ok: true, data: { source: 'arca' } })
  })

  it('una CUIT que ARCA no conoce: not_found (y queda en la caché)', async () => {
    setConnections(connRow())
    transport.routes['padron:getPersona_v2'] = fixtureResponse(ARCA_XML.padronPersonaNoExiste)
    const result = await lookupCuit(SLUG, { cuit: XML_CUITS.noExiste, purpose: 'supplier' })
    expect(result).toMatchObject({
      ok: false,
      code: 'not_found',
      message: 'ARCA no encontró esa CUIT. Revisá los números.',
    })
    expect(tables.acc_arca_padron_cache?.[0]).toMatchObject({
      cuit: XML_CUITS.noExiste,
      found: false,
    })
  })

  it('solo con homologación conectada: datos de prueba', async () => {
    setConnections(connRow({ environment: 'homologacion' }))
    transport.routes['padron:getPersona_v2'] = fixtureResponse(ARCA_XML.padronPersonaMonotributo)
    const result = await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })
    expect(result).toMatchObject({
      ok: true,
      data: { testData: true, environment: 'homologacion' },
    })
    expect(result.ok && result.data.warnings.map((w) => w.key)).toContain('test_data')
  })

  it('producción con un problema en otro chequeo pero el padrón bien: se usa', async () => {
    setConnections(
      connRow({ status: 'error', services: { wsfe: 'ok', ws_sr_constancia_inscripcion: 'ok' } }),
    )
    transport.routes['padron:getPersona_v2'] = fixtureResponse(ARCA_XML.padronPersonaMonotributo)
    expect(await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })).toMatchObject({
      ok: true,
      data: { environment: 'produccion' },
    })
  })

  it('falta autorizar el padrón: arca_not_authorized con el paso 8', async () => {
    setConnections(connRow())
    transport.routes['wsaa:ws_sr_constancia_inscripcion'] = () => wsaaFault('notAuthorized')
    const result = await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })
    expect(result).toMatchObject({ ok: false, code: 'arca_not_authorized', step: 's8_padron' })
    expect(result.ok ? '' : result.message).toContain('paso 8')
    // Un login que el WSAA rechaza no es un ticket rechazado: no hay nada que descartar.
    expect(db.callsTo('acc_arca_ticket_drop')).toEqual([])
  })

  it('el padrón rechaza el ticket guardado: se descarta (solo el del padrón) y pide esperar', async () => {
    setConnections(connRow())
    db.storeValid('produccion', 'wsfe', FIXTURE_TOKEN, new Date(START.getTime() + 6 * 3_600_000))
    db.storeValid(
      'produccion',
      'ws_sr_constancia_inscripcion',
      FIXTURE_TOKEN,
      new Date(START.getTime() + 6 * 3_600_000),
    )
    transport.routes['padron:getPersona_v2'] = fixtureResponse(ARCA_XML.padronFaultToken, 500)
    const result = await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })
    expect(result).toEqual({
      ok: false,
      code: 'arca_unavailable',
      message: 'ARCA rechazó el permiso guardado. Esperá unos minutos y volvé a probar.',
      step: null,
    })
    expect(db.callsTo('acc_arca_ticket_drop')).toEqual([
      {
        p_tenant_id: TENANT,
        p_environment: 'produccion',
        p_service: 'ws_sr_constancia_inscripcion',
      },
    ])
    expect(db.tickets.get('produccion:ws_sr_constancia_inscripcion')?.token).toBeNull()
    expect(db.tickets.get('produccion:wsfe')?.token).toBe(FIXTURE_TOKEN)

    // La próxima consulta pide un ticket nuevo (login) en vez de reusar el rechazado.
    transport.routes['padron:getPersona_v2'] = fixtureResponse(ARCA_XML.padronPersonaMonotributo)
    expect(await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })).toMatchObject({ ok: true })
    expect(transport.calls.filter((c) => c.service === 'wsaa').map((c) => c.wsn)).toEqual([
      'ws_sr_constancia_inscripcion',
    ])
  })

  it('sin la RPC de descarte, el padrón con el ticket rechazado da el texto de siempre', async () => {
    db.others.set('acc_arca_ticket_drop', () => ({
      data: null,
      error: { message: 'Could not find the function', code: 'PGRST202' },
    }))
    setConnections(connRow())
    transport.routes['padron:getPersona_v2'] = fixtureResponse(ARCA_XML.padronFaultToken, 500)
    const result = await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })
    expect(result).toMatchObject({ ok: false, code: 'error', step: 's9_probar' })
    expect(result.ok ? '' : result.message).toBe(ARCA_ERRORS.arca_token_rejected.body)
  })

  it('CUIT inválida y tope de 30 consultas por minuto', async () => {
    expect(await lookupCuit(SLUG, { cuit: '20-12345678-0', purpose: 'supplier' })).toMatchObject({
      ok: false,
      code: 'invalid_cuit',
      message: 'El CUIT no es válido: revisá el último número.',
    })
    setConnections(connRow({ status: 'cert_ready' }))
    for (let i = 0; i < 30; i++) {
      expect((await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })).ok).toBe(false)
    }
    expect(await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })).toMatchObject({
      ok: false,
      code: 'rate_limited',
    })
  })

  it('sin permiso: forbidden', async () => {
    vi.mocked(authorizeAccounting).mockResolvedValue({
      ok: false,
      state: { ok: false, code: 'forbidden', message: 'No tenés permiso.' },
    })
    expect(await lookupCuit(SLUG, { cuit: MONO, purpose: 'supplier' })).toMatchObject({
      ok: false,
      code: 'forbidden',
    })
  })
})

// ─── Lecturas ────────────────────────────────────────────────────────────────

describe('fetchArcaOverview (pestaña ARCA y guía)', () => {
  it('arma las conexiones, la guía y el padrón sin secretos ni PEM', async () => {
    setConnections(connRow({ status: 'cert_ready' }))
    const tested = await testArcaConnection(SLUG, { environment: 'produccion' })
    expect(tested.ok).toBe(true)
    tables.acc_arca_connections?.push(
      connRow({
        id: '00000000-0000-4000-8000-0000000000c2',
        environment: 'homologacion',
        status: 'key_ready',
        cert_cuit: PERSON_CUIT,
        certificate_pem: null,
        cert_not_after: null,
        cert_serial: null,
      }),
    )
    tables.acc_guide_progress = [
      {
        tenant_id: TENANT,
        guide: 'arca',
        step: 's10_mis_comprobantes',
        done_at: START.toISOString(),
        done_by_name: 'Nacho',
      },
    ]

    const result = await fetchArcaOverview(SLUG)
    expect(authorizeAccounting).toHaveBeenLastCalledWith(SLUG, 'read')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const overview = result.data
    expect(overview.sas).toEqual({ legalName: 'Bar de Prueba SAS', cuit: SAS_CUIT })
    expect(overview.connections.produccion).toMatchObject({
      status: 'connected',
      statusLabel: 'Conectado',
      hasCsr: true,
      csrFileName: 'arca-hubplataforma.csr',
      pointOfSale: 5,
      certificate: { serial: '8F3A5C7E9B1D2F40', expired: false, renewSoon: false },
      lastTest: { status: 'connected' },
      lastError: null,
    })
    expect(overview.connections.produccion?.lastTest?.checks).toHaveLength(7)
    expect(overview.connections.homologacion).toMatchObject({
      status: 'key_ready',
      certificate: null,
      lastTest: null,
    })
    expect(overview.guide.produccion.summary).toEqual({ done: 9, total: 9, next: null })
    expect(overview.guide.homologacion.summary.next).toBe('s0_prereq')
    const s10 = overview.guide.produccion.steps.find((s) => s.id === 's10_mis_comprobantes')
    expect(s10).toMatchObject({ status: 'done', source: 'manual', doneBy: 'Nacho' })
    expect(overview.lookup).toEqual({ environment: 'produccion', testData: false })
    expect(overview.attention).toEqual([])

    const json = JSON.stringify(overview)
    expect(json).not.toContain('BEGIN')
    expect(json).not.toContain(KEY_HASH)
    expectNoSecrets(json)
  })
})

describe('fetchArcaOverview (problemas en palabras simples)', () => {
  it('una prueba que falló marca el paso de la guía con su texto, y la conexión con su problema', async () => {
    setConnections(connRow({ status: 'cert_ready' }))
    transport.routes['wsfe:FEParamGetPtosVenta'] = fixtureResponse(ARCA_XML.wsfePtosVenta602)
    await testArcaConnection(SLUG, { environment: 'produccion' })

    const result = await fetchArcaOverview(SLUG)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const prod = result.data.connections.produccion
    expect(prod).toMatchObject({
      status: 'error',
      statusLabel: 'Con un problema',
      lastError: { key: 'arca_pos_not_enabled', step: 's2_punto_venta' },
    })
    expect(prod?.lastError?.body).toContain('El punto de venta 0005 no está habilitado')
    const s2 = result.data.guide.produccion.steps.find((st) => st.id === 's2_punto_venta')
    expect(s2).toMatchObject({
      status: 'failed',
      reason: 'arca_pos_not_enabled',
      problem: { title: 'El punto de venta no es de web services', step: 's2_punto_venta' },
    })
    expect(result.data.guide.produccion.summary.next).toBe('s2_punto_venta')
    // Sin conexión conectada no se puede completar con ARCA.
    expect(result.data.lookup).toEqual({ environment: null, testData: false })
  })

  it('un certificado vencido marca el paso 6 y el aviso de la conexión', async () => {
    setConnections(connRow({ cert_not_after: '2026-10-01T00:00:00+00:00' }))
    const result = await fetchArcaOverview(SLUG)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.connections.produccion?.certificate).toMatchObject({
      expired: true,
      renewSoon: false,
    })
    const s6 = result.data.guide.produccion.steps.find((st) => st.id === 's6_certificado')
    expect(s6).toMatchObject({
      status: 'failed',
      reason: 'cert_expired',
      problem: { title: 'El certificado venció', step: 's6_certificado' },
    })
  })
})

describe('contrato con las RPC de las migraciones', () => {
  it('las migraciones definen todas las RPC que usa ARCA (cada test valida sus llamadas)', () => {
    for (const fn of [
      'acc_arca_store_keypair',
      'acc_arca_save_certificate',
      'acc_arca_save_connection',
      'acc_arca_get_credentials',
      'acc_arca_ticket_get',
      'acc_arca_ticket_put',
      'acc_arca_record_test',
      'acc_arca_disconnect',
      'acc_arca_padron_cache_put',
      'acc_guide_mark',
      'acc_save_sales_point',
      'acc_arca_ticket_drop',
    ]) {
      expect(SIGNATURES.has(fn), fn).toBe(true)
    }
    expect([...(SIGNATURES.get('acc_arca_ticket_get')?.required ?? [])]).toEqual([
      'p_tenant_id',
      'p_environment',
      'p_service',
      'p_secret_key',
    ])
    // El descarte no recibe la clave del servidor: no descifra nada.
    expect([...(SIGNATURES.get('acc_arca_ticket_drop')?.all ?? [])]).toEqual([
      'p_tenant_id',
      'p_environment',
      'p_service',
    ])
  })
})
