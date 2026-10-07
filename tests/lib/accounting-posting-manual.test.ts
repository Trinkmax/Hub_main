import { describe, expect, it } from 'vitest'
import {
  buildManualEntry,
  buildPayrollEntry,
  payrollTemplateLines,
} from '@/lib/accounting/posting/manual'
import {
  assertGolden,
  E13,
  E13_MANUAL,
  E20_ADJUSTMENT,
  manualEntryInput,
  payrollInput,
  prepare,
} from './accounting-fixtures'

describe('asiento manual y plantilla de sueldos (E.5.14)', () => {
  it('E13 · sueldos con la plantilla de tres números', () => {
    const { r, ctx, meta } = prepare(E13)
    assertGolden(buildPayrollEntry(E13.input(r), ctx, meta), E13, r)
  })

  it('E13 · el mismo asiento cargado a mano en la grilla', () => {
    const { r, ctx, meta } = prepare(E13_MANUAL)
    assertGolden(buildManualEntry(E13_MANUAL.input(r), ctx, meta), E13_MANUAL, r)
  })

  it('plantilla y grilla dan el mismo hash (las leyendas no cuentan)', () => {
    const a = prepare(E13)
    const b = prepare(E13_MANUAL)
    const template = buildPayrollEntry(E13.input(a.r), a.ctx, a.meta)
    const manual = buildManualEntry(E13_MANUAL.input(b.r), b.ctx, b.meta)
    expect(template.ok && manual.ok).toBe(true)
    if (template.ok && manual.ok) expect(template.hash).toBe(manual.hash)
  })

  it('con cuota sindical: sale del neto y va al sindicato', () => {
    const { r, ctx } = prepare()
    // El sindicato del bar (no está en el contexto base).
    const parties = new Map(ctx.parties)
    const sindicato = {
      ...(ctx.parties.get(r.party('personal')) as NonNullable<ReturnType<typeof ctx.parties.get>>),
      id: '00000000-0000-4000-8000-000000666666',
      kind: 'other' as const,
      name: 'Sindicato y obra social',
      payableAccountId: r.account('union_payable'),
    }
    parties.set(sindicato.id, sindicato)
    const template = payrollTemplateLines(
      payrollInput({
        grossSalariesCents: 450_000_000,
        employerContributionsCents: 108_000_000,
        withheldContributionsCents: 76_500_000,
        unionDuesCents: 9_000_000,
        date: '2026-10-31',
      }),
      { ...ctx, parties },
    )
    expect(template.ok).toBe(true)
    if (!template.ok) return
    expect(
      template.lines.map((l) => [l.accountId, l.debitCents, l.creditCents, l.partyId]),
    ).toEqual([
      [r.account('salaries'), 450_000_000, null, null],
      [r.account('employer_contributions'), 108_000_000, null, null],
      [r.account('payroll_payable'), null, 364_500_000, r.party('personal')],
      [r.account('social_security_payable'), null, 184_500_000, r.party('arcaSs')],
      [r.account('union_payable'), null, 9_000_000, sindicato.id],
    ])
  })

  it('E20 · ajuste de cierre de ejercicio el 31/12 (se carga en febrero)', () => {
    const { r, ctx, meta } = prepare(E20_ADJUSTMENT)
    assertGolden(buildManualEntry(E20_ADJUSTMENT.input(r), ctx, meta), E20_ADJUSTMENT, r)
  })

  it('un ajuste de cierre con otra fecha → `fy_adjustment_date`', () => {
    const { r, ctx, meta } = prepare(E20_ADJUSTMENT)
    const result = buildManualEntry({ ...E20_ADJUSTMENT.input(r), date: '2026-12-30' }, ctx, meta)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('fy_adjustment_date')
  })
})

describe('reglas del asiento manual', () => {
  it('descuadrado → `entry_not_balanced` con los dos totales', () => {
    const { r, ctx, meta } = prepare()
    const result = buildManualEntry(
      {
        ...manualEntryInput({
          date: '2026-10-31',
          description: 'Ajuste',
          lines: [
            { accountId: r.account('misc_expenses'), debitCents: 1_000 },
            { accountId: r.account('other_income'), creditCents: 1_000 },
          ],
        }),
        lines: [
          {
            accountId: r.account('misc_expenses'),
            debitCents: 1_240,
            creditCents: null,
            partyId: null,
            dueDate: null,
            memo: null,
          },
          {
            accountId: r.account('other_income'),
            debitCents: null,
            creditCents: 1_000,
            partyId: null,
            dueDate: null,
            memo: null,
          },
        ],
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        key: 'entry_not_balanced',
        field: 'lines',
        detail: { debit_cents: 1_240, credit_cents: 1_000 },
      })
    }
  })

  it('una sola línea con importe (la otra en cero se descarta) → `entry_too_few_lines`', () => {
    const { r, ctx, meta } = prepare()
    const result = buildManualEntry(
      {
        ...manualEntryInput({
          date: '2026-10-31',
          description: 'Ajuste',
          lines: [
            { accountId: r.account('misc_expenses'), debitCents: 1_000 },
            { accountId: r.account('other_income'), creditCents: 1_000 },
          ],
        }),
        lines: [
          {
            accountId: r.account('misc_expenses'),
            debitCents: 0,
            creditCents: null,
            partyId: null,
            dueDate: null,
            memo: null,
          },
          {
            accountId: r.account('other_income'),
            debitCents: null,
            creditCents: 1_000,
            partyId: null,
            dueDate: null,
            memo: null,
          },
        ],
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('entry_too_few_lines')
  })

  it('una cuenta de control sin partícipe → `account_requires_party`', () => {
    const { r, ctx, meta } = prepare()
    const result = buildManualEntry(
      manualEntryInput({
        date: '2026-10-31',
        description: 'Reclasificación',
        lines: [
          { accountId: r.account('payable_suppliers'), debitCents: 5_000 },
          { accountId: r.account('misc_expenses'), creditCents: 5_000 },
        ],
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('account_requires_party')
  })

  it('corrige un comprobante de un mes cerrado: el vínculo viaja en el documento', () => {
    const { r, ctx, meta } = prepare()
    const result = buildManualEntry(
      manualEntryInput({
        entryKind: 'adjustment',
        date: '2026-10-31',
        description: 'Ajuste de la Factura A 0003-00001290',
        lines: [
          { accountId: r.account('purchases_alcohol'), debitCents: 5_000 },
          { accountId: r.account('purchases_soft_drinks'), creditCents: 5_000 },
        ],
        correctsDocumentId: '00000000-0000-4000-8000-000000910001',
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bundle.documents[0]).toMatchObject({
        entryKind: 'adjustment',
        correctsDocumentId: '00000000-0000-4000-8000-000000910001',
        totalCents: 5_000,
      })
    }
  })
})
