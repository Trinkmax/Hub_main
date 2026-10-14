import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupplierInvoicingAsk } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/supplier-invoicing-ask'
import {
  buildPurchaseValues,
  type PurchaseFormState,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/purchase'
import {
  ASK_WHEN_UNKNOWN,
  asksDue,
  asksPaper,
  conditionNoun,
  dueChoices,
  dueLine,
  dueSameDayWarning,
  gapWords,
  INVOICING_CHOICES,
  initialPayNow,
  invoiceLetterChoices,
  invoicingGap,
  newPartyTermToSend,
  otherPaperTypes,
  paperLine,
  paperOfVoucher,
  pendingItemText,
  purchaseDraftMissing,
  purchaseOutcomeNote,
  purchaseStamp,
  purchaseStepStates,
  purchaseSubmitLabel,
  purchaseTotalLabel,
  voucherForPaper,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/purchase-paper'
import {
  QUICK_VOUCHERS,
  type QuickVoucher,
  withRemito,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import {
  defaultVoucherFor,
  notInvoicedDefault,
  voucherOptionsFor,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/vouchers'
import {
  DueChips,
  PayWhenCards,
  TicketBar,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/nueva/_components/purchase-steps'
import { PurchaseTicket } from '@/app/(manager)/[tenantSlug]/administracion/compras/nueva/_components/purchase-ticket'
import NuevaCompraPage from '@/app/(manager)/[tenantSlug]/administracion/compras/nueva/page'
import { PAPER_OPTIONS } from '@/components/administracion/acciones/gasto-papel'
import { pickTreasury, suggestDueDate } from '@/lib/accounting/defaults'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import { IVA_CONDITIONS, type IvaCondition, type VoucherType } from '@/lib/accounting/types'
import { prepare } from './accounting-fixtures'

/**
 * «Cargar una compra que debo», lo nuevo de la pantalla: las cuatro tarjetas de
 * papel escriben un tipo de comprobante que YA se ofrecía, «¿Cómo te factura?»
 * aparece cuando el papel no entra con lo que sabemos del proveedor, y los
 * valores por defecto son los de siempre. Lo que se manda no cambió: lo
 * comprueba el hash de la vista previa de seis compras de ejemplo.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
// La puerta de la página y lo que lee para cargar: acá se contestan a mano (sin base).
const page = vi.hoisted(() => ({ canWrite: true, loadSheetData: vi.fn(), recurring: vi.fn() }))
vi.mock('@/app/(manager)/[tenantSlug]/administracion/compras/_lib/page-access', () => ({
  requireComprasAccess: async () => ({
    access: { tenant: { id: 't-1' } },
    canWrite: page.canWrite,
  }),
}))
vi.mock('@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-actions', () => ({
  loadSheetData: page.loadSheetData,
}))
vi.mock('@/lib/accounting/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/queries')>()),
  listRecurringExpenses: page.recurring,
}))
// El formulario entero no hace falta para saber si la página lo monta o no.
vi.mock(
  '@/app/(manager)/[tenantSlug]/administracion/compras/nueva/_components/purchase-form',
  async () => {
    const { createElement: h } = await import('react')
    return { PurchaseForm: () => h('form', { 'data-purchase-form': '' }) }
  },
)
vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/compras/nueva',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => ({
    tenantSlug: 'hub',
    today: '2026-10-13',
    access: { read: true, write: !ui.readOnly, admin: !ui.readOnly },
    readOnly: ui.readOnly,
    openAction: () => {},
    closeAction: () => {},
  }),
  useAccountingOptional: () => ({ tenantSlug: 'hub', today: '2026-10-13', readOnly: ui.readOnly }),
}))
vi.mock('@/lib/accounting/actions/master', () => ({ saveParty: vi.fn() }))
// «Completar con ARCA» pregunta al servidor si hay ARCA: acá no hace falta.
vi.mock('@/components/administracion/arca-lookup', () => ({
  useArcaLookup: () => ({ reset: () => {} }),
  ArcaLookupTrigger: ({ children }: { children?: unknown }) => children ?? null,
  ArcaLookupPanel: () => null,
}))

afterEach(() => {
  ui.readOnly = false
  page.canWrite = true
  page.loadSheetData.mockReset()
  page.recurring.mockReset()
})

const NB = String.fromCharCode(160)
const PAPERS: readonly QuickVoucher[] = QUICK_VOUCHERS
const FORBIDDEN = ['negro', 'blanco', 'afuera', 'ganancia', 'ganaste']

function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(NB, ' ')
}
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const optionsFor = (condition: IvaCondition | null) =>
  voucherOptionsFor({ family: 'factura', condition })

describe('las cuatro tarjetas escriben un tipo que ya se ofrecía', () => {
  it('para cada condición, cada tarjeta da un tipo de la lista o pregunta', () => {
    for (const condition of IVA_CONDITIONS) {
      const options = optionsFor(condition)
      for (const paper of PAPERS) {
        const type = voucherForPaper(paper, { options, condition })
        if (type === null) {
          // No entra con lo que sabemos: hay que preguntar cómo factura.
          expect(
            invoicingGap({ paper, condition, hasTaxId: true, entersIvaBook: true }),
            `${condition} · ${paper}`,
          ).not.toBeNull()
        } else {
          expect(options, `${condition} · ${paper}`).toContain(type)
        }
      }
    }
  })

  it('ida y vuelta: la tarjeta que escribe un tipo es la que ese tipo marca', () => {
    for (const condition of [...IVA_CONDITIONS, null]) {
      const options = optionsFor(condition)
      for (const paper of PAPERS) {
        const type = voucherForPaper(paper, { options, condition })
        if (type !== null) expect(paperOfVoucher(type), `${condition} · ${paper}`).toBe(paper)
      }
    }
  })

  it('«Remito o nada» escribe lo mismo que escribía «¿Se factura? No»', () => {
    for (const condition of [...IVA_CONDITIONS, null]) {
      const options = optionsFor(condition)
      expect(voucherForPaper('none', { options, condition })).toBe(notInvoicedDefault(options))
    }
    expect(voucherForPaper('none', { options: optionsFor(null), condition: null })).toBe(
      'sin_comprobante',
    )
  })

  it('Factura A, B o C y tique, por condición', () => {
    const ri = optionsFor('responsable_inscripto')
    expect(voucherForPaper('a', { options: ri, condition: 'responsable_inscripto' })).toBe(
      'factura_a',
    )
    expect(voucherForPaper('bc', { options: ri, condition: 'responsable_inscripto' })).toBe(
      'factura_b',
    )
    expect(voucherForPaper('ticket', { options: ri, condition: 'responsable_inscripto' })).toBe(
      'tique',
    )
    const mono = optionsFor('monotributo')
    expect(voucherForPaper('bc', { options: mono, condition: 'monotributo' })).toBe('factura_c')
    expect(voucherForPaper('a', { options: mono, condition: 'monotributo' })).toBeNull()
    const exento = optionsFor('exento')
    expect(voucherForPaper('bc', { options: exento, condition: 'exento' })).toBe('factura_c')
    // Lo que se recuerda del proveedor manda si es una de las dos.
    expect(
      voucherForPaper('bc', { options: exento, condition: 'exento', remembered: 'factura_b' }),
    ).toBe('factura_b')
    expect(
      voucherForPaper('bc', { options: mono, condition: 'monotributo', remembered: 'factura_b' }),
    ).toBe('factura_c')
  })

  it('sin proveedor todavía, las cuatro entran (se supone un responsable inscripto)', () => {
    const options = optionsFor(null)
    expect(PAPERS.map((paper) => voucherForPaper(paper, { options, condition: null }))).toEqual([
      'sin_comprobante',
      'tique',
      'factura_a',
      'factura_b',
    ])
  })

  it('lo que no es ninguna de las cuatro va por «Es otro papel»', () => {
    const others: VoucherType[] = [
      'factura_m',
      'tique_factura_a',
      'recibo_a',
      'otro_comprobante',
      'ddjj_impuesto',
      'nota_credito_a',
      'nota_debito_b',
    ]
    for (const type of others) expect(paperOfVoucher(type), type).toBeNull()
    expect(paperOfVoucher(null)).toBeNull()
    expect(otherPaperTypes(optionsFor('responsable_inscripto'))).toEqual([
      'factura_m',
      'tique_factura_a',
      'tique_factura_b',
      'recibo_a',
      'recibo_b',
      'otro_comprobante',
    ])
    // De quien no sabemos cómo factura, el único «otro» es el otro comprobante.
    expect(otherPaperTypes(optionsFor('sin_datos'))).toEqual(['otro_comprobante'])
  })
})

describe('«¿Cómo te factura?»: cuándo se pregunta', () => {
  const ask = (paper: QuickVoucher | null, condition: IvaCondition, hasTaxId = true) =>
    invoicingGap({ paper, condition, hasTaxId, entersIvaBook: paper === 'a' || paper === 'bc' })

  it('de quien no sabemos nada, una factura abre la pregunta', () => {
    expect(ask('a', 'sin_datos')).toEqual({ kind: 'unknown', suggest: 'responsable_inscripto' })
    expect(ask('bc', 'sin_datos')).toEqual({ kind: 'unknown', suggest: null })
    // El remito y el tique entran directo.
    expect(ask('none', 'sin_datos')).toBeNull()
    expect(ask('ticket', 'sin_datos')).toBeNull()
  })

  it('lo que sabemos no coincide: un monotributista con una Factura A', () => {
    expect(ask('a', 'monotributo')).toEqual({ kind: 'mismatch', suggest: 'responsable_inscripto' })
    expect(ask('a', 'exento')).toEqual({ kind: 'mismatch', suggest: 'responsable_inscripto' })
    expect(ask('bc', 'consumidor_final')).toEqual({ kind: 'mismatch', suggest: null })
    expect(ask('bc', 'monotributo')).toBeNull()
    expect(ask('bc', 'responsable_inscripto')).toBeNull()
  })

  it('sabemos cómo factura pero falta el CUIT, y el papel va al Libro IVA', () => {
    expect(ask('a', 'responsable_inscripto', false)).toEqual({ kind: 'cuit', suggest: null })
    expect(ask('ticket', 'responsable_inscripto', false)).toBeNull()
    expect(ask('none', 'responsable_inscripto', false)).toBeNull()
    // Primero cómo factura; el CUIT se pide en el mismo bloque.
    expect(ask('a', 'sin_datos', false)?.kind).toBe('unknown')
  })

  it('las palabras del bloque', () => {
    expect(
      gapWords(
        { kind: 'unknown', suggest: 'responsable_inscripto' },
        { name: 'Barracuda', condition: 'sin_datos', paper: 'a' },
      ).title,
    ).toBe('¿Cómo te factura Barracuda?')
    const mismatch = gapWords(
      { kind: 'mismatch', suggest: 'responsable_inscripto' },
      { name: 'Barracuda', condition: 'monotributo', paper: 'a' },
    )
    expect(mismatch.title).toBe('Barracuda figura como monotributista')
    expect(mismatch.body).toContain('no da Factura A')
    expect(conditionNoun('responsable_inscripto')).toBe('responsable inscripto')
    expect(INVOICING_CHOICES.map((c) => c.label)).toEqual([
      'Responsable inscripto',
      'Monotributo',
      'Exento',
    ])
  })
})

describe('los valores por defecto no cambiaron', () => {
  it('la alternativa «no proponer cuando no se sabe» está apagada', () => {
    expect(ASK_WHEN_UNKNOWN).toBe(false)
    expect(asksPaper({ condition: 'sin_datos', remembered: null })).toBe(false)
    expect(asksDue({ termDays: 0 })).toBe(false)
  })

  it('prendida, deja sin marcar solo lo que no se sabe', () => {
    expect(asksPaper({ condition: 'sin_datos', remembered: null, ask: true })).toBe(true)
    expect(asksPaper({ condition: 'sin_datos', remembered: 'tique', ask: true })).toBe(false)
    expect(asksPaper({ condition: 'monotributo', remembered: null, ask: true })).toBe(false)
    expect(asksDue({ termDays: 0, ask: true })).toBe(true)
    expect(asksDue({ termDays: 21, ask: true })).toBe(false)
  })

  it('de un proveedor del que no sabemos nada se sigue proponiendo lo de siempre', () => {
    const options = optionsFor('sin_datos')
    const proposed = defaultVoucherFor({
      family: 'factura',
      options,
      remembered: null,
      condition: 'sin_datos',
    })
    expect(proposed).toBe('tique')
    expect(paperOfVoucher(proposed)).toBe('ticket')
  })
})

describe('¿Cuándo vence?: queda marcado el vencimiento que el formulario ya tiene', () => {
  const issueDate = '2026-10-12'
  const active = (choices: ReturnType<typeof dueChoices>) =>
    choices.filter((c) => c.active).map((c) => c.key)

  it('sin plazo, lo propuesto es «El mismo día» (la fecha del papel)', () => {
    const dueDate = suggestDueDate(issueDate, 0)
    const choices = dueChoices({ issueDate, dueDate, termDays: 0 })
    expect(active(choices)).toEqual(['same'])
    expect(choices.map((c) => c.label)).toEqual([
      'El mismo día',
      'En 7 días',
      'En 15 días',
      'En 30 días',
      'Otra fecha',
      'Sin fecha',
    ])
    expect(dueSameDayWarning({ issueDate, dueDate, paying: false })).toBe(true)
    expect(dueSameDayWarning({ issueDate, dueDate, paying: true })).toBe(false)
  })

  it('con plazo en la ficha, «A N días, como siempre»', () => {
    const dueDate = suggestDueDate(issueDate, 21)
    const choices = dueChoices({ issueDate, dueDate, termDays: 21 })
    expect(active(choices)).toEqual(['term'])
    expect(choices[0]).toMatchObject({
      label: 'A 21 días, como siempre',
      value: '2026-11-02',
      days: 21,
    })
  })

  it('si el plazo es uno de los atajos, no se repite', () => {
    const choices = dueChoices({
      issueDate,
      dueDate: suggestDueDate(issueDate, 7),
      termDays: 7,
    })
    expect(choices.map((c) => c.key)).toEqual(['term', 'same', 'd15', 'd30', 'other', 'none'])
    expect(active(choices)).toEqual(['term'])
  })

  it('sin plazo en la ficha pero con costumbre: «como las últimas veces» (sin marcar sola)', () => {
    const choices = dueChoices({
      issueDate,
      dueDate: issueDate,
      termDays: 0,
      suggestedTermDays: 15,
    })
    expect(choices[0]?.label).toBe('A 15 días, como las últimas veces')
    expect(active(choices)).toEqual(['same'])
  })

  it('una fecha a mano es «Otra fecha»; sin fecha, «Sin fecha»', () => {
    expect(active(dueChoices({ issueDate, dueDate: '2026-10-20', termDays: 0 }))).toEqual(['other'])
    expect(active(dueChoices({ issueDate, dueDate: null, termDays: 0 }))).toEqual(['none'])
    expect(active(dueChoices({ issueDate, dueDate: '2026-10-19', termDays: 0 }))).toEqual(['d7'])
  })

  it('sin contestar (la alternativa apagada) no hay ninguna marcada', () => {
    expect(
      active(dueChoices({ issueDate, dueDate: issueDate, termDays: 0, answered: false })),
    ).toEqual([])
  })

  it('sin fecha del papel solo quedan «Otra fecha» y «Sin fecha»', () => {
    expect(dueChoices({ issueDate: null, dueDate: null, termDays: 0 }).map((c) => c.key)).toEqual([
      'other',
      'none',
    ])
  })
})

describe('«Ya lo pagué» arma el mismo pago que «Guardar y pagar…»', () => {
  const treasuries = [
    { id: 't-mp', kind: 'wallet' as const, active: true },
    { id: 't-caja', kind: 'cash' as const, active: true },
    { id: 't-vieja', kind: 'cash' as const, active: false },
  ]

  it('la caja de siempre con ese proveedor, el total, hoy y sin referencia', () => {
    const today = '2026-10-13'
    // Lo que armaba el botón de antes, tal cual.
    const before = {
      treasuryAccountId: pickTreasury({
        treasuries: treasuries.filter((t) => t.active),
        lastUsedWithParty: 't-mp',
        order: treasuries.map((t) => t.id),
      }),
      amountCents: null,
      date: today,
      reference: '',
    }
    expect(initialPayNow({ treasuries, lastUsedWithParty: 't-mp', today })).toEqual(before)
    expect(before.treasuryAccountId).toBe('t-mp')
  })

  it('sin nada recordado va la Caja; una caja desactivada no se propone', () => {
    expect(
      initialPayNow({ treasuries, lastUsedWithParty: null, today: '2026-10-13' }).treasuryAccountId,
    ).toBe('t-caja')
    expect(
      initialPayNow({ treasuries, lastUsedWithParty: 't-vieja', today: '2026-10-13' })
        .treasuryAccountId,
    ).toBe('t-caja')
    expect(
      initialPayNow({ treasuries: [], lastUsedWithParty: null, today: '2026-10-13' })
        .treasuryAccountId,
    ).toBeNull()
  })
})

describe('el ticket: sello, renglones y letra chica', () => {
  it('el sello dice qué papel es, con el mapa de toda la sección', () => {
    expect(purchaseStamp('sin_comprobante')).toEqual({ tone: 'sin', text: 'Sin factura' })
    expect(purchaseStamp('factura_a')).toEqual({ tone: 'factura', text: 'Con factura A' })
    // La M es una A sujeta a retención: sella «A».
    expect(purchaseStamp('factura_m')).toEqual({ tone: 'factura', text: 'Con factura A' })
    expect(purchaseStamp('factura_c')?.text).toBe('Con factura C')
    expect(purchaseStamp('tique')?.text).toBe('Con tique')
    expect(purchaseStamp('recibo_a')?.text).toBe('Con recibo A')
    expect(purchaseStamp('otro_comprobante')?.text).toBe('Con otro comprobante')
    expect(purchaseStamp('nota_credito_a')?.text).toBe('Con nota de crédito A')
    expect(purchaseStamp('nota_debito_a')?.text).toBe('Con nota de débito A')
    expect(purchaseStamp(null)).toBeNull()
  })

  it('«Papel»: el nombre con su número, o el remito', () => {
    expect(
      paperLine({ voucherType: 'factura_a', pos: '0003', number: '00001290', remito: '' }),
    ).toBe('Factura A 0003-00001290')
    expect(paperLine({ voucherType: 'factura_a', pos: '0003', number: '', remito: '' })).toBe(
      'Factura A',
    )
    expect(paperLine({ voucherType: 'sin_comprobante', pos: '', number: '', remito: '' })).toBe(
      'Remito o nada',
    )
    expect(
      paperLine({ voucherType: 'sin_comprobante', pos: '', number: '', remito: ' 0001-55 ' }),
    ).toBe('Remito 0001-55')
    expect(paperLine({ voucherType: null, pos: '', number: '', remito: '' })).toBeNull()
  })

  it('lo que falta, en una oración (nunca un «$ 0»)', () => {
    expect(
      purchaseDraftMissing({
        party: true,
        account: false,
        paper: false,
        number: false,
        total: true,
      }),
    ).toBe('Falta decir a quién le compraste y cuánto es.')
    expect(
      purchaseDraftMissing({ party: true, account: true, paper: true, number: false, total: true }),
    ).toBe('Falta decir a quién le compraste, en qué le comprás, qué papel te dieron y cuánto es.')
    expect(
      purchaseDraftMissing({
        party: false,
        account: false,
        paper: false,
        number: true,
        total: false,
      }),
    ).toBe('Falta el número del papel.')
    expect(
      purchaseDraftMissing({
        party: false,
        account: false,
        paper: false,
        number: false,
        total: false,
      }),
    ).toBeNull()
  })

  const note = (patch: Partial<Parameters<typeof purchaseOutcomeNote>[0]> = {}) =>
    purchaseOutcomeNote({
      docKind: 'purchase',
      supplier: 'Barracuda',
      voucherType: 'factura_a',
      totalCents: 12_000_000,
      paidCents: null,
      priorDebtCents: null,
      ...patch,
    }).replaceAll(NB, ' ')

  it('lo debo: queda en su libreta; con o sin factura, lo que cambia es el Libro IVA', () => {
    expect(note()).toBe('Queda anotado en la libreta de Barracuda. Entra al Libro IVA.')
    expect(note({ voucherType: 'sin_comprobante' })).toBe(
      'Queda anotado en la libreta de Barracuda. Sin factura: queda en tus números y no entra al Libro IVA.',
    )
    expect(note({ priorDebtCents: 333_660_000 })).toBe(
      'Queda anotado en la libreta de Barracuda. Entra al Libro IVA. Con esto le vas a deber $ 3.456.600 en total.',
    )
  })

  it('pagué una parte, pagué todo, y la nota de crédito', () => {
    expect(note({ paidCents: 5_000_000 })).toContain(
      'Pagás $ 50.000 ahora y le quedás debiendo $ 70.000.',
    )
    expect(note({ paidCents: 12_000_000 })).toContain('Queda pagado: con Barracuda no queda deuda.')
    expect(note({ docKind: 'purchase_credit_note', voucherType: 'nota_credito_a' })).toBe(
      'Queda a tu favor con Barracuda: se descuenta en el próximo pago.',
    )
  })

  it('el rótulo del total y el vencimiento', () => {
    expect(purchaseTotalLabel({ docKind: 'purchase', paying: false })).toBe('Le vas a deber')
    expect(purchaseTotalLabel({ docKind: 'purchase', paying: true })).toBe('Pagás ahora')
    expect(purchaseTotalLabel({ docKind: 'purchase_credit_note', paying: false })).toBe(
      'Queda a tu favor',
    )
    expect(dueLine('2026-10-30')).toBe('Vence el 30/10')
    expect(dueLine(null)).toBe('Sin fecha de pago')
  })

  it('el botón dice lo que hace y el importe tal cual se guarda', () => {
    const label = (patch: Partial<Parameters<typeof purchaseSubmitLabel>[0]>) =>
      purchaseSubmitLabel({
        docKind: 'purchase',
        paying: false,
        totalCents: 12_000_000,
        ...patch,
      }).replaceAll(NB, ' ')
    expect(label({})).toBe('Cargar compra · $ 120.000')
    expect(label({ totalCents: null })).toBe('Cargar compra')
    expect(label({ paying: true })).toBe('Cargar y pagar · $ 120.000')
    expect(label({ docKind: 'purchase_credit_note', totalCents: 6_050_000 })).toBe(
      'Cargar nota de crédito · $ 60.500',
    )
    expect(label({ docKind: 'purchase_debit_note', totalCents: 800_050 })).toBe(
      'Cargar nota de débito · $ 8.000,50',
    )
    // Nueve cifras, con centavos: entra entero.
    expect(label({ totalCents: 99_999_999_950 })).toBe('Cargar compra · $ 999.999.999,50')
  })

  it('las secciones se tildan solas: la primera que falta es la que toca', () => {
    expect(purchaseStepStates([false, false, false, false])).toEqual([
      'current',
      'todo',
      'todo',
      'todo',
    ])
    expect(purchaseStepStates([true, false, true, false])).toEqual([
      'done',
      'current',
      'done',
      'todo',
    ])
    expect(purchaseStepStates([true, true, true])).toEqual(['done', 'done', 'done'])
  })

  it('un solo libro: ningún texto dice «negro», «blanco», «afuera» ni «ganancia»', () => {
    const texts = [
      ...PAPER_OPTIONS.flatMap((o) => [o.title, o.consequence]),
      ...INVOICING_CHOICES.flatMap((c) => [c.label, c.hint]),
      note(),
      note({ voucherType: 'sin_comprobante' }),
      note({ paidCents: 12_000_000 }),
      note({ docKind: 'purchase_credit_note' }),
      purchaseStamp('sin_comprobante')?.text ?? '',
      ...Object.values(
        gapWords(
          { kind: 'unknown', suggest: null },
          { name: 'X', condition: 'sin_datos', paper: 'bc' },
        ),
      ),
    ]
      .join(' ')
      .toLowerCase()
    for (const word of FORBIDDEN) expect(texts, word).not.toContain(word)
  })
})

// ─── Lo que se manda es lo mismo ─────────────────────────────────────────────

describe('el envío no cambió: seis compras de ejemplo dan la misma vista previa', () => {
  const { r, ctx } = prepare()
  const base = (patch: Partial<PurchaseFormState> = {}): PurchaseFormState => ({
    party: { kind: 'existing', id: r.party('cocacola') },
    voucherType: 'factura_a',
    pointOfSale: 3,
    number: 1290,
    issueDate: '2026-10-03',
    dueDate: '2026-10-24',
    amountMode: 'total',
    totalCents: 86_000_000,
    vatRateBp: 2100,
    vatAdjustCents: 0,
    accountId: r.account('purchases_soft_drinks'),
    nets: {},
    vatAdjust: {},
    grossCents: null,
    nonTaxedCents: null,
    exemptCents: null,
    internalTaxCents: null,
    percIvaCents: null,
    percIibbCents: null,
    iibbJurisdictionCode: 904,
    percGananciasCents: null,
    otherTaxesCents: null,
    otherTaxesAccountId: null,
    controlTotalCents: null,
    relatedDocumentId: null,
    recurringExpenseId: null,
    payNow: null,
    notes: '',
    ...patch,
  })
  const hashOf = (state: PurchaseFormState) => {
    const built = buildPurchaseValues(state)
    if (!built.values) throw new Error(`faltan datos: ${JSON.stringify(built.missing)}`)
    const form = state.voucherType?.startsWith('nota_credito') ? 'purchase_credit_note' : 'purchase'
    const preview = previewDocumentForm(form, built.values, ctx)
    if (!preview.ok) throw new Error(preview.message)
    return preview.hash
  }
  const riOptions = optionsFor('responsable_inscripto')
  const monoOptions = optionsFor('monotributo')
  const treasuries = [{ id: r.treasury('caja'), kind: 'cash' as const, active: true }]

  it('Factura A a deber: la tarjeta escribe `factura_a`', () => {
    const fromCard = voucherForPaper('a', {
      options: riOptions,
      condition: 'responsable_inscripto',
    })
    expect(fromCard).toBe('factura_a')
    expect(hashOf(base({ voucherType: fromCard }))).toBe(hashOf(base()))
  })

  it('remito a deber: «Remito o nada» escribe `sin_comprobante`, con el n.º en las notas', () => {
    const fromCard = voucherForPaper('none', {
      options: riOptions,
      condition: 'responsable_inscripto',
    })
    const remito = { pointOfSale: null, number: null, notes: withRemito('0001-55', '') }
    expect(hashOf(base({ voucherType: fromCard, ...remito }))).toBe(
      hashOf(base({ voucherType: 'sin_comprobante', ...remito })),
    )
  })

  it('Factura C pagada: «Ya lo pagué» manda el pago de «Guardar y pagar…»', () => {
    const state = (payNow: PurchaseFormState['payNow']) =>
      base({
        party: { kind: 'existing', id: r.party('plomero') },
        voucherType: voucherForPaper('bc', { options: monoOptions, condition: 'monotributo' }),
        totalCents: 4_500_000,
        payNow,
      })
    const before = {
      treasuryAccountId: r.treasury('caja'),
      amountCents: null,
      date: '2026-10-13',
      reference: '',
    }
    const after = initialPayNow({ treasuries, lastUsedWithParty: null, today: '2026-10-13' })
    expect(after).toEqual(before)
    expect(hashOf(state(after))).toBe(hashOf(state(before)))
    // Pagarla no es lo mismo que deberla: el asiento cambia.
    expect(hashOf(state(after))).not.toBe(hashOf(state(null)))
  })

  it('Factura A con percepción, nota de crédito y compra de un gasto fijo: se pueden previsualizar', () => {
    const withPerception = base({
      party: { kind: 'existing', id: r.party('carniceria') },
      vatRateBp: 1050,
      percIibbCents: 250_000,
    })
    const creditNote = base({ voucherType: 'nota_credito_a', number: 15, totalCents: 6_050_000 })
    const fixed = base({ recurringExpenseId: '00000000-0000-4000-8000-0000000000f1' })
    const hashes = [hashOf(withPerception), hashOf(creditNote), hashOf(fixed)]
    // Tres compras distintas dan tres vistas previas distintas, siempre las mismas.
    expect(new Set(hashes).size).toBe(3)
    expect(hashes).toEqual([hashOf(withPerception), hashOf(creditNote), hashOf(fixed)])
    // El gasto fijo viaja en el envío: cambia el hash respecto de la misma compra sin marcar.
    expect(hashOf(fixed)).not.toBe(hashOf(base()))
  })
})

// ─── Lo que se ve armado ─────────────────────────────────────────────────────

const PARTY = {
  id: '00000000-0000-4000-8000-0000000000a1',
  kind: 'supplier' as const,
  name: 'Cervecería y Maltería Barracuda SA',
  tradeName: 'Barracuda',
  ivaCondition: 'sin_datos' as const,
  taxId: null,
  updatedAt: '2026-10-12T10:00:00Z',
}

describe('«¿Cómo te factura?» dibujado', () => {
  const ask = (gap: Parameters<typeof SupplierInvoicingAsk>[0]['gap']) =>
    html(
      createElement(SupplierInvoicingAsk, {
        tenantSlug: 'hub',
        party: PARTY,
        gap,
        paper: 'a',
        onSaved: () => {},
      }),
    )

  it('de quien no sabemos nada: la pregunta, las tres respuestas y «Guardar en su ficha»', () => {
    const out = ask({ kind: 'unknown', suggest: 'responsable_inscripto' })
    const read = text(out)
    expect(read).toContain('¿Cómo te factura Barracuda?')
    for (const label of ['Responsable inscripto', 'Monotributo', 'Exento']) {
      expect(read).toContain(label)
    }
    // Quien da una Factura A es responsable inscripto: viene marcado.
    expect(out).toMatch(/aria-checked="true"[^>]*>Responsable inscripto/)
    expect(read).toContain('Te da Factura A o B.')
    expect(read).toContain('Guardar en su ficha')
  })

  it('con cómo factura sabido y sin CUIT: el aviso corto de siempre', () => {
    const read = text(ask({ kind: 'cuit', suggest: null }))
    expect(read).toContain(
      'Cervecería y Maltería Barracuda SA no tiene CUIT cargado: el Libro IVA lo necesita.',
    )
    expect(read).toContain('Agregar CUIT')
    expect(read).not.toContain('Guardar en su ficha')
  })

  it('la contadora no lo ve', () => {
    ui.readOnly = true
    expect(ask({ kind: 'unknown', suggest: null })).toBe('')
    expect(ask({ kind: 'cuit', suggest: null })).toBe('')
  })
})

describe('el ticket y las preguntas de «¿Cuándo le pagás?»', () => {
  const ticket = (patch: Partial<Parameters<typeof PurchaseTicket>[0]> = {}) =>
    html(
      createElement(PurchaseTicket, {
        supplier: 'Barracuda',
        subtitle: 'Compra del lun 12/10',
        stamp: { tone: 'factura', text: 'Con factura A' },
        stampNonce: 0,
        rows: [
          { key: 'papel', label: 'Papel', value: 'Factura A 0003-00001290' },
          { key: 'en-que', label: 'En qué', value: 'Bebidas con alcohol' },
        ],
        totalLabel: 'Le vas a deber',
        totalCents: 12_000_000,
        totalHint: 'Vence el 30/10',
        note: 'Queda anotado en la libreta de Barracuda. Entra al Libro IVA.',
        pending: false,
        entries: [],
        ...patch,
      }),
    )

  it('completo: a quién, el sello, el total y hasta cuándo', () => {
    const read = text(ticket())
    expect(read).toContain('Barracuda')
    expect(read).toContain('Con factura A')
    expect(read).toContain('Le vas a deber')
    expect(read).toContain('$ 120.000')
    expect(read).toContain('Vence el 30/10')
    expect(read).toContain('Ver cómo queda en los libros')
  })

  it('en borrador no hay «$ 0» ni sello inventado', () => {
    const read = text(
      ticket({
        supplier: null,
        stamp: null,
        totalCents: null,
        totalHint: undefined,
        note: 'Falta decir a quién le compraste y cuánto es.',
        pending: true,
      }),
    )
    expect(read).not.toContain('$ 0')
    expect(read).not.toContain('Con factura')
    expect(read).toContain('Todavía sin importe')
    expect(read).toContain('Falta decir a quién le compraste y cuánto es.')
  })

  it('un nombre de 60 caracteres y nueve cifras entran enteros', () => {
    const long = 'Distribuidora Mayorista de Bebidas y Alimentos del Centro SA'
    const read = text(ticket({ supplier: long, totalCents: 99_999_999_900 }))
    expect(read).toContain(long)
    expect(read).toContain('$ 999.999.999')
  })

  it('las dos respuestas de «¿Cuándo le pagás?», con su consecuencia', () => {
    const out = html(
      createElement(PayWhenCards, { name: 'cuando', paying: false, onChange: () => {} }),
    )
    const read = text(out)
    expect(read).toContain('Más adelante: lo debo')
    expect(read).toContain('Queda anotado en su libreta hasta que le pagues.')
    expect(read).toContain('Ya lo pagué')
    expect(read).toContain('Sale de la caja ahora. No queda deuda.')
    // Por defecto queda a deber: es lo que pasaba si no se tocaba «Guardar y pagar…».
    expect(out).toMatch(/value="despues"[^>]*checked=""|checked=""[^>]*value="despues"/)
  })

  it('los chips de vencimiento marcan uno solo', () => {
    const choices = dueChoices({ issueDate: '2026-10-12', dueDate: '2026-10-12', termDays: 0 })
    const out = html(
      createElement(DueChips, {
        labelId: 'vence',
        choices,
        onPick: () => {},
        dateField: null,
      }),
    )
    expect(out.split('aria-checked="true"').length - 1).toBe(1)
    expect(out).toMatch(/aria-checked="true"[^>]*>El mismo día/)
  })

  it('la barra del celular: el total o una raya, nunca «$ 0»', () => {
    const bar = (cents: number | null) =>
      text(
        html(
          createElement(TicketBar, {
            label: 'Le vas a deber',
            totalCents: cents,
            onOpen: () => {},
          }),
        ),
      )
    expect(bar(12_000_000)).toContain('$ 120.000')
    expect(bar(null)).not.toContain('$ 0')
    expect(bar(0)).not.toContain('$ 0')
    expect(bar(null)).toContain('Ver ticket')
  })
})

// ─── Lo que sumó la auditoría ────────────────────────────────────────────────

describe('todo lo que ofrecía el desplegable de antes se sigue pudiendo elegir', () => {
  it('cada tipo de cada condición sale de una tarjeta, de «¿Es B o C?» o de «Es otro papel»', () => {
    for (const condition of [...IVA_CONDITIONS, null]) {
      const options = optionsFor(condition)
      const reachable = new Set<VoucherType>([
        ...PAPERS.flatMap((paper) => {
          const type = voucherForPaper(paper, { options, condition })
          return type ? [type] : []
        }),
        ...invoiceLetterChoices(options),
        ...otherPaperTypes(options),
      ])
      for (const type of options) {
        expect(reachable.has(type), `${condition ?? 'sin proveedor'} · ${type}`).toBe(true)
      }
    }
  })

  it('un exento puede dar B o C: la tarjeta escribe una y la otra se elige al lado', () => {
    const options = optionsFor('exento')
    expect(invoiceLetterChoices(options)).toEqual(['factura_b', 'factura_c'])
    expect(voucherForPaper('bc', { options, condition: 'exento' })).toBe('factura_c')
    // Con una sola letra posible no hay nada que preguntar.
    expect(invoiceLetterChoices(optionsFor('responsable_inscripto'))).toEqual([])
    expect(invoiceLetterChoices(optionsFor('monotributo'))).toEqual([])
    expect(invoiceLetterChoices(optionsFor('sin_datos'))).toEqual([])
  })
})

describe('el plazo de un proveedor nuevo solo viaja con su tilde a la vista', () => {
  it('sin tocar nada va 0, como siempre', () => {
    expect(newPartyTermToSend(0, null)).toBe(0)
    expect(newPartyTermToSend(0, 7)).toBe(0)
  })

  it('con «Pagarle siempre a 7 días» tildado y a la vista, viaja 7', () => {
    expect(newPartyTermToSend(7, 7)).toBe(7)
  })

  it('si el tilde deja de verse (pagó en el momento, cambió la fecha del papel), vuelve a 0', () => {
    expect(newPartyTermToSend(7, null)).toBe(0)
    expect(newPartyTermToSend(7, 15)).toBe(0)
  })
})

describe('la página de la compra: quién llega al formulario', () => {
  const render = async () =>
    html(
      await NuevaCompraPage({
        params: Promise.resolve({ tenantSlug: 'hub' }),
        searchParams: Promise.resolve({}),
      }),
    )

  it('la contadora ve el cartel y la vuelta a Comprobantes; nada se lee para cargar', async () => {
    page.canWrite = false
    const out = await render()
    const read = text(out)
    expect(read).toContain('Cargar una compra que debo')
    expect(read).toContain('Ir a Comprobantes')
    expect(out).not.toContain('data-purchase-form')
    expect(out).not.toContain('<button')
    expect(page.loadSheetData).not.toHaveBeenCalled()
  })

  it('quien carga llega al formulario, con los que más usa y lo que le debe a cada uno', async () => {
    page.recurring.mockResolvedValue([])
    page.loadSheetData.mockResolvedValue({
      ok: true,
      data: { ctx: { sys: {} } },
    })
    const out = await render()
    expect(out).toContain('data-purchase-form')
    expect(page.loadSheetData).toHaveBeenCalledWith('hub', { suggestions: true, balances: true })
  })
})

describe('cómo se lee una compra pendiente en la hoja de un proveedor', () => {
  it('«Sin comprobante · Nombre» → «Compra sin factura», sin repetir el nombre', () => {
    expect(pendingItemText('Sin comprobante · Fiambres del Sur', ['Fiambres del Sur', null])).toBe(
      'Compra sin factura',
    )
    expect(pendingItemText('Sin comprobante', [])).toBe('Compra sin factura')
  })

  it('una factura queda igual (sin el nombre del proveedor si lo trae)', () => {
    expect(pendingItemText('Factura A 0003-00001290', ['Hielo Cristal'])).toBe(
      'Factura A 0003-00001290',
    )
    expect(pendingItemText('Factura A 0003-00001290 · Hielo Cristal', ['Hielo Cristal'])).toBe(
      'Factura A 0003-00001290',
    )
    expect(pendingItemText('Compra', ['Hielo Cristal'])).toBe('Compra')
  })
})
