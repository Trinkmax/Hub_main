import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SubirPage from '@/app/subir/[token]/page'
import { _resetRateLimit } from '@/lib/rate-limit'

/**
 * Lo que abre el celular al escanear el QR: sin sesión y con el token como única credencial. La subida
 * en sí (achicar, subir a la URL firmada, avisar) se probó en Chrome de verdad.
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), ip: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/ip', () => ({ getRequestIp: mocks.ip }))
vi.mock('@/app/subir/[token]/subir-client', async () => {
  const { createElement: h } = await import('react')
  return {
    SubirClient: (props: Record<string, unknown>) =>
      h('div', { 'data-subir': JSON.stringify(props) }),
  }
})

const TOKEN = 'aBcD_123-aBcD_123-aBcD_123-aBcD_123-aBcD_12'

const render = async (token = TOKEN) =>
  renderToStaticMarkup(await SubirPage({ params: Promise.resolve({ token }) }))

beforeEach(() => {
  vi.clearAllMocks()
  _resetRateLimit()
  mocks.ip.mockResolvedValue('1.2.3.4')
})

describe('la página del celular', () => {
  it('abre con el token, y le pasa solo lo que hace falta para subir', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ok: true,
        tenant_name: 'HUB',
        bucket: 'acc-comprobantes',
        uploaded: 1,
        slots: [{ path: 't/l/1.jpg', token: 'firma' }],
      },
      error: null,
    })
    const out = await render()
    expect(mocks.rpc).toHaveBeenCalledWith('acc_upload_link_open', { p_token: TOKEN })
    const props = JSON.parse(
      (/data-subir="([^"]+)"/.exec(out)?.[1] ?? '{}').replaceAll('&quot;', '"'),
    )
    expect(props).toEqual({
      token: TOKEN,
      tenantName: 'HUB',
      uploaded: 1,
      slots: [{ path: 't/l/1.jpg', token: 'firma' }],
    })
  })

  it('un link vencido o que no existe lo dice claro', async () => {
    for (const reason of ['expired', 'not_found']) {
      mocks.rpc.mockResolvedValue({ data: { ok: false, reason }, error: null })
      const out = await render()
      expect(out).toContain('Este QR ya venció')
      expect(out).not.toContain('data-subir')
    }
  })

  it('un token con otra forma no llega a la base', async () => {
    for (const token of [
      'corto',
      'con espacios y todo que no sirven para nada de nada',
      'a'.repeat(200),
    ]) {
      expect(await render(token)).toContain('Este QR ya venció')
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('si falla la conexión, sugiere reintentar y no loguea el token', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } })
    const out = await render()
    expect(out).toContain('No pudimos abrir el link')
    for (const call of log.mock.calls) expect(call.join(' ')).not.toContain(TOKEN)
    log.mockRestore()
  })

  it('una respuesta rara no rompe la página', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, slots: 'nada' }, error: null })
    expect(await render()).toContain('Este QR ya venció')
  })

  it('con muchos intentos seguidos desde la misma IP, frena', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, reason: 'not_found' }, error: null })
    for (let i = 0; i < 30; i += 1) await render()
    mocks.rpc.mockClear()
    expect(await render()).toContain('Esperá un minuto')
    expect(mocks.rpc).not.toHaveBeenCalled()
    // Otra IP sigue pudiendo.
    mocks.ip.mockResolvedValue('5.6.7.8')
    expect(await render()).toContain('Este QR ya venció')
  })
})
