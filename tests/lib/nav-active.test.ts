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
        children: [
          { label: 'Señas', href: '/x/estadisticas/senas', iconKey: 'Banknote' },
          { label: 'Comisiones', href: '/x/estadisticas/comisiones', iconKey: 'Coins' },
        ],
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

  it('entre dos hijos hermanos activa sólo el de la ruta abierta', () => {
    const active = computeActiveHrefs('/x/estadisticas/senas', '', groups)
    expect(active.has('/x/estadisticas/senas')).toBe(true)
    expect(active.has('/x/estadisticas/comisiones')).toBe(false)
    expect(active.has('/x/estadisticas')).toBe(false)
  })

  it('en el padre exacto sólo el padre, sin los hijos más profundos', () => {
    const active = computeActiveHrefs('/x/estadisticas', '', groups)
    expect(active.has('/x/estadisticas')).toBe(true)
    expect(active.has('/x/estadisticas/comisiones')).toBe(false)
    expect(active.has('/x/estadisticas/senas')).toBe(false)
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

// Reservas volvió al menú (22/09) antes del Calendario. El alta y la ficha de
// una reserva viven bajo /reservas: resaltan Reservas por prefijo, se entre
// desde la lista o desde el calendario (el `?volver=calendario` no cambia qué
// sección es).
describe('computeActiveHrefs — Agenda (Reservas + Calendario)', () => {
  const RES = '/x/reservas'
  const CAL = '/x/eventos/programados'
  const withAgenda: ResolvedNavGroup[] = [
    ...groups,
    {
      label: 'Agenda',
      items: [
        { label: 'Reservas', href: RES, iconKey: 'CalendarCheck' },
        { label: 'Calendario', href: CAL, iconKey: 'CalendarDays' },
      ],
    },
  ]

  it('la lista, el alta y la ficha resaltan Reservas', () => {
    expect(computeActiveHrefs('/x/reservas', 'day=2026-09-10', withAgenda)).toEqual(new Set([RES]))
    expect(computeActiveHrefs('/x/reservas/nuevo', '', withAgenda)).toEqual(new Set([RES]))
    expect(computeActiveHrefs('/x/reservas/abc', '', withAgenda)).toEqual(new Set([RES]))
  })

  it('entrar al alta desde el calendario sigue resaltando Reservas', () => {
    expect(
      computeActiveHrefs('/x/reservas/nuevo', 'date=2026-09-10&volver=calendario', withAgenda),
    ).toEqual(new Set([RES]))
  })

  it('el calendario con ?day resalta Calendario', () => {
    expect(computeActiveHrefs(CAL, 'day=2026-09-10', withAgenda)).toEqual(new Set([CAL]))
  })

  it('matchea por segmento, no por texto suelto', () => {
    expect(computeActiveHrefs('/x/reservas-viejas', '', withAgenda).size).toBe(0)
  })

  it('/x/clientes?segment=reserva sigue activando solo Reservas del CRM', () => {
    const active = computeActiveHrefs('/x/clientes', 'segment=reserva', withAgenda)
    expect(active).toEqual(new Set(['/x/clientes', '/x/clientes?segment=reserva']))
    expect(active.has(RES)).toBe(false)
  })
})
