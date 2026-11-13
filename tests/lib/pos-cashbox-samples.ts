/**
 * Una noche de caja de ejemplo, con la forma exacta de lo que devuelve `pos_shift_snapshot`
 * (`lib/pos/cash/types.ts`). La usan las pruebas de la pantalla de caja.
 *
 * Es el Cerro un viernes: doce cobros con todos los medios, una corrección (crédito que era
 * efectivo), un cobro anulado, un retiro, un ingreso y un retiro anulado, más el turno del mediodía
 * ya cerrado. Los totales se arman con `liveTotals`, que está probado contra la base.
 */
import { liveTotals } from '@/lib/pos/cash/shift'
import type {
  CashMovement,
  DayPayment,
  PaymentEdit,
  RegisterRef,
  Shift,
  ShiftRow,
  ShiftSnapshot,
  ShiftSummary,
} from '@/lib/pos/cash/types'

export const TIME_ZONE = 'America/Argentina/Cordoba'
export const BILLS = [20000, 10000, 2000, 1000, 500, 200, 100]

/** La base guarda centavos; el bar habla en pesos. */
export const pesos = (n: number): number => n * 100

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const BRANCH = { id: uuid(1), name: 'Cerro', slug: 'cerro' }
export const REGISTER_ID = uuid(10)
export const BAR_REGISTER_ID = uuid(11)
export const NOON_SHIFT_ID = uuid(20)
export const NIGHT_SHIFT_ID = uuid(21)

/** El viernes 13/11/2026 es el día de servicio de la noche de ejemplo. */
const SERVICE_DAY = '2026-11-13'

/**
 * «21:40» del día de servicio, en Córdoba (UTC−3, sin horario de verano). Antes de las 5 es la
 * madrugada siguiente.
 */
export function at(clock: string, day = SERVICE_DAY): string {
  const [h = 0, m = 0] = clock.split(':').map(Number)
  const [year = 2026, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + (h < 5 ? 1 : 0), h + 3, m)).toISOString()
}

const SETTINGS: ShiftSnapshot['settings'] = {
  bill_denominations: BILLS,
  credit_surcharge_bp: 1000,
  invoice_by_method: {
    cash: false,
    transfer: true,
    qr: true,
    debit: true,
    credit: true,
    other: false,
  },
  tip_presets_pct: [10],
}

/**
 * Los ids salen de un contador que cada lista reinicia: pedir la misma noche dos veces da los
 * mismos cobros con los mismos ids (como en la base, donde un cobro no cambia de id).
 */
let seq = 100

function payment(
  over: Partial<DayPayment> & Pick<DayPayment, 'created_at' | 'method' | 'amount_cents'>,
): DayPayment {
  seq += 1
  const surcharge = over.surcharge_cents ?? 0
  const tip = over.tip_cents ?? 0
  return {
    id: uuid(seq),
    session_id: uuid(seq + 5000),
    shift_id: NIGHT_SHIFT_ID,
    surcharge_cents: surcharge,
    tip_cents: tip,
    tendered_cents: null,
    change_cents: 0,
    total_cents: over.amount_cents + surcharge + tip,
    invoice: over.method !== 'cash' && over.method !== 'other',
    payer_label: null,
    item_ids: [],
    reference: null,
    status: 'ok',
    voided_at: null,
    voided_by_name: null,
    void_reason: null,
    is_practice: false,
    created_by_name: 'Mati',
    edits: [],
    table_label: null,
    alias: null,
    table_closed: true,
    ...over,
  }
}

function movement(
  over: Partial<CashMovement> & Pick<CashMovement, 'at' | 'kind' | 'amount_cents' | 'reason'>,
): CashMovement {
  seq += 1
  return {
    id: uuid(seq),
    photo_path: null,
    by_name: 'Caro',
    voided_at: null,
    voided_by_name: null,
    void_reason: null,
    ...over,
  }
}

