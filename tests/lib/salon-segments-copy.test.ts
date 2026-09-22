import { describe, expect, it } from 'vitest'
import {
  computeDaySegments,
  type DaySegmentsSnapshot,
  projectReservation,
  type ReservationCandidate,
  resolveDaySegmentCaps,
  resolveSegmentSettings,
  type SegmentConfig,
  type SegmentEventInput,
  type SegmentLoad,
  type SegmentProjection,
  type SegmentReservationInput,
  type ZoneCaps,
  zoneLoad,
} from '@/lib/salon/segments'
import {
  agendaDetailLines,
  calendarLegend,
  capSourceLabel,
  eventZoneLine,
  mismatchCopy,
  overCapacityConfirmCopy,
  SEGMENT_LABELS,
  SEGMENT_LETTERS,
  SEGMENT_SHORT_LABELS,
  SEGMENT_WITH_ARTICLE,
  savedToastCopy,
  segmentAlertMark,
  segmentAriaLabel,
  segmentBreakdown,
  segmentCellBreakdown,
  segmentEventNote,
  segmentHeadline,
  segmentRatio,
  segmentStatusLine,
  segmentTone,
  segmentWholeLine,
  ZONE_CLEAR_ARIA,
  ZONE_CLEAR_LABEL,
  ZONE_FILTER_GROUP_LABEL,
  ZONE_FILTER_LABELS,
  ZONE_PLACE_LABELS,
  zoneAgendaDetailLines,
  zoneAriaLabel,
  zoneCellBreakdown,
  zoneFilterLabel,
  zoneHeadline,
  zoneRatio,
  zoneSectionCopy,
  zoneStatusLine,
  zoneTone,
  zoneViewingLabel,
} from '@/lib/salon/segments-copy'

// Fixtures mínimos (los mismos días que salon-segments.test.ts). Los strings de
// este archivo son contrato: los ven el mes, el día, el form y el operativo.

let seq = 0
function res(p: Partial<SegmentReservationInput> = {}): SegmentReservationInput {
  seq += 1
  return {
    id: `r${seq}`,
    reservation_date: '2026-09-10',
    meal_type: 'dinner',
    reservation_time_local: '21:00:00',
    scheduled_event_id: null,
    zone: 'planta_alta',
    status: 'pending',
    estimated_guests: 2,
    actual_guests: null,
    kind: 'normal',
    cake_count: 0,
    ...p,
  }
}

function ev(p: Partial<SegmentEventInput> & { id: string; name: string }): SegmentEventInput {
  const { name, ...rest } = p
  return {
    event_date: '2026-09-10',
    starts_at_local: '21:00:00',
    capacity: 70,
    name_override: null,
    template: { name, color_hex: '#e11d48' },
    ...rest,
  }
}

const weekly = (segment: 'lunch' | 'tea_time' | 'dinner', capacity: number, warn: number | null) =>
  ([1, 2, 3, 4, 5, 6, 7] as const).map((iso_dow) => ({
    segment,
    iso_dow,
    capacity: segment === 'lunch' && iso_dow >= 6 ? 120 : capacity,
    warn_at: segment === 'lunch' && iso_dow >= 6 ? null : warn,
  }))

const HUB_CONFIG: SegmentConfig = {
  weekly: [
    ...weekly('lunch', 70, 50),
    ...weekly('tea_time', 120, null),
    ...weekly('dinner', 120, null),
  ],
  settings: [
    { segment: 'lunch', default_time: '13:00', warn_note: 'Conviene abrir la terraza' },
    { segment: 'tea_time', default_time: '15:30', warn_note: null },
    { segment: 'dinner', default_time: '21:00', warn_note: null },
  ],
  overrides: [],
  fallbackTotal: 130,
}

function day(
  date: string,
  reservations: SegmentReservationInput[],
  events: SegmentEventInput[] = [],
  config: SegmentConfig = HUB_CONFIG,
) {
  return computeDaySegments({
    date,
    reservations,
    events,
    caps: resolveDaySegmentCaps(date, config),
  })
}

function snapshot(
  date: string,
  reservations: SegmentReservationInput[],
  events: SegmentEventInput[],
): DaySegmentsSnapshot {
  return {
    date,
    caps: resolveDaySegmentCaps(date, HUB_CONFIG),
    settings: resolveSegmentSettings(HUB_CONFIG.settings),
    reservations,
    events,
  }
}

function candidate(p: Partial<ReservationCandidate>): ReservationCandidate {
  return {
    reservation_date: '2026-09-10',
    meal_type: 'dinner',
    reservation_time_local: '21:00',
    scheduled_event_id: null,
    zone: 'planta_alta',
    guests: 4,
    kind: 'normal',
    cake_count: 0,
    ...p,
  }
}

function project(s: DaySegmentsSnapshot, c: ReservationCandidate): SegmentProjection {
  const p = projectReservation(s, c)
  if (!p) throw new Error('la proyección no debería ser null')
  return p
}

