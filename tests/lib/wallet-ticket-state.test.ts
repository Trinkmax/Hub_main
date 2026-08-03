import { describe, expect, it } from 'vitest'
import {
  type DeliveredRedemption,
  resolveActiveTicket,
  shouldCelebrateDelivery,
} from '@/lib/wallet/ticket-state'

const ticket = (redemptionId: string) => ({ redemptionId })

describe('resolveActiveTicket', () => {
  it('muestra el canje recién pedido antes de que el server lo confirme', () => {
    const r = resolveActiveTicket({
      issued: ticket('A'),
      fromServer: null,
      acknowledgedId: null,
      cancelledId: null,
    })
    expect(r.ticket?.redemptionId).toBe('A')
  })

  it('cuando el server lo confirma, gana el server y queda acusado', () => {
    const r = resolveActiveTicket({
      issued: ticket('A'),
      fromServer: ticket('A'),
      acknowledgedId: null,
      cancelledId: null,
    })
    expect(r.ticket?.redemptionId).toBe('A')
    expect(r.acknowledgedId).toBe('A')
  })

  // El bug original: el mozo validaba y el QR seguía en pantalla para siempre,
  // bloqueando cualquier canje nuevo.
  it('lo saca de pantalla cuando el server deja de mandarlo después de acusarlo', () => {
    const r = resolveActiveTicket({
      issued: ticket('A'),
      fromServer: null,
      acknowledgedId: 'A',
      cancelledId: null,
    })
    expect(r.ticket).toBeNull()
  })

  it('no lo saca si el server todavía no lo vio (refresh en camino)', () => {
    const r = resolveActiveTicket({
      issued: ticket('B'),
      fromServer: null,
      acknowledgedId: 'A',
      cancelledId: null,
    })
    expect(r.ticket?.redemptionId).toBe('B')
  })

  it('tapa el que el payload viejo sigue trayendo después de cancelar', () => {
    const r = resolveActiveTicket({
      issued: null,
      fromServer: ticket('A'),
      acknowledgedId: 'A',
      cancelledId: 'A',
    })
    expect(r.ticket).toBeNull()
  })

  it('deja pedir uno nuevo después de que se entregó el anterior', () => {
    const entregado = resolveActiveTicket({
      issued: ticket('A'),
      fromServer: null,
      acknowledgedId: 'A',
      cancelledId: null,
    })
    expect(entregado.ticket).toBeNull()

    const nuevo = resolveActiveTicket({
      issued: ticket('B'),
      fromServer: null,
      acknowledgedId: 'A',
      cancelledId: null,
    })
    expect(nuevo.ticket?.redemptionId).toBe('B')
  })

  it('sin nada de ningún lado no muestra nada', () => {
    const r = resolveActiveTicket({
      issued: null,
      fromServer: null,
      acknowledgedId: null,
      cancelledId: null,
    })
    expect(r.ticket).toBeNull()
    expect(r.acknowledgedId).toBeNull()
  })
})

describe('shouldCelebrateDelivery', () => {
  const now = new Date('2026-08-03T18:00:00Z').getTime()
  const delivered = (deliveredAt: string): DeliveredRedemption => ({
    redemptionId: 'A',
    rewardName: 'Noche de Ramen',
    pointsSpent: 350,
    deliveredAt,
  })

  it('festeja una entrega de hace 10 segundos', () => {
    expect(shouldCelebrateDelivery(delivered('2026-08-03T17:59:50Z'), [], now)).toBe(true)
  })

  it('no festeja una entrega de hace una hora', () => {
    expect(shouldCelebrateDelivery(delivered('2026-08-03T17:00:00Z'), [], now)).toBe(false)
  })

  it('no repite un festejo ya mostrado', () => {
    expect(shouldCelebrateDelivery(delivered('2026-08-03T17:59:50Z'), ['A'], now)).toBe(false)
  })

  it('sin entrega no hay festejo', () => {
    expect(shouldCelebrateDelivery(null, [], now)).toBe(false)
  })

  it('tolera el reloj del celular adelantado respecto del server', () => {
    expect(shouldCelebrateDelivery(delivered('2026-08-03T18:00:30Z'), [], now)).toBe(true)
  })

  it('ignora una fecha que no se puede parsear', () => {
    expect(shouldCelebrateDelivery(delivered('no-es-una-fecha'), [], now)).toBe(false)
  })
})
