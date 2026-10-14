import { describe, expect, it } from 'vitest'
import {
  canSeparate,
  clip,
  closeMoney,
  descriptionExtra,
  documentBadge,
  documentHeading,
  documentHero,
  documentLinks,
  documentPaper,
  documentStamp,
  dueSentence,
  type LinkNode,
  linksTitle,
  paperNote,
  photoHint,
  recurringCandidates,
  richText,
  type StoryContext,
  voidNotes,
} from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/_lib/document-story'
import { closeTicketProps } from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_lib/close-ticket-props'
import { voucherStamp } from '@/components/administracion/voucher-stamp'
import type {
  AllocationDetail,
  DocumentDetail,
  DocumentLink,
  RecurringExpenseRow,
} from '@/lib/accounting/queries/documents'
import { documentKindLabel, lineRoleLabel } from '@/lib/accounting/queries/labels'
import { DOCUMENT_KINDS, type DocumentKind, VOUCHER_TYPE_KEYS } from '@/lib/accounting/types'

/**
 * La ficha de un comprobante, en palabras (`document-story.ts`): qué título
 * lleva, qué dice el número y su oración, qué renglones tiene el papel y con
 * qué sello, qué uniones se dibujan y cuáles «faltan». Los importes y las
 * descripciones son los reales: los dos comprobantes de HUB al 13/10 y los del
 * bar de ejemplo (el cierre #47, el conteo de Mercado Pago #48, la liquidación
 * de tarjetas #60), leídos de la base con `select`.
 */

const TODAY = '2026-10-13'

type Line = DocumentDetail['lines'][number]
type EntryLine = NonNullable<DocumentDetail['entry']>['lines'][number]

let serial = 0
function id(prefix: string): string {
  serial += 1
  return `${prefix}-${serial}`
}

function line(input: Partial<Line> & Pick<Line, 'role' | 'side' | 'amountCents'>): Line {
  const vatRateBp = input.vatRateBp ?? null
  const taxKind = input.taxKind ?? null
  return {
    id: id('renglon'),
    lineNo: 0,
    roleLabel: lineRoleLabel(input.role, { vatRateBp, taxKind }),
    accountId: `cuenta-${input.accountName ?? input.role}`,
    accountCode: '0.0.00.00.000',
    accountName: '',
    partyId: null,
    partyName: null,
    dueDate: null,
    treasuryAccountId: null,
    treasuryName: null,
    salesMethodId: null,
    salesMethodName: null,
    vatRateBp,
    baseCents: null,
    taxKind,
    channel: null,
    certificateNumber: null,
    reference: null,
    memo: null,
    ...input,
  }
}

/** Un renglón de caja: `out` sale (Haber), `in` entra (Debe). */
function treasury(
  name: string,
  amountCents: number,
  direction: 'in' | 'out',
  extra: Partial<Line> = {},
) {
  return line({
    role: 'treasury',
    side: direction === 'in' ? 'debit' : 'credit',
    amountCents,
    accountName: name,
    treasuryAccountId: `caja-${name}`,
    treasuryName: name,
    ...extra,
  })
}

function link(
  input: Partial<DocumentLink> & Pick<DocumentLink, 'seq' | 'title' | 'kind'>,
): DocumentLink {
  return {
    id: `doc-${input.seq}`,
    accountingDate: '2026-10-08',
    totalCents: 0,
    status: 'posted',
    ...input,
  }
}

function allocation(
  input: Partial<AllocationDetail> & Pick<AllocationDetail, 'amountCents'>,
): AllocationDetail {
  return {
    id: id('union'),
    kind: 'payment',
    appliedOn: '2026-10-03',
    voidedOn: null,
    otherDocumentId: 'doc-6',
    otherDocumentTitle: 'Pago',
    otherDocumentSeq: 6,
    createdByName: 'Dueño QA',
    createdAt: '2026-10-03T15:00:00Z',
    ...input,
  }
}

function doc(input: Partial<DocumentDetail> & Pick<DocumentDetail, 'kind'>): DocumentDetail {
  const lines = (input.lines ?? []).map((l, index) => ({ ...l, lineNo: index + 1 }))
  return {
    id: 'doc-1',
    seq: 1,
    bundleId: 'envio-1',
    title: 'Compra',
    voucherType: null,
    afipVoucherCode: null,
    pointOfSale: null,
    number: null,
    partyId: null,
    partyName: null,
    partyDocNumber: null,
    partyIvaCondition: null,
    issueDate: '2026-10-12',
    accountingDate: '2026-10-12',
    dueDate: null,
    shift: null,
    description: '',
    notes: null,
    totalCents: 0,
    countedCents: null,
    expectedBookCents: null,
    settlesCommissions: false,
    recurringExpenseId: null,
    warningsAck: [],
    overrideReason: null,
    status: 'posted',
    voidedAt: null,
    voidedByName: null,
    voidReason: null,
    createdByName: 'Luz',
    createdAt: '2026-10-13T00:04:00Z',
    period: { id: 'periodo-10', month: '2026-10-01', kind: 'month', status: 'open' },
    fiscalVouchers: [],
    entry: null,
    openCents: null,
    paymentStatus: 'none',
    allocations: [],
    bundleSiblings: [],
    related: null,
    replaces: null,
    replacedBy: null,
    reverses: null,
    reversedBy: null,
    corrects: null,
    undoUntil: '2026-10-13T00:14:00Z',
    ...input,
    lines,
  }
}

/** El asiento con sus partidas: lo que falta cobrar o pagar de cada renglón con partícipe. */
function entryOf(
  lines: readonly Line[],
  open: Readonly<Record<number, number>> = {},
): DocumentDetail['entry'] {
  const entryLines: EntryLine[] = lines.map((l, index) => ({
    id: `partida-${index + 1}`,
    lineNo: index + 1,
    accountId: l.accountId,
    accountCode: l.accountCode,
    accountName: l.accountName,
    side: l.side,
    amountCents: l.amountCents,
    partyId: l.partyId,
    partyName: l.partyName,
    dueDate: l.dueDate,
    memo: l.memo,
    openCents: l.partyId ? (open[index + 1] ?? l.amountCents) : null,
  }))
  return {
    id: 'asiento-1',
    documentId: 'doc-1',
    kind: 'standard',
    entryDate: '2026-10-12',
    number: null,
    provisionalNumber: 2,
    description: '',
    totalCents: 0,
    status: 'posted',
    isMirror: false,
    periodId: 'periodo-10',
    periodStatus: 'open',
    createdByName: 'Luz',
    createdAt: '2026-10-13T00:04:00Z',
    voidedAt: null,
    voidedByName: null,
    voidReason: null,
    document: null,
    lines: entryLines,
    debitCents: 0,
    creditCents: 0,
  }
}

const AMOUNTS_ZERO = {
  net_0_cents: 0,
  net_25_cents: 0,
  vat_25_cents: 0,
  net_5_cents: 0,
  vat_5_cents: 0,
  net_105_cents: 0,
  vat_105_cents: 0,
  net_21_cents: 0,
  vat_21_cents: 0,
  net_27_cents: 0,
  vat_27_cents: 0,
  non_taxed_cents: 0,
  undiscriminated_cents: 0,
  exempt_cents: 0,
  perc_iva_cents: 0,
  perc_iibb_cents: 0,
  perc_ganancias_cents: 0,
  perc_municipal_cents: 0,
  internal_taxes_cents: 0,
  other_taxes_cents: 0,
  total_cents: 0,
  vat_computable_cents: 0,
} as const

type Fiscal = DocumentDetail['fiscalVouchers'][number]

function fiscal(
  input: Omit<Partial<Fiscal>, 'amounts'> & { amounts?: Partial<Fiscal['amounts']> } = {},
): Fiscal {
  return {
    id: id('fiscal'),
    book: 'purchases',
    periodMonth: '2026-10-01',
    voucherDate: '2026-10-12',
    voucherType: 'factura_a',
    afipVoucherCode: 1,
    isCreditNote: false,
    isReversal: false,
    pointOfSale: 3,
    numberFrom: 1290,
    numberTo: null,
    counterpartyName: 'Distribuidora del Centro SA',
    counterpartyDocType: 80,
    counterpartyDocNumber: '30712345678',
    counterpartyIvaCondition: 'responsable_inscripto',
    channel: null,
    voided: false,
    ...input,
    amounts: { ...AMOUNTS_ZERO, ...input.amounts },
  }
}

function recurring(
  input: Partial<RecurringExpenseRow> & Pick<RecurringExpenseRow, 'id' | 'name'>,
): RecurringExpenseRow {
  return {
    partyId: null,
    partyName: null,
    accountId: 'cuenta-Alquileres',
    accountName: 'Alquileres',
    voucherType: null,
    vatRateBp: null,
    amountCents: null,
    frequency: 'monthly',
    dueDay: 10,
    nextDueDate: '2026-10-10',
    remindDaysBefore: 3,
    treasuryAccountId: null,
    treasuryName: null,
    active: true,
    lastDocumentId: null,
    lastDocumentDate: null,
    notes: null,
    endsOn: null,
    remainingDues: null,
    installmentsTotal: null,
    skippedDue: null,
    loadedDue: null,
    ended: false,
    breakdown: [],
    updatedAt: '2026-10-01T12:00:00Z',
    monthStatus: 'pending',
    daysToDue: -3,
    ...input,
  }
}

function ctx(input: Partial<StoryContext> = {}): StoryContext {
  return {
    today: TODAY,
    canWrite: true,
    treasuryKinds: new Map([
      ['caja-Caja', 'cash'],
      ['caja-Banco Nación', 'bank'],
      ['caja-Mercado Pago', 'wallet'],
      ['caja-Visa del bar', 'credit_card'],
    ]),
    recurring: undefined,
    candidates: [],
    origin: null,
    attachments: 0,
    ...input,
  }
}

/** Sin el espacio duro que `formatCents` pone entre el «$» y el número. */
function plain(text: string): string {
  return text.replaceAll(' ', ' ')
}

function sentence(d: DocumentDetail, c: StoryContext = ctx()): string {
  return plain(richText(documentHero(d, c).sentence))
}

function node<K extends LinkNode['id']>(nodes: readonly LinkNode[], key: K) {
  return nodes.find((n): n is Extract<LinkNode, { id: K }> => n.id === key)
}

// ─── Los dos comprobantes de HUB al 13/10 ────────────────────────────────────

/** HUB #1: una compra sin factura de $ 120.000, a cuenta corriente, sin pago ni foto. */
function hubSinFactura(): DocumentDetail {
  const lines = [
    line({
      role: 'gross',
      side: 'debit',
      amountCents: 12_000_000,
      accountName: 'Compras: alimentos',
    }),
    line({
      role: 'control',
      side: 'credit',
      amountCents: 12_000_000,
      accountName: 'Proveedores',
      partyId: 'prov-1',
      partyName: 'Verdulería del Mercado',
      dueDate: '2026-10-12',
    }),
  ]
  return doc({
    kind: 'purchase',
    seq: 1,
    title: 'Compra',
    voucherType: 'sin_comprobante',
    partyId: 'prov-1',
    partyName: 'Verdulería del Mercado',
    dueDate: '2026-10-12',
    description: 'Sin comprobante · Verdulería del Mercado',
    totalCents: 12_000_000,
    openCents: 12_000_000,
    paymentStatus: 'unpaid',
    lines,
    entry: entryOf(lines.map((l, i) => ({ ...l, lineNo: i + 1 }))),
  })
}

/** HUB #2: Factura A 0003-00001290 de $ 72.358 (neto $ 59.800 + IVA $ 12.558 a crédito fiscal). */
function hubFacturaA(): DocumentDetail {
  const lines = [
    line({
      role: 'net',
      side: 'debit',
      amountCents: 5_980_000,
      accountName: 'Compras: alimentos',
      vatRateBp: 2100,
    }),
    line({
      role: 'vat',
      side: 'debit',
      amountCents: 1_255_800,
      accountName: 'IVA crédito fiscal',
      vatRateBp: 2100,
      taxKind: 'iva',
    }),
    line({
      role: 'control',
      side: 'credit',
      amountCents: 7_235_800,
      accountName: 'Proveedores',
      partyId: 'prov-2',
      partyName: 'Distribuidora del Centro SA',
      dueDate: '2026-10-12',
    }),
  ]
  return doc({
    id: 'doc-2',
    kind: 'purchase',
    seq: 2,
    title: 'Factura A 0003-00001290',
    voucherType: 'factura_a',
    pointOfSale: 3,
    number: 1290,
    partyId: 'prov-2',
    partyName: 'Distribuidora del Centro SA',
    partyDocNumber: '30712345678',
    dueDate: '2026-10-12',
    description: 'Factura A 0003-00001290 · Distribuidora del Centro SA',
    totalCents: 7_235_800,
    openCents: 7_235_800,
    paymentStatus: 'unpaid',
    lines,
    entry: entryOf(lines.map((l, i) => ({ ...l, lineNo: i + 1 }))),
    fiscalVouchers: [
      fiscal({
        amounts: {
          net_21_cents: 5_980_000,
          vat_21_cents: 1_255_800,
          total_cents: 7_235_800,
          vat_computable_cents: 1_255_800,
        },
      }),
    ],
  })
}