/** El crédito de la mesa 7 que en realidad fue efectivo: la corrección queda escrita. */
const MESA_7_EDITS: PaymentEdit[] = [
  {
    field: 'method',
    old_value: 'credit',
    new_value: 'cash',
    note: null,
    by_name: 'Caro',
    at: at('23:12'),
    after_close: false,
  },
  {
    field: 'surcharge_cents',
    old_value: String(pesos(2_350)),
    new_value: '0',
    note: null,
    by_name: 'Caro',
    at: at('23:12'),
    after_close: false,
  },
]

/** Los cobros de la noche, del primero al último. */
export function nightPayments(): DayPayment[] {
  seq = 100
  return [
    payment({
      created_at: at('20:52'),
      method: 'cash',
      amount_cents: pesos(38_500),
      tendered_cents: pesos(40_000),
      change_cents: pesos(1_500),
      table_label: '4',
    }),
    payment({
      created_at: at('21:10'),
      method: 'transfer',
      amount_cents: pesos(124_000),
      table_label: '11',
      alias: 'Los Peralta',
      created_by_name: 'Caro',
    }),
    payment({
      created_at: at('21:25'),
      method: 'qr',
      amount_cents: pesos(67_200),
      tip_cents: pesos(6_700),
      table_label: '2',
    }),
    payment({
      created_at: at('21:48'),
      method: 'cash',
      amount_cents: pesos(23_500),
      invoice: true,
      table_label: '7',
      created_by_name: 'Luz',
      edits: MESA_7_EDITS,
    }),
    payment({
      created_at: at('22:05'),
      method: 'debit',
      amount_cents: pesos(89_000),
      table_label: '9',
    }),
    payment({
      created_at: at('22:17'),
      method: 'cash',
      amount_cents: pesos(52_000),
      table_label: '14',
      table_closed: false,
      created_by_name: 'Caro',
      status: 'voided',
      voided_at: at('22:19'),
      voided_by_name: 'Caro',
      void_reason: 'Se cobró dos veces',
    }),
    payment({
      created_at: at('22:31'),
      method: 'transfer',
      amount_cents: pesos(45_000),
      table_label: '5',
      payer_label: 'Parte 1 de 2',
    }),
    payment({
      created_at: at('22:32'),
      method: 'cash',
      amount_cents: pesos(45_000),
      table_label: '5',
      payer_label: 'Parte 2 de 2',
    }),
    payment({
      created_at: at('22:50'),
      method: 'qr',
      amount_cents: pesos(85_000),
      table_label: '12',
      alias: 'Cumple de Sofi',
      created_by_name: 'Luz',
    }),
    payment({
      created_at: at('23:05'),
      method: 'credit',
      amount_cents: pesos(156_000),
      surcharge_cents: pesos(15_600),
      table_label: '3',
      created_by_name: 'Caro',
    }),
    payment({
      created_at: at('23:20'),
      method: 'cash',
      amount_cents: pesos(31_000),
      table_label: '8',
    }),
    payment({
      created_at: at('23:38'),
      method: 'qr',
      amount_cents: pesos(106_000),
      tip_cents: pesos(5_000),
      table_label: '6',
      alias: 'Sofi',
    }),
  ]
}

export function nightMovements(): CashMovement[] {
  seq = 200
  return [
    movement({ at: at('21:40'), kind: 'out', amount_cents: pesos(8_000), reason: 'Hielo' }),
    movement({
      at: at('22:00'),
      kind: 'out',
      amount_cents: pesos(80_000),
      reason: 'Proveedor de pan',
      voided_at: at('22:02'),
      voided_by_name: 'Caro',
      void_reason: 'Se anotó por error',
    }),
    movement({ at: at('22:40'), kind: 'in', amount_cents: pesos(20_000), reason: 'Cambio' }),
  ]
}

/** Los cobros del mediodía: mismo día de servicio, otro turno (ya cerrado). */
export function noonPayments(): DayPayment[] {
  seq = 300
  const noon = (
    over: Partial<DayPayment> & Pick<DayPayment, 'created_at' | 'method' | 'amount_cents'>,
  ) => payment({ shift_id: NOON_SHIFT_ID, created_by_name: 'Caro', ...over })
  return [
    noon({
      created_at: at('13:10'),
      method: 'cash',
      amount_cents: pesos(18_500),
      table_label: '1',
    }),
    noon({
      created_at: at('13:42'),
      method: 'qr',
      amount_cents: pesos(42_000),
      table_label: '4',
    }),
    noon({
      created_at: at('14:30'),
      method: 'debit',
      amount_cents: pesos(27_300),
      table_label: '2',
    }),
    noon({
      created_at: at('15:40'),
      method: 'cash',
      amount_cents: pesos(12_000),
      table_label: '6',
    }),
  ]
}

