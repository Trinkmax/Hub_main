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

// La lista /reservas se retiró: Calendario (href /x/eventos/programados) se
// queda con `alsoMatch: ['/x/reservas']` para que el alta y la ficha de una
// reserva, que siguen siendo rutas propias, no queden sin item resaltado.
describe('computeActiveHrefs — alsoMatch', () => {
  const withCalendar: ResolvedNavGroup[] = [
    ...groups,
    {
      label: 'Agenda',
      items: [
        {
          label: 'Calendario',
          href: '/x/eventos/programados',
          iconKey: 'CalendarDays',
          alsoMatch: ['/x/reservas'],
        },
      ],
    },
  ]
  const CAL = '/x/eventos/programados'

  it('/x/reservas/nuevo resalta Calendario', () => {
    expect(computeActiveHrefs('/x/reservas/nuevo', '', withCalendar)).toEqual(new Set([CAL]))
  })

  it('/x/reservas/{id} resalta Calendario', () => {
    expect(computeActiveHrefs('/x/reservas/abc', '', withCalendar)).toEqual(new Set([CAL]))
  })

  it('el calendario con ?day sigue resaltando Calendario', () => {
    expect(computeActiveHrefs('/x/eventos/programados', 'day=2026-09-10', withCalendar)).toEqual(
      new Set([CAL]),
    )
  })

  it('el alias matchea por segmento, no por texto suelto', () => {
    expect(computeActiveHrefs('/x/reservas-viejas', '', withCalendar).size).toBe(0)
  })

  it('/x/clientes?segment=reserva sigue activando solo Reservas del CRM', () => {
    const active = computeActiveHrefs('/x/clientes', 'segment=reserva', withCalendar)
    expect(active).toEqual(new Set(['/x/clientes', '/x/clientes?segment=reserva']))
    expect(active.has(CAL)).toBe(false)
  })
})
