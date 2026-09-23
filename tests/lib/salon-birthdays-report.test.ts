import { describe, expect, it } from 'vitest'
import {
  BIRTHDAY_MARKETING_MESSAGES as B,
  birthdayDraftFromRow,
  checkBirthdayMarketingDraft,
  saveBirthdayMarketingSchema,
  toBirthdayMarketingDbFields,
  toBirthdayMarketingRow,
} from '@/lib/salon/birthday-marketing-schemas'
import {
  type BirthdayMarketingRow,
  type BirthdayReservationRow,
  birthdayLoadedByLabel,
  birthdayPautaReport,
  bookedLine,
  buildMonthBirthdayReport,
  formatAverage,
  monthBirthdaysToCsv,
  summarizeBooked,
} from '@/lib/salon/birthdays-report'

/** La pantalla lleva espacio duro después de `US$` y antes de `%`. */
const NBSP = String.fromCharCode(0xa0)

function nb(text: string): string {
  return text.replace(/US\$ /g, `US$${NBSP}`).replace(/ %/g, `${NBSP}%`)
}

let seq = 0
function cumple(over: Partial<BirthdayReservationRow> = {}): BirthdayReservationRow {
  seq += 1
  return {
    id: `r${seq}`,
    reservation_date: '2026-09-05',
    created_at: '2026-09-01T15:00:00Z',
    status: 'closed',
    estimated_guests: 15,
    actual_guests: null,
    scheduled_event_id: null,
    ...over,
  }
}

const PAUTA: BirthdayMarketingRow = {
  ym: '2026-09',
  adSpendUsdCents: 30_000,
  messages: 400,
  reach: null,
  notes: null,
  updatedAt: '2026-09-23T17:32:00Z',
  updatedByName: 'Nacho B.',
}

/** Septiembre de 2026 arranca un martes. */
const CELEBRADOS: BirthdayReservationRow[] = [
  cumple({ reservation_date: '2026-09-05', estimated_guests: 15, actual_guests: 12 }),
  cumple({ reservation_date: '2026-09-05', estimated_guests: 20, scheduled_event_id: 'ev-pizza' }),
  cumple({ reservation_date: '2026-09-05', estimated_guests: '10' }),
  cumple({ reservation_date: '2026-09-12', estimated_guests: 18 }),
  // Se cayeron: no son cumples, se cuentan aparte.
  cumple({ reservation_date: '2026-09-12', status: 'cancelled', estimated_guests: 30 }),
  cumple({ reservation_date: '2026-09-19', status: 'no_show', estimated_guests: 8 }),
  // De hoy en adelante (hoy = 23/09).
  cumple({ reservation_date: '2026-09-23', status: 'pending', estimated_guests: 25 }),
  cumple({ reservation_date: '2026-09-27', status: 'pending', estimated_guests: 12 }),
]

const RESERVADOS_EN_SEP: BirthdayReservationRow[] = [
  cumple({ reservation_date: '2026-09-12' }),
  cumple({ reservation_date: '2026-09-23', estimated_guests: 25 }),
  cumple({ reservation_date: '2026-10-03', estimated_guests: 20 }),
  cumple({ reservation_date: '2026-10-10', estimated_guests: 10 }),
  cumple({ reservation_date: '2026-10-11', status: 'cancelled', estimated_guests: 40 }),
]

function report(over: { today?: string; marketing?: BirthdayMarketingRow | null } = {}) {
  return buildMonthBirthdayReport({
    ym: '2026-09',
    today: over.today ?? '2026-09-23',
    celebrated: CELEBRADOS,
    bookedInMonth: RESERVADOS_EN_SEP,
    marketing: over.marketing === undefined ? PAUTA : over.marketing,
    truncated: false,
  })
}

