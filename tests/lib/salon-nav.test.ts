import { describe, expect, it } from 'vitest'
import {
  SALON_TABBAR_SLOTS,
  splitSalonTabs,
  visibleSalonTabs,
} from '@/components/shell/salon/salon-nav'
import { getTenantFeatures, type TenantFeatures } from '@/lib/platform/features'
import type { TenantRole } from '@/lib/tenant/types'

const features = (on: Partial<TenantFeatures>): TenantFeatures => ({
  ...getTenantFeatures({ feature_flags: {} }),
  ...on,
})
const keys = (role: TenantRole, on: Partial<TenantFeatures>, isPlatformAdmin = false) =>
  visibleSalonTabs({ role, features: features(on), isPlatformAdmin }).map((tab) => tab.key)

describe('visibleSalonTabs — el orden de siempre, sin punto de venta', () => {
  it('HUB hoy: el dueño ve sus cinco, con sumar puntos primero', () => {
    expect(keys('owner', { ticket_door: true, purchasing: true })).toEqual([
      'escanear',
      'qr-club',
      'reservas',
      'puerta',
      'stock',
    ])
  })

  it('la cocina no ve reservas ni el club', () => {
    expect(keys('kitchen', { purchasing: true })).toEqual(['stock'])
  })

  it('sin nada prendido, el mozo ve el club y las reservas', () => {
    expect(keys('waiter', {})).toEqual(['escanear', 'qr-club', 'reservas'])
  })
})

describe('visibleSalonTabs — con el punto de venta manda el salón en vivo', () => {
  const on = { pos: true, ticket_door: true, purchasing: true }

  it('el dueño: salón, caja, reservas y cocina primero; el club y lo de algunas noches después', () => {
    expect(keys('owner', on)).toEqual([
      'mapa',
      'caja',
      'reservas',
      'tele',
      'escanear',
      'qr-club',
      'puerta',
      'stock',
    ])
  })

  it('el mozo no ve la caja', () => {
    const waiter = keys('waiter', on)
    expect(waiter.slice(0, 3)).toEqual(['mapa', 'reservas', 'tele'])
    expect(waiter).not.toContain('caja')
    expect(waiter).not.toContain('stock')
  })

  it('la cocina entra a su pantalla y al stock, nada más', () => {
    expect(keys('kitchen', on)).toEqual(['tele', 'stock'])
  })

  it('la anfitriona ve el salón y las reservas, no la cocina ni la caja', () => {
    const host = keys('host', on)
    expect(host.slice(0, 2)).toEqual(['mapa', 'reservas'])
    expect(host).not.toContain('tele')
    expect(host).not.toContain('caja')
  })

  it('lo que no tiene lugar en el orden queda al final, como estaba', () => {
    const all = keys('owner', { ...on, table_service: true, kitchen: true })
    expect(all.slice(-3)).toEqual(['mesas', 'cocina', 'mi-turno'])
  })
})

describe('splitSalonTabs — cinco lugares; con más, cuatro y «Más»', () => {
  const tabsFor = (role: TenantRole, on: Partial<TenantFeatures>) =>
    visibleSalonTabs({ role, features: features(on), isPlatformAdmin: false })

  it('con cinco o menos van todas a la barra', () => {
    const { bar, more } = splitSalonTabs(tabsFor('owner', { ticket_door: true, purchasing: true }))
    expect(bar).toHaveLength(SALON_TABBAR_SLOTS)
    expect(more).toEqual([])
  })

  it('el dueño con punto de venta: cuatro en la barra y el resto detrás de «Más»', () => {
    const { bar, more } = splitSalonTabs(
      tabsFor('owner', { pos: true, ticket_door: true, purchasing: true }),
    )
    expect(bar.map((t) => t.key)).toEqual(['mapa', 'caja', 'reservas', 'tele'])
    expect(more.map((t) => t.key)).toEqual(['escanear', 'qr-club', 'puerta', 'stock'])
  })

  it('nunca pierde una pestaña', () => {
    const tabs = tabsFor('owner', {
      pos: true,
      ticket_door: true,
      purchasing: true,
      table_service: true,
      kitchen: true,
    })
    const { bar, more } = splitSalonTabs(tabs)
    expect([...bar, ...more]).toEqual(tabs)
    expect(bar.length).toBe(SALON_TABBAR_SLOTS - 1)
  })
})
