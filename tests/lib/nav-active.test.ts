import { describe, expect, it } from 'vitest'
import { computeActiveHrefs } from '@/components/shell/nav-active'
import type { ResolvedNavGroup } from '@/components/shell/nav-config'

// Espejo reducido del NAV_GROUPS real: el padre Personas con dos hijos que
// COMPARTEN pathname y sólo difieren por `?segment=`, más un padre con un hijo
// de pathname más profundo (Estadísticas → Comisiones) y un item exacto.
const groups: ResolvedNavGroup[] = [
  {
    label: 'Clientes',
    items: [
      {
        label: 'Personas',
        href: '/x/clientes',
        iconKey: 'Users',
        children: [
          { label: 'Reservas', href: '/x/clientes?segment=reserva', iconKey: 'CalendarCheck' },
          { label: 'Walk-in', href: '/x/clientes?segment=walkin', iconKey: 'Receipt' },
        ],
      },
      { label: 'Acreditar', href: '/x/acreditar', iconKey: 'ScanLine' },
    ],
  },
  {
    label: 'Negocio',
    items: [
      {
        label: 'Estadísticas',
        href: '/x/estadisticas',
        iconKey: 'BarChart3',
        children: [{ label: 'Comisiones', href: '/x/estadisticas/comisiones', iconKey: 'Coins' }],
      },
      { label: 'Resumen', href: '/x', iconKey: 'LayoutDashboard', exact: true },
    ],
  },
]

describe('computeActiveHrefs', () => {
  it('en Walk-in activa SÓLO Walk-in entre los hijos por segmento (no Reservas)', () => {
    const active = computeActiveHrefs('/x/clientes', 'segment=walkin', groups)
    expect(active.has('/x/clientes?segment=walkin')).toBe(true)
    expect(active.has('/x/clientes?segment=reserva')).toBe(false)
  })

  it('en Reservas activa SÓLO Reservas (regresión doble-selección)', () => {
    const active = computeActiveHrefs('/x/clientes', 'segment=reserva', groups)
    expect(active.has('/x/clientes?segment=reserva')).toBe(true)
    expect(active.has('/x/clientes?segment=walkin')).toBe(false)
  })

  it('en /clientes pelado no activa ningún hijo por segmento, sólo el padre', () => {
    const active = computeActiveHrefs('/x/clientes', '', groups)
    expect(active.has('/x/clientes')).toBe(true)
    expect(active.has('/x/clientes?segment=walkin')).toBe(false)
    expect(active.has('/x/clientes?segment=reserva')).toBe(false)
  })

  it('con query irrelevante (sin segment) tampoco activa hijos', () => {
    const active = computeActiveHrefs('/x/clientes', 'q=ramirez', groups)
    expect(active.has('/x/clientes')).toBe(true)
    expect(active.has('/x/clientes?segment=walkin')).toBe(false)
    expect(active.has('/x/clientes?segment=reserva')).toBe(false)
  })

  it('params extra no rompen el subset (segment presente => activo)', () => {
    const active = computeActiveHrefs('/x/clientes', 'segment=walkin&page=2', groups)
    expect(active.has('/x/clientes?segment=walkin')).toBe(true)
    expect(active.has('/x/clientes?segment=reserva')).toBe(false)
  })

  it('hijo con pathname más profundo gana al padre (Comisiones, no Estadísticas)', () => {
    const active = computeActiveHrefs('/x/estadisticas/comisiones', '', groups)
    expect(active.has('/x/estadisticas/comisiones')).toBe(true)
    expect(active.has('/x/estadisticas')).toBe(false)
  })

  it('en el padre exacto sólo el padre, sin el hijo más profundo', () => {
    const active = computeActiveHrefs('/x/estadisticas', '', groups)
    expect(active.has('/x/estadisticas')).toBe(true)
    expect(active.has('/x/estadisticas/comisiones')).toBe(false)
  })

  it('item exacto (Resumen) sólo matchea su pathname exacto', () => {
    expect(computeActiveHrefs('/x', '', groups).has('/x')).toBe(true)
    // En una sub-ruta, Resumen (exact) NO debe quedar activo
    expect(computeActiveHrefs('/x/clientes', '', groups).has('/x')).toBe(false)
  })

  it('sin ningún match devuelve set vacío', () => {
    expect(computeActiveHrefs('/y/otra-cosa', '', groups).size).toBe(0)
  })
})
