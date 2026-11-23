import { describe, expect, it } from 'vitest'
import {
  branchCookieName,
  cookieDeviceId,
  nextBranchCookie,
  parseBranchCookie,
  serializeBranchCookie,
} from '@/lib/branches/cookie'
import {
  applyBranchFilter,
  BranchForbiddenError,
  BranchRequiredError,
  branchFilterOf,
  branchForWrite,
  clampBranchFilter,
  inBranchFilter,
  rpcBranchId,
  WHOLE_BAR,
} from '@/lib/branches/filter'
import { parseBranchRef, parseBranchRefs } from '@/lib/branches/parse'
import { resolveBranchScope } from '@/lib/branches/resolve'
import { type BranchRef, branchShortLabel, toClientScope } from '@/lib/branches/types'
import type { TenantRole } from '@/lib/tenant/types'
import { sanitizeBranchParam } from '@/lib/workspace'

const AC_ID = '6011ae59-1a30-4119-a45b-4152b1ba10ed'
const CERRO_ID = '6380c468-cf88-495c-a0f3-85e42279a355'
const NUEVA_ID = '0f6b1f0e-0000-4000-8000-000000000003'

const AC: BranchRef = {
  id: AC_ID,
  name: 'Alta Córdoba',
  shortName: 'A. Córdoba',
  slug: 'alta-cordoba',
  color: '#2f5d50',
  address: null,
  position: 0,
  isDefault: true,
  openedOn: null,
  seatCapacity: 130,
}
const CERRO: BranchRef = {
  id: CERRO_ID,
  name: 'Cerro',
  shortName: null,
  slug: 'cerro',
  color: '#a8452d',
  address: 'Rafael Núñez 4000',
  position: 1,
  isDefault: false,
  openedOn: '2026-12-04',
  seatCapacity: 80,
}

function scope(
  opts: Partial<{
    branches: BranchRef[]
    role: TenantRole
    unrestricted: boolean
    cookie: string | null
    param: string | null
    surface: 'view' | 'device'
  }> = {},
) {
  return resolveBranchScope({
    branches: opts.branches ?? [AC, CERRO],
    role: opts.role ?? 'owner',
    unrestricted: opts.unrestricted ?? true,
    cookie: parseBranchCookie(opts.cookie ?? null),
    param: opts.param ?? null,
    surface: opts.surface ?? 'view',
  })
}

