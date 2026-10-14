// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  documentHero,
  documentLinks,
  linksTitle,
  type StoryContext,
  voidNotes,
} from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/_lib/document-story'
import { documentActions } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/_lib/document-view'
import { ArcaAuthorizationCard } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/[id]/_components/arca-card'
import { DocumentHero } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/[id]/_components/document-hero'
import { DocumentLinks } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/[id]/_components/document-links'
import { DocumentTicket } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/[id]/_components/document-ticket'
import { FixBlock } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/[id]/_components/fix-block'
import { SeparateButton } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/[id]/_components/separate-button'
import ComprobanteLoading from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/[id]/loading'
import { ACTION_PARAM_KEYS } from '@/components/administracion/acciones/types'
import { DocumentAttachments } from '@/components/administracion/adjuntos/document-attachments'
import type { DocumentAttachment } from '@/lib/accounting/queries/attachments'
import type {
  DocumentDetail,
  DocumentLink,
  RecurringExpenseRow,
} from '@/lib/accounting/queries/documents'
import { lineRoleLabel } from '@/lib/accounting/queries/labels'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import type { ArcaVoucherCard } from '@/lib/arca/emit-form'

/**
 * Lo que la ficha de un comprobante DIBUJA: el número con su oración, el papel
 * con su sello, el mapa de vínculos y «¿Hay algo mal?». Y, sobre todo, lo que
 * NO dibuja para quien solo mira: la contadora no ve ningún botón que cargue,
 * pague, cobre, separe, anule o suba un archivo.
 *
 * Los textos los fija `administracion-comprobante-ficha.test.ts`; acá se
 * comprueba que lleguen a la pantalla y que cada control que escribe tenga su
 * guarda.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/bar/administracion/comprobantes/doc-1',
  useSearchParams: () => new URLSearchParams(),
}))
// Las acciones de servidor no corren acá: alcanza con que existan.
vi.mock('@/lib/accounting/actions/documents', () => ({
  voidDocument: vi.fn(),
  reverseDocument: vi.fn(),
  unallocateItem: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/attachments', () => ({
  fetchDocumentAttachmentUrl: vi.fn(),
  removeDocumentAttachment: vi.fn(),
  prepareAttachmentUploads: vi.fn(),
  registerDocumentAttachments: vi.fn(),
}))
vi.mock('@/lib/arca/emit-actions', () => ({
  reconcileArcaVoucher: vi.fn(),
  postAuthorizedArcaVoucher: vi.fn(),
  previewArcaVoucherPosting: vi.fn(),
}))
vi.mock('@/lib/supabase/browser', () => ({ createClient: vi.fn() }))
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => ({
    tenantSlug: 'bar',
    today: '2026-10-13',
    access: { read: true, write: !ui.readOnly, admin: false },
    readOnly: ui.readOnly,
    openAction: () => {},
    closeAction: () => {},
  }),
  useAccountingOptional: () => ({ readOnly: ui.readOnly }),
}))

const TODAY = '2026-10-13'
const BASE = '/bar/administracion'

type Line = DocumentDetail['lines'][number]

let serial = 0
function line(input: Partial<Line> & Pick<Line, 'role' | 'side' | 'amountCents'>): Line {
  serial += 1
  const vatRateBp = input.vatRateBp ?? null
  const taxKind = input.taxKind ?? null
  return {
    id: `renglon-${serial}`,
    lineNo: serial,
    roleLabel: lineRoleLabel(input.role, { vatRateBp, taxKind }),
    accountId: `cuenta-${input.accountName ?? input.role}`,
    accountCode: '5.1.01.01.001',
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

function entryOf(
  lines: readonly Line[],
  open: Readonly<Record<number, number>> = {},
): NonNullable<DocumentDetail['entry']> {
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
    lines: lines.map((l, index) => ({
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
    })),
    debitCents: 0,
    creditCents: 0,
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
    entry: input.entry === undefined ? entryOf(lines) : input.entry,
  }
}

function link(seq: number, title: string, kind: DocumentLink['kind']): DocumentLink {
  return {
    id: `doc-${seq}`,
    seq,
    title,
    kind,
    accountingDate: '2026-10-08',
    totalCents: 0,
    status: 'posted',
  }
}

/** HUB #1: la compra sin factura de $ 120.000, a cuenta corriente, sin pago ni foto. */
function hubSinFactura(): DocumentDetail {
  return doc({
    kind: 'purchase',
    title: 'Compra',
    voucherType: 'sin_comprobante',
    partyId: 'prov-1',
    partyName: 'Verdulería del Mercado',
    dueDate: '2026-10-12',
    description: 'Sin comprobante · Verdulería del Mercado',
    totalCents: 12_000_000,
    openCents: 12_000_000,
    paymentStatus: 'unpaid',
    lines: [
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
    ],
  })
}

