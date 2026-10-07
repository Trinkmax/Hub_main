import { describe, expect, it } from 'vitest'
import {
  type AccountNode,
  accountLabel,
  accountOptions,
  accountPath,
  compactCode,
  compareAccountCodes,
  flattenAccountTree,
  parentCodeOf,
  suggestParentAccount,
} from '@/components/accounting/account-tree'
import {
  closedMonthGuard,
  closedMonthReason,
  monthKey,
} from '@/components/accounting/closed-periods'
import {
  balanceDiffText,
  balanceGapText,
  entryBalance,
  hasAmount,
} from '@/components/accounting/entry-balance'
import {
  accountPatch,
  amountPatch,
  type EntryEditorLine,
  entryBlockMessage,
  entryEditorBlockMessage,
  entryLinesForPreview,
  initialEntryLines,
  isBlankEntryLine,
  serializeEntryLines,
} from '@/components/accounting/entry-editor-model'
import {
  createKeyFactory,
  defaultLineLabel,
  focusAfterRemove,
  lineControlLabel,
  stripLineKeys,
} from '@/components/accounting/line-items-model'
import {
  paymentMethodsBalance,
  paymentMethodsBlockMessage,
  paymentMethodsGapText,
  remainderCents,
  serializePaymentMethods,
} from '@/components/accounting/payment-methods-model'
import { filterOptions } from '@/components/ui/combobox'
import { STANDARD_CHART } from '@/lib/accounting/chart'
import { manualEntrySchema, paymentSchema } from '@/lib/accounting/schemas'

/**
 * La lógica pura de las piezas contables del kit (§3.8): el árbol y la
 * búsqueda del plan de cuentas, el cuadre y lo que frena el envío de un
 * asiento, el foco de `LineItems`, los medios de pago y los meses cerrados.
 */

const NBSP = ' '

/** El plan estándar (§D) como lo lee el selector, con las cajas que crea el asistente. */
const CHART: AccountNode[] = [
  ...STANDARD_CHART.map((a) => ({
    id: `acc-${a.code}`,
    code: a.code,
    name: a.name,
    postable: a.postable,
    active: true,
    description: a.description,
    normalSide: a.normalSide,
    type: a.type,
    requiresParty: a.requiresParty,
  })),
  {
    id: 'acc-1.1.01.01',
    code: '1.1.01.01',
    name: 'Caja',
    postable: true,
    active: true,
    description: 'Efectivo del local',
  },
  { id: 'acc-1.1.01.02', code: '1.1.01.02', name: 'Mercado Pago', postable: true, active: true },
  { id: 'acc-1.1.01.03', code: '1.1.01.03', name: 'Banco Nación', postable: true, active: false },
]

const byCode = (code: string) => CHART.find((a) => a.code === code)