const SEP10_EVENTS = [ev({ id: 'sushi', name: 'Sushi libre', capacity: 70 })]
const SEP10 = [
  res({
    meal_type: 'lunch',
    reservation_time_local: '13:00:00',
    zone: 'planta_baja',
    estimated_guests: 19,
  }),
  res({
    meal_type: 'tea_time',
    reservation_time_local: '16:00:00',
    zone: 'planta_baja',
    estimated_guests: 20,
  }),
  res({
    meal_type: 'tea_time',
    reservation_time_local: '16:00:00',
    zone: 'planta_baja',
    estimated_guests: 13,
  }),
  res({ scheduled_event_id: 'sushi', zone: 'event_floating', estimated_guests: 40 }),
  res({
    scheduled_event_id: 'sushi',
    zone: 'event_floating',
    estimated_guests: 18,
    kind: 'birthday',
    cake_count: 1,
  }),
  res({ scheduled_event_id: 'sushi', zone: 'event_floating', estimated_guests: 15 }),
  res({ estimated_guests: 16 }),
  res({ estimated_guests: 15, kind: 'birthday' }),
  res({ estimated_guests: 15, kind: 'birthday' }),
  res({ estimated_guests: 10, status: 'cancelled' }),
]

const SEP19_EVENTS = [
  ev({ id: 'pizza', name: 'Pizza libre', capacity: 140, event_date: '2026-09-19' }),
]
const SEP19 = [40, 36, 30, 27].map((g) =>
  res({ reservation_date: '2026-09-19', estimated_guests: g }),
)

const SEP22_EVENTS = [
  ev({ id: 'burger', name: '2x1 Burger', capacity: 100, event_date: '2026-09-22' }),
  ev({ id: 'rata', name: 'Ratatuille', capacity: 50, event_date: '2026-09-22' }),
]
const SEP22 = [30, 24].map((g) =>
  res({
    reservation_date: '2026-09-22',
    scheduled_event_id: 'rata',
    zone: 'event_floating',
    estimated_guests: g,
  }),
)

function lunch(guests: number, config: SegmentConfig = HUB_CONFIG): SegmentLoad {
  return day(
    '2026-09-10',
    [res({ meal_type: 'lunch', reservation_time_local: '13:00:00', estimated_guests: guests })],
    [],
    config,
  ).segments.lunch
}

describe('labels', () => {
  it('nombres de los 3 servicios en cada densidad', () => {
    expect(SEGMENT_LABELS).toEqual({ lunch: 'Almuerzo', tea_time: 'Merienda', dinner: 'Cena' })
    expect(SEGMENT_SHORT_LABELS).toEqual({ lunch: 'Alm', tea_time: 'Mer', dinner: 'Cena' })
    expect(SEGMENT_LETTERS).toEqual({ lunch: 'A', tea_time: 'M', dinner: 'C' })
    expect(SEGMENT_WITH_ARTICLE).toEqual({
      lunch: 'el almuerzo',
      tea_time: 'la merienda',
      dinner: 'la cena',
    })
  })
})

describe('10/09, la cena de Sushi libre', () => {
  const d = day('2026-09-10', SEP10, SEP10_EVENTS)
  const dinner = d.segments.dinner

  it('headline en las 3 densidades: personas, nunca lo ocupado', () => {
    expect(segmentHeadline(dinner, 'letter')).toBe('C 119/120')
    expect(segmentHeadline(dinner, 'short')).toBe('Cena 119/120')
    expect(segmentHeadline(dinner, 'long')).toBe('Cena · 119 de 120')
    expect(segmentRatio(dinner)).toBe('119/120')
  })

  it('estado, desglose y tono', () => {
    expect(segmentStatusLine(dinner)).toBe('Queda 1 lugar para reservas normales')
    expect(segmentBreakdown(dinner)).toBe(
      'Sushi libre 73/70 · normales 46 de 50 · 3 cumples (1 en el evento) · 1 torta (en el evento)',
    )
    expect(segmentBreakdown(dinner, { includeEvents: false })).toBe(
      'normales 46 de 50 · 3 cumples (1 en el evento) · 1 torta (en el evento)',
    )
    expect(segmentTone(dinner)).toBe('warn')
    expect(segmentEventNote(dinner)).toBeNull()
  })

  it('desglose de celda: el pedido del dueño entra en dos renglones', () => {
    expect(segmentCellBreakdown(dinner)).toBe('46/50 normales · 3 cumples · 1 torta')
    expect(segmentCellBreakdown(d.segments.lunch)).toBeNull()
  })

  it('almuerzo del mismo día: quedan 51', () => {
    expect(segmentStatusLine(d.segments.lunch)).toBe('Quedan 51 lugares')
    expect(segmentTone(d.segments.lunch)).toBe('ok')
    expect(segmentBreakdown(d.segments.lunch)).toBeNull()
  })

  it('agendaDetailLines: solo la cena tiene algo que decir', () => {
    expect(agendaDetailLines(d)).toEqual([
      'Cena: Queda 1 lugar para reservas normales · normales 46 de 50 · 3 cumples (1 en el evento) · 1 torta (en el evento)',
    ])
  })

  it('segmentAriaLabel lleva el día, el número, el estado y el desglose', () => {
    expect(segmentAriaLabel(dinner, 'jue 10/09')).toBe(
      'Cena, jue 10/09: 119 de 120 personas. Queda 1 lugar para reservas normales. Sushi libre 73/70, normales 46 de 50, 3 cumples (1 en el evento), 1 torta (en el evento).',
    )
    expect(segmentAriaLabel(d.segments.tea_time, '')).toBe(
      'Merienda: 33 de 120 personas. Quedan 87 lugares.',
    )
  })
})

