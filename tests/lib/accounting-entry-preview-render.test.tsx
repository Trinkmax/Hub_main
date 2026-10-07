// @vitest-environment node
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { type EntryLine, EntryPreview } from '@/components/accounting/entry-preview'
import { toEntryPreview } from '@/lib/accounting/preview'
import type {
  AccountRef,
  DocLine,
  EntryPreviewLine,
  PartyRef,
  ProposedBundle,
  ProposedDocument,
} from '@/lib/accounting/types'

/**
 * `EntryPreview` (kit §3.8; Sprint 1 §I.4) en el HTML del server, con
 * `renderToString` como lo dibuja la primera carga de un formulario contable.
 *
 * Lo que se fija:
 * 1. Tabla Cuenta · Debe · Haber, primero el Debe y las del Haber con la «a».
 * 2. El sello «Cuadra» / «No cuadra · diferencia $ X» en una región
 *    `role="status"` estable que contiene solo la palabra del estado (la
 *    diferencia va afuera: no se anuncia en cada tecla).
 * 3. Importes con dos decimales y los totales con la regla contable.
 * 4. Las líneas del motor (`toEntryPreview`) entran tal cual.
 */

const NBSP = ' '
const MINUS = '−'

/** React escapa `&`, `<`, `>` y comillas: se leen como en el DOM. */
function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

/** El texto visible: sin etiquetas ni los `<!-- -->` que `renderToString` mete entre textos. */
function textOf(html: string): string {
  return unescapeHtml(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ''))
}

/** El elemento entero (con sus hijos) que abre en `start`, contando las etiquetas iguales anidadas. */
function elementAt(html: string, start: number): string {
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))?.[1]
  if (!tag) throw new Error(`No hay un elemento en ${start.toString()}`)
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g')
  re.lastIndex = start
  let depth = 0
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth === 0) return html.slice(start, m.index + m[0].length)
  }
  throw new Error(`<${tag}> sin cerrar`)
}

/** Todos los elementos cuya etiqueta de apertura matchea `attr`. */
function elementsWith(html: string, attr: string): string[] {
  const out: string[] = []
  const re = /<[a-z0-9]+[^>]*>/g
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].includes(attr)) out.push(elementAt(html, m.index))
  }
  return out
}

const one = (html: string, attr: string): string => {
  const found = elementsWith(html, attr)
  expect(found, `un elemento con ${attr}`).toHaveLength(1)
  return found[0] ?? ''
}

/** Factura A de un proveedor: neto + IVA contra Proveedores (en desorden a propósito). */
const PURCHASE: EntryLine[] = [
  {
    id: 'l3',
    accountCode: '2.1.01.01',
    accountName: 'Proveedores',
    creditCents: 12100000,
    partyName: 'Distribuidora del Centro SA',
    dueDate: '2026-10-21',
  },
  {
    id: 'l1',
    accountCode: '5.1.01.02',
    accountName: 'Compras: bebidas sin alcohol',
    debitCents: 10000000,
  },
  { id: 'l2', accountCode: '1.1.03.01', accountName: 'IVA crédito fiscal', debitCents: 2100000 },
]

describe('EntryPreview · tabla Cuenta · Debe · Haber', () => {
  const html = renderToString(<EntryPreview lines={PURCHASE} data-tour="asiento" />)

  it('columnas Cuenta, Debe y Haber, con la tabla nombrada por el título', () => {
    const headers = elementsWith(html, 'data-slot="data-table-header"').map(textOf)
    expect(headers).toEqual(['Cuenta', 'Debe', 'Haber'])
    expect(html).toContain('<caption class="sr-only">Asiento que se va a generar</caption>')
    expect(textOf(one(html, 'data-slot="entry-preview-header"'))).toContain(
      'Asiento que se va a generar',
    )
  })

  it('primero las del Debe y después las del Haber, aunque lleguen mezcladas', () => {
    const sides = [...html.matchAll(/data-side="(debit|credit)"/g)].map((m) => m[1])
    expect(sides).toEqual(['debit', 'debit', 'credit'])
  })

  it('las del Haber llevan la «a» delante y sangría; las del Debe no', () => {
    const rows = elementsWith(html, 'data-side=')
    const credit = rows.find((row) => row.includes('data-side="credit"')) ?? ''
    const debits = rows.filter((row) => row.includes('data-side="debit"'))
    expect(textOf(one(credit, 'data-slot="entry-preview-to"'))).toBe('a')
    expect(textOf(credit)).toMatch(/^a\s*2\.1\.01\.01\s*Proveedores/)
    expect(credit).toContain('ps-[calc(var(--cell-px,1rem)+1rem)]')
    for (const row of debits) expect(row).not.toContain('data-slot="entry-preview-to"')
  })

  it('el código en type-amount y apoyo; el partícipe y el vencimiento debajo', () => {
    const code = elementsWith(html, 'data-slot="entry-preview-code"')[0] ?? ''
    expect(code).toContain('type-amount')
    expect(code).toContain('text-subtle-foreground')
    expect(textOf(one(html, 'data-slot="entry-preview-meta"'))).toBe(
      'Distribuidora del Centro SA · vence 21/10/2026',
    )
  })

  it('importes con dos decimales, sin «$» repetido en las celdas', () => {
    const amounts = elementsWith(html, 'data-slot="amount"').map(textOf)
    // Tres líneas + los dos totales.
    expect(amounts).toEqual(['100.000,00', '21.000,00', '121.000,00', '121.000,00', '121.000,00'])
    expect(amounts.every((a) => /,\d{2}$/.test(a))).toBe(true)
  })

  it('pie con la regla contable y «Debe = Haber» cuando cuadra', () => {
    const foot = one(html, 'data-slot="data-table-foot"')
    const footClass = unescapeHtml(foot.slice(0, foot.indexOf('>')))
    expect(footClass).toContain('[&>tr:first-child>*]:border-t-rule')
    expect(footClass).toContain('[&>tr:last-child>*]:[border-bottom-style:double]')
    expect(textOf(foot)).toContain('Totales')
    expect(textOf(one(foot, 'data-slot="entry-preview-check"'))).toBe('Debe = Haber')
  })

  it('pasa data-tour a la raíz', () => {
    const root = html.slice(0, html.indexOf('>') + 1)
    expect(root).toContain('data-slot="entry-preview"')
    expect(root).toContain('data-tour="asiento"')
    expect(root).toContain('data-status="balanced"')
  })
})