/** Una compra con un pago unido después (se puede separar) y una foto. */
function compraConPago(): DocumentDetail {
  return doc({
    ...hubSinFactura(),
    title: 'Factura A 0003-00001100',
    voucherType: 'factura_a',
    totalCents: 121_000_000,
    openCents: 71_000_000,
    paymentStatus: 'partial',
    allocations: [
      {
        id: 'union-1',
        kind: 'payment',
        amountCents: 50_000_000,
        appliedOn: '2026-10-03',
        voidedOn: null,
        otherDocumentId: 'doc-6',
        otherDocumentTitle: 'Pago',
        otherDocumentSeq: 6,
        createdByName: 'Luz',
        createdAt: '2026-10-03T15:00:00Z',
      },
    ],
  })
}

/** Un cierre con una tarjeta que todavía no llegó. */
function cierre(): DocumentDetail {
  return doc({
    kind: 'sales_close',
    seq: 47,
    title: 'Cierre del día',
    issueDate: '2026-10-06',
    accountingDate: '2026-10-06',
    description: 'Cierre del día martes 06/10/2026',
    totalCents: 31_336_700,
    openCents: 19_335_400,
    paymentStatus: 'unpaid',
    lines: [
      line({
        role: 'treasury',
        side: 'debit',
        amountCents: 12_001_300,
        accountName: 'Caja',
        treasuryAccountId: 'caja-1',
        treasuryName: 'Caja',
        salesMethodId: 'medio-efectivo',
        salesMethodName: 'Efectivo',
      }),
      line({
        role: 'receivable',
        side: 'debit',
        amountCents: 19_335_400,
        accountName: 'Tarjetas de débito a cobrar',
        partyId: 'part-debito',
        partyName: 'Tarjetas de débito (Posnet)',
        dueDate: '2026-10-07',
        salesMethodId: 'medio-debito',
        salesMethodName: 'Débito',
        memo: 'Débito',
      }),
      line({
        role: 'sales_uninvoiced',
        side: 'credit',
        amountCents: 31_336_700,
        accountName: 'Ventas salón: sin factura',
      }),
    ],
  })
}

/** Una factura de venta a un cliente, sin cobrar y vencida. */
function facturaDeVenta(): DocumentDetail {
  return doc({
    kind: 'sales_invoice',
    title: 'Factura A 0003-00000001',
    voucherType: 'factura_a',
    partyId: 'cli-1',
    partyName: 'Estudio Roca',
    dueDate: '2026-10-12',
    totalCents: 10_000_000,
    openCents: 10_000_000,
    paymentStatus: 'unpaid',
    lines: [
      line({
        role: 'control',
        side: 'debit',
        amountCents: 10_000_000,
        accountName: 'Clientes',
        partyId: 'cli-1',
        partyName: 'Estudio Roca',
        dueDate: '2026-10-12',
      }),
      line({
        role: 'sales_invoiced',
        side: 'credit',
        amountCents: 10_000_000,
        accountName: 'Ventas salón',
      }),
    ],
  })
}

/** Un pago que se unió después a una factura (desde el pago también se puede separar). */
function pagoUnido(): DocumentDetail {
  return doc({
    kind: 'payment',
    seq: 6,
    title: 'Pago',
    partyId: 'prov-1',
    partyName: 'Verdulería del Mercado',
    totalCents: 50_000_000,
    openCents: 0,
    lines: [
      line({
        role: 'control',
        side: 'debit',
        amountCents: 50_000_000,
        accountName: 'Proveedores',
        partyId: 'prov-1',
        partyName: 'Verdulería del Mercado',
      }),
      line({
        role: 'treasury',
        side: 'credit',
        amountCents: 50_000_000,
        accountName: 'Caja',
        treasuryAccountId: 'caja-1',
        treasuryName: 'Caja',
      }),
    ],
    allocations: [
      {
        id: 'union-1',
        kind: 'payment',
        amountCents: 50_000_000,
        appliedOn: '2026-10-03',
        voidedOn: null,
        otherDocumentId: 'doc-2',
        otherDocumentTitle: 'Factura A 0003-00001100',
        otherDocumentSeq: 2,
        createdByName: 'Luz',
        createdAt: '2026-10-03T15:00:00Z',
      },
    ],
  })
}

/** El alquiler de este mes, que sigue sin cargar: el candidato de «¿Era…?». */
const ALQUILER: RecurringExpenseRow = {
  id: 'fijo-1',
  name: 'Alquiler del local',
  partyId: 'prov-1',
  partyName: 'Verdulería del Mercado',
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
}