describe('rojos y notas de eventos', () => {
  it('19/09: te pasaste por personas y Pizza libre se lleva toda la cena', () => {
    const dinner = day('2026-09-19', SEP19, SEP19_EVENTS).segments.dinner
    expect(segmentHeadline(dinner, 'short')).toBe('Cena 133/120')
    expect(segmentStatusLine(dinner)).toBe('Te pasaste por 13')
    expect(segmentEventNote(dinner)).toBe('Pizza libre (cupo 140) se lleva toda la cena de 120')
    expect(segmentTone(dinner)).toBe('over')
    // 133/120 ya dice que no hay lugar: sin "!".
    expect(segmentAlertMark(dinner)).toBeNull()
  })

  it('22/09: dos eventos se llevan la cena', () => {
    const dinner = day('2026-09-22', SEP22, SEP22_EVENTS).segments.dinner
    expect(segmentStatusLine(dinner)).toBe('Quedan 0 lugares para reservas normales')
    expect(segmentEventNote(dinner)).toBe('Los eventos (cupo 150) se llevan toda la cena de 120')
  })

  it('03/09: las normales pisan lo que apartaron los eventos', () => {
    const date = '2026-09-03'
    const dinner = day(
      date,
      [
        res({ reservation_date: date, scheduled_event_id: 'pizza', estimated_guests: 40 }),
        res({ reservation_date: date, scheduled_event_id: 'fernet', estimated_guests: 27 }),
        res({ reservation_date: date, estimated_guests: 4 }),
      ],
      [
        ev({ id: 'pizza', name: 'Pizza libre', capacity: 140, event_date: date }),
        ev({ id: 'fernet', name: 'Fernet', capacity: 100, event_date: date }),
      ],
    ).segments.dinner
    expect(segmentStatusLine(dinner)).toBe(
      'Te pasaste por 4: los eventos tienen apartados 120 lugares',
    )
    // 71/120 en rojo: el número solo no lo explica, va el "!".
    expect(segmentAlertMark(dinner)).toBe('!')
  })

  it('15/09: un solo evento que aparta todo', () => {
    const date = '2026-09-15'
    const dinner = day(
      date,
      [
        res({ reservation_date: date, scheduled_event_id: 'burger', estimated_guests: 65 }),
        res({ reservation_date: date, estimated_guests: 31 }),
      ],
      [ev({ id: 'burger', name: '2x1 Burger Martes', capacity: 120, event_date: date })],
    ).segments.dinner
    expect(segmentStatusLine(dinner)).toBe(
      'Te pasaste por 31: 2x1 Burger Martes tiene apartados 120 lugares',
    )
  })

  it('el almuerzo usa "todo el almuerzo"', () => {
    const date = '2026-09-26'
    const s = day(
      date,
      [],
      [
        ev({
          id: 'x',
          name: 'Brunch',
          capacity: 150,
          starts_at_local: '12:00:00',
          event_date: date,
        }),
      ],
    ).segments.lunch
    expect(segmentEventNote(s)).toBe('Brunch (cupo 150) se lleva todo el almuerzo de 120')
  })
})

describe('aviso del almuerzo, vacío, cerrado y sin tope', () => {
  it('Almuerzo 52/70 un jueves: la nota del bar', () => {
    const s = lunch(52)
    expect(segmentStatusLine(s)).toBe('Conviene abrir la terraza')
    expect(segmentHeadline(s, 'long')).toBe('Almuerzo · 52 de 70')
    expect(segmentTone(s)).toBe('warn')
  })

  it('sin nota configurada: el número del aviso', () => {
    const noNote: SegmentConfig = {
      ...HUB_CONFIG,
      settings: HUB_CONFIG.settings.map((row) => ({ ...row, warn_note: null })),
    }
    expect(segmentStatusLine(lunch(52, noNote))).toBe('Llegaste al aviso de 50')
  })

  it('vacío con 120 y cerrado', () => {
    expect(segmentStatusLine(day('2026-09-10', []).segments.dinner)).toBe('Libre · 120 lugares')
    expect(segmentTone(day('2026-09-10', []).segments.dinner)).toBe('none')
    const closed: SegmentConfig = {
      ...HUB_CONFIG,
      overrides: [
        { segment: 'lunch', override_date: '2026-09-10', capacity: 0, warn_at: null, reason: null },
      ],
    }
    expect(segmentStatusLine(day('2026-09-10', [], [], closed).segments.lunch)).toBe('Cerrado')
  })

  it('cerrado por evento privado: sin «se lleva toda la cena de 0»', () => {
    const date = '2026-09-19'
    const closed: SegmentConfig = {
      ...HUB_CONFIG,
      overrides: [
        {
          segment: 'dinner',
          override_date: date,
          capacity: 0,
          warn_at: null,
          reason: 'Evento privado',
        },
      ],
    }
    const d = day(
      date,
      [],
      [ev({ id: 'rata', name: 'Ratatuille', capacity: 140, event_date: date })],
      closed,
    )
    const dinner = d.segments.dinner
    expect(segmentStatusLine(dinner)).toBe('Cerrado')
    expect(segmentEventNote(dinner)).toBeNull()
    expect(agendaDetailLines(d)).toEqual([])
    expect(segmentAriaLabel(dinner, '')).toBe('Cena: 0 de 0 personas. Cerrado. Ratatuille 0/140.')
  })

  it('sin tope con 40 en la cena', () => {
    const config: SegmentConfig = { weekly: [], overrides: [], settings: [], fallbackTotal: 0 }
    const s = day('2026-09-10', [res({ estimated_guests: 40 })], [], config).segments.dinner
    expect(segmentHeadline(s, 'short')).toBe('Cena 40')
    expect(segmentHeadline(s, 'long')).toBe('Cena · 40')
    expect(segmentHeadline(s, 'letter')).toBe('C 40')
    expect(segmentStatusLine(s)).toBe('40 personas · sin tope')
    expect(segmentTone(s)).toBe('none')
    expect(segmentStatusLine(day('2026-09-10', [], [], config).segments.dinner)).toBe('Sin tope')
  })
})

