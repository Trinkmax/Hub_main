import { computeBill } from '@/lib/pos/cash/bill'
import type { Bill, BillDiscount, BillLine, PayMethod, Payment } from '@/lib/pos/cash/types'

/** La base guarda centavos; el bar habla en pesos. */
export const pesos = (n: number): number => n * 100

let seq = 0
const nextId = (prefix: string): string => {
  seq += 1
  return `${prefix}-${String(seq).padStart(4, '0')}`
}

export function line(
  name: string,
  quantity: number,
  unitPesos: number,
  extra: Partial<BillLine> = {},
): BillLine {
  return {
    id: nextId('line'),
    ticket_id: 'ticket-1',
    course: 1,
    menu_item_id: `item-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    quantity,
    unit_price_cents: pesos(unitPesos),
    line_total_cents: pesos(unitPesos) * quantity,
    modifiers: [],
    notes: null,
    paid_units: 0,
    ...extra,
  }
}

export function payment(
  method: PayMethod,
  amountPesos: number,
  extra: Partial<Payment> = {},
): Payment {
  const amount = pesos(amountPesos)
  const surcharge = extra.surcharge_cents ?? 0
  const tip = extra.tip_cents ?? 0
  return {
    id: nextId('pay'),
    session_id: 'session-1',
    shift_id: 'shift-1',
    // Cada cobro, un segundo después del anterior: el orden en que se arman es el orden en que pasaron.
    created_at: new Date(Date.UTC(2026, 10, 13, 2, 10, 0) + seq * 1000).toISOString(),
    method,
    amount_cents: amount,
    surcharge_cents: surcharge,
    tip_cents: tip,
    tendered_cents: null,
    change_cents: 0,
    total_cents: amount + surcharge + tip,
    invoice: method !== 'cash' && method !== 'other',
    payer_label: null,
    item_ids: [],
    reference: null,
    status: 'ok',
    voided_at: null,
    voided_by_name: null,
    void_reason: null,
    is_practice: false,
    created_by_name: 'Luz',
    edits: [],
    ...extra,
  }
}

export function discount(
  kind: BillDiscount['kind'],
  value: number,
  extra: Partial<BillDiscount> = {},
): BillDiscount {
  return {
    id: nextId('disc'),
    kind,
    value,
    reason: 'Demora',
    amount_cents: 0,
    by_name: 'Luz',
    approved_by_name: null,
    at: '2026-11-13T02:05:00.000+00:00',
    mine: false,
    ...extra,
  }
}

/** Una cuenta con los números bien hechos (los mismos que haría la base) a partir de sus partes. */
export function makeBill(input: {
  lines: BillLine[]
  payments?: Payment[]
  discounts?: BillDiscount[]
  /** La seña de la reserva, en pesos. */
  depositPesos?: number
  partySize?: number | null
  overrides?: Partial<Omit<Bill, 'session' | 'can' | 'settings'>> & {
    session?: Partial<Bill['session']>
    can?: Partial<Bill['can']>
    settings?: Partial<Bill['settings']>
  }
}): Bill {
  const payments = input.payments ?? []
  const discounts = input.discounts ?? []
  const subtotal = input.lines.reduce((sum, l) => sum + l.line_total_cents, 0)
  const numbers = computeBill({
    subtotalCents: subtotal,
    discounts,
    depositAvailableCents: pesos(input.depositPesos ?? 0),
    payments,
  })
  const { session, can, settings, ...rest } = input.overrides ?? {}
  return {
    now: '2026-11-13T02:40:00.000+00:00',
    session: {
      id: 'session-1',
      status: 'open',
      branch_id: 'branch-1',
      table_id: 'table-12',
      table_label: '12',
      alias: null,
      party_size: input.partySize === undefined ? 4 : input.partySize,
      kind: 'table',
      is_practice: false,
      opened_at: '2026-11-13T01:20:00.000+00:00',
      bill_requested_at: '2026-11-13T02:37:00.000+00:00',
      paid_at: null,
      ...session,
    },
    bill: numbers,
    lines: input.lines,
    voids: [],
    discounts,
    payments,
    reservation: input.depositPesos
      ? {
          id: 'res-1',
          name: 'Cumple de Sofi',
          status: 'seated',
          deposit_cents: pesos(input.depositPesos),
          guests: 8,
        }
      : null,
    customer: null,
    closed: null,
    pending_approvals: [],
    shifts: [
      {
        id: 'shift-1',
        register_id: 'reg-1',
        register: 'Caja',
        label: 'Noche',
        opened_at: '2026-11-12T23:00:00.000+00:00',
        opened_by_name: 'Dueño QA',
      },
    ],
    settings: {
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
      bill_denominations: [20000, 10000, 2000, 1000, 500, 200, 100],
      transfer_alias: 'hub.bar.mp',
      transfer_holder: 'HUB SAS',
      ...settings,
    },
    can: {
      role: 'waiter',
      approve: false,
      discount_direct: false,
      void_direct: false,
      void_payment: false,
      close_without_payment: false,
      ...can,
    },
    ...rest,
  }
}
