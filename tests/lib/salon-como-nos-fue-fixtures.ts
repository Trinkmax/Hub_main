// Datos reales del HUB al 02/10/2026 (MCP, solo lectura), sin PII: por reserva
// solo `estimadas:contadas:estado`. TODOS los ids son sintéticos (formato,
// fecha, reserva): los números son los de la base, los ids no.
import type { EventMarketingRow } from '@/lib/salon/event-marketing'
import type { ReportEventRow, ReportReservationRow } from '@/lib/salon/events-report'
import type { SalonReservationStatus } from '@/lib/salon/types'

type Ev = {
  id: string
  tpl: string
  name: string
  color: string
  date: string
  start: string
  cap: number
  res: string
  mk: null | {
    s: number
    m: number | null
    r: number | null
    rev: number | null
    usd: number | null
    rpg: number | null
    cpg: number | null
    drpg: number | null
    dcpg: number | null
    u: string
  }
  private?: boolean
}

export const TODAY = '2026-10-02'

const BURGER = {
  tpl: '00000000-0000-4000-8000-000000000001',
  name: '2x1 Burger Martes',
  color: '#85ed40',
}
const PIZZA = { tpl: '00000000-0000-4000-8000-000000000002', name: 'Pizza libre', color: '#e32400' }
const MERIENDA = {
  tpl: '00000000-0000-4000-8000-000000000003',
  name: 'Merienda Libre',
  color: '#e2ed40',
}

export const BURGER_EVENTS: Ev[] = [
  {
    ...BURGER,
    id: '00000000-0000-4000-8000-000000000004',
    date: '2026-09-01',
    start: '21:00:00',
    cap: 100,
    res: '4:4:closed,2:2:closed,3:3:closed,2:2:closed,2::no_show,6:6:closed,2:2:closed,2::no_show,2:2:closed,2::no_show,4::no_show,2::no_show,3:3:closed,2:2:closed,2:2:closed',
    mk: {
      s: 14225,
      m: 86,
      r: 41767,
      rev: null,
      usd: 1600,
      rpg: 850000,
      cpg: 550000,
      drpg: 400000,
      dcpg: 150000,
      u: '2026-09-30T20:33:24.447043+00:00',
    },
  },
  {
    ...BURGER,
    id: '00000000-0000-4000-8000-000000000005',
    date: '2026-09-08',
    start: '21:00:00',
    cap: 100,
    res: '4:4:arrived,2:6:arrived,21:21:arrived,2:2:seated,3:3:closed,2:2:arrived,2:2:seated,2:2:seated,2::cancelled,2:2:arrived,4::seated,2:2:closed,2::cancelled,2::seated,6:5:closed,2::seated',
    mk: {
      s: 5341,
      m: 56,
      r: 22161,
      rev: null,
      usd: 1550,
      rpg: 1150000,
      cpg: 680000,
      drpg: null,
      dcpg: null,
      u: '2026-09-24T15:30:32.953694+00:00',
    },
  },
  {
    ...BURGER,
    id: '00000000-0000-4000-8000-000000000006',
    date: '2026-09-15',
    start: '21:00:00',
    cap: 120,
    res: '10:10:closed,2:2:closed,2:2:closed,2::cancelled,2:2:closed,2:2:closed,2:3:closed,2:2:closed,2:2:closed,2:2:closed,5:5:closed,2:2:closed,2:2:closed,2:4:closed,3:3:closed,2:2:closed,3::no_show,4:4:closed,2:2:closed,2:2:closed,4:4:closed,2::cancelled,2:2:closed,2:2:closed,2:2:closed,2:2:closed',
    mk: {
      s: 10582,
      m: 132,
      r: 32859,
      rev: null,
      usd: 1550,
      rpg: 1450000,
      cpg: 650000,
      drpg: null,
      dcpg: null,
      u: '2026-09-24T15:33:29.530805+00:00',
    },
  },
  {
    ...BURGER,
    id: '00000000-0000-4000-8000-000000000007',
    date: '2026-09-22',
    start: '21:00:00',
    cap: 100,
    res: '2:2:closed,2:2:closed,2:2:closed,2:2:closed,4:4:closed,4:3:closed,2:2:closed,2::no_show,4:4:closed,2:2:closed,2:2:closed',
    mk: {
      s: 4782,
      m: 48,
      r: 19426,
      rev: null,
      usd: null,
      rpg: null,
      cpg: null,
      drpg: null,
      dcpg: null,
      u: '2026-09-24T14:33:14.470063+00:00',
    },
  },
  {
    ...BURGER,
    id: '00000000-0000-4000-8000-000000000008',
    date: '2026-09-29',
    start: '21:00:00',
    cap: 100,
    res: '2:2:arrived,5:5:arrived,2:2:arrived,2:2:arrived,2:2:arrived,4::no_show,2:2:arrived',
    mk: {
      s: 7774,
      m: 54,
      r: 31325,
      rev: null,
      usd: null,
      rpg: null,
      cpg: null,
      drpg: null,
      dcpg: null,
      u: '2026-09-30T20:28:21.309643+00:00',
    },
  },
  {
    ...BURGER,
    id: '00000000-0000-4000-8000-000000000009',
    date: '2026-10-06',
    start: '21:00:00',
    cap: 120,
    res: '',
    mk: null,
  },
  {
    ...BURGER,
    id: '00000000-0000-4000-8000-000000000010',
    date: '2026-10-13',
    start: '21:00:00',
    cap: 100,
    res: '',
    mk: null,
  },
  {
    ...BURGER,
    id: '00000000-0000-4000-8000-000000000011',
    date: '2026-10-20',
    start: '21:00:00',
    cap: 100,
    res: '',
    mk: null,
  },
  {
    ...BURGER,
    id: '00000000-0000-4000-8000-000000000012',
    date: '2026-10-27',
    start: '21:00:00',
    cap: 60,
    res: '',
    mk: null,
  },
]