describe('buildMonthBirthdayReport — el mes', () => {
  const r = report()

  it('arma la grilla desde el lunes: septiembre de 2026 arranca un martes', () => {
    expect(r.days).toHaveLength(30)
    expect(r.leadingBlanks).toBe(1)
    expect(r.days[0]).toMatchObject({ day: '2026-09-01', dayOfMonth: 1, label: 'mar 01/09' })
  })

  it('cuenta cumples y personas por día, con lo contado al cerrar si la mesa se cerró', () => {
    const sabado5 = r.days.find((d) => d.day === '2026-09-05')
    // 12 contadas (no las 15 reservadas) + 20 + 10 (llega como string).
    expect(sabado5).toMatchObject({ birthdays: 3, guests: 42, inEvents: 1, fallen: 0 })
    const sabado12 = r.days.find((d) => d.day === '2026-09-12')
    expect(sabado12).toMatchObject({ birthdays: 1, guests: 18, fallen: 1 })
    expect(r.maxBirthdaysInDay).toBe(3)
  })

  it('los caídos no son cumples: se cuentan aparte y se dicen', () => {
    expect(r.totals).toMatchObject({
      birthdays: 6,
      guests: 97,
      reservedGuests: 100,
      inEvents: 1,
      cancelled: 1,
      noShow: 1,
      celebrated: 4,
      upcoming: 2,
    })
    expect(r.notes).toContain('No cuentan 2 cumples que se cayeron: 1 se canceló y 1 no vino.')
    expect(r.notes).toContain('1 fue dentro de un evento.')
  })

  it('los tres números: cumpleaños, personas y el promedio con un decimal', () => {
    expect(r.tiles.map((t) => [t.label, t.value])).toEqual([
      ['Cumpleaños', '6'],
      ['Personas', '97'],
      ['Por cumple', '16,2'],
    ])
    expect(formatAverage(1001 / 58)).toBe('17,3')
    expect(formatAverage(18)).toBe('18')
  })

  it('dice con qué gente se hizo la cuenta cuando no coincide con lo reservado', () => {
    expect(r.notes).toContain(
      'Las personas son las contadas al cerrar cada mesa; donde no se cerró, las reservadas (100 personas reservadas en total).',
    )
  })

  it('el día pico, solo si hay uno solo', () => {
    expect(r.notes).toContain('El día con más cumples fue el sáb 05/09: 3.')
  })

  it('habla según el mes: pasado, en curso o futuro', () => {
    expect(report({ today: '2026-10-02' }).headline).toBe(
      'En septiembre se festejaron 6 cumpleaños con 97 personas.',
    )
    expect(r.headline).toBe(
      'Por ahora, septiembre tiene 6 cumpleaños con 97 personas: 4 ya se festejaron y 2 son de hoy en adelante.',
    )
    expect(report({ today: '2026-08-20' }).headline).toBe(
      'Septiembre ya tiene 6 cumpleaños reservados, con 97 personas.',
    )
  })

  it('un mes sin cumples no inventa un promedio', () => {
    const vacio = buildMonthBirthdayReport({
      ym: '2026-02',
      today: '2026-09-23',
      celebrated: [],
      bookedInMonth: [],
      marketing: null,
      truncated: false,
    })
    expect(vacio.days).toHaveLength(28)
    expect(vacio.headline).toBe('En febrero no hubo cumpleaños.')
    expect(vacio.tiles[2]).toMatchObject({ value: null, hint: 'sin cumples no hay promedio' })
    expect(vacio.pauta).toBeNull()
  })
})

describe('los cumples reservados en el mes (contra esto se mide la pauta)', () => {
  it('cuenta los que siguen en pie, para la fecha que sean', () => {
    const booked = summarizeBooked(RESERVADOS_EN_SEP)
    expect(booked).toEqual({
      birthdays: 4,
      guests: 70,
      byMonth: [
        { ym: '2026-09', count: 2 },
        { ym: '2026-10', count: 2 },
      ],
    })
  })

  it('lo dice con el desglose por mes del festejo', () => {
    const booked = summarizeBooked(RESERVADOS_EN_SEP)
    expect(bookedLine('2026-09', booked, 'past')).toBe(
      'En septiembre se reservaron 4 cumples (70 personas): 2 para septiembre y 2 para octubre.',
    )
    expect(bookedLine('2026-09', booked, 'current')).toBe(
      'Por ahora, en septiembre se reservaron 4 cumples (70 personas): 2 para septiembre y 2 para octubre.',
    )
    expect(bookedLine('2026-09', summarizeBooked([cumple()]), 'past')).toBe(
      'En septiembre se reservó 1 cumple (15 personas).',
    )
    expect(bookedLine('2026-09', summarizeBooked([]), 'past')).toBe(
      'En septiembre no se reservó ningún cumple.',
    )
  })
})

