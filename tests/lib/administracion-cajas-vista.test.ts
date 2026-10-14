import { describe, expect, it } from 'vitest'
import {
  type ActivityMovement,
  activityAmountText,
  activityFromMovement,
  dayTitle,
  groupByDay,
  mergeTransfers,
  movementFromSubledger,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/activity'
import {
  flowView,
  PROJECTION_SENTENCE,
  projectionView,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/flow-view'
import {
  dayBuckets,
  moveTitle,
  OPENING_DAY_NOTE,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/move-view'
import {
  cajaEmpty,
  cajaHero,
  countStatus,
  lastMovementText,
  treasuryDetail,
  treasuryMoney,
  walletHero,
  walletTones,
  walletTotals,
  walletView,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/wallet-view'
import { buildCashDailySeries, type CashDailyAccount } from '@/lib/accounting/cash-daily'
import { heroState, treasuryTones } from '@/lib/accounting/home'
import type {
  CashFlowRow,
  CashProjectionRow,
  TreasuryBalanceRow,
} from '@/lib/accounting/queries/treasury'

/**
 * Cajas y bancos, «la billetera»: lo puro. Lo que más se cuida acá es que la
 * pantalla diga LO MISMO que el Resumen (el total, el estado «todavía no sé» y
 * el color de cada caja), que un bar recién arrancado no vea ningún «$ 0» ni
 * avisos de más, y que los movimientos se cuenten con palabras de dueño.
 */

const TODAY = '2026-10-13'
const BASE = '/hub/administracion'
/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
const money = (text: string) => text.replaceAll(' ', NB)

function row(over: Partial<TreasuryBalanceRow>): TreasuryBalanceRow {
  return {
    treasuryId: 'caja',
    accountId: null,
    name: 'Caja',
    kind: 'cash',
    accountCode: '1.1.01.01.001',
    alias: null,
    bankName: null,
    allowNegative: false,
    active: true,
    balanceCents: 0,
    pendingWalletCents: 0,
    lastMovementDate: null,
    lastCheckedOn: null,
    ...over,
  }
}

/** HUB el 13/10: dos cajas, sin saldos iniciales, sin movimientos. */
const HUB = [
  row({ treasuryId: 'efectivo', name: 'Caja Efectivo', kind: 'cash' }),
  row({ treasuryId: 'mp', name: 'Mercado Pago', kind: 'wallet', alias: 'hubsas' }),
]

/** El bar de ejemplo: tres cajas con plata, una billetera con plata en camino. */
const DEMO = [
  row({
    treasuryId: 'caja',
    name: 'Caja',
    kind: 'cash',
    balanceCents: 39_475_700,
    lastMovementDate: '2026-10-12',
  }),
  row({
    treasuryId: 'mp',
    name: 'Mercado Pago',
    kind: 'wallet',
    balanceCents: 47_141_000,
    pendingWalletCents: 140_000_000,
    lastMovementDate: '2026-10-08',
    lastCheckedOn: '2026-10-07',
  }),
  row({
    treasuryId: 'banco',
    name: 'Banco Nación',
    kind: 'bank',
    bankName: 'Banco de la Nación Argentina',
    balanceCents: 4_186_342_800,
    lastMovementDate: '2026-10-13',
  }),
]

const PENDING = { openingStatus: 'pending', booksStartDate: '2026-10-12' } as const
const POSTED = { openingStatus: 'posted', booksStartDate: '2026-09-01' } as const

describe('countStatus: cuándo va en ámbar', () => {
  const base = { today: TODAY, hasMovements: true, since: '2026-09-01' }

  it('nunca contada y sin movimientos: gris, no cuenta como «sin contar»', () => {
    expect(countStatus({ ...base, lastCheckedOn: null, hasMovements: false })).toEqual({
      tone: 'muted',
      text: 'Todavía no la contaste',
      due: false,
    })
  })

  it('la primera semana de los libros no hay ámbar, aunque haya movimientos', () => {
    // Libros del 06/10: hoy es el día 7.
    expect(countStatus({ ...base, lastCheckedOn: null, since: '2026-10-06' })).toMatchObject({
      tone: 'muted',
      due: false,
    })
    // Del 05/10: ya pasaron más de 7 días.
    expect(countStatus({ ...base, lastCheckedOn: null, since: '2026-10-05' })).toMatchObject({
      tone: 'warn',
      text: 'Todavía no la contaste',
      due: true,
    })
  })

  it('sin saber cuándo arrancan los libros, no se avisa', () => {
    expect(countStatus({ ...base, lastCheckedOn: null, since: null }).due).toBe(false)
    expect(countStatus({ ...base, lastCheckedOn: null, since: 'no-es-fecha' }).due).toBe(false)
  })

  it('hoy, ayer y hasta 7 días: verde, con las palabras de cada caso', () => {
    expect(countStatus({ ...base, lastCheckedOn: TODAY }).text).toBe('Contada hoy')
    expect(countStatus({ ...base, lastCheckedOn: '2026-10-12' }).text).toBe('Contada ayer')
    expect(countStatus({ ...base, lastCheckedOn: '2026-10-10' })).toEqual({
      tone: 'ok',
      text: 'Contada hace 3 días',
      due: false,
    })
    expect(countStatus({ ...base, lastCheckedOn: '2026-10-06' }).tone).toBe('ok')
  })

  it('más de 7 días: ámbar, con la fecha', () => {
    expect(countStatus({ ...base, lastCheckedOn: '2026-10-05' })).toEqual({
      tone: 'warn',
      text: 'La contaste por última vez el 05/10',
      due: true,
    })
  })

  it('una fecha de conteo que no es fecha se trata como «nunca»', () => {
    expect(countStatus({ ...base, lastCheckedOn: 'ayer' }).text).toBe('Todavía no la contaste')
  })
})

describe('lo que se lee de una caja', () => {
  it('el último movimiento, en palabras', () => {
    expect(lastMovementText(null, TODAY)).toBe('Sin movimientos todavía')
    expect(lastMovementText(TODAY, TODAY)).toBe('Último movimiento: hoy')
    expect(lastMovementText('2026-10-12', TODAY)).toBe('Último movimiento: ayer')
    expect(lastMovementText('2026-10-07', TODAY)).toBe('Último movimiento: el 07/10')
  })

  it('el tipo y, si tiene, el alias o el banco', () => {
    expect(treasuryDetail({ kind: 'cash' })).toBe('Efectivo')
    expect(treasuryDetail({ kind: 'wallet', alias: 'hub.bar' })).toBe('Billetera · alias hub.bar')
    expect(treasuryDetail({ kind: 'bank', bankName: 'Banco de la Nación Argentina' })).toBe(
      'Banco · Banco de la Nación Argentina',
    )
    // El alias gana: es lo que la persona reconoce.
    expect(treasuryDetail({ kind: 'bank', alias: 'hub', bankName: 'Galicia' })).toBe(
      'Banco · alias hub',
    )
  })

  it('un saldo nunca lleva un menos pelado', () => {
    expect(treasuryMoney('cash', 39_475_700)).toEqual({
      amount: money('$ 394.757'),
      label: null,
      words: null,
    })
    expect(treasuryMoney('bank', -1_200_000)).toEqual({
      amount: money('$ 12.000'),
      label: 'Descubierto',
      words: null,
    })
    expect(treasuryMoney('credit_card', -8_000_000).label).toBe('Debés')
    expect(treasuryMoney('credit_card', 150_000).label).toBe('A favor')
    expect(treasuryMoney('credit_card', 0)).toEqual({
      amount: null,
      label: null,
      words: 'Sin deuda',
    })
    // Nueve cifras, sin centavos.
    expect(treasuryMoney('bank', 12_345_678_950).amount).toBe(money('$ 123.456.790'))
  })
})

describe('walletView: el bar recién arrancado (HUB)', () => {
  const view = walletView(HUB, PENDING, { today: TODAY, canWrite: true, base: BASE })

  it('no produce ningún cero y trae «Cargar lo que hay»', () => {
    expect(view.kind).toBe('opening_pending')
    if (view.kind !== 'opening_pending') return
    expect(view.title).toBe('Todavía no sé cuánta plata hay')
    expect(view.action).toEqual({ href: `${BASE}/configurar`, label: 'Cargar lo que hay' })
    expect(JSON.stringify(view)).not.toMatch(/\$\s?0/)
    expect(JSON.stringify(view)).not.toContain('balanceCents')
  })

  it('las cajas son casilleros con su color, y sabe cuál es la de efectivo y cuál la billetera', () => {
    if (view.kind !== 'opening_pending') throw new Error('estado inesperado')
    expect(view.slots.map((s) => s.name)).toEqual(['Caja Efectivo', 'Mercado Pago'])
    expect(view.slots.map((s) => s.tone)).toEqual([
      { kind: 'cash', step: 1 },
      { kind: 'wallet', step: 1 },
    ])
    expect(view.cashName).toBe('Caja Efectivo')
    expect(view.walletName).toBe('Mercado Pago')
    expect(view.addHref).toBe(`${BASE}/ajustes?tab=cajas`)
  })

  it('usa los mismos textos que el héroe del Resumen, también para quien solo lee', () => {
    const summary = {
      treasuries: HUB.map((r) => ({
        id: r.treasuryId,
        name: r.name,
        kind: r.kind,
        accountCode: r.accountCode,
        balanceCents: r.balanceCents,
        pendingWalletCents: r.pendingWalletCents,
        lastCheckedOn: r.lastCheckedOn,
        lastMovementDate: r.lastMovementDate,
      })),
      availableCents: 0,
      pendingWalletCents: 0,
      cardDebtCents: 0,
    }
    for (const canWrite of [true, false]) {
      const hero = heroState(summary, PENDING, { canWrite, base: BASE })
      const v = walletView(HUB, PENDING, { today: TODAY, canWrite, base: BASE })
      if (hero.kind !== 'unknown' || v.kind !== 'opening_pending') throw new Error('estado')
      expect(v.title).toBe(hero.title)
      expect(v.sentence).toBe(hero.sentence)
    }
    const reader = walletView(HUB, PENDING, { today: TODAY, canWrite: false, base: BASE })
    expect(reader.kind === 'opening_pending' && reader.action).toBeNull()
  })

  it('sin ninguna caja, manda a agregar la primera', () => {
    const empty = walletView([], PENDING, { today: TODAY, canWrite: true, base: BASE })
    expect(empty).toMatchObject({
      kind: 'no_treasuries',
      title: 'Todavía no hay cajas cargadas',
      action: { href: `${BASE}/ajustes?tab=cajas`, label: 'Agregar una caja' },
    })
    expect(walletView([], null, { today: TODAY, canWrite: false, base: BASE })).toMatchObject({
      kind: 'no_treasuries',
      action: null,
    })
  })

  it('con «arrancar en cero» elegido, el cero ya es un dato: billetera normal', () => {
    const view2 = walletView(
      HUB,
      { openingStatus: 'skipped', booksStartDate: '2026-10-12' },
      { today: TODAY, base: BASE },
    )
    expect(view2.kind).toBe('normal')
  })
})

describe('walletView: el bar con plata', () => {
  const view = walletView(DEMO, POSTED, { today: TODAY, canWrite: true, base: BASE })
  if (view.kind !== 'normal') throw new Error('estado inesperado')

  it('el total y la oración son los del Resumen', () => {
    const totals = walletTotals(DEMO)
    expect(totals).toEqual({
      availableCents: 39_475_700 + 47_141_000 + 4_186_342_800,
      pendingWalletCents: 140_000_000,
      cardDebtCents: 0,
    })
    const hero = walletHero(DEMO, POSTED, { base: BASE })
    if (hero.kind !== 'normal') throw new Error('estado')
    expect(view.cents).toBe(hero.cents)
    expect(view.cents).toBe(totals.availableCents)
    expect(view.sentence).toBe(hero.sentence)
    expect(view.sentence).toContain('Repartida en 3 lugares.')
    expect(view.sentence).toContain(`Hay ${money('$ 1.400.000')} en camino`)
    expect(view.label).toBe('Plata disponible hoy')
  })

  it('una tarjeta por caja, con su link, su color por tipo y su número', () => {
    expect(view.cards.map((c) => c.name)).toEqual(['Caja', 'Mercado Pago', 'Banco Nación'])
    expect(view.cards.map((c) => c.href)).toEqual([
      `${BASE}/cajas/caja`,
      `${BASE}/cajas/mp`,
      `${BASE}/cajas/banco`,
    ])
    const tones = treasuryTones(DEMO.map((r) => ({ id: r.treasuryId, kind: r.kind })))
    for (const card of view.cards) expect(card.tone).toEqual(tones[card.id])
    expect(view.cards[0]?.money.amount).toBe(money('$ 394.757'))
    expect(view.cards[1]?.pendingCents).toBe(140_000_000)
    expect(view.cards[2]?.detail).toBe('Banco · Banco de la Nación Argentina')
  })

  it('cada tarjeta ofrece UNA acción y una sola va rellena: la primera a la que le toca algo', () => {
    expect(view.cards.map((c) => c.action?.label)).toEqual(['Contar', 'Ya me entró', 'Contar'])
    expect(view.cards.map((c) => c.action?.sheet)).toEqual(['ajustar', 'ajustar', 'ajustar'])
    // La Caja nunca se contó, tiene movimientos y los libros son de septiembre: le toca.
    expect(view.cards.map((c) => c.action?.filled)).toEqual([true, false, false])
    expect(view.cards[0]?.action?.ariaLabel).toBe('Contar Caja')
  })

  it('el estado del conteo de todas, en una píldora', () => {
    // Caja y Banco: nunca, con movimientos y libros viejos. Mercado Pago: hace 6 días.
    expect(view.countPill).toEqual({ tone: 'warn', text: '2 sin contar esta semana' })
    const allCounted = walletView(
      DEMO.map((r) => ({ ...r, lastCheckedOn: '2026-10-12' })),
      POSTED,
      { today: TODAY, base: BASE },
    )
    expect(allCounted.kind === 'normal' && allCounted.countPill).toEqual({
      tone: 'ok',
      text: 'Todas contadas esta semana',
    })
    // Con todas contadas, a la billetera con plata en camino le toca: va rellena esa.
    expect(allCounted.kind === 'normal' && allCounted.cards.map((c) => c.action?.filled)).toEqual([
      false,
      true,
      false,
    ])
  })

  it('la primera semana: nada en ámbar y ningún botón relleno', () => {
    const fresh = walletView(
      DEMO.map((r) => ({ ...r, lastCheckedOn: null, pendingWalletCents: 0 })),
      { openingStatus: 'posted', booksStartDate: '2026-10-10' },
      { today: TODAY, base: BASE },
    )
    if (fresh.kind !== 'normal') throw new Error('estado')
    expect(fresh.countPill).toEqual({ tone: 'muted', text: 'Todavía no contaste ninguna' })
    expect(fresh.cards.every((c) => c.status?.tone === 'muted')).toBe(true)
    expect(fresh.cards.some((c) => c.action?.filled)).toBe(false)
  })

  it('quien solo lee no recibe ninguna acción', () => {
    const reader = walletView(DEMO, POSTED, { today: TODAY, canWrite: false, base: BASE })
    if (reader.kind !== 'normal') throw new Error('estado')
    expect(reader.cards.every((c) => c.action === null)).toBe(true)
  })

  it('«¿Cómo se calcula?»: un renglón por caja que suma', () => {
    expect(view.math).toEqual([
      { key: 'caja', label: 'Caja', value: money('$ 394.757'), op: '+' },
      { key: 'mp', label: 'Mercado Pago', value: money('$ 471.410'), op: '+' },
      { key: 'banco', label: 'Banco Nación', value: money('$ 41.863.428'), op: '+' },
    ])
  })

  it('sabe qué acciones tienen sentido y cuándo fue el último movimiento', () => {
    expect(view).toMatchObject({
      hasNonCash: true,
      hasWallet: true,
      hasBank: true,
      lastMovementDate: '2026-10-13',
      openingMissing: null,
    })
  })
})

describe('walletView: los casos que no se ven todos los días', () => {
  it('una caja desactivada con saldo se muestra aparte y NO suma (igual que el Resumen)', () => {
    const rows = [
      ...DEMO,
      row({
        treasuryId: 'vieja',
        name: 'Caja vieja',
        kind: 'cash',
        active: false,
        balanceCents: 5_000_000,
        lastMovementDate: '2026-09-10',
      }),
    ]
    const view = walletView(rows, POSTED, { today: TODAY, canWrite: true, base: BASE })
    if (view.kind !== 'normal') throw new Error('estado')
    expect(view.cents).toBe(walletTotals(DEMO).availableCents)
    expect(view.math.map((m) => m.key)).toEqual(['caja', 'mp', 'banco'])
    expect(view.inactive).toHaveLength(1)
    expect(view.inactive[0]).toMatchObject({
      name: 'Caja vieja',
      muted: true,
      action: null,
      status: null,
      tone: null,
      footer: 'Desactivada · no suma a lo disponible',
    })
    // El color de las activas no cambia porque haya una desactivada del mismo tipo.
    expect(walletTones(rows).caja).toEqual({ kind: 'cash', step: 1 })
    expect(walletTones(rows).vieja).toBeUndefined()
  })

  it('la tarjeta de la empresa va aparte, se lee como deuda y ofrece pagar el resumen', () => {
    const rows = [
      ...DEMO,
      row({
        treasuryId: 'visa',
        name: 'Visa',
        kind: 'credit_card',
        balanceCents: -8_000_000,
        lastMovementDate: '2026-10-01',
      }),
    ]
    const view = walletView(rows, POSTED, { today: TODAY, canWrite: true, base: BASE })
    if (view.kind !== 'normal') throw new Error('estado')
    expect(view.cards).toHaveLength(3)
    expect(view.companyCards).toHaveLength(1)
    const card = view.companyCards[0]
    expect(card?.money).toEqual({ amount: money('$ 80.000'), label: 'Debés', words: null })
    expect(card?.action).toMatchObject({
      kind: 'pay_card',
      label: 'Pagar el resumen',
      sheet: 'mover',
    })
    // No suma a lo disponible, no tiene color de caja y nunca va en ámbar.
    expect(view.cents).toBe(walletTotals(DEMO).availableCents)
    expect(card?.tone).toBeNull()
    expect(card?.status).toMatchObject({ tone: 'muted', due: false })
    expect(view.sentence).toContain(`La tarjeta de la empresa debe ${money('$ 80.000')}.`)
    // Sin deuda, se cuenta como cualquier otra.
    const paid = walletView(
      rows.map((r) => (r.treasuryId === 'visa' ? { ...r, balanceCents: 0 } : r)),
      POSTED,
      { today: TODAY, base: BASE },
    )
    expect(paid.kind === 'normal' && paid.companyCards[0]?.action?.label).toBe('Contar')
    expect(paid.kind === 'normal' && paid.companyCards[0]?.money.words).toBe('Sin deuda')
  })

  it('todo en descubierto: se dice con palabras, y la cuenta resta', () => {
    const rows = [
      row({
        treasuryId: 'banco',
        name: 'Banco',
        kind: 'bank',
        balanceCents: -1_200_000,
        lastMovementDate: TODAY,
      }),
    ]
    const view = walletView(rows, POSTED, { today: TODAY, base: BASE })
    if (view.kind !== 'normal') throw new Error('estado')
    expect(view.label).toBe('Hoy estás en descubierto por')
    expect(view.cents).toBe(1_200_000)
    expect(view.cards[0]?.money.label).toBe('Descubierto')
    expect(view.math).toEqual([
      { key: 'banco', label: 'Banco (descubierto)', value: money('$ 12.000'), op: '−' },
    ])
  })

  it('con movimientos pero sin saldo inicial: billetera normal y el aviso de qué falta', () => {
    const rows = HUB.map((r, i) =>
      i === 0 ? { ...r, balanceCents: 500_000, lastMovementDate: TODAY } : r,
    )
    const view = walletView(rows, PENDING, { today: TODAY, base: BASE })
    expect(view).toMatchObject({
      kind: 'normal',
      openingMissing: { since: '2026-10-12', href: `${BASE}/configurar` },
    })
  })

  it('un nombre de 60 caracteres pasa entero (lo corta la tarjeta, no los datos)', () => {
    const name = 'Cuenta corriente en pesos del Banco de la Provincia de Córdoba'
    const view = walletView([row({ name, balanceCents: 100, lastMovementDate: TODAY })], POSTED, {
      today: TODAY,
      base: BASE,
    })
    expect(view.kind === 'normal' && view.cards[0]?.name).toBe(name)
    expect(view.kind === 'normal' && view.cards[0]?.action?.ariaLabel).toBe(`Contar ${name}`)
  })
})

describe('la ficha de una caja', () => {
  const period = { kind: 'month', month: '2026-10', from: '2026-10-01', to: '2026-10-31' } as const

  it('el número, la oración y la cuenta de una caja con plata', () => {
    const hero = cajaHero({
      kind: 'cash',
      period,
      openingCents: 27_475_700,
      inCents: 972_654_700,
      outCents: 165_791_800,
      closingCents: 834_338_600,
      closingDay: TODAY,
      today: TODAY,
    })
    expect(hero.label).toBe('Hay hoy')
    expect(hero.cents).toBe(834_338_600)
    expect(hero.sentence).toBe(
      `En octubre entraron ${money('$ 9.726.547')} y salieron ${money('$ 1.657.918')}.`,
    )
    expect(hero.math.map((m) => [m.op ?? '', m.label])).toEqual([
      ['', 'Había al empezar octubre'],
      ['+', 'Entró'],
      ['−', 'Salió'],
      ['=', 'Hay hoy'],
    ])
  })

  it('un mes que ya terminó, un período sin movimientos y un descubierto', () => {
    const september = {
      kind: 'month',
      month: '2026-09',
      from: '2026-09-01',
      to: '2026-09-30',
    } as const
    const past = cajaHero({
      kind: 'bank',
      period: september,
      openingCents: 100,
      inCents: 0,
      outCents: 0,
      closingCents: -50_000,
      closingDay: '2026-09-30',
      today: TODAY,
    })
    expect(past.label).toBe('Descubierto al 30/09')
    expect(past.cents).toBe(50_000)
    expect(past.sentence).toBe('En septiembre no hubo movimientos.')
    const range = cajaHero({
      kind: 'cash',
      period: { kind: 'range', month: null, from: '2026-08-01', to: '2026-10-13' },
      openingCents: 0,
      inCents: 100,
      outCents: 0,
      closingCents: 100,
      closingDay: TODAY,
      today: TODAY,
    })
    expect(range.sentence.startsWith('Del 01/08 al 13/10 entraron')).toBe(true)
    expect(range.math[0]?.label).toBe('Había al empezar el período')
  })

  it('la tarjeta de la empresa se lee como deuda: consumos y pagos', () => {
    const hero = cajaHero({
      kind: 'credit_card',
      period,
      openingCents: -4_000_000,
      inCents: 1_000_000,
      outCents: 5_000_000,
      closingCents: -8_000_000,
      closingDay: TODAY,
      today: TODAY,
    })
    expect(hero.label).toBe('Debés hoy')
    expect(hero.cents).toBe(8_000_000)
    expect(hero.sentence).toBe(
      `En octubre hubo consumos por ${money('$ 50.000')} y pagos por ${money('$ 10.000')}.`,
    )
    expect(hero.math.map((m) => m.label)).toEqual([
      'Debías al empezar octubre',
      'Consumos',
      'Pagos',
      'Debés hoy',
    ])
  })

  it('una caja que nunca se movió enseña qué la mueve y el paso que sigue', () => {
    expect(
      cajaEmpty({ kind: 'cash', name: 'Caja', methods: ['Efectivo'], openingPending: false }),
    ).toEqual({
      title: 'Todavía no pasó nada por Caja',
      text: 'Sube sola con el cierre del día (lo cobrado con: Efectivo) y baja con cada gasto o pago que hagas con esta caja.',
      action: 'close',
    })
    // Si ningún medio de cobro apunta a esta caja, esa aclaración no va.
    expect(cajaEmpty({ kind: 'cash', name: 'Caja', methods: [], openingPending: false }).text).toBe(
      'Sube sola con el cierre del día y baja con cada gasto o pago que hagas con esta caja.',
    )
    expect(
      cajaEmpty({ kind: 'bank', name: 'Banco', methods: [], openingPending: false }).action,
    ).toBe('move')
    expect(
      cajaEmpty({ kind: 'credit_card', name: 'Visa', methods: [], openingPending: false }).action,
    ).toBeNull()
    // Con los saldos iniciales pendientes, el paso de todas es cargar lo que hay.
    expect(
      cajaEmpty({ kind: 'bank', name: 'Banco', methods: [], openingPending: true }).action,
    ).toBe('opening')
  })
})

function movement(over: Partial<ActivityMovement>): ActivityMovement {
  return {
    key: 'k',
    date: '2026-10-05',
    documentId: 'doc-1',
    documentKind: 'expense',
    documentLabel: 'Gasto',
    description: 'Gasto · Hielo',
    memo: null,
    inCents: 0,
    outCents: 1_200_000,
    balanceCents: 0,
    treasuryId: 'caja',
    treasuryName: 'Caja',
    ...over,
  }
}

describe('activityFromMovement: lo que pasó, en palabras (con las descripciones reales de la base)', () => {
  const read = (over: Partial<ActivityMovement>, view: 'all' | 'one' = 'all') => {
    const a = activityFromMovement(movement(over), {
      view,
      kindOf: (id) => (id === 'caja' ? 'cash' : id === 'visa' ? 'credit_card' : 'bank'),
    })
    return [a.title, a.sub, a.direction, a.icon]
  }

  it('un gasto', () => {
    expect(read({})).toEqual(['Hielo', 'Gasto', 'out', 'expense'])
    expect(read({ description: 'Gasto · Verduras de la semana' })[0]).toBe('Verduras de la semana')
  })

  it('las ventas de un cierre del día', () => {
    expect(
      read({
        documentKind: 'sales_close',
        description: 'Cierre del día lunes 05/10/2026',
        memo: 'Efectivo',
        inCents: 12_001_300,
        outCents: 0,
      }),
    ).toEqual(['Ventas del lunes 05/10', 'Cierre del día · Efectivo', 'in', 'sale'])
  })

  it('un pago a un proveedor, con y sin su factura', () => {
    expect(
      read({
        documentKind: 'payment',
        description: 'Pago · Limpieza Demo SA · Factura A 0002-00000129',
      }),
    ).toEqual(['Limpieza Demo SA', 'Pago · Factura A 0002-00000129', 'out', 'payment'])
    expect(read({ documentKind: 'payment', description: 'Pago · Carnicería Demo SRL' })[1]).toBe(
      'Pago',
    )
  })

  it('un cobro, y lo que entró de la billetera al contarla', () => {
    expect(
      read({ documentKind: 'collection', description: 'Cobro · Rappi', inCents: 500, outCents: 0 }),
    ).toEqual(['Rappi', 'Te entró', 'in', 'collection'])
    expect(
      read({
        documentKind: 'collection',
        description: 'Ajuste de saldo de Mercado Pago · Mercado Pago',
        memo: 'Ajuste de saldo de Mercado Pago',
        inCents: 500,
        outCents: 0,
      }),
    ).toEqual(['Entró lo que estaba en camino', 'Conteo de Mercado Pago', 'in', 'count'])
  })

  it('un pasaje entre cajas: en la portada, de dónde a dónde; en la ficha, la otra caja', () => {
    const transfer = {
      documentKind: 'transfer',
      description: 'Movimiento entre cuentas · Caja → Banco Nación',
      memo: 'A Banco Nación',
    }
    expect(read(transfer)).toEqual([
      'Caja → Banco Nación',
      'Plata movida entre cajas',
      'out',
      'transfer',
    ])
    expect(read(transfer, 'one')[0]).toBe('A Banco Nación')
    expect(read({ ...transfer, memo: 'De Caja', inCents: 100, outCents: 0 }, 'one')[0]).toBe(
      'De Caja',
    )
    // Con descripción propia, esa.
    expect(
      read({ documentKind: 'transfer', description: 'Cambio para la caja', memo: 'A Caja' }),
    ).toEqual(['Cambio para la caja', 'Plata movida entre cajas', 'out', 'transfer'])
  })

  it('los gastos del banco', () => {
    expect(
      read({ documentKind: 'bank_expense', description: 'Gasto bancario · Banco Nación' }),
    ).toEqual(['Gastos del banco', 'Comisiones e impuestos', 'out', 'bank'])
  })

  it('un socio, una seña, un préstamo y lo que rindió la billetera', () => {
    expect(
      read({
        documentKind: 'cash_movement',
        description: 'Retiro de un socio · Juan Pérez · Caja',
      }),
    ).toEqual(['Retiro de un socio', 'Juan Pérez', 'out', 'partner'])
    expect(
      read({
        documentKind: 'cash_movement',
        description: 'Aporte de un socio · Juan Pérez · Caja',
        inCents: 1,
        outCents: 0,
      })[0],
    ).toBe('Aporte de un socio')
    expect(
      read({
        documentKind: 'cash_movement',
        description: 'Rendimiento de Mercado Pago · Intereses y rendimientos · Mercado Pago',
        inCents: 1,
        outCents: 0,
      }),
    ).toEqual(['Rindió Mercado Pago', 'Intereses y rendimientos', 'in', 'other'])
    expect(
      read({
        documentKind: 'cash_movement',
        description: 'Seña recibida · Señas de clientes · Caja',
        inCents: 1,
        outCents: 0,
      })[0],
    ).toBe('Seña de un cliente')
    expect(
      read({
        documentKind: 'cash_movement',
        description: 'Préstamo recibido · Préstamos bancarios · Banco',
        inCents: 1,
        outCents: 0,
      })[0],
    ).toBe('Préstamo recibido')
  })

  it('otra entrada u otra salida: el nombre de lo que fue', () => {
    expect(
      read({
        documentKind: 'cash_movement',
        description: 'Otro egreso · Energía eléctrica · Banco Nación',
      }),
    ).toEqual(['Energía eléctrica', 'Otra salida', 'out', 'other'])
    expect(
      read({
        documentKind: 'cash_movement',
        description: 'Otro ingreso · Ingresos varios · Caja',
        inCents: 1,
        outCents: 0,
      })[1],
    ).toBe('Otra entrada')
  })

  it('un conteo con diferencia: en efectivo faltó o sobró; en el resto, había más o menos', () => {
    const count = {
      documentKind: 'treasury_adjustment',
      description: 'Ajuste de saldo · Caja · faltante',
    }
    expect(read({ ...count, outCents: 125_700 })).toEqual([
      `Faltaron ${money('$ 1.257')} al contar`,
      'Conteo de caja',
      'out',
      'count',
    ])
    expect(read({ ...count, inCents: 50_000, outCents: 0 })[0]).toBe(
      `Sobraron ${money('$ 500')} al contar`,
    )
    expect(read({ ...count, treasuryId: 'banco', outCents: 867_600 })[0]).toBe(
      `Había ${money('$ 8.676')} menos que en el sistema`,
    )
    expect(read({ ...count, treasuryId: 'banco', inCents: 100_000, outCents: 0 })[0]).toBe(
      `Había ${money('$ 1.000')} más que en el sistema`,
    )
    // En la tarjeta, lo que «sale» (Haber) es deuda de más.
    expect(read({ ...count, treasuryId: 'visa', outCents: 100_000 })[0]).toBe(
      `Debías ${money('$ 1.000')} más que en el sistema`,
    )
  })

  it('lo que había al arrancar y una anulación', () => {
    expect(
      read({
        documentKind: 'opening',
        description: 'Asiento de apertura',
        memo: 'Caja',
        inCents: 1,
        outCents: 0,
      }),
    ).toEqual(['Lo que había al arrancar', 'Saldos iniciales', 'in', 'opening'])
    expect(
      read({
        documentKind: 'reversal',
        description: 'Anulación de Gasto · Hielo',
        inCents: 1,
        outCents: 0,
      }),
    ).toEqual(['Se anuló: Gasto · Hielo', 'Anulación', 'in', 'reversal'])
  })

  it('lo que no calza con el patrón se muestra tal cual, nunca inventado', () => {
    expect(
      read({ documentKind: 'expense', description: 'Compra de hielo', documentLabel: 'Gasto' }),
    ).toEqual(['Compra de hielo', 'Gasto', 'out', 'expense'])
    expect(
      read({
        documentKind: 'manual',
        description: 'Ajuste de la contadora',
        documentLabel: 'Asiento manual',
      }),
    ).toEqual(['Ajuste de la contadora', 'Asiento manual', 'out', 'other'])
    expect(read({ documentKind: null, description: null, documentLabel: null })).toEqual([
      'Movimiento',
      'Movimiento',
      'out',
      'other',
    ])
    // Un conteo sin importe no dice «Faltaron $ 0».
    expect(
      read({
        documentKind: 'treasury_adjustment',
        description: 'Ajuste de saldo · Caja · faltante',
        outCents: 0,
      })[0],
    ).toBe('Ajuste de saldo · Caja · faltante')
  })

  it('el importe va con flecha y signo: la dirección no depende del color', () => {
    expect(activityAmountText({ direction: 'in', cents: 12_001_300 })).toBe(
      `↑ + ${money('$ 120.013')}`,
    )
    expect(activityAmountText({ direction: 'out', cents: 1_200_000 })).toBe(
      `↓ − ${money('$ 12.000')}`,
    )
    expect(activityAmountText({ direction: 'neutral', cents: 20_000_000 })).toBe(
      `↔ ${money('$ 200.000')}`,
    )
  })

  it('el renglón lleva al comprobante; sin comprobante, a ningún lado', () => {
    expect(activityFromMovement(movement({})).path).toBe('/comprobantes/doc-1')
    expect(activityFromMovement(movement({ documentId: null })).path).toBeNull()
  })
})

describe('mergeTransfers y groupByDay', () => {
  const out = activityFromMovement(
    movement({
      key: 'a',
      documentId: 'pase',
      documentKind: 'transfer',
      description: 'Movimiento entre cuentas · Caja → Banco Nación',
      memo: 'A Banco Nación',
      outCents: 20_000_000,
    }),
  )
  const into = activityFromMovement(
    movement({
      key: 'b',
      documentId: 'pase',
      documentKind: 'transfer',
      description: 'Movimiento entre cuentas · Caja → Banco Nación',
      memo: 'De Caja',
      inCents: 20_000_000,
      outCents: 0,
      treasuryId: 'banco',
      treasuryName: 'Banco Nación',
    }),
  )
  const expense = activityFromMovement(movement({ key: 'c', documentId: 'gasto' }))

  it('las dos líneas de un pasaje se juntan en un renglón, sin caja ni sentido', () => {
    const merged = mergeTransfers([expense, into, out])
    expect(merged).toHaveLength(2)
    expect(merged[1]).toMatchObject({
      title: 'Caja → Banco Nación',
      direction: 'neutral',
      cents: 20_000_000,
      treasuryId: null,
    })
    expect(merged[0]).toBe(expense)
  })

  it('un pasaje del que llegó una sola línea queda como vino', () => {
    expect(mergeTransfers([out])).toEqual([out])
    expect(mergeTransfers([])).toEqual([])
  })

  it('agrupa por día, lo más nuevo arriba, con lo que entró y salió y el saldo de cierre', () => {
    const rows = [
      activityFromMovement(
        movement({ key: '1', date: '2026-10-12', outCents: 100, balanceCents: 900 }),
      ),
      activityFromMovement(
        movement({ key: '2', date: '2026-10-13', inCents: 500, outCents: 0, balanceCents: 1_400 }),
      ),
      activityFromMovement(
        movement({ key: '3', date: '2026-10-13', outCents: 200, balanceCents: 1_200 }),
      ),
    ]
    const days = groupByDay(rows, { today: TODAY, newestFirst: true })
    expect(days.map((d) => d.title)).toEqual(['Martes 13/10 · hoy', 'Lunes 12/10 · ayer'])
    expect(days[0]).toMatchObject({ inCents: 500, outCents: 200, closingCents: 1_200 })
    // Dentro del día, lo último primero.
    expect(days[0]?.rows.map((r) => r.key)).toEqual(['3', '2'])
    // Sin `newestFirst`, como vienen de la base.
    expect(groupByDay(rows, { today: TODAY }).map((d) => d.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
    ])
    expect(groupByDay([], { today: TODAY })).toEqual([])
    expect(dayTitle('2026-10-09', TODAY)).toBe('Viernes 09/10')
  })

  it('un pasaje ya unido no cuenta como entrada ni como salida del día', () => {
    const [day] = groupByDay(mergeTransfers([into, out]), { today: TODAY })
    expect(day).toMatchObject({ inCents: 0, outCents: 0 })
  })

  it('una fila del subdiario pasa a movimiento; el «saldo anterior» no', () => {
    const base = { documentId: 'd', entryId: 'e', date: '2026-10-05' }
    expect(movementFromSubledger({ ...base, rowKind: 'opening', values: {} }, 0)).toBeNull()
    expect(
      movementFromSubledger(
        {
          ...base,
          rowKind: 'line',
          values: {
            document_kind: 'expense',
            description: 'Gasto · Hielo',
            inflow_cents: 0,
            outflow_cents: 1_200_000,
            balance_cents: 38_275_700,
            treasury_id: 'caja',
            treasury_name: 'Caja',
          },
        },
        3,
      ),
    ).toMatchObject({
      key: 'e-3',
      documentKind: 'expense',
      outCents: 1_200_000,
      treasuryName: 'Caja',
      memo: null,
    })
  })
})

function account(over: Partial<CashDailyAccount>): CashDailyAccount {
  return {
    treasuryId: null,
    name: '',
    kind: null,
    active: true,
    openingCents: 0,
    closingCents: 0,
    days: [],
    ...over,
  }
}

describe('moveTitle: el título que afirma', () => {
  const up = { mode: 'money', openingCents: 1_132_024_700, closingCents: 4_272_959_500 } as const
  const down = { mode: 'money', openingCents: 100_000_000, closingCents: 76_000_000 } as const
  const flat = { mode: 'money', openingCents: 5, closingCents: 5 } as const

  it('los últimos 30 días', () => {
    const frame = { kind: 'days', days: 30 } as const
    expect(moveTitle({ series: up, frame })).toBe(
      `Hay ${money('$ 31.409.348')} más que hace 30 días`,
    )
    expect(moveTitle({ series: down, frame })).toBe(
      `Hay ${money('$ 240.000')} menos que hace 30 días`,
    )
    expect(moveTitle({ series: flat, frame })).toBe('Hay lo mismo que hace 30 días')
  })

  it('este mes y el mes pasado', () => {
    expect(moveTitle({ series: up, frame: { kind: 'month_to_date', month: '2026-10-01' } })).toBe(
      `Hay ${money('$ 31.409.348')} más que al empezar octubre`,
    )
    expect(moveTitle({ series: down, frame: { kind: 'past_month', month: '2026-09-01' } })).toBe(
      `Septiembre terminó con ${money('$ 240.000')} menos de lo que empezó`,
    )
    expect(moveTitle({ series: flat, frame: { kind: 'past_month', month: '2026-09' } })).toBe(
      'Septiembre terminó con lo mismo que empezó',
    )
  })

  it('con el nombre de la caja (la ficha)', () => {
    expect(
      moveTitle({
        series: down,
        frame: { kind: 'month_to_date', month: '2026-10' },
        subject: 'Caja',
      }),
    ).toBe(`Caja tiene ${money('$ 240.000')} menos que al empezar octubre`)
    expect(
      moveTitle({ series: up, frame: { kind: 'past_month', month: '2026-09' }, subject: 'Caja' }),
    ).toBe(`Caja terminó septiembre con ${money('$ 31.409.348')} más de lo que empezó`)
    expect(
      moveTitle({ series: up, frame: { kind: 'range', endsToday: true }, subject: 'Caja' }),
    ).toBe(`Caja tiene ${money('$ 31.409.348')} más que al empezar el período`)
  })

  it('libros nuevos: no compara contra un cero que no es un dato', () => {
    expect(moveTitle({ series: up, frame: { kind: 'days', days: 30 }, tooNew: true })).toBe(
      'Así viene la plata desde que arrancaste',
    )
  })

  it('la tarjeta de la empresa: lo que se mueve es la deuda', () => {
    const frame = { kind: 'days', days: 30 } as const
    const card = { mode: 'card', openingCents: 4_000_000, closingCents: 7_000_000 } as const
    expect(moveTitle({ series: card, frame, subject: 'Visa' })).toBe(
      `La deuda de Visa subió ${money('$ 30.000')}`,
    )
    expect(
      moveTitle({ series: { ...card, closingCents: 1_000_000 }, frame, subject: 'Visa' }),
    ).toBe(`La deuda de Visa bajó ${money('$ 30.000')}`)
    expect(
      moveTitle({ series: { ...card, closingCents: 4_000_000 }, frame, subject: 'Visa' }),
    ).toBe('La deuda de Visa no cambió')
  })
})

describe('dayBuckets: un tramo por día', () => {
  const range = { from: '2026-10-10', to: '2026-10-13' }
  const series = buildCashDailySeries(
    account({
      openingCents: 0,
      days: [
        { day: '2026-10-12', inCents: 50_000_000, outCents: 0, balanceCents: 50_000_000 },
        { day: '2026-10-13', inCents: 1_000_000, outCents: 300_000, balanceCents: 50_700_000 },
      ],
    }),
    range,
  )

  it('saltea el día de arranque (lo que había no es plata que entró) y deja la nota', () => {
    const { buckets, note } = dayBuckets(series, { booksStartDate: '2026-10-12' })
    // Los días anteriores al arranque no se dibujan.
    expect(buckets.map((b) => b.key)).toEqual(['2026-10-12', '2026-10-13'])
    expect(buckets[0]).toMatchObject({ inCents: 0, outCents: 0 })
    expect(buckets[1]).toMatchObject({ inCents: 1_000_000, outCents: 300_000, shortLabel: '13' })
    expect(note).toBe(OPENING_DAY_NOTE)
  })

  it('con un mes de días, el eje rotula unos siete y siempre el último', () => {
    const days = Array.from({ length: 30 }, (_, i) => {
      const day = `2026-09-${String(i + 1).padStart(2, '0')}`
      return { day, inCents: 1_000, outCents: 0, balanceCents: 1_000 * (i + 1) }
    })
    const month = buildCashDailySeries(account({ openingCents: 0, closingCents: 30_000, days }), {
      from: '2026-09-01',
      to: '2026-09-30',
    })
    const { buckets } = dayBuckets(month, { booksStartDate: '2026-01-01' })
    expect(buckets).toHaveLength(30)
    const labeled = buckets.filter((b) => b.shortLabel !== '')
    // En el celular treinta números se pisan: quedan pocos, con aire entre ellos.
    expect(labeled.length).toBeGreaterThanOrEqual(5)
    expect(labeled.length).toBeLessThanOrEqual(8)
    expect(buckets.at(-1)?.shortLabel).toBe('30')
    // El día sigue estando para quien toca la columna.
    expect(buckets.every((b) => b.label !== '')).toBe(true)
  })

  it('con libros de antes, un tramo por cada día del período y sin nota', () => {
    const { buckets, note } = dayBuckets(series, { booksStartDate: '2026-09-01' })
    expect(buckets).toHaveLength(4)
    expect(buckets[2]).toMatchObject({ inCents: 50_000_000, label: 'Lun 12/10' })
    expect(note).toBeNull()
    expect(dayBuckets(series).buckets).toHaveLength(4)
  })

  it('en la tarjeta, «entró» son los pagos y «salió» los consumos', () => {
    const card = buildCashDailySeries(
      account({
        kind: 'credit_card',
        openingCents: -100,
        days: [{ day: '2026-10-12', inCents: 40, outCents: 300, balanceCents: -360 }],
      }),
      range,
    )
    expect(dayBuckets(card).buckets[2]).toMatchObject({ inCents: 40, outCents: 300 })
  })

  it('un período sin días no explota', () => {
    expect(dayBuckets({ mode: 'money', points: [] })).toEqual({ buckets: [], note: null })
  })
})

function flow(month: string, category: string, inflow: number, outflow: number): CashFlowRow {
  return {
    month,
    category,
    categoryLabel: category,
    inflowCents: inflow,
    outflowCents: outflow,
    netCents: inflow - outflow,
  }
}

describe('flowView: entró y salió', () => {
  it('sin nada, el vacío que enseña (sin ningún cero dibujado)', () => {
    expect(flowView([])).toMatchObject({
      isEmpty: true,
      months: [],
      title: 'Todavía no entró ni salió plata de las cajas',
    })
    // Filas en cero no cuentan como movimiento.
    expect(flowView([flow('2026-10-01', 'sales', 0, 0)]).isEmpty).toBe(true)
  })

  it('con una sola categoría de entrada (lo normal en un bar)', () => {
    const view = flowView([
      flow('2026-08-01', 'sales', 1_000_000_000, 0),
      flow('2026-09-01', 'sales', 2_000_000_000, 0),
      flow('2026-09-01', 'suppliers', 0, 79_000_000),
      flow('2026-10-01', 'sales', 994_680_000, 0),
      flow('2026-10-01', 'bank', 0, 12_531_600),
      flow('2026-10-01', 'partners', 0, 8_468_400),
    ])
    expect(view.title).toBe('Entró más plata de la que salió')
    expect(view.sentence).toBe(
      `De agosto a octubre entró ${money('$ 39.946.800')} y salió ${money('$ 1.000.000')}: hay ${money('$ 38.946.800')} más en las cajas.`,
    )
    expect(view.months.map((m) => [m.label, m.shortLabel])).toEqual([
      ['Agosto', 'Ago'],
      ['Septiembre', 'Sep'],
      ['Octubre', 'Oct'],
    ])
    expect(view.out.title).toBe('De cada $ 100 que salieron, $ 79 fueron a proveedores')
    expect(view.out.rows.map((r) => r.label)).toEqual([
      'Proveedores',
      'Banco y comisiones',
      'Socios',
    ])
    expect(view.out.totalCents).toBe(100_000_000)
    // Una sola fuente: se dice en una oración, sin segundo dibujo.
    expect(view.in.rows).toHaveLength(1)
    expect(view.in.title).toBe('Todo lo que entró fue por ventas cobradas')
  })

  it('con varias categorías de entrada, también reparte de dónde vino', () => {
    const view = flowView([
      flow('2026-10-01', 'sales', 96_000_000, 0),
      flow('2026-10-01', 'partners', 4_000_000, 0),
      flow('2026-10-01', 'suppliers', 0, 150_000_000),
    ])
    expect(view.in.title).toBe('De cada $ 100 que entraron, $ 96 fueron ventas cobradas')
    expect(view.in.rows.map((r) => r.label)).toEqual(['Ventas cobradas', 'Socios'])
    expect(view.out.title).toBe('Todo lo que salió fue a proveedores')
    expect(view.title).toBe('Salió más plata de la que entró')
    expect(view.sentence).toBe(
      `En octubre entró ${money('$ 1.000.000')} y salió ${money('$ 1.500.000')}: hay ${money('$ 500.000')} menos.`,
    )
  })

  it('casi todo en una categoría no se redondea a «100 de cada 100»: se dice «casi todo»', () => {
    const view = flowView([
      flow('2026-10-01', 'suppliers', 0, 99_900),
      flow('2026-10-01', 'bank', 0, 100),
      flow('2026-10-01', 'sales', 99_900, 0),
      flow('2026-10-01', 'bank', 100, 0),
    ])
    // $ 99 de cada $ 100 al lado de una barra que dice 100 % sería una contradicción.
    expect(view.out.title).toBe('Casi todo lo que salió fue a proveedores')
    expect(view.in.title).toBe('Casi todo lo que entró fue por ventas cobradas')
  })

  it('el número del título es el mismo que el de la barra (enteros que suman 100)', () => {
    // 79,37 % + 12,37 % + 8,26 %: las barras dicen 80 · 12 · 8, y el título también.
    const view = flowView([
      flow('2026-10-01', 'suppliers', 0, 120_425_000),
      flow('2026-10-01', 'other', 0, 18_764_000),
      flow('2026-10-01', 'bank', 0, 12_531_600),
    ])
    expect(view.out.title).toBe('De cada $ 100 que salieron, $ 80 fueron a proveedores')
  })

  it('con 99 de cada 100 de verdad, lo dice con el número', () => {
    const view = flowView([
      flow('2026-10-01', 'suppliers', 0, 99_000),
      flow('2026-10-01', 'bank', 0, 1_000),
    ])
    expect(view.out.title).toBe('De cada $ 100 que salieron, $ 99 fueron a proveedores')
  })

  it('una categoría que no conoce se muestra con su nombre', () => {
    const view = flowView([{ ...flow('2026-10-01', 'rara', 0, 500), categoryLabel: 'Cosa rara' }])
    expect(view.out.rows[0]?.label).toBe('Cosa rara')
    expect(view.title).toBe('Salió más plata de la que entró')
  })

  it('un período que cruza el año dice el año', () => {
    const view = flowView([
      flow('2025-12-01', 'sales', 100, 0),
      flow('2026-01-01', 'sales', 100, 100),
    ])
    expect(view.sentence.startsWith('De diciembre de 2025 a enero de 2026')).toBe(true)
    expect(view.months.map((m) => m.shortLabel)).toEqual(['Dic 25', 'Ene 26'])
  })
})

function week(
  weekStart: string,
  inCents: number,
  outCents: number,
  balance: number,
): CashProjectionRow {
  return { weekStart, inCents, outCents, projectedBalanceCents: balance }
}

describe('projectionView: las próximas 4 semanas', () => {
  const zeros = [
    week('2026-10-13', 0, 0, 100),
    week('2026-10-19', 0, 0, 100),
    week('2026-10-26', 0, 0, 100),
    week('2026-11-02', 0, 0, 100),
  ]

  it('todo en cero: no hay nada que venza, sin dibujo', () => {
    expect(projectionView(zeros, 100, { today: TODAY, known: true })).toEqual({
      kind: 'nothing',
      title: 'No hay nada que venza en las próximas 4 semanas.',
    })
    expect(projectionView([], 100, { today: TODAY, known: true }).kind).toBe('nothing')
  })

  it('sin saber cuánta plata hay, no estima nada', () => {
    expect(
      projectionView([week('2026-10-13', 0, 500, -500)], 0, { today: TODAY, known: false }),
    ).toEqual({
      kind: 'unknown',
      title: 'Para estimar si te alcanza, primero decime cuánta plata hay.',
    })
  })

  it('con una semana en negativo: lo dice sin contar lo que se va a vender, y en qué semana', () => {
    const view = projectionView(
      [
        week('2026-10-13', 20_000_000, 10_000_000, 60_000_000),
        week('2026-10-19', 0, 91_000_000, -31_000_000),
        week('2026-10-26', 0, 5_000_000, -36_000_000),
        week('2026-11-02', 0, 0, -36_000_000),
      ],
      50_000_000,
      { today: TODAY, known: true },
    )
    if (view.kind !== 'weeks') throw new Error('estado')
    expect(view.title).toBe(
      `Sin contar lo que vendas, la semana del 19/10 faltarían ${money('$ 310.000')}`,
    )
    expect(view.sentence).toBe(PROJECTION_SENTENCE)
    expect(view.short).toBe(true)
    expect(view.weeks.map((w) => w.label)).toEqual([
      'Esta semana (hasta el dom 18/10)',
      'Semana del 19/10',
      'Semana del 26/10',
      'Semana del 02/11',
    ])
    expect(view.weeks.map((w) => w.short)).toEqual([false, true, true, true])
    // Hoy + el último día de cada semana.
    expect(view.points).toEqual([
      { date: '2026-10-13', cents: 50_000_000 },
      { date: '2026-10-18', cents: 60_000_000 },
      { date: '2026-10-25', cents: -31_000_000 },
      { date: '2026-11-01', cents: -36_000_000 },
      { date: '2026-11-08', cents: -36_000_000 },
    ])
  })

  it('si la que queda corta es la primera, dice «esta semana»', () => {
    const view = projectionView([week('2026-10-13', 0, 600, -100)], 500, {
      today: TODAY,
      known: true,
    })
    expect(view.kind === 'weeks' && view.title).toBe(
      `Sin contar lo que vendas, esta semana faltarían ${money('$ 1')}`,
    )
  })

  it('si alcanza, lo afirma', () => {
    const view = projectionView(
      zeros.map((w, i) => (i === 1 ? { ...w, outCents: 50 } : w)),
      100,
      { today: TODAY, known: true },
    )
    expect(view.kind === 'weeks' && view.title).toBe(
      'Con lo que hay hoy alcanza para lo que vence en las próximas 4 semanas',
    )
    expect(view.kind === 'weeks' && view.short).toBe(false)
  })

  it('un domingo la primera semana termina hoy: no se repite el punto de hoy', () => {
    const sunday = '2026-10-18'
    const view = projectionView([week(sunday, 0, 10, 90), week('2026-10-19', 0, 10, 80)], 100, {
      today: sunday,
      known: true,
    })
    expect(view.kind === 'weeks' && view.points.map((p) => p.date)).toEqual([
      '2026-10-18',
      '2026-10-25',
    ])
  })
})