function ctx(input: Partial<StoryContext> = {}): StoryContext {
  return {
    today: TODAY,
    canWrite: !ui.readOnly,
    treasuryKinds: new Map(),
    recurring: undefined,
    candidates: [],
    origin: null,
    attachments: 0,
    ...input,
  }
}

const NO_FILES: QueryOutcome<DocumentAttachment[]> = { ok: true, data: [] }

const PHOTO: DocumentAttachment = {
  id: 'foto-1',
  documentId: 'doc-1',
  fileName: 'factura.jpg',
  mimeType: 'image/jpeg',
  kind: 'image',
  sizeBytes: 212_000,
  createdAt: '2026-10-13T00:05:00Z',
  url: null,
  urlExpiresAt: 0,
}

/** Una factura que ARCA autorizó pero quedó a medio camino: hay que verificarla y cargarla. */
const ARCA_PENDING: ArcaVoucherCard = {
  id: 'arca-1',
  environment: 'produccion',
  status: 'needs_reconcile',
  statusLabel: 'En verificación',
  label: 'Factura A 0003-00000001',
  cbteTipo: 1,
  pointOfSale: 3,
  number: 1,
  cae: null,
  caeDue: null,
  issueDate: '2026-10-12',
  totalCents: 10_000_000,
  observations: [],
  processedAt: null,
  documentId: 'doc-1',
  canReconcile: true,
  canPost: true,
}

/**
 * El HTML listo para comparar contra texto escrito a mano: con espacios comunes
 * (la plata lleva un espacio duro) y sin las marcas que React pone entre dos
 * textos seguidos.
 */
function text(node: ReactElement): string {
  return renderToString(node).replaceAll(' ', ' ').replaceAll('<!-- -->', '')
}

/** La ficha entera, como la arma la página: plata, papel, vínculos y «¿Hay algo mal?». */
function ficha(
  d: DocumentDetail,
  opts: {
    ctx?: Partial<StoryContext>
    files?: QueryOutcome<DocumentAttachment[]>
    arca?: QueryOutcome<ArcaVoucherCard | null> | null
  } = {},
): string {
  const canWrite = !ui.readOnly
  const files = opts.files ?? NO_FILES
  const c = ctx({ canWrite, attachments: files.ok ? files.data.length : null, ...opts.ctx })
  const nodes = documentLinks(d, c)
  return text(
    createElement(
      'div',
      null,
      createElement(DocumentHero, { hero: documentHero(d, c), base: BASE }),
      createElement(DocumentTicket, { doc: d, ctx: c }),
      createElement(DocumentLinks, {
        tenantSlug: 'bar',
        base: BASE,
        documentId: d.id,
        title: linksTitle(nodes, d, TODAY),
        nodes,
        canWrite,
        attachments: files,
        arcaOutcome: opts.arca ?? null,
      }),
      createElement(FixBlock, {
        tenantSlug: 'bar',
        base: BASE,
        doc: d,
        canWrite,
        actions: documentActions(d, canWrite),
        arcaEmitted: false,
        arcaCreditNoteHref: null,
        arcaSibling: null,
        siblings: [],
        appliedCents: null,
        today: TODAY,
        minDate: TODAY,
        ivaMode: null,
        extraNotes: voidNotes(d, c),
      }),
    ),
  )
}

/** Los rótulos de todo lo que escribe en la ficha. */
const WRITE_LABELS = [
  '>Pagar<',
  'Me entró plata',
  'Separar',
  '>Anular<',
  'Anular con fecha de hoy',
  'Agregar foto o PDF',
  'Agregar otra',
  // El botón, no el renglón «Ya llegó» de la cuenta.
  'Ya llegó</button>',
  'Ya pagó</button>',
  'Cargar la nota de crédito',
  'Cargar una nota de crédito',
  'Anularla con una nota de crédito',
  'Armar asiento de ajuste',
  'Verificar con ARCA',
  'Cargarla ahora',
  'aria-label="Quitar',
  // La pregunta del gasto fijo es para quien puede corregirlo.
  '¿Era «',
]

beforeEach(() => {
  ui.readOnly = false
})

