// @vitest-environment node
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  AmountStep,
  ChoiceStep,
  DoneStep,
  type Saved,
  type TargetsState,
  WhoStep,
} from '@/components/pos/cash/move-out-flow'
import { Sheet } from '@/components/ui/sheet'
import type { ShiftSummary } from '@/lib/pos/cash/types'

/**
 * «Sacar plata» con destino, paso por paso, en el primer paint: qué se ofrece, qué NO se le muestra a
 * quien atiende la caja (saldos, cuánto hay en el cajón a ciegas) y cuándo aparece el enlace para
 * cargar la compra.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}))

const ID_A = '0b8f3c1e-5d2a-4e7b-9c1f-2a3b4c5d6e7f'
const ID_B = '1c9a4d2f-6e3b-4f8c-8d2a-3b4c5d6e7f80'
const ID_C = '2dab5e30-7f4c-4a9d-9e3b-4c5d6e7f8091'

/** Los títulos de la hoja necesitan estar adentro de una hoja. */
const html = (node: ReactElement) =>
  // React separa los textos pegados con un comentario vacío: se saca para leer la frase entera.
  renderToString(createElement(Sheet, { open: true }, node)).replaceAll('<!-- -->', '')
const noop = () => {}

const ready: TargetsState = {
  status: 'ready',
  message: null,
  retry: noop,
  data: {
    suppliers: [
      { id: ID_A, name: 'Hielo Sur' },
      { id: ID_B, name: 'Panadería Unión' },
    ],
    employees: [
      { id: ID_B, name: 'Ana Ríos', here: true },
      { id: ID_C, name: 'Beto Paz', here: false },
    ],
  },
}

const live = { expected_cash_cents: 5_400_000 } as ShiftSummary
const api = { move: vi.fn() }