describe('cumples y tortas', () => {
  it('sin eventos: "4 cumples · 2 tortas"', () => {
    const s = day('2026-09-10', [
      res({ kind: 'birthday', cake_count: 1 }),
      res({ kind: 'birthday', cake_count: 1 }),
      res({ kind: 'birthday' }),
      res({ kind: 'birthday' }),
    ]).segments.dinner
    expect(segmentBreakdown(s)).toBe('4 cumples · 2 tortas')
  })

  it('singulares y nunca "(0 en el evento)"', () => {
    const s = day(
      '2026-09-10',
      [res({ kind: 'birthday', cake_count: 1 }), res({ scheduled_event_id: 'sushi' })],
      SEP10_EVENTS,
    ).segments.dinner
    const text = segmentBreakdown(s)
    expect(text).toBe('Sushi libre 2/70 · normales 2 de 50 · 1 cumple · 1 torta')
    expect(text).not.toContain('(0 en')
  })

  it('tortas repartidas entre el evento y afuera', () => {
    const s = day(
      '2026-09-10',
      [res({ scheduled_event_id: 'sushi', cake_count: 1 }), res({ cake_count: 2 })],
      SEP10_EVENTS,
    ).segments.dinner
    expect(segmentBreakdown(s, { includeEvents: false })).toBe(
      'normales 2 de 50 · 3 tortas (1 en el evento)',
    )
  })
})

describe('capSourceLabel', () => {
  const base = day('2026-09-10', []).segments.dinner

  it('de dónde sale el cupo', () => {
    expect(
      capSourceLabel({ ...base, capSource: 'override', capReason: 'Terraza abierta' }, 4),
    ).toBe('Cupo especial: Terraza abierta')
    expect(capSourceLabel({ ...base, capSource: 'override', capReason: null }, 4)).toBe(
      'Cupo especial para este día',
    )
    expect(capSourceLabel({ ...base, capSource: 'weekly' }, 4)).toBe('Cupo de los jueves')
    expect(capSourceLabel({ ...base, capSource: 'weekly' }, 3)).toBe('Cupo de los miércoles')
    expect(capSourceLabel({ ...base, capSource: 'fallback' }, 4)).toBe('Cupo general del salón')
    expect(capSourceLabel({ ...base, capSource: 'none' }, 4)).toBe('Sin tope')
  })
})

describe('mismatchCopy', () => {
  it('03/10: Merienda Libre cargada a las 21:00', () => {
    expect(
      mismatchCopy({
        eventId: 'm',
        eventName: 'Merienda Libre',
        startsAt: '21:00',
        eventSegment: 'dinner',
        reservationsSegment: 'tea_time',
        reservations: 1,
        people: 33,
      }),
    ).toBe(
      'Merienda Libre figura a las 21:00 (cena), pero su reserva es de la merienda. Corregí la hora del evento para que cuente en el servicio correcto.',
    )
  })

  it('plural', () => {
    expect(
      mismatchCopy({
        eventId: 'a',
        eventName: 'Merienda y Arte',
        startsAt: '13:00',
        eventSegment: 'lunch',
        reservationsSegment: 'tea_time',
        reservations: 3,
        people: 12,
      }),
    ).toBe(
      'Merienda y Arte figura a las 13:00 (almuerzo), pero sus 3 reservas son de la merienda. Corregí la hora del evento para que cuente en el servicio correcto.',
    )
  })
})