/** El cierre #47 del bar de ejemplo (martes 06/10/2026). */
function cierre47(open: Readonly<Record<number, number>> = {}): DocumentDetail {
  const receivable = (method: string, amountCents: number, party: string, dueDate: string) =>
    line({
      role: 'receivable',
      side: 'debit',
      amountCents,
      accountName: `${party} a cobrar`,
      partyId: `part-${party}`,
      partyName: party,
      dueDate,
      salesMethodId: `medio-${method}`,
      salesMethodName: method,
      memo: method,
    })
  const lines = [
    treasury('Caja', 12_001_300, 'in', {
      salesMethodId: 'medio-Efectivo',
      salesMethodName: 'Efectivo',
      memo: 'Efectivo',
    }),
    receivable('Transferencia', 8_000_900, 'Mercado Pago', '2026-10-06'),
    receivable('QR Mercado Pago', 11_334_600, 'Mercado Pago', '2026-10-06'),
    receivable('Débito', 19_335_400, 'Tarjetas de débito (Posnet)', '2026-10-07'),
    receivable('Crédito', 16_001_720, 'Tarjetas de crédito (Posnet)', '2026-10-16'),
    receivable('PedidosYa', 6_101_900, 'PedidosYa', '2026-10-20'),
    receivable('Rappi', 2_871_460, 'Rappi', '2026-10-20'),
    line({
      role: 'sales_invoiced',
      side: 'credit',
      amountCents: 40_352_000,
      accountName: 'Ventas salón: facturadas',
    }),
    line({
      role: 'sales_uninvoiced',
      side: 'credit',
      amountCents: 17_848_000,
      accountName: 'Ventas salón: sin factura',
    }),
    line({
      role: 'sales_invoiced',
      side: 'credit',
      amountCents: 7_416_000,
      accountName: 'Ventas delivery: facturadas',
    }),
    line({
      role: 'vat',
      side: 'credit',
      amountCents: 10_031_280,
      accountName: 'IVA débito fiscal',
      vatRateBp: 2100,
      taxKind: 'iva',
    }),
  ].map((l, i) => ({ ...l, lineNo: i + 1 }))
  return doc({
    id: 'doc-47',
    kind: 'sales_close',
    seq: 47,
    title: 'Cierre del día',
    issueDate: '2026-10-06',
    accountingDate: '2026-10-06',
    description: 'Cierre del día martes 06/10/2026',
    totalCents: 75_647_280,
    openCents: 0,
    paymentStatus: 'partial',
    lines,
    entry: entryOf(lines, open),
  })
}

/** El cobro #60: la liquidación de tarjetas de débito, con comisión y su IVA. */
function cobroConDescuentos(): DocumentDetail {
  return doc({
    id: 'doc-60',
    kind: 'collection',
    seq: 60,
    title: 'Liquidación de tarjeta o plataforma 0001-00031001',
    voucherType: 'liquidacion',
    partyId: 'part-debito',
    partyName: 'Tarjetas de débito (Posnet)',
    issueDate: '2026-09-08',
    accountingDate: '2026-09-08',
    description: 'Cobro · Tarjetas de débito (Posnet)',
    totalCents: 231_140_700,
    openCents: 0,
    lines: [
      treasury('Banco Nación', 228_903_258, 'in'),
      line({
        role: 'deduction',
        side: 'debit',
        amountCents: 1_849_126,
        accountName: 'Comisiones de tarjetas',
        taxKind: 'comision',
      }),
      line({
        role: 'deduction',
        side: 'debit',
        amountCents: 388_316,
        accountName: 'IVA crédito fiscal',
        taxKind: 'iva_comision',
      }),
      line({
        role: 'control',
        side: 'credit',
        amountCents: 231_140_700,
        accountName: 'Tarjetas de débito a cobrar',
        partyId: 'part-debito',
        partyName: 'Tarjetas de débito (Posnet)',
      }),
    ],
    allocations: [
      allocation({
        amountCents: 231_140_700,
        otherDocumentId: 'doc-12',
        otherDocumentTitle: 'Cierre del día',
        otherDocumentSeq: 12,
      }),
    ],
  })
}

/** Un pago de $ 500.000 desde el banco, unido a una factura. */
function pago(input: Partial<DocumentDetail> = {}): DocumentDetail {
  return doc({
    id: 'doc-6',
    kind: 'payment',
    seq: 6,
    title: 'Pago',
    partyId: 'prov-3',
    partyName: 'Distribuidora de Bebidas Demo SA',
    issueDate: '2026-10-03',
    accountingDate: '2026-10-03',
    description: 'Pago · Distribuidora de Bebidas Demo SA',
    totalCents: 50_000_000,
    openCents: 0,
    lines: [
      line({
        role: 'control',
        side: 'debit',
        amountCents: 50_000_000,
        accountName: 'Proveedores',
        partyId: 'prov-3',
        partyName: 'Distribuidora de Bebidas Demo SA',
      }),
      treasury('Banco Nación', 50_000_000, 'out'),
    ],
    allocations: [
      allocation({
        amountCents: 50_000_000,
        otherDocumentId: 'doc-2',
        otherDocumentTitle: 'Factura A 0003-00001100',
        otherDocumentSeq: 2,
      }),
    ],
    ...input,
  })
}

// ─── ¿Qué es? ────────────────────────────────────────────────────────────────

describe('el título se arma con los datos, nunca con la descripción entera', () => {
  it('rescata solo lo que escribió la persona', () => {
    const gasto = doc({
      kind: 'expense',
      title: 'Gasto',
      voucherType: 'sin_comprobante',
      description: 'Gasto · Hielo',
      lines: [
        line({
          role: 'gross',
          side: 'debit',
          amountCents: 1_200_000,
          accountName: 'Compras: alimentos',
        }),
        treasury('Caja', 1_200_000, 'out'),
      ],
    })
    expect(descriptionExtra(gasto)).toBe('Hielo')
    expect(descriptionExtra(hubSinFactura())).toBeNull()
    expect(
      descriptionExtra(
        pago({ description: 'Pago · Distribuidora de Bebidas Demo SA · Factura A 0002-00000129' }),
      ),
    ).toBeNull()
    expect(descriptionExtra(cierre47())).toBeNull()
  })

  it('«Gasto · Hielo» sigue siendo «Gasto · Hielo», y dice que es sin factura', () => {
    const gasto = doc({
      kind: 'expense',
      seq: 10,
      title: 'Gasto',
      voucherType: 'sin_comprobante',
      issueDate: '2026-10-06',
      description: 'Gasto · Hielo',
      lines: [
        line({
          role: 'gross',
          side: 'debit',
          amountCents: 1_200_000,
          accountName: 'Compras: alimentos',
        }),
        treasury('Caja', 1_200_000, 'out'),
      ],
    })
    const heading = documentHeading(gasto)
    expect(heading.title).toBe('Gasto · Hielo')
    expect(heading.parts.map((p) => p.text)).toEqual(['Sin factura', 'martes 06/10/2026', '#10'])
  })

  it('un gasto sin detalle se titula por su proveedor o por su categoría', () => {
    const lines = [
      line({
        role: 'gross',
        side: 'debit',
        amountCents: 500_000,
        accountName: 'Limpieza e higiene',
      }),
      treasury('Caja', 500_000, 'out'),
    ]
    const sinNadie = doc({
      kind: 'expense',
      title: 'Gasto',
      voucherType: 'sin_comprobante',
      description: 'Remito u otro comprobante (sin factura) · Limpieza e higiene',
      lines,
    })
    expect(documentHeading(sinNadie).title).toBe('Gasto · Limpieza e higiene')
    const conProveedor = doc({
      ...sinNadie,
      partyId: 'prov-9',
      partyName: 'Limpieza Demo SA',
      description:
        'Remito u otro comprobante (sin factura) · Limpieza e higiene · Limpieza Demo SA',
    })
    const heading = documentHeading(conProveedor)
    expect(heading.title).toBe('Gasto · Limpieza Demo SA')
    // El título ya lo nombró: abajo no se repite.
    expect(heading.parts.some((p) => p.key === 'party')).toBe(false)
  })

  it('HUB #1: «Sin comprobante · X» → «Compra a X», con «Sin factura» abajo', () => {
    const heading = documentHeading(hubSinFactura())
    expect(heading.title).toBe('Compra a Verdulería del Mercado')
    expect(heading.parts.map((p) => p.text)).toEqual(['Sin factura', 'lunes 12/10/2026', '#1'])
  })

  it('HUB #2: con número, el número es el título y abajo va qué es y de quién', () => {
    const heading = documentHeading(hubFacturaA())
    expect(heading.title).toBe('Factura A 0003-00001290')
    expect(heading.parts).toEqual([
      { key: 'kind', text: 'Compra' },
      { key: 'party', text: 'Distribuidora del Centro SA', partyId: 'prov-2', side: 'supplier' },
      { key: 'day', text: 'lunes 12/10/2026' },
      { key: 'seq', text: '#2' },
    ])
  })

  it('un conteo de billetera no se llama «Ajuste de saldo»', () => {
    const conteo = doc({
      kind: 'collection',
      seq: 48,
      title: 'Cobro',
      partyId: 'part-mp',
      partyName: 'Mercado Pago',
      description: 'Ajuste de saldo de Mercado Pago · Mercado Pago',
      countedCents: 280_176_698,
      expectedBookCents: 80_000_000,
      totalCents: 209_749_600,
      lines: [treasury('Mercado Pago', 200_176_698, 'in')],
    })
    const heading = documentHeading(conteo)
    expect(heading.title).toBe('Conteo de Mercado Pago')
    // La billetera se llama como quien paga: abajo no se repite.
    expect(heading.parts.map((p) => p.key)).toEqual(['day', 'seq'])
    expect(descriptionExtra(conteo)).toBeNull()
    // Y el papel dice «Conteo», no «Cobro».
    expect(documentPaper(conteo, ctx()).word).toBe('Conteo')
  })

  it('«Otro egreso · Energía eléctrica · Banco Nación» → «Otra salida · Energía eléctrica»', () => {
    const movimiento = doc({
      kind: 'cash_movement',
      seq: 107,
      title: 'Movimiento de caja',
      description: 'Otro egreso · Energía eléctrica · Banco Nación',
      totalCents: 18_640_000,
      lines: [
        line({
          role: 'counterpart',
          side: 'debit',
          amountCents: 18_640_000,
          accountName: 'Energía eléctrica',
          memo: 'DEBAUT SERVICIO LUZ',
        }),
        treasury('Banco Nación', 18_640_000, 'out'),
      ],
    })
    const heading = documentHeading(movimiento)
    expect(heading.title).toBe('Otra salida · Energía eléctrica')
    expect(heading.parts.map((p) => p.key)).toEqual(['day', 'seq'])
    expect(descriptionExtra(movimiento)).toBeNull()
  })

  it('plata que entra por «Otra entrada» conserva el detalle que no es un nombre genérico', () => {
    const rendimiento = doc({
      kind: 'cash_movement',
      title: 'Movimiento de caja',
      description: 'Rendimiento de Mercado Pago · Intereses y rendimientos · Mercado Pago',
      totalCents: 24_318,
      lines: [
        treasury('Mercado Pago', 24_318, 'in'),
        line({
          role: 'counterpart',
          side: 'credit',
          amountCents: 24_318,
          accountName: 'Intereses y rendimientos',
        }),
      ],
    })
    expect(documentHeading(rendimiento).title).toBe('Otra entrada · Intereses y rendimientos')
    expect(descriptionExtra(rendimiento)).toBe('Rendimiento de Mercado Pago')
  })

  it('cada tipo tiene su forma', () => {
    const cases: Array<[Partial<DocumentDetail> & { kind: DocumentKind }, string]> = [
      [
        { kind: 'payment', title: 'Pago', partyName: 'Carnicería Demo SRL' },
        'Pago a Carnicería Demo SRL',
      ],
      [{ kind: 'collection', title: 'Cobro', partyName: 'Rappi' }, 'Cobro de Rappi'],
      [
        { kind: 'purchase_credit_note', title: 'Nota de crédito A', partyName: 'Bebidas SA' },
        'Nota de crédito de Bebidas SA',
      ],
      [
        { kind: 'sales_invoice', title: 'Factura A', partyName: 'Eventos Córdoba Demo SA' },
        'Factura de venta a Eventos Córdoba Demo SA',
      ],
      [
        {
          kind: 'transfer',
          title: 'Movimiento entre cuentas',
          lines: [treasury('Banco Nación', 100, 'in'), treasury('Caja', 100, 'out')],
        },
        'Plata de Caja a Banco Nación',
      ],
      [
        {
          kind: 'bank_expense',
          title: 'Gasto bancario',
          lines: [treasury('Banco Nación', 100, 'out')],
        },
        'Gasto bancario · Banco Nación',
      ],
      [
        {
          kind: 'treasury_adjustment',
          title: 'Ajuste de saldo',
          lines: [treasury('Caja', 100, 'out')],
        },
        'Conteo de Caja',
      ],
      [
        { kind: 'manual', title: 'Asiento manual', description: 'Sueldos de septiembre' },
        'Sueldos de septiembre',
      ],
      [{ kind: 'opening', title: 'Asiento de apertura' }, 'Asiento de apertura'],
    ]
    for (const [input, title] of cases) {
      expect(documentHeading(doc(input)).title).toBe(title)
    }
  })

  it('el cierre lleva el día en el título (y no lo repite abajo)', () => {
    const heading = documentHeading(cierre47())
    expect(heading.title).toBe('Cierre del día martes 06/10/2026')
    expect(heading.parts).toEqual([{ key: 'seq', text: 'Comprobante #47' }])
    expect(documentHeading(doc({ ...cierre47(), shift: 'noche' })).title).toBe(
      'Cierre del día martes 06/10/2026 · turno noche',
    )
  })

  it('una liquidación de tarjeta se titula por lo que es: un cobro, y de quién', () => {
    // Tiene número, pero «Liquidación de tarjeta o plataforma 0001-00031001» no dice de quién es
    // ni que es un cobro, y en el celular eran tres renglones de título.
    const heading = documentHeading(cobroConDescuentos())
    expect(heading.title).toBe('Cobro de Tarjetas de débito (Posnet)')
    expect(heading.parts).toEqual([
      { key: 'paper', text: 'Liquidación 0001-00031001' },
      { key: 'day', text: 'martes 08/09/2026' },
      { key: 'seq', text: '#60' },
    ])
    // Una factura sigue titulándose con su número.
    expect(documentHeading(hubFacturaA()).title).toBe('Factura A 0003-00001290')
  })

  it('un nombre de 60 letras se corta en los rótulos, no en el título', () => {
    const largo = 'Distribuidora Mayorista de Bebidas y Alimentos del Centro SRL'
    expect(largo.length).toBeGreaterThanOrEqual(60)
    const d = doc({ ...hubSinFactura(), partyName: largo })
    expect(documentHeading(d).title).toBe(`Compra a ${largo}`)
    const label = documentHero(d, ctx()).label
    expect(label.length).toBeLessThanOrEqual('Le debés a '.length + 32)
    expect(label.endsWith('…')).toBe(true)
    expect(clip('Caja', 22)).toBe('Caja')
  })
})

// ─── La píldora ──────────────────────────────────────────────────────────────

