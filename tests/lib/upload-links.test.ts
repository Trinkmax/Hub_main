import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUploadLink } from '@/lib/accounting/actions/upload-links'

/**
 * El link de subida por QR: quién lo puede abrir, qué firma y qué guarda. Todo con la sesión de quien
 * carga: si este archivo llegara a tocar `service_role`, el mock de abajo lo hace saltar.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
  sign: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/accounting/access', () => ({ authorizeAccounting: mocks.auth }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: async () => 'https://hubbar.com.ar' }))
vi.mock('@/lib/qr', () => ({ renderQrSvg: async (url: string) => `<svg data-url="${url}"></svg>` }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: (path: string) => mocks.sign(bucket, path),
        remove: (paths: string[]) => mocks.remove(bucket, paths),
      }),
    },
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('La foto por QR no usa service_role')
  },
}))
// `revalidatePath` no hace falta: abrir un link no cambia nada de lo que se ve.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const TENANT = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ ok: true, tenantId: TENANT, userId: 'u', slug: 'hub' })
  mocks.sign.mockImplementation(async (_bucket: string, path: string) => ({
    data: { token: `firma-${path.slice(-8)}`, path, signedUrl: 'https://x' },
    error: null,
  }))
  mocks.rpc.mockResolvedValue({ data: { id: 'x', stale_paths: [] }, error: null })
  mocks.remove.mockResolvedValue({ data: [], error: null })
})

describe('createUploadLink', () => {
  it('sin permiso de escritura no firma ni guarda nada', async () => {
    const denied = { ok: false, code: 'forbidden', message: 'No tenés acceso.' }
    mocks.auth.mockResolvedValue({ ok: false, state: denied })
    expect(await createUploadLink('hub')).toEqual(denied)
    expect(mocks.auth).toHaveBeenCalledWith('hub', 'write')
    expect(mocks.sign).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('firma cinco rutas de ese bar, con la forma que acepta la política de subida', async () => {
    const result = await createUploadLink('hub')
    expect(result.ok).toBe(true)
    expect(mocks.sign).toHaveBeenCalledTimes(5)
    expect(mocks.rpc.mock.calls[0]?.[0]).toBe('acc_upload_link_create')
    const payload = mocks.rpc.mock.calls[0]?.[1] as {
      p_tenant_id: string
      p_link_id: string
      p_slots: Array<{ path: string; token: string }>
    }
    expect(payload.p_tenant_id).toBe(TENANT)
    expect(payload.p_slots).toHaveLength(5)
    const shape = new RegExp(
      `^${TENANT}/${payload.p_link_id}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`,
    )
    for (const slot of payload.p_slots) {
      expect(slot.path).toMatch(shape)
      expect(slot.token).toContain('firma-')
    }
    expect(new Set(payload.p_slots.map((slot) => slot.path)).size).toBe(5)
    for (const call of mocks.sign.mock.calls) expect(call[0]).toBe('acc-comprobantes')
  })

  it('en la base queda el hash del token; el token va solo en el QR', async () => {
    const result = await createUploadLink('hub')
    if (!result.ok) throw new Error(result.message)
    const token = result.data.url.split('/subir/')[1] ?? ''
    // 32 bytes en base64url: la base acepta de 32 a 128 caracteres.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const payload = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload.p_token_hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
    expect(JSON.stringify(payload)).not.toContain(token)
    expect(result.data.url).toBe(`https://hubbar.com.ar/subir/${token}`)
    expect(result.data.qrSvg).toContain(result.data.url)
  })

  it('dos links nunca comparten token', async () => {
    const a = await createUploadLink('hub')
    const b = await createUploadLink('hub')
    if (!a.ok || !b.ok) throw new Error('no abrió')
    expect(a.data.url).not.toBe(b.data.url)
    expect(a.data.linkId).not.toBe(b.data.linkId)
  })

  it('vence en 30 minutos: lo que acepta la base', async () => {
    const before = Date.now()
    const result = await createUploadLink('hub')
    if (!result.ok) throw new Error(result.message)
    const expires = Date.parse(result.data.expiresAt)
    expect(expires - before).toBeGreaterThanOrEqual(30 * 60_000 - 1000)
    expect(expires - before).toBeLessThanOrEqual(30 * 60_000 + 5000)
    const payload = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload.p_expires_at).toBe(result.data.expiresAt)
    expect(result.data.tenantId).toBe(TENANT)
  })

  it('borra lo que dejaron los links vencidos', async () => {
    const stale = [`${TENANT}/viejo/uno.jpg`, `${TENANT}/viejo/dos.jpg`]
    mocks.rpc.mockResolvedValue({ data: { id: 'x', stale_paths: stale }, error: null })
    await createUploadLink('hub')
    expect(mocks.remove).toHaveBeenCalledWith('acc-comprobantes', stale)
  })

  it('sin vencidos no borra nada, y si no se pudo borrar el link sirve igual', async () => {
    await createUploadLink('hub')
    expect(mocks.remove).not.toHaveBeenCalled()

    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockResolvedValue({ data: { id: 'x', stale_paths: ['a/b/c.jpg'] }, error: null })
    mocks.remove.mockResolvedValue({ data: null, error: { name: 'StorageError' } })
    expect((await createUploadLink('hub')).ok).toBe(true)
    log.mockRestore()
  })

  it('si la base no acepta el link, vuelve el error y no hay URL', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'forbidden', details: null, hint: null },
    })
    const result = await createUploadLink('hub')
    expect(result.ok).toBe(false)
    log.mockRestore()
  })

  it('si no se pudo firmar, no guarda un link a medias', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.sign.mockResolvedValue({ data: null, error: new Error('rls') })
    const result = await createUploadLink('hub')
    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
    log.mockRestore()
  })
})
