import { describe, expect, it } from 'vitest'
import {
  cashPhase,
  cashSince,
  countedUnits,
  dayLabel,
  daysApart,
  defaultLeaveFloat,
  differenceLevel,
  differenceWords,
  drawerLines,
  drawerSentence,
  liveSentence,
  MAX_BILL_COUNT,
  movementAccess,
  openShiftIds,
  paymentAccess,
  pickRegister,
  restoreCountDraft,
  serializeCountDraft,
  serviceDayAt,
  setBillCount,
  shiftTitle,
  staleWords,
  suggestShiftLabel,
  whenWords,
} from '@/lib/pos/cash/screen'
import { countTotal, emptyCount } from '@/lib/pos/cash/shift'
import type { ShiftSummary } from '@/lib/pos/cash/types'
import {
  at,
  BAR_REGISTER_ID,
  BILLS,
  NIGHT_SHIFT_ID,
  pesos,
  REGISTER_ID,
  sampleClosed,
  sampleFirst,
  sampleLive,
  sampleStale,
  sampleTwoRegisters,
  TIME_ZONE,
} from './pos-cashbox-samples'

/** `formatCentsShort` pega el signo al número con un espacio duro: así se escribe lo esperado. */
const nb = (text: string): string => text.replaceAll('$ ', '$\u00a0')

describe('el día de servicio', () => {
  it('hasta las 5 de la mañana sigue siendo la noche anterior', () => {
    expect(serviceDayAt(at('23:41'), TIME_ZONE)).toBe('2026-11-13')
    expect(serviceDayAt(at('02:10'), TIME_ZONE)).toBe('2026-11-13')
    expect(serviceDayAt(at('04:59'), TIME_ZONE)).toBe('2026-11-13')
    // `at` manda las horas antes de las 5 a la madrugada siguiente: las 05:00 son del 13.
    expect(serviceDayAt('2026-11-14T08:00:00.000Z', TIME_ZONE)).toBe('2026-11-14')
    expect(serviceDayAt('2026-11-14T07:59:00.000Z', TIME_ZONE)).toBe('2026-11-13')
  })

  it('cruza el fin de mes y de año sin perderse', () => {
    expect(serviceDayAt('2027-01-01T05:30:00.000Z', TIME_ZONE)).toBe('2026-12-31')
    expect(serviceDayAt('2026-12-01T06:00:00.000Z', TIME_ZONE)).toBe('2026-11-30')
  })

  it('una fecha ilegible no rompe, y una zona horaria mal cargada cae en Córdoba', () => {
    expect(serviceDayAt('no es una fecha', TIME_ZONE)).toBeNull()
    expect(serviceDayAt(at('23:41'), 'Marte/Olympus')).toBe('2026-11-13')
  })

  it('cuenta los días entre dos días de servicio', () => {
    expect(daysApart('2026-11-12', '2026-11-13')).toBe(1)
    expect(daysApart('2026-11-10', '2026-11-13')).toBe(3)
    expect(daysApart('2026-11-13', '2026-11-13')).toBe(0)
    expect(daysApart('2026-10-31', '2026-11-01')).toBe(1)
    expect(daysApart('cualquiera', '2026-11-01')).toBe(0)
  })

  it('escribe el día como se dice', () => {
    expect(dayLabel('2026-11-13')).toBe('vie 13/11')
    expect(dayLabel('2026-11-12', 'long')).toBe('jueves 12/11')
    expect(dayLabel('2026-11-08', 'long')).toBe('domingo 8/11')
    expect(dayLabel('ayer')).toBe('ayer')
  })

  it('dice cuándo pasó algo, desde ahora y por el calendario del bar', () => {
    expect(whenWords(at('16:05'), at('19:40'), TIME_ZONE)).toBe('hoy a las 16:05')
    // A las 2 de la mañana, lo de las 16 fue ayer.
    expect(whenWords(at('16:05'), at('02:00'), TIME_ZONE)).toBe('ayer a las 16:05')
    // Al mediodía, el cierre de las 02:10 de esa madrugada fue hoy.
    expect(whenWords(at('02:10', '2026-11-12'), at('12:00'), TIME_ZONE)).toBe('hoy a las 02:10')
    expect(whenWords(at('20:05', '2026-11-10'), at('19:40'), TIME_ZONE)).toBe(
      'el martes 10/11 a las 20:05',
    )
    expect(whenWords('nunca', at('19:40'), TIME_ZONE)).toBe('')
  })

  it('dice de cuándo es un turno que quedó abierto', () => {
    expect(staleWords(1, '2026-11-12')).toBe('de ayer')
    expect(staleWords(3, '2026-11-10')).toBe('del martes 10/11')
  })
})