describe('una píldora de estado, o ninguna', () => {
  it('dice lo mismo que las listas', () => {
    expect(documentBadge(hubFacturaA(), TODAY)).toEqual({
      tone: 'late',
      text: 'Vencida hace 1 día',
    })
    expect(documentBadge({ ...hubFacturaA(), dueDate: TODAY }, TODAY)).toEqual({
      tone: 'warn',
      text: 'Vence hoy',
    })
    expect(documentBadge({ ...hubFacturaA(), dueDate: '2026-10-18' }, TODAY)).toEqual({
      tone: 'warn',
      text: 'Vence en 5 días',
    })
    expect(documentBadge({ ...hubFacturaA(), dueDate: '2026-11-30' }, TODAY)).toEqual({
      tone: 'ok',
      text: 'Al día',
    })
    expect(documentBadge({ ...hubFacturaA(), dueDate: null }, TODAY)).toEqual({
      tone: 'muted',
      text: 'Sin vencimiento',
    })
    expect(documentBadge({ ...hubFacturaA(), paymentStatus: 'paid', openCents: 0 }, TODAY)).toEqual(
      {
        tone: 'ok',
        text: 'Pagada',
      },
    )
  })

  it('lo normal no se anuncia: un pago, un gasto o un cierre no llevan píldora', () => {
    expect(documentBadge(pago(), TODAY)).toBeNull()
    expect(documentBadge(cierre47(), TODAY)).toBeNull()
  })

  it('anulado manda sobre todo lo demás', () => {
    expect(documentBadge({ ...hubFacturaA(), status: 'voided' }, TODAY)).toEqual({
      tone: 'late',
      text: 'Anulado',
    })
    const reversed = link({ seq: 9, title: 'Anulación', kind: 'reversal' })
    expect(documentBadge({ ...hubFacturaA(), reversedBy: reversed }, TODAY)?.text).toBe(
      'Anulado con fecha posterior',
    )
  })
})

describe('el vencimiento, en una frase', () => {
  it('ayer, hoy, mañana, lejos y sin fecha', () => {
    expect(dueSentence('2026-10-12', TODAY)).toBe('venció ayer, el 12/10.')
    expect(dueSentence('2026-10-01', TODAY)).toBe('venció el 01/10, hace 12 días.')
    expect(dueSentence(TODAY, TODAY)).toBe('vence hoy.')
    expect(dueSentence('2026-10-14', TODAY)).toBe('vence mañana, el 14/10.')
    expect(dueSentence('2026-10-21', TODAY)).toBe('vence el 21/10, en 8 días.')
    expect(dueSentence(null, TODAY)).toBe('no tiene vencimiento.')
    expect(dueSentence('2025-12-15', TODAY)).toMatch(/^venció el 15\/12\/2025, hace \d+ días\.$/)
  })
})

// ─── ① Qué pasó con la plata ─────────────────────────────────────────────────