type Extras = Pick<
  ShiftSummary,
  | 'tables'
  | 'people'
  | 'consumption_cents'
  | 'discount_cents'
  | 'deposit_cents'
  | 'discounts'
  | 'deposits'
  | 'item_voids'
  | 'open_tables'
>

const NO_TABLES: Extras = {
  tables: 0,
  people: 0,
  consumption_cents: 0,
  discount_cents: 0,
  deposit_cents: 0,
  discounts: [],
  deposits: [],
  item_voids: [],
  open_tables: { count: 0, pending_cents: 0 },
}

/** Los números de un turno, armados como los arma `private.pos_shift_summary`. */
export function summarize(input: {
  shiftId: string
  payments: ReadonlyArray<DayPayment>
  movements: ReadonlyArray<CashMovement>
  openingFloatCents: number
  openingExpectedCents: number | null
  extras?: Partial<Extras>
}): ShiftSummary {
  const mine = input.payments.filter((p) => p.shift_id === input.shiftId)
  const totals = liveTotals(mine, input.movements, input.openingFloatCents)
  const extras = { ...NO_TABLES, ...input.extras }
  return {
    ...totals,
    opening_float_cents: input.openingFloatCents,
    opening_expected_cents: input.openingExpectedCents,
    ...extras,
    per_person_cents:
      extras.people > 0
        ? Math.floor((Math.floor(extras.consumption_cents / extras.people) + 50) / 100) * 100
        : null,
    payment_voids: mine
      .filter((p) => p.status === 'voided')
      .map((p) => ({
        payment_id: p.id,
        session_id: p.session_id,
        table_label: p.table_label,
        method: p.method,
        amount_cents: p.amount_cents,
        reason: p.void_reason,
        by_name: p.voided_by_name,
        at: p.voided_at ?? p.created_at,
      })),
    corrections: mine.flatMap((p) =>
      p.edits.map((edit) => ({
        payment_id: p.id,
        session_id: p.session_id,
        table_label: p.table_label,
        amount_cents: p.amount_cents,
        ...edit,
      })),
    ),
    movements: [...input.movements],
  }
}

const NIGHT_EXTRAS: Extras = {
  tables: 10,
  people: 41,
  // Lo cobrado esta noche más la seña del cumpleaños, que ya estaba paga.
  consumption_cents: pesos(890_200),
  discount_cents: pesos(23_300),
  deposit_cents: pesos(80_000),
  discounts: [
    {
      session_id: uuid(5109),
      table_label: '12',
      kind: 'percent',
      value: 1000,
      amount_cents: pesos(18_300),
      reason: 'Cumpleaños',
      by_name: 'Caro',
      approved_by_name: null,
      at: at('22:45'),
    },
    {
      session_id: uuid(5110),
      table_label: '3',
      kind: 'amount',
      value: pesos(5_000),
      amount_cents: pesos(5_000),
      reason: 'Demora',
      by_name: 'Luz',
      approved_by_name: 'Caro',
      at: at('23:01'),
    },
  ],
  deposits: [
    {
      session_id: uuid(5109),
      table_label: '12',
      name: 'Cumple de Sofi',
      amount_cents: pesos(80_000),
      by_name: 'Luz',
      at: at('22:50'),
    },
  ],
  item_voids: [
    {
      session_id: uuid(5107),
      table_label: '5',
      name: 'Clásicas',
      quantity: 3,
      amount_cents: pesos(33_000),
      reason: 'Vino frío',
      started: true,
      by_name: 'Luz',
      at: at('22:10'),
    },
  ],
  open_tables: { count: 9, pending_cents: pesos(762_700) },
}