describe('la ficha de HUB #1 (una compra sin factura, sin pago ni foto)', () => {
  it('dice qué pasó con la plata, muestra el papel con su sello y qué le falta', () => {
    const html = ficha(hubSinFactura())
    // ① El número con su etiqueta, su oración y el botón del momento.
    expect(html).toContain('Le debés a Verdulería del Mercado')
    expect(html).toContain('120.000')
    expect(html).toContain('Todavía no hay ningún pago anotado: venció ayer, el 12/10.')
    expect(html).toContain('¿Ya lo pagaste? Tocá «Pagar» y elegí con qué')
    expect(html).toContain('>Pagar<')
    // ② El papel, con el sello que mostró la carga y sin renglón de CUIT.
    expect(html).toContain('El comprobante, como quedó guardado')
    expect(html).toContain('Sin factura')
    expect(html).toContain('$ 120.000,00')
    expect(html).toContain('Quedó en tus números, sin factura. No entra al Libro IVA.')
    expect(html).toContain('Cargó Luz · 12/10/2026 21:04 · #1')
    expect(html).not.toContain('CUIT')
    // El sello de un papel guardado no entra de un sellazo: nadie selló recién.
    expect(html).not.toContain('adm-stamp-in')
    // ③ El mapa: el título dice qué falta y cada falta tiene su oración.
    expect(html).toContain('Le faltan el pago y la foto')
    expect(html).toContain('Sin pago anotado todavía.')
    expect(html).toContain('Cuando lo pagues, el pago queda unido acá.')
    expect(html).toContain('Sin foto todavía.')
    expect(html).toContain(
      'Aunque sea sin factura, la foto del remito o del papelito sirve de respaldo.',
    )
    expect(html).toContain('Agregar foto o PDF')
    expect(html).toContain('No entra al Libro IVA.')
    expect(html).toContain('Es sin factura. Queda en tus números igual.')
    expect(html).toContain('Asiento N° 2, provisorio')
    expect(html).toContain('¿Cómo se vincula cada cosa?')
    // ④ Cómo se corrige, por situación.
    expect(html).toContain('¿Hay algo mal?')
    expect(html).toContain('Lo cargué mal.')
    expect(html).toContain('>Anular<')
    expect(html).toContain('Me devolvieron plata o me hicieron un descuento.')
    expect(html).toContain('Cargar la nota de crédito')
  })

  it('las dos faltas llevan la píldora «Falta» y los dos trazos tienen su palabra para lectores', () => {
    const html = ficha(hubSinFactura())
    expect(html.match(/>Falta</g)).toHaveLength(2)
    expect(html).toContain('(lo unís vos)')
    expect(html).toContain('(se une solo)')
    expect(html).toContain('Se une solo')
    expect(html).toContain('Lo unís vos')
  })

  it('nunca dice «sin comprobante», «en negro» ni que algo queda afuera', () => {
    const html = ficha(hubSinFactura()).toLocaleLowerCase('es')
    for (const word of [
      'sin comprobante',
      'en negro',
      'en blanco',
      'fuera de los libros',
      'ganancia',
    ]) {
      expect(html).not.toContain(word)
    }
  })

  it('«Pagar» abre la hoja con el proveedor y la partida (la hoja no tiene que averiguar de quién es)', () => {
    const hero = documentHero(hubSinFactura(), ctx())
    expect(hero.action?.params).toEqual({ proveedor: 'prov-1', partida: 'partida-2' })
  })
})

describe('la contadora (solo lectura) no ve ningún control que escriba', () => {
  beforeEach(() => {
    ui.readOnly = true
  })

  const cases: Array<[string, () => DocumentDetail, Parameters<typeof ficha>[1]]> = [
    ['una compra sin pago ni foto', hubSinFactura, {}],
    [
      'una compra con un pago unido y una foto',
      compraConPago,
      { files: { ok: true, data: [PHOTO] } },
    ],
    ['un cierre con plata que falta llegar', cierre, {}],
    [
      'una compra de un mes cerrado',
      () =>
        doc({
          ...hubSinFactura(),
          period: { id: 'p', month: '2026-09-01', kind: 'month', status: 'closed' },
        }),
      {},
    ],
    ['una factura de venta vencida y sin cobrar', facturaDeVenta, {}],
    [
      'una factura de venta que ARCA dejó a medio autorizar',
      facturaDeVenta,
      { arca: { ok: true, data: ARCA_PENDING }, ctx: { arca: 'ask' } },
    ],
    ['un pago unido a una factura', pagoUnido, {}],
    [
      // Aunque la página no pide los candidatos en solo lectura, si llegaran no se pregunta.
      'una compra que se parece a un gasto fijo sin cargar',
      hubSinFactura,
      { ctx: { candidates: [ALQUILER] } },
    ],
  ]

  for (const [name, build, opts] of cases) {
    it(name, () => {
      const html = ficha(build(), opts)
      for (const label of WRITE_LABELS) {
        expect(html, label).not.toContain(label)
      }
      // Ni un botón ni un campo de archivo: solo links para seguir y pliegues para abrir.
      expect(html).not.toContain('<button')
      expect(html).not.toContain('type="file"')
      expect(html).not.toContain('¿Hay algo mal?')
      expect(html).not.toContain('¿Ya lo pagaste?')
    })
  }

  it('pero ve lo mismo: el número, el papel, las uniones y los links para seguirlas', () => {
    const html = ficha(compraConPago(), { files: { ok: true, data: [PHOTO] } })
    expect(html).toContain('Te falta pagarle a Verdulería del Mercado')
    expect(html).toContain('De $ 1.210.000 ya pagaste $ 500.000')
    expect(html).toContain('Pagaste el 41 %')
    expect(html).toContain('¿Cómo se calcula?')
    expect(html).toContain(`${BASE}/comprobantes/doc-6`)
    expect(html).toContain('factura.jpg')
    expect(html).toContain('Falta pagar $ 710.000,00')
    // Lo de la contadora llega a la vista: de qué tipo es el asiento.
    expect(html).toContain('Común · 12/10/2026')
  })

  it('sin fotos, a la contadora no se le dibuja un nodo «Foto» vacío', () => {
    const html = ficha(hubSinFactura())
    expect(html).not.toContain('Sin foto todavía.')
    expect(html).toContain('Le falta el pago')
    expect(html).not.toContain('Le faltan el pago y la foto')
  })
})