describe('la cookie del dispositivo', () => {
  it('lee los valores que ya guardaba el punto de venta (el id de la sucursal)', () => {
    expect(parseBranchCookie(CERRO_ID)).toEqual({ kind: 'branch', id: CERRO_ID })
    expect(parseBranchCookie(CERRO_ID.toUpperCase())).toEqual({ kind: 'branch', id: CERRO_ID })
  })

  it('lee «Todas», con y sin la sucursal del dispositivo', () => {
    expect(parseBranchCookie('all')).toEqual({ kind: 'all', device: null })
    expect(parseBranchCookie(`all.${AC_ID}`)).toEqual({ kind: 'all', device: AC_ID })
    expect(parseBranchCookie('all.basura')).toEqual({ kind: 'all', device: null })
  })

  it('ignora lo roto', () => {
    for (const raw of ['', 'todas', 'cerro', `${CERRO_ID}x`, undefined, null]) {
      expect(parseBranchCookie(raw)).toBeNull()
    }
  })

  it('se escribe igual que se lee', () => {
    for (const raw of [CERRO_ID, 'all', `all.${AC_ID}`]) {
      const parsed = parseBranchCookie(raw)
      expect(parsed && serializeBranchCookie(parsed)).toBe(raw)
    }
  })

  it('el nombre es el de siempre, por bar', () => {
    expect(branchCookieName('abc')).toBe('hub_branch_abc')
  })

  it('en el panel: elegir una sucursal la deja también como la del dispositivo', () => {
    expect(nextBranchCookie(parseBranchCookie(`all.${AC_ID}`), CERRO_ID, 'view')).toEqual({
      kind: 'branch',
      id: CERRO_ID,
    })
  })

  it('en el panel: «Todas» no mueve el dispositivo', () => {
    expect(nextBranchCookie(parseBranchCookie(AC_ID), 'all', 'view')).toEqual({
      kind: 'all',
      device: AC_ID,
    })
    expect(nextBranchCookie(parseBranchCookie(`all.${CERRO_ID}`), 'all', 'view')).toEqual({
      kind: 'all',
      device: CERRO_ID,
    })
    expect(nextBranchCookie(null, 'all', 'view')).toEqual({ kind: 'all', device: null })
  })

  it('en el salón: mover el dispositivo no saca al panel de «Todas»', () => {
    expect(nextBranchCookie(parseBranchCookie('all'), CERRO_ID, 'device')).toEqual({
      kind: 'all',
      device: CERRO_ID,
    })
    expect(nextBranchCookie(parseBranchCookie(AC_ID), CERRO_ID, 'device')).toEqual({
      kind: 'branch',
      id: CERRO_ID,
    })
  })

  it('el salón nunca guarda «Todas» y no acepta cualquier cosa', () => {
    expect(() => nextBranchCookie(null, 'all', 'device')).toThrow()
    expect(() => nextBranchCookie(null, 'cerro', 'view')).toThrow()
  })

  it('sabe cuál es la sucursal del dispositivo', () => {
    expect(cookieDeviceId(parseBranchCookie(CERRO_ID))).toBe(CERRO_ID)
    expect(cookieDeviceId(parseBranchCookie(`all.${AC_ID}`))).toBe(AC_ID)
    expect(cookieDeviceId(parseBranchCookie('all'))).toBeNull()
    expect(cookieDeviceId(null)).toBeNull()
  })
})

describe('qué sucursal se mira', () => {
  it('un bar de una sola sucursal: sin selector, sin pregunta, sin filtro raro', () => {
    const one = scope({ branches: [AC] })
    expect(one).toMatchObject({
      current: AC,
      isAll: false,
      multi: false,
      canAll: false,
      needsChoice: false,
    })
    expect(one.source).toBe('single')
    expect(one.device).toEqual(AC)
  })

  it('un dueño que nunca eligió en este dispositivo: la entrada le pregunta (mientras tanto, la principal)', () => {
    const first = scope({})
    expect(first.needsChoice).toBe(true)
    expect(first.current).toEqual(AC)
    expect(first.canAll).toBe(true)
  })

  it('lo que eligió el dispositivo manda', () => {
    expect(scope({ cookie: CERRO_ID }).current).toEqual(CERRO)
    const all = scope({ cookie: `all.${CERRO_ID}` })
    expect(all.isAll).toBe(true)
    expect(all.ids).toEqual([AC_ID, CERRO_ID])
    expect(all.device).toEqual(CERRO)
    expect(all.needsChoice).toBe(false)
  })

  it('un link con ?sucursal= gana, sin preguntar', () => {
    const linked = scope({ cookie: AC_ID, param: 'cerro' })
    expect(linked.current).toEqual(CERRO)
    expect(linked.source).toBe('param')
    expect(scope({ param: 'todas' }).isAll).toBe(true)
    expect(scope({ param: 'Cerro' }).current).toEqual(CERRO)
  })

  it('un link a una sucursal que no es tuya no se cuela', () => {
    const waiter = scope({ branches: [AC], role: 'waiter', unrestricted: false, param: 'cerro' })
    expect(waiter.current).toEqual(AC)
    expect(waiter.ids).toEqual([AC_ID])
  })

  it('una cookie vieja de una sucursal que ya no tenés asignada cae a la tuya', () => {
    const host = scope({ branches: [CERRO], role: 'host', unrestricted: false, cookie: AC_ID })
    expect(host.current).toEqual(CERRO)
    expect(host.ids).toEqual([CERRO_ID])
  })

  it('el salón nunca queda en «Todas»', () => {
    const device = scope({ cookie: `all.${CERRO_ID}`, surface: 'device' })
    expect(device.isAll).toBe(false)
    expect(device.current).toEqual(CERRO)
    expect(device.canAll).toBe(false)
    const unknown = scope({ cookie: 'all', surface: 'device' })
    expect(unknown.needsChoice).toBe(true)
    expect(scope({ param: 'todas', surface: 'device', cookie: AC_ID }).current).toEqual(AC)
  })

  it('con una sola sucursal, «Todas» guardado no aplica', () => {
    const single = scope({ branches: [CERRO], role: 'waiter', unrestricted: false, cookie: 'all' })
    expect(single.isAll).toBe(false)
    expect(single.current).toEqual(CERRO)
  })

  it('la contadora y Contenido arrancan en «Todas» sin preguntar', () => {
    for (const role of ['accountant', 'editor'] as const) {
      const first = scope({ role })
      expect(first.isAll).toBe(true)
      expect(first.needsChoice).toBe(false)
    }
  })

  it('los roles del salón con varias sucursales también eligen en la entrada', () => {
    for (const role of ['host', 'cashier', 'waiter', 'kitchen'] as const) {
      expect(scope({ role, unrestricted: false }).needsChoice).toBe(true)
    }
  })

  it('sin ninguna sucursal: nada que mirar y nada que preguntar', () => {
    const none = scope({ branches: [], role: 'waiter', unrestricted: false })
    expect(none).toMatchObject({ current: null, ids: [], needsChoice: false, source: 'none' })
  })

  it('lo que cruza al navegador lleva los ids, no objetos de más', () => {
    const client = toClientScope(scope({ cookie: CERRO_ID }))
    expect(client.currentId).toBe(CERRO_ID)
    expect(client.deviceId).toBe(CERRO_ID)
    expect(client.branches).toHaveLength(2)
  })
})