describe('en qué momento está la caja', () => {
  it('sin cajas ni turnos: es la primera vez', () => {
    const snapshot = sampleFirst()
    const register = pickRegister(snapshot, null)
    expect(register).toBeNull()
    expect(cashPhase(snapshot, register, TIME_ZONE)).toEqual({ kind: 'first', register: null })
  })

  it('una caja que existe pero nunca cerró un turno también es la primera vez', () => {
    const snapshot = sampleFirst()
    const register = {
      id: REGISTER_ID,
      name: 'Caja',
      position: 0,
      open_shift_id: null,
      last_closed: null,
    }
    expect(cashPhase(snapshot, register, TIME_ZONE)).toEqual({ kind: 'first', register })
  })

  it('sin turno abierto: se confirma lo que dejó el anterior', () => {
    const snapshot = sampleClosed()
    const phase = cashPhase(snapshot, pickRegister(snapshot, null), TIME_ZONE)
    expect(phase.kind).toBe('closed')
    if (phase.kind === 'closed') {
      expect(phase.last.leave_float_cents).toBe(pesos(15_000))
      expect(phase.last.label).toBe('Mediodía')
    }
  })

  it('turno abierto hoy: no está viejo', () => {
    const snapshot = sampleLive()
    const phase = cashPhase(snapshot, pickRegister(snapshot, null), TIME_ZONE)
    expect(phase).toMatchObject({ kind: 'open', staleDays: 0 })
  })

  it('a las 2 de la mañana el turno de la noche sigue siendo de hoy', () => {
    const snapshot = { ...sampleLive(), now: at('02:10') }
    expect(cashPhase(snapshot, pickRegister(snapshot, null), TIME_ZONE)).toMatchObject({
      kind: 'open',
      staleDays: 0,
    })
  })

  it('turno que quedó abierto de ayer: lo dice', () => {
    const snapshot = sampleStale()
    const phase = cashPhase(snapshot, pickRegister(snapshot, null), TIME_ZONE)
    expect(phase).toMatchObject({ kind: 'open', staleDays: 1 })
  })

  it('con dos cajas, elige la del turno que vino y respeta la que se eligió a mano', () => {
    const snapshot = sampleTwoRegisters()
    expect(pickRegister(snapshot, null)?.id).toBe(REGISTER_ID)
    expect(pickRegister(snapshot, BAR_REGISTER_ID)?.id).toBe(BAR_REGISTER_ID)
    expect(pickRegister(snapshot, 'una-que-ya-no-existe')?.id).toBe(REGISTER_ID)
  })

  it('la otra caja está cerrada: pide confirmar SU cambio, no el de la abierta', () => {
    const snapshot = sampleTwoRegisters()
    const phase = cashPhase(snapshot, pickRegister(snapshot, BAR_REGISTER_ID), TIME_ZONE)
    expect(phase.kind).toBe('closed')
    if (phase.kind === 'closed') expect(phase.last.leave_float_cents).toBe(pesos(10_000))
  })

  it('la caja elegida tiene un turno abierto que no es el que se leyó: hay que pedirlo', () => {
    const snapshot = sampleTwoRegisters()
    const bar = pickRegister(snapshot, BAR_REGISTER_ID)
    const otherShift = '00000000-0000-4000-8000-000000000099'
    const phase = cashPhase(snapshot, bar ? { ...bar, open_shift_id: otherShift } : null, TIME_ZONE)
    expect(phase).toMatchObject({ kind: 'loading', shiftId: otherShift })
  })

  it('arma el título del turno', () => {
    expect(shiftTitle({ label: 'Noche', register: 'Caja' }, 1)).toBe('Noche')
    expect(shiftTitle({ label: 'Noche', register: 'Caja barra' }, 2)).toBe('Caja barra · Noche')
    expect(shiftTitle({ label: null, register: 'Caja' }, 1)).toBe('')
    expect(shiftTitle({ label: null, register: 'Caja barra' }, 2)).toBe('Caja barra')
  })

  it('propone el nombre del turno por la hora del bar', () => {
    expect(suggestShiftLabel(at('08:30'), TIME_ZONE)).toBe('Mañana')
    expect(suggestShiftLabel(at('12:02'), TIME_ZONE)).toBe('Mediodía')
    expect(suggestShiftLabel(at('17:00'), TIME_ZONE)).toBe('Tarde')
    expect(suggestShiftLabel(at('20:14'), TIME_ZONE)).toBe('Noche')
    expect(suggestShiftLabel(at('01:30'), TIME_ZONE)).toBe('Noche')
  })
})

