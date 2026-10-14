// @vitest-environment node
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ManualEntryForm,
  manualEntryValues,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/asiento-manual/_components/manual-entry-form'
import {
  EMPTY_PAYROLL,
  type PayrollInputs,
  payrollBuild,
  payrollDateShortcuts,
  payrollDescription,
  payrollTicket,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/asiento-manual/_components/payroll-steps'
import {
  hasContent,
  type InitialLine,
  validateEntry,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/asiento-manual/_lib/manual-entry'
import { engineErrorsState } from '@/lib/accounting/errors'
import { payrollTemplateLines } from '@/lib/accounting/posting/manual'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { PostingContext } from '@/lib/accounting/types'
import { formatMonthYear } from '@/lib/dates'
import { prepare } from './accounting-fixtures'

/**
 * «Sueldos del mes» es otra cara del asiento manual, no otro formulario: tiene
 * que mandar EXACTAMENTE lo mismo que el camino de antes («Armar las líneas» +
 * «Guardar asiento»). Acá el camino viejo está escrito a mano, tal cual era, y
 * se compara contra lo que arma el nuevo: los mismos valores y el mismo hash de
 * la vista previa (lo que la base compara al guardar).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/hub/administracion/libros/asiento-manual',
  useSearchParams: () => new URLSearchParams(),
}))
// Las acciones de servidor no corren acá: alcanza con que existan.
vi.mock('@/lib/accounting/actions/documents', () => ({
  postManualEntry: vi.fn(),
  undoDocument: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/parties', () => ({ createParty: vi.fn(), saveParty: vi.fn() }))
vi.mock('@/components/administracion/accounting-provider', () => {
  const value = () => ({
    tenantSlug: 'hub',
    today: '2026-10-13',
    access: { read: true, write: true, admin: true },
    readOnly: false,
    openAction: () => {},
    closeAction: () => {},
  })
  return { useAccounting: value, useAccountingOptional: value }
})

const TODAY = '2026-10-31'

/** El contexto del ejemplo, con el sindicato del bar (no está en el contexto base). */
function context(): PostingContext {
  const { r, ctx } = prepare()
  const parties = new Map(ctx.parties)
  const personal = ctx.parties.get(r.party('personal'))
  if (!personal) throw new Error('falta el partícipe «personal» en el ejemplo')
  parties.set('00000000-0000-4000-8000-000000666666', {
    ...personal,
    id: '00000000-0000-4000-8000-000000666666',
    kind: 'other',
    name: 'Sindicato y obra social',
    payableAccountId: r.account('union_payable'),
  })
  return { ...ctx, parties }
}

type LegacyState = { description: string; lines: InitialLine[] }

/**
 * EL CAMINO DE ANTES, copiado: el botón «Armar las líneas» de la plantilla
 * (`PayrollTemplate.apply` + `onApply`) y después lo que mandaba «Guardar
 * asiento» (`values` del formulario).
 */
function legacyPath(inputs: PayrollInputs, date: string, ctx: PostingContext) {
  // «Armar las líneas»
  if (inputs.gross === null || inputs.gross <= 0) {
    return { ok: false as const, message: 'Cargá los sueldos brutos del mes.' }
  }
  if (inputs.contributions === null || inputs.withheld === null) {
    return {
      ok: false as const,
      message: 'Cargá las contribuciones patronales y los aportes (pueden ser cero).',
    }
  }
  const built = payrollTemplateLines(
    {
      grossSalariesCents: inputs.gross,
      employerContributionsCents: inputs.contributions,
      withheldContributionsCents: inputs.withheld,
      unionDuesCents: inputs.union ?? 0,
      date,
      salariesDueDate: inputs.salariesDue,
      socialSecurityDueDate: inputs.socialDue,
    },
    ctx,
  )
  if (!built.ok) return { ok: false as const, message: engineErrorsState(built.errors).message }
  const state: LegacyState = {
    lines: built.lines.map((l) => ({
      accountId: l.accountId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      partyId: l.partyId,
      dueDate: l.dueDate,
      memo: l.memo ?? '',
    })),
    // El concepto estaba vacío: se completaba solo.
    description: `Sueldos de ${formatMonthYear(date)}`,
  }
  // «Guardar asiento»
  return {
    ok: true as const,
    values: {
      entryKind: 'payroll' as const,
      date,
      description: state.description.trim(),
      lines: state.lines.filter(hasContent).map((l) => ({
        accountId: l.accountId ?? '',
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        partyId: l.partyId,
        dueDate: l.dueDate,
        memo: l.memo.trim() === '' ? null : l.memo.trim(),
      })),
      correctsDocumentId: null,
    },
  }
}

/** EL CAMINO NUEVO: lo que arma «Guardar los sueldos» sin tocar el concepto. */
function newPath(inputs: PayrollInputs, date: string, ctx: PostingContext) {
  const build = payrollBuild(inputs, date, ctx)
  if (build.state !== 'ready') return { ok: false as const, message: build.message }
  return {
    ok: true as const,
    values: manualEntryValues({
      kind: 'payroll',
      date,
      description: payrollDescription(date),
      lines: build.lines,
      correctsId: null,
    }),
  }
}

const NUMBERS: PayrollInputs = {
  ...EMPTY_PAYROLL,
  gross: 450_000_000,
  contributions: 108_000_000,
  withheld: 76_500_000,
}

describe('«Guardar los sueldos» manda lo mismo que «Armar las líneas» + «Guardar asiento»', () => {
  const cases: Array<[string, PayrollInputs, string]> = [
    ['sin vencimientos', NUMBERS, '2026-10-31'],
    [
      'con los dos vencimientos',
      { ...NUMBERS, salariesDue: '2026-11-05', socialDue: '2026-11-12' },
      '2026-10-31',
    ],
    [
      'con cuota sindical',
      { ...NUMBERS, union: 9_000_000, salariesDue: '2026-11-05' },
      '2026-10-31',
    ],
    ['con fecha de otro mes (fin del mes pasado)', NUMBERS, '2026-09-30'],
    ['con importes de nueve cifras', { ...NUMBERS, gross: 123_456_789_012 }, '2026-10-31'],
  ]

  it.each(cases)('%s: los mismos valores, campo por campo', (_name, inputs, date) => {
    const ctx = context()
    const legacy = legacyPath(inputs, date, ctx)
    const next = newPath(inputs, date, ctx)
    expect(legacy.ok).toBe(true)
    expect(next).toEqual(legacy)
    if (!next.ok) return
    // Los vencimientos entran en las líneas (por eso se arman con los seis datos).
    const dues = next.values.lines.map((l) => l.dueDate)
    expect(dues.filter(Boolean)).toEqual(
      [inputs.salariesDue, inputs.socialDue].filter((d): d is string => d !== null),
    )
  })

  it.each(cases)('%s: el mismo hash de la vista previa', (_name, inputs, date) => {
    const ctx = { ...context(), today: TODAY }
    const legacy = legacyPath(inputs, date, ctx)
    const next = newPath(inputs, date, ctx)
    if (!legacy.ok || !next.ok) throw new Error('los dos caminos tienen que armar el asiento')
    const before = previewDocumentForm('manual_entry', legacy.values, ctx, { firstOpenDate: null })
    const after = previewDocumentForm('manual_entry', next.values, ctx, { firstOpenDate: null })
    // Lo que conteste el motor (el asiento con su hash, o por qué no se puede), contesta igual.
    expect(after).toEqual(before)
  })

  it('con los números del ejemplo el motor arma el asiento (el hash no es el de un error)', () => {
    const ctx = { ...context(), today: TODAY }
    const next = newPath(NUMBERS, '2026-10-31', ctx)
    if (!next.ok) throw new Error('tiene que armar el asiento')
    const preview = previewDocumentForm('manual_entry', next.values, ctx, { firstOpenDate: null })
    expect(preview.ok).toBe(true)
    if (preview.ok) expect(preview.hash).toMatch(/\S/)
  })

  it('lo que frena, frena igual y con los mismos textos', () => {
    const ctx = context()
    const broken: PayrollInputs[] = [
      EMPTY_PAYROLL,
      { ...EMPTY_PAYROLL, gross: 0 },
      { ...EMPTY_PAYROLL, gross: 100_000 },
      { ...EMPTY_PAYROLL, gross: 100_000, contributions: 0 },
      // Los aportes superan al bruto: lo dice el motor.
      { ...EMPTY_PAYROLL, gross: 100_000, contributions: 0, withheld: 200_000 },
    ]
    for (const inputs of broken) {
      const legacy = legacyPath(inputs, '2026-10-31', ctx)
      const next = newPath(inputs, '2026-10-31', ctx)
      expect(legacy.ok).toBe(false)
      expect(next).toEqual(legacy)
    }
    expect(payrollBuild(EMPTY_PAYROLL, '2026-10-31', ctx)).toEqual({
      state: 'missing',
      field: 'gross',
      message: 'Cargá los sueldos brutos del mes.',
    })
    expect(payrollBuild({ ...EMPTY_PAYROLL, gross: 1 }, '2026-10-31', ctx)).toMatchObject({
      state: 'missing',
      field: 'contributions',
    })
    expect(
      payrollBuild({ ...EMPTY_PAYROLL, gross: 1, contributions: 0 }, '2026-10-31', ctx),
    ).toMatchObject({ state: 'missing', field: 'withheld' })
  })

  it('las líneas pasan la validación del formulario (cuadran)', () => {
    const ctx = context()
    const build = payrollBuild(NUMBERS, '2026-10-31', ctx)
    if (build.state !== 'ready') throw new Error('tiene que armar las líneas')
    const check = validateEntry({
      lines: build.lines.map((l, i) => ({ ...l, key: `sueldos-${i}` })),
      date: '2026-10-31',
      description: payrollDescription('2026-10-31'),
      requiresParty: (id) => (id ? (ctx.accounts.get(id)?.requiresParty ?? false) : false),
    })
    expect(check).toEqual({ ok: true })
  })
})

describe('el ticket de sueldos y sus atajos', () => {
  it('se lee de las líneas armadas: costo del mes y lo que queda como deuda', () => {
    const build = payrollBuild({ ...NUMBERS, union: 9_000_000 }, '2026-10-31', context())
    if (build.state !== 'ready') throw new Error('tiene que armar las líneas')
    expect(payrollTicket(build.lines)).toEqual({
      grossCents: 450_000_000,
      contributionsCents: 108_000_000,
      costCents: 558_000_000,
      // Bruto − aportes − sindicato.
      netCents: 364_500_000,
      // Aportes + contribuciones (F.931).
      socialCents: 184_500_000,
      unionCents: 9_000_000,
    })
    expect(payrollTicket(null)).toBeNull()
    expect(payrollTicket([])).toBeNull()
  })

  it('«Sueldos de octubre de 2026», siguiendo a la fecha', () => {
    expect(payrollDescription('2026-10-31')).toBe('Sueldos de octubre de 2026')
    expect(payrollDescription('2026-09-30')).toBe('Sueldos de septiembre de 2026')
  })

  it('los atajos de fecha respetan el límite del primer día abierto', () => {
    expect(payrollDateShortcuts('2026-10-13', '2026-09-01')).toEqual([
      { date: '2026-09-30', label: 'Fin de septiembre · 30/09' },
      { date: '2026-10-31', label: 'Fin de octubre · 31/10' },
    ])
    // Septiembre ya está cerrado (o el bar arrancó en octubre): ese atajo no se ofrece.
    expect(payrollDateShortcuts('2026-10-13', '2026-10-12')).toEqual([
      { date: '2026-10-31', label: 'Fin de octubre · 31/10' },
    ])
  })
})

describe('las dos caras del formulario (primer paint)', () => {
  function render(initialKind: 'payroll' | 'adjustment') {
    const ctx = { ...context(), today: TODAY }
    return renderToStaticMarkup(
      createElement(ManualEntryForm, {
        tenantSlug: 'hub',
        ctx,
        accounts: [],
        parties: [],
        firstOpenDate: '2026-10-01',
        today: TODAY,
        fyAdjustment: null,
        initialKind,
        initialLines: [],
        corrects: null,
        backHref: '/hub/administracion/libros',
      }),
    )
  }

  it('`?tipo=sueldos`: tres pasos y un ticket, sin grilla Debe / Haber', () => {
    const html = render('payroll')
    expect(html).toContain('Sueldos del mes')
    for (const text of [
      'Los números del resumen',
      '¿Cuándo se pagan?',
      'Revisá y guardá',
      'Sueldos brutos',
      'Contribuciones patronales',
      'Aportes retenidos',
      'Cuota sindical',
      'Vencen los sueldos',
      'Vencen las cargas sociales',
      '¿Con qué fecha queda?',
      'Guardar los sueldos',
      'Ver cómo queda en los libros',
      'Editar las líneas a mano',
      'Cargá los importes y el ticket se arma solo.',
      'Cargar los sueldos no mueve plata: la plata sale cuando los pagás.',
    ]) {
      expect(html, text).toContain(text)
    }
    // El concepto viene completo y la fecha es la de hoy, como antes.
    expect(html).toContain('value="Sueldos de octubre de 2026"')
    expect(html).not.toContain('Guardar asiento')
    expect(html).not.toContain('Agregar línea')
    expect(html).not.toContain('Armar las líneas')
  })

  it('sin `?tipo=`: la grilla de siempre, con su botón', () => {
    const html = render('adjustment')
    expect(html).toContain('Asiento manual')
    expect(html).toContain('Tipo de asiento')
    expect(html).toContain('Agregar línea')
    expect(html).toContain('Guardar asiento')
    expect(html).not.toContain('Guardar los sueldos')
  })
})