describe('los filtros', () => {
  type Call = [string, string, string | readonly string[]]
  function fakeQuery() {
    const calls: Call[] = []
    const query = {
      eq(column: string, value: string) {
        calls.push(['eq', column, value])
        return query
      },
      in(column: string, values: readonly string[]) {
        calls.push(['in', column, values])
        return query
      },
    }
    return { query, calls }
  }

  it('una sucursal → eq; varias → in; un dueño en «Todas» → nada', () => {
    const one = fakeQuery()
    applyBranchFilter(one.query, branchFilterOf(scope({ cookie: CERRO_ID })))
    expect(one.calls).toEqual([['eq', 'branch_id', CERRO_ID]])

    const host = fakeQuery()
    applyBranchFilter(
      host.query,
      branchFilterOf(scope({ role: 'host', unrestricted: false, cookie: 'all' })),
    )
    expect(host.calls).toEqual([['in', 'branch_id', [AC_ID, CERRO_ID]]])

    const owner = fakeQuery()
    applyBranchFilter(owner.query, branchFilterOf(scope({ cookie: 'all' })))
    expect(owner.calls).toEqual([])
  })

  it('se puede filtrar por otra columna (reserva de una comisión)', () => {
    const q = fakeQuery()
    applyBranchFilter(q.query, { ids: [AC_ID] }, 'reservation.branch_id')
    expect(q.calls).toEqual([['eq', 'reservation.branch_id', AC_ID]])
  })

  it('sin sucursales no trae nada (lista vacía, no «todo»)', () => {
    const q = fakeQuery()
    applyBranchFilter(q.query, { ids: [] })
    expect(q.calls).toEqual([['in', 'branch_id', []]])
  })

  it('a la base le llega la sucursal o vacío (= las que la persona ve)', () => {
    expect(rpcBranchId(scope({ cookie: CERRO_ID }))).toBe(CERRO_ID)
    expect(rpcBranchId(scope({ cookie: 'all' }))).toBeNull()
  })

  it('descarta en vivo lo que no es de lo que se mira', () => {
    expect(inBranchFilter(CERRO_ID, { ids: [AC_ID] })).toBe(false)
    expect(inBranchFilter(AC_ID, { ids: [AC_ID] })).toBe(true)
    expect(inBranchFilter(null, { ids: [AC_ID] })).toBe(false)
    expect(inBranchFilter(CERRO_ID, WHOLE_BAR)).toBe(true)
  })

  it('lo que manda el navegador se recorta a lo que la persona ve hoy', () => {
    const host = scope({ branches: [CERRO], role: 'host', unrestricted: false })
    expect(clampBranchFilter({ ids: [AC_ID, CERRO_ID] }, host)).toEqual({ ids: [CERRO_ID] })
    expect(clampBranchFilter(WHOLE_BAR, host)).toEqual({ ids: [CERRO_ID] })
    expect(clampBranchFilter(null, scope({}))).toEqual({ ids: null })
    expect(clampBranchFilter({ ids: [NUEVA_ID] }, scope({}))).toEqual({ ids: [] })
  })

  it('al crear: la elegida si es tuya; si no mandás ninguna, la que mirás; en «Todas» hay que elegir', () => {
    expect(branchForWrite(scope({ cookie: AC_ID }), CERRO_ID)).toBe(CERRO_ID)
    expect(branchForWrite(scope({ cookie: CERRO_ID }), null)).toBe(CERRO_ID)
    expect(() => branchForWrite(scope({ cookie: 'all' }), null)).toThrow(BranchRequiredError)
    expect(() =>
      branchForWrite(scope({ branches: [AC], role: 'waiter', unrestricted: false }), CERRO_ID),
    ).toThrow(BranchForbiddenError)
    expect(
      branchForWrite(scope({ branches: [AC], role: 'waiter', unrestricted: false }), null),
    ).toBe(AC_ID)
  })
})