describe('account-tree · el plan como árbol', () => {
  it('códigos: padre, orden numérico por segmento y sin puntos', () => {
    expect(parentCodeOf('1.1.03.01')).toBe('1.1.03')
    expect(parentCodeOf('1')).toBeNull()
    expect(['1.1.10', '1.2', '1.1.02', '1.1'].sort(compareAccountCodes)).toEqual([
      '1.1',
      '1.1.02',
      '1.1.10',
      '1.2',
    ])
    expect(compactCode('1.1.01.02')).toBe('110102')
  })

  it('cada padre antes que sus hijas, con profundidad y camino de rubros', () => {
    const entries = flattenAccountTree(CHART)
    expect(entries).toHaveLength(CHART.length)
    const codes = entries.map((e) => e.account.code)
    expect(codes.slice(0, 4)).toEqual(['1', '1.1', '1.1.01', '1.1.01.01'])
    const caja = entries.find((e) => e.account.code === '1.1.01.01')
    expect(caja?.depth).toBe(3)
    expect(caja?.parent?.code).toBe('1.1.01')
    expect(caja && accountPath(caja)).toBe('ACTIVO › Activo corriente › Caja y bancos')
    expect(accountLabel({ code: '1.1.01.01', name: 'Caja' })).toBe('1.1.01.01 · Caja')
  })

  it('el parentId manda sobre el código; un padre que no está sube al ancestro; un ciclo no cuelga', () => {
    const nodes: AccountNode[] = [
      { id: 'r', code: '9', name: 'RAÍZ', postable: false, active: true, parentId: null },
      { id: 'g', code: '9.1', name: 'Grupo', postable: false, active: true, parentId: 'r' },
      // Su código diría 9.1, pero el parentId la cuelga de la raíz.
      { id: 'x', code: '9.1.01', name: 'Movida', postable: true, active: true, parentId: 'r' },
      // Padre ausente: sube a 9.1 por el código.
      { id: 'y', code: '9.1.02.01', name: 'Huérfana', postable: true, active: true },
      { id: 'a', code: '8', name: 'A', postable: false, active: true, parentId: 'b' },
      { id: 'b', code: '7', name: 'B', postable: false, active: true, parentId: 'a' },
    ]
    const entries = flattenAccountTree(nodes)
    expect(entries.map((e) => e.account.id).sort()).toEqual(['a', 'b', 'g', 'r', 'x', 'y'])
    expect(entries.find((e) => e.account.id === 'x')?.parent?.id).toBe('r')
    expect(entries.find((e) => e.account.id === 'y')?.parent?.id).toBe('g')
  })
})

describe('account-tree · opciones y búsqueda del selector', () => {
  const options = accountOptions(CHART)

  it('solo imputables, con el rubro padre como encabezado y la etiqueta «código · nombre»', () => {
    expect(options.every((o) => o.data?.postable)).toBe(true)
    const caja = options.find((o) => o.value === 'acc-1.1.01.01')
    expect(caja?.label).toBe('1.1.01.01 · Caja')
    expect(caja?.group).toBe('1.1.01 Caja y bancos')
    expect(caja?.description).toBe('Efectivo del local')
    expect(caja?.keywords).toEqual(['110101', 'ACTIVO', 'Activo corriente', 'Caja y bancos'])
  })

  it('las inactivas no aparecen salvo con includeInactive o si ya están elegidas', () => {
    expect(options.some((o) => o.value === 'acc-1.1.01.03')).toBe(false)
    expect(
      accountOptions(CHART, { includeInactive: true }).some((o) => o.value === 'acc-1.1.01.03'),
    ).toBe(true)
    expect(
      accountOptions(CHART, { keep: ['acc-1.1.01.03'] }).some((o) => o.value === 'acc-1.1.01.03'),
    ).toBe(true)
  })

  it('postableOnly={false} deja elegir rubros (el mayor de un grupo)', () => {
    const all = accountOptions(CHART, { postableOnly: false })
    expect(all.find((o) => o.value === 'acc-1.1.03')?.label).toBe('1.1.03 · Créditos fiscales')
    expect(all.find((o) => o.value === 'acc-1')?.group).toBeUndefined()
  })

  it('un filtro acota (solo egresos)', () => {
    const expenses = accountOptions(CHART, { filter: (a) => a.type === 'expense' })
    expect(expenses.length).toBeGreaterThan(10)
    expect(expenses.every((o) => o.label.startsWith('5.'))).toBe(true)
  })

  it('«1.1» trae ese subárbol primero (prefijo del código)', () => {
    const found = filterOptions(options, '1.1').map((e) => e.option.label)
    const prefixed = found.filter((label) => label.startsWith('1.1'))
    expect(found.slice(0, prefixed.length)).toEqual(prefixed)
    expect(prefixed[0]).toBe('1.1.01.01 · Caja')
  })

  it('«1101» encuentra las de 1.1.01 (código sin puntos)', () => {
    const found = filterOptions(options, '1101').map((e) => e.option.value)
    expect(found.slice(0, 2)).toEqual(['acc-1.1.01.01', 'acc-1.1.01.02'])
  })

  it('por nombre «contiene» y sin tildes; por rubro; por «Para qué se usa»', () => {
    expect(filterOptions(options, 'credito fiscal').map((e) => e.option.label)[0]).toBe(
      '1.1.03.01 · IVA crédito fiscal',
    )
    const fiscal = filterOptions(options, 'creditos fiscales').map((e) => e.option.group)
    expect(fiscal.length).toBeGreaterThan(5)
    expect(new Set(fiscal)).toEqual(new Set(['1.1.03 Créditos fiscales']))
    const cheque = filterOptions(options, 'cheque').map((e) => e.option.label)
    expect(cheque).toContain('1.1.03.15 · Impuesto ley 25.413 computable en Ganancias')
  })

  it('«Nueva cuenta» sugiere el rubro más profundo que contiene el código buscado', () => {
    expect(suggestParentAccount(CHART, '1.1.04.07')?.code).toBe('1.1.04')
    expect(suggestParentAccount(CHART, '5.3.02')?.code).toBe('5.3.02')
    expect(suggestParentAccount(CHART, 'Propinas')).toBeNull()
    expect(byCode('1.1.04')?.postable).toBe(false)
  })
})

