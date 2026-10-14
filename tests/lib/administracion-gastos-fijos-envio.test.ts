import { describe, expect, it } from 'vitest'
import {
  recurringBulkItems,
  TYPICAL_RECURRING,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/bulk'
import { quickVoucherFromType } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import { nthDue } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/recurring'
import { PURCHASE_VOUCHER_OPTIONS } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/vouchers'
import {
  buildRecurringPayload,
  COMMON_VAT_RATES,
  type InstallmentsDraft,
  initialInstallments,
  installmentsValues,
  newBreakdownDraft,
  OTHER_PAPER_OPTIONS,
  OTHER_VAT_RATES,
  paperShowsVat,
  type RecurringFormValues,
  validateRecurringForm,
  voucherTypeForPaper,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/gastos-fijos/[id]/_lib/form-payload'
import {
  dueDayPatch,
  quickEditPatch,
  recurringEditPayload,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla-words'
import { PAPER_OPTIONS } from '@/components/administracion/acciones/gasto-papel'
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import { recurringBulkSchema, recurringSchema } from '@/lib/accounting/schemas'

// El rediseño de Gastos fijos cambió cómo se pregunta, no qué se guarda. Acá se
// fija el envío: la ficha manda lo mismo que el formulario anterior, clave por
// clave, y la planilla edita con el paquete que ya mandaba el «Deshacer».

const ID = '00000000-0000-4000-8000-0000000000a1'
const ACCOUNT = '00000000-0000-4000-8000-0000000000b1'
const PARTY = '00000000-0000-4000-8000-0000000000c1'
const TREASURY = '00000000-0000-4000-8000-0000000000d1'
const UPDATED = '2026-10-12T10:00:00.000Z'

const NEW: RecurringFormValues = {
  id: null,
  updatedAt: null,
  name: 'Alquiler',
  partyId: null,
  accountId: ACCOUNT,
  voucherType: null,
  vatRateBp: null,
  amountCents: null,
  frequency: 'monthly',
  dueDay: 10,
  nextDueDate: '2026-11-10',
  remindDaysBefore: 5,
  treasuryAccountId: null,
  active: true,
  notes: '',
  endsOn: null,
  installmentsTotal: null,
  breakdown: [],
}

/** Lo que arma la ficha: las cuotas contestadas → `dues` e `installmentsTotal`, y de ahí el paquete. */
function send(
  initial: RecurringFormValues,
  change: Partial<RecurringFormValues> = {},
  opts: { installments?: InstallmentsDraft; lines?: ReturnType<typeof newBreakdownDraft>[] } = {},
) {
  const draft = opts.installments ?? initialInstallments(initial)
  const { dues, installmentsTotal } = installmentsValues(draft)
  const lines = opts.lines ?? initial.breakdown.map((line) => newBreakdownDraft(line))
  const input = { form: { ...initial, ...change, installmentsTotal }, initial, dues, lines }
  return { payload: buildRecurringPayload(input), errors: validateRecurringForm(input, draft) }
}

describe('la ficha manda lo mismo que el formulario anterior', () => {
  it('1 · alta mínima: nombre y categoría, lo demás como venía', () => {
    const { payload, errors } = send(NEW)
    expect(errors).toEqual({})
    expect(payload).toEqual({
      name: 'Alquiler',
      partyId: null,
      accountId: ACCOUNT,
      voucherType: null,
      vatRateBp: null,
      amountCents: null,
      frequency: 'monthly',
      dueDay: 10,
      nextDueDate: '2026-11-10',
      remindDaysBefore: 5,
      treasuryAccountId: null,
      active: true,
      notes: '',
      endsOn: null,
      installmentsTotal: null,
      breakdown: [],
    })
    // Un alta no manda `id` ni `expectedUpdatedAt`.
    expect(Object.keys(payload)).not.toContain('id')
    expect(recurringSchema.safeParse(payload).success).toBe(true)
  })

  it('2 · con cuotas y total: «¿De cuántas?» 6 y «¿Por cuál vas?» 2', () => {
    const { payload, errors } = send(
      NEW,
      { amountCents: 12_000_000 },
      { installments: { mode: 'total', total: 6, current: 2 } },
    )
    expect(errors).toEqual({})
    // Faltan 5 contando la próxima: la última es la quinta desde el 10/11.
    expect(payload).toMatchObject({
      amountCents: 12_000_000,
      endsOn: '2027-03-10',
      installmentsTotal: 6,
      active: true,
    })
    expect(recurringSchema.parse(payload)).toMatchObject({
      endsOn: '2027-03-10',
      installmentsTotal: 6,
    })
  })

  it('3 · con cuotas sin total: «solo sé cuántas faltan»', () => {
    const { payload, errors } = send(
      NEW,
      {},
      { installments: { mode: 'remaining', remaining: 3, total: null } },
    )
    expect(errors).toEqual({})
    expect(payload).toMatchObject({ endsOn: '2027-01-10', installmentsTotal: null })
  })

  it('4 · con detalle (los sueldos): el monto es la suma y se manda el detalle', () => {
    const lines = [
      newBreakdownDraft({ label: ' Ana ', kind: 'blanco', amountCents: 50_000_000 }),
      newBreakdownDraft({ label: 'Ana', kind: 'aporte', amountCents: 8_500_000 }),
      // Un renglón vacío se descarta.
      newBreakdownDraft(),
    ]
    const { payload, errors } = send(NEW, { name: 'Sueldos', amountCents: 123 }, { lines })
    expect(errors).toEqual({})
    expect(payload.amountCents).toBe(58_500_000)
    expect(payload.breakdown).toEqual([
      { label: 'Ana', kind: 'blanco', amountCents: 50_000_000 },
      { label: 'Ana', kind: 'aporte', amountCents: 8_500_000 },
    ])
    expect(recurringSchema.safeParse(payload).success).toBe(true)
  })

  const ENDED: RecurringFormValues = {
    ...NEW,
    id: ID,
    updatedAt: UPDATED,
    name: 'Licuadora',
    amountCents: 4_000_000,
    nextDueDate: '2026-10-10',
    active: false,
    endsOn: '2026-09-10',
    installmentsTotal: 6,
  }

  it('5 · edición que reactiva uno terminado: vuelve a tener cuotas y se prende solo', () => {
    const { payload, errors } = send(
      ENDED,
      {},
      { installments: { mode: 'remaining', remaining: 2, total: 6 } },
    )
    expect(errors).toEqual({})
    expect(payload).toMatchObject({
      id: ID,
      expectedUpdatedAt: UPDATED,
      active: true,
      endsOn: '2026-11-10',
      installmentsTotal: 6,
    })
  })

  it('6 · uno terminado que no se toca conserva su último vencimiento y sigue apagado', () => {
    // Abre con el campo vacío («decí cuántas cuotas más faltan») y así se manda.
    expect(initialInstallments(ENDED)).toEqual({ mode: 'remaining', remaining: null, total: 6 })
    const { payload, errors } = send(ENDED)
    expect(errors).toEqual({})
    expect(payload).toMatchObject({
      id: ID,
      active: false,
      endsOn: '2026-09-10',
      installmentsTotal: 6,
    })
  })

  it('7 · edición con papel, IVA, proveedor y caja de siempre', () => {
    const saved: RecurringFormValues = {
      ...NEW,
      id: ID,
      updatedAt: UPDATED,
      name: 'Internet',
      partyId: PARTY,
      voucherType: 'factura_a',
      vatRateBp: 2100,
      amountCents: 3_500_000,
      frequency: 'bimonthly',
      dueDay: 15,
      nextDueDate: '2026-11-15',
      remindDaysBefore: 3,
      treasuryAccountId: TREASURY,
      notes: 'Sube en enero',
    }
    const { payload, errors } = send(saved)
    expect(errors).toEqual({})
    expect(payload).toEqual({
      id: ID,
      expectedUpdatedAt: UPDATED,
      name: 'Internet',
      partyId: PARTY,
      accountId: ACCOUNT,
      voucherType: 'factura_a',
      vatRateBp: 2100,
      amountCents: 3_500_000,
      frequency: 'bimonthly',
      dueDay: 15,
      nextDueDate: '2026-11-15',
      remindDaysBefore: 3,
      treasuryAccountId: TREASURY,
      active: true,
      notes: 'Sube en enero',
      endsOn: null,
      installmentsTotal: null,
      breakdown: [],
    })
    expect(recurringSchema.safeParse(payload).success).toBe(true)
  })

  it('las claves y su orden son los de siempre', () => {
    expect(Object.keys(send({ ...NEW, id: ID, updatedAt: UPDATED }).payload)).toEqual([
      'id',
      'expectedUpdatedAt',
      'name',
      'partyId',
      'accountId',
      'voucherType',
      'vatRateBp',
      'amountCents',
      'frequency',
      'dueDay',
      'nextDueDate',
      'remindDaysBefore',
      'treasuryAccountId',
      'active',
      'notes',
      'endsOn',
      'installmentsTotal',
      'breakdown',
    ])
  })
})

describe('«¿Es en cuotas?»: las dos formas de preguntar guardan lo mismo', () => {
  it('«de 6, voy por la 2» = «faltan 5, de 6»', () => {
    const byTotal = send(NEW, {}, { installments: { mode: 'total', total: 6, current: 2 } })
    const byRemaining = send(
      NEW,
      {},
      { installments: { mode: 'remaining', remaining: 5, total: 6 } },
    )
    expect(byTotal.payload.endsOn).toBe(byRemaining.payload.endsOn)
    expect(byTotal.payload.installmentsTotal).toBe(byRemaining.payload.installmentsTotal)
    expect(byTotal.payload.endsOn).toBe(nthDue('2026-11-10', 10, 'monthly', 5))
    // «Es un solo pago»: 1 de 1, la última es la próxima.
    expect(
      send(NEW, {}, { installments: { mode: 'total', total: 1, current: 1 } }).payload,
    ).toMatchObject({ endsOn: '2026-11-10', installmentsTotal: 1 })
  })

  it('lo guardado abre contestado igual: nadie toca nada y se manda lo que había', () => {
    const cases: Array<Partial<RecurringFormValues>> = [
      // No termina.
      { endsOn: null, installmentsTotal: null },
      // Cuota 2 de 6.
      { endsOn: '2027-03-10', installmentsTotal: 6 },
      // Sin total: se sabe solo cuántas faltan.
      { endsOn: '2027-01-10', installmentsTotal: null },
      // La última.
      { endsOn: '2026-11-10', installmentsTotal: 12 },
      // Cada tres meses.
      { endsOn: '2027-05-10', installmentsTotal: 4, frequency: 'quarterly' },
    ]
    for (const over of cases) {
      const saved = { ...NEW, id: ID, updatedAt: UPDATED, ...over }
      const { payload, errors } = send(saved)
      expect(errors, JSON.stringify(over)).toEqual({})
      expect(payload.endsOn, JSON.stringify(over)).toBe(saved.endsOn)
      expect(payload.installmentsTotal, JSON.stringify(over)).toBe(saved.installmentsTotal)
    }
    expect(initialInstallments({ ...NEW, endsOn: '2027-03-10', installmentsTotal: 6 })).toEqual({
      mode: 'total',
      total: 6,
      current: 2,
    })
    expect(initialInstallments({ ...NEW, endsOn: '2027-01-10' })).toEqual({
      mode: 'remaining',
      remaining: 3,
      total: null,
    })
  })

  it('«No, es de siempre» borra las cuotas, como antes', () => {
    const saved = { ...NEW, id: ID, updatedAt: UPDATED, endsOn: '2027-03-10', installmentsTotal: 6 }
    expect(send(saved, {}, { installments: { mode: 'none' } }).payload).toMatchObject({
      endsOn: null,
      installmentsTotal: null,
    })
  })

  it('los errores se dicen con las palabras de la pregunta', () => {
    const errorsOf = (installments: InstallmentsDraft) => send(NEW, {}, { installments }).errors
    expect(errorsOf({ mode: 'total', total: null, current: null })).toEqual({
      endsOn: 'Poné de cuántas cuotas es y por cuál vas.',
    })
    // Va por la 7 de 6.
    expect(errorsOf({ mode: 'total', total: 6, current: 7 })).toEqual({
      endsOn: 'Vas por una cuota que no existe: revisá los dos números.',
    })
    // Va por la 0 de 6.
    expect(errorsOf({ mode: 'total', total: 6, current: 0 })).toEqual({
      installmentsTotal: 'Vas por una cuota que no existe: revisá los dos números.',
    })
    expect(errorsOf({ mode: 'remaining', remaining: null, total: null })).toEqual({
      endsOn: 'Poné cuántas cuotas faltan (1 o más).',
    })
    expect(send({ ...NEW, name: 'A', accountId: null }).errors).toEqual({
      name: 'Escribí el nombre (por ejemplo, «Alquiler»).',
      accountId: 'Elegí en qué se gasta.',
    })
    expect(
      send(NEW, {}, { lines: [newBreakdownDraft({ label: 'Ana', amountCents: null })] }).errors,
    ).toEqual({ breakdown: 'Cada renglón del detalle necesita a quién corresponde y un monto.' })
  })
})

describe('«¿Qué papel te dan?» escribe los valores de siempre', () => {
  const VALID = new Set<string>(PURCHASE_VOUCHER_OPTIONS.map((option) => option.value))

  it('cada tarjeta es un tipo que ya existía', () => {
    for (const option of PAPER_OPTIONS) {
      expect(VALID.has(voucherTypeForPaper(option.value, null)), option.value).toBe(true)
    }
    expect(voucherTypeForPaper('a', null)).toBe('factura_a')
    expect(voucherTypeForPaper('bc', null)).toBe('factura_c')
    expect(voucherTypeForPaper('ticket', null)).toBe('tique')
    expect(voucherTypeForPaper('none', null)).toBe('sin_comprobante')
  })

  it('«Factura B o C» respeta la que ya estaba guardada', () => {
    expect(voucherTypeForPaper('bc', 'factura_b')).toBe('factura_b')
    expect(voucherTypeForPaper('bc', 'factura_c')).toBe('factura_c')
    expect(voucherTypeForPaper('bc', 'factura_a')).toBe('factura_c')
  })

  it('los 13 tipos de antes (y «no sé») siguen alcanzables, y ninguno más', () => {
    const reachable = new Set([
      ...PAPER_OPTIONS.map((option) => voucherTypeForPaper(option.value, null)),
      // Las dos píldoras de «Factura B o C».
      'factura_b',
      'factura_c',
      ...OTHER_PAPER_OPTIONS.map((option) => option.value),
    ])
    expect([...reachable].sort()).toEqual([...VALID].sort())
    expect(VALID.size).toBe(13)
    // Lo de «Otro papel» no tiene tarjeta propia: al abrir no se marca ninguna.
    for (const option of OTHER_PAPER_OPTIONS) {
      expect(quickVoucherFromType(option.value), option.value).toBeNull()
    }
    expect(OTHER_PAPER_OPTIONS).toHaveLength(8)
  })

  it('la tarjeta que se marca al abrir es la de «Nuevo gasto»', () => {
    expect(quickVoucherFromType('factura_a')).toBe('a')
    expect(quickVoucherFromType('factura_b')).toBe('bc')
    expect(quickVoucherFromType('tique')).toBe('ticket')
    expect(quickVoucherFromType('sin_comprobante')).toBe('none')
    // «No sé o cambia» y «Otro papel»: ninguna tarjeta marcada.
    expect(quickVoucherFromType(null)).toBeNull()
    expect(quickVoucherFromType('recibo_c')).toBeNull()
  })

  it('«IVA de siempre»: los mismos siete valores, y a la vista solo con Factura A', () => {
    expect([...COMMON_VAT_RATES, ...OTHER_VAT_RATES]).toEqual([2100, 1050, 2700, 500, 250, 0])
    expect(paperShowsVat('factura_a')).toBe(true)
    for (const other of ['factura_c', 'tique', 'sin_comprobante', null]) {
      expect(paperShowsVat(other)).toBe(false)
    }
    for (const rate of [...COMMON_VAT_RATES, ...OTHER_VAT_RATES, null]) {
      expect(
        recurringSchema.safeParse({ ...send(NEW).payload, vatRateBp: rate }).success,
        String(rate),
      ).toBe(true)
    }
  })
})

describe('una edición del renglón (la planilla y «Completar»)', () => {
  const ROW: RecurringExpenseRow = {
    id: ID,
    name: 'Alquiler del local',
    partyId: PARTY,
    partyName: 'Inmobiliaria',
    accountId: ACCOUNT,
    accountName: 'Alquiler',
    voucherType: 'factura_c',
    vatRateBp: null,
    amountCents: 85_000_000,
    frequency: 'monthly',
    dueDay: 10,
    nextDueDate: '2026-11-10',
    remindDaysBefore: 5,
    treasuryAccountId: TREASURY,
    treasuryName: 'Banco',
    active: true,
    lastDocumentId: null,
    lastDocumentDate: null,
    notes: null,
    endsOn: '2027-03-10',
    remainingDues: 5,
    installmentsTotal: 6,
    skippedDue: '2026-10-10',
    loadedDue: '2026-09-10',
    ended: false,
    breakdown: [],
    updatedAt: UPDATED,
    monthStatus: 'skipped',
    daysToDue: 28,
  }

  it('son las 15 claves del «Deshacer» de antes, en su orden, y pasan el esquema', () => {
    const payload = recurringEditPayload(ROW)
    expect(Object.keys(payload)).toEqual([
      'id',
      'expectedUpdatedAt',
      'name',
      'partyId',
      'accountId',
      'voucherType',
      'vatRateBp',
      'amountCents',
      'frequency',
      'dueDay',
      'nextDueDate',
      'remindDaysBefore',
      'treasuryAccountId',
      'active',
      'notes',
    ])
    expect(payload).toEqual({
      id: ID,
      expectedUpdatedAt: UPDATED,
      name: 'Alquiler del local',
      partyId: PARTY,
      accountId: ACCOUNT,
      voucherType: 'factura_c',
      vatRateBp: null,
      amountCents: 85_000_000,
      frequency: 'monthly',
      dueDay: 10,
      nextDueDate: '2026-11-10',
      remindDaysBefore: 5,
      treasuryAccountId: TREASURY,
      active: true,
      notes: null,
    })
    expect(recurringSchema.safeParse(payload).success).toBe(true)
  })

  it('nunca manda cuotas ni detalle: la base conserva lo que no se manda', () => {
    for (const patch of [
      {},
      { amountCents: 1 },
      { active: false },
      { nextDueDate: '2026-10-10' },
    ]) {
      const keys = Object.keys(recurringEditPayload(ROW, patch))
      expect(keys).not.toContain('endsOn')
      expect(keys).not.toContain('installmentsTotal')
      expect(keys).not.toContain('breakdown')
    }
  })

  it('la única excepción es la pregunta de cuotas de «Completar», que suma las dos', () => {
    const payload = recurringEditPayload(ROW, {
      name: 'Licuadora USA cord',
      endsOn: '2026-11-10',
      installmentsTotal: 6,
    })
    expect(payload).toMatchObject({
      name: 'Licuadora USA cord',
      endsOn: '2026-11-10',
      installmentsTotal: 6,
    })
    expect(Object.keys(payload)).toHaveLength(17)
    expect(recurringSchema.safeParse(payload).success).toBe(true)
  })

  it('cambiar el día queda en el mismo mes del próximo vencimiento', () => {
    expect(dueDayPatch(ROW, 5)).toEqual({ dueDay: 5, nextDueDate: '2026-11-05' })
    // Un mes corto recorta el día.
    expect(dueDayPatch(ROW, 31)).toEqual({ dueDay: 31, nextDueDate: '2026-11-30' })
    expect(dueDayPatch({ nextDueDate: '2027-02-10' }, 30)).toEqual({
      dueDay: 30,
      nextDueDate: '2027-02-28',
    })
    expect(dueDayPatch(ROW, 0).dueDay).toBe(1)
  })

  it('monto y día: solo se manda lo que cambió; si nada cambió, no se llama', () => {
    expect(quickEditPatch(ROW, { amountCents: 85_000_000, dueDay: 10 })).toBeNull()
    // El día vacío mientras se escribe no cambia nada.
    expect(quickEditPatch(ROW, { amountCents: 85_000_000, dueDay: null })).toBeNull()
    expect(quickEditPatch(ROW, { amountCents: 90_000_000, dueDay: 10 })).toEqual({
      amountCents: 90_000_000,
    })
    // Borrar el monto vuelve a «sin monto».
    expect(quickEditPatch(ROW, { amountCents: null, dueDay: 10 })).toEqual({ amountCents: null })
    expect(quickEditPatch(ROW, { amountCents: 90_000_000, dueDay: 5 })).toEqual({
      amountCents: 90_000_000,
      dueDay: 5,
      nextDueDate: '2026-11-05',
    })
    const cleared = recurringEditPayload(ROW, { amountCents: null })
    expect(cleared.amountCents).toBeNull()
    expect(recurringSchema.parse(cleared).amountCents).toBeNull()
  })

  it('con detalle (los sueldos) no se manda otro monto', () => {
    const detailed = {
      ...ROW,
      breakdown: [{ label: 'Ana', kind: null, amountCents: 85_000_000 }],
    }
    expect(quickEditPatch(detailed, { amountCents: 1, dueDay: 10 })).toBeNull()
    expect(recurringEditPayload(detailed, { amountCents: 1 }).amountCents).toBe(85_000_000)
  })

  it('los gestos del renglón usan valores que la ficha ya permitía', () => {
    // «Sí se paga este mes»: vuelve al vencimiento salteado.
    expect(recurringEditPayload(ROW, { nextDueDate: '2026-10-10', active: true })).toMatchObject({
      nextDueDate: '2026-10-10',
      active: true,
      dueDay: 10,
    })
    // «Volver a dejarlo pendiente»: el vencimiento que cubría el pago anulado.
    expect(recurringEditPayload(ROW, { nextDueDate: '2026-09-10', active: true })).toMatchObject({
      nextDueDate: '2026-09-10',
    })
    // «Sí, dejar $ X»: lo pagado pasa a ser el monto.
    expect(recurringEditPayload(ROW, { amountCents: 80_000_000 }).amountCents).toBe(80_000_000)
    // Pausar y reanudar.
    expect(recurringEditPayload(ROW, { active: false }).active).toBe(false)
    for (const patch of [
      { nextDueDate: '2026-10-10', active: true },
      { amountCents: 80_000_000 },
      { active: false },
      { accountId: ACCOUNT },
    ]) {
      expect(recurringSchema.safeParse(recurringEditPayload(ROW, patch)).success).toBe(true)
    }
  })
})

describe('«Pegar una lista» manda lo de siempre', () => {
  it('un ítem por gasto fijo, todos con el mismo día y el mismo vencimiento', () => {
    const items = recurringBulkItems(
      [
        { name: 'Alquiler', accountId: ACCOUNT },
        { name: 'Luz', accountId: ACCOUNT },
      ],
      10,
      '2026-11-10',
    )
    expect(items).toEqual([
      { name: 'Alquiler', accountId: ACCOUNT, dueDay: 10, nextDueDate: '2026-11-10' },
      { name: 'Luz', accountId: ACCOUNT, dueDay: 10, nextDueDate: '2026-11-10' },
    ])
    expect(recurringBulkSchema.safeParse({ items }).success).toBe(true)
    expect(new Set(items.map((item) => item.dueDay)).size).toBe(1)
  })

  it('lo típico de un bar entra entero en una sola carga', () => {
    const items = recurringBulkItems(
      TYPICAL_RECURRING.map((name) => ({ name, accountId: ACCOUNT })),
      10,
      '2026-11-10',
    )
    expect(items).toHaveLength(16)
    expect(recurringBulkSchema.safeParse({ items }).success).toBe(true)
    expect(new Set(TYPICAL_RECURRING).size).toBe(TYPICAL_RECURRING.length)
  })
})