describe('overCapacityConfirmCopy y savedToastCopy', () => {
  const s10 = () => snapshot('2026-09-10', SEP10, SEP10_EVENTS)

  it('(22a) normal de 4 en la cena del 10/09', () => {
    const p = project(s10(), candidate({ guests: 4 }))
    expect(overCapacityConfirmCopy(p)).toEqual({
      title: 'Te pasás del cupo de la cena',
      body: 'Quedarían 123 de 120 (3 de más).',
      eventLine: null,
    })
    expect(savedToastCopy('create', p)).toBe('Reserva cargada · Cena · 123 de 120')
  })

  it('(22b) 2 más en Sushi libre', () => {
    const p = project(
      s10(),
      candidate({ guests: 2, scheduled_event_id: 'sushi', zone: 'event_floating' }),
    )
    expect(overCapacityConfirmCopy(p).eventLine).toBe('Sushi libre quedaría 75/70.')
  })

  it('(22f) 22/09 + normal de 4', () => {
    const p = project(
      snapshot('2026-09-22', SEP22, SEP22_EVENTS),
      candidate({ reservation_date: '2026-09-22', guests: 4 }),
    )
    expect(overCapacityConfirmCopy(p).body).toBe(
      'Los eventos tienen apartados 120 lugares. Quedaban 0 para reservas normales y esta suma 4.',
    )
  })

  it('un solo evento: nombra al evento', () => {
    const date = '2026-09-15'
    const p = project(
      snapshot(
        date,
        [res({ reservation_date: date, scheduled_event_id: 'burger', estimated_guests: 65 })],
        [ev({ id: 'burger', name: '2x1 Burger Martes', capacity: 120, event_date: date })],
      ),
      candidate({ reservation_date: date, guests: 4 }),
    )
    expect(overCapacityConfirmCopy(p)).toMatchObject({
      title: 'Te pasás del cupo de la cena',
      body: '2x1 Burger Martes tiene apartados 120 lugares. Quedaban 0 para reservas normales y esta suma 4.',
    })
  })

  it('22/09: sacar del evento una de 2 suma 2 lugares aunque no sume personas', () => {
    // Editar la de 2x1 Burger y pasarla a Planta Alta: 56 → 56 personas, pero
    // lo ocupado va de 120 a 122. Antes decía «esta suma 0».
    const burger = res({
      id: 'burger2',
      reservation_date: '2026-09-22',
      scheduled_event_id: 'burger',
      zone: 'event_floating',
      estimated_guests: 2,
    })
    const p = project(
      snapshot('2026-09-22', [...SEP22, burger], SEP22_EVENTS),
      candidate({ id: 'burger2', reservation_date: '2026-09-22', guests: 2 }),
    )
    expect(p.addedPeople).toBe(0)
    expect(p.needsConfirm).toBe(true)
    expect(overCapacityConfirmCopy(p).body).toBe(
      'Los eventos tienen apartados 120 lugares. Quedaban 0 para reservas normales y esta suma 2.',
    )
  })

  it('normals_over que no empeora lo ocupado: la causa, nunca «suma 0»', () => {
    // Ya pasada por una normal de 2; sumar 2 adentro de 2x1 Burger usa lugar
    // que el evento tenía apartado (122 → 122). No pide confirmación, pero la
    // vista rápida igual muestra el aviso con este texto.
    const normal = res({ reservation_date: '2026-09-22', estimated_guests: 2 })
    const p = project(
      snapshot('2026-09-22', [...SEP22, normal], SEP22_EVENTS),
      candidate({
        reservation_date: '2026-09-22',
        guests: 2,
        scheduled_event_id: 'burger',
        zone: 'event_floating',
      }),
    )
    expect(p.after).toMatchObject({ cause: 'normals_over', occupied: 122 })
    expect(p.before.occupied).toBe(122)
    expect(p.needsConfirm).toBe(false)
    const { body } = overCapacityConfirmCopy(p)
    expect(body).toBe('Te pasaste por 2: los eventos tienen apartados 120 lugares.')
    expect(body).not.toContain('suma 0')
  })

  it('toast de edición y alta sin proyección', () => {
    expect(savedToastCopy('edit', null)).toBe('Reserva actualizada')
    expect(savedToastCopy('create', null)).toBe('Reserva cargada')
  })
})

// ──────────────────────────────────────────────────────────
// Filtro de planta del calendario (decisión del dueño, 22/09/2026)
// ──────────────────────────────────────────────────────────

const HUB_ZONE_CAPS: ZoneCaps = { planta_alta: 60, planta_baja: 70 }
const NO_CAPS: ZoneCaps = { planta_alta: 0, planta_baja: 0 }

/** Una cena con `pa` personas en Planta Alta (normales) y `floating` de evento sin planta. */
function dinnerZones(pa: number, floating = 0) {
  const rows = [
    ...(pa > 0 ? [res({ zone: 'planta_alta', estimated_guests: pa })] : []),
    ...(floating > 0
      ? [res({ scheduled_event_id: 'pizza', zone: 'event_floating', estimated_guests: floating })]
      : []),
  ]
  return day('2026-09-10', rows, [ev({ id: 'pizza', name: 'Pizza libre', capacity: 140 })]).segments
    .dinner
}