describe('lo que llega de la base', () => {
  it('arma cada sucursal y descarta lo que no sirve', () => {
    expect(
      parseBranchRef({
        id: CERRO_ID,
        name: 'Cerro',
        short_name: ' ',
        slug: 'cerro',
        color: '#A8452D',
        address: 'Rafael Núñez 4000',
        position: 1,
        is_default: false,
        opened_on: '2026-12-04',
        seat_capacity: 80,
      }),
    ).toEqual({ ...CERRO, shortName: null })
    expect(parseBranchRef({ id: CERRO_ID, name: '', slug: 'cerro' })).toBeNull()
    expect(parseBranchRef('cerro')).toBeNull()
    expect(parseBranchRef({ id: AC_ID, name: 'AC', slug: 'ac', color: 'rojo' })?.color).toBe(
      '#2f5d50',
    )
  })

  it('ordena la principal primero y saca repetidos; sin la clave, ninguna', () => {
    const rows = [
      { id: CERRO_ID, name: 'Cerro', slug: 'cerro', color: '#a8452d', position: 1 },
      {
        id: AC_ID,
        name: 'Alta Córdoba',
        slug: 'alta-cordoba',
        color: '#2f5d50',
        position: 0,
        is_default: true,
      },
      { id: CERRO_ID, name: 'Cerro', slug: 'cerro', color: '#a8452d', position: 1 },
    ]
    expect(parseBranchRefs(rows).map((branch) => branch.slug)).toEqual(['alta-cordoba', 'cerro'])
    expect(parseBranchRefs(undefined)).toEqual([])
  })

  it('el nombre corto, o el nombre', () => {
    expect(branchShortLabel(AC)).toBe('A. Córdoba')
    expect(branchShortLabel(CERRO)).toBe('Cerro')
  })
})

describe('el ?sucursal= que pasa el proxy', () => {
  it('solo un slug o «todas»', () => {
    expect(sanitizeBranchParam('Cerro')).toBe('cerro')
    expect(sanitizeBranchParam('alta-cordoba')).toBe('alta-cordoba')
    expect(sanitizeBranchParam('todas')).toBe('todas')
    expect(sanitizeBranchParam('<script>')).toBe('')
    expect(sanitizeBranchParam('a'.repeat(41))).toBe('')
    expect(sanitizeBranchParam(null)).toBe('')
  })
})