describe('entry-balance · cuadre y textos', () => {
  it('sumas en BigInt, estado y lo que falta', () => {
    const balance = entryBalance([
      { debitCents: 100000, creditCents: null },
      { debitCents: null, creditCents: 98760 },
    ])
    expect(balance).toEqual({
      status: 'unbalanced',
      debit: 100000n,
      credit: 98760n,
      diff: 1240n,
      gap: { side: 'credit', cents: 1240n },
    })
    expect(entryBalance([]).status).toBe('empty')
    expect(balanceDiffText(-1240n)).toBe(`diferencia $${NBSP}12,40`)
    expect(balanceGapText({ side: 'credit', cents: 1240n })).toBe(`Falta $${NBSP}12,40 en el Haber`)
    expect(hasAmount(0)).toBe(false)
    expect(hasAmount(0n)).toBe(false)
    expect(hasAmount(Number.NaN)).toBe(false)
    expect(hasAmount(1n)).toBe(true)
  })

  it('lo que frena el envío es el mismo texto del server', () => {
    expect(entryBlockMessage([{ debitCents: 100, creditCents: null }])).toBe(
      'Un asiento necesita al menos dos líneas.',
    )
    expect(
      entryBlockMessage([
        { debitCents: 100000, creditCents: null },
        { debitCents: null, creditCents: 98760 },
      ]),
    ).toBe(`El asiento no cuadra: falta $${NBSP}12,40 en el Haber.`)
    expect(
      entryBlockMessage([
        { side: 'debit', amountCents: 500 },
        { side: 'credit', amountCents: 500 },
      ]),
    ).toBeNull()
  })
})

describe('line-items · foco, nombres y serialización', () => {
  it('después de quitar: la siguiente, si no la anterior, si no «Agregar línea»', () => {
    expect(focusAfterRemove(['a', 'b', 'c'], 1)).toEqual({ key: 'c' })
    expect(focusAfterRemove(['a', 'b', 'c'], 2)).toEqual({ key: 'b' })
    expect(focusAfterRemove(['a'], 0)).toBe('add')
  })

  it('«Línea 2» y «Cuenta, línea 2»', () => {
    expect(defaultLineLabel(1)).toBe('Línea 2')
    expect(lineControlLabel('Cuenta', 'Línea 2')).toBe('Cuenta, línea 2')
  })

  it('el JSON canónico va sin keys; las keys nuevas no se repiten', () => {
    expect(stripLineKeys([{ key: 'l0', a: 1 }])).toEqual([{ a: 1 }])
    const next = createKeyFactory('n')
    expect([next(), next(), next()]).toEqual(['n1', 'n2', 'n3'])
  })
})

