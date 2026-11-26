import { describe, expect, it } from 'vitest'
import {
  blindCloseResult,
  blindOpenResult,
  blindSnapshot,
  blindSummary,
  isBlindClose,
  openingMatches,
  seesSalonNumbers,
} from '@/lib/pos/cash/blind'
import { pickPartners } from '@/lib/pos/cash/partners'
import type { CloseShiftResult, OpenShiftResult, ShiftSnapshot } from '@/lib/pos/cash/types'
import { sampleLive, sampleNightClosed } from './pos-cashbox-samples'

/**
 * La caja a ciegas: quién ve los números del salón, y qué viaja al navegador de quien no los ve.
 */

const acc = (
  over: Partial<{ enabled: boolean; setUp: boolean; read: boolean; full: boolean }>,
) => ({
  enabled: true,
  setUp: true,
  read: false,
  ...over,
})

describe('quién ve los números del salón', () => {
  it('el dueño con acceso a Administración: sí (es socio)', () => {
    expect(seesSalonNumbers({ role: 'owner', accounting: acc({ read: true }) })).toBe(true)
  })

  it('el dueño sin acceso a Administración: no (es un encargado con usuario de dueño)', () => {
    expect(seesSalonNumbers({ role: 'owner', accounting: acc({ read: false }) })).toBe(false)
  })

  it('con acceso «solo compras y pagos» tampoco: lee Administración, pero no es socio', () => {
    expect(seesSalonNumbers({ role: 'owner', accounting: acc({ read: true, full: false }) })).toBe(
      false,
    )
    expect(seesSalonNumbers({ role: 'owner', accounting: acc({ read: true, full: true }) })).toBe(
      true,
    )
  })

  it('el cajero nunca, tenga el bar Administración o no', () => {
    expect(seesSalonNumbers({ role: 'cashier', accounting: acc({ read: true }) })).toBe(false)
    expect(seesSalonNumbers({ role: 'cashier', accounting: acc({ enabled: false }) })).toBe(false)
  })

  it('un bar sin Administración (o sin configurar) no tiene lista de socios: todos los dueños', () => {
    expect(seesSalonNumbers({ role: 'owner', accounting: acc({ enabled: false }) })).toBe(true)
    expect(seesSalonNumbers({ role: 'owner', accounting: acc({ setUp: false }) })).toBe(true)
  })
})