describe('qué pantallas se miran por sucursal', () => {
  it('lo de la noche es por sucursal; lo del bar, no', async () => {
    const { branchScopeForPath, barSectionName } = await import('@/lib/branches/sections')
    expect(branchScopeForPath('/hub', 'hub')).toBe('branch')
    expect(branchScopeForPath('/hub/reservas/nuevo', 'hub')).toBe('branch')
    expect(branchScopeForPath('/hub/operativo?fecha=2026-11-18', 'hub')).toBe('branch')
    expect(branchScopeForPath('/hub/eventos/programados', 'hub')).toBe('branch')
    expect(branchScopeForPath('/hub/eventos/templates', 'hub')).toBe('bar')
    expect(branchScopeForPath('/hub/estadisticas/como-nos-fue', 'hub')).toBe('branch')
    expect(branchScopeForPath('/hub/estadisticas', 'hub')).toBe('bar')
    expect(branchScopeForPath('/hub/mensajeria/inbox', 'hub')).toBe('bar')
    expect(branchScopeForPath('/hub/club', 'hub')).toBe('bar')
    expect(branchScopeForPath('/hub/reservasx', 'hub')).toBe('bar')
    expect(branchScopeForPath('/otro/reservas', 'hub')).toBe('bar')
    expect(barSectionName('/hub/mensajeria/inbox', 'hub')).toBe('Mensajería')
    expect(barSectionName('/hub/configuracion/equipo', 'hub')).toBe('La configuración')
  })

  it('Administración: compras, gastos fijos, caja y la ficha de un comprobante son de cada local', async () => {
    const { branchScopeForPath } = await import('@/lib/branches/sections')
    for (const path of [
      '/hub/administracion/compras',
      '/hub/administracion/compras/semana',
      '/hub/administracion/compras/proveedores/6011ae59-1a30-4119-a45b-4152b1ba10ed',
      '/hub/administracion/compras/nueva?modo=pago',
      '/hub/administracion/compras/gastos-fijos/nuevo',
      '/hub/administracion/gastos-fijos',
      '/hub/administracion/gastos-fijos/completar',
      '/hub/administracion/cajas',
      '/hub/administracion/cajas/6380c468-cf88-495c-a0f3-85e42279a355',
      '/hub/administracion/cajas/gasto-bancario',
      '/hub/administracion/comprobantes/6380c468-cf88-495c-a0f3-85e42279a355',
    ]) {
      expect(branchScopeForPath(path, 'hub'), path).toBe('branch')
    }
  })

  it('Administración: el resto sigue siendo de todo el bar (la píldora dice «Todo el bar»)', async () => {
    const { branchScopeForPath, barSectionName } = await import('@/lib/branches/sections')
    for (const path of [
      '/hub/administracion',
      '/hub/administracion/ventas',
      '/hub/administracion/ventas/cierre',
      '/hub/administracion/ventas/nueva-factura',
      '/hub/administracion/sueldos',
      '/hub/administracion/libros/sumas-y-saldos',
      '/hub/administracion/libros/asiento-manual',
      '/hub/administracion/asientos/6380c468-cf88-495c-a0f3-85e42279a355',
      '/hub/administracion/plan-de-cuentas',
      '/hub/administracion/ajustes',
      '/hub/administracion/guias/como-arrancar',
      '/hub/administracion/configurar',
      '/hub/administracion/importar/mercado-pago',
      '/hub/administracion/cajasx',
      '/hub/compras',
    ]) {
      expect(branchScopeForPath(path, 'hub'), path).toBe('bar')
    }
    expect(barSectionName('/hub/administracion', 'hub')).toBe('El resumen de Administración')
    expect(barSectionName('/hub/administracion/ventas/cierre', 'hub')).toBe('Ventas')
    expect(barSectionName('/hub/administracion/sueldos', 'hub')).toBe('Sueldos')
    expect(barSectionName('/hub/administracion/libros/mayor', 'hub')).toBe('La contabilidad')
    expect(barSectionName('/hub/administracion/ajustes', 'hub')).toBe(
      'Los ajustes de Administración',
    )
    expect(barSectionName('/hub/administracion/guias', 'hub')).toBe('Administración')
  })
})