describe('quien carga ve la acción de cada unión', () => {
  it('un pago unido después se puede «Separar»; el avance y la cuenta están a la vista', () => {
    const html = ficha(compraConPago(), { files: { ok: true, data: [PHOTO] } })
    expect(html).toContain('Separar')
    expect(html).toContain('aria-label="Separar Pago #6 de Factura A 0003-00001100"')
    expect(html).toContain('Agregar otra')
    expect(html).toContain('aria-label="Quitar factura.jpg"')
    expect(html).toContain('>Pagar<')
    // Con el pago y la foto, al papel no le falta nada.
    expect(html).toContain('Con qué está unido')
    expect(html).not.toContain('>Falta<')
  })

  it('lo que se guardó junto no se separa: se deshace anulando', () => {
    const d = doc({ ...compraConPago(), bundleSiblings: [link(6, 'Pago', 'payment')] })
    const html = ficha(d)
    expect(html).not.toContain('Separar')
    expect(html).toContain('Se cargó junto con esta compra.')
    expect(html).toContain('Se guardó junto con')
  })

  it('el cierre: cada medio con su estado y «Ya llegó» en lo que falta', () => {
    const html = ficha(cierre())
    expect(html).toContain('Se vendió')
    expect(html).toContain(
      'Entraron $ 120.013 a Caja y quedaron $ 193.354 en camino: todavía no llegó nada.',
    )
    expect(html).toContain('Me entró plata')
    expect(html).toContain('De este día todavía faltan llegar $ 193.354')
    expect(html).toContain('Tendría que haber llegado el 07/10')
    expect(html).toContain('Ya llegó</button>')
    expect(html).toContain('aria-label="Ya llegó: Débito"')
    expect(html).toContain('Con un límite')
    expect(html).toContain(`${BASE}/guias/como-se-vincula#vinculo-cierre-cajas`)
    // El papel es el ticket del cierre, quieto y sin «Cuándo entra».
    expect(html).toContain('Ticket del cierre del martes 06/10')
    expect(html).toContain('Total vendido')
    expect(html).not.toContain('Cuándo entra')
    expect(html).not.toContain('adm-stamp-in')
    // «Sigue en camino» va rayado y con su palabra: todavía no es plata en mano.
    expect(html).toContain('Sigue en camino')
    expect(html).toContain('Lo que está en camino todavía no es plata en mano.')
  })

  it('una factura de venta: «Me entró plata» con el cliente y la partida, y la nota de crédito en palabras de quien vende', () => {
    const d = facturaDeVenta()
    const html = ficha(d)
    expect(html).toContain('Te debe Estudio Roca')
    expect(html).toContain('¿Ya te pagó? Tocá «Me entró plata» y elegí a dónde entró.')
    expect(html).toContain('Me entró plata</button>')
    expect(documentHero(d, ctx()).action).toEqual({
      action: 'cobrar',
      label: 'Me entró plata',
      params: { cliente: 'cli-1', partida: 'partida-1' },
    })
    expect(html).toContain('Sin cobro anotado todavía.')
    expect(html).toContain('Le devolví plata o le hice un descuento.')
    // Del lado de los cobros no hay «Separar»: se anula el cobro y se carga de nuevo.
    expect(html).not.toContain('Separar')
  })

  it('desde el pago también se separa, nombrando el pago y la factura', () => {
    const html = ficha(pagoUnido())
    expect(html).toContain('Qué pagó')
    expect(html).toContain('aria-label="Separar Pago #6 de Factura A 0003-00001100 #2"')
  })

  it('«¿Era el alquiler?»: la pregunta y el camino, sin prometer unirlo después', () => {
    const html = ficha(hubSinFactura(), { ctx: { candidates: [ALQUILER] } })
    expect(html).toContain('¿Era «Alquiler del local»? Vence el 10/10 y sigue sin cargar.')
    expect(html).toContain('Ir a Gastos fijos')
    // No es una falta: el título sigue nombrando solo el pago y la foto.
    expect(html).toContain('Le faltan el pago y la foto')
    expect(html.match(/>Falta</g)).toHaveLength(2)
  })

  it('una factura que ARCA dejó a medio autorizar: los dos botones para resolverla', () => {
    const html = ficha(facturaDeVenta(), {
      arca: { ok: true, data: ARCA_PENDING },
      ctx: { arca: 'ask' },
    })
    expect(html).toContain('Todavía sin CAE')
    expect(html).toContain('Verificar con ARCA')
    expect(html).toContain('Cargarla ahora')
  })

  it('un mes cerrado ofrece las tres salidas, cada una con su situación', () => {
    const d = doc({
      ...hubSinFactura(),
      period: { id: 'p', month: '2026-09-01', kind: 'month', status: 'closed' },
    })
    const html = ficha(d)
    expect(html).toContain('Septiembre 2026 está cerrado:')
    expect(html).toContain('Cargar una nota de crédito')
    expect(html).toContain('Anular con fecha de hoy')
    expect(html).toContain('Armar asiento de ajuste')
    expect(html).toContain('Septiembre 2026 no cambia: se carga la anulación con fecha de hoy.')
    expect(html).not.toContain('>Anular<')
  })
})