describe('entry-editor-model · asiento manual', () => {
  const ACC_A = '11111111-1111-4111-8111-111111111111'
  const ACC_B = '22222222-2222-4222-8222-222222222222'
  const line = (patch: Partial<EntryEditorLine>, key = 'l'): EntryEditorLine => ({
    key,
    accountId: null,
    debitCents: null,
    creditCents: null,
    note: '',
    ...patch,
  })

  it('una línea es de un solo lado: el importe en el Debe vacía el Haber y al revés', () => {
    expect(amountPatch('debit', 5000)).toEqual({ debitCents: 5000, creditCents: null })
    expect(amountPatch('credit', 5000)).toEqual({ creditCents: 5000, debitCents: null })
    expect(amountPatch('debit', null)).toEqual({ debitCents: null })
    expect(amountPatch('credit', 0)).toEqual({ creditCents: 0 })
  })

  it('cambiar a una cuenta sin partícipe borra el partícipe y el vencimiento', () => {
    expect(accountPatch(ACC_A, { requiresParty: false })).toEqual({
      accountId: ACC_A,
      partyId: null,
      dueDate: null,
    })
    expect(accountPatch(ACC_A, { requiresParty: true })).toEqual({ accountId: ACC_A })
  })

  it('arranca con dos líneas vacías de keys fijas', () => {
    expect(initialEntryLines().map((l) => l.key)).toEqual(['l0', 'l1'])
    expect(initialEntryLines().every(isBlankEntryLine)).toBe(true)
  })

  it('frena: línea con cuenta y sin importe, menos de dos líneas, no cuadra', () => {
    expect(
      entryEditorBlockMessage([
        line({ accountId: ACC_A, debitCents: 100 }, 'a'),
        line({ accountId: ACC_B, creditCents: 100 }, 'b'),
        line({ accountId: ACC_B }, 'c'),
      ]),
    ).toBe('Falta el importe de la línea 3.')
    expect(entryEditorBlockMessage([line({ accountId: ACC_A, debitCents: 100 })])).toBe(
      'Un asiento necesita al menos dos líneas.',
    )
    expect(
      entryEditorBlockMessage([
        line({ accountId: ACC_A, debitCents: 100000 }, 'a'),
        line({ accountId: ACC_B, creditCents: 98760 }, 'b'),
        line({}, 'c'),
      ]),
    ).toBe(`El asiento no cuadra: falta $${NBSP}12,40 en el Haber.`)
  })

  it('el JSON es el que lee manualEntrySchema (y el server dice lo mismo si no cuadra)', () => {
    const base = {
      clientRef: '33333333-3333-4333-8333-333333333333',
      previewHash: 'a'.repeat(64),
      date: '2026-09-30',
      description: 'Sueldos de septiembre',
    }
    const lines = [
      line({ accountId: ACC_A, debitCents: 350000000, note: '  Sueldos brutos ' }, 'a'),
      line({ accountId: ACC_B, creditCents: 350000000 }, 'b'),
      line({}, 'c'),
    ]
    const serialized = serializeEntryLines(lines)
    expect(serialized).toEqual([
      {
        accountId: ACC_A,
        debitCents: 350000000,
        creditCents: null,
        partyId: null,
        dueDate: null,
        memo: 'Sueldos brutos',
      },
      {
        accountId: ACC_B,
        debitCents: null,
        creditCents: 350000000,
        partyId: null,
        dueDate: null,
        memo: null,
      },
    ])
    expect(manualEntrySchema.safeParse({ ...base, lines: serialized }).success).toBe(true)

    const unbalanced = serializeEntryLines([
      line({ accountId: ACC_A, debitCents: 100000 }, 'a'),
      line({ accountId: ACC_B, creditCents: 98760 }, 'b'),
    ])
    const parsed = manualEntrySchema.safeParse({ ...base, lines: unbalanced })
    expect(parsed.success).toBe(false)
    const serverMessage = parsed.error?.issues.find((i) => i.path[0] === 'lines')?.message
    expect(serverMessage).toBe(
      entryEditorBlockMessage([
        line({ accountId: ACC_A, debitCents: 100000 }, 'a'),
        line({ accountId: ACC_B, creditCents: 98760 }, 'b'),
      ]),
    )
  })

  it('en solo lectura se ve como EntryPreview: código, nombre y partícipe', () => {
    const accounts = new Map<string, AccountNode>([
      [
        ACC_A,
        { id: ACC_A, code: '5.3.01.01', name: 'Sueldos y jornales', postable: true, active: true },
      ],
    ])
    const preview = entryLinesForPreview(
      [line({ accountId: ACC_A, debitCents: 100, partyId: 'p1' }, 'a'), line({}, 'b')],
      accounts,
      { p1: 'Personal' },
    )
    expect(preview).toEqual([
      {
        id: 'a',
        accountCode: '5.3.01.01',
        accountName: 'Sueldos y jornales',
        debitCents: 100,
        creditCents: null,
        note: '',
        partyName: 'Personal',
        dueDate: null,
      },
    ])
  })
})

