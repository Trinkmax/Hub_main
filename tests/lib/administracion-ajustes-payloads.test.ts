import { describe, expect, it } from 'vitest'
import {
  methodDraftOf,
  methodPartyFits,
  methodRowPayload,
  methodSavePayload,
  partyDraftOf,
  partySavePayload,
  type SystemPartyRow,
  salesPointDraftOf,
  salesPointSavePayload,
  salesPointTogglePayload,
  treasuryDraftOf,
  treasurySavePayload,
  treasuryTogglePayload,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/payloads'
import { settingsPayload } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/settings-payload'
import type {
  AccountingSettings,
  SalesMethodRow,
  SalesPointRow,
} from '@/lib/accounting/queries/settings'
import type { TreasuryAccountRow } from '@/lib/accounting/queries/treasury'

/**
 * La red del rediseño de Ajustes (octubre 2026): lo que cada formulario le manda a su acción.
 *
 * Cada caso es un DORADO escrito contra el código de antes del rediseño (los `save`, `toggle` y
 * `move` que cada panel armaba en línea). Cambió cómo se elige —tarjetas en vez de desplegables,
 * la comisión como píldora del medio, «Cambiar el orden»—, no lo que viaja: mismas claves, mismos
 * valores y los mismos valores por defecto si la persona no toca nada. Si uno de estos se rompe,
 * un formulario dejó de mandar lo mismo.
 */

const STAMP = '2026-10-12T15:00:00.000+00:00'

function treasury(over: Partial<TreasuryAccountRow> = {}): TreasuryAccountRow {
  return {
    id: 'caja-1',
    accountId: 'cuenta-1',
    accountCode: '1.1.01.02',
    name: 'Banco Nación · cuenta corriente',
    kind: 'bank',
    bankPartyId: 'banco-1',
    bankName: 'Banco de la Nación Argentina',
    cbuCvu: '0110599520000001234567',
    alias: 'hub.sas.bna',
    accountNumber: '599-123456/7',
    allowNegative: true,
    lastCheckedOn: null,
    sort: 30,
    active: true,
    systemKey: null,
    updatedAt: STAMP,
    ...over,
  }
}

function method(over: Partial<SalesMethodRow> = {}): SalesMethodRow {
  return {
    id: 'medio-1',
    name: 'Crédito',
    kind: 'receivable',
    channel: 'salon',
    treasuryAccountId: null,
    treasuryName: null,
    partyId: 'posnet-credito',
    partyName: 'Tarjetas de crédito (Posnet)',
    settlementDays: 10,
    sort: 50,
    active: true,
    systemKey: 'credit',
    updatedAt: STAMP,
    ...over,
  }
}

function party(over: Partial<SystemPartyRow> = {}): SystemPartyRow {
  return {
    id: 'mp',
    name: 'Mercado Pago',
    kind: 'payment_wallet',
    systemKey: 'mercado_pago',
    taxId: '30703088534',
    active: true,
    commissionVatMode: 'per_settlement',
    rates: {
      commissionBp: 150,
      iibbWithholdingBp: null,
      vatWithholdingBp: null,
      incomeTaxWithholdingBp: null,
      sircupaBp: 350,
    },
    updatedAt: STAMP,
    ...over,
  }
}

function point(over: Partial<SalesPointRow> = {}): SalesPointRow {
  return {
    id: 'pv-1',
    number: 3,
    label: 'Salón',
    defaultChannel: 'salon',
    active: true,
    updatedAt: STAMP,
    ...over,
  }
}

describe('Cajas y cuentas · saveTreasuryAccount', () => {
  it('el alta sin tocar nada: un banco, con «sumarlo como proveedor» prendido', () => {
    const draft = treasuryDraftOf(null)
    expect(draft.kind).toBe('bank')
    expect(treasurySavePayload({ ...draft, name: 'Banco Galicia' })).toEqual({
      name: 'Banco Galicia',
      kind: 'bank',
      bankName: null,
      accountNumber: null,
      cbuCvu: null,
      alias: null,
      allowNegative: false,
      createBankParty: true,
    })
  })

  it('alta de un banco completo: recorta los espacios y manda cada dato', () => {
    expect(
      treasurySavePayload({
        ...treasuryDraftOf(null),
        name: 'Banco Nación',
        bankName: '  Banco de la Nación Argentina ',
        accountNumber: ' 599-1 ',
        cbuCvu: ' 0110599520000001234567 ',
        alias: ' hub.sas ',
        allowNegative: true,
        createBankParty: false,
      }),
    ).toEqual({
      name: 'Banco Nación',
      kind: 'bank',
      bankName: 'Banco de la Nación Argentina',
      accountNumber: '599-1',
      cbuCvu: '0110599520000001234567',
      alias: 'hub.sas',
      allowNegative: true,
      createBankParty: false,
    })
  })

  it('alta de efectivo: nunca queda en negativo y no lleva datos de banco', () => {
    expect(
      treasurySavePayload({
        ...treasuryDraftOf(null),
        name: 'Caja chica',
        kind: 'cash',
        bankName: 'Banco X',
        cbuCvu: '123',
        alias: 'x.y',
        accountNumber: '9',
        allowNegative: true,
      }),
    ).toEqual({
      name: 'Caja chica',
      kind: 'cash',
      bankName: null,
      accountNumber: null,
      cbuCvu: null,
      alias: null,
      allowNegative: false,
      createBankParty: false,
    })
  })

  it('alta de una billetera: CVU y alias, sin banco ni número de cuenta', () => {
    expect(
      treasurySavePayload({
        ...treasuryDraftOf(null),
        name: 'Ualá',
        kind: 'wallet',
        bankName: 'no va',
        accountNumber: 'no va',
        cbuCvu: '0000003100012345678901',
        alias: 'hub.uala',
      }),
    ).toEqual({
      name: 'Ualá',
      kind: 'wallet',
      bankName: null,
      accountNumber: null,
      cbuCvu: '0000003100012345678901',
      alias: 'hub.uala',
      allowNegative: false,
      createBankParty: false,
    })
  })

  it('alta de la tarjeta de la empresa: el banco que la emite y nada más', () => {
    expect(
      treasurySavePayload({
        ...treasuryDraftOf(null),
        name: 'Visa de la empresa',
        kind: 'credit_card',
        bankName: 'Banco Galicia',
        cbuCvu: 'no va',
        alias: 'no va',
        accountNumber: 'no va',
      }),
    ).toEqual({
      name: 'Visa de la empresa',
      kind: 'credit_card',
      bankName: 'Banco Galicia',
      accountNumber: null,
      cbuCvu: null,
      alias: null,
      allowNegative: false,
      createBankParty: false,
    })
  })

  it('«otra»: sin datos de banco; puede quedar en negativo si se marca', () => {
    expect(
      treasurySavePayload({
        ...treasuryDraftOf(null),
        name: 'Fondo fijo',
        kind: 'other',
        allowNegative: true,
      }),
    ).toEqual({
      name: 'Fondo fijo',
      kind: 'other',
      bankName: null,
      accountNumber: null,
      cbuCvu: null,
      alias: null,
      allowNegative: true,
      createBankParty: false,
    })
  })

  it('la edición manda `id` y `expectedUpdatedAt`, y nunca `createBankParty`', () => {
    const payload = treasurySavePayload(treasuryDraftOf(treasury()))
    expect(payload).toEqual({
      id: 'caja-1',
      expectedUpdatedAt: STAMP,
      name: 'Banco Nación · cuenta corriente',
      kind: 'bank',
      bankName: 'Banco de la Nación Argentina',
      accountNumber: '599-123456/7',
      cbuCvu: '0110599520000001234567',
      alias: 'hub.sas.bna',
      allowNegative: true,
    })
    expect('createBankParty' in payload).toBe(false)
  })

  it('el interruptor «En uso» manda solo lo de siempre', () => {
    expect(treasuryTogglePayload(treasury(), false)).toEqual({
      id: 'caja-1',
      expectedUpdatedAt: STAMP,
      name: 'Banco Nación · cuenta corriente',
      kind: 'bank',
      active: false,
    })
  })
})

describe('Medios de cobro · saveSalesMethod', () => {
  it('el alta sin tocar nada: entra entero a una caja, canal salón, prendido', () => {
    expect(methodSavePayload({ ...methodDraftOf(null), name: 'Efectivo barra' })).toEqual({
      name: 'Efectivo barra',
      kind: 'treasury',
      channel: 'salon',
      treasuryAccountId: null,
      partyId: null,
      settlementDays: '0',
      active: true,
    })
  })

  it('«entra entero a una caja»: la caja viaja; quien paga y los días, no', () => {
    expect(
      methodSavePayload({
        ...methodDraftOf(null),
        name: 'Efectivo',
        kind: 'treasury',
        treasuryId: 'caja',
        partyId: 'no-va',
        days: '7',
      }),
    ).toEqual({
      name: 'Efectivo',
      kind: 'treasury',
      channel: 'salon',
      treasuryAccountId: 'caja',
      partyId: null,
      settlementDays: '0',
      active: true,
    })
  })

  it('«entra a la billetera, con descuentos»: la caja y la billetera', () => {
    expect(
      methodSavePayload({
        ...methodDraftOf(null),
        name: 'QR',
        kind: 'settled_now',
        treasuryId: 'billetera',
        partyId: 'mp',
        days: '3',
      }),
    ).toMatchObject({
      kind: 'settled_now',
      treasuryAccountId: 'billetera',
      partyId: 'mp',
      settlementDays: '0',
    })
  })

  it('«te lo pagan después»: quién paga y los días (como texto); la caja, no', () => {
    expect(
      methodSavePayload({
        ...methodDraftOf(null),
        name: 'PedidosYa',
        kind: 'receivable',
        channel: 'delivery',
        treasuryId: 'no-va',
        partyId: 'pedidosya',
        days: '14',
      }),
    ).toEqual({
      name: 'PedidosYa',
      kind: 'receivable',
      channel: 'delivery',
      treasuryAccountId: null,
      partyId: 'pedidosya',
      settlementDays: '14',
      active: true,
    })
  })

  it('cuenta corriente y seña: sin caja; la seña lleva su partícipe', () => {
    expect(
      methodSavePayload({
        ...methodDraftOf(null),
        name: 'Cuenta corriente',
        kind: 'customer_account',
        channel: 'events',
        treasuryId: 'x',
        partyId: 'y',
      }),
    ).toMatchObject({ treasuryAccountId: null, partyId: null, settlementDays: '0' })
    expect(
      methodSavePayload({
        ...methodDraftOf(null),
        name: 'Seña aplicada',
        kind: 'advance',
        treasuryId: 'x',
        partyId: 'senas',
      }),
    ).toMatchObject({ treasuryAccountId: null, partyId: 'senas', settlementDays: '0' })
  })

  it('la edición suma `id` y `expectedUpdatedAt` adelante, y no manda `sort`', () => {
    const payload = methodSavePayload(methodDraftOf(method()))
    expect(payload).toEqual({
      id: 'medio-1',
      expectedUpdatedAt: STAMP,
      name: 'Crédito',
      kind: 'receivable',
      channel: 'salon',
      treasuryAccountId: null,
      partyId: 'posnet-credito',
      settlementDays: '10',
      active: true,
    })
    expect('sort' in payload).toBe(false)
  })

  it('prender o apagar: el medio tal cual está guardado, con `active` encima', () => {
    expect(methodRowPayload(method(), { active: false })).toEqual({
      id: 'medio-1',
      expectedUpdatedAt: STAMP,
      name: 'Crédito',
      kind: 'receivable',
      channel: 'salon',
      treasuryAccountId: null,
      partyId: 'posnet-credito',
      settlementDays: 10,
      active: false,
      sort: 50,
    })
  })

  it('mover: el mismo envío, con `sort` encima (es lo que manda «Guardar el orden»)', () => {
    expect(methodRowPayload(method(), { sort: 20 })).toEqual({
      id: 'medio-1',
      expectedUpdatedAt: STAMP,
      name: 'Crédito',
      kind: 'receivable',
      channel: 'salon',
      treasuryAccountId: null,
      partyId: 'posnet-credito',
      settlementDays: 10,
      active: true,
      sort: 20,
    })
  })

  it('quién puede pagar cada tipo de medio', () => {
    const wallet = { kind: 'payment_wallet' as const, systemKey: 'mercado_pago' }
    const cards = { kind: 'card_processor' as const, systemKey: 'posnet_debito' }
    const app = { kind: 'delivery_platform' as const, systemKey: 'rappi' }
    const senas = { kind: 'customer' as const, systemKey: 'senas' }
    expect(methodPartyFits('settled_now', wallet)).toBe(true)
    expect(methodPartyFits('settled_now', cards)).toBe(false)
    for (const p of [wallet, cards, app]) expect(methodPartyFits('receivable', p)).toBe(true)
    expect(methodPartyFits('receivable', senas)).toBe(false)
    expect(methodPartyFits('advance', senas)).toBe(true)
    expect(methodPartyFits('advance', wallet)).toBe(false)
    expect(methodPartyFits('treasury', wallet)).toBe(false)
    expect(methodPartyFits('customer_account', senas)).toBe(false)
  })
})

describe('Tarjetas, apps, bancos y organismos · saveParty', () => {
  it('una billetera: CUIT, las cinco tasas (vacío = null) y cómo factura la comisión', () => {
    const result = partySavePayload(partyDraftOf(party()))
    expect(result).toEqual({
      ok: true,
      payload: {
        id: 'mp',
        expectedUpdatedAt: STAMP,
        kind: 'payment_wallet',
        name: 'Mercado Pago',
        taxIdType: 'cuit',
        taxId: '30703088534',
        commissionBp: 150,
        iibbWithholdingBp: null,
        vatWithholdingBp: null,
        incomeTaxWithholdingBp: null,
        sircupaBp: 350,
        commissionVatMode: 'per_settlement',
      },
    })
  })

  it('una tarjeta no manda SIRCUPA (es solo de las billeteras) ni `active`', () => {
    const draft = partyDraftOf(
      party({
        id: 'posnet',
        name: 'Tarjetas de crédito (Posnet)',
        kind: 'card_processor',
        systemKey: 'posnet_credito',
        taxId: null,
        commissionVatMode: 'monthly_invoice',
      }),
    )
    const result = partySavePayload({
      ...draft,
      rates: { ...draft.rates, commissionBp: '1,8', iibbWithholdingBp: '3' },
    })
    expect(result).toEqual({
      ok: true,
      payload: {
        id: 'posnet',
        expectedUpdatedAt: STAMP,
        kind: 'card_processor',
        name: 'Tarjetas de crédito (Posnet)',
        taxIdType: 'none',
        taxId: null,
        commissionBp: 180,
        iibbWithholdingBp: 300,
        vatWithholdingBp: null,
        incomeTaxWithholdingBp: null,
        commissionVatMode: 'monthly_invoice',
      },
    })
  })

  it('una app de delivery suma su «Trabajamos con esta app» (`active`)', () => {
    const draft = partyDraftOf(
      party({
        id: 'pedix',
        name: 'Pedix',
        kind: 'delivery_platform',
        systemKey: 'pedix',
        taxId: null,
        active: false,
        commissionVatMode: 'none',
        rates: {
          commissionBp: null,
          iibbWithholdingBp: null,
          vatWithholdingBp: null,
          incomeTaxWithholdingBp: null,
          sircupaBp: null,
        },
      }),
    )
    const result = partySavePayload({ ...draft, active: true, cuit: '30-71234567-1' })
    expect(result).toEqual({
      ok: true,
      payload: {
        id: 'pedix',
        expectedUpdatedAt: STAMP,
        kind: 'delivery_platform',
        name: 'Pedix',
        taxIdType: 'cuit',
        taxId: '30712345671',
        commissionBp: null,
        iibbWithholdingBp: null,
        vatWithholdingBp: null,
        incomeTaxWithholdingBp: null,
        commissionVatMode: 'none',
        active: true,
      },
    })
  })

  it('un organismo (no cobra): solo la CUIT, sin tasas ni forma de facturar', () => {
    const draft = partyDraftOf(
      party({
        id: 'arca',
        name: 'ARCA',
        kind: 'tax_agency',
        systemKey: 'arca',
        taxId: null,
        commissionVatMode: 'none',
      }),
    )
    // Lo que hubiera en las tasas no viaja ni se valida.
    const result = partySavePayload({
      ...draft,
      cuit: '33693450239',
      rates: { ...draft.rates, commissionBp: 'no es un número' },
    })
    expect(result).toEqual({
      ok: true,
      payload: {
        id: 'arca',
        expectedUpdatedAt: STAMP,
        kind: 'tax_agency',
        name: 'ARCA',
        taxIdType: 'cuit',
        taxId: '33693450239',
      },
    })
  })

  it('una CUIT o un porcentaje que no se leen: no viaja nada y cada error va a su campo', () => {
    const draft = partyDraftOf(party())
    const result = partySavePayload({
      ...draft,
      cuit: '30-1',
      rates: { ...draft.rates, commissionBp: 'mucho', sircupaBp: '-3' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.errors).sort()).toEqual(['commissionBp', 'sircupaBp', 'taxId'])
    expect(result.errors.taxId).toBe('El CUIT tiene 11 números.')
    expect(result.errors.commissionBp).toBe('Escribí un porcentaje, por ejemplo 1,5.')
    expect(result.errors.sircupaBp).toBe('El porcentaje va sin signo menos.')
  })
})

describe('Puntos de venta · saveSalesPoint', () => {
  it('el alta: el número como se escribió y, sin nombre, «Punto de venta N»', () => {
    expect(salesPointSavePayload({ ...salesPointDraftOf(null), number: '0003' })).toEqual({
      number: '0003',
      label: 'Punto de venta 3',
      defaultChannel: 'salon',
    })
  })

  it('el alta sin número no inventa un nombre (lo marca el servidor)', () => {
    expect(salesPointSavePayload(salesPointDraftOf(null))).toEqual({
      number: '',
      label: '',
      defaultChannel: 'salon',
    })
  })

  it('la edición manda `id` y `expectedUpdatedAt` y recorta el nombre', () => {
    expect(
      salesPointSavePayload({
        ...salesPointDraftOf(point()),
        label: '  Delivery  ',
        channel: 'delivery',
      }),
    ).toEqual({
      id: 'pv-1',
      expectedUpdatedAt: STAMP,
      number: '3',
      label: 'Delivery',
      defaultChannel: 'delivery',
    })
  })

  it('el interruptor: lo guardado (el número como número) con `active`', () => {
    expect(salesPointTogglePayload(point(), false)).toEqual({
      id: 'pv-1',
      expectedUpdatedAt: STAMP,
      number: 3,
      label: 'Salón',
      defaultChannel: 'salon',
      active: false,
    })
  })
})

describe('Datos de la SAS y Ejercicio · saveSettings', () => {
  const settings: AccountingSettings = {
    legalName: 'Bar de Prueba SAS',
    cuit: null,
    ivaCondition: 'responsable_inscripto',
    iibbRegime: 'local',
    iibbNumber: null,
    iibbJurisdictionCode: 0,
    activityStartDate: null,
    fiscalAddress: null,
    booksStartDate: '2026-10-12',
    fiscalYearEndMonth: 12,
    ivaSettlementMode: 'on_close',
    ivaDueDay: 20,
    iibbDueDay: 15,
    vatToleranceCents: 100,
    bankTaxCreditComputableBp: 3300,
    bankTaxDebitComputableBp: 3300,
    uninvoicedSalesMode: 'separate_accounts',
    closedPeriodVoidIvaMode: 'adjustment_only',
    dueSoonDays: 7,
    openingStatus: 'pending',
    setupCompletedAt: STAMP,
    updatedAt: STAMP,
    hasDocuments: true,
    hasClosedPeriods: false,
  }

  /** Las veinte claves que recibe la acción (las nueve de cada formulario pisan las de ahí). */
  const ALL_KEYS = [
    'bankTaxCreditComputableBp',
    'bankTaxDebitComputableBp',
    'booksStartDate',
    'closedPeriodVoidIvaMode',
    'cuit',
    'dueSoonDays',
    'expectedUpdatedAt',
    'fiscalAddress',
    'fiscalYearEndMonth',
    'iibbDueDay',
    'iibbJurisdictionCode',
    'iibbNumber',
    'iibbRegime',
    'ivaCondition',
    'ivaDueDay',
    'ivaSettlementMode',
    'legalName',
    'uninvoicedSalesMode',
    'vatToleranceCents',
    'activityStartDate',
  ].sort()

  it('Datos de la SAS: las nueve claves del formulario encima de lo guardado', () => {
    const payload = settingsPayload(settings, {
      legalName: 'Bar de Prueba SAS',
      cuit: '30712345671',
      ivaCondition: settings.ivaCondition,
      iibbRegime: 'convenio_multilateral',
      iibbNumber: '904-123456-7',
      activityStartDate: '2024-03-01',
      fiscalAddress: 'Av. Siempre Viva 742',
      booksStartDate: settings.booksStartDate,
      fiscalYearEndMonth: settings.fiscalYearEndMonth,
    })
    expect(Object.keys(payload).sort()).toEqual(ALL_KEYS)
    expect(payload).toMatchObject({
      expectedUpdatedAt: STAMP,
      cuit: '30712345671',
      iibbRegime: 'convenio_multilateral',
      iibbNumber: '904-123456-7',
      activityStartDate: '2024-03-01',
      fiscalAddress: 'Av. Siempre Viva 742',
      booksStartDate: '2026-10-12',
      fiscalYearEndMonth: 12,
      // Lo que ese formulario no muestra viaja como está guardado.
      iibbJurisdictionCode: 904,
      dueSoonDays: 7,
      ivaDueDay: 20,
      uninvoicedSalesMode: 'separate_accounts',
    })
  })

  it('Ejercicio: sus nueve claves, y los datos de la SAS como están', () => {
    const payload = settingsPayload(settings, {
      ivaSettlementMode: 'manual',
      vatToleranceCents: 50,
      bankTaxCreditComputableBp: 10_000,
      bankTaxDebitComputableBp: 3300,
      uninvoicedSalesMode: 'single_account',
      closedPeriodVoidIvaMode: 'negative_row',
      dueSoonDays: '5',
      ivaDueDay: '18',
      iibbDueDay: '15',
    })
    expect(Object.keys(payload).sort()).toEqual(ALL_KEYS)
    expect(payload).toMatchObject({
      expectedUpdatedAt: STAMP,
      legalName: 'Bar de Prueba SAS',
      cuit: null,
      booksStartDate: '2026-10-12',
      ivaSettlementMode: 'manual',
      vatToleranceCents: 50,
      bankTaxCreditComputableBp: 10_000,
      uninvoicedSalesMode: 'single_account',
      closedPeriodVoidIvaMode: 'negative_row',
      dueSoonDays: '5',
      ivaDueDay: '18',
      iibbDueDay: '15',
    })
  })
})
