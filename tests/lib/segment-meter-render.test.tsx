// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  SEGMENT_TONE_CLASSES,
  SegmentBar,
  SegmentChip,
  SegmentStatusDot,
  ZoneBar,
  ZoneChip,
} from '@/components/reservations/segment-meter'
import {
  computeDaySegments,
  type DaySegmentCaps,
  type ResolvedSegmentCap,
  type SegmentEventInput,
  type SegmentKey,
  type SegmentLoad,
  type SegmentReservationInput,
  type ZoneCaps,
  zoneLoad,
} from '@/lib/salon/segments'

/**
 * Render (SSR) del medidor de servicio. Los números vienen de
 * `computeDaySegments` con noches reales del HUB, así el chip se prueba con la
 * misma cuenta que ve el dueño y no con un SegmentLoad armado a mano que
 * podría no existir nunca.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}))

let seq = 0
function res(p: Partial<SegmentReservationInput>): SegmentReservationInput {
  seq += 1
  return {
    id: `r${seq}`,
    reservation_date: '2026-09-19',
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
    event_date: '2026-09-19',
    starts_at_local: '21:00:00',
    capacity: 70,
    name_override: null,
    template: { name, color_hex: '#e11d48' },
    ...rest,
  }
}

function cap(capacity: number | null, warnAt: number | null = null): ResolvedSegmentCap {
  return {
    capacity,
    warnAt,
    warnNote: null,
    source: capacity === null ? 'none' : 'weekly',
    overrideReason: null,
  }
}

function caps(over: Partial<DaySegmentCaps> = {}): DaySegmentCaps {
  return { lunch: cap(120), tea_time: cap(120), dinner: cap(120), ...over }
}

function segmentOf(
  key: SegmentKey,
  input: {
    date?: string
    reservations: SegmentReservationInput[]
    events?: SegmentEventInput[]
    caps?: DaySegmentCaps
  },
): SegmentLoad {
  return computeDaySegments({
    date: input.date ?? '2026-09-19',
    reservations: input.reservations,
    events: input.events ?? [],
    caps: input.caps ?? caps(),
  }).segments[key]
}

// 19/09 (sáb): Pizza libre de 140 sin nadie adentro + 133 normales en una cena
// de 120. Personas 133, ocupado 253: rojo por gente, no por lo apartado.
const PIZZA_19 = ev({ id: 'pizza-19', name: 'Pizza libre', capacity: 140 })
const DINNER_19_09 = segmentOf('dinner', {
  events: [PIZZA_19],
  reservations: [
    res({ estimated_guests: 40 }),
    res({ estimated_guests: 36 }),
    res({ estimated_guests: 30, zone: 'planta_baja' }),
    res({ estimated_guests: 27, zone: 'planta_baja' }),
  ],
})

// Almuerzo de un jueves: 52 contra 70 con el aviso en 50.
const LUNCH_WARN = segmentOf('lunch', {
  date: '2026-09-10',
  caps: caps({ lunch: cap(70, 50) }),
  reservations: [
    res({
      reservation_date: '2026-09-10',
      meal_type: 'lunch',
      reservation_time_local: '13:00:00',
      estimated_guests: 52,
      zone: 'planta_baja',
    }),
  ],
})

// Almuerzo tranquilo: 19 de 70, sin eventos.
const LUNCH_OK = segmentOf('lunch', {
  date: '2026-09-10',
  caps: caps({ lunch: cap(70, 50) }),
  reservations: [
    res({
      reservation_date: '2026-09-10',
      meal_type: 'lunch',
      reservation_time_local: '13:00:00',
      estimated_guests: 19,
      zone: 'planta_baja',
    }),
  ],
})

// Bar sin cupo cargado ni salón: 40 en la cena, sin tope.
const DINNER_NO_CAP = segmentOf('dinner', {
  caps: caps({ dinner: cap(null) }),
  reservations: [res({ estimated_guests: 40 })],
})

const EMPTY_TEA = segmentOf('tea_time', { reservations: [] })

// 22/09: 2x1 Burger 100 + Ratatuille 50 apartan toda la cena de 120, 56 en
// los eventos y una normal de 2 cargada igual. Ocupado 122, personas 58: rojo
// con un número que parece tener 62 lugares (normals_over).
const DINNER_22_09 = segmentOf('dinner', {
  date: '2026-09-22',
  events: [
    ev({ id: 'burger-22', name: '2x1 Burger', capacity: 100, event_date: '2026-09-22' }),
    ev({ id: 'rata-22', name: 'Ratatuille', capacity: 50, event_date: '2026-09-22' }),
  ],
  reservations: [
    res({
      reservation_date: '2026-09-22',
      scheduled_event_id: 'rata-22',
      zone: 'event_floating',
      estimated_guests: 54,
    }),
    res({
      reservation_date: '2026-09-22',
      scheduled_event_id: 'burger-22',
      zone: 'event_floating',
      estimated_guests: 2,
    }),
    res({ reservation_date: '2026-09-22', estimated_guests: 2 }),
  ],
})

function html(el: Parameters<typeof renderToString>[0]): string {
  return renderToString(el)
}

describe('SegmentChip', () => {
  it('el 19/09 muestra personas de cupo en rojo: Cena 133/120', () => {
    expect(DINNER_19_09.status).toBe('over')
    const out = html(createElement(SegmentChip, { segment: DINNER_19_09 }))
    expect(out).toContain('Cena 133/120')
    expect(out).toContain('text-destructive')
    expect(out).toContain('border-destructive/50')
    // Nunca lo ocupado como titular.
    expect(out).not.toContain('253')
  })

  it('warn usa el token de texto de warning', () => {
    expect(LUNCH_WARN.status).toBe('warn')
    const out = html(createElement(SegmentChip, { segment: LUNCH_WARN, label: 'long' }))
    expect(out).toContain('Almuerzo · 52 de 70')
    expect(out).toContain('text-warning-text')
    expect(out).toContain('bg-warning/10')
  })

  it('ok en foreground y sin actividad apagado', () => {
    const ok = html(createElement(SegmentChip, { segment: LUNCH_OK, label: 'letter' }))
    expect(ok).toContain('A 19/70')
    expect(ok).toContain('text-foreground')
    const none = html(createElement(SegmentChip, { segment: EMPTY_TEA }))
    expect(none).toContain('Mer 0/120')
    expect(none).toContain('text-muted-foreground')
  })

  it('sin tope muestra solo las personas y queda sin semáforo', () => {
    const out = html(createElement(SegmentChip, { segment: DINNER_NO_CAP }))
    expect(out).toContain('Cena 40')
    expect(out).not.toContain('Cena 40/')
    expect(out).toContain('text-muted-foreground')
  })

  it('sin onClick ni href es un span sin aria-label, con la explicación en el title', () => {
    const out = html(createElement(SegmentChip, { segment: DINNER_19_09 }))
    expect(out.startsWith('<span')).toBe(true)
    expect(out).not.toContain('aria-label')
    expect(out).toContain('title="Cena: 133 de 120 personas. Te pasaste por 13.')
  })

  it('con onClick es un botón con aria-label completo y foco visible', () => {
    const out = html(createElement(SegmentChip, { segment: DINNER_19_09, onClick: () => {} }))
    expect(out.startsWith('<button')).toBe(true)
    expect(out).toContain('type="button"')
    expect(out).toContain('aria-label="Cena: 133 de 120 personas. Te pasaste por 13.')
    expect(out).toContain('focus-visible:ring-[3px]')
  })

  it('con href es un link y respeta el aria-label que le pasan', () => {
    const out = html(
      createElement(SegmentChip, {
        segment: DINNER_19_09,
        href: '/hub/eventos/programados?month=2026-09&day=2026-09-19&seg=dinner',
        ariaLabel: 'Ver la cena del sáb 19/09',
      }),
    )
    expect(out.startsWith('<a')).toBe(true)
    expect(out).toContain('href="/hub/eventos/programados?month=2026-09&amp;day=2026-09-19')
    expect(out).toContain('aria-label="Ver la cena del sáb 19/09"')
  })

  it('normals_over: el "!" de la celda del mes y la causa para el lector (chip del salón)', () => {
    expect(DINNER_22_09).toMatchObject({ status: 'over', cause: 'normals_over', people: 58 })
    const out = html(createElement(SegmentChip, { segment: DINNER_22_09, emphasized: true }))
    expect(out.startsWith('<span')).toBe(true)
    expect(out).toMatch(/Cena 58\/120<span aria-hidden="true">!<\/span>/)
    expect(out).toContain(
      '<span class="sr-only">. Te pasaste por 2: los eventos tienen apartados 120 lugares</span>',
    )
  })

  it('normals_over interactivo: mismo "!", la causa va en el aria-label', () => {
    const out = html(createElement(SegmentChip, { segment: DINNER_22_09, onClick: () => {} }))
    expect(out).toContain('<span aria-hidden="true">!</span>')
    expect(out).toContain('Te pasaste por 2: los eventos tienen apartados 120 lugares')
    expect(out).toMatch(/aria-label="[^"]*Te pasaste por 2/)
    // El aria-label ya nombra al botón: nada de texto oculto duplicado.
    expect(out).not.toContain('sr-only')
  })

  it('sin normals_over no hay "!" ni texto oculto', () => {
    for (const segment of [DINNER_19_09, LUNCH_WARN, LUNCH_OK]) {
      const out = html(createElement(SegmentChip, { segment }))
      expect(out).not.toContain('>!<')
      expect(out).not.toContain('sr-only')
    }
  })

  it('emphasized destaca sin cambiar el tono', () => {
    const out = html(createElement(SegmentChip, { segment: LUNCH_WARN, emphasized: true }))
    expect(out).toContain('ring-primary/40')
    expect(out).toContain('font-semibold')
    expect(out).toContain('text-warning-text')
  })
})

describe('SegmentBar', () => {
  it('lleva aria-hidden', () => {
    const out = html(createElement(SegmentBar, { segment: DINNER_19_09 }))
    expect(out).toContain('aria-hidden="true"')
  })

  it('xs mide 3 px y sm h-1.5', () => {
    expect(html(createElement(SegmentBar, { segment: LUNCH_OK }))).toContain('h-[3px]')
    expect(html(createElement(SegmentBar, { segment: LUNCH_OK, size: 'sm' }))).toContain('h-1.5')
  })

  it('19/09: lo apartado y vacío del evento va rayado con su color y las normales en rojo, sin libre', () => {
    const out = html(createElement(SegmentBar, { segment: DINNER_19_09, size: 'sm' }))
    // Pista 253 = 120 apartados vacíos + 133 normales.
    expect(out).not.toContain('data-part="event"')
    expect(out).toMatch(
      /data-part="event-reserved"[^>]*style="[^"]*repeating-linear-gradient\(135deg, #e11d48 0 2px, transparent 2px 4px\)[^"]*flex-grow:120/,
    )
    expect(out).toMatch(/data-part="normal" class="[^"]*bg-destructive[^"]*" style="flex-grow:133"/)
    expect(out).not.toContain('data-part="free"')
  })

  it('evento con gente: tramo lleno con el color del formato al 0.7', () => {
    const sushi = ev({
      id: 'sushi-10',
      name: 'Sushi libre',
      event_date: '2026-09-10',
      capacity: 70,
      template: { name: 'Sushi libre', color_hex: '#0ea5e9' },
    })
    const dinner = segmentOf('dinner', {
      date: '2026-09-10',
      events: [sushi],
      reservations: [
        res({
          reservation_date: '2026-09-10',
          scheduled_event_id: 'sushi-10',
          zone: 'event_floating',
          estimated_guests: 30,
        }),
        res({ reservation_date: '2026-09-10', estimated_guests: 10 }),
      ],
    })
    const out = html(createElement(SegmentBar, { segment: dinner }))
    expect(out).toMatch(
      /data-part="event"[^>]*style="background-color:#0ea5e9;opacity:0.7;flex-grow:30"/,
    )
    expect(out).toMatch(/data-part="event-reserved"[^>]*flex-grow:40"/)
    expect(out).toMatch(/data-part="normal" class="[^"]*bg-success[^"]*" style="flex-grow:10"/)
    // 120 − (70 apartados + 10 normales) = 40 libres.
    expect(out).toMatch(/data-part="free" class="[^"]*bg-secondary[^"]*" style="flex-grow:40"/)
  })

  it('sin eventos: normales con el tono y el resto libre', () => {
    const out = html(createElement(SegmentBar, { segment: LUNCH_OK }))
    expect(out).toMatch(/data-part="normal" class="[^"]*bg-success[^"]*" style="flex-grow:19"/)
    expect(out).toMatch(/data-part="free"[^>]*style="flex-grow:51"/)
  })

  it('sin tope: la pista es lo ocupado y no hay tramo libre', () => {
    const out = html(createElement(SegmentBar, { segment: DINNER_NO_CAP }))
    expect(out).toMatch(/data-part="normal"[^>]*style="flex-grow:40"/)
    expect(out).not.toContain('data-part="free"')
  })

  it('un color de formato que no es hex no llega al style', () => {
    const weird = ev({
      id: 'weird',
      name: 'Raro',
      capacity: 50,
      template: { name: 'Raro', color_hex: 'red;background:url(x)' },
    })
    const dinner = segmentOf('dinner', { events: [weird], reservations: [] })
    const out = html(createElement(SegmentBar, { segment: dinner }))
    expect(out).not.toContain('url(x)')
    expect(out).toContain('#7c3aed')
  })
})

describe('SegmentStatusDot', () => {
  it('pinta el tono y es decorativo', () => {
    const out = html(createElement(SegmentStatusDot, { tone: 'over' }))
    expect(out).toContain('bg-destructive')
    expect(out).toContain('aria-hidden="true"')
  })
})

describe('paleta', () => {
  it('ni rose, ni amber, ni emerald, ni la sintaxis bracket de v3 para variables', () => {
    const tones = ['none', 'ok', 'warn', 'over'] as const
    const all = [
      ...tones.map((tone) => html(createElement(SegmentStatusDot, { tone }))),
      ...[DINNER_19_09, LUNCH_WARN, LUNCH_OK, DINNER_NO_CAP, EMPTY_TEA].flatMap((segment) => [
        html(createElement(SegmentChip, { segment, onClick: () => {} })),
        html(createElement(SegmentBar, { segment, size: 'sm' })),
      ]),
      JSON.stringify(SEGMENT_TONE_CLASSES),
    ].join('\n')
    expect(all).not.toContain('rose-')
    expect(all).not.toContain('amber-')
    expect(all).not.toContain('emerald-')
    expect(all).not.toMatch(/-\[--/)
  })
})

// ──────────────────────────────────────────────────────────
// Filtro de planta: ZoneChip y ZoneBar
// ──────────────────────────────────────────────────────────

const HUB_ZONE_CAPS: ZoneCaps = { planta_alta: 60, planta_baja: 70 }

// 19/09: 76 en PA (40 + 36) contra 60 → rojo; 57 en PB (30 + 27) de 70 → verde.
const PA_19_09 = zoneLoad(DINNER_19_09, 'planta_alta', HUB_ZONE_CAPS)
const PB_19_09 = zoneLoad(DINNER_19_09, 'planta_baja', HUB_ZONE_CAPS)
// 22/09: 56 de evento sin planta: sin tope.
const FLOATING_22_09 = zoneLoad(DINNER_22_09, 'event_floating', HUB_ZONE_CAPS)
// PA con 55 de 60: ámbar.
const PA_WARN = zoneLoad(
  segmentOf('dinner', { reservations: [res({ estimated_guests: 55 })] }),
  'planta_alta',
  HUB_ZONE_CAPS,
)

describe('ZoneChip', () => {
  it('19/09 en PA: 76 de 60 en rojo, con los mismos tonos que el servicio', () => {
    expect(PA_19_09.status).toBe('over')
    const out = html(createElement(ZoneChip, { load: PA_19_09 }))
    expect(out).toContain('Cena 76/60')
    expect(out).toContain('text-destructive')
    expect(out).toContain('border-destructive/50')
  })

  it('ámbar con el token de texto de warning; verde en foreground', () => {
    const warn = html(createElement(ZoneChip, { load: PA_WARN, label: 'long' }))
    expect(warn).toContain('Cena · Planta Alta · 55 de 60')
    expect(warn).toContain('text-warning-text')
    const ok = html(createElement(ZoneChip, { load: PB_19_09, label: 'letter' }))
    expect(ok).toContain('C 57/70')
    expect(ok).toContain('text-foreground')
  })

  it('Sin ubicar no tiene cupo: sin semáforo', () => {
    const out = html(createElement(ZoneChip, { load: FLOATING_22_09, label: 'long' }))
    expect(out).toContain('Cena · Sin ubicar · 56')
    expect(out).toContain('text-muted-foreground')
  })

  it('con onClick es un botón con el aria-label completo; sin, un span con title', () => {
    const button = html(
      createElement(ZoneChip, {
        load: PA_19_09,
        onClick: () => {},
        ariaLabel: 'Cena, sábado 19 de septiembre, Planta Alta: 76 de 60 personas.',
      }),
    )
    expect(button).toMatch(/^<button type="button"/)
    expect(button).toContain('aria-label="Cena, sábado 19 de septiembre, Planta Alta')
    expect(button).toContain('min-h-6')
    const span = html(createElement(ZoneChip, { load: PA_19_09 }))
    expect(span).toMatch(/^<span title="Cena, Planta Alta: 76 de 60 personas\. Te pasaste por 16/)
    expect(span).not.toContain('aria-label')
  })
})

describe('ZoneBar', () => {
  it('decorativa, xs 3 px y sm h-1.5', () => {
    const out = html(createElement(ZoneBar, { load: PB_19_09 }))
    expect(out).toContain('aria-hidden="true"')
    expect(out).toContain('h-[3px]')
    expect(html(createElement(ZoneBar, { load: PB_19_09, size: 'sm' }))).toContain('h-1.5')
  })

  it('PB 57/70: gente en verde y 13 libres', () => {
    const out = html(createElement(ZoneBar, { load: PB_19_09 }))
    expect(out).toMatch(/data-part="people" class="[^"]*bg-success[^"]*" style="flex-grow:57"/)
    expect(out).toMatch(/data-part="free" class="[^"]*bg-secondary[^"]*" style="flex-grow:13"/)
  })

  it('pasada: se llena de rojo y no queda libre', () => {
    const out = html(createElement(ZoneBar, { load: PA_19_09 }))
    expect(out).toMatch(/data-part="people" class="[^"]*bg-destructive[^"]*" style="flex-grow:76"/)
    expect(out).not.toContain('data-part="free"')
  })

  it('sin tope: toda la pista en el tono neutro', () => {
    const out = html(createElement(ZoneBar, { load: FLOATING_22_09 }))
    expect(out).toMatch(/data-part="people" class="[^"]*bg-muted-foreground\/50[^"]*"/)
    expect(out).not.toContain('data-part="free"')
  })

  it('sin gente en la planta: solo la pista', () => {
    const empty = zoneLoad(DINNER_22_09, 'planta_baja', HUB_ZONE_CAPS)
    const out = html(createElement(ZoneBar, { load: empty }))
    expect(out).not.toContain('data-part="people"')
    expect(out).toContain('data-part="free"')
  })

  it('paleta: ni rose, ni amber, ni emerald, ni bracket v3', () => {
    const all = [PA_19_09, PB_19_09, FLOATING_22_09, PA_WARN]
      .flatMap((load) => [
        html(createElement(ZoneChip, { load, onClick: () => {} })),
        html(createElement(ZoneBar, { load, size: 'sm' })),
      ])
      .join('\n')
    expect(all).not.toContain('rose-')
    expect(all).not.toContain('amber-')
    expect(all).not.toContain('emerald-')
    expect(all).not.toMatch(/-\[--/)
  })
})