describe('payment-methods-model · medios contra la meta', () => {
  const TREASURY = '44444444-4444-4444-8444-444444444444'
  const lines = [
    { key: 'm0', treasuryAccountId: TREASURY, amountCents: 100000000, reference: ' 0045 ' },
    { key: 'm1', treasuryAccountId: null, amountCents: null, reference: '' },
  ]

  it('falta, completo, sobra y sin meta', () => {
    const short = paymentMethodsBalance(lines, 117950000)
    expect(short.status).toBe('short')
    expect(paymentMethodsGapText(short)).toBe(`Falta asignar $${NBSP}179.500,00 a un medio`)
    expect(paymentMethodsBlockMessage(short)).toBe(`Falta asignar $${NBSP}179.500,00 a un medio.`)
    expect(remainderCents(lines, 117950000)).toBe(17950000)
    expect(paymentMethodsBalance(lines, 100000000).status).toBe('balanced')
    const over = paymentMethodsBalance(lines, 90000000)
    expect(over.status).toBe('over')
    expect(paymentMethodsGapText(over)).toBe(`Sobran $${NBSP}100.000,00`)
    expect(paymentMethodsBalance(lines).status).toBe('untargeted')
    expect(remainderCents(lines, 90000000)).toBeNull()
  })

  it('el JSON es el de paymentSchema.methods (y el de collectionSchema.received sin type)', () => {
    const methods = serializePaymentMethods(lines)
    expect(methods).toEqual([
      { type: 'treasury', treasuryAccountId: TREASURY, amountCents: 100000000, reference: '0045' },
    ])
    const parsed = paymentSchema.safeParse({
      clientRef: '33333333-3333-4333-8333-333333333333',
      previewHash: 'b'.repeat(64),
      partyId: '55555555-5555-4555-8555-555555555555',
      date: '2026-10-07',
      methods,
    })
    expect(parsed.success).toBe(true)
    expect(serializePaymentMethods(lines, 'collection')).toEqual([
      { treasuryAccountId: TREASURY, amountCents: 100000000, reference: '0045' },
    ])
  })
})

describe('closed-periods · meses cerrados en los campos de fecha', () => {
  const guard = closedMonthGuard(['2026-08', '2026-09-01', 'cualquier cosa'])

  it('apaga los días de los meses cerrados y dice por qué', () => {
    expect(monthKey('2026-09-15')).toBe('2026-09')
    expect(monthKey('2026-13')).toBeNull()
    expect(guard.isDateDisabled('2026-09-30')).toBe(true)
    expect(guard.isDateDisabled('2026-08-01')).toBe(true)
    expect(guard.isDateDisabled('2026-10-01')).toBe(false)
    expect(guard.disabledReason('2026-09-30')).toBe(
      'Septiembre está cerrado: la corrección va con un asiento de ajuste.',
    )
    expect(guard.disabledReason('2026-10-01')).toBeNull()
    expect(closedMonthReason('2026-08')).toBe(
      'Agosto está cerrado: la corrección va con un asiento de ajuste.',
    )
  })
})
