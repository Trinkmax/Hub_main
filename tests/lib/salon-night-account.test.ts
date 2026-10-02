import { describe, expect, it } from 'vitest'
import {
  type EventMarketingRow,
  hasNightAccount,
  howItsCalculated,
  MARKETING_EXPORT_HEADERS,
  type MarketingBlock,
  marketingCsvCells,
  NIGHT_ACCOUNT_ACTION_LABELS,
  NIGHT_ACCOUNT_TITLE,
  NIGHT_RESULT_DISCLAIMER,
  nightAccountView,
  nightHowItsCalculated,
} from '@/lib/salon/event-marketing'
import { firstEmptyField, marketingCopy } from '@/lib/salon/event-marketing-draft'

// C2 de los socios (02/10/2026): «no entiendo porque a veces hace "la cuenta de
// la noche" y a veces no.. Para el ojo de los que leemos los reportes, es ideal
// que siempre tenga la misma info». La caja está SIEMPRE (regla 13 nueva).

function row(over: Partial<EventMarketingRow> = {}): EventMarketingRow {
  return {
    scheduledEventId: 'ev',
    adSpendUsdCents: 0,
    messages: null,
    reach: null,
    revenueArsCents: null,
    usdArsRate: null,
    revenuePerGuestArsCents: null,
    costPerGuestArsCents: null,
    drinkRevenuePerGuestArsCents: null,
    drinkCostPerGuestArsCents: null,
    notes: null,
    updatedAt: '2026-09-24T15:30:00Z',
    updatedByName: 'Nacho B.',
    ...over,
  }
}

/** 2x1 Burger Martes 22/09: pauta y mensajes, sin la plata ni el dólar. */
const BURGER_2209: MarketingBlock = {
  reservations: 10,
  guests: 26,
  billableGuests: 25,
  attendedGuests: 25,
}
const BURGER_2209_ROW = row({ adSpendUsdCents: 4782, messages: 48 })

/** Ratatuille 22/09: noche orgánica con su cuenta. */
const RATA_2209: MarketingBlock = {
  reservations: 19,
  guests: 52,
  billableGuests: 52,
  attendedGuests: 52,
}
const RATA_2209_ROW = row({ revenuePerGuestArsCents: 25_000_00, costPerGuestArsCents: 7_200_00 })

const nb = (t: string) => t.replace(/\$ /g, '$\u00A0')

