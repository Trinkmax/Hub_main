import { describe, expect, it } from 'vitest'
import { canAccessManagerPath, homePathForRole, MANAGER_SCOPED_PREFIXES } from '@/lib/tenant/roles'

// El proxy usa estas dos funciones para decidir a dónde cae cada rol al
// loguearse y qué rutas del manager puede abrir. La lista /reservas volvió al
// menú (22/09) y vuelve a ser el home de la anfitriona; el calendario, desde
// donde también reserva, le sigue abierto.
describe('homePathForRole', () => {
  it('la anfitriona arranca en la lista de reservas', () => {
    expect(homePathForRole('host', 'hub')).toBe('/hub/reservas')
  })

  it('el resto de los roles no cambia', () => {
    expect(homePathForRole('owner', 'hub')).toBe('/hub')
    expect(homePathForRole('editor', 'hub')).toBe('/hub/menu')
    expect(homePathForRole('waiter', 'hub')).toBe('/hub/salon')
    expect(homePathForRole('cashier', 'hub')).toBe('/hub/salon')
    expect(homePathForRole('kitchen', 'hub')).toBe('/hub/salon')
  })
})

describe('canAccessManagerPath', () => {
  it('el host abre la lista, el alta y la ficha de reservas', () => {
    expect(MANAGER_SCOPED_PREFIXES.host).toContain('reservas')
    expect(canAccessManagerPath('host', ['reservas'])).toBe(true)
    expect(canAccessManagerPath('host', ['reservas', 'nuevo'])).toBe(true)
    expect(canAccessManagerPath('host', ['reservas', '6f1c2a54-1b2c-4d5e-8f90-1a2b3c4d5e6f'])).toBe(
      true,
    )
  })

  it('el host también abre el calendario (reserva desde los dos lados)', () => {
    expect(canAccessManagerPath('host', ['eventos', 'programados'])).toBe(true)
  })

  it('el host no entra a lo del dueño ni al home del manager', () => {
    expect(canAccessManagerPath('host', ['clientes'])).toBe(false)
    expect(canAccessManagerPath('host', [])).toBe(false)
  })

  it('el editor solo ve la carta y el owner navega libre', () => {
    expect(canAccessManagerPath('editor', ['menu'])).toBe(true)
    expect(canAccessManagerPath('editor', ['eventos', 'programados'])).toBe(false)
    expect(canAccessManagerPath('owner', ['lo-que-sea'])).toBe(true)
  })

  it('el home de cada rol acotado es una ruta que ese rol puede abrir (sin loops del proxy)', () => {
    for (const role of ['host', 'editor'] as const) {
      const rest = homePathForRole(role, 'hub').split('/').filter(Boolean).slice(1)
      expect(canAccessManagerPath(role, rest)).toBe(true)
    }
  })
})