describe('quién puede corregir y anular', () => {
  const open = [NIGHT_SHIFT_ID]
  const base = { status: 'ok' as const, shift_id: NIGHT_SHIFT_ID, table_closed: false }

  it('turno abierto y mesa abierta: caja y dueño corrigen y anulan', () => {
    expect(paymentAccess(base, 'cashier', open)).toEqual({ correct: true, void: true, note: null })
    expect(paymentAccess(base, 'owner', open)).toEqual({ correct: true, void: true, note: null })
  })

  it('mesa ya cerrada: se corrige, no se anula', () => {
    const access = paymentAccess({ ...base, table_closed: true }, 'cashier', open)
    expect(access.correct).toBe(true)
    expect(access.void).toBe(false)
    expect(access.note).toContain('se corrige, no se anula')
  })

  it('turno cerrado: solo un dueño', () => {
    const cashier = paymentAccess(base, 'cashier', [])
    expect(cashier).toMatchObject({ correct: false, void: false })
    expect(cashier.note).toContain('lo corrige un dueño')
    expect(paymentAccess(base, 'owner', [])).toMatchObject({ correct: true, void: true })
  })

  it('un cobro anulado no se toca más', () => {
    const access = paymentAccess({ ...base, status: 'voided' }, 'owner', open)
    expect(access).toMatchObject({ correct: false, void: false })
    expect(access.note).toContain('anulado')
  })

  it('un cobro de práctica sin turno no cuenta como turno cerrado', () => {
    expect(paymentAccess({ ...base, shift_id: null }, 'cashier', [])).toMatchObject({
      correct: true,
      void: true,
    })
  })

  it('saca los turnos abiertos de las cajas', () => {
    expect(openShiftIds(sampleLive())).toEqual([NIGHT_SHIFT_ID])
    expect(openShiftIds(sampleClosed())).toEqual([])
    expect(openShiftIds(sampleTwoRegisters())).toEqual([NIGHT_SHIFT_ID])
  })

  it('un movimiento se anula con el turno abierto; cerrado, solo un dueño', () => {
    expect(movementAccess({ voided_at: null }, 'cashier', true)).toEqual({ void: true, note: null })
    expect(movementAccess({ voided_at: null }, 'cashier', false).void).toBe(false)
    expect(movementAccess({ voided_at: null }, 'owner', false).void).toBe(true)
    expect(movementAccess({ voided_at: at('22:02') }, 'owner', true).void).toBe(false)
  })
})

