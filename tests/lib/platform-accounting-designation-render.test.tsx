// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AccountingDesignationResult } from '@/app/(platform)/admin/_components/accounting-designation-card'
import type { AccountingDesignationOwner } from '@/lib/platform/accounting-actions'

/**
 * Primer paint (SSR) de «Administración: quién la configura» en
 * /admin/[tenantId]. Se prueba qué ve el superadmin en cada momento del
 * módulo: sin nadie designado, con alguien designado, configurada con
 * administrador (solo lectura) y configurada sin administrador (recuperar).
 * La interacción (elegir, confirmar, toast) queda para el smoke manual.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/platform/accounting-actions', () => ({
  designateAccountingAdminAction: vi.fn(),
}))

const TENANT_ID = '0f6b2c1e-4d3a-4b8e-9c7d-1a2b3c4d5e6f'

function owner(
  p: Partial<AccountingDesignationOwner> & { userId: string },
): AccountingDesignationOwner {
  return { email: null, name: null, hasAccess: false, isAdmin: false, accessName: null, ...p }
}

const ANA = owner({
  userId: '11111111-1111-4111-8111-111111111111',
  name: 'Ana Gómez',
  email: 'ana@hub.test',
})
const BRUNO = owner({
  userId: '22222222-2222-4222-8222-222222222222',
  name: 'Bruno Díaz',
  email: 'bruno@hub.test',
})
// Sin nombre en el perfil: el email hace de nombre y no se repite abajo.
const CARLA = owner({ userId: '33333333-3333-4333-8333-333333333333', email: 'carla@hub.test' })

async function render(result: AccountingDesignationResult): Promise<string> {
  const { AccountingDesignationCard } = await import(
    '@/app/(platform)/admin/_components/accounting-designation-card'
  )
  return renderToString(createElement(AccountingDesignationCard, { tenantId: TENANT_ID, result }))
}

function designation(
  p: Partial<Extract<AccountingDesignationResult, { ok: true }>['data']>,
): AccountingDesignationResult {
  return {
    ok: true,
    data: { enabled: true, setUp: false, canDesignate: true, owners: [ANA, BRUNO, CARLA], ...p },
  }
}

/** Los estados que muestra la lista, en el orden de las filas. */
function badges(html: string): string[] {
  return [...html.matchAll(/data-slot="badge"[^>]*>([^<]*)</g)].map((m) => m[1] ?? '')
}

const PICKER_LABEL = 'Dueño a designar'
const READ_ONLY_NOTE =
  'Ya está configurada; los accesos los maneja su administrador desde Administración › Ajustes.'

describe('AccountingDesignationCard (SSR)', () => {
  it('sin nadie designado: todos pueden configurarla y se ofrece designar', async () => {
    const html = await render(designation({}))

    expect(html).toContain('Administración: quién la configura')
    expect(html).toContain('cualquier dueño del bar la puede empezar')
    expect(badges(html)).toEqual(['Puede configurarla', 'Puede configurarla', 'Puede configurarla'])
    expect(html).toContain('Ana Gómez')
    expect(html).toContain('ana@hub.test')
    expect(html.split('carla@hub.test').length - 1).toBe(1)

    expect(html).toContain(PICKER_LABEL)
    expect(html).toContain('Elegí un dueño…')
    // Sin nadie elegido, «Designar» arranca deshabilitado.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Designar<\/button>/)
  })

  it('el label del select y la sección quedan asociados (accesibilidad)', async () => {
    const html = await render(designation({}))

    const labelFor = html.match(/<label[^>]*for="([^"]+)"/)?.[1]
    expect(labelFor).toBeTruthy()
    expect(html).toMatch(new RegExp(`<button[^>]*role="combobox"[^>]*id="${labelFor}"`))

    const headingId = html.match(/<section[^>]*aria-labelledby="([^"]+)"/)?.[1]
    expect(headingId).toBeTruthy()
    expect(html).toContain(`<h2 id="${headingId}"`)
  })

  it('con alguien designado: solo esa persona puede configurarla y se puede sumar a otro', async () => {
    const html = await render(
      designation({ owners: [{ ...ANA, hasAccess: true, isAdmin: true }, BRUNO, CARLA] }),
    )

    expect(badges(html)).toEqual(['Puede configurarla'])
    expect(html).toContain('Si designás a otro, se suma')
    expect(html).toContain(PICKER_LABEL)
  })

  it('si ya están todos designados no queda a quién ofrecer', async () => {
    const html = await render(designation({ owners: [{ ...ANA, hasAccess: true, isAdmin: true }] }))

    expect(html).toContain('Todos los dueños ya pueden configurarla.')
    expect(html).not.toContain(PICKER_LABEL)
  })

  it('configurada y con administrador: nota de solo lectura, sin designar', async () => {
    const html = await render(
      designation({
        setUp: true,
        canDesignate: false,
        owners: [{ ...ANA, hasAccess: true, isAdmin: true }, { ...BRUNO, hasAccess: true }, CARLA],
      }),
    )

    expect(html).toContain(READ_ONLY_NOTE)
    expect(badges(html)).toEqual(['Administra', 'Ya tiene acceso'])
    expect(html).not.toContain(PICKER_LABEL)
    expect(html).not.toMatch(/>Designar</)
  })

  it('configurada pero sin nadie que dé accesos: se puede recuperar', async () => {
    const html = await render(
      designation({
        setUp: true,
        canDesignate: true,
        owners: [ANA, { ...BRUNO, hasAccess: true }, CARLA],
      }),
    )

    expect(html).toContain('ningún dueño da los accesos')
    expect(html).not.toContain(READ_ONLY_NOTE)
    expect(badges(html)).toEqual(['Ya tiene acceso'])
    expect(html).toContain(PICKER_LABEL)
  })

  it('bar sin dueños: lo dice y no ofrece designar', async () => {
    const html = await render(designation({ owners: [] }))

    expect(html).toContain('Este bar todavía no tiene dueños.')
    expect(html).not.toContain(PICKER_LABEL)
  })

  it('si no se pudo leer, muestra el error con «Reintentar»', async () => {
    const html = await render({ ok: false, error: 'No se pudo leer el bar.' })

    expect(html).toContain('No se pudo leer el bar.')
    expect(html).toContain('Reintentar')
    expect(html).not.toContain(PICKER_LABEL)
  })

  it('con el flag apagado no muestra nada', async () => {
    expect(await render(designation({ enabled: false }))).toBe('')
  })
})