describe('«La cuenta de la noche» está SIEMPRE (C2)', () => {
  it('las dos fichas del 22/09 tienen la misma caja: Ratatuille cerrada, 2x1 sin cargar', () => {
    const rata = nightAccountView(RATA_2209, RATA_2209_ROW, 'past')
    const burger = nightAccountView(BURGER_2209, BURGER_2209_ROW, 'past')
    expect(rata.status).toBe('completa')
    expect(rata.report?.headline).toBe(nb('La noche dejó $ 925.600.'))
    expect(rata.action).toBe('edit')
    expect(burger.status).toBe('sin-cargar')
    expect(burger.chip).toEqual({ text: 'Sin cargar', tone: 'warning' })
    expect(burger.lead).toBe(
      'Faltan el ingreso y el costo por persona, y el dólar del día, para saber si la noche dejó plata.',
    )
    expect(burger.action).toBe('load')
  })

  it('sin fila de pauta también hay caja, y nombra la pauta entre lo que falta', () => {
    const v = nightAccountView(BURGER_2209, null, 'past')
    expect(v.status).toBe('sin-cargar')
    expect(v.lead).toBe(
      'Faltan la pauta, el ingreso y el costo por persona para saber si la noche dejó plata.',
    )
  })

  it('«No tuvo pauta» pelada: falta solo la plata', () => {
    expect(nightAccountView(RATA_2209, row(), 'past').lead).toBe(
      'Faltan el ingreso y el costo por persona para saber si la noche dejó plata.',
    )
  })

  it('a medio cargar: la cuenta hasta donde da, «Incompleta» y «Completar»', () => {
    const v = nightAccountView(
      BURGER_2209,
      row({ adSpendUsdCents: 4782, messages: 48, revenuePerGuestArsCents: 11_500_00 }),
      'past',
    )
    expect(v.status).toBe('incompleta')
    expect(v.chip).toEqual({ text: 'Incompleta', tone: 'warning' })
    expect(v.report?.headline).toBe(nb('El ingreso de la noche fue $ 287.500.'))
    expect(v.report?.missing).toBe(
      'Falta el costo por persona para sacar el resultado de la noche.',
    )
    expect(v.action).toBe('complete')
  })

  it('la facturación sola ahora abre la cuenta, también con pauta (reemplaza a la vieja regla 13)', () => {
    const vieja = row({
      adSpendUsdCents: 17526,
      messages: 51,
      revenueArsCents: 2_480_000_00,
      usdArsRate: 1450,
    })
    expect(hasNightAccount(vieja)).toBe(true)
    const v = nightAccountView({ reservations: 11, guests: 29, billableGuests: 29 }, vieja, 'past')
    expect(v.status).toBe('incompleta')
    expect(v.report?.headline).toBe(nb('El ingreso de la noche fue $ 2.480.000.'))
    expect(v.report?.missing).toBe(
      'Falta el costo por persona para sacar el resultado de la noche.',
    )
  })

  it('sin gente: lo dice y no ofrece cargar', () => {
    const nadie = nightAccountView({ reservations: 0, guests: 0, billableGuests: 0 }, null, 'past')
    expect(nadie).toMatchObject({ status: 'sin-gente', chip: null, action: null })
    expect(nadie.lead).toBe(
      'No quedó ninguna reserva en pie: no hay gente con la que hacer la cuenta.',
    )
    const ceros = nightAccountView({ reservations: 3, guests: 8, billableGuests: 0 }, null, 'past')
    expect(ceros.lead).toBe(
      'Se contaron 0 personas al cerrar las mesas: no hay gente con la que hacer la cuenta.',
    )
  })

  it('hoy y lo que viene: sin ámbar, se puede cargar antes', () => {
    const v = nightAccountView(BURGER_2209, null, 'future')
    expect(v).toMatchObject({ status: 'sin-cargar', chip: null, action: 'load' })
    expect(v.lead).toBe(
      'Todavía no se cargó. El ingreso y el costo por persona se pueden cargar antes: el cubierto se sabe de antemano.',
    )
    const sinNadie = nightAccountView(
      { reservations: 0, guests: 0, billableGuests: 0 },
      null,
      'tonight',
    )
    expect(sinNadie.lead).toBe(
      'Todavía no hay reservas en pie: la cuenta se hace con la gente de la noche. El ingreso y el costo por persona se pueden cargar antes: el cubierto se sabe de antemano.',
    )
    const cargada = nightAccountView(RATA_2209, RATA_2209_ROW, 'future')
    expect(cargada.chip).toEqual({ text: 'Por ahora', tone: 'muted' })
    expect(cargada.report?.headline).toBe(nb('Por ahora la noche va dejando $ 925.600.'))
  })
})

describe('«¿Cómo se calcula?», partido en dos', () => {
  it('la pauta ya no habla de la cuenta; la cuenta trae lo suyo', () => {
    const pauta = howItsCalculated(BURGER_2209_ROW)
    expect(pauta.some((b) => b.startsWith('Resultado de la noche'))).toBe(false)
    expect(pauta.at(-1)).toBe(
      'Las reservas se toman como están ahora: si se cancela una, estos números cambian.',
    )
    const cuenta = nightHowItsCalculated(BURGER_2209_ROW)
    expect(cuenta[0]).toContain('menos la pauta pasada a pesos con el dólar del día.')
    expect(cuenta).toContain(NIGHT_RESULT_DISCLAIMER)
  })

  it('sin pauta, la sección de Meta no tiene nada que explicar', () => {
    expect(howItsCalculated(RATA_2209_ROW)).toEqual([])
    expect(nightHowItsCalculated(RATA_2209_ROW)[0]).toContain(
      'Sin pauta no hay nada más que restar.',
    )
  })

  it('sin fila: la versión general, que nombra la pauta como opcional', () => {
    expect(nightHowItsCalculated(null)[0]).toContain('si hubo pauta.')
  })
})