const NOON_LAST_CLOSED: NonNullable<RegisterRef['last_closed']> = {
  shift_id: NOON_SHIFT_ID,
  label: 'Mediodía',
  closed_at: at('16:05'),
  closed_by_name: 'Caro',
  leave_float_cents: pesos(15_000),
}

function nightShift(over: Partial<Shift> = {}): Shift {
  return {
    id: NIGHT_SHIFT_ID,
    register_id: REGISTER_ID,
    register: 'Caja',
    label: 'Noche',
    status: 'open',
    service_day: SERVICE_DAY,
    is_practice: false,
    opened_at: at('20:14'),
    opened_by_name: 'Caro',
    opening_float_cents: pesos(15_000),
    opening_expected_cents: pesos(15_000),
    opening_note: null,
    closed_at: null,
    closed_by_name: null,
    counted_cash_cents: null,
    count_breakdown: null,
    expected_cash_cents: null,
    difference_cents: null,
    leave_float_cents: null,
    closing_note: null,
    summary: null,
    ...over,
  }
}

function noonShift(): Shift {
  const payments = noonPayments()
  const summary: ShiftSummary = {
    ...summarize({
      shiftId: NOON_SHIFT_ID,
      payments,
      movements: [],
      openingFloatCents: pesos(15_000),
      openingExpectedCents: pesos(15_000),
      extras: {
        tables: 4,
        people: 9,
        consumption_cents: pesos(99_800),
      },
    }),
    counted_cash_cents: pesos(45_500),
    difference_cents: 0,
    leave_float_cents: pesos(15_000),
    withdrawn_cents: pesos(30_500),
    closed_at: at('16:05'),
  }
  return {
    id: NOON_SHIFT_ID,
    register_id: REGISTER_ID,
    register: 'Caja',
    label: 'Mediodía',
    status: 'closed',
    service_day: SERVICE_DAY,
    is_practice: false,
    opened_at: at('12:02'),
    opened_by_name: 'Caro',
    opening_float_cents: pesos(15_000),
    opening_expected_cents: pesos(15_000),
    opening_note: null,
    closed_at: at('16:05'),
    closed_by_name: 'Caro',
    counted_cash_cents: pesos(45_500),
    count_breakdown: null,
    expected_cash_cents: pesos(45_500),
    difference_cents: 0,
    leave_float_cents: pesos(15_000),
    closing_note: null,
    summary,
  }
}

const byNewest = (a: DayPayment, b: DayPayment) =>
  Date.parse(b.created_at) - Date.parse(a.created_at)

/** La caja abierta en plena noche: lo que ve quien entra a «Caja» a las 23:41. */
export function sampleLive(role: 'owner' | 'cashier' = 'cashier'): ShiftSnapshot {
  const night = nightPayments()
  const movements = nightMovements()
  return {
    now: at('23:41'),
    service_day: SERVICE_DAY,
    practice: false,
    role,
    branch: BRANCH,
    settings: SETTINGS,
    registers: [
      {
        id: REGISTER_ID,
        name: 'Caja',
        position: 0,
        open_shift_id: NIGHT_SHIFT_ID,
        last_closed: NOON_LAST_CLOSED,
      },
    ],
    shift: nightShift(),
    live: summarize({
      shiftId: NIGHT_SHIFT_ID,
      payments: night,
      movements,
      openingFloatCents: pesos(15_000),
      openingExpectedCents: pesos(15_000),
      extras: NIGHT_EXTRAS,
    }),
    payments: [...night, ...noonPayments()].sort(byNewest),
    pending_approvals: [],
  }
}

/** La sucursal nunca abrió la caja: no hay cajas ni turnos. */
export function sampleFirst(role: 'owner' | 'cashier' = 'owner'): ShiftSnapshot {
  return {
    now: at('19:40'),
    service_day: SERVICE_DAY,
    practice: false,
    role,
    branch: BRANCH,
    settings: SETTINGS,
    registers: [],
    shift: null,
    live: null,
    payments: [],
    pending_approvals: [],
  }
}

