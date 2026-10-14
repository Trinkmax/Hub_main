import { describe, expect, it } from 'vitest'
import {
  type AccessFacts,
  accessCounts,
  arcaTileState,
  type MethodFacts,
  methodsWithoutCommission,
  methodsWithPartyOff,
  type PartyFacts,
  sasMissingFields,
  TILE_ORDER,
  TILE_UNKNOWN,
  type TileState,
  type TreasuryFacts,
  tileAccess,
  tileArca,
  tileArcaOf,
  tileMethods,
  tileSalesPoints,
  tileSas,
  tileTreasuries,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/portada'
import type { PartyRates } from '@/lib/accounting/types'

/**
 * La portada de Ajustes: qué dice cada uno de los seis objetos. El caso de base es HUB tal como
 * está hoy (recién arrancado, casi vacío): es lo primero que van a ver los socios.
 */

const NO_RATES: PartyRates = {
  commissionBp: null,
  iibbWithholdingBp: null,
  vatWithholdingBp: null,
  incomeTaxWithholdingBp: null,
  sircupaBp: null,
}
const rates = (commissionBp: number): PartyRates => ({ ...NO_RATES, commissionBp })

function people(inCount: number, admins: number, out: number, accountants = 0): AccessFacts {
  return {
    active: Array.from({ length: inCount }, (_, i) => ({ isAdmin: i < admins })),
    ownersWithoutAccess: Array.from({ length: out }, () => ({})),
    accountants: Array.from({ length: accountants }, () => ({})),
    adminCount: admins,
  }
}

const treasury = (over: Partial<TreasuryFacts> & Pick<TreasuryFacts, 'name' | 'kind'>) => ({
  id: over.name,
  active: true,
  cbuCvu: null,
  ...over,
})

// ─── HUB hoy ─────────────────────────────────────────────────────────────────

const HUB_TREASURIES: TreasuryFacts[] = [
  treasury({ name: 'Caja Efectivo', kind: 'cash' }),
  treasury({ name: 'Mercado Pago', kind: 'wallet' }),
]

const HUB_PARTIES: PartyFacts[] = [
  { id: 'mp', name: 'Mercado Pago', active: true, rates: { ...rates(150), sircupaBp: 350 } },
  { id: 'debito', name: 'Tarjetas de débito (Posnet)', active: true, rates: rates(80) },
  { id: 'credito', name: 'Tarjetas de crédito (Posnet)', active: true, rates: rates(629) },
  { id: 'pedidosya', name: 'PedidosYa', active: true, rates: rates(2500) },
  { id: 'rappi', name: 'Rappi', active: true, rates: NO_RATES },
  { id: 'uber', name: 'Uber Eats', active: true, rates: NO_RATES },
  { id: 'mpd', name: 'Mercado Pago Delivery', active: true, rates: NO_RATES },
  { id: 'pedix', name: 'Pedix', active: false, rates: NO_RATES },
]

const method = (
  name: string,
  kind: MethodFacts['kind'],
  partyId: string | null,
  active = true,
): MethodFacts => ({ name, kind, partyId, active })

const HUB_METHODS: MethodFacts[] = [
  method('Efectivo', 'treasury', null),
  method('Transferencia', 'settled_now', 'mp'),
  method('QR Mercado Pago', 'settled_now', 'mp'),
  method('Débito', 'receivable', 'debito'),
  method('Crédito', 'receivable', 'credito'),
  method('PedidosYa', 'receivable', 'pedidosya'),
  method('Rappi', 'receivable', 'rappi'),
  method('Uber Eats', 'receivable', 'uber'),
  method('Mercado Pago Delivery', 'receivable', 'mpd'),
  method('Pedix', 'receivable', 'pedix', false),
  method('Cuenta corriente', 'customer_account', null, false),
  method('Seña aplicada', 'advance', null, false),
]

const HUB_SAS = {
  legalName: 'Bar de Prueba SAS',
  cuit: null,
  iibbNumber: null,
  activityStartDate: null,
  fiscalAddress: 'Av. Siempre Viva 742',
}

describe('la portada con un bar recién arrancado (HUB hoy)', () => {
  it('Accesos: 6 de 18 socios, y un solo socio que da accesos', () => {
    expect(tileAccess(people(6, 1, 12), { showMembers: true })).toEqual({
      sentence: '6 de 18 socios entran a Administración.',
      pill: { tone: 'info', text: 'Un solo socio da accesos' },
    })
  })

  it('Cajas y cuentas: dos lugares con plata y ningún banco', () => {
    expect(tileTreasuries(HUB_TREASURIES)).toEqual({
      sentence: '2 lugares con plata: Caja Efectivo y Mercado Pago.',
      pill: { tone: 'info', text: 'Sin banco cargado' },
    })
  })

  it('Medios de cobro: 9 prendidos, 3 sin comisión', () => {
    expect(tileMethods({ methods: HUB_METHODS, parties: HUB_PARTIES })).toEqual({
      sentence: '9 medios prendidos, en el orden de tu cierre del día.',
      pill: { tone: 'warn', text: '3 sin comisión cargada' },
    })
    expect(methodsWithoutCommission(HUB_METHODS, HUB_PARTIES).map((m) => m.name)).toEqual([
      'Rappi',
      'Uber Eats',
      'Mercado Pago Delivery',
    ])
  })

  it('Datos de la SAS: la razón social, y falta la CUIT (eso sí es un aviso)', () => {
    const tile = tileSas(HUB_SAS, ['cuit', 'iibb_number', 'activity_start_date'])
    expect(tile.sentence).toBe('Bar de Prueba SAS')
    expect(tile.pill).toEqual({ tone: 'warn', text: 'Falta la CUIT' })
    // En el orden del papel: CUIT, domicilio, inicio de actividades, Ingresos Brutos.
    expect(tile.missing).toEqual(['cuit', 'activity_start_date', 'iibb_number'])
  })

  it('Puntos de venta: sin cargar, y dice qué pasa (queda como venta sin factura)', () => {
    expect(tileSalesPoints([])).toEqual({
      first: null,
      sentence: 'Sin cargar: en el cierre, todo el día queda como venta sin factura.',
      pill: { tone: 'info', text: 'Sin cargar' },
    })
  })

  it('ARCA: sin conectar no es un problema (gris), y dice cuánto lleva', () => {
    expect(tileArca(null)).toEqual({
      state: 'not_started',
      sentence: 'Sin conectar. Lleva unos 40 minutos, una sola vez.',
      pill: { tone: 'muted', text: 'Sin conectar' },
    })
  })
})

describe('Accesos', () => {
  it('nadie da accesos: es lo único que va en rojo', () => {
    expect(tileAccess(people(3, 0, 2), { showMembers: true }).pill).toEqual({
      tone: 'late',
      text: 'Nadie da accesos',
    })
  })

  it('con dos que dan accesos, lo que falta es la contadora', () => {
    expect(tileAccess(people(6, 2, 12), { showMembers: true }).pill).toEqual({
      tone: 'info',
      text: 'Sin contadora',
    })
    expect(tileAccess(people(6, 2, 12, 1), { showMembers: true }).pill).toEqual({
      tone: 'ok',
      text: 'Al día',
    })
  })

  it('«Ya están todos» en la guía apaga lo que puede esperar, no lo que rompe', () => {
    expect(tileAccess(people(6, 1, 12), { showMembers: true, manualDone: true }).pill.tone).toBe(
      'ok',
    )
    expect(tileAccess(people(6, 0, 12), { showMembers: true, manualDone: true }).pill.tone).toBe(
      'late',
    )
  })

  it('un bar de un solo socio no reclama «un solo socio da accesos»', () => {
    const tile = tileAccess(people(1, 1, 0, 1), { showMembers: true })
    expect(tile.sentence).toBe('Entra 1 socio a Administración.')
    expect(tile.pill.tone).toBe('ok')
  })

  it('todos adentro, y el singular', () => {
    expect(tileAccess(people(3, 2, 0, 1), { showMembers: true }).sentence).toBe(
      'Los 3 socios entran a Administración.',
    )
    expect(tileAccess(people(1, 1, 4, 1), { showMembers: true }).sentence).toBe(
      '1 de 5 socios entra a Administración.',
    )
  })

  it('la contadora no ve la lista de socios: se cuenta a quienes entran', () => {
    const tile = tileAccess(people(6, 2, 0), { showMembers: false })
    expect(tile.sentence).toBe('6 personas entran.')
    // No se le reclama una contadora a la contadora.
    expect(tile.pill.tone).toBe('ok')
    expect(tileAccess(people(1, 1, 0), { showMembers: false }).sentence).toBe('1 persona entra.')
  })

  it('las cuentas de las llaves', () => {
    expect(accessCounts(people(6, 1, 12))).toEqual({ inCount: 6, adminCount: 1, outCount: 12 })
    // La cuenta de administradores nunca pasa de los que entran.
    expect(accessCounts({ ...people(2, 0, 0), adminCount: 5 }).adminCount).toBe(2)
  })
})

describe('Cajas y cuentas', () => {
  it('con banco sin CBU, y con billetera sin CVU', () => {
    const withBank = [...HUB_TREASURIES, treasury({ name: 'Banco Nación', kind: 'bank' })]
    expect(tileTreasuries(withBank)).toEqual({
      sentence: '3 lugares con plata: Caja Efectivo, Mercado Pago y Banco Nación.',
      pill: { tone: 'info', text: 'Falta el CBU del banco' },
    })
    const withCbu = [
      ...HUB_TREASURIES,
      treasury({ name: 'Banco Nación', kind: 'bank', cbuCvu: '0110599520000001234567' }),
    ]
    expect(tileTreasuries(withCbu).pill).toEqual({
      tone: 'info',
      text: 'Falta el CVU de Mercado Pago',
    })
  })

  it('todo cargado: al día', () => {
    expect(
      tileTreasuries([
        treasury({ name: 'Caja', kind: 'cash' }),
        treasury({ name: 'Mercado Pago', kind: 'wallet', cbuCvu: '0000003100012345678901' }),
        treasury({ name: 'Banco Nación', kind: 'bank', cbuCvu: '0110599520000001234567' }),
      ]).pill,
    ).toEqual({ tone: 'ok', text: 'Al día' })
  })

  it('«Ya cargué las que tengo»: un bar sin banco queda al día', () => {
    expect(tileTreasuries(HUB_TREASURIES, { manualDone: true }).pill.tone).toBe('ok')
  })

  it('las apagadas no cuentan, la tarjeta de la empresa va aparte y muchas se resumen', () => {
    const many = [
      treasury({ name: 'Caja', kind: 'cash' }),
      treasury({ name: 'Caja barra', kind: 'cash' }),
      treasury({ name: 'Mercado Pago', kind: 'wallet', cbuCvu: '1' }),
      treasury({ name: 'Banco Nación', kind: 'bank', cbuCvu: '1' }),
      treasury({ name: 'Visa de la empresa', kind: 'credit_card' }),
      treasury({ name: 'Banco viejo', kind: 'bank', active: false }),
    ]
    expect(tileTreasuries(many).sentence).toBe(
      '4 lugares con plata: Caja, Caja barra y 2 más, y 1 tarjeta de la empresa.',
    )
  })

  it('una sola caja, y ninguna', () => {
    expect(tileTreasuries([treasury({ name: 'Caja', kind: 'cash' })]).sentence).toBe(
      '1 lugar con plata: Caja.',
    )
    expect(tileTreasuries([]).pill.tone).toBe('late')
  })

  it('un nombre de 60 caracteres entra entero en la oración (la tarjeta lo corta a dos renglones)', () => {
    const long = 'Banco de la Nación Argentina · cuenta corriente en pesos 01'
    expect(tileTreasuries([treasury({ name: long, kind: 'bank', cbuCvu: '1' })]).sentence).toBe(
      `1 lugar con plata: ${long}.`,
    )
  })
})

describe('Medios de cobro', () => {
  it('sin ningún medio prendido no se puede cargar el cierre', () => {
    expect(
      tileMethods({ methods: [method('Efectivo', 'treasury', null, false)], parties: [] }).pill,
    ).toEqual({ tone: 'late', text: 'Sin medios: no se puede cargar el cierre' })
    expect(tileMethods({ methods: [], parties: [] }).pill.tone).toBe('late')
  })

  it('una app apagada con su medio prendido avisa antes que la comisión', () => {
    const methods = [...HUB_METHODS, method('Pedix', 'receivable', 'pedix', true)]
    expect(tileMethods({ methods, parties: HUB_PARTIES }).pill).toEqual({
      tone: 'warn',
      text: 'Pedix está apagada y su medio, prendido',
    })
    expect(methodsWithPartyOff(methods, HUB_PARTIES).map((x) => x.method.name)).toEqual(['Pedix'])
  })

  it('todo con comisión: al día, y el singular', () => {
    const parties = HUB_PARTIES.map((p) => ({ ...p, rates: rates(100) }))
    expect(tileMethods({ methods: HUB_METHODS, parties }).pill).toEqual({
      tone: 'ok',
      text: 'Al día',
    })
    expect(
      tileMethods({ methods: [method('Efectivo', 'treasury', null)], parties: [] }).sentence,
    ).toBe('1 medio prendido, en el orden de tu cierre del día.')
  })

  it('una comisión en 0 % está cargada: no es «sin comisión»', () => {
    const parties = HUB_PARTIES.map((p) => ({ ...p, rates: rates(0) }))
    expect(methodsWithoutCommission(HUB_METHODS, parties)).toEqual([])
  })
})

describe('Datos de la SAS', () => {
  const full = {
    legalName: 'Bar de Prueba SAS',
    cuit: '30712345671',
    iibbNumber: '904-1',
    activityStartDate: '2024-03-01',
    fiscalAddress: 'Av. Siempre Viva 742',
  }

  it('completos', () => {
    expect(tileSas(full, []).pill).toEqual({ tone: 'ok', text: 'Completos' })
  })

  it('con la CUIT cargada, lo que falta puede esperar (info, no ámbar)', () => {
    expect(tileSas(full, ['activity_start_date']).pill).toEqual({
      tone: 'info',
      text: 'Falta el inicio de actividades',
    })
    expect(tileSas(full, ['activity_start_date', 'iibb_number']).pill).toEqual({
      tone: 'info',
      text: 'Faltan 2 datos',
    })
  })

  it('sin la guía, se mira lo guardado', () => {
    expect(sasMissingFields({ ...full, fiscalAddress: null, iibbNumber: null }, null)).toEqual([
      'fiscal_address',
      'iibb_number',
    ])
    expect(tileSas({ ...full, cuit: null }).pill.text).toBe('Falta la CUIT')
  })

  it('una razón social de 160 caracteres va entera (la pantalla la corta con «…» y `title`)', () => {
    const long = `${'Sociedad de Hecho de Bares y Afines '.repeat(4)}SAS`.slice(0, 160)
    expect(tileSas({ ...full, legalName: long }, []).sentence).toBe(long)
  })
})

describe('Puntos de venta', () => {
  it('uno, dos y muchos', () => {
    expect(tileSalesPoints([{ number: 3, label: 'Salón', active: true }])).toEqual({
      first: 3,
      sentence: '1 punto de venta: 0003 Salón.',
      pill: { tone: 'ok', text: 'Al día' },
    })
    expect(
      tileSalesPoints([
        { number: 5, label: 'Delivery', active: true },
        { number: 3, label: 'Salón', active: true },
      ]).sentence,
    ).toBe('2 puntos de venta: 0003 Salón y 0005 Delivery.')
    expect(
      tileSalesPoints(
        [1, 2, 3, 4].map((number) => ({ number, label: `PV ${number}`, active: true })),
      ).sentence,
    ).toBe('4 puntos de venta: 0001 PV 1, 0002 PV 2 y 2 más.')
  })

  it('los desactivados no cuentan', () => {
    expect(tileSalesPoints([{ number: 3, label: 'Salón', active: false }]).pill.text).toBe(
      'Sin cargar',
    )
  })
})

describe('ARCA', () => {
  it('los cuatro estados del cable', () => {
    expect(arcaTileState(null)).toBe('not_started')
    expect(arcaTileState('draft')).toBe('not_started')
    expect(arcaTileState('disconnected')).toBe('not_started')
    expect(arcaTileState('key_ready')).toBe('in_progress')
    expect(arcaTileState('cert_ready')).toBe('in_progress')
    expect(arcaTileState('connected')).toBe('connected')
    expect(arcaTileState('error')).toBe('error')
  })

  it('cada estado con su palabra y su tono', () => {
    expect(tileArca({ status: 'cert_ready' }).pill).toEqual({ tone: 'info', text: 'A medias' })
    expect(tileArca({ status: 'connected' }).pill).toEqual({ tone: 'ok', text: 'Conectado' })
    expect(tileArca({ status: 'error' }).pill).toEqual({ tone: 'late', text: 'Con un problema' })
  })

  it('con el estado de la habitación, la portada dice lo mismo que ella', () => {
    // Un paso de la guía marcado y todavía sin conexión: la guía dice «sin fila», la habitación
    // dice «A medio conectar». Vale la habitación.
    expect(tileArca(null).state).toBe('not_started')
    expect(tileArcaOf('in_progress')).toEqual({
      sentence: 'A medio conectar: seguí con la guía donde la dejaste.',
      pill: { tone: 'info', text: 'A medias' },
      state: 'in_progress',
    })
    for (const state of ['not_started', 'in_progress', 'connected', 'error'] as const) {
      expect(tileArcaOf(state).state).toBe(state)
    }
    expect(tileArcaOf('not_started').pill).toEqual(tileArca(null).pill)
  })
})

describe('un dato que no cargó no es cero', () => {
  it('cada objeto dice «—» y «No pudimos cargarlo»', () => {
    const unknown: TileState[] = [
      tileAccess(null, { showMembers: true }),
      tileTreasuries(null),
      tileMethods(null),
      tileSas(null),
      tileSalesPoints(null),
      tileArca(undefined),
    ]
    for (const tile of unknown) {
      expect(tile.sentence).toBe(TILE_UNKNOWN.sentence)
      expect(tile.sentence).toBe('—')
      expect(tile.pill).toEqual({ tone: 'muted', text: 'No pudimos cargarlo' })
    }
  })
})

describe('el vocabulario', () => {
  it('ningún texto dice «ganancia», «en negro» ni «en blanco», y ningún número va suelto', () => {
    const tiles: TileState[] = [
      tileAccess(people(6, 1, 12), { showMembers: true }),
      tileAccess(people(6, 0, 0), { showMembers: false }),
      tileTreasuries(HUB_TREASURIES),
      tileMethods({ methods: HUB_METHODS, parties: HUB_PARTIES }),
      tileSas(HUB_SAS, ['cuit']),
      tileSalesPoints([]),
      tileSalesPoints([{ number: 3, label: 'Salón', active: true }]),
      tileArca(null),
      tileArca({ status: 'error' }),
    ]
    for (const tile of tiles) {
      const text = `${tile.sentence} ${tile.pill.text}`
      expect(text).not.toMatch(/ganancia|ganaste|en negro|en blanco|fuera de los libros/i)
      // Prueba anti «2 6»: dos números nunca quedan pegados sin una palabra en el medio.
      expect(text).not.toMatch(/\d\s+\d/)
    }
  })

  it('la portada tiene seis objetos, en su orden', () => {
    expect(TILE_ORDER).toEqual(['accesos', 'cajas', 'medios', 'sas', 'puntos-de-venta', 'arca'])
  })
})
