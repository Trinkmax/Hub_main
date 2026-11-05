/**
 * Las herramientas de Contabilidad de Tex. Lo que se fija: un asiento que no cuadra no llega a tique,
 * el de la contadora se arma sin pedirle acceso de carga, anular decide como la ficha y avisa lo que
 * tiene unido, y el cierre manda los avisos y el IVA que se ven.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/accounting/actions/documents', () => ({
  voidDocument: vi.fn(),
  reverseDocument: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/periods', () => ({
  closePeriod: vi.fn(),
  reopenPeriod: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/reimpute', () => ({ reimputeLine: vi.fn() }))
vi.mock('@/lib/accounting/actions/taxes', () => ({ saveTaxSettings: vi.fn() }))
vi.mock('@/lib/accounting/context', () => ({ tryLoadPostingContext: vi.fn() }))
vi.mock('@/lib/accounting/queries/accounts', () => ({ listAccounts: vi.fn() }))
vi.mock('@/lib/accounting/queries/books', () => ({
  getAccountSystemKeys: vi.fn(),
  getPayrollMonthStatus: vi.fn(),
  getTrialBalance: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/document-origin', () => ({ getDocumentOrigin: vi.fn() }))
vi.mock('@/lib/accounting/queries/documents', () => ({
  getDailyCloseCalendar: vi.fn(),
  getDocument: vi.fn(),
  getRecurringExpense: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/parties', async (original) => ({
  ...(await original<typeof import('@/lib/accounting/queries/parties')>()),
  searchParties: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/periods', () => ({
  getCloseChecklist: vi.fn(),
  listFiscalYears: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/settings', () => ({ getAccountingSettings: vi.fn() }))
vi.mock('@/lib/accounting/queries/treasury', () => ({ listTreasuryAccounts: vi.fn() }))
vi.mock('@/lib/accounting/server/document-context', () => ({
  loadDocumentContext: vi.fn(),
  loadFirstOpenDate: vi.fn(),
}))
vi.mock('@/lib/accounting/server/post-document', () => ({
  runPreviewDocument: vi.fn(),
  runPostDocument: vi.fn(),
}))
vi.mock('@/lib/arca/emit-queries', () => ({ getArcaVoucherCard: vi.fn() }))

import { reverseDocument, voidDocument } from '@/lib/accounting/actions/documents'
import { closePeriod, reopenPeriod } from '@/lib/accounting/actions/periods'
import { reimputeLine } from '@/lib/accounting/actions/reimpute'
import { saveTaxSettings } from '@/lib/accounting/actions/taxes'
import {
  getAccountSystemKeys,
  getPayrollMonthStatus,
  getTrialBalance,
} from '@/lib/accounting/queries/books'
import { getDocumentOrigin } from '@/lib/accounting/queries/document-origin'
import {
  type DocumentDetail,
  getDailyCloseCalendar,
  getDocument,
} from '@/lib/accounting/queries/documents'
import {
  type CloseChecklist,
  getCloseChecklist,
  listFiscalYears,
} from '@/lib/accounting/queries/periods'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { reimputeSchema } from '@/lib/accounting/reimpute'
import {
  closePeriodSchema,
  manualEntrySchema,
  reopenSchema,
  reverseSchema,
  voidDocumentSchema,
} from '@/lib/accounting/schemas'
import { loadDocumentContext, loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { runPostDocument, runPreviewDocument } from '@/lib/accounting/server/post-document'
import { DEFAULT_TAX_SETTINGS } from '@/lib/accounting/taxes'
import type { PostingContext } from '@/lib/accounting/types'
import { getArcaVoucherCard } from '@/lib/arca/emit-queries'
import {
  appliedText,
  appliedWordOf,
  bundleText,
  closePeriodValues,
  closeTicketWarnings,
  manualEntryFormValues,
  nextTaxSettings,
  pickReimputeTarget,
  reversalDate,
  reversalIvaText,
  taxChangeRows,
  taxSettingsPayload,
} from '@/lib/tex/tools/actions/_contabilidad-values'
import {
  contabilidadActionTools,
  contabilidadExecutors,
} from '@/lib/tex/tools/actions/contabilidad'
import type { TexExecutor, TexToolContext } from '@/lib/tex/tools/types'
import { CLIENT_REF, prepare } from './accounting-fixtures'
import {
  asError,
  asPrepared,
  documentPayload,
  entryOf,
  expectBalanced,
  expectWellFormed,
  rowValue,
  runTool,
  stubBar,
  TEX_CTX,
  toolNamed,
} from './tex-actions-kit'

const META = { clientRef: CLIENT_REF, previewHash: '0'.repeat(64) }
const DOC = '00000000-0000-4000-8000-0000000000d1'
const SIBLING = '00000000-0000-4000-8000-0000000000d2'
const LINE = '00000000-0000-4000-8000-0000000000f1'
const LINE_2 = '00000000-0000-4000-8000-0000000000f2'

const CONTADORA: TexToolContext = {
  ...TEX_CTX,
  isAccountant: true,
  access: { read: true, write: false, admin: false },
}

function setup(firstOpenDate: string | null = null) {
  const prepared = prepare()
  stubBar(prepared.ctx, firstOpenDate)
  vi.mocked(loadDocumentContext).mockResolvedValue({
    ok: true,
    ctx: prepared.ctx,
    firstOpenDate,
  })
  return prepared
}

function executor(name: string): TexExecutor {
  const found = contabilidadExecutors[name]
  if (!found) throw new Error(`falta el ejecutor ${name}`)
  return found
}

function documentRow(ctx: PostingContext, patch: Partial<DocumentDetail> = {}): DocumentDetail {
  const account = ctx.sys.misc_expenses
  return {
    id: DOC,
    seq: 124,
    bundleId: 'b1',
    kind: 'expense',
    title: 'Gasto',
    partyId: null,
    accountingDate: '2026-10-05',
    totalCents: 100_000,
    status: 'posted',
    period: { id: 'p1', month: '2026-10-01', kind: 'month', status: 'open' },
    reversedBy: null,
    openCents: null,
    recurringExpenseId: null,
    allocations: [],
    bundleSiblings: [],
    fiscalVouchers: [],
    lines: [
      {
        id: LINE,
        lineNo: 1,
        role: 'gross',
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        side: 'debit',
        amountCents: 100_000,
        partyId: null,
        treasuryAccountId: null,
      },
      {
        id: LINE_2,
        lineNo: 2,
        role: 'treasury',
        accountId: ctx.treasuries.values().next().value?.accountId ?? '',
        accountCode: '1.1.01.01.001',
        accountName: 'Caja',
        side: 'credit',
        amountCents: 100_000,
        partyId: null,
        treasuryAccountId: 'caja',
      },
    ],
    ...patch,
  } as unknown as DocumentDetail
}

function checklist(patch: Partial<CloseChecklist> = {}): CloseChecklist {
  return {
    month: '2026-09-01',
    periodId: 'p9',
    fiscalYearId: 'y1',
    startsOn: '2026-09-01',
    endsOn: '2026-09-30',
    status: 'open',
    canClose: true,
    blockers: [],
    warnings: [],
    info: [],
    warningKeys: [],
    entriesCount: 57,
    debitTotalCents: 900_000,
    creditTotalCents: 900_000,
    numberFrom: 1,
    numberTo: 57,
    numberingProvisional: true,
    isLastMonthOfFiscalYear: false,
    iva: null,
    ivaPosition: null,
    closedAt: null,
    closedByName: null,
    raw: {},
    ...patch,
  }
}

const IVA = {
  applies: true,
  mode: 'on_close' as const,
  willGenerate: true,
  replacesDocumentId: null,
  toPayCents: 89_140_000,
  inFavorCents: 0,
  isZero: false,
  settlementDocumentId: null,
  debitFiscal: { totalCents: 100_000_000, byRate: {} },
  creditFiscal: { totalCents: 10_860_000, byRate: {} },
  perceptionsCents: 0,
  withholdingsCents: 0,
  technicalBalanceNewCents: 0,
  freeBalanceNewCents: 0,
}

function stubCloseReads() {
  vi.mocked(getDailyCloseCalendar).mockRejectedValue(new Error('sin dato'))
  vi.mocked(getTrialBalance).mockRejectedValue(new Error('sin dato'))
  vi.mocked(getAccountSystemKeys).mockResolvedValue(new Map())
  vi.mocked(getPayrollMonthStatus).mockResolvedValue({ employees: 0, accrued: false })
  vi.mocked(getAccountingSettings).mockResolvedValue({
    openingStatus: 'posted',
    cuit: '30710000000',
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDocumentOrigin).mockResolvedValue(null)
  vi.mocked(getArcaVoucherCard).mockResolvedValue(null)
  vi.mocked(loadFirstOpenDate).mockResolvedValue(null)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

it('las herramientas se pueden describir para la API', () => {
  expectWellFormed(contabilidadActionTools, contabilidadExecutors)
})

describe('preparar_asiento', () => {
  const input = (patch: Record<string, unknown> = {}) => ({
    concepto: 'Ajuste de la factura',
    respaldo: 'Resumen 123',
    fecha: '2026-10-20',
    lineas: [
      { cuenta: 'Gastos varios', debe: 1000 },
      { cuenta: 'Caja', haber: 1000 },
    ],
    ...patch,
  })

  it('un asiento que no cuadra devuelve error, no tique, y ni mira las cuentas', async () => {
    setup()
    const message = asError(
      await runTool(
        contabilidadActionTools,
        'preparar_asiento',
        input({
          lineas: [
            { cuenta: 'Gastos varios', debe: 1000 },
            { cuenta: 'Caja', haber: 900 },
          ],
        }),
      ),
    )
    expect(message).toContain('El asiento no cuadra')
    expect(message.replace(/\s/g, ' ')).toContain('$ 100,00 en el Haber')
    expect(loadDocumentContext).not.toHaveBeenCalled()
    expect(runPreviewDocument).not.toHaveBeenCalled()
  })

  it('arma el tique con el concepto, la fecha, el respaldo y el asiento tal cual', async () => {
    const { ctx, f } = setup()
    const prepared = asPrepared(await runTool(contabilidadActionTools, 'preparar_asiento', input()))
    expect(prepared.executor).toBe('contabilidad.asiento')
    const payload = documentPayload(prepared)
    expect(payload.form).toBe('manual_entry')
    expect(payload.values).toMatchObject({
      entryKind: 'adjustment',
      date: '2026-10-20',
      description: 'Ajuste de la factura',
      notes: 'Resumen 123',
      correctsDocumentId: null,
      lines: [
        {
          accountId: f.sys('misc_expenses').id,
          debitCents: 100_000,
          creditCents: null,
          partyId: null,
          dueDate: null,
          memo: null,
        },
        {
          accountId: f.acc('1.1.01.01.001').id,
          debitCents: null,
          creditCents: 100_000,
          partyId: null,
        },
      ],
    })
    expect(manualEntrySchema.safeParse({ ...payload.values, ...META }).success).toBe(true)
    expectBalanced(prepared, ctx)
    expect(rowValue(prepared.ticket, 'Concepto')).toBe('Ajuste de la factura')
    expect(rowValue(prepared.ticket, 'Fecha')).toBe('20/10/2026')
    expect(rowValue(prepared.ticket, 'Respaldo')).toBe('Resumen 123')
    expect(prepared.ticket.total).toEqual({ label: 'Total', value: '$ 1.000' })
    expect(entryOf(prepared.ticket)).toEqual([
      [f.sys('misc_expenses').name, '$ 1.000', null],
      ['Caja', null, '$ 1.000'],
    ])
    expect(prepared.ticket.confirmLabel).toBe('Grabar el asiento')
  })

  it('lo usa la contadora: no pasa por la vista previa de escritura y no le ofrece deshacer', async () => {
    setup()
    expect(toolNamed(contabilidadActionTools, 'preparar_asiento').need).toBe('poster')
    const prepared = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_asiento', input(), CONTADORA),
    )
    expect(runPreviewDocument).not.toHaveBeenCalled()

    vi.mocked(runPostDocument).mockResolvedValue({
      ok: true,
      message: 'Asiento guardado.',
      result: {
        bundle_id: 'b',
        replayed: false,
        documents: [
          { ref: 'd1', id: DOC, seq: 1, entry_id: 'e', provisional_number: null, lines: [] },
        ],
        allocations: [],
      },
    })
    const forAccountant = await executor('contabilidad.asiento').run(prepared.payload, CONTADORA)
    expect(runPostDocument).toHaveBeenCalledWith('hub', 'manual_entry', expect.any(Object))
    expect(forAccountant).toMatchObject({ ok: true, documentId: DOC, undoUntil: null })

    const forOwner = await executor('contabilidad.asiento').run(prepared.payload, TEX_CTX)
    expect(forOwner.ok && forOwner.undoUntil).toBeTruthy()
  })

  it('una cuenta con partícipe pide con quién; sin ella, el partícipe no viaja', async () => {
    const { f, ctx } = setup()
    expect(
      asError(
        await runTool(
          contabilidadActionTools,
          'preparar_asiento',
          input({
            lineas: [
              { cuenta: f.sys('payable_suppliers').code, debe: 1000 },
              { cuenta: 'Caja', haber: 1000 },
            ],
          }),
        ),
      ),
    ).toContain('pide con quién')

    const withParty = asPrepared(
      await runTool(
        contabilidadActionTools,
        'preparar_asiento',
        input({
          lineas: [
            {
              cuenta: f.sys('payable_suppliers').code,
              haber: 1000,
              quien: 'Coca-Cola',
              vence: '2026-11-01',
            },
            { cuenta: 'Gastos varios', debe: 1000, quien: 'Coca-Cola', vence: '2026-11-01' },
          ],
        }),
      ),
    )
    const [first, second] = documentPayload(withParty).values.lines as Array<
      Record<string, unknown>
    >
    expect(first).toMatchObject({ partyId: f.party('cocacola').id, dueDate: '2026-11-01' })
    expect(second).toMatchObject({ partyId: null, dueDate: null })
    expectBalanced(withParty, ctx)
  })

  it('una cuenta que no se usa en asientos manuales se rechaza; una ambigua vuelve con opciones', async () => {
    setup()
    expect(
      asError(
        await runTool(
          contabilidadActionTools,
          'preparar_asiento',
          input({
            lineas: [
              { cuenta: 'Mercado Pago SAS', debe: 1000 },
              { cuenta: 'Caja', haber: 1000 },
            ],
          }),
        ),
      ),
    ).toContain('no se usa en asientos manuales')
    expect(
      asError(
        await runTool(
          contabilidadActionTools,
          'preparar_asiento',
          input({
            lineas: [
              { cuenta: 'No existe', debe: 1000 },
              { cuenta: 'Caja', haber: 1000 },
            ],
          }),
        ),
      ),
    ).toContain('buscar_cuenta')
  })

  it('un renglón con Debe y Haber, o sin importe, no pasa', async () => {
    setup()
    expect(
      asError(
        await runTool(
          contabilidadActionTools,
          'preparar_asiento',
          input({
            lineas: [
              { cuenta: 'Gastos varios', debe: 1000, haber: 1000 },
              { cuenta: 'Caja', haber: 0.01, debe: 0.01 },
            ],
          }),
        ),
      ),
    ).toContain('no en los dos')
    expect(
      asError(
        await runTool(
          contabilidadActionTools,
          'preparar_asiento',
          input({ lineas: [{ cuenta: 'Gastos varios' }, { cuenta: 'Caja' }] }),
        ),
      ),
    ).toContain('Falta el importe')
  })

  it('una fecha de un mes cerrado vuelve con lo que dice el motor', async () => {
    setup('2026-10-01')
    expect(
      (await runTool(contabilidadActionTools, 'preparar_asiento', input({ fecha: '2026-09-15' })))
        .kind,
    ).toBe('error')
  })

  it('el ajuste de un comprobante: solo de un mes cerrado', async () => {
    const { ctx } = setup()
    vi.mocked(getDocument).mockResolvedValue(documentRow(ctx))
    expect(
      asError(await runTool(contabilidadActionTools, 'preparar_asiento', input({ corrige: DOC }))),
    ).toContain('mes abierto')

    vi.mocked(getDocument).mockResolvedValue(
      documentRow(ctx, {
        period: { id: 'p', month: '2026-09-01', kind: 'month', status: 'closed' },
      }),
    )
    const prepared = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_asiento', input({ corrige: DOC })),
    )
    expect(documentPayload(prepared).values.correctsDocumentId).toBe(DOC)
    expect(rowValue(prepared.ticket, 'Corrige')).toBe('Gasto #124')
  })

  it('un asiento que mueve IVA lo avisa', async () => {
    const { f } = setup()
    const prepared = asPrepared(
      await runTool(
        contabilidadActionTools,
        'preparar_asiento',
        input({
          lineas: [
            { cuenta: f.sys('vat_credit').code, debe: 1000 },
            { cuenta: 'Caja', haber: 1000 },
          ],
        }),
      ),
    )
    expect(prepared.ticket.warnings.map((w) => w.key)).toContain('moves_vat')
  })

  it('manualEntryFormValues manda lo mismo que la grilla: recorta y saltea lo vacío', () => {
    const values = manualEntryFormValues({
      kind: 'otro',
      date: '2026-10-20',
      description: '  Concepto ',
      lines: [
        {
          accountId: 'a',
          debitCents: 100,
          creditCents: null,
          partyId: null,
          dueDate: null,
          memo: ' x ',
        },
        {
          accountId: null,
          debitCents: null,
          creditCents: null,
          partyId: null,
          dueDate: null,
          memo: '',
        },
      ],
      correctsId: null,
      backing: '  Respaldo ',
    })
    expect(values).toMatchObject({
      entryKind: 'manual',
      description: 'Concepto',
      notes: 'Respaldo',
      lines: [{ accountId: 'a', memo: 'x' }],
    })
    expect(values.lines).toHaveLength(1)
  })
})

describe('preparar_reimputacion', () => {
  it('cambia la cuenta del renglón de imputación: nunca el de la caja', async () => {
    const { ctx, f } = setup()
    vi.mocked(getDocument).mockResolvedValue(documentRow(ctx))
    expect(toolNamed(contabilidadActionTools, 'preparar_reimputacion').need).toBe('poster')
    const prepared = asPrepared(
      await runTool(
        contabilidadActionTools,
        'preparar_reimputacion',
        {
          comprobante: DOC,
          cuenta_nueva: f.sys('bank_fees').code,
          motivo: 'Era del banco',
        },
        CONTADORA,
      ),
    )
    expect(prepared.executor).toBe('contabilidad.reimputar')
    expect(prepared.payload).toEqual({
      lineId: LINE,
      accountId: f.sys('bank_fees').id,
      reason: 'Era del banco',
    })
    expect(reimputeSchema.safeParse(prepared.payload).success).toBe(true)
    expect(prepared.ticket.rows).toEqual([
      { label: 'De', value: f.sys('misc_expenses').name },
      { label: 'A', value: f.sys('bank_fees').name },
      { label: 'Motivo', value: 'Era del banco' },
    ])
    expect(prepared.ticket.total).toEqual({ label: 'Importe', value: '$ 1.000' })

    vi.mocked(reimputeLine).mockResolvedValue({
      ok: true,
      data: {
        documentId: DOC,
        lineId: LINE,
        from: { id: null, code: null, name: null },
        to: { id: null, code: null, name: null },
      },
      message: 'Reimputada.',
    })
    const done = await executor('contabilidad.reimputar').run(prepared.payload, CONTADORA)
    expect(reimputeLine).toHaveBeenCalledWith('hub', prepared.payload)
    expect(done).toMatchObject({ ok: true, href: `/hub/administracion/comprobantes/${DOC}` })
  })

  it('con el mes cerrado, anulado, o a una cuenta que no sirve: no hay tique', async () => {
    const { ctx, f } = setup()
    vi.mocked(getDocument).mockResolvedValue(
      documentRow(ctx, {
        period: { id: 'p', month: '2026-09-01', kind: 'month', status: 'closed' },
      }),
    )
    const input = { comprobante: DOC, cuenta_nueva: f.sys('bank_fees').code }
    expect(
      asError(await runTool(contabilidadActionTools, 'preparar_reimputacion', input)),
    ).toContain('cerrado')

    vi.mocked(getDocument).mockResolvedValue(documentRow(ctx, { status: 'voided' }))
    expect(
      asError(await runTool(contabilidadActionTools, 'preparar_reimputacion', input)),
    ).toContain('anulado')

    vi.mocked(getDocument).mockResolvedValue(documentRow(ctx))
    expect(
      asError(
        await runTool(contabilidadActionTools, 'preparar_reimputacion', {
          comprobante: DOC,
          cuenta_nueva: f.sys('payable_suppliers').code,
        }),
      ),
    ).toContain('no se puede reimputar')
    expect(
      asError(
        await runTool(contabilidadActionTools, 'preparar_reimputacion', {
          comprobante: DOC,
          cuenta_nueva: f.sys('misc_expenses').code,
        }),
      ),
    ).toContain('ya está en')
  })

  it('con varios renglones, pregunta cuál', async () => {
    const { ctx, f } = setup()
    const second = {
      id: LINE_2,
      lineNo: 3,
      role: 'manual',
      accountId: f.sys('bank_fees').id,
      accountCode: f.sys('bank_fees').code,
      accountName: f.sys('bank_fees').name,
      side: 'debit',
      amountCents: 500,
      partyId: null,
      treasuryAccountId: null,
    }
    const doc = documentRow(ctx)
    vi.mocked(getDocument).mockResolvedValue({
      ...doc,
      lines: [...doc.lines, second],
    } as DocumentDetail)
    const input = { comprobante: DOC, cuenta_nueva: f.sys('interest_expense').code }
    expect(
      asError(await runTool(contabilidadActionTools, 'preparar_reimputacion', input)),
    ).toContain('Preguntale cuál')
    const picked = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_reimputacion', {
        ...input,
        cuenta_actual: f.sys('bank_fees').name,
      }),
    )
    expect(picked.payload).toMatchObject({ lineId: LINE_2 })
  })

  it('pickReimputeTarget: por id, por cuenta o el único', () => {
    const target = (lineId: string, accountName: string) => ({
      lineId,
      accountId: lineId,
      accountCode: lineId,
      accountName,
      side: 'debit' as const,
      amountCents: 1,
      usual: null,
    })
    const targets = [target('a', 'Luz'), target('b', 'Agua')]
    expect(pickReimputeTarget(targets, { lineId: 'b' })).toMatchObject({
      ok: true,
      target: { accountName: 'Agua' },
    })
    expect(pickReimputeTarget(targets, {})).toMatchObject({ ok: false })
    expect(pickReimputeTarget([target('a', 'Luz')], {})).toMatchObject({ ok: true })
    expect(pickReimputeTarget(targets, { accountKey: (name) => name === 'Gas' })).toMatchObject({
      ok: false,
      options: targets,
    })
  })
})

describe('preparar_anulacion', () => {
  it('mes abierto, sin nada unido: anula', async () => {
    const { ctx } = setup()
    vi.mocked(getDocument).mockResolvedValue(documentRow(ctx))
    const prepared = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_anulacion', {
        comprobante: DOC,
        motivo: 'Lo cargué dos veces',
      }),
    )
    expect(prepared.executor).toBe('contabilidad.anular')
    expect(prepared.payload).toEqual({
      mode: 'void',
      values: {
        documentId: DOC,
        reason: 'Lo cargué dos veces',
        withBundle: false,
        unallocate: false,
      },
    })
    expect(prepared.ticket.confirmLabel).toBe('Anular')
    expect(prepared.ticket.warnings).toEqual([])
  })

  it('con pagos unidos, el tique lo dice antes de confirmar y los deja a cuenta', async () => {
    const { ctx } = setup()
    vi.mocked(getDocument).mockResolvedValue(
      documentRow(ctx, {
        kind: 'purchase',
        title: 'Factura A 0003-00001290',
        allocations: [
          { id: 'a1', amountCents: 500_000, voidedOn: null },
          { id: 'a2', amountCents: 999, voidedOn: '2026-10-02' },
        ] as DocumentDetail['allocations'],
      }),
    )
    const prepared = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_anulacion', {
        comprobante: DOC,
        motivo: 'Era de otro proveedor',
      }),
    )
    expect(prepared.payload).toMatchObject({ values: { unallocate: true } })
    const [warning] = prepared.ticket.warnings
    expect(warning?.title.replace(/\s/g, ' ')).toBe(
      'Tiene $ 5.000 en pagos unidos. Si lo anulás, quedan a cuenta.',
    )
  })

  it('si la base encuentra imputaciones que no se veían, vuelve al tique con el aviso', async () => {
    const payload = {
      mode: 'void',
      values: { documentId: DOC, reason: 'Lo cargué mal', withBundle: false, unallocate: false },
    }
    vi.mocked(voidDocument).mockResolvedValue({
      ok: false,
      code: 'conflict',
      message:
        'Tiene pagos o cobros aplicados. Si lo anulás, esos pagos quedan a cuenta. ¿Seguimos?',
      detail: { key: 'document_has_allocations' },
    })
    const review = await executor('contabilidad.anular').run(payload, TEX_CTX)
    expect(review).toMatchObject({
      ok: false,
      kind: 'review',
      warnings: [{ key: 'document_has_allocations' }],
      payload: { values: { unallocate: true } },
    })

    // Ya avisado, un rechazo igual no vuelve a preguntar.
    if (review.ok || review.kind !== 'review') throw new Error('tenía que volver al tique')
    const again = await executor('contabilidad.anular').run(review.payload, TEX_CTX)
    expect(again).toMatchObject({ ok: false, kind: 'failed' })

    vi.mocked(voidDocument).mockResolvedValue({
      ok: true,
      data: { voidedDocumentIds: [DOC], unallocatedCount: 1 },
      message: 'Comprobante anulado. Lo que tenía aplicado quedó a cuenta.',
    })
    const done = await executor('contabilidad.anular').run(review.payload, TEX_CTX)
    expect(done).toMatchObject({
      ok: true,
      undoUntil: null,
      href: `/hub/administracion/comprobantes/${DOC}`,
    })
  })

  it('lo que se guardó junto se anula junto, y lo dice', async () => {
    const { ctx } = setup()
    vi.mocked(getDocument).mockResolvedValue(
      documentRow(ctx, {
        kind: 'payment',
        bundleSiblings: [
          { id: SIBLING, seq: 126, title: 'Pago', kind: 'payment', status: 'posted' },
        ] as DocumentDetail['bundleSiblings'],
      }),
    )
    const prepared = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_anulacion', {
        comprobante: DOC,
        motivo: 'Lo cargué mal',
      }),
    )
    expect(prepared.payload).toMatchObject({ values: { withBundle: true } })
    expect(prepared.ticket.warnings.map((w) => w.title)).toEqual([
      'Se guardó junto con Pago #126: se anulan los dos.',
    ])
  })

  it('mes cerrado: anula con fecha de un mes abierto, y avisa cómo entra al Libro IVA', async () => {
    const { ctx } = setup()
    vi.mocked(getDocument).mockResolvedValue(
      documentRow(ctx, {
        accountingDate: '2026-09-15',
        period: { id: 'p', month: '2026-09-01', kind: 'month', status: 'closed' },
        fiscalVouchers: [{ voided: false }] as DocumentDetail['fiscalVouchers'],
      }),
    )
    vi.mocked(loadFirstOpenDate).mockResolvedValue('2026-10-01')
    vi.mocked(getAccountingSettings).mockResolvedValue({
      closedPeriodVoidIvaMode: 'negative_row',
    } as never)
    const prepared = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_anulacion', {
        comprobante: DOC,
        motivo: 'Estaba dos veces',
      }),
    )
    const payload = prepared.payload as { mode: string; values: Record<string, unknown> }
    expect(payload.mode).toBe('reverse')
    expect(payload.values).toMatchObject({
      documentId: DOC,
      reason: 'Estaba dos veces',
      reversalDate: TEX_CTX.today,
      unallocate: false,
    })
    expect(reverseSchema.safeParse(payload.values).success).toBe(true)
    expect(prepared.ticket.title).toBe('Anular con fecha de hoy')
    expect(prepared.ticket.warnings.map((w) => w.title).join(' ')).toContain('en negativo')

    expect(
      asError(
        await runTool(contabilidadActionTools, 'preparar_anulacion', {
          comprobante: DOC,
          motivo: 'Estaba dos veces',
          fecha: '2026-09-20',
        }),
      ),
    ).toContain('entre el 01/10/2026 y hoy')

    vi.mocked(reverseDocument).mockResolvedValue({
      ok: true,
      data: { reversalDocumentId: SIBLING, replayed: false },
      message: 'Comprobante anulado con fecha 31/10/2026.',
    })
    const done = await executor('contabilidad.anular').run(prepared.payload, TEX_CTX)
    expect(reverseDocument).toHaveBeenCalledWith(
      'hub',
      expect.objectContaining({ documentId: DOC }),
    )
    expect(done).toMatchObject({ ok: true })
  })

  it('una factura que ya está en ARCA no se anula desde acá, ni lo que se guardó con ella', async () => {
    const { ctx } = setup()
    vi.mocked(getDocument).mockResolvedValue(documentRow(ctx, { kind: 'sales_invoice' }))
    vi.mocked(getArcaVoucherCard).mockResolvedValue({
      environment: 'produccion',
      status: 'authorized',
    } as never)
    const input = { comprobante: DOC, motivo: 'Lo cargué mal' }
    expect(asError(await runTool(contabilidadActionTools, 'preparar_anulacion', input))).toContain(
      'ARCA',
    )

    vi.mocked(getDocument).mockResolvedValue(
      documentRow(ctx, {
        kind: 'collection',
        bundleSiblings: [
          { id: SIBLING, seq: 2, title: 'Factura', kind: 'sales_invoice', status: 'posted' },
        ] as DocumentDetail['bundleSiblings'],
      }),
    )
    expect(asError(await runTool(contabilidadActionTools, 'preparar_anulacion', input))).toContain(
      'anularlo anularía esa factura',
    )
  })

  it('lo anulado, lo que se deshace reabriendo el mes, o un motivo corto: no hay tique', async () => {
    const { ctx } = setup()
    vi.mocked(getDocument).mockResolvedValue(documentRow(ctx, { status: 'voided' }))
    const input = { comprobante: DOC, motivo: 'Lo cargué mal' }
    expect(asError(await runTool(contabilidadActionTools, 'preparar_anulacion', input))).toContain(
      'ya está anulado',
    )
    vi.mocked(getDocument).mockResolvedValue(documentRow(ctx, { kind: 'iva_settlement' }))
    expect(asError(await runTool(contabilidadActionTools, 'preparar_anulacion', input))).toContain(
      'reabriendo el mes',
    )
    vi.mocked(getDocument).mockResolvedValue(null)
    expect(asError(await runTool(contabilidadActionTools, 'preparar_anulacion', input))).toContain(
      'No encontré',
    )
    const tool = toolNamed(contabilidadActionTools, 'preparar_anulacion')
    expect(tool.input.safeParse({ comprobante: DOC, motivo: 'no' }).success).toBe(false)
  })

  it('los textos de los diálogos y las fechas de la anulación', () => {
    expect(voidDocumentSchema.safeParse({ documentId: DOC, reason: 'corto' }).success).toBe(true)
    expect(appliedWordOf('purchase')).toBe('pagos')
    expect(appliedWordOf('sales_close')).toBe('cobros')
    expect(appliedWordOf('manual')).toBe('pagos o cobros')
    expect(appliedText(null, 'pagos')).toBeNull()
    expect(appliedText(50, 'cobros')?.replace(/\s/g, ' ')).toContain('$ 0,50 en cobros')
    expect(bundleText([])).toBeNull()
    expect(bundleText(['A', 'B'])).toContain('se anula todo junto')
    expect(reversalIvaText({ hasFiscal: false, ivaMode: null, date: '2026-10-31' })).toBeNull()
    expect(
      reversalIvaText({ hasFiscal: true, ivaMode: 'adjustment_only', date: '2026-10-31' }),
    ).toContain('posición de IVA de octubre')
    const base = { today: '2026-10-31', firstOpenDate: '2026-10-01', documentDate: '2026-09-15' }
    expect(reversalDate({ ...base, wanted: undefined })).toEqual({ ok: true, date: '2026-10-31' })
    expect(reversalDate({ ...base, wanted: '2026-11-01' }).ok).toBe(false)
    // Un comprobante de después del primer mes abierto: no antes de él.
    expect(reversalDate({ ...base, documentDate: '2026-10-20', wanted: '2026-10-10' }).ok).toBe(
      false,
    )
  })
})

describe('preparar_cierre_de_mes', () => {
  it('manda los avisos que se ven y el IVA con las cifras que se ven', async () => {
    stubCloseReads()
    const warning = {
      key: 'recurring_not_loaded',
      severity: 'warning' as const,
      label: 'Hay gastos fijos sin cargar.',
      detail: {
        items: [{ recurring_id: 'x', name: 'Alquiler', due_date: '2026-09-10', amount_cents: 100 }],
      },
      amountCents: null,
      count: 1,
    }
    vi.mocked(getCloseChecklist).mockResolvedValue(
      checklist({
        warnings: [warning],
        warningKeys: ['recurring_not_loaded'],
        iva: IVA as unknown as CloseChecklist['iva'],
      }),
    )
    const prepared = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_cierre_de_mes', { mes: '2026-09' }),
    )
    expect(prepared.executor).toBe('contabilidad.cerrar_mes')
    expect(prepared.payload).toEqual({
      month: '2026-09-01',
      warningsAck: ['recurring_not_loaded'],
      ivaSettlement: {
        generate: true,
        expected: {
          debitCents: 100_000_000,
          creditCents: 10_860_000,
          perceptionsCents: 0,
          withholdingsCents: 0,
          toPayCents: 89_140_000,
          technicalBalanceNewCents: 0,
          freeBalanceNewCents: 0,
        },
      },
    })
    expect(closePeriodSchema.safeParse(prepared.payload).success).toBe(true)
    expect(prepared.ticket.title).toBe('Cerrar septiembre')
    expect(prepared.ticket.subtitle).toContain('en octubre')
    expect(prepared.ticket.confirmLabel).toBe('Cerrar septiembre')
    expect(rowValue(prepared.ticket, 'IVA')?.replace(/\s/g, ' ')).toContain('a pagar $ 891.400,00')
    expect(rowValue(prepared.ticket, 'Asientos')).toBe('57')
    // Lo que dice la pantalla: el aviso, con sus gastos fijos, y sin afirmar lo que no se pudo leer.
    const recurring = prepared.ticket.warnings.find((w) => w.key === 'recurring_not_loaded')
    expect(recurring?.title).toBe('Hay gastos fijos de septiembre sin cargar')
    expect(recurring?.body).toContain('Alquiler')
    expect(prepared.ticket.warnings.map((w) => w.key)).toContain('closes_unknown')
  })

  it('se puede cerrar sin anotar el IVA, salvo que haya que reemplazar el que quedó viejo', async () => {
    stubCloseReads()
    vi.mocked(getCloseChecklist).mockResolvedValue(
      checklist({ iva: IVA as unknown as CloseChecklist['iva'] }),
    )
    const off = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_cierre_de_mes', {
        mes: '2026-09',
        anotar_iva: false,
      }),
    )
    expect(off.payload).toMatchObject({ ivaSettlement: { generate: false, expected: null } })
    expect(rowValue(off.ticket, 'IVA')).toBe('Se cierra sin anotar el IVA del mes.')

    vi.mocked(getCloseChecklist).mockResolvedValue(
      checklist({
        iva: { ...IVA, replacesDocumentId: DOC } as unknown as CloseChecklist['iva'],
      }),
    )
    const replaces = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_cierre_de_mes', {
        mes: '2026-09',
        anotar_iva: false,
      }),
    )
    expect(replaces.payload).toMatchObject({ ivaSettlement: { generate: true } })
  })

  it('lo que frena el cierre lleva a la pantalla; y lo cerrado ya está', async () => {
    stubCloseReads()
    vi.mocked(getCloseChecklist).mockResolvedValue(
      checklist({
        canClose: false,
        blockers: [
          {
            key: 'month_not_finished',
            severity: 'blocker',
            label: 'Octubre todavía no terminó.',
            detail: {},
            amountCents: null,
            count: null,
          },
        ],
      }),
    )
    const message = asError(
      await runTool(contabilidadActionTools, 'preparar_cierre_de_mes', { mes: '2026-10' }),
    )
    expect(message).toContain('Octubre todavía no terminó.')
    expect(message).toContain('libros.cierres')

    vi.mocked(getCloseChecklist).mockResolvedValue(checklist({ status: 'closed', canClose: false }))
    expect(
      asError(await runTool(contabilidadActionTools, 'preparar_cierre_de_mes', { mes: '2026-09' })),
    ).toContain('ya está cerrado')
  })

  it('el ejecutor: avisos nuevos y un IVA que cambió vuelven al tique, con lo nuevo', async () => {
    stubCloseReads()
    const payload = {
      month: '2026-09-01',
      warningsAck: [],
      ivaSettlement: { generate: false, expected: null },
    }
    vi.mocked(closePeriod).mockResolvedValue({
      ok: false,
      code: 'needs_confirmation',
      message: 'Hay avisos.',
      closeWarnings: [{ key: 'treasury_negative', message: 'Una caja quedó en negativo.' }],
    })
    const warned = await executor('contabilidad.cerrar_mes').run(payload, TEX_CTX)
    expect(warned).toMatchObject({
      ok: false,
      kind: 'review',
      warnings: [{ key: 'treasury_negative', title: 'Una caja quedó en negativo.' }],
      payload: { warningsAck: ['treasury_negative'] },
    })

    vi.mocked(closePeriod).mockResolvedValue({
      ok: false,
      code: 'preview_stale',
      message: 'Cambió algo.',
    })
    vi.mocked(getCloseChecklist).mockResolvedValue(
      checklist({
        warningKeys: ['sas_cuit_missing'],
        iva: IVA as unknown as CloseChecklist['iva'],
      }),
    )
    const stale = await executor('contabilidad.cerrar_mes').run(
      { ...payload, ivaSettlement: { generate: true, expected: null } },
      TEX_CTX,
    )
    expect(stale).toMatchObject({
      ok: false,
      kind: 'review',
      payload: {
        month: '2026-09-01',
        warningsAck: ['sas_cuit_missing'],
        ivaSettlement: { generate: true, expected: { toPayCents: 89_140_000 } },
      },
    })

    vi.mocked(closePeriod).mockResolvedValue({
      ok: true,
      data: { month: '2026-09-01' } as never,
      message: 'Septiembre cerrado.',
    })
    const done = await executor('contabilidad.cerrar_mes').run(payload, TEX_CTX)
    expect(done).toMatchObject({
      ok: true,
      message: 'Septiembre cerrado.',
      href: '/hub/administracion/libros/cierres',
      undoUntil: null,
    })
  })

  it('closePeriodValues y closeTicketWarnings son lo que hace el botón y la pantalla', () => {
    const expected = {
      debitCents: 1,
      creditCents: 0,
      perceptionsCents: 0,
      withholdingsCents: 0,
      toPayCents: 1,
      technicalBalanceNewCents: 0,
      freeBalanceNewCents: 0,
    }
    expect(
      closePeriodValues({
        month: '2026-09-01',
        warningKeys: ['sas_cuit_missing', 'sas_cuit_missing'],
        iva: null,
        generate: true,
      }),
    ).toEqual({
      month: '2026-09-01',
      warningsAck: ['sas_cuit_missing'],
      ivaSettlement: { generate: false, expected: null },
    })
    expect(
      closePeriodValues({
        month: '2026-09-01',
        warningKeys: [],
        iva: { expected, optional: true },
        generate: false,
      }).ivaSettlement,
    ).toEqual({ generate: false, expected: null })
    const line = {
      actions: [],
      recurring: [],
      more: null,
      note: null,
      help: null,
      detail: null,
      tag: '',
    }
    expect(
      closeTicketWarnings([
        { ...line, key: 'ok', tone: 'ok', title: 'Listo' },
        { ...line, key: 'iva', tone: 'info', title: 'IVA' },
        { ...line, key: 'a', tone: 'warn', title: 'Revisar', detail: 'Por esto' },
      ]),
    ).toEqual([{ key: 'a', title: 'Revisar', body: 'Por esto' }])
  })
})

describe('preparar_reapertura_de_mes', () => {
  const period = (month: string, status: 'open' | 'closed', id = month) => ({
    id,
    fiscalYearId: 'y1',
    kind: 'month',
    month: `${month}-01`,
    startsOn: `${month}-01`,
    endsOn: `${month}-28`,
    status,
  })

  function years(status: 'open' | 'closed' = 'open') {
    return [
      {
        id: 'y1',
        status,
        periods: [
          period('2026-08', 'closed'),
          period('2026-09', 'closed'),
          period('2026-10', 'open'),
        ],
      },
    ] as never
  }

  it('solo el último mes cerrado, con motivo', async () => {
    vi.mocked(listFiscalYears).mockResolvedValue(years())
    const prepared = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_reapertura_de_mes', {
        mes: '2026-09',
        motivo: 'Faltaba una factura del 28',
      }),
    )
    expect(prepared.executor).toBe('contabilidad.reabrir_mes')
    expect(prepared.payload).toEqual({
      month: '2026-09-01',
      reason: 'Faltaba una factura del 28',
    })
    expect(reopenSchema.safeParse(prepared.payload).success).toBe(true)
    expect(prepared.ticket.confirmLabel).toBe('Reabrir septiembre')
    expect(prepared.ticket.warnings[0]?.title).toContain('Se borra la numeración')

    vi.mocked(reopenPeriod).mockResolvedValue({
      ok: true,
      data: { month: '2026-09-01', periodId: 'p', numbersCleared: 1, voidedIvaSettlementIds: [] },
      message: 'Septiembre reabierto.',
    })
    const done = await executor('contabilidad.reabrir_mes').run(prepared.payload, TEX_CTX)
    expect(done).toMatchObject({ ok: true, href: '/hub/administracion/libros/cierres' })

    const input = { motivo: 'Faltaba una factura' }
    expect(
      asError(
        await runTool(contabilidadActionTools, 'preparar_reapertura_de_mes', {
          ...input,
          mes: '2026-08',
        }),
      ),
    ).toContain('último mes cerrado: septiembre')
    expect(
      asError(
        await runTool(contabilidadActionTools, 'preparar_reapertura_de_mes', {
          ...input,
          mes: '2026-10',
        }),
      ),
    ).toContain('no está cerrado')
    expect(
      asError(
        await runTool(contabilidadActionTools, 'preparar_reapertura_de_mes', {
          ...input,
          mes: '2026-01',
        }),
      ),
    ).toContain('no tiene libros')

    vi.mocked(listFiscalYears).mockResolvedValue(years('closed'))
    expect(
      asError(
        await runTool(contabilidadActionTools, 'preparar_reapertura_de_mes', {
          ...input,
          mes: '2026-09',
        }),
      ),
    ).toContain('libros.cierres')
  })
})

describe('preparar_impuestos', () => {
  function stubTaxes(settings = DEFAULT_TAX_SETTINGS) {
    const prepared = prepare()
    stubBar({ ...prepared.ctx, settings: { ...prepared.ctx.settings, taxSettings: settings } })
  }

  it('manda todo lo guardado con lo que cambia, y lo dice de cuánto a cuánto', async () => {
    stubTaxes()
    const prepared = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_impuestos', {
        ingresos_brutos: 3.5,
        base: 'todo',
      }),
    )
    expect(prepared.executor).toBe('contabilidad.impuestos')
    expect(prepared.payload).toEqual({
      auto: true,
      iibbBp: 350,
      municipalBp: 70,
      bankTaxBp: 60,
      base: 'all_sales',
    })
    expect(prepared.ticket.rows).toEqual([
      { label: 'Ingresos Brutos', value: '3 % → 3,5 %' },
      { label: 'Sobre qué', value: 'Todo lo vendido' },
    ])
    expect(prepared.ticket.warnings).toEqual([])

    vi.mocked(saveTaxSettings).mockResolvedValue({
      ok: true,
      data: DEFAULT_TAX_SETTINGS,
      message: 'Impuestos guardados.',
    })
    const done = await executor('contabilidad.impuestos').run(prepared.payload, TEX_CTX)
    expect(saveTaxSettings).toHaveBeenCalledWith('hub', prepared.payload)
    expect(done).toMatchObject({
      ok: true,
      href: '/hub/administracion/ajustes?tab=impuestos',
    })
  })

  it('apagar el cálculo avisa; sin cambios no hay tique', async () => {
    stubTaxes()
    const off = asPrepared(
      await runTool(contabilidadActionTools, 'preparar_impuestos', { calcular_solos: false }),
    )
    expect(off.payload).toMatchObject({ auto: false })
    expect(off.ticket.warnings.map((w) => w.key)).toEqual(['tax_off'])
    expect(
      asError(
        await runTool(contabilidadActionTools, 'preparar_impuestos', { calcular_solos: true }),
      ),
    ).toContain('Ya está así')
    expect(asError(await runTool(contabilidadActionTools, 'preparar_impuestos', {}))).toContain(
      'Ya está así',
    )
  })

  it('el porcentaje de la gente en centésimas de punto, y lo que valida el formulario', () => {
    const next = nextTaxSettings(DEFAULT_TAX_SETTINGS, { municipal: 0.7, bankTax: 0.6, iibb: 2.55 })
    expect(next).toMatchObject({ municipalBp: 70, bankTaxBp: 60, iibbBp: 255 })
    expect(taxSettingsPayload.safeParse(next).success).toBe(true)
    expect(taxSettingsPayload.safeParse({ ...next, iibbBp: 10_001 }).success).toBe(false)
    expect(taxChangeRows(DEFAULT_TAX_SETTINGS, DEFAULT_TAX_SETTINGS)).toEqual([])
  })
})