describe('un comprobante anulado', () => {
  const anulado = () =>
    doc({
      ...hubSinFactura(),
      status: 'voided',
      paymentStatus: 'voided',
      openCents: null,
      voidedAt: '2026-10-13T15:30:00Z',
      voidedByName: 'Luz',
      voidReason: 'lo cargué dos veces',
    })

  it('lleva la banda «ANULADO», dice quién, cuándo y por qué, y no ofrece ningún botón', () => {
    const html = ficha(anulado())
    expect(html).toContain('>Anulado<')
    expect(html).toContain('Este comprobante está anulado.')
    expect(html).toContain(
      'Lo anuló Luz el 13/10/2026 12:30: «lo cargué dos veces». Ya no cuenta en los libros.',
    )
    expect(html).toContain('Con qué estaba unido')
    for (const label of WRITE_LABELS) {
      expect(html, label).not.toContain(label)
    }
    expect(html).not.toContain('<button')
    expect(html).not.toContain('¿Hay algo mal?')
    expect(html).not.toContain('>Falta<')
  })

  it('anulado con fecha posterior: la banda lo dice en dos renglones', () => {
    const d = doc({ ...hubSinFactura(), reversedBy: link(9, 'Anulación', 'reversal') })
    const html = ficha(d)
    expect(html).toContain('con fecha posterior')
    expect(html).toContain('Este comprobante se anuló con fecha posterior.')
    expect(html).toContain(`${BASE}/comprobantes/doc-9`)
    expect(html).not.toContain('>Pagar<')
    // Ya no cuenta: no le «falta» nada (la foto se sigue ofreciendo, sin píldora).
    expect(html).toContain('Con qué estaba unido')
    expect(html).not.toContain('>Falta<')
    expect(html).toContain('Agregar foto o PDF')
  })
})