const NO_ADS = (u: string) => ({
  s: 0,
  m: null,
  r: null,
  rev: null,
  usd: null,
  rpg: null,
  cpg: null,
  drpg: null,
  dcpg: null,
  u,
})

/** `private` = lo que deja el paso de datos (sin pauta > 0 → privada). */
export const PIZZA_EVENTS: Ev[] = [
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000013',
    date: '2026-06-06',
    start: '21:00:00',
    cap: 140,
    res: '',
    mk: null,
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000014',
    date: '2026-06-15',
    start: '21:00:00',
    cap: 140,
    res: '',
    mk: null,
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000015',
    date: '2026-06-25',
    start: '21:00:00',
    cap: 140,
    res: '',
    mk: null,
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000016',
    date: '2026-08-20',
    start: '21:00:00',
    cap: 100,
    res: '',
    mk: null,
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000017',
    date: '2026-09-03',
    start: '21:00:00',
    cap: 140,
    res: '2:2:closed,5:4:closed,2:8:closed,2:2:closed,7:6:closed,2:2:closed,2:2:closed,4:3:seated,3:3:closed,2:2:closed,11:11:closed,2:2:closed,4:4:closed,2:2:closed,8:8:closed,2:2:closed,2:2:closed',
    mk: {
      s: 15526,
      m: 173,
      r: 67709,
      rev: null,
      usd: 1600,
      rpg: 1200000,
      cpg: 540000,
      drpg: 400000,
      dcpg: 140000,
      u: '2026-09-30T20:35:55.606146+00:00',
    },
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000018',
    date: '2026-09-17',
    start: '20:00:00',
    cap: 10,
    res: '10:10:closed',
    mk: NO_ADS('2026-09-19T20:06:34.927365+00:00'),
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000019',
    date: '2026-09-18',
    start: '21:00:00',
    cap: 64,
    res: '39::pending,30::pending',
    mk: NO_ADS('2026-09-22T15:36:37.79887+00:00'),
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000020',
    date: '2026-09-19',
    start: '21:00:00',
    cap: 140,
    res: '',
    mk: NO_ADS('2026-09-22T15:36:39.084883+00:00'),
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000021',
    date: '2026-09-21',
    start: '21:00:00',
    cap: 115,
    res: '15:15:arrived,5::cancelled,4:4:arrived,7:9:arrived,5:5:closed,2:2:arrived,2:2:arrived,6:6:closed,2:2:closed,5:5:arrived,2::pending,4:4:closed,8:8:arrived,2:2:arrived,4:4:arrived,2:2:arrived,5:5:arrived,6:6:arrived,2::cancelled,20::cancelled,2:2:arrived,2:2:arrived,4:4:arrived,2:2:arrived,3:3:arrived,3:3:arrived,5:5:arrived,2::pending',
    mk: {
      s: 15900,
      m: 156,
      r: 56897,
      rev: null,
      usd: 1600,
      rpg: 1600000,
      cpg: 740000,
      drpg: null,
      dcpg: null,
      u: '2026-09-24T15:49:52.515116+00:00',
    },
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000022',
    date: '2026-10-02',
    start: '14:00:00',
    cap: 140,
    res: '40:40:arrived',
    mk: null,
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000023',
    date: '2026-10-03',
    start: '22:00:00',
    cap: 140,
    res: '25::pending,20::pending,20::pending,32::pending',
    mk: null,
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000024',
    date: '2026-10-05',
    start: '21:00:00',
    cap: 20,
    res: '20::pending,10::pending',
    mk: null,
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000025',
    date: '2026-10-06',
    start: '20:00:00',
    cap: 140,
    res: '10::pending',
    mk: null,
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000026',
    date: '2026-10-09',
    start: '20:00:00',
    cap: 140,
    res: '20::pending,15::pending',
    mk: null,
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000027',
    date: '2026-10-10',
    start: '21:00:00',
    cap: 33,
    res: '10::pending,23::pending',
    mk: null,
    private: true,
  },
  {
    ...PIZZA,
    id: '00000000-0000-4000-8000-000000000028',
    date: '2026-12-05',
    start: '21:00:00',
    cap: 140,
    res: '60::cancelled',
    mk: null,
    private: true,
  },
]