describe('el número, su oración y el botón del momento', () => {
  it('HUB #2, sin ningún pago: lo que debés, por qué, y «Pagar» con el proveedor y la partida', () => {
    const hero = documentHero(hubFacturaA(), ctx())
    expect(hero.label).toBe('Le debés a Distribuidora del Centro SA')
    expect(hero.cents).toBe(7_235_800)
    expect(plain(richText(hero.sentence))).toBe(
      'Todavía no hay ningún pago anotado: venció ayer, el 12/10.',
    )
    // La hoja «Pagar» abre con lo vencido de ese proveedor tildado: la ayuda lo avisa.
    expect(hero.help).toBe(
      '¿Ya lo pagaste? No lo cargues de nuevo: tocá «Pagar» y dejá tildado solo lo que pagaste.',
    )
    expect(hero.action).toEqual({
      action: 'pagar',
      label: 'Pagar',
      params: { proveedor: 'prov-2', partida: 'partida-3' },
    })
    expect(hero.muted).toBe(false)
  })

  it('la contadora ve lo mismo, sin botón ni ayuda', () => {
    const hero = documentHero(hubFacturaA(), ctx({ canWrite: false }))
    expect(hero.label).toBe('Le debés a Distribuidora del Centro SA')
    expect(hero.action).toBeNull()
    expect(hero.help).toBeNull()
  })

  it('si todavía no venció, no pregunta «¿Ya lo pagaste?»', () => {
    const hero = documentHero({ ...hubFacturaA(), dueDate: '2026-10-21' }, ctx())
    expect(hero.help).toBeNull()
    expect(hero.action?.label).toBe('Pagar')
  })

  it('pago parcial: lo que falta, con su cuenta y su avance', () => {
    const d = doc({
      ...hubFacturaA(),
      totalCents: 121_000_000,
      openCents: 71_000_000,
      paymentStatus: 'partial',
      dueDate: '2026-10-01',
      allocations: [allocation({ amountCents: 50_000_000 })],
    })
    const hero = documentHero(d, ctx())
    expect(hero.label).toBe('Te falta pagarle a Distribuidora del Centro SA')
    expect(hero.cents).toBe(71_000_000)
    expect(plain(richText(hero.sentence))).toBe(
      'De $ 1.210.000 ya pagaste $ 500.000: venció el 01/10, hace 12 días.',
    )
    expect(hero.meter).toMatchObject({
      valueCents: 50_000_000,
      totalCents: 121_000_000,
      label: 'Pagado',
    })
    expect(plain(hero.meter?.text ?? '')).toBe('Pagaste el 41 %')
    expect(hero.explain?.rows.map((r) => [r.op ?? '', r.label, r.cents])).toEqual([
      ['', 'Total del papel', 121_000_000],
      ['−', 'Pago #6 del 03/10', 50_000_000],
      ['=', 'Falta pagar', 71_000_000],
    ])
  })

  it('pagada: cuándo fue el último pago, o que se pagó en el momento', () => {
    const paid = doc({
      ...hubFacturaA(),
      openCents: 0,
      paymentStatus: 'paid',
      allocations: [allocation({ amountCents: 7_235_800, appliedOn: '2026-10-13' })],
    })
    const hero = documentHero(paid, ctx())
    expect(hero.label).toBe('Pagada')
    expect(hero.action).toBeNull()
    expect(plain(richText(hero.sentence))).toBe(
      'Ya le pagaste todo a Distribuidora del Centro SA. El último pago fue el 13/10.',
    )
    const enElMomento = doc({
      ...paid,
      bundleSiblings: [link({ seq: 6, title: 'Pago', kind: 'payment' })],
    })
    expect(sentence(enElMomento)).toBe('La pagaste en el momento, con Pago #6.')
  })

  it('un gasto: de dónde salió y en qué', () => {
    const gasto = doc({
      kind: 'expense',
      title: 'Gasto',
      voucherType: 'sin_comprobante',
      issueDate: '2026-10-06',
      description: 'Gasto · Hielo',
      totalCents: 1_200_000,
      lines: [
        line({
          role: 'gross',
          side: 'debit',
          amountCents: 1_200_000,
          accountName: 'Compras: alimentos',
        }),
        treasury('Caja', 1_200_000, 'out'),
      ],
    })
    const hero = documentHero(gasto, ctx())
    expect(hero.label).toBe('Salieron de Caja')
    expect(hero.cents).toBe(1_200_000)
    expect(plain(richText(hero.sentence))).toBe('El 06/10. Quedó en «Compras: alimentos».')
    expect(hero.action).toBeNull()
  })

  it('un gasto con la tarjeta de la empresa no sacó plata de ninguna caja', () => {
    const lines = [
      line({
        role: 'gross',
        side: 'debit',
        amountCents: 900_000,
        accountName: 'Limpieza e higiene',
      }),
      treasury('Visa del bar', 900_000, 'out'),
    ]
    const gasto = doc({
      kind: 'expense',
      title: 'Tique',
      voucherType: 'tique',
      totalCents: 900_000,
      lines,
    })
    const hero = documentHero(gasto, ctx())
    expect(hero.label).toBe('Lo pagaste con Visa del bar')
    expect(sentence(gasto)).toBe('Quedó en la tarjeta: todavía no salió plata de ninguna caja.')
    // Sin saber qué tipo de caja es, se dice lo que se sabe.
    expect(documentHero(gasto, ctx({ treasuryKinds: null })).label).toBe('Salieron de Visa del bar')
  })

  it('una nota de crédito de proveedor: a favor, o ya usada', () => {
    const base = {
      kind: 'purchase_credit_note' as const,
      title: 'Nota de crédito A 0003-00000077',
      voucherType: 'nota_credito_a',
      partyId: 'prov-3',
      partyName: 'Bebidas SA',
      totalCents: 6_050_000,
    }
    const sinUsar = documentHero(doc({ ...base, openCents: 6_050_000 }), ctx())
    expect(sinUsar.label).toBe('A tu favor con Bebidas SA')
    expect(sinUsar.cents).toBe(6_050_000)
    expect(plain(richText(sinUsar.sentence))).toBe(
      'Se descuenta sola en el próximo pago que le hagas.',
    )
    const usada = documentHero(doc({ ...base, openCents: 0 }), ctx())
    expect(usada.label).toBe('Ya se usó')
    expect(plain(richText(usada.sentence))).toBe('Se descontó de lo que le debías a Bebidas SA.')
    // Sin saldo que seguir (un dato que falta no es cero): no se afirma que ya se usó.
    const sinDato = documentHero(doc({ ...base, openCents: null }), ctx())
    expect(sinDato.label).toBe('Nota de crédito de proveedor')
    expect(sinDato.cents).toBe(6_050_000)
    expect(sinDato.sentence).toEqual([])
  })

  it('un pago: todo unido, con resto, o a cuenta', () => {
    const unido = documentHero(pago(), ctx())
    expect(unido.label).toBe('Salieron de Banco Nación')
    expect(unido.cents).toBe(50_000_000)
    expect(plain(richText(unido.sentence))).toBe(
      'Para pagarle a Distribuidora de Bebidas Demo SA la Factura A 0003-00001100 #2.',
    )
    expect(sentence(pago({ openCents: 2_000_000 }))).toBe(
      'Para pagarle a Distribuidora de Bebidas Demo SA. Quedaron $ 20.000 a cuenta: se descuentan de la próxima factura.',
    )
    expect(sentence(pago({ allocations: [], openCents: 50_000_000 }))).toBe(
      'Es un pago a cuenta: todavía no está unido a ninguna factura de Distribuidora de Bebidas Demo SA.',
    )
    const varios = pago({
      allocations: [
        allocation({
          amountCents: 30_000_000,
          otherDocumentId: 'doc-2',
          otherDocumentTitle: 'Factura A 0003-00001100',
        }),
        allocation({
          amountCents: 20_000_000,
          otherDocumentId: 'doc-3',
          otherDocumentTitle: 'Factura A 0003-00001101',
        }),
      ],
    })
    expect(sentence(varios)).toBe('Para pagarle a Distribuidora de Bebidas Demo SA 2 comprobantes.')
    const conSaldo = pago({ lines: pago().lines.filter((l) => l.role !== 'treasury') })
    expect(documentHero(conSaldo, ctx()).label).toBe('Usaste saldo a favor')
  })

  it('el cierre #47: cuánto entró, cuánto quedó en camino, cuánto llegó y cuánto falta', () => {
    // Llegaron el QR y la transferencia (ya se contó Mercado Pago); falta todo lo demás.
    const d = cierre47({ 2: 0, 3: 0 })
    const hero = documentHero(d, ctx())
    expect(hero.label).toBe('Se vendió')
    expect(hero.cents).toBe(75_647_280)
    // Dos importes y sin centavos: cuánto quedó en camino y cuánto llegó lo dice la leyenda.
    expect(plain(richText(hero.sentence))).toBe(
      'Entraron $ 120.013 a Caja. De lo que quedó en camino, todavía no llegaron $ 443.105.',
    )
    expect(hero.split?.map((s) => [s.key, s.label, s.cents, s.hatched ?? false])).toEqual([
      ['cash', 'Entró a Caja', 12_001_300, false],
      ['arrived', 'Ya llegó', 19_335_500, false],
      ['pending', 'Sigue en camino', 44_310_480, true],
    ])
    // «Ya llegó» no usa el azul de «sin factura»: esta barra va al lado del sello del papel.
    expect(hero.split?.map((s) => s.swatch)).toEqual(['bg-adm-s1', 'bg-adm-s6', 'bg-adm-neutral'])
    // La cuenta cierra: vendido − caja − llegó = sigue en camino.
    const rows = hero.explain?.rows ?? []
    expect(rows.map((r) => r.label)).toEqual([
      'Vendido',
      'Entró a Caja',
      'Ya llegó',
      'Sigue en camino',
    ])
    expect((rows[0]?.cents ?? 0) - (rows[1]?.cents ?? 0) - (rows[2]?.cents ?? 0)).toBe(
      rows[3]?.cents,
    )
    expect(hero.action).toEqual({ action: 'cobrar', label: 'Me entró plata', params: {} })
    expect(documentHero(d, ctx({ canWrite: false })).action).toBeNull()
  })

  it('el cierre, cuando ya llegó todo, cuando no llegó nada y cuando fue todo efectivo', () => {
    const todo = cierre47({ 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 })
    expect(sentence(todo)).toBe('Entraron $ 120.013 a Caja. Lo que quedó en camino ya llegó todo.')
    expect(documentHero(todo, ctx()).action).toBeNull()
    expect(sentence(cierre47())).toBe(
      'Entraron $ 120.013 a Caja. Quedaron $ 636.460 en camino y todavía no llegó nada.',
    )
    const efectivo = doc({
      kind: 'sales_close',
      title: 'Cierre del día',
      totalCents: 5_000_000,
      lines: [
        treasury('Caja', 5_000_000, 'in'),
        line({
          role: 'sales_uninvoiced',
          side: 'credit',
          amountCents: 5_000_000,
          accountName: 'Ventas',
        }),
      ],
    })
    const hero = documentHero(efectivo, ctx())
    expect(plain(richText(hero.sentence))).toBe('Entró todo a Caja.')
    expect(hero.split).toBeNull()
    expect(hero.explain).toBeNull()
  })

  it('el cierre con faltante de caja: la cuenta sigue cerrando', () => {
    const d = doc({
      kind: 'sales_close',
      title: 'Cierre del día',
      issueDate: '2026-10-06',
      accountingDate: '2026-10-06',
      totalCents: 10_000_000,
      lines: [
        treasury('Caja', 3_800_000, 'in'),
        line({
          role: 'cash_diff',
          side: 'debit',
          amountCents: 200_000,
          accountName: 'Faltantes de caja',
        }),
        line({
          role: 'receivable',
          side: 'debit',
          amountCents: 6_000_000,
          accountName: 'Tarjetas a cobrar',
          partyId: 'part-debito',
          partyName: 'Posnet',
          dueDate: '2026-10-20',
          salesMethodName: 'Débito',
        }),
        line({
          role: 'sales_uninvoiced',
          side: 'credit',
          amountCents: 10_000_000,
          accountName: 'Ventas',
        }),
      ],
    })
    const money = closeMoney({ ...d, entry: entryOf(d.lines) }, TODAY)
    expect(money).toMatchObject({
      soldCents: 10_000_000,
      cashCents: 3_800_000,
      incomingCents: 6_000_000,
      pendingCents: 6_000_000,
      diffCents: 200_000,
    })
    const hero = documentHero({ ...d, entry: entryOf(d.lines) }, ctx())
    expect(plain(richText(hero.sentence))).toContain('En la caja faltaron $ 2.000.')
    const rows = hero.explain?.rows ?? []
    const result = rows.reduce(
      (sum, r) => (r.op === '=' ? sum : r.op === '−' ? sum - r.cents : sum + r.cents),
      0,
    )
    expect(result).toBe(rows.at(-1)?.cents)
  })

  it('una factura de venta: «Me entró plata» lleva el cliente y la partida', () => {
    const lines = [
      line({
        role: 'control',
        side: 'debit',
        amountCents: 145_200_000,
        accountName: 'Deudores por ventas',
        partyId: 'cli-1',
        partyName: 'Eventos Córdoba Demo SA',
        dueDate: '2026-10-18',
      }),
      line({
        role: 'sales_invoiced',
        side: 'credit',
        amountCents: 120_000_000,
        accountName: 'Ventas eventos: facturadas',
      }),
      line({
        role: 'vat',
        side: 'credit',
        amountCents: 25_200_000,
        accountName: 'IVA débito fiscal',
        vatRateBp: 2100,
        taxKind: 'iva',
      }),
    ]
    const d = doc({
      kind: 'sales_invoice',
      seq: 75,
      title: 'Factura A 0003-00000001',
      voucherType: 'factura_a',
      partyId: 'cli-1',
      partyName: 'Eventos Córdoba Demo SA',
      dueDate: '2026-10-18',
      description: 'Factura A 0003-00000001 · Eventos Córdoba Demo SA · evento corporativo',
      totalCents: 145_200_000,
      openCents: 72_600_000,
      paymentStatus: 'partial',
      lines,
      entry: entryOf(
        lines.map((l, i) => ({ ...l, lineNo: i + 1 })),
        { 1: 72_600_000 },
      ),
      allocations: [
        allocation({
          amountCents: 72_600_000,
          otherDocumentId: 'doc-76',
          otherDocumentTitle: 'Cobro',
          otherDocumentSeq: 76,
          appliedOn: '2026-10-02',
        }),
      ],
    })
    const hero = documentHero(d, ctx())
    expect(hero.label).toBe('Te falta cobrarle a Eventos Córdoba Demo SA')
    expect(plain(richText(hero.sentence))).toBe(
      'De $ 1.452.000 ya cobraste $ 726.000: vence el 18/10, en 5 días.',
    )
    expect(hero.action).toEqual({
      action: 'cobrar',
      label: 'Me entró plata',
      params: { cliente: 'cli-1', partida: 'partida-1' },
    })
    expect(hero.meter?.label).toBe('Cobrado')
    expect(hero.explain?.rows.at(-1)?.label).toBe('Falta cobrar')
    expect(descriptionExtra(d)).toBe('evento corporativo')
    const sinCobrar = documentHero(
      {
        ...d,
        paymentStatus: 'unpaid',
        openCents: 145_200_000,
        dueDate: '2026-10-01',
        allocations: [],
      },
      ctx(),
    )
    expect(sinCobrar.label).toBe('Te debe Eventos Córdoba Demo SA')
    expect(sinCobrar.help).toBe('¿Ya te pagó? Tocá «Me entró plata» y elegí a dónde entró.')
    const cobrada = documentHero({ ...d, paymentStatus: 'paid', openCents: 0 }, ctx())
    expect(cobrada.label).toBe('Cobrada')
    expect(plain(richText(cobrada.sentence))).toBe('Eventos Córdoba Demo SA ya te pagó todo.')
  })

  it('un cobro con descuentos: lo que entró, lo que te liquidaron y cuánto se quedaron', () => {
    const hero = documentHero(cobroConDescuentos(), ctx())
    expect(hero.label).toBe('Entraron a Banco Nación')
    expect(hero.cents).toBe(228_903_258)
    expect(plain(richText(hero.sentence))).toBe(
      'Tarjetas de débito (Posnet) te liquidó $ 2.311.407 y te descontó $ 22.374 (1 %) entre comisión, impuestos y retenciones.',
    )
  })

  it('un cobro sin descuentos, con resto a cuenta', () => {
    const d = doc({
      kind: 'collection',
      title: 'Cobro',
      partyId: 'cli-1',
      partyName: 'Eventos Córdoba Demo SA',
      totalCents: 72_600_000,
      openCents: 600_000,
      lines: [
        treasury('Banco Nación', 72_600_000, 'in'),
        line({
          role: 'control',
          side: 'credit',
          amountCents: 72_600_000,
          accountName: 'Deudores por ventas',
          partyId: 'cli-1',
        }),
      ],
    })
    expect(sentence(d)).toBe(
      'Te pagó Eventos Córdoba Demo SA. $ 6.000 quedaron a cuenta: todavía no están unidos a ninguna venta.',
    )
  })

  it('el conteo de una billetera: la diferencia es lo que entró', () => {
    const conteo = doc({
      kind: 'collection',
      seq: 48,
      title: 'Cobro',
      partyId: 'part-mp',
      partyName: 'Mercado Pago',
      description: 'Ajuste de saldo de Mercado Pago · Mercado Pago',
      countedCents: 280_176_698,
      expectedBookCents: 80_000_000,
      totalCents: 209_749_600,
      openCents: 0,
      lines: [
        treasury('Mercado Pago', 200_176_698, 'in'),
        line({
          role: 'deduction',
          side: 'debit',
          amountCents: 1_844_351,
          accountName: 'Comisiones de Mercado Pago',
          taxKind: 'comision',
        }),
        line({
          role: 'deduction',
          side: 'debit',
          amountCents: 387_314,
          accountName: 'IVA crédito fiscal a documentar',
          taxKind: 'iva_comision',
        }),
        line({
          role: 'deduction',
          side: 'debit',
          amountCents: 3_037_752,
          accountName: 'Recaudaciones IIBB SIRCUPA',
          taxKind: 'sircupa',
        }),
        line({
          role: 'deduction',
          side: 'debit',
          amountCents: 4_303_485,
          accountName: 'Recaudaciones IIBB SIRCUPA',
          taxKind: 'sircupa',
        }),
        line({
          role: 'control',
          side: 'credit',
          amountCents: 209_749_600,
          accountName: 'Mercado Pago a acreditar',
          partyId: 'part-mp',
        }),
      ],
    })
    const hero = documentHero(conteo, ctx())
    expect(hero.label).toBe('Entraron a Mercado Pago')
    expect(hero.cents).toBe(200_176_698)
    expect(plain(richText(hero.sentence))).toBe(
      'Contaste $ 2.801.767 y el sistema decía $ 800.000: la diferencia es lo que entró, ya sin los $ 95.729 que te descontó Mercado Pago.',
    )
    // El papel: lo contado, lo liquidado y cada descuento (los dos de SIRCUPA van sumados).
    const paper = documentPaper(conteo, ctx())
    expect(paper.rows.map((r) => [r.label, r.cents, r.minus ?? false])).toEqual([
      ['Según el sistema había', 80_000_000, false],
      ['Contaste', 280_176_698, false],
      ['Te liquidaron', 209_749_600, false],
      ['Comisión', 1_844_351, true],
      ['IVA de la comisión', 387_314, true],
      ['SIRCUPA', 7_341_237, true],
    ])
    expect(paper.total).toEqual({
      label: 'Entraron a Mercado Pago',
      cents: 200_176_698,
      hint: null,
    })
    // Contado − lo que había = lo que entró.
    expect(280_176_698 - 80_000_000).toBe(paper.total.cents)
  })

  it('mover plata, otra entrada o salida y un conteo que no dio', () => {
    const pase = doc({
      kind: 'transfer',
      title: 'Movimiento entre cuentas',
      totalCents: 165_100_000,
      description: 'Movimiento entre cuentas · Caja → Banco Nación',
      lines: [treasury('Banco Nación', 165_100_000, 'in'), treasury('Caja', 165_100_000, 'out')],
    })
    expect(documentHero(pase, ctx()).label).toBe('Pasaste de Caja a Banco Nación')
    expect(sentence(pase)).toBe('No es gasto ni venta: la plata cambió de lugar.')

    const salida = doc({
      kind: 'cash_movement',
      title: 'Movimiento de caja',
      totalCents: 18_640_000,
      lines: [
        line({
          role: 'counterpart',
          side: 'debit',
          amountCents: 18_640_000,
          accountName: 'Energía eléctrica',
        }),
        treasury('Banco Nación', 18_640_000, 'out'),
      ],
    })
    expect(documentHero(salida, ctx()).label).toBe('Salieron de Banco Nación')
    expect(sentence(salida)).toBe('Energía eléctrica.')

    const conteo = doc({
      kind: 'treasury_adjustment',
      title: 'Ajuste de saldo',
      description: 'Ajuste de saldo · Caja · faltante',
      totalCents: 150_000,
      countedCents: 39_850_000,
      expectedBookCents: 40_000_000,
      lines: [
        line({
          role: 'counterpart',
          side: 'debit',
          amountCents: 150_000,
          accountName: 'Faltantes de caja',
        }),
        treasury('Caja', 150_000, 'out'),
      ],
    })
    const hero = documentHero(conteo, ctx())
    expect(hero.label).toBe('Faltaban en Caja')
    expect(hero.cents).toBe(150_000)
    expect(plain(richText(hero.sentence))).toBe('Contaste $ 398.500 y el sistema decía $ 400.000.')
    expect(descriptionExtra(conteo)).toBeNull()
    expect(documentHero({ ...conteo, countedCents: 40_150_000 }, ctx()).label).toBe(
      'Sobraban en Caja',
    )
  })

  it('un asiento de los libros no se disfraza de otra cosa', () => {
    const apertura = doc({ kind: 'opening', title: 'Asiento de apertura', totalCents: 430_000_000 })
    const hero = documentHero(apertura, ctx())
    expect(hero.label).toBe('Asiento de apertura')
    expect(plain(richText(hero.sentence))).toBe(
      'Es un asiento de los libros: lo arma la contadora o el sistema.',
    )
  })

  it('anulado: quién, cuándo y por qué; el número queda atenuado y sin botón', () => {
    const anulado = doc({
      ...hubFacturaA(),
      status: 'voided',
      paymentStatus: 'voided',
      openCents: null,
      voidedAt: '2026-10-13T15:30:00Z',
      voidedByName: 'Luz',
      voidReason: 'lo cargué dos veces',
      replacedBy: link({ seq: 3, title: 'Factura A 0003-00001290', kind: 'purchase' }),
    })
    const hero = documentHero(anulado, ctx())
    expect(hero.label).toBe('Anulado')
    expect(hero.muted).toBe(true)
    expect(hero.action).toBeNull()
    expect(hero.help).toBeNull()
    expect(plain(richText(hero.sentence))).toBe(
      'Lo anuló Luz el 13/10/2026 12:30: «lo cargué dos veces». Ya no cuenta en los libros. Lo reemplazó Factura A 0003-00001290 #3.',
    )
    expect(hero.sentence.some((part) => typeof part !== 'string' && part.id === 'doc-3')).toBe(true)
  })

  it('anulado con fecha posterior: con qué y por qué queda donde está', () => {
    const reversed = link({
      seq: 9,
      title: 'Anulación',
      kind: 'reversal',
      accountingDate: '2026-11-03',
    })
    const hero = documentHero({ ...hubFacturaA(), reversedBy: reversed }, ctx())
    expect(hero.label).toBe('Anulado con fecha posterior')
    expect(hero.muted).toBe(true)
    expect(hero.action).toBeNull()
    expect(plain(richText(hero.sentence))).toBe(
      'Se anuló el 03/11/2026 con Anulación #9. Este queda en su mes, que está cerrado.',
    )
  })

  it('importes de nueve cifras y de cero no rompen ninguna oración', () => {
    const enorme = doc({
      ...hubFacturaA(),
      totalCents: 123_456_789_000,
      openCents: 123_456_789_000,
    })
    expect(documentHero(enorme, ctx()).cents).toBe(123_456_789_000)
    const parcial = doc({
      ...hubFacturaA(),
      totalCents: 123_456_789_000,
      openCents: 23_456_789_050,
      paymentStatus: 'partial',
      allocations: [allocation({ amountCents: 99_999_999_950 })],
    })
    // En una oración, pesos sin centavos (el exacto está en el papel): $ 999.999.999,50 redondea.
    expect(sentence(parcial)).toContain('De $ 1.234.567.890 ya pagaste $ 1.000.000.000')
    // Menos de un peso sí lleva centavos: nunca «$ 0» por algo que no es cero.
    const centavos = doc({
      ...hubFacturaA(),
      totalCents: 100_000,
      openCents: 99_950,
      paymentStatus: 'partial',
      allocations: [allocation({ amountCents: 50 })],
    })
    expect(plain(sentence(centavos))).toContain('De $ 1.000 ya pagaste $ 0,50')
    const vacio = doc({ kind: 'sales_close', title: 'Cierre del día', totalCents: 0, lines: [] })
    expect(sentence(vacio)).toBe('Este cierre no tiene importes.')
  })
})

// ─── ② El papel ──────────────────────────────────────────────────────────────

