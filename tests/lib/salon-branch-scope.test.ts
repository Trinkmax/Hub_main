import { describe, expect, it } from 'vitest'
import {
  branchFilterKey,
  branchFilterToParam,
  branchHasFloors,
  type CapacityBranch,
  parseBranchFilterParam,
  segmentScopeFromFilter,
  singleBranchSegmentScope,
} from '@/lib/salon/branch-scope'
import {
  floorLabel,
  NO_FLOOR_LABEL,
  pickEventTile,
  placeSelection,
  zoneForBranch,
} from '@/lib/salon/event-floor'
import { buildReservationCandidate } from '@/lib/salon/new-reservation-defaults'
import { placeLabel } from '@/lib/salon/place-label'
import { toSegmentReservationInput } from '@/lib/salon/segment-rows'
import {
  computeDaySegments,
  type DaySegmentCaps,
  projectReservation,
  type SegmentReservationInput,
} from '@/lib/salon/segments'
import { groupByService } from '@/lib/salon/services'

const MAIN: CapacityBranch = { id: 'main', isDefault: true, seatCapacity: 130 }
const CERRO: CapacityBranch = { id: 'cerro', isDefault: false, seatCapacity: 40 }

describe('branchHasFloors', () => {
  it('solo la principal tiene plantas', () => {
    expect(branchHasFloors(MAIN)).toBe(true)
    expect(branchHasFloors(CERRO)).toBe(false)
    expect(branchHasFloors(null)).toBe(false)
  })
})

describe('segmentScopeFromFilter: el cupo nunca se suma entre sucursales', () => {
  it('una sucursal: su cupo y, si tiene, sus plantas', () => {
    expect(segmentScopeFromFilter({ ids: ['cerro'] }, [MAIN, CERRO])).toEqual({
      filter: { ids: ['cerro'] },
      capacity: CERRO,
      floors: null,
    })
    expect(segmentScopeFromFilter({ ids: ['main'] }, [MAIN, CERRO])).toEqual({
      filter: { ids: ['main'] },
      capacity: MAIN,
      floors: MAIN,
    })
  })

  it('«Todas» (o varias): sin cupo, con las plantas de la principal para el filtro de planta', () => {
    expect(segmentScopeFromFilter({ ids: null }, [MAIN, CERRO])).toEqual({
      filter: { ids: null },
      capacity: null,
      floors: MAIN,
    })
    expect(segmentScopeFromFilter({ ids: ['main', 'cerro'] }, [MAIN, CERRO])).toMatchObject({
      capacity: null,
      floors: MAIN,
    })
  })

  it('todo el bar en un bar de una sola sucursal es esa sucursal', () => {
    expect(segmentScopeFromFilter({ ids: null }, [MAIN])).toMatchObject({ capacity: MAIN })
  })

  it('un id ajeno no aporta cupo, y sin sucursales no hay nada', () => {
    expect(segmentScopeFromFilter({ ids: ['otra'] }, [MAIN, CERRO])).toMatchObject({
      capacity: null,
      floors: null,
    })
    expect(segmentScopeFromFilter({ ids: [] }, [MAIN])).toMatchObject({
      capacity: null,
      floors: null,
    })
  })

  it('no comparte referencias con lo que recibe', () => {
    const ids = ['main']
    const scope = segmentScopeFromFilter({ ids }, [MAIN])
    ids.push('x')
    expect(scope.filter.ids).toEqual(['main'])
  })
})

describe('singleBranchSegmentScope', () => {
  it('arma el alcance de una sucursal concreta', () => {
    expect(singleBranchSegmentScope(CERRO)).toEqual({
      filter: { ids: ['cerro'] },
      capacity: CERRO,
      floors: null,
    })
  })
})

describe('branchFilterKey', () => {
  it('distingue todas, ninguna y cada combinación sin importar el orden', () => {
    expect(branchFilterKey({ ids: null })).toBe('todas')
    expect(branchFilterKey({ ids: [] })).toBe('ninguna')
    expect(branchFilterKey({ ids: ['b', 'a'] })).toBe(branchFilterKey({ ids: ['a', 'b'] }))
    expect(branchFilterKey({ ids: ['a'] })).not.toBe(branchFilterKey({ ids: ['b'] }))
  })
})

describe('el filtro en la URL de una descarga', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001'
  const B = 'bbbbbbbb-0000-4000-8000-000000000002'

  it('ida y vuelta', () => {
    for (const filter of [{ ids: null }, { ids: [] }, { ids: [A] }, { ids: [A, B] }]) {
      expect(parseBranchFilterParam(branchFilterToParam(filter))).toEqual(filter)
    }
  })

  it('lo que no se entiende es null (se recorta a lo que la persona ve)', () => {
    expect(parseBranchFilterParam(null)).toBeNull()
    expect(parseBranchFilterParam('')).toBeNull()
    expect(parseBranchFilterParam('cerro')).toBeNull()
    expect(parseBranchFilterParam(`${A}.x`)).toBeNull()
    expect(parseBranchFilterParam(`${A}.${A}`)).toEqual({ ids: [A] })
  })
})