describe('filtro de planta · labels', () => {
  it('las opciones del filtro, como las dijo el dueño', () => {
    expect([null, 'alta', 'baja', 'sin'].map((f) => zoneFilterLabel(f as 'alta' | null))).toEqual([
      'Todo',
      'Planta alta',
      'Planta baja',
      'Sin ubicar',
    ])
    expect(ZONE_FILTER_LABELS).toEqual({
      alta: 'Planta alta',
      baja: 'Planta baja',
      sin: 'Sin ubicar',
    })
    expect(ZONE_FILTER_GROUP_LABEL).toBe('Ver por planta')
  })

  it('cómo se nombra cada zona adentro de una frase', () => {
    expect(ZONE_PLACE_LABELS).toEqual({
      planta_alta: 'Planta Alta',
      planta_baja: 'Planta Baja',
      event_floating: 'Sin ubicar',
    })
  })

  it('el chip del día filtrado y su «Ver todo»', () => {
    expect(zoneViewingLabel('alta')).toBe('Viendo Planta alta')
    expect(zoneViewingLabel('sin')).toBe('Viendo Sin ubicar')
    expect(ZONE_CLEAR_LABEL).toBe('Ver todo')
    expect(ZONE_CLEAR_ARIA).toBe('Ver todo el día, sin filtro de planta')
  })
})

describe('filtro de planta · leyenda del mes', () => {
  it('sin filtro, la de siempre (por servicio)', () => {
    expect(calendarLegend(null, HUB_ZONE_CAPS)).toBe(
      'Alm · Mer · Cena = personas / cupo de cada servicio · tocá un evento para reservar adentro',
    )
  })

  it('con planta dice que el número es de la planta y cuál es su cupo', () => {
    expect(calendarLegend('alta', HUB_ZONE_CAPS)).toBe(
      'Planta alta · personas / cupo de la planta (60)',
    )
    expect(calendarLegend('baja', HUB_ZONE_CAPS)).toBe(
      'Planta baja · personas / cupo de la planta (70)',
    )
  })

  it('sin cupo por planta cargado no promete un denominador', () => {
    expect(calendarLegend('alta', NO_CAPS)).toBe(
      'Planta alta · personas (la planta no tiene cupo cargado)',
    )
  })

  it('Sin ubicar no tiene cupo: explica qué gente es', () => {
    expect(calendarLegend('sin', HUB_ZONE_CAPS)).toBe(
      'Sin ubicar · personas de eventos que todavía no tienen planta',
    )
  })
})

describe('filtro de planta · el número de la planta', () => {
  it('46 de 60 en PA, por densidad', () => {
    const z = zoneLoad(dinnerZones(46), 'planta_alta', HUB_ZONE_CAPS)
    expect(zoneRatio(z)).toBe('46/60')
    expect(zoneHeadline(z, 'letter')).toBe('C 46/60')
    expect(zoneHeadline(z, 'short')).toBe('Cena 46/60')
    expect(zoneHeadline(z, 'long')).toBe('Cena · Planta Alta · 46 de 60')
  })

  it('sin tope (Sin ubicar): solo las personas', () => {
    const z = zoneLoad(dinnerZones(0, 22), 'event_floating', HUB_ZONE_CAPS)
    expect(zoneRatio(z)).toBe('22')
    expect(zoneHeadline(z, 'letter')).toBe('C 22')
    expect(zoneHeadline(z, 'short')).toBe('Cena 22')
    expect(zoneHeadline(z, 'long')).toBe('Cena · Sin ubicar · 22')
  })

  it('el almuerzo en PB se abrevia como el servicio', () => {
    const s = day(
      '2026-09-10',
      [
        res({
          meal_type: 'lunch',
          reservation_time_local: '13:00:00',
          zone: 'planta_baja',
          estimated_guests: 19,
        }),
      ],
      [],
    ).segments.lunch
    const z = zoneLoad(s, 'planta_baja', HUB_ZONE_CAPS)
    expect(zoneHeadline(z, 'letter')).toBe('A 19/70')
    expect(zoneHeadline(z, 'short')).toBe('Alm 19/70')
  })

  it('tono: sin gente o sin tope no se pinta; si no, el estado', () => {
    expect(zoneTone(zoneLoad(dinnerZones(0), 'planta_alta', HUB_ZONE_CAPS))).toBe('none')
    expect(zoneTone(zoneLoad(dinnerZones(0, 22), 'event_floating', HUB_ZONE_CAPS))).toBe('none')
    expect(zoneTone(zoneLoad(dinnerZones(46), 'planta_alta', HUB_ZONE_CAPS))).toBe('ok')
    expect(zoneTone(zoneLoad(dinnerZones(55), 'planta_alta', HUB_ZONE_CAPS))).toBe('warn')
    expect(zoneTone(zoneLoad(dinnerZones(65), 'planta_alta', HUB_ZONE_CAPS))).toBe('over')
  })
})

describe('filtro de planta · la línea de estado', () => {
  const pa = (n: number, caps: ZoneCaps = HUB_ZONE_CAPS) =>
    zoneStatusLine(zoneLoad(dinnerZones(n), 'planta_alta', caps))

  it('cuántos lugares quedan en la planta', () => {
    expect(pa(46)).toBe('Quedan 14 lugares en Planta Alta')
    expect(pa(59)).toBe('Queda 1 lugar en Planta Alta')
    expect(pa(0)).toBe('Quedan 60 lugares en Planta Alta')
  })

  it('justo lleno y pasado', () => {
    expect(pa(60)).toBe('Planta Alta llena')
    expect(pa(65)).toBe('Te pasaste por 5 en Planta Alta')
  })

  it('Sin ubicar: cuánta gente falta ubicar', () => {
    const floating = (n: number) =>
      zoneStatusLine(zoneLoad(dinnerZones(0, n), 'event_floating', HUB_ZONE_CAPS))
    expect(floating(22)).toBe('22 personas sin planta')
    expect(floating(1)).toBe('1 persona sin planta')
    expect(floating(0)).toBe('Nadie sin planta')
  })

  it('planta sin cupo cargado: personas y «sin tope»', () => {
    expect(pa(22, NO_CAPS)).toBe('22 personas en Planta Alta · sin tope')
    expect(pa(0, NO_CAPS)).toBe('Nadie en Planta Alta · sin tope')
  })
})