describe('el sello es el mismo que mostró la carga', () => {
  it('por cada tipo de comprobante, lo que dice `voucherStamp`', () => {
    for (const type of VOUCHER_TYPE_KEYS) {
      expect(documentStamp(doc({ kind: 'purchase', voucherType: type }))).toEqual(
        voucherStamp(type),
      )
    }
    expect(documentStamp(doc({ kind: 'purchase', voucherType: 'sin_comprobante' }))).toEqual({
      tone: 'sin',
      text: 'Sin factura',
    })
    // La M es una A sujeta a retención: sella «A».
    expect(documentStamp(doc({ kind: 'purchase', voucherType: 'factura_m' }))?.text).toBe(
      'Con factura A',
    )
  })

  it('sin tipo de comprobante no hay sello (un pago, un pase entre cajas)', () => {
    expect(documentStamp(pago())).toBeNull()
    expect(documentStamp(doc({ kind: 'transfer' }))).toBeNull()
  })

  it('el cierre sella su reparto, como el ticket del cierre', () => {
    expect(documentStamp(cierre47())).toEqual({ tone: 'factura', text: '76 % con factura' })
    const sinFactura = doc({
      kind: 'sales_close',
      totalCents: 5_000_000,
      lines: [
        treasury('Caja', 5_000_000, 'in'),
        line({
          role: 'sales_uninvoiced',
          side: 'credit',
          amountCents: 5_000_000,
          accountName: 'Ventas',
        }),
      ],
    })
    expect(documentStamp(sinFactura)).toEqual({ tone: 'sin', text: 'Sin factura' })
  })
})

describe('el papel, como quedó guardado', () => {
  it('HUB #2: el neto en su categoría, el IVA que se recupera y el total con su vencimiento', () => {
    const paper = documentPaper(hubFacturaA(), ctx())
    expect(paper.title).toBe('Distribuidora del Centro SA')
    expect(paper.word).toBe('Factura A 0003-00001290')
    expect(paper.day).toBe('12/10/2026')
    expect(paper.taxId).toBe('CUIT 30-71234567-8')
    expect(paper.stamp).toEqual({ tone: 'factura', text: 'Con factura A' })
    expect(paper.rows.map((r) => [r.label, r.hint, r.cents])).toEqual([
      ['Compras: alimentos', 'Neto 21 %', 5_980_000],
      ['IVA 21 %', 'Lo recuperás', 1_255_800],
    ])
    expect(paper.rows.reduce((sum, r) => sum + r.cents, 0)).toBe(7_235_800)
    expect(paper.total).toEqual({ label: 'Total', cents: 7_235_800, hint: 'Vence el 12/10' })
    expect(paper.note).toBe('Entró al Libro IVA de octubre y recuperás el IVA.')
    expect(paper.footer).toBe('Cargó Luz · 12/10/2026 21:04 · #2')
    expect(paper.detail).toBeNull()
    expect(paper.more).toBe(0)
  })

  it('HUB #1: un renglón, sello «Sin factura», sin CUIT y sin Libro IVA', () => {
    const paper = documentPaper(hubSinFactura(), ctx())
    expect(paper.title).toBe('Verdulería del Mercado')
    expect(paper.word).toBe('Compra')
    expect(paper.taxId).toBeNull()
    expect(paper.stamp).toEqual({ tone: 'sin', text: 'Sin factura' })
    expect(paper.rows.map((r) => [r.label, r.hint, r.cents])).toEqual([
      ['Compras: alimentos', undefined, 12_000_000],
    ])
    expect(paper.note).toBe('Quedó en tus números, sin factura. No entra al Libro IVA.')
  })

  it('una Factura A que no computa: el IVA va al costo y la letra chica lo dice', () => {
    const lines = [
      line({
        role: 'net',
        side: 'debit',
        amountCents: 6_900_000,
        accountName: 'Gastos bancarios',
        vatRateBp: 2100,
      }),
      line({
        role: 'vat',
        side: 'debit',
        amountCents: 1_449_000,
        accountName: 'Gastos bancarios',
        vatRateBp: 2100,
        taxKind: 'iva',
      }),
      line({
        role: 'control',
        side: 'credit',
        amountCents: 8_349_000,
        accountName: 'Proveedores',
        partyId: 'prov-4',
      }),
    ]
    const d = doc({
      kind: 'purchase',
      title: 'Factura A 0001-00000044',
      voucherType: 'factura_a',
      partyId: 'prov-4',
      partyName: 'Banco Nación',
      totalCents: 8_349_000,
      lines,
      fiscalVouchers: [
        fiscal({
          amounts: { net_21_cents: 6_900_000, vat_21_cents: 1_449_000, total_cents: 8_349_000 },
        }),
      ],
    })
    const paper = documentPaper(d, ctx())
    expect(paper.rows[1]).toMatchObject({ label: 'IVA 21 %', hint: 'Va al costo' })
    expect(paper.note).toBe('Entró al Libro IVA de octubre. El IVA fue al costo.')
  })

  it('un tique sin comercio o sin número no entra al Libro IVA, y lo dice', () => {
    const d = doc({ kind: 'expense', title: 'Tique', voucherType: 'tique' })
    expect(paperNote(d)).toBe(
      'Quedó como gasto con tique. Sin comercio o sin número no entra al Libro IVA.',
    )
    expect(paperNote(doc({ kind: 'expense', title: 'DDJJ', voucherType: 'ddjj_impuesto' }))).toBe(
      'Es un impuesto: no va al Libro IVA.',
    )
  })

  it('anulado: el papel no promete nada (ni «quedó en tus números», ni «vence», ni «lo recuperás»)', () => {
    const vigente = documentPaper(hubFacturaA(), ctx())
    expect(vigente.total.hint).toBe('Vence el 12/10')
    expect(vigente.note).not.toBeNull()
    expect(vigente.rows.some((r) => r.hint === 'Lo recuperás' || r.hint === 'Va al costo')).toBe(
      true,
    )

    const facturaAnulada: DocumentDetail = {
      ...hubFacturaA(),
      status: 'voided',
      paymentStatus: 'voided',
      openCents: null,
    }
    const anulados: DocumentDetail[] = [
      facturaAnulada,
      { ...hubSinFactura(), status: 'voided', paymentStatus: 'voided', openCents: null },
      // Anulado con fecha posterior: tampoco cuenta.
      { ...hubFacturaA(), reversedBy: link({ seq: 9, title: 'Anulación', kind: 'reversal' }) },
    ]
    for (const d of anulados) {
      const paper = documentPaper(d, ctx())
      expect(paper.note).toBeNull()
      expect(paperNote(d)).toBeNull()
      expect(paper.total.hint).toBeNull()
      expect(paper.rows.map((r) => r.hint)).not.toContain('Lo recuperás')
      expect(paper.rows.map((r) => r.hint)).not.toContain('Va al costo')
      expect(paper.total.cents).toBe(d.totalCents)
    }
    // Los renglones siguen, con sus importes: es el mismo papel, con la banda encima.
    expect(documentPaper(facturaAnulada, ctx()).rows.map((r) => [r.label, r.cents])).toEqual(
      vigente.rows.map((r) => [r.label, r.cents]),
    )
  })

  it('un gasto: el total dice de qué caja salió (o con qué tarjeta)', () => {
    const gasto = doc({
      kind: 'expense',
      title: 'Gasto',
      voucherType: 'sin_comprobante',
      description: 'Gasto · Hielo',
      notes: 'Para el evento del sábado',
      totalCents: 1_200_000,
      lines: [
        line({
          role: 'gross',
          side: 'debit',
          amountCents: 1_200_000,
          accountName: 'Compras: alimentos',
        }),
        treasury('Caja', 1_200_000, 'out'),
      ],
    })
    const paper = documentPaper(gasto, ctx())
    // Sin proveedor, el membrete es lo que escribió la persona; la categoría ya es su renglón.
    expect(paper.title).toBe('Hielo')
    expect(paper.rows.map((r) => r.label)).toEqual(['Compras: alimentos'])
    expect(paper.total.label).toBe('Salieron de Caja')
    // Lo que ya es el membrete no se repite en «Detalle».
    expect(paper.detail).toEqual({ extra: null, notes: 'Para el evento del sábado' })
    expect(documentPaper({ ...gasto, notes: null }, ctx()).detail).toBeNull()
    // Con proveedor manda el proveedor, y lo escrito queda en «Detalle».
    const conProveedor = documentPaper({ ...gasto, partyName: 'Hielo Polar' }, ctx())
    expect(conProveedor.title).toBe('Hielo Polar')
    expect(conProveedor.detail).toEqual({ extra: 'Hielo', notes: 'Para el evento del sábado' })
    const tarjeta = doc({
      ...gasto,
      lines: [gasto.lines[0] as Line, treasury('Visa del bar', 1_200_000, 'out')],
    })
    expect(documentPaper(tarjeta, ctx()).total.label).toBe('Con Visa del bar')
    const largo = doc({
      ...gasto,
      lines: [
        gasto.lines[0] as Line,
        treasury('Cuenta corriente del Banco de la Nación', 1_200_000, 'out'),
      ],
    })
    expect(documentPaper(largo, ctx()).total.label.length).toBeLessThanOrEqual(
      'Salieron de '.length + 22,
    )
  })

  it('un pago: de dónde salió y cuánto, y que no es un gasto nuevo', () => {
    const paper = documentPaper(pago(), ctx())
    expect(paper.title).toBe('Distribuidora de Bebidas Demo SA')
    expect(paper.word).toBe('Pago')
    expect(paper.day).toBe('03/10/2026')
    expect(paper.stamp).toBeNull()
    expect(paper.rows.map((r) => [r.label, r.cents])).toEqual([
      ['Salió de Banco Nación', 50_000_000],
    ])
    expect(paper.total).toEqual({ label: 'Total pagado', cents: 50_000_000, hint: null })
    expect(paper.note).toBe('Es solo el pago: lo que compraste ya está contado en la factura.')
  })

  it('un cobro con descuentos: lo liquidado menos cada descuento da lo que entró', () => {
    const paper = documentPaper(cobroConDescuentos(), ctx())
    expect(paper.title).toBe('Tarjetas de débito (Posnet)')
    // La palabra y el número, sin el nombre largo del catálogo.
    expect(paper.word).toBe('Liquidación 0001-00031001')
    expect(paper.stamp).toEqual({ tone: 'factura', text: 'Con liquidación' })
    expect(paper.rows.map((r) => [r.label, r.cents, r.minus ?? false])).toEqual([
      ['Te liquidaron', 231_140_700, false],
      ['Comisión', 1_849_126, true],
      ['IVA de la comisión', 388_316, true],
    ])
    const net = paper.rows.reduce((sum, r) => sum + (r.minus ? -r.cents : r.cents), 0)
    expect(net).toBe(228_903_258)
    expect(paper.total).toEqual({
      label: 'Entraron a Banco Nación',
      cents: 228_903_258,
      hint: null,
    })
    expect(paper.note).toBe(
      'Es plata de ventas que ya estaban contadas: no suma como venta de nuevo.',
    )
  })

  it('una nota de crédito de proveedor: a tu favor, y qué descuenta', () => {
    const d = doc({
      kind: 'purchase_credit_note',
      title: 'Nota de crédito A 0003-00000077',
      voucherType: 'nota_credito_a',
      partyId: 'prov-3',
      partyName: 'Bebidas SA',
      totalCents: 6_050_000,
      lines: [
        line({
          role: 'control',
          side: 'debit',
          amountCents: 6_050_000,
          accountName: 'Proveedores',
          partyId: 'prov-3',
        }),
        line({
          role: 'net',
          side: 'credit',
          amountCents: 5_000_000,
          accountName: 'Compras: bebidas sin alcohol',
          vatRateBp: 2100,
        }),
        line({
          role: 'vat',
          side: 'credit',
          amountCents: 1_050_000,
          accountName: 'IVA crédito fiscal',
          vatRateBp: 2100,
          taxKind: 'iva',
        }),
      ],
    })
    const paper = documentPaper(d, ctx())
    expect(paper.stamp?.text).toBe('Con nota de crédito A')
    expect(paper.rows.map((r) => [r.label, r.hint])).toEqual([
      ['Compras: bebidas sin alcohol', 'Neto 21 %'],
      // Una nota de crédito no «recupera» IVA: el renglón no lo promete.
      ['IVA 21 %', undefined],
    ])
    expect(paper.total).toEqual({
      label: 'A tu favor',
      cents: 6_050_000,
      hint: 'Descuenta lo que le debés a Bebidas SA',
    })
  })

  it('mover plata: de dónde salió primero, a dónde entró después', () => {
    const pase = doc({
      kind: 'transfer',
      title: 'Movimiento entre cuentas',
      description: 'Cambio para la caja',
      totalCents: 20_000_000,
      lines: [treasury('Caja', 20_000_000, 'in'), treasury('Banco Nación', 20_000_000, 'out')],
    })
    const paper = documentPaper(pase, ctx())
    expect(paper.title).toBe('Movimiento entre cuentas')
    // El título ya dice qué es: abajo va solo el día.
    expect(paper.word).toBeNull()
    expect(paper.day).toBe('12/10/2026')
    expect(paper.rows.map((r) => r.label)).toEqual(['Salió de Banco Nación', 'Entró a Caja'])
    expect(paper.total.label).toBe('Total movido')
    expect(paper.detail).toEqual({ extra: 'Cambio para la caja', notes: null })
    expect(paper.note).toBe('No es gasto ni venta: la plata cambió de lugar.')
  })

  it('otra entrada o salida: los renglones dicen en qué fue y el total, de qué caja', () => {
    const salida = doc({
      kind: 'cash_movement',
      title: 'Movimiento de caja',
      description: 'Otro egreso · Energía eléctrica · Banco Nación',
      notes: 'DEBAUT SERVICIO LUZ',
      totalCents: 18_640_000,
      lines: [
        line({
          role: 'counterpart',
          side: 'debit',
          amountCents: 18_640_000,
          accountName: 'Energía eléctrica',
          memo: 'DEBAUT SERVICIO LUZ',
        }),
        treasury('Banco Nación', 18_640_000, 'out'),
      ],
    })
    const paper = documentPaper(salida, ctx())
    expect(paper.title).toBe('Otra salida')
    // Un solo renglón: los dos lados del mismo importe se leerían como una suma.
    expect(paper.rows.map((r) => [r.label, r.hint, r.cents])).toEqual([
      ['Energía eléctrica', undefined, 18_640_000],
    ])
    expect(paper.total).toEqual({
      label: 'Salieron de Banco Nación',
      cents: 18_640_000,
      hint: null,
    })
    // La nota va una sola vez, en «Detalle».
    expect(paper.detail).toEqual({ extra: null, notes: 'DEBAUT SERVICIO LUZ' })
    const entrada = doc({
      kind: 'cash_movement',
      title: 'Movimiento de caja',
      totalCents: 24_318,
      lines: [
        treasury('Mercado Pago', 24_318, 'in'),
        line({
          role: 'counterpart',
          side: 'credit',
          amountCents: 24_318,
          accountName: 'Intereses y rendimientos',
          memo: 'Rendimientos de octubre',
        }),
      ],
    })
    const paperIn = documentPaper(entrada, ctx())
    expect(paperIn.rows[0]).toMatchObject({
      label: 'Intereses y rendimientos',
      hint: 'Rendimientos de octubre',
    })
    expect(paperIn.total.label).toBe('Entraron a Mercado Pago')
  })

  it('renglones iguales se suman y un asiento largo se corta en ocho', () => {
    const repetido = doc({
      kind: 'purchase',
      title: 'Factura A 0001-00000001',
      voucherType: 'factura_a',
      partyName: 'X',
      lines: [
        line({
          role: 'net',
          side: 'debit',
          amountCents: 100,
          accountName: 'Compras: alimentos',
          vatRateBp: 2100,
        }),
        line({
          role: 'net',
          side: 'debit',
          amountCents: 250,
          accountName: 'Compras: alimentos',
          vatRateBp: 2100,
        }),
        line({
          role: 'net',
          side: 'debit',
          amountCents: 40,
          accountName: 'Compras: alimentos',
          vatRateBp: 1050,
        }),
      ],
    })
    expect(documentPaper(repetido, ctx()).rows.map((r) => [r.hint, r.cents])).toEqual([
      ['Neto 21 %', 350],
      ['Neto 10,5 %', 40],
    ])
    const largo = doc({
      kind: 'manual',
      title: 'Asiento manual',
      description: 'Sueldos de septiembre',
      lines: Array.from({ length: 30 }, (_, i) =>
        line({
          role: 'manual',
          side: i % 2 === 0 ? 'debit' : 'credit',
          amountCents: 1_000 + i,
          accountName: `Cuenta ${i + 1}`,
        }),
      ),
    })
    const paper = documentPaper(largo, ctx())
    expect(paper.rows).toHaveLength(8)
    expect(paper.more).toBe(22)
    expect(paper.rows[0]).toMatchObject({ label: 'Cuenta 1', hint: 'Debe' })
    // El asiento manual se titula con su descripción: no hay «detalle» repetido.
    expect(paper.detail).toBeNull()
  })

  it('el papel del cierre #47 es el ticket del cierre: total, con factura y sin factura', () => {
    const props = closeTicketProps([cierre47()], { today: TODAY, arrivals: false })
    expect(props.soldCents).toBe(75_647_280)
    expect(props.split).toMatchObject({
      kind: 'mixed',
      invoicedCents: 57_799_280,
      uninvoicedCents: 17_848_000,
    })
    // El efectivo coincidió (o no se contó): no hay bloque de efectivo que inventar.
    expect(props.cash).toBeNull()
    expect(props.arrivals).toEqual([])
    expect(props.still).toBe(true)
    expect(props.lines.map((l) => l.name)).toEqual([
      'Efectivo',
      'Transferencia',
      'QR Mercado Pago',
      'Débito',
      'Crédito',
      'PedidosYa',
      'Rappi',
    ])
  })
})