export const MERIENDA_EVENTS: Ev[] = [
  {
    ...MERIENDA,
    id: '00000000-0000-4000-8000-000000000029',
    date: '2026-09-30',
    start: '17:00:00',
    cap: 78,
    res: '30:36:closed,20:19:closed,25:13:closed',
    mk: NO_ADS('2026-10-01T15:05:45.874769+00:00'),
    private: true,
  },
  {
    ...MERIENDA,
    id: '00000000-0000-4000-8000-000000000030',
    date: '2026-10-03',
    start: '16:30:00',
    cap: 79,
    res: '33::pending,31::pending',
    mk: null,
    private: true,
  },
  {
    ...MERIENDA,
    id: '00000000-0000-4000-8000-000000000031',
    date: '2026-10-04',
    start: '16:30:00',
    cap: 15,
    res: '15::pending',
    mk: null,
    private: true,
  },
  {
    ...MERIENDA,
    id: '00000000-0000-4000-8000-000000000032',
    date: '2026-10-05',
    start: '16:30:00',
    cap: 15,
    res: '15::pending',
    mk: null,
    private: true,
  },
]

/** 22/09: Ratatuille (orgánica con su cuenta) + 2x1 (pauta sin la plata de la noche). */
export const DAY_0922: Ev[] = [
  {
    tpl: '00000000-0000-4000-8000-000000000033',
    name: 'Ratatuille',
    color: '#40edc2',
    id: '00000000-0000-4000-8000-000000000034',
    date: '2026-09-22',
    start: '21:00:00',
    cap: 50,
    res: '2:3:closed,4:4:closed,2:2:closed,2:2:closed,2:2:closed,4:3:closed,2:2:closed,2:2:closed,2:2:closed,2:2:closed,2:2:closed,2:2:closed,2::no_show,3:3:closed,2:2:closed,4:4:closed,4:4:closed,4:4:closed,5:5:closed,2:2:closed',
    mk: {
      s: 0,
      m: null,
      r: null,
      rev: null,
      usd: null,
      rpg: 2500000,
      cpg: 720000,
      drpg: null,
      dcpg: null,
      u: '2026-09-24T14:13:59.633029+00:00',
    },
  },
  BURGER_EVENTS[3] as Ev,
]