describe('filtro de planta · desglose, aria-label y agenda', () => {
  it('desglose de celda: cumples y tortas de ESA planta', () => {
    // 21/09: los 2 cumples con torta de Pizza libre están sentados en PA.
    const rows = [
      res({
        reservation_date: '2026-09-21',
        scheduled_event_id: 'pizza21',
        zone: 'planta_alta',
        estimated_guests: 15,
        kind: 'birthday',
        cake_count: 1,
      }),
      res({
        reservation_date: '2026-09-21',
        scheduled_event_id: 'pizza21',
        zone: 'planta_alta',
        estimated_guests: 14,
        kind: 'birthday',
        cake_count: 1,
      }),
      res({ reservation_date: '2026-09-21', zone: 'planta_baja', estimated_guests: 11 }),
    ]
    const d = day('2026-09-21', rows, [
      ev({ id: 'pizza21', name: 'Pizza libre', capacity: 140, event_date: '2026-09-21' }),
    ])
    const pa = zoneLoad(d.segments.dinner, 'planta_alta', HUB_ZONE_CAPS)
    const pb = zoneLoad(d.segments.dinner, 'planta_baja', HUB_ZONE_CAPS)
    expect(zoneCellBreakdown(pa)).toBe('2 cumples · 2 tortas')
    expect(zoneCellBreakdown(pb)).toBeNull()
  })

  it('aria-label: servicio, fecha, planta, número, estado y festejos', () => {
    const rows = [
      res({ zone: 'planta_alta', estimated_guests: 40 }),
      res({ zone: 'planta_alta', estimated_guests: 6, kind: 'birthday', cake_count: 1 }),
    ]
    const z = zoneLoad(day('2026-09-10', rows).segments.dinner, 'planta_alta', HUB_ZONE_CAPS)
    expect(zoneAriaLabel(z, 'jueves 10 de septiembre')).toBe(
      'Cena, jueves 10 de septiembre, Planta Alta: 46 de 60 personas. Quedan 14 lugares en Planta Alta. 1 cumple, 1 torta.',
    )
    expect(zoneAriaLabel(z, '')).toBe(
      'Cena, Planta Alta: 46 de 60 personas. Quedan 14 lugares en Planta Alta. 1 cumple, 1 torta.',
    )
  })

  it('aria-label sin tope: Sin ubicar y planta sin cupo', () => {
    const floating = zoneLoad(dinnerZones(0, 22), 'event_floating', HUB_ZONE_CAPS)
    expect(zoneAriaLabel(floating, 'jueves 10 de septiembre')).toBe(
      'Cena, jueves 10 de septiembre, Sin ubicar: 22 personas sin planta.',
    )
    const noCap = zoneLoad(dinnerZones(22), 'planta_alta', NO_CAPS)
    expect(zoneAriaLabel(noCap, '')).toBe('Cena, Planta Alta: 22 personas, sin tope.')
  })

  it('agenda: solo servicios con gente en la planta, estado si está en ámbar o rojo', () => {
    const rows = [
      res({
        meal_type: 'lunch',
        reservation_time_local: '13:00:00',
        zone: 'planta_baja',
        estimated_guests: 19,
      }),
      res({ zone: 'planta_alta', estimated_guests: 58 }),
      res({ zone: 'planta_alta', estimated_guests: 4, kind: 'birthday', cake_count: 1 }),
    ]
    const d = day('2026-09-10', rows)
    expect(zoneAgendaDetailLines(d, 'planta_alta', HUB_ZONE_CAPS)).toEqual([
      'Cena: Te pasaste por 2 en Planta Alta · 1 cumple · 1 torta',
    ])
    // PB al mediodía: 19/70, en verde y sin festejos → nada que agregar.
    expect(zoneAgendaDetailLines(d, 'planta_baja', HUB_ZONE_CAPS)).toEqual([])
  })
})