describe('qué viaja al navegador de quien no los ve', () => {
  const open: ShiftSnapshot = sampleLive('owner')
  const blind = blindSnapshot(open)

  it('queda marcada como a ciegas y con permisos de caja (no de dueño)', () => {
    expect(blind.blind).toBe(true)
    expect(blind.role).toBe('cashier')
  })

  it('no viaja ningún total: ni lo que entró, ni por medio, ni con y sin factura, ni el cajón', () => {
    const live = blind.live
    expect(live).not.toBeNull()
    expect(live?.by_method).toEqual([])
    expect(live?.collected_cents).toBe(0)
    expect(live?.sales_cents).toBe(0)
    expect(live?.invoiced_cents).toBe(0)
    expect(live?.not_invoiced_cents).toBe(0)
    expect(live?.expected_cash_cents).toBe(0)
    expect(live?.cash_sales_cents).toBe(0)
    expect(live?.tip_cents).toBe(0)
    expect(live?.per_person_cents).toBeNull()
    expect(live?.discounts).toEqual([])
    expect(live?.item_voids).toEqual([])
    expect(live?.corrections).toEqual([])
    expect(live?.open_tables.pending_cents).toBe(0)
  })

  it('queda lo que hace falta para operar: los movimientos del cajón, cuántos cobros y cuántas mesas', () => {
    expect(blind.live?.movements).toEqual(open.live?.movements)
    expect(blind.live?.payments_count).toBe(open.live?.payments_count)
    expect(blind.live?.open_tables.count).toBe(open.live?.open_tables.count)
    expect(blind.live?.opening_float_cents).toBe(open.live?.opening_float_cents)
    // Las cajas viajan (hay que poder elegir cuál se abre), sin lo que dejó su último turno.
    expect(blind.registers.map((r) => [r.id, r.name, r.open_shift_id])).toEqual(
      open.registers.map((r) => [r.id, r.name, r.open_shift_id]),
    )
  })

  it('los cobros del turno abierto siguen (hay que poder corregir uno); los de otros turnos, no', () => {
    const shiftId = open.shift?.id
    const withOther: ShiftSnapshot = {
      ...open,
      payments: [
        ...open.payments,
        ...open.payments.slice(0, 1).map((p) => ({ ...p, id: 'otro', shift_id: 'turno-viejo' })),
      ],
    }
    const out = blindSnapshot(withOther)
    expect(out.payments.length).toBe(open.payments.filter((p) => p.shift_id === shiftId).length)
    expect(out.payments.every((p) => p.shift_id === shiftId)).toBe(true)
  })

  it('un turno cerrado no trae el resumen, cuánto tenía que haber, la diferencia ni sus cobros', () => {
    const closed = blindSnapshot(sampleNightClosed())
    expect(closed.shift?.status).toBe('closed')
    expect(closed.shift?.summary).toBeNull()
    expect(closed.shift?.expected_cash_cents).toBeNull()
    expect(closed.shift?.difference_cents).toBeNull()
    expect(closed.payments).toEqual([])
  })

  it('un turno cerrado tampoco dice cuánto se contó ni cuánto quedó de cambio: es lo que cuenta quien abre el siguiente', () => {
    const source = sampleNightClosed()
    expect(source.shift?.counted_cash_cents).toBeGreaterThan(0)
    expect(source.shift?.leave_float_cents).toBeGreaterThan(0)
    const closed = blindSnapshot(source)
    expect(closed.shift?.counted_cash_cents).toBeNull()
    expect(closed.shift?.count_breakdown).toBeNull()
    expect(closed.shift?.leave_float_cents).toBeNull()
    expect(closed.shift?.closing_note).toBeNull()
    // Ni con cuánto había abierto (casi siempre se deja el mismo cambio), ni sus retiros.
    expect(closed.shift?.opening_float_cents).toBe(0)
    expect(closed.live).toBeNull()
    // Quién cerró y cuándo sí: sirve para ubicarse y no es un número.
    expect(closed.shift?.closed_by_name).toBe(source.shift?.closed_by_name)
    expect(closed.shift?.closed_at).toBe(source.shift?.closed_at)
  })

  it('la caja no dice cuánto dejó su último turno (con eso se compara lo que cuente quien abre)', () => {
    const source = sampleNightClosed()
    const left = source.registers.map((r) => r.last_closed?.leave_float_cents ?? null)
    expect(left.some((cents) => cents !== null && cents > 0)).toBe(true)
    const closed = blindSnapshot(source)
    for (const register of closed.registers) {
      if (!register.last_closed) continue
      expect(register.last_closed.leave_float_cents).toBeNull()
      // Qué turno fue, quién lo cerró y cuándo, sí.
      const original = source.registers.find((r) => r.id === register.id)?.last_closed
      expect(register.last_closed.shift_id).toBe(original?.shift_id)
      expect(register.last_closed.closed_by_name).toBe(original?.closed_by_name)
    }
    // Y no quedó en ningún otro rincón de lo que viaja.
    const text = JSON.stringify(closed)
    for (const cents of left) {
      if (cents !== null && cents > 0) expect(text).not.toContain(String(cents))
    }
  })

  it('con el turno abierto, lo que el turno anterior había dejado tampoco viaja', () => {
    const withExpected: ShiftSnapshot = {
      ...open,
      shift: open.shift ? { ...open.shift, opening_expected_cents: 1_234_500 } : null,
      live: open.live ? { ...open.live, opening_expected_cents: 1_234_500 } : null,
    }
    const out = blindSnapshot(withExpected)
    expect(out.shift?.opening_expected_cents).toBeNull()
    expect(out.live?.opening_expected_cents).toBeNull()
    expect(JSON.stringify(out)).not.toContain('1234500')
    // Con cuánto abrió (lo que contó quien abrió) sí.
    expect(out.shift?.opening_float_cents).toBe(open.shift?.opening_float_cents)
  })

  it('en todo lo que viaja no queda ninguno de los montos del resumen', () => {
    const source = sampleNightClosed()
    const text = JSON.stringify(blindSnapshot(source))
    const summary = source.shift?.summary
    expect(summary).toBeTruthy()
    for (const cents of [
      summary?.collected_cents,
      summary?.sales_cents,
      summary?.not_invoiced_cents,
      summary?.consumption_cents,
    ]) {
      // Montos grandes y propios del turno: si aparecen, se coló un número.
      if (cents && cents > 100_000) expect(text).not.toContain(String(cents))
    }
  })

  it('el resumen a ciegas es el mismo se llame con el turno abierto o cerrado', () => {
    const live = open.live
    if (!live) throw new Error('la muestra tiene que traer números')
    expect(blindSummary(blindSummary(live))).toEqual(blindSummary(live))
  })
})