describe('EntryPreview · sello «Cuadra» / «No cuadra» en role="status"', () => {
  it('cuadra: la región dice «Cuadra», con éxito suave y sin diferencia', () => {
    const html = renderToString(<EntryPreview lines={PURCHASE} />)
    const seal = one(html, 'data-slot="balance-seal"')
    const status = one(seal, 'role="status"')
    expect(status).toContain('aria-live="polite"')
    expect(status).toContain('aria-atomic="true"')
    expect(textOf(status)).toBe('Cuadra')
    expect(seal).toContain('data-tone="success"')
    expect(seal).not.toContain('data-slot="balance-diff"')
  })

  it('no cuadra: «No cuadra · diferencia $ 12,40»; la diferencia queda afuera de la región', () => {
    const lines: EntryLine[] = [
      { accountCode: '5.3.02.03', accountName: 'Energía eléctrica', debitCents: 100000 },
      { accountCode: '1.1.01.01', accountName: 'Caja', creditCents: 98760 },
    ]
    const html = renderToString(<EntryPreview lines={lines} />)
    const seal = one(html, 'data-slot="balance-seal"')
    expect(textOf(seal)).toBe(`No cuadra · diferencia $${NBSP}12,40`)
    expect(seal).toContain('data-tone="danger"')
    const status = one(seal, 'role="status"')
    expect(textOf(status)).toBe('No cuadra')
    expect(status).not.toContain('diferencia')
    expect(textOf(one(seal, 'data-slot="balance-diff"'))).toContain(`$${NBSP}12,40`)
    // Sin «Debe = Haber» en el pie, y los totales tal cual.
    expect(html).not.toContain('data-slot="entry-preview-check"')
    const foot = textOf(one(html, 'data-slot="data-table-foot"'))
    expect(foot).toContain('1.000,00')
    expect(foot).toContain('987,60')
  })

  it('la diferencia es siempre positiva (sobra Haber)', () => {
    const lines: EntryLine[] = [
      { accountCode: '1.1.01.01', accountName: 'Caja', debitCents: 5000n },
      { accountCode: '4.1.01.01', accountName: 'Ventas salón: facturadas', creditCents: 6240n },
    ]
    const html = renderToString(<EntryPreview lines={lines} />)
    const seal = textOf(one(html, 'data-slot="balance-seal"'))
    expect(seal).toBe(`No cuadra · diferencia $${NBSP}12,40`)
    expect(seal).not.toContain(MINUS)
  })

  it('sin importes: «Sin importes», el texto de vacío y ninguna tabla', () => {
    const lines: EntryLine[] = [
      { accountCode: '5.3.02.03', accountName: 'Energía eléctrica', debitCents: null },
      { accountCode: '1.1.01.01', accountName: 'Caja', creditCents: 0 },
    ]
    const html = renderToString(<EntryPreview lines={lines} emptyText="Cargá el importe." />)
    expect(textOf(one(html, 'role="status"'))).toBe('Sin importes')
    expect(textOf(one(html, 'data-slot="entry-preview-empty"'))).toBe('Cargá el importe.')
    expect(html).not.toContain('<table')
    expect(html).toContain('data-status="empty"')
  })

  it('título propio, sin códigos y en densidad cómoda', () => {
    const html = renderToString(
      <EntryPreview
        lines={PURCHASE}
        title="Asiento"
        titleAs="h3"
        showCodes={false}
        density="comfortable"
      />,
    )
    expect(html).toContain('<h3 class="type-subtitle text-foreground">Asiento</h3>')
    expect(html).not.toContain('data-slot="entry-preview-code"')
    expect(html).toContain('data-density="comfortable"')
  })
})