describe('birthdayPautaReport', () => {
  const booked = { birthdays: 57, guests: 980, byMonth: [] }

  it('el ejemplo del dueño: US$ 300 y 400 mensajes contra 57 cumples', () => {
    const p = birthdayPautaReport(booked, { adSpendUsd: 300, messages: 400, reach: null }, 'past')
    expect(p.sentence).toBe(
      nb(
        'Pusimos US$ 300,00 en la pauta de cumpleaños, llegaron 400 mensajes y se reservaron 57 cumples (980 personas).',
      ),
    )
    expect(p.tiles.map((t) => [t.label, t.value, t.hint])).toEqual([
      ['Por mensaje', nb('US$ 0,75'), nb('US$ 300,00 ÷ 400 mensajes')],
      ['De cierre', nb('14,3 %'), '57 cumples de 400 mensajes'],
      ['Por cumple', nb('US$ 5,26'), nb('US$ 300,00 ÷ 57 cumples')],
      ['Por persona', nb('US$ 0,31'), nb('US$ 300,00 ÷ 980 personas')],
    ])
    expect(p.gap).toBe('343 conversaciones no terminaron en un cumple reservado.')
    expect(p.missing).toBeNull()
  })

  it('sin mensajes no hay cierre, y lo que falta no se dibuja como 0', () => {
    const p = birthdayPautaReport(booked, { adSpendUsd: 300, messages: null, reach: null }, 'past')
    expect(p.sentence).toBe(
      nb('Pusimos US$ 300,00 en la pauta de cumpleaños. Faltan cargar los mensajes.'),
    )
    expect(p.tiles[0]).toMatchObject({ value: null, hint: 'faltan cargar los mensajes' })
    expect(p.tiles[1]).toMatchObject({ value: null, hint: 'faltan cargar los mensajes' })
    // Por cumple sí: no depende de los mensajes.
    expect(p.tiles[2]?.value).toBe(nb('US$ 5,26'))
    expect(p.gap).toBeNull()
    expect(p.missing).toBe('Faltan cargar los mensajes para sacar el cierre.')
  })

  it('el cierre nunca pasa de 100 %: se dice en palabras', () => {
    const p = birthdayPautaReport(booked, { adSpendUsd: 300, messages: 40, reach: null }, 'past')
    expect(p.tiles[1]).toMatchObject({
      value: null,
      hint: '57 cumples y 40 mensajes: parte llegó por otro lado',
    })
    expect(p.gap).toBeNull()
  })

  it('el mes en curso habla en «por ahora»', () => {
    const p = birthdayPautaReport(
      booked,
      { adSpendUsd: 300, messages: 400, reach: null },
      'current',
    )
    expect(p.sentence).toBe(
      nb(
        'Por ahora: pusimos US$ 300,00 en la pauta de cumpleaños, llegaron 400 mensajes y van 57 cumples reservados (980 personas).',
      ),
    )
    expect(p.gap).toBe('Por ahora, 343 conversaciones no terminaron en un cumple reservado.')
  })

  it('con alcance, la ficha técnica', () => {
    const p = birthdayPautaReport(booked, { adSpendUsd: 300, messages: 400, reach: 20_000 }, 'past')
    expect(p.ficha).toEqual([
      { label: 'Alcance', value: '20.000' },
      { label: 'Cada 1.000 alcanzados', value: nb('US$ 15,00') },
      { label: 'Escribió', value: nb('2,0 % (20 de cada 1.000)') },
    ])
  })

  it('el reporte del mes trae la pauta armada contra los reservados, no los festejados', () => {
    const r = report()
    expect(r.booked.birthdays).toBe(4)
    expect(r.pauta?.tiles[1]).toMatchObject({
      value: nb('1,0 %'),
      hint: '4 cumples de 400 mensajes',
    })
    expect(birthdayLoadedByLabel(PAUTA)).toBe('Cargó Nacho B. · 23/09 14:32')
  })
})