describe('el arqueo', () => {
  it('cero es que cuadra', () => {
    expect(differenceLevel(0, pesos(165_000), BILLS)).toBe('exact')
  })

  it('menos que el billete más chico es vuelto redondeado', () => {
    expect(differenceLevel(pesos(-50), pesos(165_000), BILLS)).toBe('rounding')
    expect(differenceLevel(pesos(99), pesos(165_000), BILLS)).toBe('rounding')
    expect(differenceLevel(pesos(100), pesos(165_000), BILLS)).toBe('minor')
  })

  it('es grande desde el 5 % de lo que tenía que haber', () => {
    // 5 % de $ 165.000 = $ 8.250
    expect(differenceLevel(pesos(-1_000), pesos(165_000), BILLS)).toBe('minor')
    expect(differenceLevel(pesos(-8_000), pesos(165_000), BILLS)).toBe('minor')
    expect(differenceLevel(pesos(-8_250), pesos(165_000), BILLS)).toBe('large')
    expect(differenceLevel(pesos(45_000), pesos(165_000), BILLS)).toBe('large')
  })

  it('con el cajón casi vacío el piso es el billete del medio, no las monedas', () => {
    // 5 % de $ 2.000 son $ 100: sin piso, cualquier billete de $ 200 sería «grande».
    expect(differenceLevel(pesos(-200), pesos(2_000), BILLS)).toBe('minor')
    expect(differenceLevel(pesos(-1_000), pesos(2_000), BILLS)).toBe('large')
    expect(differenceLevel(pesos(-500), 0, BILLS)).toBe('minor')
  })

  it('sin lista de billetes no hay redondeo y el piso es $ 1.000', () => {
    expect(differenceLevel(pesos(-50), pesos(10_000), [])).toBe('minor')
    expect(differenceLevel(pesos(-1_000), pesos(10_000), [])).toBe('large')
  })

  it('dice la diferencia en presente y en pasado', () => {
    expect(differenceWords(0)).toEqual({ kind: 'exact', word: 'Cuadra', text: 'Cuadra' })
    expect(differenceWords(pesos(-1_000)).text).toBe(nb('Faltan $ 1.000'))
    expect(differenceWords(pesos(500)).text).toBe(nb('Sobran $ 500'))
    expect(differenceWords(0, 'past').text).toBe('Cuadró')
    expect(differenceWords(pesos(-1_000), 'past').text).toBe(nb('Faltaron $ 1.000'))
    expect(differenceWords(pesos(500), 'past')).toMatchObject({ kind: 'over', word: 'Sobraron' })
  })

  it('propone dejar el mismo cambio con el que se abrió, sin pasarse de lo contado', () => {
    expect(defaultLeaveFloat(pesos(15_000), pesos(164_000))).toBe(pesos(15_000))
    expect(defaultLeaveFloat(pesos(15_000), pesos(9_000))).toBe(pesos(9_000))
    expect(defaultLeaveFloat(pesos(15_000), 0)).toBe(0)
  })

  it('cambia la cantidad de un billete sin tocar los demás', () => {
    const count = setBillCount(setBillCount(emptyCount(BILLS), 20000, 5), 1000, 8)
    expect(countTotal(count)).toBe(pesos(108_000))
    expect(countedUnits(count)).toBe(13)
    expect(count.bills.find((bill) => bill.value === 500)?.count).toBe(0)
  })

  it('una cantidad nunca queda negativa, con decimales ni por encima del tope', () => {
    const base = emptyCount(BILLS)
    expect(setBillCount(base, 1000, -3).bills.find((b) => b.value === 1000)?.count).toBe(0)
    expect(setBillCount(base, 1000, 2.9).bills.find((b) => b.value === 1000)?.count).toBe(2)
    expect(setBillCount(base, 1000, 1e9).bills.find((b) => b.value === 1000)?.count).toBe(
      MAX_BILL_COUNT,
    )
    expect(setBillCount(base, 1000, Number.NaN).bills.find((b) => b.value === 1000)?.count).toBe(0)
  })
})

describe('el conteo a medio hacer', () => {
  const draft = {
    shiftId: NIGHT_SHIFT_ID,
    startedAt: at('02:00'),
    count: {
      ...setBillCount(setBillCount(emptyCount(BILLS), 20000, 5), 500, 3),
      other_cents: pesos(250),
    },
  }

  it('se guarda y se recupera igual', () => {
    const restored = restoreCountDraft(serializeCountDraft(draft), NIGHT_SHIFT_ID, BILLS)
    expect(restored).toEqual(draft)
    expect(restored && countTotal(restored.count)).toBe(pesos(101_750))
  })

  it('el de otro turno no vale', () => {
    expect(restoreCountDraft(serializeCountDraft(draft), 'otro-turno', BILLS)).toBeNull()
  })

  it('si el bar sacó una denominación, lo anotado ahí no se suma a escondidas', () => {
    const restored = restoreCountDraft(serializeCountDraft(draft), NIGHT_SHIFT_ID, [20000, 1000])
    expect(restored?.count.bills).toEqual([
      { value: 20000, count: 5 },
      { value: 1000, count: 0 },
    ])
  })

  it('lo que no se entiende se descarta sin romper', () => {
    expect(restoreCountDraft(null, NIGHT_SHIFT_ID, BILLS)).toBeNull()
    expect(restoreCountDraft('', NIGHT_SHIFT_ID, BILLS)).toBeNull()
    expect(restoreCountDraft('{no es json', NIGHT_SHIFT_ID, BILLS)).toBeNull()
    expect(restoreCountDraft('[]', NIGHT_SHIFT_ID, BILLS)).toBeNull()
    expect(restoreCountDraft('{"v":2}', NIGHT_SHIFT_ID, BILLS)).toBeNull()
    const broken = JSON.stringify({
      v: 1,
      shiftId: NIGHT_SHIFT_ID,
      startedAt: at('02:00'),
      bills: [['mil', 2]],
    })
    expect(restoreCountDraft(broken, NIGHT_SHIFT_ID, BILLS)).toBeNull()
  })
})