// ─── Las líneas del motor entran tal cual ────────────────────────────────────

const ACC_PURCHASE = 'a0000000-0000-4000-8000-000000000001'
const ACC_VAT = 'a0000000-0000-4000-8000-000000000002'
const ACC_SUPPLIERS = 'a0000000-0000-4000-8000-000000000003'
const PARTY = 'b0000000-0000-4000-8000-000000000001'

function account(
  id: string,
  code: string,
  name: string,
  extra: Partial<AccountRef> = {},
): [string, AccountRef] {
  return [
    id,
    {
      id,
      code,
      name,
      type: 'expense',
      normalSide: 'debit',
      postable: true,
      active: true,
      requiresParty: false,
      isTreasury: false,
      purchaseSelectable: false,
      systemKey: null,
      description: null,
      ...extra,
    },
  ]
}

function docLine(
  partial: Pick<DocLine, 'lineNo' | 'accountId' | 'side' | 'amountCents'> & Partial<DocLine>,
): DocLine {
  return {
    role: 'net',
    partyRef: null,
    dueDate: null,
    treasuryAccountId: null,
    salesMethodId: null,
    vatRateBp: null,
    baseCents: null,
    vatComputedCents: null,
    taxKind: null,
    jurisdictionCode: null,
    channel: null,
    certificateNumber: null,
    reference: null,
    memo: '',
    ...partial,
  }
}

const PARTY_REF: PartyRef = {
  id: PARTY,
  kind: 'supplier',
  name: 'Distribuidora del Centro SA',
  tradeName: null,
  taxIdType: 'cuit',
  taxId: '30718765435',
  ivaCondition: 'responsable_inscripto',
  paymentTermDays: 21,
  payableAccountId: ACC_SUPPLIERS,
  receivableAccountId: ACC_SUPPLIERS,
  commissionVatMode: 'none',
  rates: {
    commissionBp: null,
    iibbWithholdingBp: null,
    vatWithholdingBp: null,
    incomeTaxWithholdingBp: null,
    sircupaBp: null,
  },
  active: true,
}

const DOCUMENT: ProposedDocument = {
  ref: 'd1',
  kind: 'purchase',
  entryKind: 'standard',
  voucherType: 'factura_a',
  afipVoucherCode: 1,
  party: { id: PARTY },
  issueDate: '2026-09-30',
  accountingDate: '2026-09-30',
  dueDate: '2026-10-21',
  pointOfSale: 3,
  number: 1290,
  shift: null,
  description: 'Factura A 0003-00001290',
  notes: null,
  totalCents: 12100000,
  controlAccountId: ACC_SUPPLIERS,
  relatedDocument: null,
  replacesDocumentId: null,
  correctsDocumentId: null,
  recurringExpenseId: null,
  settlesCommissions: false,
  countedCents: null,
  expectedBookCents: null,
  warningsAck: [],
  overrideReason: null,
  lines: [
    docLine({
      lineNo: 3,
      role: 'control',
      accountId: ACC_SUPPLIERS,
      side: 'credit',
      amountCents: 12100000,
      partyRef: { id: PARTY },
      dueDate: '2026-10-21',
    }),
    docLine({ lineNo: 1, accountId: ACC_PURCHASE, side: 'debit', amountCents: 10000000 }),
    docLine({ lineNo: 2, role: 'vat', accountId: ACC_VAT, side: 'debit', amountCents: 2100000 }),
  ],
  fiscalVouchers: [],
}

describe('EntryPreview · con las líneas de toEntryPreview (motor)', () => {
  const bundle: ProposedBundle = {
    clientRef: 'c1',
    newParties: [],
    documents: [DOCUMENT],
    allocations: [],
  }
  const ctx = {
    accounts: new Map([
      account(ACC_PURCHASE, '5.1.01.02', 'Compras: bebidas sin alcohol'),
      account(ACC_VAT, '1.1.03.01', 'IVA crédito fiscal', { type: 'asset' }),
      account(ACC_SUPPLIERS, '2.1.01.01', 'Proveedores', {
        type: 'liability',
        normalSide: 'credit',
        requiresParty: true,
      }),
    ]),
    parties: new Map([[PARTY, PARTY_REF]]),
  }
  const [entry] = toEntryPreview(bundle, ctx)
  const lines: EntryPreviewLine[] = entry?.lines ?? []
  const html = renderToString(<EntryPreview lines={lines} />)

  it('dibuja el asiento del motor: Debe primero, la «a» en Proveedores y el partícipe', () => {
    expect(entry?.balanced).toBe(true)
    const rows = elementsWith(html, 'data-side=').map(textOf)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('5.1.01.02')
    expect(rows[1]).toContain('1.1.03.01')
    expect(rows[2]).toMatch(/^a\s*2\.1\.01\.01\s*Proveedores/)
    expect(rows[2]).toContain('Distribuidora del Centro SA · vence 21/10/2026')
    expect(textOf(one(html, 'role="status"'))).toBe('Cuadra')
  })
})
