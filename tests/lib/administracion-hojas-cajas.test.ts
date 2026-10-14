import { describe, expect, it } from 'vitest'
import {
  BANK_AMOUNT_FIELDS,
  BANK_KNOWN_FIELDS,
  BANK_ROWS,
  bankProgress,
  bankStatementNote,
  bookBlock,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/gasto-bancario/_lib/bank-rows'
import {
  BILL_VALUES,
  billsTotalCents,
  COUNT_PICK_LABEL,
  countModeOf,
  countQuestion,
  countSavedNote,
  countSubmitLabel,
  countVerdict,
  exactMoney,
  idleVerdict,
  leftToCount,
  reasonOptions,
  VERDICT_IDLE,
  VERDICT_PICK,
  walletToExplain,
  walletUndetailedNote,
} from '@/components/administracion/acciones/ajustar-vista'
import {
  cardDebtOf,
  moveAfter,
  moveInitial,
  movePair,
  moveShortcuts,
} from '@/components/administracion/acciones/mover-vista'
import {
  accountPlaceholder,
  accountQuestion,
  applySituation,
  booksEmptyText,
  MOTIVE_ACCOUNT,
  motiveStillValid,
  movementSubmitLabel,
  otherWarning,
  situationGroups,
  situations,
  treasuryForSituation,
  treasuryQuestion,
  voucherNote,
  voucherTotalLabel,
} from '@/components/administracion/acciones/movimiento-vista'
import { ACTION_TITLES } from '@/components/administracion/acciones/types'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import type { SheetTreasury } from '@/components/administracion/cajas-ventas/types'
import { bankExpenseSchema, CASH_MOVEMENT_SHORTCUTS } from '@/lib/accounting/schemas'
import { formatCents } from '@/lib/money'

/**
 * Las hojas de Cajas («Mover plata», «¿Coincide la caja?», «Otra entrada o
 * salida») y «Gastos del banco»: lo que dicen y lo que NO puede cambiar. Estas
 * pantallas se rediseñaron sin tocar lo que guardan: acá se fija que las
 * situaciones del vale escriben exactamente los pares de siempre y que los
 * renglones del banco cubren los mismos campos.
 */

/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
const money = (text: string) => text.replaceAll(' ', NB)

function treasury(over: Partial<SheetTreasury>): SheetTreasury {
  return {
    id: 'caja',
    accountId: 'acc',
    name: 'Caja',
    kind: 'cash',
    balanceCents: 39_475_700,
    bankPartyId: null,
    allowNegative: false,
    alias: null,
    bankName: null,
    lastCheckedOn: null,
    active: true,
    ...over,
  }
}

const CASH = treasury({})
const WALLET = treasury({ id: 'mp', name: 'Mercado Pago', kind: 'wallet', bankPartyId: 'mp-party' })
const BANK = treasury({
  id: 'banco',
  name: 'Banco Nación',
  kind: 'bank',
  balanceCents: 4_186_342_800,
})
const CARD = treasury({ id: 'visa', name: 'Visa', kind: 'credit_card', balanceCents: 8_000_000 })

describe('los nombres de las hojas', () => {
  it('son LOS nombres: las demás áreas los citan así', () => {
    expect(ACTION_TITLES.ajustar).toBe('Contar la caja')
    expect(ACTION_TITLES.movimiento).toBe('Otra entrada o salida')
    expect(ACTION_TITLES.mover).toBe('Mover plata')
  })
})

describe('Mover plata', () => {
  it('con banco, los atajos de siempre y uno más (sacar efectivo)', () => {
    const shortcuts = moveShortcuts([CASH, WALLET, BANK, CARD])
    expect(shortcuts.map((s) => s.label)).toEqual([
      'Depositar el efectivo',
      'Pasar de Mercado Pago al banco',
      'Pagar el resumen de la tarjeta',
      'Sacar efectivo del banco',
    ])
    expect(shortcuts.map((s) => [s.from, s.to])).toEqual([
      ['caja', 'banco'],
      ['mp', 'banco'],
      ['banco', 'visa'],
      ['banco', 'caja'],
    ])
  })

  it('sin banco (un bar con caja y Mercado Pago), los de efectivo y billetera', () => {
    expect(moveShortcuts([CASH, WALLET]).map((s) => [s.label, s.from, s.to])).toEqual([
      ['De Caja a Mercado Pago', 'caja', 'mp'],
      ['De Mercado Pago a Caja', 'mp', 'caja'],
    ])
    expect(moveShortcuts([CASH, WALLET, CARD]).map((s) => s.label)).toEqual([
      'De Caja a Mercado Pago',
      'De Mercado Pago a Caja',
      'Pagar la tarjeta con Mercado Pago',
    ])
  })

  it('con una sola caja, o ninguna, no hay atajos', () => {
    expect(moveShortcuts([CASH])).toEqual([])
    expect(moveShortcuts([])).toEqual([])
    expect(moveShortcuts([BANK])).toEqual([])
  })

  it('con dos cajas, las dos direcciones posibles y nada más', () => {
    expect(movePair([CASH, WALLET]).map((p) => p.label)).toEqual([
      'De Caja a Mercado Pago',
      'De Mercado Pago a Caja',
    ])
    expect(movePair([CASH, WALLET, BANK])).toEqual([])
    expect(movePair([CASH])).toEqual([])
  })

  it('la caja de la URL va como origen; una tarjeta de la empresa, como destino', () => {
    const all = [CASH, WALLET, BANK, CARD]
    expect(moveInitial(all, 'caja')).toEqual({ fromId: 'caja', toId: null })
    expect(moveInitial(all, 'visa')).toEqual({ fromId: null, toId: 'visa' })
    // Sin caja, o con una que no es del bar, nada precargado.
    expect(moveInitial(all, null)).toEqual({ fromId: null, toId: null })
    expect(moveInitial(all, 'otra')).toEqual({ fromId: null, toId: null })
    // Con dos cajas, la otra queda puesta del lado que falta.
    expect(moveInitial([CASH, WALLET], 'mp')).toEqual({ fromId: 'mp', toId: 'caja' })
    expect(moveInitial([CASH, CARD], 'visa')).toEqual({ fromId: 'caja', toId: 'visa' })
  })

  it('el pase: de una sale y a la otra le entra, cada número con su rótulo', () => {
    const after = moveAfter(CASH, BANK, 20_000_000)
    expect(after.from?.words).toEqual({
      before: { label: 'hoy', amount: money('$ 394.757') },
      after: { label: 'queda', amount: money('$ 194.757') },
    })
    expect(after.to?.words).toEqual({
      before: { label: 'hoy', amount: money('$ 41.863.428') },
      after: { label: 'queda', amount: money('$ 42.063.428') },
    })
    expect(after.short).toBe(false)
  })

  it('si el origen no alcanza, «faltan»; sin importe, nada', () => {
    const short = moveAfter(CASH, BANK, 40_000_000)
    expect(short.short).toBe(true)
    expect(short.from?.words?.after).toEqual({ label: 'faltan', amount: money('$ 5.243') })
    const idle = moveAfter(CASH, BANK, null)
    expect(idle.from?.words).toBeNull()
    expect(idle.to?.words).toBeNull()
    expect(moveAfter(null, undefined, 100)).toEqual({ from: null, to: null, short: false })
  })

  it('pagar el resumen: la deuda de la tarjeta baja', () => {
    const after = moveAfter(BANK, CARD, 8_000_000)
    expect(after.to?.words).toEqual({
      before: { label: 'hoy debés', amount: money('$ 80.000') },
      after: { label: 'vas a deber', amount: money('$ 0') },
    })
    expect(cardDebtOf(CARD)).toBe(8_000_000)
    expect(cardDebtOf({ ...CARD, balanceCents: 0 })).toBeNull()
    expect(cardDebtOf(BANK)).toBeNull()
    expect(cardDebtOf(null)).toBeNull()
  })

  it('importes de nueve cifras', () => {
    const big = moveAfter({ ...BANK, balanceCents: 99_999_999_900 }, CASH, 12_345_678_900)
    expect(big.from?.words?.after.amount).toBe(money('$ 876.543.210'))
  })
})

describe('¿Coincide la caja?: qué se pregunta', () => {
  it('cada tipo de caja con su modo', () => {
    expect(countModeOf(CASH)).toBe('cash')
    expect(countModeOf(BANK)).toBe('bank')
    expect(countModeOf(WALLET)).toBe('wallet')
    // Una billetera sin partícipe se cuenta como una cuenta cualquiera.
    expect(countModeOf({ kind: 'wallet', bankPartyId: null })).toBe('plain')
    expect(countModeOf(CARD)).toBe('card')
    expect(countModeOf({ kind: 'other', bankPartyId: null })).toBe('plain')
  })

  it('la pregunta cambia con la caja', () => {
    expect(countQuestion('cash', 'Caja').label).toBe('¿Cuánto hay de verdad?')
    expect(countQuestion('wallet', 'Mercado Pago').label).toBe(
      '¿Cuánto dice la app de Mercado Pago?',
    )
    expect(countQuestion('bank', 'Banco Nación').label).toBe('¿Cuánto dice el banco?')
    expect(countQuestion('card', 'Visa').label).toBe('¿Cuánto debés en Visa?')
    expect(countQuestion('plain', 'Otra').hint).toBe('El saldo real de la cuenta.')
    expect(countQuestion(null, 'la caja').label).toBe('¿Cuánto hay de verdad?')
  })
})

describe('¿Coincide la caja?: el resultado', () => {
  const base = { name: 'Caja', countedCents: 39_350_000, ticked: 0, pendingTicked: 0 }
  const verdict = (over: Partial<Parameters<typeof countVerdict>[0]>) =>
    countVerdict({ mode: 'cash', diff: null, ...base, ...over })
  const brief = (over: Partial<Parameters<typeof countVerdict>[0]>) => {
    const v = verdict(over)
    return [v.tone, v.label, v.amountCents]
  }

  it('sin escribir todavía', () => {
    expect(verdict({})).toMatchObject({ tone: 'idle', label: null, sentence: VERDICT_IDLE })
  })

  it('coincide: no se guarda ningún movimiento', () => {
    for (const mode of ['cash', 'bank', 'card', 'plain', 'wallet'] as const) {
      expect(verdict({ mode, diff: 0 })).toMatchObject({
        tone: 'ok',
        label: 'Coincide',
        amountCents: null,
        sentence: 'No se guarda ningún movimiento: Caja queda como contada hoy.',
      })
    }
    expect(verdict({ diff: 0, countedOn: '2026-10-10' }).sentence).toBe(
      'No se guarda ningún movimiento: Caja queda como contada el 10/10.',
    )
  })

  it('efectivo: faltan en ámbar, sobran en azul, y dice cómo queda', () => {
    const short = verdict({ diff: -125_700 })
    expect(short).toMatchObject({
      tone: 'warn',
      label: 'Faltan',
      amountCents: 125_700,
      sentence: `Queda anotado como faltante de caja y el sistema pasa a decir ${money('$ 393.500')}.`,
    })
    expect(short.note).toContain('cargalo primero como gasto pagado con Caja')
    const over = verdict({ diff: 50_000, countedCents: 39_525_700 })
    expect(over).toMatchObject({
      tone: 'info',
      label: 'Sobran',
      amountCents: 50_000,
      sentence: `Queda anotado como sobrante de caja y el sistema pasa a decir ${money('$ 395.257')}.`,
      note: null,
    })
  })

  it('banco: con diferencia, pregunta por qué', () => {
    expect(brief({ mode: 'bank', diff: -867_600 })).toEqual([
      'warn',
      'Hay menos que en el sistema',
      867_600,
    ])
    expect(verdict({ mode: 'bank', diff: -867_600 }).sentence).toBe('Decinos abajo por qué.')
    expect(brief({ mode: 'bank', diff: 100 })).toEqual(['info', 'Hay más que en el sistema', 100])
    expect(verdict({ mode: 'bank', diff: 100 }).sentence).toBe('Decinos abajo por qué.')
  })

  it('otra cuenta: con plata de más pregunta; con menos, queda para la contadora', () => {
    expect(verdict({ mode: 'plain', diff: 100 }).sentence).toBe('Decinos abajo por qué.')
    expect(verdict({ mode: 'plain', diff: -100 })).toMatchObject({
      tone: 'warn',
      label: 'Hay menos que en el sistema',
      sentence: 'Queda aparte para que lo revise la contadora.',
    })
  })

  it('tarjeta de la empresa: debés más o debés menos', () => {
    expect(verdict({ mode: 'card', diff: -500 })).toMatchObject({
      tone: 'warn',
      label: 'Debés más de lo que dice el sistema',
      amountCents: 500,
    })
    expect(verdict({ mode: 'card', diff: -500 }).sentence).toContain(
      'Puede faltar cargar una compra hecha con la tarjeta.',
    )
    expect(verdict({ mode: 'card', diff: 500 })).toMatchObject({
      tone: 'info',
      label: 'Debés menos de lo que dice el sistema',
    })
    expect(verdict({ mode: 'card', diff: 500 }).sentence).toContain(
      'Puede faltar cargar un pago del resumen.',
    )
  })

  it('billetera sin ventas tildadas', () => {
    expect(verdict({ mode: 'wallet', name: 'Mercado Pago', diff: 200_000 })).toMatchObject({
      tone: 'info',
      label: 'Hay más que en el sistema',
      sentence: 'Queda como plata que te rindió Mercado Pago.',
    })
    expect(verdict({ mode: 'wallet', diff: -200_000 })).toMatchObject({
      tone: 'warn',
      label: 'Hay menos que en el sistema',
    })
    expect(verdict({ mode: 'wallet', diff: -200_000 }).sentence).toContain(
      'Decí abajo qué te descontaron.',
    )
  })

  it('billetera con ventas tildadas: entró, y cuánto se quedó', () => {
    const wallet = {
      mode: 'wallet',
      name: 'Mercado Pago',
      ticked: 3,
      pendingTicked: 140_000_000,
    } as const
    expect(verdict({ ...wallet, diff: 135_700_000 })).toMatchObject({
      tone: 'ok',
      label: 'Entraron',
      amountCents: 135_700_000,
      sentence: `De ${money('$ 1.400.000')} que estaban en camino, Mercado Pago se quedó con ${money('$ 43.000')}.`,
    })
    expect(verdict({ ...wallet, diff: 140_000_000 }).sentence).toBe(
      'Entró todo lo que estaba en camino.',
    )
    expect(verdict({ ...wallet, diff: 140_200_000 }).sentence).toBe(
      `Entró todo lo que estaba en camino y ${money('$ 2.000')} más: quedan como plata que te rindió Mercado Pago.`,
    )
  })

  it('billetera con ventas tildadas y el mismo saldo: avisa y ofrece destildar (no bloquea)', () => {
    expect(verdict({ mode: 'wallet', diff: 0, ticked: 2, pendingTicked: 500 })).toMatchObject({
      tone: 'warn',
      label: 'Todavía no entró nada',
      amountCents: null,
      offerUntick: true,
    })
  })

  it('billetera con ventas tildadas y menos plata que antes', () => {
    const v = verdict({
      mode: 'wallet',
      name: 'Mercado Pago',
      diff: -300,
      ticked: 1,
      pendingTicked: 500,
    })
    expect(v).toMatchObject({ tone: 'warn', label: 'Hay menos plata que antes', amountCents: 300 })
    expect(v.sentence).toContain('Si pagaste algo desde Mercado Pago')
    expect(v.offerUntick).toBe(false)
  })

  it('con centavos, el número no se redondea', () => {
    expect(exactMoney(39_350_050)).toBe(money('$ 393.500,50'))
    expect(exactMoney(-125_700)).toBe(money('$ 1.257'))
    expect(verdict({ diff: -50, countedCents: 39_475_650 }).sentence).toContain(
      money('$ 394.756,50'),
    )
  })
})

describe('¿Coincide la caja?: por qué hay diferencia, el botón y lo que falta', () => {
  it('las opciones son las de siempre: banco con diferencia, y otra cuenta con plata de más', () => {
    expect(reasonOptions('bank', -867_600).map((o) => o.value)).toEqual(['bank_fees', 'other'])
    expect(reasonOptions('bank', 500).map((o) => o.value)).toEqual(['interest', 'other'])
    expect(reasonOptions('plain', 500).map((o) => o.value)).toEqual(['interest', 'other'])
    expect(reasonOptions('plain', -500)).toEqual([])
    for (const mode of ['cash', 'wallet', 'card'] as const) {
      expect(reasonOptions(mode, -500)).toEqual([])
      expect(reasonOptions(mode, 500)).toEqual([])
    }
    expect(reasonOptions('bank', 0)).toEqual([])
    expect(reasonOptions('bank', null)).toEqual([])
    expect(reasonOptions(null, -5)).toEqual([])
  })

  it('«Son gastos del banco» dice con cuánto te lleva', () => {
    const [fees] = reasonOptions('bank', -867_600)
    expect(fees?.title).toBe('Son gastos del banco')
    expect(fees?.consequence).toContain(`con ${money('$ 8.676')} ya puesto como total`)
  })

  it('sin caja elegida, el recuadro del resultado enseña el primer paso y el botón lo pide', () => {
    expect(idleVerdict(VERDICT_PICK)).toEqual({
      tone: 'idle',
      label: null,
      amountCents: null,
      sentence: 'Elegí la caja y te decimos cuánto dice el sistema.',
      offerUntick: false,
      note: null,
    })
    // Con caja y sin número, el reposo de siempre.
    expect(idleVerdict().sentence).toBe(VERDICT_IDLE)
    expect(COUNT_PICK_LABEL).toBe('Elegí una caja')
  })

  it('billetera: cuánto falta explicar y qué pasa si no se detalla', () => {
    // Sin ventas tildadas y con plata de menos: lo que falta es toda la diferencia.
    expect(walletToExplain({ diff: -1_140_962, ticked: 0, pendingTicked: 0 })).toBe(1_140_962)
    // Con ventas tildadas: lo que estaba en camino y no entró.
    expect(walletToExplain({ diff: 900_000, ticked: 2, pendingTicked: 1_000_000 })).toBe(100_000)
    // Entró todo, entró de más, hay de más o todavía no hay número: nada que explicar.
    expect(walletToExplain({ diff: 1_000_000, ticked: 2, pendingTicked: 1_000_000 })).toBe(0)
    expect(walletToExplain({ diff: 1_200_000, ticked: 2, pendingTicked: 1_000_000 })).toBeNull()
    expect(walletToExplain({ diff: 500, ticked: 0, pendingTicked: 0 })).toBeNull()
    expect(walletToExplain({ diff: null, ticked: 0, pendingTicked: 0 })).toBeNull()
    expect(walletUndetailedNote(1_140_962)).toBe(
      `Si no lo detallás, los ${money('$ 11.409,62')} quedan aparte para que los revise la contadora.`,
    )
  })

  it('el botón dice lo que va a pasar', () => {
    expect(countSubmitLabel(null, 0)).toBe('Guardar')
    expect(countSubmitLabel('check', 0)).toBe('Sí, coincide')
    expect(countSubmitLabel('bank_fees', 0)).toBe('Cargar los gastos del banco')
    expect(countSubmitLabel('adjust', 0)).toBe('Guardar la diferencia')
    expect(countSubmitLabel('wallet', 0)).toBe('Guardar la diferencia')
    expect(countSubmitLabel('wallet', 2)).toBe('Anotar lo que entró')
  })

  it('«Contar otra después»: quedan las que no se contaron hoy ni en esta pasada', () => {
    const today = '2026-10-13'
    const list = [CASH, { ...WALLET, lastCheckedOn: today }, BANK]
    expect(leftToCount(list, today, new Set()).map((t) => t.id)).toEqual(['caja', 'banco'])
    expect(leftToCount(list, today, new Set(['caja'])).map((t) => t.id)).toEqual(['banco'])
    expect(leftToCount(list, today, new Set(['caja', 'banco']))).toEqual([])
    expect(leftToCount([], today, new Set())).toEqual([])
  })

  it('lo que queda dicho arriba después de contar una', () => {
    expect(countSavedNote({ name: 'Caja', outcome: 'matched', cents: null, left: [] })).toBe(
      'Caja coincide.',
    )
    expect(
      countSavedNote({
        name: 'Caja',
        outcome: 'adjusted',
        cents: 39_350_000,
        left: ['Mercado Pago', 'Banco Nación'],
      }),
    ).toBe(`Caja quedó en ${money('$ 393.500')}. Te falta contar Mercado Pago y Banco Nación.`)
    expect(
      countSavedNote({
        name: 'Mercado Pago',
        outcome: 'arrived',
        cents: 135_700_000,
        left: ['Caja'],
      }),
    ).toBe(`En Mercado Pago entraron ${money('$ 1.357.000')}. Te falta contar Caja.`)
    expect(
      countSavedNote({ name: 'Caja', outcome: 'matched', cents: null, left: ['A', 'B', 'C'] }),
    ).toBe('Caja coincide. Te falta contar A, B y C.')
  })

  it('el contador de billetes solo suma', () => {
    expect(BILL_VALUES).toEqual([20_000, 10_000, 2_000, 1_000, 500, 200, 100])
    expect(billsTotalCents({}, null)).toBe(0)
    expect(billsTotalCents({ 20000: 3, 1000: 5, 100: 2 }, 35_000)).toBe(
      (60_000 + 5_000 + 200) * 100 + 35_000,
    )
    // Lo que no es una cantidad entera positiva no cuenta.
    expect(billsTotalCents({ 20000: -1, 10000: 1.5, 500: null, 200: 0 }, null)).toBe(0)
    expect(billsTotalCents({ 20000: 1 }, -500)).toBe(2_000_000)
  })
})

describe('Otra entrada o salida: las situaciones del vale', () => {
  const all = situations({ treasuries: [CASH, WALLET, BANK], hasDeposits: true })

  it('las siete situaciones escriben EXACTAMENTE los pares de hoy', () => {
    expect(all.map((s) => [s.label, s.direction, s.motive])).toEqual([
      ['Un socio sacó plata', 'out', 'partner_withdrawal'],
      ['Otra salida', 'out', 'other'],
      ['Un socio puso plata', 'in', 'partner_contribution'],
      ['Un cliente dejó una seña', 'in', 'deposit_received'],
      ['Rindió Mercado Pago', 'in', 'mp_yield'],
      ['Entró un préstamo', 'in', 'loan_received'],
      ['Otra entrada', 'in', 'other'],
    ])
    // Ningún motivo fuera de los que acepta el esquema, y cada uno en un solo sentido
    // (salvo «otra», que existe en los dos, como siempre).
    const allowed = new Set<string>(CASH_MOVEMENT_SHORTCUTS)
    for (const s of all) expect(allowed.has(s.motive)).toBe(true)
    expect(new Set(all.map((s) => s.key)).size).toBe(all.length)
    expect(all.filter((s) => s.direction === 'out').map((s) => s.motive)).toEqual([
      'partner_withdrawal',
      'other',
    ])
  })

  it('dos grupos: lo que salió y lo que entró', () => {
    const groups = situationGroups({ treasuries: [CASH], hasDeposits: false })
    expect(groups.map((g) => [g.direction, g.label])).toEqual([
      ['out', 'Salió plata'],
      ['in', 'Entró plata'],
    ])
  })

  it('«Rindió…» solo existe con una billetera; la seña, solo con su partícipe', () => {
    const none = situations({ treasuries: [CASH, BANK], hasDeposits: false })
    expect(none.some((s) => s.motive === 'mp_yield')).toBe(false)
    expect(none.some((s) => s.motive === 'deposit_received')).toBe(false)
    const two = situations({
      treasuries: [WALLET, { ...WALLET, name: 'Ualá' }],
      hasDeposits: false,
    })
    expect(two.find((s) => s.motive === 'mp_yield')?.label).toBe('Rindió una billetera')
  })

  it('al elegir «Rindió…», la caja pasa a ser la billetera', () => {
    const yields = all.find((s) => s.motive === 'mp_yield')
    const withdraw = all.find((s) => s.motive === 'partner_withdrawal')
    if (!yields || !withdraw) throw new Error('faltan situaciones')
    const three = [CASH, WALLET, BANK]
    expect(treasuryForSituation(yields, CASH, three)).toBe('mp')
    expect(treasuryForSituation(yields, null, three)).toBe('mp')
    expect(treasuryForSituation(yields, WALLET, three)).toBe('mp')
    // Con varias billeteras no se elige ninguna: se elige entre ellas.
    const ualá = { ...WALLET, id: 'uala' }
    expect(treasuryForSituation(yields, CASH, [CASH, WALLET, ualá])).toBeNull()
    expect(treasuryForSituation(yields, ualá, [CASH, WALLET, ualá])).toBe('uala')
    // Las demás situaciones no tocan la caja.
    expect(treasuryForSituation(withdraw, CASH, three)).toBe('caja')
    expect(treasuryForSituation(withdraw, null, three)).toBeNull()
  })

  it('«Rindió…» deja de valer si la caja no es una billetera', () => {
    expect(motiveStillValid('in', 'mp_yield', 'wallet', all)).toBe(true)
    expect(motiveStillValid('in', 'mp_yield', null, all)).toBe(true)
    expect(motiveStillValid('in', 'mp_yield', 'cash', all)).toBe(false)
    expect(motiveStillValid('out', 'partner_withdrawal', 'cash', all)).toBe(true)
    // Una combinación que no existe (un retiro que «entra») no vale nunca.
    expect(motiveStillValid('in', 'partner_withdrawal', 'cash', all)).toBe(false)
    expect(motiveStillValid(null, null, 'cash', all)).toBe(true)
  })

  it('cada motivo conocido trae su cuenta; «otra» la elige la persona', () => {
    expect(MOTIVE_ACCOUNT).toEqual({
      partner_withdrawal: 'partners_current',
      partner_contribution: 'partners_current',
      mp_yield: 'interest_income',
      loan_received: 'bank_loans',
      deposit_received: 'customer_deposits',
    })
    expect(MOTIVE_ACCOUNT.other).toBeUndefined()
  })
})

describe('Otra entrada o salida: lo que queda elegido al tocar una situación', () => {
  const all = situations({ treasuries: [CASH, WALLET], hasDeposits: true })
  const find = (motive: string, direction: string) => {
    const found = all.find((s) => s.motive === motive && s.direction === direction)
    if (!found) throw new Error(`falta ${direction}:${motive}`)
    return found
  }
  const empty = { direction: null, motive: null, accountId: null, partyId: null }
  const ctx = { suggestedAccountId: 'socios', depositsPartyId: 'senas', partyIsPartner: false }

  it('desde cero: el sentido, el motivo y la cuenta que le corresponde', () => {
    expect(applySituation(empty, find('partner_withdrawal', 'out'), ctx)).toEqual({
      direction: 'out',
      motive: 'partner_withdrawal',
      accountId: 'socios',
      partyId: null,
    })
  })

  it('una seña va siempre al partícipe de señas', () => {
    expect(
      applySituation(empty, find('deposit_received', 'in'), {
        ...ctx,
        suggestedAccountId: 'senas-cta',
      }),
    ).toMatchObject({ accountId: 'senas-cta', partyId: 'senas' })
  })

  it('«otra» no trae cuenta, y olvida la que había', () => {
    const before = {
      direction: 'out',
      motive: 'partner_withdrawal',
      accountId: 'socios',
      partyId: 'juan',
    } as const
    expect(
      applySituation(before, find('other', 'out'), { ...ctx, suggestedAccountId: null }),
    ).toEqual({ direction: 'out', motive: 'other', accountId: null, partyId: null })
  })

  it('de retiro a aporte conserva al socio elegido; si no era un socio, lo olvida', () => {
    const before = {
      direction: 'in',
      motive: 'partner_contribution',
      accountId: 'socios',
      partyId: 'juan',
    } as const
    // Cambia el sentido y el motivo no existe del otro lado: se olvida todo y se vuelve a poner.
    expect(
      applySituation(before, find('partner_withdrawal', 'out'), { ...ctx, partyIsPartner: true }),
    ).toEqual({
      direction: 'out',
      motive: 'partner_withdrawal',
      accountId: 'socios',
      partyId: null,
    })
    // Mismo sentido (de préstamo a aporte), con un socio ya elegido: se conserva.
    const loan = {
      direction: 'in',
      motive: 'loan_received',
      accountId: 'prestamos',
      partyId: 'juan',
    } as const
    expect(
      applySituation(loan, find('partner_contribution', 'in'), { ...ctx, partyIsPartner: true })
        .partyId,
    ).toBe('juan')
    expect(
      applySituation(loan, find('partner_contribution', 'in'), { ...ctx, partyIsPartner: false })
        .partyId,
    ).toBeNull()
  })

  it('si el motivo no encuentra su cuenta, queda la que había (y se pregunta)', () => {
    const before = {
      direction: 'in',
      motive: 'other',
      accountId: 'elegida',
      partyId: null,
    } as const
    expect(
      applySituation(before, find('loan_received', 'in'), { ...ctx, suggestedAccountId: null })
        .accountId,
    ).toBe('elegida')
    expect(
      applySituation(empty, find('loan_received', 'in'), { ...ctx, suggestedAccountId: null })
        .accountId,
    ).toBeNull()
  })

  it('tocar la que ya está elegida no cambia nada (no borra la cuenta que eligió la persona)', () => {
    const before = {
      direction: 'out',
      motive: 'other',
      accountId: 'elegida',
      partyId: null,
    } as const
    expect(applySituation(before, find('other', 'out'), { ...ctx, suggestedAccountId: null })).toBe(
      before,
    )
  })
})

describe('Otra entrada o salida: los textos', () => {
  it('las preguntas siguen al sentido', () => {
    expect(treasuryQuestion('out')).toBe('¿De qué caja salió?')
    expect(treasuryQuestion('in')).toBe('¿A qué caja entró?')
    expect(treasuryQuestion(null)).toBe('¿Qué caja?')
    expect(accountQuestion('in')).toBe('¿De qué es esta plata?')
    expect(accountQuestion('out')).toBe('¿En qué se fue?')
  })

  it('con «otra», dice qué NO va en esta hoja (una compra sin factura es un gasto)', () => {
    expect(otherWarning('out', 'other')).toContain('cargalo como gasto')
    expect(otherWarning('out', 'other')).toContain('tenga factura o no')
    expect(otherWarning('in', 'other')).toContain('va en el cierre del día')
    expect(otherWarning('out', 'partner_withdrawal')).toBeNull()
    expect(otherWarning(null, null)).toBeNull()
  })

  it('el vale: de dónde sale o a dónde entra, y su letra chica', () => {
    expect(voucherTotalLabel('out', 'Caja')).toBe('Salen de Caja')
    expect(voucherTotalLabel('in', 'Caja')).toBe('Entran a Caja')
    expect(voucherTotalLabel(null, 'Caja')).toBe('Total')
    expect(voucherTotalLabel('out', null)).toBe('Total')
    // Un nombre de 60 caracteres se corta a 22 (con su «…») para que el rótulo no parta renglón.
    const long = voucherTotalLabel(
      'out',
      'Cuenta corriente en pesos del Banco de la Provincia de Córdoba',
    )
    expect(long).toBe('Salen de Cuenta corriente en p…')
    expect(voucherNote('partner_withdrawal')).toBe(
      'Queda a nombre del socio: no es un gasto ni una venta del bar.',
    )
    expect(voucherNote('other')).toContain('No lleva factura')
    expect(voucherNote(null)).toContain('No lleva factura')
    // Un solo libro: lo que no es venta ni compra no queda «por fuera» de nada.
    expect(voucherNote('other')).toBe(
      'No lleva factura: no es una venta ni una compra. Queda registrada igual.',
    )
    for (const motive of ['other', 'mp_yield', 'loan_received', 'partner_withdrawal'] as const) {
      expect(voucherNote(motive)).not.toMatch(/por fuera|afuera|en negro|en blanco/i)
    }
  })

  it('el selector de la categoría habla como su pregunta (sin «cuenta»)', () => {
    expect(accountPlaceholder('out')).toBe('Elegí en qué se fue')
    expect(accountPlaceholder('in')).toBe('Elegí de qué es')
    expect(accountPlaceholder(null)).not.toMatch(/cuenta/i)
  })

  it('«Ver cómo queda en los libros» abierto dice QUÉ falta', () => {
    expect(booksEmptyText(['el socio'])).toBe('Para verlo falta: el socio.')
    expect(booksEmptyText(['qué pasó', 'la caja', 'el importe'])).toBe(
      'Para verlo falta: qué pasó, la caja y el importe.',
    )
    expect(booksEmptyText([])).toBe('Completá lo que falta para ver cómo queda en los libros.')
  })

  it('el botón', () => {
    expect(movementSubmitLabel(null, null)).toBe('Anotar')
    expect(movementSubmitLabel('out', null)).toBe('Anotar')
    expect(movementSubmitLabel('out', '$ 100.000')).toBe('Anotar la salida · $ 100.000')
    expect(movementSubmitLabel('in', '$ 100.000')).toBe('Anotar la entrada · $ 100.000')
  })
})

describe('Gastos del banco: los renglones del resumen', () => {
  it('cubren los mismos importes que guarda el formulario, sin repetir ni inventar', () => {
    const fields = BANK_ROWS.map((row) => row.field)
    expect([...fields].sort()).toEqual([...BANK_AMOUNT_FIELDS].sort())
    expect(new Set(fields).size).toBe(fields.length)
    // Son campos del esquema de la acción (`postBankExpense`).
    const schemaKeys = new Set(Object.keys(bankExpenseSchema.shape))
    for (const field of fields) expect(schemaKeys.has(field), field).toBe(true)
  })

  it('los campos que el formulario dibuja son los de siempre', () => {
    expect([...BANK_KNOWN_FIELDS].sort()).toEqual(
      [
        'treasuryAccountId',
        'date',
        'includeInIvaBook',
        'voucher',
        'voucher.voucherType',
        'voucher.pointOfSale',
        'voucher.number',
        'feesNetCents',
        'vatRateBp',
        'vatPerceptionCents',
        'feesNoVatCents',
        'ley25413CreditCents',
        'ley25413DebitCents',
        'sircrebCents',
        'interestCents',
        'notes',
      ].sort(),
    )
    for (const field of BANK_AMOUNT_FIELDS) expect(BANK_KNOWN_FIELDS.has(field)).toBe(true)
  })

  it('lo de todos los meses va a la vista; lo raro, detrás de «Más conceptos»', () => {
    expect(BANK_ROWS.filter((row) => !row.more).map((row) => row.label)).toEqual([
      'Comisiones y mantenimiento',
      'Impuesto al cheque, sobre lo que salió',
      'Impuesto al cheque, sobre lo que entró',
      'Ingresos Brutos',
      'Intereses',
    ])
    expect(BANK_ROWS.filter((row) => row.more).map((row) => row.field)).toEqual([
      'vatPerceptionCents',
      'feesNoVatCents',
    ])
    // El nombre técnico queda para quien lo busque; el del dueño no lo usa.
    for (const row of BANK_ROWS) expect(row.label).not.toMatch(/SIRCREB|25\.413|Percepción/)
  })

  it('el avance contra el total del resumen, en palabras', () => {
    expect(bankProgress(1_812_400, 2_680_000, formatCents)).toEqual({
      kind: 'short',
      text: `Repartiste ${money('$ 18.124,00')} de ${money('$ 26.800,00')}. Faltan ${money('$ 8.676,00')}.`,
      leftCents: 867_600,
    })
    expect(bankProgress(2_680_000, 2_680_000, formatCents)).toEqual({
      kind: 'match',
      text: 'Coincide con el resumen.',
    })
    expect(bankProgress(2_710_000, 2_680_000, formatCents)).toMatchObject({
      kind: 'over',
      text: `Cargaste ${money('$ 300,00')} de más.`,
    })
    expect(bankProgress(0, 2_680_000, formatCents)).toMatchObject({ kind: 'empty' })
    // Sin total del resumen no hay contra qué medir.
    expect(bankProgress(1_812_400, null, formatCents)).toEqual({
      kind: 'no_control',
      text: `Total debitado ${money('$ 18.124,00')}`,
    })
  })

  it('en la pantalla el avance va sin centavos de más (el papel sigue al centavo)', () => {
    // La pantalla le pasa `moneyLabel`: redondo sin «,00»; con centavos, con centavos.
    expect(bankProgress(2_072_800, 2_680_000, moneyLabel).text).toBe(
      `Repartiste ${money('$ 20.728')} de ${money('$ 26.800')}. Faltan ${money('$ 6.072')}.`,
    )
    expect(bankProgress(2_072_850, 2_680_000, moneyLabel).text).toBe(
      `Repartiste ${money('$ 20.728,50')} de ${money('$ 26.800')}. Faltan ${money('$ 6.071,50')}.`,
    )
    // La nota del papel se arma aparte, con centavos.
    expect(bankStatementNote(bankProgress(2_072_800, 2_680_000, moneyLabel), formatCents)).toBe(
      `Faltan ${money('$ 6.072,00')} para llegar al total.`,
    )
  })

  it('la nota del papel dice lo mismo, o nada si no hay contra qué medir', () => {
    expect(bankStatementNote(bankProgress(100, 100, formatCents), formatCents)).toBe(
      'Coincide con el resumen.',
    )
    expect(bankStatementNote(bankProgress(100, 300, formatCents), formatCents)).toBe(
      `Faltan ${money('$ 2,00')} para llegar al total.`,
    )
    expect(bankStatementNote(bankProgress(100, null, formatCents), formatCents)).toBeNull()
    expect(bankStatementNote(bankProgress(0, 300, formatCents), formatCents)).toBeNull()
  })

  it('«Sí, tengo el comprobante» se apaga por lo mismo que antes la casilla', () => {
    expect(bookBlock({ hasTreasury: false, bankHasCuit: false, feesNetCents: 100 })).toBe(
      'no_treasury',
    )
    expect(bookBlock({ hasTreasury: true, bankHasCuit: false, feesNetCents: 100 })).toBe('no_cuit')
    expect(bookBlock({ hasTreasury: true, bankHasCuit: true, feesNetCents: null })).toBe('no_fees')
    expect(bookBlock({ hasTreasury: true, bankHasCuit: true, feesNetCents: 0 })).toBe('no_fees')
    expect(bookBlock({ hasTreasury: true, bankHasCuit: true, feesNetCents: 100 })).toBeNull()
  })
})
