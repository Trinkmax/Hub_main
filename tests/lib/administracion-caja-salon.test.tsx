import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CashTrayList } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/cash-tray-list'
import {
  ACTION_PARAM_KEYS,
  actionHref,
  readAction,
} from '@/components/administracion/acciones/types'
import { linkingPosCash, PosCashNote } from '@/components/administracion/caja-salon/pos-cash-form'
import { PosCashTray } from '@/components/administracion/caja-salon/pos-cash-tray'
import type { AccActionState } from '@/lib/accounting/action-state'
import type { PosCashPending } from '@/lib/accounting/pos-cash'

/**
 * La bandeja «De la caja del salón» y lo que le suma a los formularios de siempre: la lista con lo que
 * se hace con cada retiro, la nota de arriba de la hoja y el paso de atar antes de guardar.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actions = vi.hoisted(() => ({ link: vi.fn(), opened: [] as unknown[] }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/hub/administracion/compras',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/accounting/actions/pos-cash', () => ({
  linkPosCash: actions.link,
  dismissPosCash: vi.fn(),
  loadPosCash: vi.fn(),
}))
vi.mock('@/components/administracion/accounting-provider', () => {
  const value = () => ({
    tenantSlug: 'hub',
    today: '2026-11-23',
    access: { read: true, write: true, admin: true },
    readOnly: false,
    openAction: (action: string, params: unknown) => actions.opened.push([action, params]),
    closeAction: () => {},
  })
  return { useAccounting: value, useAccountingOptional: value }
})

beforeEach(() => {
  actions.link.mockReset()
  actions.opened = []
})

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

const item = (over: Partial<PosCashPending> = {}): PosCashPending => ({
  id: uuid(500),
  at: '2026-11-22T23:10:00Z',
  date: '2026-11-22',
  shiftLabel: 'Noche',
  branchId: uuid(40),
  branchName: 'Cerro',
  purpose: 'supplier',
  amountCents: 2_500_000,
  reason: 'Proveedor · Coca-Cola',
  partyId: uuid(7),
  partyName: 'Coca-Cola',
  employeeId: null,
  employeeName: null,
  periodFrom: null,
  periodTo: null,
  byName: 'Luz',
  hasPhoto: false,
  ...over,
})

describe('la bandeja', () => {
  it('sin retiros que esperen no se dibuja nada', () => {
    expect(
      renderToStaticMarkup(
        <PosCashTray
          tenantSlug="hub"
          items={[]}
          note="falta su comprobante."
          actions={() => null}
        />,
      ),
    ).toBe('')
  })

  it('cuántos son, cuánto suman, y un renglón por retiro con lo que se hace con él', () => {
    const html = renderToStaticMarkup(
      <PosCashTray
        tenantSlug="hub"
        items={[
          item(),
          item({
            id: uuid(501),
            purpose: 'salary',
            partyId: null,
            partyName: null,
            employeeId: uuid(1),
            employeeName: 'Martina Ríos',
            amountCents: 20_000_000,
            periodFrom: '2026-11-16',
            periodTo: '2026-11-22',
            byName: null,
          }),
        ]}
        note="falta pasarlos a los libros."
        highlightId={uuid(501)}
        actions={(row) => <button type="button">Pasar {row.id.slice(-3)}</button>}
      />,
    )
    const text = textOf(html)
    expect(html).toContain('<section aria-label="De la caja del salón"')
    expect(text).toMatch(
      /De la caja del salón 2 retiros · \$ ?225\.000 · falta pasarlos a los libros\./,
    )
    expect(text).toMatch(/22\/11 Coca-Cola lo anotó Luz \$ ?25\.000 Pasar 500 Descartar/)
    // Uno del personal dice qué fue y qué fechas cubre.
    expect(text).toMatch(
      /Martina Ríos Pago de sueldo · 16 al 22 nov \$ ?200\.000 Pasar 501 Descartar/,
    )
    // El que vino por el link queda marcado, y solo ese.
    expect((html.match(/data-highlight="true"/g) ?? []).length).toBe(1)
    expect(html).toMatch(/aria-label="Descartar: \$[^"]*25\.000 para Coca-Cola, del 22\/11"/)
    expect(html).toMatch(
      /aria-label="Descartar: \$[^"]*200\.000 de pago de sueldo a Martina Ríos, del 22\/11"/,
    )
  })

  it('en Compras: «Cargar la compra» y «Era un pago» abren las hojas de siempre con el retiro', () => {
    const html = renderToStaticMarkup(
      <CashTrayList
        tenantSlug="hub"
        items={[item(), item({ id: uuid(502), partyId: null, partyName: 'Verdulero' })]}
        highlightId={null}
      />,
    )
    const text = textOf(html)
    expect(text).toContain('falta cargar su comprobante.')
    expect((html.match(/>Cargar la compra</g) ?? []).length).toBe(2)
    expect((html.match(/>Era un pago</g) ?? []).length).toBe(2)
    expect(html).toMatch(/aria-label="Cargar la compra: \$[^"]*25\.000 para Coca-Cola"/)
    // Un proveedor anotado a mano se muestra con ese nombre (se elige en la hoja).
    expect(text).toContain('Verdulero')
  })
})

describe('el parámetro `retiro` de las hojas', () => {
  it('viaja como los demás y solo si es un id', () => {
    expect(ACTION_PARAM_KEYS).toContain('retiro')
    const href = actionHref('/hub/administracion/compras', '?caja=x&tab=comprobantes', 'gasto', {
      retiro: uuid(500),
      proveedor: uuid(7),
    })
    // `caja` es de la hoja: al abrir una, el `?caja=` con el que se llegó desde el salón se va.
    expect(href).toBe(
      `/hub/administracion/compras?tab=comprobantes&accion=gasto&proveedor=${uuid(7)}&retiro=${uuid(500)}`,
    )
    expect(readAction(new URLSearchParams(href.split('?')[1]))).toEqual({
      action: 'gasto',
      params: { proveedor: uuid(7), retiro: uuid(500) },
    })
    expect(readAction(new URLSearchParams('accion=pagar&retiro=no-es-un-id'))).toEqual({
      action: 'pagar',
      params: {},
    })
  })
})

describe('atar el retiro antes de guardar', () => {
  const saved: AccActionState = {
    ok: true,
    message: 'Listo.',
    result: { bundle_id: 'b', replayed: false, documents: [], allocations: [] },
  }
  const input = { clientRef: uuid(999), previewHash: 'h', amountCents: 100 }

  it('sin retiro es la acción de siempre, tal cual', () => {
    const action = vi.fn(async () => saved)
    expect(linkingPosCash(null, action)).toBe(action)
    expect(linkingPosCash(undefined, action)).toBe(action)
  })

  it('con retiro: primero se ata con la referencia de ESTE envío, después se guarda', async () => {
    const calls: string[] = []
    actions.link.mockImplementation(async () => {
      calls.push('atar')
      return { ok: true, data: undefined, message: '' }
    })
    const action = vi.fn(async () => {
      calls.push('guardar')
      return saved
    })
    const result = await linkingPosCash(uuid(500), action)('hub', input)
    expect(result).toBe(saved)
    expect(calls).toEqual(['atar', 'guardar'])
    expect(actions.link).toHaveBeenCalledWith('hub', {
      movementId: uuid(500),
      clientRef: uuid(999),
    })
    expect(action).toHaveBeenCalledWith('hub', input)
  })

  it('si no se pudo atar (ya tiene comprobante), no se guarda nada y el formulario lo dice', async () => {
    actions.link.mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: 'Ese retiro ya tiene su comprobante. Actualizá la página.',
    })
    const action = vi.fn(async () => saved)
    const result = await linkingPosCash(uuid(500), action)('hub', input)
    expect(result).toMatchObject({ ok: false, code: 'conflict' })
    expect(action).not.toHaveBeenCalled()
  })
})

describe('la nota de arriba de la hoja', () => {
  it('dice de dónde viene lo que ya está cargado', () => {
    const text = textOf(renderToStaticMarkup(<PosCashNote posCash={item()} notice={null} />))
    expect(text).toMatch(
      /De la caja del salón: \$ ?25\.000 que salieron el 22\/11 \(Cerro\), anotado por Luz\./,
    )
  })

  it('un proveedor anotado a mano: pide elegirlo', () => {
    const text = textOf(
      renderToStaticMarkup(
        <PosCashNote posCash={item({ partyId: null, partyName: 'Verdulero' })} notice={null} />,
      ),
    )
    expect(text).toContain(
      'En la caja escribieron «Verdulero»: elegí el proveedor o cargalo como nuevo.',
    )
  })

  it('si el retiro ya no espera, lo avisa; sin nada que decir, no se dibuja', () => {
    expect(
      textOf(
        renderToStaticMarkup(
          <PosCashNote posCash={null} notice="Ese retiro de la caja ya tiene su comprobante." />,
        ),
      ),
    ).toBe('Ese retiro de la caja ya tiene su comprobante.')
    expect(renderToStaticMarkup(<PosCashNote posCash={null} notice={null} />)).toBe('')
  })
})