/** 18/09: Sushi en pasos (evento) + Pizza libre (grupo privado) + 1 reserva sin evento. */
export const DAY_0918_EVENTS: Ev[] = [
  {
    tpl: '00000000-0000-4000-8000-000000000035',
    name: 'Sushi en pasos',
    color: '#67c17d',
    id: '00000000-0000-4000-8000-000000000036',
    date: '2026-09-18',
    start: '21:00:00',
    cap: 60,
    res: '2:2:arrived,2:2:arrived,4:4:arrived,2::cancelled,2:2:arrived,4:4:arrived,2:2:arrived,2:2:arrived,2:2:arrived,2:2:arrived,2:2:arrived,2:2:arrived,2:2:arrived,3:3:arrived,2:2:arrived,4:4:arrived,2:2:arrived,4:4:arrived,2:2:arrived,2:2:arrived,2:2:arrived,2:2:arrived,3:3:arrived,4:4:arrived,2:2:arrived',
    mk: {
      s: 20227,
      m: 76,
      r: 44156,
      rev: null,
      usd: 1550,
      rpg: 3500000,
      cpg: 1500000,
      drpg: null,
      dcpg: null,
      u: '2026-09-24T15:45:03.840654+00:00',
    },
  },
  PIZZA_EVENTS[6] as Ev,
]
export const DAY_0918_PLAIN = '2::pending,10::cancelled'

let seq = 0
function parseRes(res: string, date: string, eventId: string | null): ReportReservationRow[] {
  if (!res) return []
  return res.split(',').map((chunk) => {
    const [est, act, status] = chunk.split(':')
    seq += 1
    return {
      id: `r-${seq}`,
      reservation_date: date,
      scheduled_event_id: eventId,
      estimated_guests: Number(est),
      actual_guests: act === '' || act === undefined ? null : Number(act),
      status: status as SalonReservationStatus,
      table_label: null,
    }
  })
}

export function toEvents(evs: Ev[], withPrivate = true): ReportEventRow[] {
  return evs.map((e) => ({
    id: e.id,
    template_id: e.tpl,
    name_override: null,
    event_date: e.date,
    starts_at_local: e.start,
    capacity: e.cap,
    private_group: withPrivate ? (e.private ?? false) : false,
    template: { id: e.tpl, name: e.name, color_hex: e.color },
  }))
}

export function toRows(evs: Ev[]): ReportReservationRow[] {
  return evs.flatMap((e) => parseRes(e.res, e.date, e.id))
}

export function plainRows(res: string, date: string): ReportReservationRow[] {
  return parseRes(res, date, null)
}

export function toMarketing(evs: Ev[]): Record<string, EventMarketingRow> {
  const out: Record<string, EventMarketingRow> = {}
  for (const e of evs) {
    if (!e.mk) continue
    out[e.id] = {
      scheduledEventId: e.id,
      adSpendUsdCents: e.mk.s,
      messages: e.mk.m,
      reach: e.mk.r,
      revenueArsCents: e.mk.rev,
      usdArsRate: e.mk.usd,
      revenuePerGuestArsCents: e.mk.rpg,
      costPerGuestArsCents: e.mk.cpg,
      drinkRevenuePerGuestArsCents: e.mk.drpg,
      drinkCostPerGuestArsCents: e.mk.dcpg,
      notes: null,
      updatedAt: e.mk.u,
      updatedByName: 'Nacho B.',
    }
  }
  return out
}