// ─── ③ Con qué está unido ────────────────────────────────────────────────────

describe('el mapa de vínculos', () => {
  it('HUB #2: faltan el pago y la foto; el Libro IVA y los libros ya están', () => {
    const d = hubFacturaA()
    const nodes = documentLinks(d, ctx())
    expect(nodes.map((n) => [n.id, n.state, n.how])).toEqual([
      ['pago', 'missing', 'you'],
      ['foto', 'missing', 'you'],
      ['libro-iva', 'linked', 'auto'],
      ['libros', 'linked', 'auto'],
    ])
    expect(linksTitle(nodes, d, TODAY)).toBe('Le faltan el pago y la foto')
    expect(node(nodes, 'pago')?.empty).toEqual({
      title: 'Sin pago anotado todavía.',
      hint: 'Cuando lo pagues, el pago queda unido acá.',
    })
    const iva = node(nodes, 'libro-iva')
    expect(iva?.groups[0]).toMatchObject({
      book: 'purchases',
      month: '2026-10',
      title: 'Libro IVA compras de octubre 2026',
    })
    expect(iva?.groups[0]?.vouchers[0]).toMatchObject({
      label: 'Factura A 0003-00001290',
      netCents: 5_980_000,
      vatCents: 1_255_800,
      totalCents: 7_235_800,
    })
    expect(node(nodes, 'libros')).toMatchObject({
      title: 'Asiento N° 2, provisorio',
      period: {
        text: 'Octubre 2026: abierto. El número queda fijo al cerrar el mes.',
        closed: false,
      },
    })
  })

  it('HUB #1 (sin factura): el Libro IVA no aplica y vale decirlo', () => {
    const d = hubSinFactura()
    const nodes = documentLinks(d, ctx())
    expect(nodes.map((n) => n.id)).toEqual(['pago', 'foto', 'libro-iva', 'libros'])
    expect(node(nodes, 'libro-iva')).toMatchObject({
      state: 'off',
      off: {
        title: 'No entra al Libro IVA.',
        hint: 'Es sin factura. Queda en tus números igual.',
        guide: true,
      },
    })
    expect(node(nodes, 'foto')?.emptyText).toBe(
      'Aunque sea sin factura, la foto del remito o del papelito sirve de respaldo. No cambia ningún número: es el respaldo si un día te lo piden.',
    )
    // Anulado ya no «queda en tus números»: al lado dice «Ya no cuenta en los libros».
    const anulado = doc({ ...d, status: 'voided', paymentStatus: 'voided', openCents: null })
    expect(node(documentLinks(anulado, ctx()), 'libro-iva')?.off).toEqual({
      title: 'No entra al Libro IVA.',
      hint: null,
      guide: true,
    })
  })

  it('el título dice qué falta: una cosa, dos o ninguna', () => {
    const d = hubFacturaA()
    expect(linksTitle(documentLinks(d, ctx({ attachments: 2 })), d, TODAY)).toBe('Le falta el pago')
    const paid = doc({
      ...d,
      openCents: 0,
      paymentStatus: 'paid',
      allocations: [allocation({ amountCents: 7_235_800 })],
    })
    expect(linksTitle(documentLinks(paid, ctx()), paid, TODAY)).toBe('Le falta la foto')
    expect(linksTitle(documentLinks(paid, ctx({ attachments: 1 })), paid, TODAY)).toBe(
      'Con qué está unido',
    )
  })

  it('con un pago parcial el nodo está unido y dice cuánto falta al pie', () => {
    const d = doc({
      ...hubFacturaA(),
      totalCents: 121_000_000,
      openCents: 71_000_000,
      paymentStatus: 'partial',
      allocations: [allocation({ amountCents: 50_000_000 })],
    })
    const pagoNode = node(documentLinks(d, ctx()), 'pago')
    expect(pagoNode?.state).toBe('linked')
    expect(pagoNode?.rows.map((r) => [r.label, r.meta, r.cents])).toEqual([
      ['Pago #6', 'el 03/10', 50_000_000],
    ])
    expect(plain(pagoNode?.footer ?? '')).toBe('Falta pagar $ 710.000')
    // Un pago unido después se puede separar: se nombra el pago y la factura.
    expect(pagoNode?.rows[0]?.separate).toMatchObject({
      paymentLabel: 'Pago #6',
      invoiceLabel: 'Factura A 0003-00001290',
      amountCents: 50_000_000,
      partyName: 'Distribuidora del Centro SA',
    })
  })

  it('una unión separada baja a su pliegue, con cuándo y qué pasó', () => {
    const d = doc({
      ...hubFacturaA(),
      allocations: [allocation({ amountCents: 50_000_000, voidedOn: '2026-10-05' })],
    })
    const pagoNode = node(documentLinks(d, ctx()), 'pago')
    expect(pagoNode?.state).toBe('missing')
    expect(pagoNode?.rows).toEqual([])
    expect(pagoNode?.separated.map(plain)).toEqual([
      'Pago #6 · $ 500.000 · separado el 05/10/2026: quedó a cuenta.',
    ])
  })

  it('un pago: de qué caja salió y qué pagó', () => {
    const nodes = documentLinks(pago(), ctx())
    expect(nodes.map((n) => n.id)).toEqual(['caja', 'aplicado', 'foto'])
    expect(node(nodes, 'caja')?.rows.map((r) => [r.text, r.treasuryId, r.cents])).toEqual([
      ['Salió de Banco Nación', 'caja-Banco Nación', 50_000_000],
    ])
    const aplicado = node(nodes, 'aplicado')
    expect(aplicado?.what).toBe('Qué pagó')
    expect(aplicado?.rows.map((r) => [r.label, r.documentId])).toEqual([
      ['Factura A 0003-00001100 #2', 'doc-2'],
    ])
    // Sin fecha: la de la unión se leería como la de la factura.
    expect(aplicado?.rows[0]?.meta).toBeNull()
    expect(aplicado?.rows[0]?.separate).toMatchObject({
      paymentLabel: 'Pago #6',
      // Una factura con número se nombra por su número: el «#2» de la fila sobra en la pregunta.
      invoiceLabel: 'Factura A 0003-00001100',
      // Con su artículo, para la pregunta del diálogo; y cómo se la nombra la segunda vez.
      paymentWords: 'el Pago #6',
      invoiceWords: 'la Factura A 0003-00001100',
      invoiceNoun: 'La factura',
    })
    // Un pago no trae un papel de afuera: la foto se ofrece, pero no «le falta».
    expect(node(nodes, 'foto')?.state).toBe('ask')
    expect(linksTitle(nodes, pago(), TODAY)).toBe('Con qué está unido')
  })

  it('un pago a cuenta es válido: cajita hueca, sin «Falta»', () => {
    const d = pago({ allocations: [], openCents: 50_000_000 })
    const aplicado = node(documentLinks(d, ctx({ attachments: 1 })), 'aplicado')
    expect(aplicado?.state).toBe('ask')
    expect(aplicado?.empty).toEqual({
      title: 'No está unido a ninguna factura.',
      hint: 'Queda como saldo a favor con Distribuidora de Bebidas Demo SA y se usa solo en el próximo pago.',
    })
    expect(linksTitle(documentLinks(d, ctx({ attachments: 1 })), d, TODAY)).toBe(
      'Con qué está unido',
    )
  })

  it('un cobro dice de qué noches es: cada cierre por su día, del más viejo al más nuevo', () => {
    const cobro = doc({
      ...cobroConDescuentos(),
      allocations: [
        allocation({
          amountCents: 10_088_700,
          otherDocumentId: 'doc-13',
          otherDocumentTitle: 'Cierre del día',
          otherDocumentSeq: 13,
        }),
        allocation({
          amountCents: 8_165_800,
          otherDocumentId: 'doc-12',
          otherDocumentTitle: 'Cierre del día',
          otherDocumentSeq: 12,
        }),
      ],
    })
    // Sin los días (la lectura falló o no se pidió), como siempre: «Cierre del día #12» no le
    // dice a nadie qué noche cobró, pero no se inventa nada.
    expect(node(documentLinks(cobro, ctx()), 'aplicado')?.rows.map((r) => r.label)).toEqual([
      'Cierre del día #13',
      'Cierre del día #12',
    ])
    const linked = new Map([
      ['doc-12', { kind: 'sales_close', issueDate: '2026-09-01' }],
      ['doc-13', { kind: 'sales_close', issueDate: '2026-09-02' }],
    ])
    const aplicado = node(documentLinks(cobro, ctx({ linked })), 'aplicado')
    expect(aplicado?.what).toBe('De qué ventas es')
    expect(aplicado?.rows.map((r) => [r.label, r.documentId, r.cents])).toEqual([
      ['Cierre del mar 01/09', 'doc-12', 8_165_800],
      ['Cierre del mié 02/09', 'doc-13', 10_088_700],
    ])
    // De otro año, la fecha entera.
    const viejo = new Map([
      ['doc-12', { kind: 'sales_close', issueDate: '2025-12-30' }],
      ['doc-13', { kind: 'sales_close', issueDate: '2025-12-31' }],
    ])
    expect(
      node(documentLinks(cobro, ctx({ linked: viejo })), 'aplicado')?.rows.map((r) => r.label),
    ).toEqual(['Cierre del 30/12/2025', 'Cierre del 31/12/2025'])
    // Dos medios de la misma noche (el QR y la transferencia) son UNA fila, con el importe sumado.
    const dosMedios = doc({
      ...cobro,
      allocations: [
        ...cobro.allocations,
        allocation({
          id: 'union-qr-12',
          amountCents: 1_000_000,
          otherDocumentId: 'doc-12',
          otherDocumentTitle: 'Cierre del día',
          otherDocumentSeq: 12,
        }),
      ],
    })
    expect(
      node(documentLinks(dosMedios, ctx({ linked })), 'aplicado')?.rows.map((r) => [
        r.label,
        r.cents,
      ]),
    ).toEqual([
      ['Cierre del mar 01/09', 9_165_800],
      ['Cierre del mié 02/09', 10_088_700],
    ])
    // Lo que no es un cierre conserva su nombre.
    const factura = new Map([['doc-2', { kind: 'purchase', issueDate: '2026-09-10' }]])
    expect(
      node(documentLinks(pago(), ctx({ linked: factura })), 'aplicado')?.rows.map((r) => r.label),
    ).toEqual(['Factura A 0003-00001100 #2'])
  })

  it('un pago con resto: cuánto quedó a cuenta y de quién', () => {
    const aplicado = node(documentLinks(pago({ openCents: 2_000_000 }), ctx()), 'aplicado')
    expect(plain(aplicado?.rest?.title ?? '')).toBe('Quedaron $ 20.000 a cuenta')
    expect(aplicado?.rest).toMatchObject({
      hint: 'Se descuentan solos de la próxima factura de Distribuidora de Bebidas Demo SA.',
      partyId: 'prov-3',
      side: 'supplier',
    })
  })

  it('más de cinco uniones: las cinco primeras a la vista y el resto plegado', () => {
    const d = pago({
      allocations: Array.from({ length: 9 }, (_, i) =>
        allocation({
          amountCents: 1_000,
          otherDocumentId: `doc-${i + 20}`,
          otherDocumentSeq: i + 20,
        }),
      ),
    })
    const aplicado = node(documentLinks(d, ctx()), 'aplicado')
    expect(aplicado?.rows).toHaveLength(5)
    expect(aplicado?.more).toHaveLength(4)
  })

  it('una nota de crédito dice primero qué factura corrige', () => {
    const d = doc({
      kind: 'purchase_credit_note',
      title: 'Nota de crédito A 0003-00000077',
      voucherType: 'nota_credito_a',
      partyName: 'Bebidas SA',
      openCents: 0,
      related: link({ id: 'doc-2', seq: 2, title: 'Factura A 0003-00001100', kind: 'purchase' }),
      allocations: [
        allocation({
          kind: 'credit_note',
          amountCents: 6_050_000,
          otherDocumentId: 'doc-2',
          otherDocumentTitle: 'Factura A 0003-00001100',
          otherDocumentSeq: 2,
        }),
      ],
    })
    const nodes = documentLinks(d, ctx())
    const aplicado = node(nodes, 'aplicado')
    expect(aplicado?.what).toBe('Qué descontó')
    expect(aplicado?.corrects).toEqual({ id: 'doc-2', text: 'Factura A 0003-00001100 #2' })
    // Una nota de crédito sigue diciendo «Corrige a…»: no se separa.
    expect(aplicado?.rows[0]?.separate).toBeNull()
    // Y no se repite en «Otros papeles».
    expect(node(nodes, 'otros')).toBeUndefined()
  })

  it('el cierre #47: la caja, cada medio con su estado y con qué llegó', () => {
    const d = doc({
      ...cierre47({ 2: 0, 3: 0, 4: 9_000_000 }),
      allocations: [
        allocation({
          amountCents: 8_000_900,
          otherDocumentId: 'doc-58',
          otherDocumentTitle: 'Cobro',
          otherDocumentSeq: 58,
          appliedOn: '2026-10-07',
        }),
        allocation({
          amountCents: 11_334_600,
          otherDocumentId: 'doc-58',
          otherDocumentTitle: 'Cobro',
          otherDocumentSeq: 58,
          appliedOn: '2026-10-07',
        }),
        allocation({
          amountCents: 10_335_400,
          otherDocumentId: 'doc-61',
          otherDocumentTitle: 'Liquidación de tarjeta o plataforma 0001-00031002',
          otherDocumentSeq: 61,
          appliedOn: '2026-10-08',
        }),
      ],
    })
    const nodes = documentLinks(d, ctx())
    expect(nodes.map((n) => n.id)).toEqual(['en-camino', 'foto', 'libro-iva', 'libros'])
    const camino = node(nodes, 'en-camino')
    expect(camino?.limit).toBe('cierre-cajas')
    expect(camino?.cash.map((r) => [r.text, r.cents])).toEqual([['Entró a Caja', 12_001_300]])
    expect(
      camino?.rows.map((r) => [
        r.medium,
        r.partyName,
        r.tone,
        plain(r.status),
        r.action?.label ?? null,
      ]),
    ).toEqual([
      // Lo que ya está se dice con el verbo de la leyenda («Ya llegó»), también el QR.
      ['Transferencia', 'Mercado Pago', 'ok', 'Llegó', null],
      ['QR Mercado Pago', 'Mercado Pago', 'ok', 'Llegó', null],
      [
        'Débito',
        'Tarjetas de débito (Posnet)',
        'warn',
        'Llegó una parte: faltan $ 90.000',
        'Anotar que llegó',
      ],
      [
        'Crédito',
        'Tarjetas de crédito (Posnet)',
        'muted',
        'Llega el vie 16/10',
        'Anotar que llegó',
      ],
      ['PedidosYa', 'PedidosYa', 'muted', 'Llega el mar 20/10', 'Anotar que llegó'],
      ['Rappi', 'Rappi', 'muted', 'Llega el mar 20/10', 'Anotar que llegó'],
    ])
    // El botón es un verbo: «Ya llegó» al lado de «Llega el vie 16/10» se leía como un estado.
    // Abre el cobro con ese partícipe y esa partida ya elegidos.
    expect(camino?.rows[2]?.action?.params).toEqual({
      cliente: 'part-Tarjetas de débito (Posnet)',
      partida: 'partida-4',
    })
    // El mismo cobro no sale dos veces: un renglón por comprobante, con lo suyo sumado.
    expect(camino?.arrivals.map((r) => [r.label, r.cents])).toEqual([
      ['Cobro #58', 19_335_500],
      // El nombre largo del catálogo no va en una lista: la palabra y el número.
      ['Liquidación 0001-00031002 #61', 10_335_400],
    ])
    expect(camino?.arrivals.map((r) => r.meta)).toEqual(['el 07/10', 'el 08/10'])
    expect(plain(linksTitle(nodes, d, TODAY))).toBe('De este día todavía no llegaron $ 339.751')
    // Sin puntos de venta ni facturas ese día: el Libro IVA no aplica, y se dice.
    expect(node(nodes, 'libro-iva')?.off?.title).toBe('No entra al Libro IVA.')
  })

  it('el cierre: lo atrasado va en ámbar («debió llegar»), nunca en rojo', () => {
    const camino = node(documentLinks(cierre47(), ctx()), 'en-camino')
    const debito = camino?.rows.find((r) => r.medium === 'Débito')
    expect(debito).toMatchObject({ tone: 'warn', status: 'Debió llegar el 07/10' })
    // Lo cobrado con QR no «vence»: está en camino hasta que se cuenta la billetera.
    expect(camino?.rows.find((r) => r.medium === 'QR Mercado Pago')).toMatchObject({
      tone: 'muted',
      status: 'En camino',
    })
    const todoLlego = cierre47({ 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 })
    expect(linksTitle(documentLinks(todoLlego, ctx()), todoLlego, TODAY)).toBe(
      'De este día ya llegó toda la plata',
    )
  })

  it('la contadora no recibe «Anotar que llegó», «Separar» ni la pregunta del gasto fijo', () => {
    const read = ctx({ canWrite: false })
    const camino = node(documentLinks(cierre47(), read), 'en-camino')
    expect(camino?.rows.every((r) => r.action === null)).toBe(true)
    const parcial = doc({ ...hubFacturaA(), allocations: [allocation({ amountCents: 1_000 })] })
    expect(node(documentLinks(parcial, read), 'pago')?.rows[0]?.separate).toBeNull()
    const candidato = recurring({ id: 'fijo-1', name: 'Alquiler del local', partyId: 'prov-2' })
    expect(
      node(
        documentLinks(hubFacturaA(), ctx({ canWrite: false, candidates: [candidato] })),
        'gasto-fijo',
      ),
    ).toBeUndefined()
    // La foto solo se le muestra si hay alguna (regla de siempre).
    expect(node(documentLinks(hubFacturaA(), read), 'foto')).toBeUndefined()
    expect(
      node(documentLinks(hubFacturaA(), ctx({ canWrite: false, attachments: 2 })), 'foto'),
    ).toMatchObject({
      state: 'linked',
      canEdit: false,
    })
    // Y ve de qué tipo es el asiento.
    expect(node(documentLinks(hubFacturaA(), read), 'libros')?.detail).toBe('Común · 12/10/2026')
    expect(node(documentLinks(hubFacturaA(), ctx()), 'libros')?.detail).toBeNull()
  })

  it('el gasto fijo va con su nombre y lleva a su renglón', () => {
    const d = doc({ ...hubFacturaA(), recurringExpenseId: 'fijo-1' })
    const fijo = recurring({
      id: 'fijo-1',
      name: 'Alquiler del local',
      lastDocumentId: 'doc-2',
      loadedDue: '2026-10-10',
    })
    expect(node(documentLinks(d, ctx({ recurring: fijo })), 'gasto-fijo')).toMatchObject({
      state: 'linked',
      limit: 'gasto-fijo',
      recurringId: 'fijo-1',
      title: 'Alquiler del local',
      text: 'Con este comprobante quedó cargado el vencimiento del 10/10.',
    })
    expect(
      node(documentLinks(d, ctx({ recurring: { ...fijo, lastDocumentId: 'otro' } })), 'gasto-fijo')
        ?.text,
    ).toBe('Es uno de los comprobantes de este gasto fijo.')
    expect(node(documentLinks(d, ctx({ recurring: null })), 'gasto-fijo')).toMatchObject({
      recurringId: null,
      title: 'Un gasto fijo que ya no está en la lista.',
      listLink: false,
    })
    expect(node(documentLinks(d, ctx({ recurring: 'error' })), 'gasto-fijo')).toMatchObject({
      title: 'Un gasto fijo',
      listLink: true,
    })
  })

  it('«¿Era el alquiler?»: pregunta honesta, sin prometer unirlo después', () => {
    const d = hubFacturaA()
    const uno = recurring({
      id: 'fijo-1',
      name: 'Alquiler del local',
      partyId: 'prov-2',
      nextDueDate: '2026-10-10',
    })
    const nodes = documentLinks(d, ctx({ candidates: [uno] }))
    const ask = node(nodes, 'gasto-fijo')
    expect(ask).toMatchObject({
      state: 'ask',
      title: '¿Era «Alquiler del local»? Vence el 10/10 y sigue sin cargar.',
      text: 'Eso se elige al cargar: hoy no se puede unir después. Si era, anulá este comprobante y cargalo desde Gastos fijos.',
      listLink: true,
    })
    // No es una falta: el título no la cuenta.
    expect(linksTitle(nodes, d, TODAY)).toBe('Le faltan el pago y la foto')
    const dos = [uno, recurring({ id: 'fijo-2', name: 'Expensas', partyId: 'prov-2' })]
    expect(node(documentLinks(d, ctx({ candidates: dos })), 'gasto-fijo')?.title).toBe(
      '¿Era un gasto fijo? Hay 2 de Distribuidora del Centro SA sin cargar este mes.',
    )
  })

  it('lo que vino de un archivo lo dice, con su límite', () => {
    const origin = {
      batchId: 'lote-1',
      source: 'arca_recibidos',
      fileName: 'mis-comprobantes.csv',
      uploadedAt: '2026-10-09T14:00:00Z',
      uploadedByName: 'Dueño QA',
      role: 'current' as const,
    }
    const importado = node(documentLinks(hubFacturaA(), ctx({ origin })), 'importado')
    expect(importado).toMatchObject({
      limit: 'importado',
      batchId: 'lote-1',
      title: 'Archivo de ARCA',
      text: 'Lo subió Dueño QA el 09/10/2026.',
      note: null,
    })
    const anulado = node(
      documentLinks(
        { ...hubFacturaA(), status: 'voided' },
        ctx({ origin: { ...origin, role: 'previous', source: 'bank_statement' } }),
      ),
      'importado',
    )
    expect(anulado).toMatchObject({
      title: 'Archivo de Banco',
      note: 'Como se anuló, su línea volvió a quedar para revisar en ese archivo.',
    })
    expect(
      node(
        documentLinks(
          hubFacturaA(),
          ctx({ origin: { ...origin, fileName: null, source: 'mp_release' } }),
        ),
        'importado',
      )?.title,
    ).toBe('Importado de Mercado Pago')
  })

  it('un pase entre cajas: primero de dónde salió', () => {
    const pase = doc({
      kind: 'transfer',
      title: 'Movimiento entre cuentas',
      totalCents: 165_100_000,
      lines: [treasury('Banco Nación', 165_100_000, 'in'), treasury('Caja', 165_100_000, 'out')],
    })
    expect(node(documentLinks(pase, ctx()), 'caja')?.rows.map((r) => r.text)).toEqual([
      'Salió de Caja',
      'Entró a Banco Nación',
    ])
  })

  it('una Factura C no discrimina IVA: el Libro IVA muestra su total, no «Neto $ 0»', () => {
    const d = doc({
      ...hubFacturaA(),
      title: 'Factura C 0002-00000184',
      voucherType: 'factura_c',
      fiscalVouchers: [
        fiscal({
          voucherType: 'factura_c',
          pointOfSale: 2,
          numberFrom: 184,
          amounts: { undiscriminated_cents: 8_500_000, total_cents: 8_500_000 },
        }),
      ],
    })
    const voucher = node(documentLinks(d, ctx()), 'libro-iva')?.groups[0]?.vouchers[0]
    expect(voucher?.summary).toEqual([{ label: 'Total, con el IVA adentro', cents: 8_500_000 }])
    expect(
      node(documentLinks(hubFacturaA(), ctx()), 'libro-iva')?.groups[0]?.vouchers[0]?.summary,
    ).toEqual([
      { label: 'Neto', cents: 5_980_000 },
      { label: 'IVA', cents: 1_255_800 },
    ])
    expect(paperNote(d)).toBe('Entró al Libro IVA de octubre. El IVA fue al costo.')
  })

  it('un asiento de apertura o un conteo no «le faltan» la foto: se ofrece, sin píldora', () => {
    const apertura = doc({ kind: 'opening', title: 'Asiento de apertura', totalCents: 430_000_000 })
    const nodes = documentLinks(apertura, ctx())
    expect(node(nodes, 'foto')).toMatchObject({
      state: 'ask',
      canEdit: true,
      emptyText:
        'Si hay un papel de respaldo, subilo acá. No cambia ningún número: es el respaldo si un día te lo piden.',
    })
    expect(linksTitle(nodes, apertura, TODAY)).toBe('Con qué está unido')
    const conteo = doc({
      kind: 'treasury_adjustment',
      title: 'Ajuste de saldo',
      lines: [treasury('Caja', 100, 'out')],
    })
    expect(node(documentLinks(conteo, ctx()), 'foto')?.state).toBe('ask')
    expect(photoHint({ kind: 'bank_expense', voucherType: null })).toMatch(
      /^Si tenés el comprobante o el resumen donde figura, subilo\./,
    )
  })

  it('la foto «falta» solo en lo que trae un papel de afuera; al resto se le ofrece', () => {
    const state = (kind: DocumentKind) =>
      node(documentLinks(doc({ kind, title: documentKindLabel(kind) }), ctx()), 'foto')?.state
    // La factura o el remito del proveedor, y el cierre de caja y del posnet.
    for (const kind of [
      'purchase',
      'purchase_credit_note',
      'purchase_debit_note',
      'expense',
      'sales_close',
    ] as const) {
      expect(state(kind), kind).toBe('missing')
    }
    // Un pago, un cobro, un pase entre cajas, lo que cobró el banco o una venta propia no
    // «les falta» nada: si no, todas las fichas abren con un aviso ámbar y deja de leerse.
    for (const kind of [
      'payment',
      'collection',
      'transfer',
      'bank_expense',
      'cash_movement',
      'treasury_adjustment',
      'sales_invoice',
      'sales_credit_note',
      'sales_debit_note',
      'opening',
      'manual',
    ] as const) {
      expect(state(kind), kind).toBe('ask')
    }
  })

  it('un comprobante anulado no «le falta» nada', () => {
    const d = doc({ ...hubFacturaA(), status: 'voided', paymentStatus: 'voided', openCents: null })
    const nodes = documentLinks(d, ctx())
    expect(nodes.some((n) => n.state === 'missing')).toBe(false)
    expect(nodes.map((n) => n.id)).toEqual(['libro-iva', 'libros'])
    expect(linksTitle(nodes, d, TODAY)).toBe('Con qué estaba unido')
  })

  it('si las fotos no se pudieron leer, el nodo lo dice en vez de afirmar que faltan', () => {
    const nodes = documentLinks(hubFacturaA(), ctx({ attachments: null }))
    expect(node(nodes, 'foto')).toMatchObject({ state: 'off', error: true })
    expect(linksTitle(nodes, hubFacturaA(), TODAY)).toBe('Le falta el pago')
  })

  it('los otros papeles: reemplazos, anulaciones y lo guardado junto', () => {
    const d = doc({
      ...hubFacturaA(),
      replaces: link({ seq: 1, title: 'Compra', kind: 'purchase' }),
      bundleSiblings: [link({ seq: 3, title: 'Pago', kind: 'payment', status: 'voided' })],
    })
    const otros = node(documentLinks(d, ctx()), 'otros')
    expect(otros?.how).toBe('none')
    expect(otros?.rows.map((r) => richText(r.rich))).toEqual([
      'Reemplaza a Compra #1.',
      'Se guardó junto con Pago #3 (anulado).',
    ])
  })

  it('la fecha de los libros y el aviso aceptado van con «Los libros»', () => {
    const d = doc({
      ...hubFacturaA(),
      accountingDate: '2026-11-01',
      overrideReason: 'el reporte del posnet vino con un día de más',
      period: { id: 'p', month: '2026-11-01', kind: 'month', status: 'closed' },
    })
    expect(node(documentLinks(d, ctx()), 'libros')).toMatchObject({
      period: { text: 'Noviembre 2026: cerrado.', closed: true },
      facts: [
        'En los libros va con fecha 01/11/2026.',
        'Se guardó con un aviso aceptado: «el reporte del posnet vino con un día de más».',
      ],
    })
  })

  it('la foto pide lo que corresponde a cada papel', () => {
    expect(photoHint({ kind: 'purchase', voucherType: 'factura_a' })).toMatch(
      /^Sacale una foto a la factura/,
    )
    expect(photoHint({ kind: 'expense', voucherType: 'sin_comprobante' })).toMatch(
      /^Aunque sea sin factura, la foto del remito o del papelito sirve de respaldo\./,
    )
    expect(photoHint({ kind: 'sales_close', voucherType: null })).toMatch(
      /cierre de lote del posnet/,
    )
    // Donde la foto no «falta», se invita en vez de pedir.
    expect(photoHint({ kind: 'payment', voucherType: null })).toMatch(
      /^Si tenés el comprobante de la transferencia o el recibo, subilo\./,
    )
    expect(photoHint({ kind: 'collection', voucherType: 'liquidacion' })).toMatch(
      /^Si tenés la liquidación, subila\./,
    )
    // Un conteo no deja una liquidación, y una venta propia no es «la factura que te dieron».
    expect(photoHint({ kind: 'collection', voucherType: null, countedCents: 280_176_698 })).toMatch(
      /^Si tenés la captura del saldo, subila\./,
    )
    expect(photoHint({ kind: 'sales_invoice', voucherType: 'factura_a' })).toMatch(
      /^Si tenés el remito o el comprobante firmado, subilo\./,
    )
    for (const kind of DOCUMENT_KINDS) {
      expect(photoHint({ kind, voucherType: null })).toMatch(
        /No cambia ningún número: es el respaldo si un día te lo piden\.$/,
      )
    }
  })
})