/** Sin turno abierto: el último que cerró fue el del mediodía y dejó $ 15.000 de cambio. */
export function sampleClosed(role: 'owner' | 'cashier' = 'cashier'): ShiftSnapshot {
  const shift = noonShift()
  const payments = noonPayments().sort(byNewest)
  return {
    now: at('19:40'),
    service_day: SERVICE_DAY,
    practice: false,
    role,
    branch: BRANCH,
    settings: SETTINGS,
    registers: [
      {
        id: REGISTER_ID,
        name: 'Caja',
        position: 0,
        open_shift_id: null,
        last_closed: NOON_LAST_CLOSED,
      },
    ],
    shift,
    live: shift.summary,
    payments,
    pending_approvals: [],
  }
}

/** La noche ya cerrada: se contaron $ 164.000 y tenía que haber $ 165.000. */
export function sampleNightClosed(role: 'owner' | 'cashier' = 'owner'): ShiftSnapshot {
  const live = sampleLive(role)
  const liveSummary = live.live as ShiftSummary
  const closedAt = at('02:10')
  const summary: ShiftSummary = {
    ...liveSummary,
    open_tables: { count: 0, pending_cents: 0 },
    counted_cash_cents: pesos(164_000),
    difference_cents: pesos(-1_000),
    leave_float_cents: pesos(15_000),
    withdrawn_cents: pesos(149_000),
    closed_at: closedAt,
  }
  const shift = nightShift({
    status: 'closed',
    closed_at: closedAt,
    closed_by_name: 'Caro',
    counted_cash_cents: pesos(164_000),
    count_breakdown: {
      bills: [
        { value: 20000, count: 5 },
        { value: 10000, count: 4 },
        { value: 2000, count: 7 },
        { value: 1000, count: 8 },
        { value: 500, count: 3 },
        { value: 200, count: 2 },
        { value: 100, count: 1 },
      ],
      other_cents: 0,
    },
    expected_cash_cents: pesos(165_000),
    difference_cents: pesos(-1_000),
    leave_float_cents: pesos(15_000),
    closing_note: 'Faltó un billete de mil: lo revisamos mañana con la cámara.',
    summary,
  })
  return {
    ...live,
    now: at('02:12'),
    registers: [
      {
        id: REGISTER_ID,
        name: 'Caja',
        position: 0,
        open_shift_id: null,
        last_closed: {
          shift_id: NIGHT_SHIFT_ID,
          label: 'Noche',
          closed_at: closedAt,
          closed_by_name: 'Caro',
          leave_float_cents: pesos(15_000),
        },
      },
    ],
    shift,
    live: summary,
  }
}

/** El turno de la noche del jueves quedó abierto y ya es viernes al mediodía. */
export function sampleStale(role: 'owner' | 'cashier' = 'cashier'): ShiftSnapshot {
  const live = sampleLive(role)
  const day = '2026-11-12'
  const shiftBack = (iso: string) => new Date(Date.parse(iso) - 86_400_000).toISOString()
  const payments = nightPayments().map((p) => ({
    ...p,
    created_at: shiftBack(p.created_at),
    voided_at: p.voided_at ? shiftBack(p.voided_at) : null,
    edits: p.edits.map((edit) => ({ ...edit, at: shiftBack(edit.at) })),
  }))
  const movements = nightMovements().map((m) => ({
    ...m,
    at: shiftBack(m.at),
    voided_at: m.voided_at ? shiftBack(m.voided_at) : null,
  }))
  return {
    ...live,
    now: at('12:30'),
    service_day: day,
    shift: nightShift({ service_day: day, opened_at: at('20:14', day) }),
    live: summarize({
      shiftId: NIGHT_SHIFT_ID,
      payments,
      movements,
      openingFloatCents: pesos(15_000),
      openingExpectedCents: pesos(15_000),
      extras: { ...NIGHT_EXTRAS, open_tables: { count: 0, pending_cents: 0 } },
    }),
    payments: payments.sort(byNewest),
  }
}

