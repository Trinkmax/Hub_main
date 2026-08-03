import { describe, expect, it } from 'vitest'
import { describeFlowAction } from '@/lib/flows/execution-log'
import { hasActiveLogFilters, resolveLogRange } from '@/lib/flows/execution-log-filters'
import { formatWaitLabel } from '@/lib/flows/execution-log-labels'

// El label que guarda el registro es lo ÚNICO que el dueño lee en la columna
// "Acción" meses después: se congela en la fila, así que tiene que ser legible
// aun si la plantilla o la etiqueta ya no existen.

describe('describeFlowAction', () => {
  it('describe el mensaje con canal y plantilla', () => {
    expect(
      describeFlowAction('send_template', null, {
        templateName: 'bienvenida_club',
        channelType: 'whatsapp',
      }),
    ).toBe('WhatsApp: bienvenida_club')
  })

  it('usa el canal de Instagram cuando corresponde', () => {
    expect(
      describeFlowAction('send_template', null, {
        templateName: 'promo',
        channelType: 'instagram',
      }),
    ).toBe('Instagram: promo')
  })

  it('cae a "Mensaje" si no se puede resolver ni canal ni plantilla', () => {
    expect(describeFlowAction('send_template')).toBe('Mensaje')
  })

  it('muestra sólo el canal si falta el nombre de la plantilla (plantilla borrada)', () => {
    expect(describeFlowAction('send_template', null, { channelType: 'whatsapp' })).toBe('WhatsApp')
  })

  it('formatea la espera en horas', () => {
    expect(describeFlowAction('wait', { minutes: 120 })).toBe('Esperar 2 h')
  })

  it('formatea la espera en días', () => {
    expect(describeFlowAction('wait', { minutes: 4320 })).toBe('Esperar 3 días')
  })

  it('cae a "Esperar" si los minutos vienen corruptos', () => {
    expect(describeFlowAction('wait', { minutes: 'un rato' })).toBe('Esperar')
  })

  it('reconstruye la condición numérica con el nombre visible del campo', () => {
    expect(
      describeFlowAction('condition', {
        field: 'customer.total_visits',
        op: 'gt',
        value: 3,
      }),
    ).toBe('¿Cantidad de visitas es más de 3?')
  })

  it('muestra la plata en pesos, no en centavos', () => {
    const label = describeFlowAction('condition', {
      field: 'customer.total_spent_cents',
      op: 'gte',
      value: 5_000_00,
    })
    expect(label).toContain('Plata gastada en total es como mínimo')
    expect(label).toContain('5.000')
  })

  it('resuelve las condiciones booleanas como Sí/No', () => {
    expect(
      describeFlowAction('condition', { field: 'customer.opt_in_marketing', op: 'is_true' }),
    ).toBe('¿Acepta recibir promos: Sí?')
    expect(
      describeFlowAction('condition', { field: 'customer.opt_in_marketing', op: 'is_false' }),
    ).toBe('¿Acepta recibir promos: No?')
  })

  it('cae a "Condición" si el paso no tiene campo', () => {
    expect(describeFlowAction('condition', {})).toBe('Condición')
  })

  it('nombra la etiqueta', () => {
    expect(describeFlowAction('add_tag', { tag_id: 'x' }, { tagName: 'VIP' })).toBe(
      'Etiquetar: VIP',
    )
  })

  it('cae a "Etiquetar" si la etiqueta fue borrada', () => {
    expect(describeFlowAction('add_tag', { tag_id: 'x' })).toBe('Etiquetar')
  })

  it('etiqueta los eventos de ciclo de vida', () => {
    expect(describeFlowAction('trigger')).toBe('Inicio')
    expect(describeFlowAction('enrolled')).toBe('Entró al flujo')
    expect(describeFlowAction('completed')).toBe('Terminó el flujo')
    expect(describeFlowAction('failed')).toBe('Se cortó por un error')
  })
})

describe('formatWaitLabel', () => {
  it('minutos sueltos', () => {
    expect(formatWaitLabel(45)).toBe('45 min')
  })

  it('horas exactas', () => {
    expect(formatWaitLabel(180)).toBe('3 h')
  })

  it('horas con resto', () => {
    expect(formatWaitLabel(90)).toBe('1 h 30 min')
  })

  it('un día y varios días', () => {
    expect(formatWaitLabel(1440)).toBe('1 día')
    expect(formatWaitLabel(2880)).toBe('2 días')
  })

  it('devuelve vacío ante valores inválidos', () => {
    expect(formatWaitLabel(0)).toBe('')
    expect(formatWaitLabel(Number.NaN)).toBe('')
    expect(formatWaitLabel(-30)).toBe('')
  })
})

describe('resolveLogRange', () => {
  // Córdoba = UTC-3: el 1/8 a las 02:00 UTC todavía es 31/7 en el bar.
  const now = new Date('2026-08-01T02:00:00.000Z')

  it('por defecto arma los últimos 30 días en hora del bar', () => {
    const range = resolveLogRange({}, now)
    expect(range.hasta).toBe('2026-07-31')
    expect(range.desde).toBe('2026-07-02')
    expect(range.fromIso).toBe('2026-07-02T03:00:00.000Z')
  })

  it('el tope incluye el último día completo (arranque del día siguiente)', () => {
    const range = resolveLogRange({ desde: '2026-08-01', hasta: '2026-08-01' }, now)
    expect(range.fromIso).toBe('2026-08-01T03:00:00.000Z')
    expect(range.toIso).toBe('2026-08-02T03:00:00.000Z')
  })

  it('endereza el rango si viene dado vuelta', () => {
    const range = resolveLogRange({ desde: '2026-08-10', hasta: '2026-08-01' }, now)
    expect(range.desde).toBe('2026-08-01')
    expect(range.hasta).toBe('2026-08-10')
  })
})

describe('hasActiveLogFilters', () => {
  it('el rango por defecto no cuenta como filtro', () => {
    expect(hasActiveLogFilters({ page: 1 })).toBe(false)
  })

  it('detecta cualquier filtro puesto a mano', () => {
    expect(hasActiveLogFilters({ page: 1, estado: 'waiting' })).toBe(true)
    expect(hasActiveLogFilters({ page: 1, desde: '2026-01-01' })).toBe(true)
    expect(hasActiveLogFilters({ page: 2, accion: 'send_template' })).toBe(true)
  })
})