describe('monthBirthdaysToCsv (pantalla = CSV)', () => {
  const csv = monthBirthdaysToCsv(report())
  const lines = csv.replace(/^﻿/, '').split('\r\n')

  it('un renglón por día y el total', () => {
    expect(lines[0]).toBe(
      'Fecha;Día;Cumpleaños;Personas;Personas por cumple;Dentro de un evento;Se cayeron',
    )
    expect(lines).toContain('2026-09-05;sáb 05/09;3;42;14;1;0')
    expect(lines).toContain('Total del mes;;6;97;16,2;1;2')
  })

  it('abajo, la pauta con los mismos números que la pantalla', () => {
    expect(lines).toContain('Cumples reservados en el mes;4;;;;;')
    expect(lines).toContain('Pauta USD;300,00;;;;;')
    expect(lines).toContain('% de cierre;1,0;;;;;')
    expect(lines).toContain('Costo por cumple USD;75,00;;;;;')
    expect(lines).toContain('Conversaciones sin cumple reservado;396;;;;;')
  })

  it('sin pauta dice «sin cargar», no ceros', () => {
    const sin = monthBirthdaysToCsv(report({ marketing: null }))
    expect(sin).toContain('Pauta USD;sin cargar')
  })
})

describe('saveBirthdayMarketingSchema', () => {
  const base = {
    ym: '2026-09',
    adSpendUsd: 300,
    messages: 400,
    reach: null,
    notes: null,
    expectedUpdatedAt: null,
  }

  it('acepta el ejemplo y lo pasa a centavos una sola vez', () => {
    const parsed = saveBirthdayMarketingSchema.safeParse({ ...base, adSpendUsd: 175.26 })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(toBirthdayMarketingDbFields(parsed.data)).toEqual({
      ad_spend_usd_cents: 17_526,
      messages: 400,
      reach: null,
      notes: null,
    })
  })

  it('sin «no tuvo pauta»: un gasto de 0 no entra (un mes sin campaña no se carga)', () => {
    for (const adSpendUsd of [0, 0.004]) {
      const parsed = saveBirthdayMarketingSchema.safeParse({ ...base, adSpendUsd })
      expect(parsed.success).toBe(false)
    }
  })

  it('el mes tiene que existir', () => {
    for (const ym of ['2026-13', '26-09', '', '2026-9']) {
      expect(saveBirthdayMarketingSchema.safeParse({ ...base, ym }).success).toBe(false)
    }
  })

  it('el ida y vuelta con la DB', () => {
    const row = toBirthdayMarketingRow(
      {
        month: '2026-09-01',
        ad_spend_usd_cents: '30000',
        messages: 400,
        reach: null,
        notes: 'reels',
        updated_at: '2026-09-23T17:32:00Z',
        updated_by: 'u1',
      },
      'Nacho Badra',
    )
    expect(row).toMatchObject({ ym: '2026-09', adSpendUsdCents: 30_000, updatedByName: 'Nacho B.' })
    expect(birthdayDraftFromRow(row)).toEqual({
      adSpendUsd: '300',
      messages: '400',
      reach: '',
      notes: 'reels',
    })
  })
})

describe('checkBirthdayMarketingDraft', () => {
  const ctx = { ym: '2026-09', expectedUpdatedAt: null }

  it('lee lo que se pega de Ads Manager', () => {
    const check = checkBirthdayMarketingDraft(
      { adSpendUsd: 'US$ 1.234,50', messages: '400', reach: '', notes: '  ' },
      ctx,
    )
    expect(check.fieldErrors).toEqual({})
    expect(check.input).toMatchObject({
      adSpendUsd: 1234.5,
      messages: 400,
      reach: null,
      notes: null,
    })
  })

  it('Gastado vacío o en 0 pide el número, con las palabras de esta pauta', () => {
    expect(
      checkBirthdayMarketingDraft({ adSpendUsd: '', messages: '', reach: '', notes: '' }, ctx)
        .fieldErrors,
    ).toEqual({ adSpendUsd: B.spendMissing })
    expect(
      checkBirthdayMarketingDraft({ adSpendUsd: '0', messages: '', reach: '', notes: '' }, ctx)
        .fieldErrors,
    ).toEqual({ adSpendUsd: B.spendMissing })
  })

  it('los mensajes van sin decimales; un Gastado ilegible no le inventa errores al resto', () => {
    const check = checkBirthdayMarketingDraft(
      { adSpendUsd: 'abc', messages: '40,5', reach: '', notes: '' },
      ctx,
    )
    expect(check.fieldErrors).toEqual({ adSpendUsd: B.unreadable, messages: B.withDecimals })
    expect(check.input).toBeNull()
  })
})