describe('una sucursal sin plantas: la reserva no lleva planta', () => {
  it('floorLabel y placeLabel dicen «Salón» o el evento', () => {
    expect(floorLabel(null)).toBe(NO_FLOOR_LABEL)
    expect(placeLabel({ zone: null, scheduled_event_id: null }, null)).toBe('Salón')
    expect(placeLabel({ zone: null, scheduled_event_id: 'e1' }, 'Coraline')).toBe('Coraline')
    expect(placeLabel({ zone: 'planta_alta', scheduled_event_id: null }, null)).toBe('Planta Alta')
  })

  it('pickEventTile sin plantas deja la reserva de evento sin planta', () => {
    expect(pickEventTile({ zone: null, scheduled_event_id: null }, 'e1', false)).toEqual({
      zone: null,
      scheduled_event_id: 'e1',
    })
    // Con plantas, como siempre: arranca en «Sin definir».
    expect(pickEventTile({ zone: 'planta_alta', scheduled_event_id: null }, 'e1')).toEqual({
      zone: 'event_floating',
      scheduled_event_id: 'e1',
    })
  })

  it('zoneForBranch acomoda la planta al cambiar de sucursal', () => {
    expect(zoneForBranch({ zone: 'planta_baja', scheduled_event_id: null }, false)).toBeNull()
    expect(zoneForBranch({ zone: null, scheduled_event_id: null }, true)).toBe('planta_alta')
    expect(zoneForBranch({ zone: null, scheduled_event_id: 'e1' }, true)).toBe('event_floating')
    expect(zoneForBranch({ zone: 'planta_baja', scheduled_event_id: null }, true)).toBe(
      'planta_baja',
    )
  })

  it('placeSelection sin planta no prende ninguna tarjeta de planta', () => {
    expect(placeSelection({ zone: null, scheduled_event_id: null })).toEqual({
      floorTile: null,
      eventId: null,
      eventFloor: null,
    })
  })

  it('la fila de la base sin planta no se inventa una (antes caía en Planta Alta)', () => {
    const row = toSegmentReservationInput({
      id: 'r1',
      reservation_date: '2026-11-20',
      meal_type: 'dinner',
      reservation_time_local: '21:00:00',
      scheduled_event_id: null,
      zone: null,
      status: 'pending',
      estimated_guests: 4,
      actual_guests: null,
      kind: 'normal',
      cake_count: 0,
    })
    expect(row.zone).toBeNull()
  })

  const caps: DaySegmentCaps = {
    breakfast: {
      capacity: null,
      warnAt: null,
      warnNote: null,
      source: 'none',
      overrideReason: null,
    },
    lunch: { capacity: 40, warnAt: null, warnNote: null, source: 'fallback', overrideReason: null },
    tea_time: {
      capacity: 40,
      warnAt: null,
      warnNote: null,
      source: 'fallback',
      overrideReason: null,
    },
    dinner: {
      capacity: 40,
      warnAt: null,
      warnNote: null,
      source: 'fallback',
      overrideReason: null,
    },
  }
  const reservation = (patch: Partial<SegmentReservationInput>): SegmentReservationInput => ({
    id: 'r1',
    reservation_date: '2026-11-20',
    meal_type: 'dinner',
    reservation_time_local: '21:00:00',
    scheduled_event_id: null,
    zone: null,
    status: 'pending',
    estimated_guests: 4,
    actual_guests: null,
    kind: 'normal',
    cake_count: 0,
    ...patch,
  })

  it('cuenta en el servicio y en su evento, en ninguna planta', () => {
    const day = computeDaySegments({
      date: '2026-11-20',
      reservations: [
        reservation({ id: 'a' }),
        reservation({ id: 'b', scheduled_event_id: 'e1', estimated_guests: 6 }),
      ],
      events: [
        {
          id: 'e1',
          event_date: '2026-11-20',
          starts_at_local: '21:00:00',
          capacity: 30,
          name_override: 'Coraline',
          template: null,
        },
      ],
      caps,
    })
    expect(day.segments.dinner.people).toBe(10)
    expect(day.segments.dinner.byZone).toEqual({
      planta_alta: 0,
      planta_baja: 0,
      event_floating: 0,
    })
    expect(day.segments.dinner.events[0]?.used).toBe(6)
    expect(Object.keys(day.segments.dinner.byZone)).not.toContain('null')
  })

  it('la proyección del alta acepta una reserva sin planta', () => {
    const candidate = buildReservationCandidate({
      mode: 'create',
      values: {
        reservation_date: '2026-11-20',
        meal_type: 'dinner',
        reservation_time_local: '21:00',
        scheduled_event_id: null,
        zone: null,
        estimated_guests: 38,
        kind: 'normal',
        cake_count: 0,
      },
      loadedActualGuests: null,
      templates: [],
      eventsForDate: [],
    })
    expect(candidate.zone).toBeNull()
    const projection = projectReservation(
      {
        date: '2026-11-20',
        caps,
        settings: {
          breakfast: { defaultTime: '09:00', warnNote: null },
          lunch: { defaultTime: '13:00', warnNote: null },
          tea_time: { defaultTime: '15:30', warnNote: null },
          dinner: { defaultTime: '21:00', warnNote: null },
        },
        reservations: [reservation({ id: 'a' })],
        events: [],
      },
      candidate,
    )
    expect(projection?.after.people).toBe(42)
    expect(projection?.needsConfirm).toBe(true)
  })

  it('el corte por servicio de la lista no suma un «null» a las plantas', () => {
    const [dinner] = groupByService([
      {
        meal_type: 'dinner',
        zone: null as unknown as 'planta_alta',
        status: 'pending',
        kind: 'normal',
        cake_count: 0,
        estimated_guests: 4,
        actual_guests: null,
        reservation_time_local: '21:00:00',
      },
    ])
    expect(dinner?.covers).toBe(4)
    expect(Object.values(dinner?.byZone ?? {}).every((n) => Number.isFinite(n))).toBe(true)
  })
})