describe('las piezas que escriben, una por una', () => {
  it('«Separar» no se dibuja en solo lectura aunque alguien lo monte', () => {
    const props = {
      tenantSlug: 'bar',
      allocationId: 'union-1',
      paymentLabel: 'Pago #6',
      invoiceLabel: 'Factura A 0003-00001100',
      amountCents: 50_000_000,
      partyName: 'Verdulería del Mercado',
    }
    expect(text(createElement(SeparateButton, props))).toContain('Separar')
    ui.readOnly = true
    expect(renderToString(createElement(SeparateButton, props))).toBe('')
  })

  it('las fotos, como cuerpo del nodo: sin tarjeta, y sin botones para quien solo mira', () => {
    const base = { tenantSlug: 'bar', documentId: 'doc-1', bare: true }
    const editable = text(
      createElement(DocumentAttachments, { ...base, attachments: [PHOTO], canEdit: true }),
    )
    expect(editable).not.toContain('Comprobante adjunto')
    expect(editable).toContain('factura.jpg')
    expect(editable).toContain('Agregar otra')
    expect(editable).toContain('aria-label="Quitar factura.jpg"')
    const lectura = text(
      createElement(DocumentAttachments, { ...base, attachments: [PHOTO], canEdit: false }),
    )
    expect(lectura).toContain('factura.jpg')
    expect(lectura).not.toContain('<button')
    expect(lectura).not.toContain('type="file"')
    const error = text(
      createElement(DocumentAttachments, {
        ...base,
        attachments: [],
        canEdit: true,
        loadError: 'Sin conexión: no pudimos cargar esto.',
      }),
    )
    expect(error).toContain('No pudimos leer las fotos de este comprobante.')
    expect(error).toContain('Reintentar')
    expect(error).not.toContain('type="file"')
  })

  it('la tarjeta de siempre de las fotos sigue igual cuando no va `bare`', () => {
    const html = text(
      createElement(DocumentAttachments, {
        tenantSlug: 'bar',
        documentId: 'doc-1',
        attachments: [],
        canEdit: true,
      }),
    )
    expect(html).toContain('Comprobante adjunto')
    expect(html).toContain(
      'Todavía no tiene ningún archivo. Sacale una foto a la factura o subí el PDF.',
    )
  })

  const card: ArcaVoucherCard = {
    id: 'arca-1',
    environment: 'produccion',
    status: 'needs_reconcile',
    statusLabel: 'En verificación',
    label: 'Factura A 0003-00000001',
    cbteTipo: 1,
    pointOfSale: 3,
    number: 1,
    cae: null,
    caeDue: null,
    issueDate: '2026-10-12',
    totalCents: 100_000,
    observations: [],
    processedAt: null,
    documentId: 'doc-1',
    canReconcile: true,
    canPost: false,
  }

  it('ARCA: los botones que escriben son solo para quien carga; «Imprimir factura», para todos', () => {
    const pending = text(
      createElement(ArcaAuthorizationCard, {
        slug: 'bar',
        outcome: { ok: true, data: card },
        canWrite: true,
      }),
    )
    expect(pending).toContain('Verificar con ARCA')
    expect(pending).toContain('ARCA no contestó a tiempo cuando se emitió.')
    const readOnly = text(
      createElement(ArcaAuthorizationCard, {
        slug: 'bar',
        outcome: { ok: true, data: card },
        canWrite: false,
      }),
    )
    expect(readOnly).not.toContain('Verificar con ARCA')
    expect(readOnly).not.toContain('<button')
    const withCae = text(
      createElement(ArcaAuthorizationCard, {
        slug: 'bar',
        outcome: {
          ok: true,
          data: {
            ...card,
            status: 'posted',
            statusLabel: 'Autorizada',
            cae: '74123456789012',
            caeDue: '2026-10-22',
            canReconcile: false,
          },
        },
        canWrite: false,
      }),
    )
    expect(withCae).toContain('74123456789012')
    expect(withCae).toContain('Vence el CAE el 22/10/2026')
    expect(withCae).toContain('Imprimir factura')
    // La nota de crédito de una factura que ya está en ARCA pasó a «¿Hay algo mal?».
    expect(withCae).not.toContain('Anularla con una nota de crédito')
    const failed = text(
      createElement(ArcaAuthorizationCard, {
        slug: 'bar',
        outcome: { ok: false, code: 'error', message: 'Probá de nuevo.' },
        canWrite: true,
      }),
    )
    expect(failed).toContain(
      'No pudimos cargar la autorización de ARCA de este comprobante. Probá de nuevo.',
    )
  })

  it('una factura que ya está en ARCA no se anula desde acá: se corrige con una nota de crédito', () => {
    const d = doc({
      ...hubSinFactura(),
      kind: 'sales_invoice',
      title: 'Factura A 0003-00000001',
      voucherType: 'factura_a',
    })
    const html = text(
      createElement(FixBlock, {
        tenantSlug: 'bar',
        base: BASE,
        doc: d,
        canWrite: true,
        actions: {
          void: false,
          reverse: false,
          creditNote: null,
          adjustment: false,
          settle: 'cobrar',
        },
        arcaEmitted: true,
        arcaCreditNoteHref: `${BASE}/ventas/nueva-factura?tipo=nc&relacionada=doc-1`,
        arcaSibling: null,
        siblings: [],
        appliedCents: null,
        today: TODAY,
        minDate: TODAY,
        ivaMode: null,
        extraNotes: [],
      }),
    )
    expect(html).toContain('Esta factura ya está en ARCA.')
    expect(html).toContain('Anularla con una nota de crédito')
    expect(html).not.toContain('>Anular<')
  })

  it('una nota de crédito que ya está en ARCA no promete otra nota de crédito', () => {
    const d = doc({
      ...facturaDeVenta(),
      kind: 'sales_credit_note',
      title: 'Nota de crédito A 0003-00000002',
      voucherType: 'nota_credito_a',
    })
    const html = text(
      createElement(FixBlock, {
        tenantSlug: 'bar',
        base: BASE,
        doc: d,
        canWrite: true,
        actions: { void: false, reverse: false, creditNote: null, adjustment: false, settle: null },
        arcaEmitted: true,
        arcaCreditNoteHref: null,
        arcaSibling: null,
        siblings: [],
        appliedCents: null,
        today: TODAY,
        minDate: TODAY,
        ivaMode: null,
        extraNotes: [],
      }),
    )
    expect(html).toContain('Esta nota de crédito ya está en ARCA.')
    expect(html).toContain('se corrige emitiendo una nota de débito, también con ARCA.')
    expect(html).not.toContain('Esta factura ya está en ARCA.')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('Anularla con una nota de crédito')
  })

  it('«¿Hay algo mal?» no existe si no hay nada que ofrecer', () => {
    const html = renderToString(
      createElement(FixBlock, {
        tenantSlug: 'bar',
        base: BASE,
        doc: hubSinFactura(),
        canWrite: true,
        actions: { void: false, reverse: false, creditNote: null, adjustment: false, settle: null },
        arcaEmitted: false,
        arcaCreditNoteHref: null,
        arcaSibling: null,
        siblings: [],
        appliedCents: null,
        today: TODAY,
        minDate: TODAY,
        ivaMode: null,
        extraNotes: [],
      }),
    )
    expect(html).toBe('')
  })
})