describe('1. para qué sale', () => {
  it('ofrece los cuatro destinos y el motivo de siempre', () => {
    const out = html(createElement(ChoiceStep, { onPick: noop }))
    expect(out).toContain('¿Para qué sale la plata?')
    for (const label of [
      'Proveedor',
      'Adelanto de sueldo',
      'Hora extra',
      'Pago de sueldo',
      'Otro motivo',
    ]) {
      expect(out).toContain(label)
    }
    expect(out.match(/data-testid="retiro-para-/g)?.length).toBe(5)
  })
})

describe('2. a quién', () => {
  const who = (props: Partial<Parameters<typeof WhoStep>[0]>) =>
    html(
      createElement(WhoStep, {
        purpose: 'supplier',
        targets: ready,
        onBack: noop,
        onOther: noop,
        onPick: noop,
        ...props,
      }),
    )

  it('proveedores: la lista, el buscador y cómo anotar uno que no está', () => {
    const out = who({ purpose: 'supplier' })
    expect(out).toContain('¿A qué proveedor?')
    expect(out).toContain('Hielo Sur')
    expect(out).toContain('Panadería Unión')
    expect(out).toContain('data-testid="retiro-buscar"')
    expect(out).toContain('¿No está en la lista? Escribí el nombre arriba.')
    // Solo nombres: ni un peso de lo que se le debe a nadie.
    expect(out).not.toContain('$')
  })

  it('el equipo: primero los de esta sucursal, y sin buscador si entran de un vistazo', () => {
    const out = who({ purpose: 'advance' })
    expect(out).toContain('¿A quién se le adelanta?')
    expect(out.indexOf('Ana Ríos')).toBeLessThan(out.indexOf('De otra sucursal'))
    expect(out.indexOf('De otra sucursal')).toBeLessThan(out.indexOf('Beto Paz'))
    expect(out).not.toContain('data-testid="retiro-buscar"')
    expect(out).not.toContain('No está en la lista')
    expect(out).not.toContain('$')
  })

  it('mientras llega la lista se ve que está llegando', () => {
    const out = who({ targets: { status: 'loading', data: null, message: null, retry: noop } })
    expect(out).toContain('aria-busy="true"')
    expect(out).not.toContain('retiro-elegir')
  })

  it('si la lista no llega, se puede reintentar; el equipo además se anota con otro motivo', () => {
    const failed: TargetsState = {
      status: 'error',
      data: null,
      message: 'No hay señal: no se guardó. Probá de nuevo cuando vuelva.',
      retry: noop,
    }
    const supplier = who({ targets: failed })
    expect(supplier).toContain('No hay señal')
    expect(supplier).toContain('Reintentar')
    expect(supplier).not.toContain('Anotarlo con otro motivo')
    expect(who({ purpose: 'overtime', targets: failed })).toContain('Anotarlo con otro motivo')
  })

  it('sin nadie cargado lo dice, y no deja a la caja trabada', () => {
    const empty: TargetsState = {
      status: 'ready',
      data: { suppliers: [], employees: [] },
      message: null,
      retry: noop,
    }
    expect(who({ purpose: 'salary', targets: empty })).toContain('Anotarlo con otro motivo')
    expect(who({ purpose: 'supplier', targets: empty })).toContain('Escribí el nombre arriba')
  })
})

describe('3. cuánto', () => {
  const amount = (props: Partial<Parameters<typeof AmountStep>[0]>) =>
    html(
      createElement(AmountStep, {
        target: { purpose: 'advance', employeeId: ID_B, name: 'Ana Ríos' },
        shiftId: ID_A,
        live,
        blind: false,
        today: '2026-11-23',
        idempotencyKey: 'clave-de-prueba',
        api,
        onBack: noop,
        onSaved: noop,
        ...props,
      }),
    )

  it('un adelanto o unas horas extra piden el monto y nada más', () => {
    for (const purpose of ['advance', 'overtime'] as const) {
      const out = amount({ target: { purpose, employeeId: ID_B, name: 'Ana Ríos' } })
      expect(out).toContain('Ana Ríos')
      expect(out).toContain('data-testid="retiro-monto"')
      expect(out).not.toContain('¿Qué fechas cubre?')
      expect(out).not.toContain('factura')
      expect(out).not.toMatch(/negro|blanco|saldo/i)
    }
  })

  it('el pago de un sueldo ofrece decir qué fechas cubre, con el mes a la vista', () => {
    const out = amount({ target: { purpose: 'salary', employeeId: ID_B, name: 'Ana Ríos' } })
    expect(out).toContain('¿Qué fechas cubre?')
    expect(out).toContain('1.ª quincena')
    expect(out).toContain('2.ª quincena')
    expect(out).toContain('Todo noviembre')
    expect(out).toContain('Esta semana')
    expect(out).toContain('Otras fechas')
  })

  it('un proveedor pide, si lo hay, el número del comprobante', () => {
    const listed = amount({ target: { purpose: 'supplier', partyId: ID_A, name: 'Hielo Sur' } })
    expect(listed).toContain('N.º de factura o remito')
    expect(listed).not.toContain('no está en la lista')
    // Uno escrito a mano es el nombre y el monto: sin número de comprobante.
    const typed = amount({ target: { purpose: 'supplier', partyId: null, name: 'Verdulero' } })
    expect(typed).toContain('no está en la lista')
    expect(typed).not.toContain('N.º de factura o remito')
  })
})

describe('4. anotado', () => {
  const saved: Saved = {
    target: { purpose: 'supplier', partyId: ID_A, name: 'Hielo Sur' },
    cents: 2_500_000,
    note: 'Remito 12',
    period: null,
    movementId: ID_C,
    expectedAfterCents: 2_900_000,
  }
  const done = (props: Partial<Parameters<typeof DoneStep>[0]>) =>
    html(
      createElement(DoneStep, {
        saved,
        blind: false,
        practice: false,
        href: null,
        onClose: noop,
        ...props,
      }),
    )

  it('dice qué se anotó y cuánto tiene que quedar en el cajón', () => {
    const out = done({})
    expect(out).toContain('Anotado')
    expect(out).toContain('25.000')
    expect(out).toContain('Proveedor · Hielo Sur · Remito 12')
    expect(out).toContain('Quedó anotado para Administración')
    expect(out).toContain('29.000')
    expect(out).not.toContain('retiro-cargar-compra')
  })

  it('a quien carga compras le ofrece cargarla ahí mismo', () => {
    const out = done({ href: `/hub/administracion/compras?caja=${ID_C}` })
    expect(out).toContain('Cargar la compra ahora')
    expect(out).toContain(`href="/hub/administracion/compras?caja=${ID_C}"`)
    expect(out).toContain('data-testid="retiro-listo"')
  })

  it('a ciegas no dice cuánto hay en el cajón', () => {
    const out = done({ blind: true })
    expect(out).not.toContain('En el cajón tiene que haber')
    expect(out).not.toContain('29.000')
  })

  it('un adelanto queda para Sueldos, sin enlace a Compras aunque lo tenga', () => {
    const out = done({
      saved: {
        ...saved,
        target: { purpose: 'advance', employeeId: ID_B, name: 'Ana Ríos' },
        note: '',
      },
      href: '/hub/administracion/compras?caja=x',
    })
    expect(out).toContain('Adelanto de sueldo · Ana Ríos')
    expect(out).toContain('los socios lo ven en Sueldos')
    expect(out).not.toContain('Cargar la compra ahora')
  })

  it('el pago de un sueldo dice las fechas', () => {
    const out = done({
      saved: {
        ...saved,
        target: { purpose: 'salary', employeeId: ID_B, name: 'Ana Ríos' },
        note: '',
        period: { from: '2026-11-16', to: '2026-11-30' },
      },
    })
    expect(out).toContain('Pago de sueldo · Ana Ríos · Del 16 al 30 de noviembre')
  })

  it('en práctica avisa que no va a Administración', () => {
    const out = done({ practice: true })
    expect(out).toContain('práctica')
    expect(out).not.toContain('Quedó anotado para Administración')
  })
})