// ─── Separar, y la pregunta del gasto fijo ───────────────────────────────────

describe('«Separar» solo donde se puede deshacer bien', () => {
  const compra = hubFacturaA()
  const union = allocation({ amountCents: 1_000 })

  it('compras y pagos, sobre una unión vigente que se hizo después', () => {
    expect(canSeparate(compra, union, true)).toBe(true)
    expect(canSeparate(pago(), union, true)).toBe(true)
    expect(canSeparate({ ...compra, kind: 'purchase_debit_note' }, union, true)).toBe(true)
    expect(canSeparate(compra, { ...union, kind: 'manual', otherDocumentId: null }, true)).toBe(
      true,
    )
  })

  it('nunca para la contadora, del lado de los cobros, ni sobre algo anulado', () => {
    expect(canSeparate(compra, union, false)).toBe(false)
    expect(canSeparate({ ...compra, kind: 'sales_invoice' }, union, true)).toBe(false)
    expect(canSeparate({ ...compra, kind: 'collection' }, union, true)).toBe(false)
    expect(canSeparate({ ...compra, kind: 'sales_close' }, union, true)).toBe(false)
    expect(canSeparate({ ...compra, status: 'voided' }, union, true)).toBe(false)
    expect(
      canSeparate(
        { ...compra, reversedBy: link({ seq: 9, title: 'Anulación', kind: 'reversal' }) },
        union,
        true,
      ),
    ).toBe(false)
    expect(canSeparate(compra, { ...union, voidedOn: '2026-10-05' }, true)).toBe(false)
  })

  it('ni las de una anulación, un reemplazo o una nota de crédito, ni lo guardado junto', () => {
    expect(canSeparate(compra, { ...union, kind: 'reversal' }, true)).toBe(false)
    expect(canSeparate(compra, { ...union, kind: 'replace' }, true)).toBe(false)
    expect(canSeparate(compra, { ...union, kind: 'credit_note' }, true)).toBe(false)
    const junto = {
      ...compra,
      bundleSiblings: [link({ id: 'doc-6', seq: 6, title: 'Pago', kind: 'payment' })],
    }
    expect(canSeparate(junto, union, true)).toBe(false)
  })
})