describe('lo que se manda al servidor es lo de siempre', () => {
  // Sin navegador no se puede apretar el botón: se fija la llamada tal como está escrita.
  // Si alguien cambia una clave del envío, esto lo frena antes de que llegue a la base.
  const source = (path: string) =>
    readFileSync(join(process.cwd(), path), 'utf8').replace(/\s+/g, ' ')
  const FICHA = 'app/(manager)/[tenantSlug]/administracion/comprobantes/[id]/_components'

  it('«Separar» llama a `unallocateItem` con la unión y el motivo, y nada más', () => {
    const code = source(`${FICHA}/separate-button.tsx`)
    expect(code).toContain('unallocateItem(tenantSlug, { allocationId, reason: reason.trim() })')
    expect(code.match(/unallocateItem\(/g)).toHaveLength(1)
    // Antes de mandar valida el motivo con la regla de zod (5 a 300 letras).
    expect(code).toContain('const problem = reasonError(reason)')
  })

  it('«Anular» y «Anular con fecha de hoy» mandan las mismas claves', () => {
    const code = source(`${FICHA}/document-actions.tsx`)
    expect(code).toContain(
      'voidDocument(tenantSlug, { documentId, reason: reason.trim(), withBundle: siblings.length > 0, unallocate, })',
    )
    expect(code).toContain(
      'reverseDocument(tenantSlug, { clientRef, documentId, reason: reason.trim(), reversalDate: date, unallocate, })',
    )
    // «Dejar los pagos a cuenta» arranca según lo aplicado, como siempre.
    expect(code).toContain('setUnallocate(Boolean(appliedCents && appliedCents > 0))')
  })

  it('las fotos: subir y quitar llaman a lo mismo, con y sin tarjeta', () => {
    const code = source('components/administracion/adjuntos/document-attachments.tsx')
    expect(code).toContain(
      'uploadDocumentAttachments(tenantSlug, documentId, files.slice(0, accept))',
    )
    expect(code).toContain('removeDocumentAttachment(tenantSlug, { attachmentId: target.id })')
    expect(code.match(/uploadDocumentAttachments\(/g)).toHaveLength(1)
    expect(code.match(/removeDocumentAttachment\(/g)).toHaveLength(1)
  })

  it('«Pagar», «Me entró plata» y «Ya llegó» abren las hojas con parámetros que ya existían', () => {
    for (const key of ['proveedor', 'cliente', 'partida']) {
      expect(ACTION_PARAM_KEYS).toContain(key)
    }
    const close = cierre()
    const node = documentLinks(close, ctx()).find((n) => n.id === 'en-camino')
    const row = node?.id === 'en-camino' ? node.rows[0] : undefined
    // La partida es el renglón del ASIENTO (lo que la hoja tilda), no el del comprobante.
    expect(row?.action).toEqual({
      label: 'Ya llegó',
      params: { cliente: 'part-debito', partida: 'partida-2' },
    })
    // El botón de arriba de un cierre abre la hoja en blanco.
    expect(documentHero(close, ctx()).action).toEqual({
      action: 'cobrar',
      label: 'Me entró plata',
      params: {},
    })
  })
})

describe('mientras carga', () => {
  it('el esqueleto tiene la forma de la ficha: la plata, el papel y el mapa', () => {
    const html = renderToString(createElement(ComprobanteLoading))
    expect(html).toContain('lg:grid-cols-[minmax(0,1fr)_360px]')
    expect(html).toContain('border-dashed')
    expect(html).not.toContain('<button')
  })
})