describe('la caja: título, botones y los casos de borde', () => {
  it('el título y los tres botones', () => {
    expect(NIGHT_ACCOUNT_TITLE).toBe('La cuenta de la noche')
    expect(NIGHT_ACCOUNT_ACTION_LABELS).toEqual({
      load: 'Cargar la cuenta',
      complete: 'Completar la cuenta',
      edit: 'Editar la cuenta',
    })
  })

  it('el nombre accesible del botón contiene lo que se ve y dice de qué noche es', () => {
    const aria = marketingCopy('Ramen', '2026-09-07').nightAria
    expect(aria).toEqual({
      load: 'Cargar la cuenta de Ramen del 07/09',
      complete: 'Completar la cuenta de Ramen del 07/09',
      edit: 'Editar la cuenta de Ramen del 07/09',
    })
    for (const kind of ['load', 'complete', 'edit'] as const) {
      expect(aria[kind].startsWith(NIGHT_ACCOUNT_ACTION_LABELS[kind])).toBe(true)
    }
  })

  it('con la pauta sin dólar y la plata completa, falta el dólar: «Completar»', () => {
    const v = nightAccountView(
      BURGER_2209,
      row({
        adSpendUsdCents: 4782,
        messages: 48,
        revenuePerGuestArsCents: 14_500_00,
        costPerGuestArsCents: 6_500_00,
      }),
      'past',
    )
    expect(v.status).toBe('incompleta')
    expect(v.action).toBe('complete')
    expect(v.report?.missing).toBe(
      'Falta el dólar del día para pasar la pauta a pesos: por ahora, esto es el margen bruto.',
    )
  })

  it('a futuro sin gente y con el cubierto cargado: «Por ahora», falta la noche (no un dato)', () => {
    const v = nightAccountView(
      { reservations: 0, guests: 0, billableGuests: 0 },
      row({ revenuePerGuestArsCents: 25_000_00, costPerGuestArsCents: 7_200_00 }),
      'future',
    )
    expect(v.status).toBe('incompleta')
    expect(v.chip).toEqual({ text: 'Por ahora', tone: 'muted' })
    expect(v.action).toBe('edit')
    expect(v.report?.missing).toBe(
      'Todavía no hay reservas en pie: la cuenta se hace con la gente de la noche.',
    )
  })

  it('ya pasó, sin gente y con plata cargada: «sin gente», sin botón (cargar más no arregla nada)', () => {
    const v = nightAccountView(
      { reservations: 0, guests: 0, billableGuests: 0 },
      RATA_2209_ROW,
      'past',
    )
    expect(v).toMatchObject({ status: 'sin-gente', chip: null, lead: null, action: null })
    expect(v.report?.missing).toBe(
      'No quedó ninguna reserva en pie: no hay gente con la que hacer la cuenta.',
    )
  })

  it('el dólar solo no es un dato de la noche: sigue «Sin cargar»', () => {
    expect(hasNightAccount(row({ adSpendUsdCents: 4782, usdArsRate: 1550 }))).toBe(false)
    expect(
      nightAccountView(BURGER_2209, row({ adSpendUsdCents: 4782, usdArsRate: 1550 }), 'past')
        .status,
    ).toBe('sin-cargar')
  })
})

describe('el formulario abierto desde la caja va a la plata', () => {
  const draft = (over: Partial<Record<string, string>>) =>
    ({
      adSpendUsd: '',
      messages: '',
      reach: '',
      revenueArs: '',
      usdArsRate: '',
      revenuePerGuestArs: '',
      costPerGuestArs: '',
      drinkRevenuePerGuestArs: '',
      drinkCostPerGuestArs: '',
      notes: '',
      moneyOpen: true,
      ...over,
    }) as Parameters<typeof firstEmptyField>[0]

  it('con la pauta cargada, el foco salta «Alcance» y cae en el ingreso por persona', () => {
    const d = draft({ adSpendUsd: '47,82', messages: '48' })
    expect(firstEmptyField(d, true)).toBe('reach')
    expect(firstEmptyField(d, true, true)).toBe('revenuePerGuestArs')
  })

  it('sin «Gastado» va primero ahí: sin él no se puede guardar (0 si no hubo pauta)', () => {
    expect(firstEmptyField(draft({}), true, true)).toBe('adSpendUsd')
  })
})

describe('planilla: las columnas de la cuenta siguen a la caja', () => {
  it('con la facturación sola y pauta, salen la gente y el ingreso; lo que falta va vacío', () => {
    const cells = marketingCsvCells(
      BURGER_2209,
      row({ adSpendUsdCents: 4782, messages: 48, revenueArsCents: 2_480_000_00, usdArsRate: 1450 }),
    )
    const at = (h: string) => cells[MARKETING_EXPORT_HEADERS.indexOf(h)]
    expect(at('Personas del cálculo')).toBe('25')
    expect(at('Ingreso ARS')).toBe('2480000')
    expect(at('Costo ARS')).toBe('')
    expect(at('Margen ARS')).toBe('')
    expect(at('Pauta ARS')).toBe('')
    expect(at('Resultado ARS')).toBe('')
  })

  it('«Sin cargar» en la caja = las diez columnas vacías', () => {
    const cells = marketingCsvCells(BURGER_2209, BURGER_2209_ROW)
    const from = MARKETING_EXPORT_HEADERS.indexOf('Personas del cálculo')
    const to = MARKETING_EXPORT_HEADERS.indexOf('Nota')
    expect(cells.slice(from, to).every((c) => c === '')).toBe(true)
  })
})