describe('candidatos a gasto fijo', () => {
  const compra = hubFacturaA()
  const alquiler = recurring({ id: 'fijo-1', name: 'Alquiler del local', partyId: 'prov-2' })

  it('mismo proveedor, sin cargar este mes', () => {
    expect(recurringCandidates(compra, [alquiler], TODAY).map((r) => r.id)).toEqual(['fijo-1'])
  })

  it('si el gasto fijo no tiene proveedor, por la misma categoría', () => {
    const porCategoria = recurring({
      id: 'fijo-2',
      name: 'Verduras',
      accountId: 'cuenta-Compras: alimentos',
    })
    expect(recurringCandidates(compra, [porCategoria], TODAY).map((r) => r.id)).toEqual(['fijo-2'])
    const otra = recurring({ id: 'fijo-3', name: 'Luz', accountId: 'cuenta-Energía eléctrica' })
    expect(recurringCandidates(compra, [otra], TODAY)).toEqual([])
  })

  it('no pregunta si es de otro mes, si ya está unido, anulado o no es una compra', () => {
    expect(
      recurringCandidates({ ...compra, accountingDate: '2026-09-30' }, [alquiler], TODAY),
    ).toEqual([])
    expect(
      recurringCandidates({ ...compra, recurringExpenseId: 'fijo-9' }, [alquiler], TODAY),
    ).toEqual([])
    expect(recurringCandidates({ ...compra, status: 'voided' }, [alquiler], TODAY)).toEqual([])
    expect(recurringCandidates({ ...compra, kind: 'payment' }, [alquiler], TODAY)).toEqual([])
  })

  it('ni con gastos fijos de otro proveedor, ya cargados, salteados o apagados', () => {
    const rows = [
      recurring({ id: 'a', name: 'Otro', partyId: 'prov-99' }),
      recurring({ id: 'b', name: 'Cargado', partyId: 'prov-2', monthStatus: 'loaded' }),
      recurring({ id: 'c', name: 'Salteado', partyId: 'prov-2', monthStatus: 'skipped' }),
      recurring({ id: 'd', name: 'Apagado', partyId: 'prov-2', active: false }),
    ]
    expect(recurringCandidates(compra, rows, TODAY)).toEqual([])
    expect(recurringCandidates(compra, [], TODAY)).toEqual([])
  })
})

describe('lo que hay que saber antes de anular', () => {
  it('anular no devuelve el vencimiento de un gasto fijo, y lo importado vuelve a revisarse', () => {
    const fijo = recurring({ id: 'fijo-1', name: 'Alquiler del local' })
    const origin = {
      batchId: 'lote-1',
      source: 'arca_recibidos',
      fileName: 'a.csv',
      uploadedAt: '2026-10-09T14:00:00Z',
      uploadedByName: 'Dueño QA',
      role: 'current' as const,
    }
    expect(voidNotes({ recurringExpenseId: 'fijo-1' }, { recurring: fijo, origin })).toEqual([
      'Es del gasto fijo «Alquiler del local»: al anularlo, el vencimiento no vuelve solo. Después corregí el «Próximo vencimiento» en Gastos fijos.',
      'Vino de un archivo importado: su línea vuelve a quedar para revisar.',
    ])
    expect(
      voidNotes({ recurringExpenseId: 'fijo-1' }, { recurring: 'error', origin: null })[0],
    ).toMatch(/^Es de un gasto fijo: al anularlo/)
    expect(voidNotes({ recurringExpenseId: null }, { recurring: undefined, origin: null })).toEqual(
      [],
    )
  })
})

// ─── Un solo libro: las palabras que no se dicen ─────────────────────────────

describe('ningún texto de la ficha usa las palabras que la sección sacó', () => {
  const FORBIDDEN = [
    'en negro',
    'en blanco',
    'fuera de los libros',
    'ganancia',
    'ganaste',
    'sin comprobante',
    'acreditar',
    'acredit',
    'imputación',
    'ajuste de saldo',
  ]

  /** Todas las cadenas de un valor, sin importar dónde estén. */
  function strings(value: unknown, out: string[] = []): string[] {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) for (const item of value) strings(item, out)
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        // Los ids y las clases no son texto de pantalla.
        if (key === 'key' || key === 'id' || key === 'swatch' || key.endsWith('Id')) continue
        strings(item, out)
      }
    }
    return out
  }

  /** Un comprobante de cada tipo, con las descripciones que hoy guarda el motor. */
  function sampleOf(kind: DocumentKind): DocumentDetail {
    const legacy: Partial<Record<DocumentKind, string>> = {
      purchase: 'Sin comprobante · Verdulería del Mercado',
      expense: 'Remito u otro comprobante (sin factura) · Compras: alimentos',
      collection: 'Ajuste de saldo de Mercado Pago · Mercado Pago',
      treasury_adjustment: 'Ajuste de saldo · Caja · faltante',
      cash_movement: 'Otro egreso · Energía eléctrica · Banco Nación',
      sales_close: 'Cierre del día martes 06/10/2026',
      reversal: 'Anulación de Sin comprobante · Verdulería del Mercado',
    }
    const base = doc({
      kind,
      seq: 7,
      // Como lo guarda la base: el tipo, con sus palabras de siempre («Ajuste de saldo»).
      title: documentKindLabel(kind),
      voucherType: kind === 'purchase' || kind === 'expense' ? 'sin_comprobante' : null,
      partyId: 'prov-1',
      partyName: 'Mercado Pago',
      description: legacy[kind] ?? 'detalle escrito a mano',
      totalCents: 1_000_000,
      openCents: 400_000,
      paymentStatus: 'partial',
      dueDate: '2026-10-01',
      countedCents: 900_000,
      expectedBookCents: 1_000_000,
      lines: [
        line({
          role: 'gross',
          side: 'debit',
          amountCents: 1_000_000,
          accountName: 'Compras: alimentos',
        }),
        treasury('Caja', 600_000, 'out'),
        line({
          role: 'receivable',
          side: 'debit',
          amountCents: 400_000,
          accountName: 'Tarjetas a cobrar',
          partyId: 'part-mp',
          partyName: 'Mercado Pago',
          dueDate: '2026-10-06',
          salesMethodName: 'QR Mercado Pago',
        }),
      ],
      allocations: [
        allocation({ amountCents: 600_000 }),
        allocation({ amountCents: 100, voidedOn: '2026-10-05' }),
      ],
    })
    return { ...base, entry: entryOf(base.lines) }
  }

  it('recorre todos los tipos de comprobante, para quien carga y para la contadora', () => {
    for (const kind of DOCUMENT_KINDS) {
      for (const canWrite of [true, false]) {
        for (const variant of ['vigente', 'anulado'] as const) {
          const sample = sampleOf(kind)
          const d: DocumentDetail =
            variant === 'anulado'
              ? { ...sample, status: 'voided', voidReason: 'estaba dos veces', voidedByName: 'Luz' }
              : sample
          const c = ctx({
            canWrite,
            candidates: [
              recurring({ id: 'fijo-1', name: 'Alquiler del local', partyId: 'prov-1' }),
            ],
            origin: {
              batchId: 'lote-1',
              source: 'mp_release',
              fileName: 'liquidaciones.csv',
              uploadedAt: '2026-10-09T14:00:00Z',
              uploadedByName: 'Dueño QA',
              role: 'current',
            },
          })
          const nodes = documentLinks(d, c)
          const heading = documentHeading(d)
          const texts = strings([
            heading,
            documentBadge(d, TODAY),
            documentHero(d, c),
            documentPaper(d, c),
            documentStamp(d),
            nodes,
            linksTitle(nodes, d, TODAY),
            voidNotes(d, c),
            photoHint(d),
          ])
          for (const text of texts) {
            const lower = text.toLocaleLowerCase('es')
            for (const word of FORBIDDEN) {
              expect(lower, `${kind} · ${variant}: «${text}»`).not.toContain(word)
            }
          }
        }
      }
    }
  })
})