describe('cerrar a ciegas', () => {
  const result: CloseShiftResult = {
    shift_id: 's1',
    already_closed: false,
    expected_cash_cents: 5_550_000,
    counted_cash_cents: 5_500_000,
    difference_cents: -50_000,
    leave_float_cents: 1_500_000,
    withdrawn_cents: 4_000_000,
    summary: sampleNightClosed().shift?.summary as CloseShiftResult['summary'],
  }

  it('vuelve lo que se contó, lo que queda y lo que se retira; ni el esperado ni la diferencia', () => {
    const blind = blindCloseResult(result)
    expect(blind).toEqual({
      blind: true,
      shift_id: 's1',
      already_closed: false,
      counted_cash_cents: 5_500_000,
      leave_float_cents: 1_500_000,
      withdrawn_cents: 4_000_000,
    })
    expect(isBlindClose(blind)).toBe(true)
    expect(isBlindClose(result)).toBe(false)
  })
})

describe('a quién le llega el cierre', () => {
  const owners = ['tomas', 'piojo', 'encargados']

  it('con Administración: los dueños con acceso completo', () => {
    expect(
      pickPartners({
        ownerIds: owners,
        accountingOn: true,
        grants: [
          { userId: 'tomas', scope: null },
          { userId: 'piojo', scope: 'full' },
        ],
      }),
    ).toEqual(['tomas', 'piojo'])
  })

  it('un acceso «solo compras y pagos» no recibe el cierre', () => {
    expect(
      pickPartners({
        ownerIds: owners,
        accountingOn: true,
        grants: [
          { userId: 'tomas', scope: 'full' },
          { userId: 'encargados', scope: 'purchases' },
        ],
      }),
    ).toEqual(['tomas'])
  })

  it('quien tiene acceso pero ya no es dueño del bar, tampoco', () => {
    expect(
      pickPartners({
        ownerIds: ['tomas'],
        accountingOn: true,
        grants: [
          { userId: 'tomas', scope: null },
          { userId: 'contadora', scope: null },
        ],
      }),
    ).toEqual(['tomas'])
  })

  it('sin Administración, o sin ningún acceso completo, todos los dueños: nunca se queda sin destinatario', () => {
    expect(pickPartners({ ownerIds: owners, accountingOn: false, grants: [] })).toEqual(owners)
    expect(
      pickPartners({
        ownerIds: owners,
        accountingOn: true,
        grants: [{ userId: 'encargados', scope: 'purchases' }],
      }),
    ).toEqual(owners)
  })

  it('no repite a nadie', () => {
    expect(pickPartners({ ownerIds: ['a', 'a', 'b'], accountingOn: false, grants: [] })).toEqual([
      'a',
      'b',
    ])
  })
})

describe('abrir a ciegas: se cuenta el cajón sin saber cuánto dejó el turno anterior', () => {
  const opened: OpenShiftResult = {
    shift_id: 'turno-nuevo',
    register_id: 'caja-1',
    already_open: false,
    opening_float_cents: 1_200_000,
    opening_expected_cents: 1_500_000,
  }

  it('la respuesta de abrir no trae lo que había dejado el turno anterior', () => {
    const out = blindOpenResult(opened)
    expect(out.opening_expected_cents).toBeNull()
    expect(out.opening_float_cents).toBe(1_200_000)
    expect(JSON.stringify(out)).not.toContain('1500000')
  })

  it('la única pregunta que se contesta es si coincide, por sí o por no', () => {
    expect(openingMatches(1_500_000, 1_500_000)).toBe(true)
    expect(openingMatches(1_500_000, 1_200_000)).toBe(false)
    expect(openingMatches(1_500_000, 1_500_001)).toBe(false)
    expect(openingMatches(0, 0)).toBe(true)
    expect(openingMatches(0, 100)).toBe(false)
  })

  it('sin turno anterior (la primera vez de una caja) no hay con qué comparar: no se pide recuento', () => {
    expect(openingMatches(null, 1_200_000)).toBe(true)
    expect(openingMatches(undefined, 0)).toBe(true)
  })
})