describe('filtro de planta · el día', () => {
  it('la tarjeta del evento dice cuántos de los suyos van en la planta', () => {
    const byZone = { planta_alta: 29, planta_baja: 0, event_floating: 89 }
    expect(eventZoneLine({ byZone }, 'planta_alta')).toBe('29 personas en Planta Alta')
    expect(eventZoneLine({ byZone }, 'planta_baja')).toBe('Nadie en Planta Baja')
    expect(eventZoneLine({ byZone }, 'event_floating')).toBe('89 personas sin planta')
    expect(eventZoneLine({ byZone: { ...byZone, event_floating: 0 } }, 'event_floating')).toBe(
      'Nadie sin planta',
    )
    expect(eventZoneLine({ byZone: { ...byZone, planta_alta: 1 } }, 'planta_alta')).toBe(
      '1 persona en Planta Alta',
    )
  })

  it('el servicio entero como contexto: «Toda la cena: 119/120»', () => {
    const d = day('2026-09-10', SEP10, SEP10_EVENTS)
    expect(segmentWholeLine(d.segments.dinner)).toBe('Toda la cena: 119/120')
    expect(segmentWholeLine(d.segments.lunch)).toBe('Todo el almuerzo: 19/70')
    const noCap = day('2026-09-10', [res({ estimated_guests: 22 })], [], {
      weekly: [],
      overrides: [],
      settings: [],
      fallbackTotal: 0,
    })
    expect(segmentWholeLine(noCap.segments.dinner)).toBe('Toda la cena: 22')
  })
})

describe('filtro de planta · el servicio manda sobre la planta', () => {
  const lunchOverride = (capacity: number, reason: string | null): SegmentConfig => ({
    ...HUB_CONFIG,
    overrides: [{ segment: 'lunch', override_date: '2026-09-10', capacity, warn_at: null, reason }],
  })
  const lunchRes = (guests: number, zone: 'planta_alta' | 'planta_baja' = 'planta_baja') =>
    res({ meal_type: 'lunch', reservation_time_local: '13:00:00', zone, estimated_guests: guests })

  it('almuerzo cerrado (cupo especial 0) y vacío: «Cerrado», no «Quedan 60 lugares»', () => {
    const s = day('2026-09-10', [], [], lunchOverride(0, 'Evento privado')).segments.lunch
    const c = zoneSectionCopy(s, zoneLoad(s, 'planta_alta', HUB_ZONE_CAPS))
    expect(c).toEqual({ status: 'Cerrado', tone: 'none', whole: null, serviceLimits: true })
    // El motivo lo pinta la vista con capSourceLabel cuando serviceLimits.
    expect(capSourceLabel(s, 4)).toBe('Cupo especial: Evento privado')
  })

  it('cerrado con un evento y sin gente: sigue «Cerrado», sin «Todo el almuerzo: 0/0»', () => {
    const s = day(
      '2026-09-10',
      [],
      [ev({ id: 'brunch', name: 'Brunch', capacity: 80, starts_at_local: '13:00:00' })],
      lunchOverride(0, 'Evento privado'),
    ).segments.lunch
    expect(s.hasActivity).toBe(true)
    const c = zoneSectionCopy(s, zoneLoad(s, 'planta_alta', HUB_ZONE_CAPS))
    expect(c.status).toBe('Cerrado')
    expect(c.whole).toBeNull()
  })

  it('cerrado pero con gente: la línea del servicio y el servicio entero en chico', () => {
    const s = day('2026-09-10', [lunchRes(5)], [], lunchOverride(0, null)).segments.lunch
    const c = zoneSectionCopy(s, zoneLoad(s, 'planta_alta', HUB_ZONE_CAPS))
    expect(c.status).toBe('Te pasaste por 5')
    expect(c.tone).toBe('over')
    expect(c.whole).toBe('Todo el almuerzo: 5/0')
  })

  it('servicio vacío con menos cupo que la planta: va el servicio entero y de dónde sale', () => {
    const s = day('2026-09-10', [], [], lunchOverride(20, null)).segments.lunch
    const c = zoneSectionCopy(s, zoneLoad(s, 'planta_alta', HUB_ZONE_CAPS))
    expect(c.status).toBe('Quedan 60 lugares en Planta Alta')
    expect(c.whole).toBe('Todo el almuerzo: 0/20')
    expect(c.serviceLimits).toBe(true)
  })

  it('servicio que no recorta la planta: como siempre (vacío no dice nada del servicio)', () => {
    const empty = day('2026-09-10', []).segments.dinner
    expect(zoneSectionCopy(empty, zoneLoad(empty, 'planta_alta', HUB_ZONE_CAPS))).toEqual({
      status: 'Quedan 60 lugares en Planta Alta',
      tone: 'none',
      whole: null,
      serviceLimits: false,
    })
    const busy = dinnerZones(46)
    const c = zoneSectionCopy(busy, zoneLoad(busy, 'planta_alta', HUB_ZONE_CAPS))
    expect(c.status).toBe('Quedan 14 lugares en Planta Alta')
    expect(c.tone).toBe('ok')
    expect(c.whole).toBe('Toda la cena: 46/120')
    expect(c.serviceLimits).toBe(false)
  })

  it('sin cupo por planta o «Sin ubicar»: no hay número de la planta que recortar', () => {
    const s = day('2026-09-10', [], [], lunchOverride(20, null)).segments.lunch
    expect(zoneSectionCopy(s, zoneLoad(s, 'planta_alta', NO_CAPS))).toMatchObject({
      status: 'Nadie en Planta Alta · sin tope',
      whole: null,
      serviceLimits: false,
    })
    expect(zoneSectionCopy(s, zoneLoad(s, 'event_floating', HUB_ZONE_CAPS))).toMatchObject({
      status: 'Nadie sin planta',
      whole: null,
      serviceLimits: false,
    })
  })
})