/** El carril de práctica: un turno para aprender, con dos cobros que no cuentan. */
export function samplePractice(role: 'owner' | 'cashier' = 'cashier'): ShiftSnapshot {
  const shiftId = uuid(30)
  seq = 400
  const practice = (
    over: Partial<DayPayment> & Pick<DayPayment, 'created_at' | 'method' | 'amount_cents'>,
  ) => payment({ shift_id: shiftId, is_practice: true, created_by_name: 'Caro', ...over })
  const payments = [
    practice({
      created_at: at('18:20'),
      method: 'cash',
      amount_cents: pesos(12_000),
      table_label: '1',
    }),
    practice({
      created_at: at('18:26'),
      method: 'transfer',
      amount_cents: pesos(12_000),
      table_label: '2',
    }),
  ]
  return {
    now: at('18:30'),
    service_day: SERVICE_DAY,
    practice: true,
    role,
    branch: BRANCH,
    settings: SETTINGS,
    registers: [
      {
        id: REGISTER_ID,
        name: 'Caja',
        position: 0,
        open_shift_id: shiftId,
        last_closed: null,
      },
    ],
    shift: nightShift({
      id: shiftId,
      label: null,
      is_practice: true,
      opened_at: at('18:15'),
      opening_float_cents: pesos(10_000),
      opening_expected_cents: null,
    }),
    live: summarize({
      shiftId,
      payments,
      movements: [],
      openingFloatCents: pesos(10_000),
      openingExpectedCents: null,
      extras: { tables: 2, people: 4, consumption_cents: pesos(24_000) },
    }),
    payments: payments.sort(byNewest),
    pending_approvals: [],
  }
}

/** Dos cajas en la sucursal: la del salón está abierta; la de la barra, cerrada con $ 10.000. */
export function sampleTwoRegisters(role: 'owner' | 'cashier' = 'cashier'): ShiftSnapshot {
  const live = sampleLive(role)
  return {
    ...live,
    registers: [
      ...live.registers,
      {
        id: BAR_REGISTER_ID,
        name: 'Caja barra',
        position: 1,
        open_shift_id: null,
        last_closed: {
          shift_id: uuid(22),
          label: 'Noche',
          closed_at: at('03:20', '2026-11-12'),
          closed_by_name: 'Mati',
          leave_float_cents: pesos(10_000),
        },
      },
    ],
  }
}

/** Los últimos turnos de la sucursal, para el historial de los dueños. */
export function sampleShifts(): ShiftRow[] {
  const row = (
    n: number,
    day: string,
    label: string,
    open: string,
    close: string | null,
    by: string,
    difference: number | null,
  ): ShiftRow => ({
    id: n === 0 ? NIGHT_SHIFT_ID : n === 1 ? NOON_SHIFT_ID : uuid(40 + n),
    register_id: REGISTER_ID,
    service_day: day,
    label,
    status: close ? 'closed' : 'open',
    is_practice: false,
    opened_at: at(open, day),
    opened_by_name: by,
    opening_float_cents: pesos(15_000),
    closed_at: close ? at(close, day) : null,
    closed_by_name: close ? by : null,
    counted_cash_cents: close ? pesos(150_000) + (difference ?? 0) : null,
    expected_cash_cents: close ? pesos(150_000) : null,
    difference_cents: close ? difference : null,
    leave_float_cents: close ? pesos(15_000) : null,
  })
  return [
    row(0, '2026-11-13', 'Noche', '20:14', null, 'Caro', null),
    row(1, '2026-11-13', 'Mediodía', '12:02', '16:05', 'Caro', 0),
    row(2, '2026-11-12', 'Noche', '20:05', '02:40', 'Mati', pesos(-2_000)),
    row(3, '2026-11-12', 'Mediodía', '12:10', '16:20', 'Caro', 0),
    row(4, '2026-11-11', 'Noche', '20:20', '01:55', 'Caro', pesos(500)),
    row(5, '2026-11-11', 'Mediodía', '12:00', '16:00', 'Caro', 0),
    row(6, '2026-11-10', 'Noche', '20:10', '01:30', 'Mati', 0),
    row(7, '2026-11-08', 'Noche', '20:02', '03:10', 'Caro', pesos(-12_000)),
    row(8, '2026-11-07', 'Noche', '20:00', '03:25', 'Mati', 0),
  ]
}
