import { describe, expect, it } from 'vitest'
import {
  daysUntilLabel,
  guestShortName,
  paymentTypeLabel,
  transferProofMessage,
} from '@/lib/ticketing/copy'
import { serviceDayIn } from '@/lib/ticketing/dates'
import { orderEntryFrom } from '@/lib/ticketing/door'

describe('paymentTypeLabel', () => {
  it('dice el medio como lo dice una persona', () => {
    expect(paymentTypeLabel('credit_card')).toBe('Tarjeta de crédito')
    expect(paymentTypeLabel('debit_card')).toBe('Tarjeta de débito')
    expect(paymentTypeLabel('prepaid_card')).toBe('Tarjeta prepaga')
    expect(paymentTypeLabel('account_money')).toBe('Dinero en cuenta')
  })
  it('uno desconocido, o sin dato: Mercado Pago', () => {
    expect(paymentTypeLabel('otro')).toBe('Mercado Pago')
    expect(paymentTypeLabel(null)).toBe('Mercado Pago')
  })
})

describe('transferProofMessage', () => {
  it('lleva lo que hace falta para cargar la reserva a mano', () => {
    expect(
      transferProofMessage({
        tenantName: 'HUB',
        title: 'Shrek 2',
        dateLabel: 'lunes 1 de diciembre',
        time: '21:00',
        partySize: 2,
        guestName: 'Juan',
        amountLabel: '$ 40.000',
        alias: 'mi.bar.pagos',
        code: 'E38D8CEB',
      }),
    ).toBe(
      '¡Hola HUB! Mercado Pago me rechazó el pago, así que transferí $ 40.000 al alias mi.bar.pagos. Es para Shrek 2, lunes 1 de diciembre a las 21:00 hs, 2 personas, a nombre de Juan (entrada #E38D8CEB). Te paso el comprobante.',
    )
  })
})

describe('guestShortName', () => {
  it('primer nombre e inicial del último apellido', () => {
    expect(guestShortName('Ignacio Baldovino')).toBe('Ignacio B.')
    expect(guestShortName('  ana maría  pérez ')).toBe('ana P.')
  })
  it('un solo nombre queda igual', () => {
    expect(guestShortName('Luz')).toBe('Luz')
  })
})

describe('daysUntilLabel', () => {
  it('hoy, mañana y los que faltan', () => {
    expect(daysUntilLabel('2026-12-01', '2026-12-01')).toBe('Es hoy')
    expect(daysUntilLabel('2026-12-02', '2026-12-01')).toBe('Es mañana')
    expect(daysUntilLabel('2026-12-01', '2026-11-03')).toBe('Faltan 28 días')
  })
  it('una fecha pasada no dice nada', () => {
    expect(daysUntilLabel('2026-11-01', '2026-11-03')).toBeNull()
  })
})

describe('serviceDayIn', () => {
  const TZ = 'America/Argentina/Cordoba'
  it('a la 1 de la mañana sigue siendo ayer', () => {
    // 01:00 en Córdoba = 04:00 UTC
    expect(serviceDayIn(TZ, new Date('2026-12-02T04:00:00Z'))).toBe('2026-12-01')
  })
  it('desde las 5 ya es hoy', () => {
    // 05:00 en Córdoba = 08:00 UTC
    expect(serviceDayIn(TZ, new Date('2026-12-02T08:00:00Z'))).toBe('2026-12-02')
  })
})

describe('orderEntryFrom', () => {
  const at = () => '21:04'

  it('sin reserva: nadie entró', () => {
    expect(orderEntryFrom(null, 2, at)).toEqual({
      inside: 0,
      total: 2,
      atLabel: null,
      cancelled: false,
    })
  })

  it('un grupo a medio entrar', () => {
    expect(
      orderEntryFrom(
        {
          status: 'arrived',
          estimated_guests: 4,
          actual_guests: 2,
          arrived_at: '2026-12-02T00:04:00Z',
        },
        4,
        at,
      ),
    ).toEqual({ inside: 2, total: 4, atLabel: '21:04', cancelled: false })
  })

  it('marcada a mano sin contar: entraron todos', () => {
    const entry = orderEntryFrom(
      { status: 'seated', estimated_guests: 2, actual_guests: null, arrived_at: null },
      2,
      at,
    )
    expect(entry.inside).toBe(2)
    expect(entry.atLabel).toBeNull()
  })

  it('cancelada', () => {
    expect(
      orderEntryFrom(
        { status: 'cancelled', estimated_guests: 2, actual_guests: null, arrived_at: null },
        2,
        at,
      ).cancelled,
    ).toBe(true)
  })
})