describe('lo que entró mientras se contaba', () => {
  it('solo el efectivo vigente de este turno, posterior al comienzo del conteo', () => {
    const { payments } = sampleLive()
    const late = cashSince(payments, NIGHT_SHIFT_ID, at('23:00'))
    expect(late.map((payment) => payment.table_label)).toEqual(['8'])
    expect(cashSince(payments, NIGHT_SHIFT_ID, at('23:30'))).toEqual([])
    // El efectivo anulado de las 22:17 no cuenta, aunque sea posterior.
    expect(cashSince(payments, NIGHT_SHIFT_ID, at('22:00')).map((p) => p.table_label)).toEqual([
      '8',
      '5',
    ])
    expect(cashSince(payments, 'otro-turno', at('20:00'))).toEqual([])
    expect(cashSince(payments, NIGHT_SHIFT_ID, 'cuándo')).toEqual([])
  })
})

describe('lo que se lee arriba', () => {
  const live = (over: Partial<ShiftSummary>): ShiftSummary => ({
    ...(sampleLive().live as ShiftSummary),
    ...over,
  })

  it('la noche de ejemplo da los números que se esperan', () => {
    const summary = sampleLive().live as ShiftSummary
    expect(summary.collected_cents).toBe(pesos(837_500))
    expect(summary.sales_cents).toBe(pesos(810_200))
    expect(summary.tip_cents).toBe(pesos(11_700))
    expect(summary.surcharge_cents).toBe(pesos(15_600))
    expect(summary.expected_cash_cents).toBe(pesos(165_000))
    expect(summary.payments_count).toBe(11)
    expect(summary.per_person_cents).toBe(pesos(21_712))
  })

  it('explica el número grande en una oración', () => {
    expect(liveSentence(live({}))).toBe(
      nb('Es lo que entró en 11 cobros. Hay $ 762.700 más en 9 mesas abiertas.'),
    )
    expect(
      liveSentence(live({ payments_count: 1, open_tables: { count: 1, pending_cents: 1200000 } })),
    ).toBe(nb('Es lo que entró en 1 cobro. Hay $ 12.000 más en 1 mesa abierta.'))
    expect(
      liveSentence(live({ payments_count: 0, open_tables: { count: 0, pending_cents: 0 } })),
    ).toBe('Todavía no entró ningún cobro. No queda ninguna mesa abierta.')
    // Sin cobros no hay nada a lo que sumarle «más».
    expect(
      liveSentence(live({ payments_count: 0, open_tables: { count: 3, pending_cents: 12850000 } })),
    ).toBe(nb('Todavía no entró ningún cobro. Hay $ 128.500 en 3 mesas abiertas.'))
    expect(
      liveSentence(live({ payments_count: 3, open_tables: { count: 2, pending_cents: 0 } })),
    ).toBe('Es lo que entró en 3 cobros. Hay 2 mesas abiertas, todavía sin nada para cobrar.')
    expect(
      liveSentence(live({ payments_count: 3, open_tables: { count: 1, pending_cents: 0 } })),
    ).toBe('Es lo que entró en 3 cobros. Hay 1 mesa abierta, todavía sin nada para cobrar.')
  })

  it('la cuenta del cajón suma lo que tiene que haber', () => {
    const summary = sampleLive().live as ShiftSummary
    const lines = drawerLines(summary)
    expect(lines.map((line) => line.key)).toEqual(['float', 'cash', 'in', 'out'])
    expect(lines.reduce((total, line) => total + line.cents, 0)).toBe(summary.expected_cash_cents)
    expect(drawerSentence(summary)).toBe(
      nb(
        '$ 15.000 de cambio + $ 138.000 en efectivo + $ 20.000 que entraron − $ 8.000 que se sacaron',
      ),
    )
  })

  it('sin retiros ni ingresos, la cuenta del cajón son dos renglones', () => {
    const quiet = live({ cash_in_cents: 0, cash_out_cents: 0 })
    expect(drawerLines(quiet).map((line) => line.key)).toEqual(['float', 'cash'])
    expect(drawerSentence(quiet)).toBe(nb('$ 15.000 de cambio + $ 138.000 en efectivo'))
  })
})
