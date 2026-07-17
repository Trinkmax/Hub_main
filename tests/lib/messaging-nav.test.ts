import { describe, expect, it } from 'vitest'
import { visibleMessagingNav } from '@/components/shell/messaging-nav'

describe('visibleMessagingNav', () => {
  it('owner ve todos los ítems (inbox + campañas + configuración)', () => {
    const labels = visibleMessagingNav('owner').flatMap((g) => g.items.map((i) => i.label))
    expect(labels).toEqual([
      'Inbox',
      'Difusiones',
      'Automatizaciones',
      'Audiencias',
      'Canales',
      'Plantillas',
      'Mensajes rápidos',
      'Etiquetas',
    ])
  })

  it('cashier ve sólo Inbox + Mensajes rápidos', () => {
    const labels = visibleMessagingNav('cashier').flatMap((g) => g.items.map((i) => i.label))
    expect(labels).toEqual(['Inbox', 'Mensajes rápidos', 'Etiquetas'])
  })

  it('no devuelve grupos vacíos', () => {
    for (const group of visibleMessagingNav('cashier')) {
      expect(group.items.length).toBeGreaterThan(0)
    }
  })
})
