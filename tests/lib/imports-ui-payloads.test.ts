/**
 * Lo que «Importar» le manda al servidor (`lib/imports/ui/payloads.ts`) es
 * EXACTAMENTE lo que mandaba antes del rediseño. Cada armador se compara contra
 * el objeto que armaba el componente anterior (copiado acá, tal cual) y contra
 * el esquema del servidor, que es estricto: una clave de más falla.
 */

import { describe, expect, it } from 'vitest'
import { partySchema } from '@/lib/accounting/schemas'
import {
  createImportBatchSchema,
  createImportSuppliersSchema,
  importChangeSchema,
  saveImportRuleSchema,
  saveMpSettingsSchema,
} from '@/lib/imports/server/types'
import {
  batchInput,
  MP_SETTINGS_CHANNELS,
  mpSettingsInput,
  otherTaxesChange,
  type RuleDraft,
  ruleInput,
  supplierCuitInput,
  supplierRows,
} from '@/lib/imports/ui/payloads'
import type { UploadPlan } from '@/lib/imports/ui/upload'

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const SHA = 'a'.repeat(64)

const PLAN: UploadPlan = {
  source: 'bank_statement',
  fileName: 'movimientos.csv',
  fileSize: 4096,
  detectedFormat: 'bank:generic',
  periodFrom: '2026-10-01',
  periodTo: '2026-10-07',
  meta: {
    layout: 'bank',
    headerRow: 0,
    rows: 14,
    initialBalanceCents: 100,
    finalBalanceCents: 200,
  },
  rows: [],
  title: '14 movimientos del banco',
  facts: [{ label: 'Qué es', value: 'Extracto' }],
  figures: { items: 14, inCents: 300, outCents: 200, openingCents: 100, closingCents: 200 },
  rowErrors: [],
  notices: [],
}

describe('subir un archivo', () => {
  it('el lote es el de antes, y los números del papel no viajan', () => {
    const ctx = { source: 'bank_statement' as const, treasuryAccountId: ID(1) }
    // Lo que armaba `import-uploader.tsx` adentro de `uploadOnce`.
    const before = {
      source: PLAN.source,
      fileName: PLAN.fileName,
      fileSha256: SHA,
      fileSize: PLAN.fileSize,
      detectedFormat: PLAN.detectedFormat,
      periodFrom: PLAN.periodFrom,
      periodTo: PLAN.periodTo,
      treasuryAccountId: ctx.source === 'bank_statement' ? ctx.treasuryAccountId : null,
      meta: PLAN.meta,
    }
    const now = batchInput(PLAN, SHA, ctx)
    expect(now).toEqual(before)
    expect(Object.keys(now)).not.toContain('figures')
    expect(JSON.stringify(now)).not.toContain('inCents')
    expect(createImportBatchSchema.safeParse(now).success).toBe(true)
  })

  it('ARCA y Mercado Pago van sin cuenta', () => {
    const arca = batchInput({ ...PLAN, source: 'arca_recibidos' }, SHA, {
      source: 'arca_recibidos',
    })
    expect(arca.treasuryAccountId).toBeNull()
    const mp = batchInput({ ...PLAN, source: 'mp_release' }, SHA, {
      source: 'mp_release',
      treasuryAccountId: ID(1),
    })
    expect(mp.treasuryAccountId).toBeNull()
    expect(createImportBatchSchema.safeParse(arca).success).toBe(true)
  })

  it('el esquema del lote rechaza una clave de más (por eso `figures` no puede colarse)', () => {
    const withFigures = {
      ...batchInput(PLAN, SHA, { source: 'bank_statement', treasuryAccountId: ID(1) }),
      figures: PLAN.figures,
    }
    expect(createImportBatchSchema.safeParse(withFigures).success).toBe(false)
  })
})

describe('proveedores nuevos', () => {
  const rows = [{ cuit: '30712345671' }, { cuit: '30701112225' }]
  const state = {
    '30712345671': {
      name: '  Distribuidora Norte SRL ',
      condition: 'responsable_inscripto' as const,
      accountId: ID(7),
      term: '30',
    },
    '30701112225': {
      name: 'Hielo Polar',
      condition: 'monotributo' as const,
      accountId: ID(8),
      term: '',
    },
  }

  it('manda lo mismo que «Crear proveedores»', () => {
    // Lo que armaba `new-suppliers.tsx` adentro de `create`.
    const before = rows.map((r) => {
      const row = state[r.cuit as keyof typeof state]
      const term = Number.parseInt(row.term, 10)
      return {
        cuit: r.cuit,
        name: row.name.trim(),
        ivaCondition: row.condition,
        accountId: row.accountId as string,
        paymentTermDays: Number.isFinite(term) && term >= 0 && term <= 365 ? term : 0,
      }
    })
    const now = supplierRows(rows, state)
    expect(now).toEqual(before)
    expect(now.map((s) => s.paymentTermDays)).toEqual([30, 0])
    expect(createImportSuppliersSchema.safeParse({ batchId: ID(1), suppliers: now }).success).toBe(
      true,
    )
  })

  it('un plazo fuera de rango o que no es un número vale cero', () => {
    const odd = {
      c: { ...state['30712345671'], term: '999' },
      d: { ...state['30712345671'], term: 'x' },
    }
    expect(supplierRows([{ cuit: 'c' }, { cuit: 'd' }], odd).map((s) => s.paymentTermDays)).toEqual(
      [0, 0],
    )
  })

  it('sin proveedores, lista vacía', () => {
    expect(supplierRows([], {})).toEqual([])
  })
})

describe('«Sí: es {proveedor}»', () => {
  it('manda solo el CUIT, con lo que pide la ficha del proveedor', () => {
    const input = supplierCuitInput(
      {
        id: ID(3),
        kind: 'supplier',
        name: 'Distribuidora Norte',
        updatedAt: '2026-10-12T15:00:00+00:00',
      },
      '30712345671',
    )
    expect(input).toEqual({
      id: ID(3),
      expectedUpdatedAt: '2026-10-12T15:00:00+00:00',
      kind: 'supplier',
      name: 'Distribuidora Norte',
      taxIdType: 'cuit',
      taxId: '30712345671',
    })
    expect(Object.keys(input)).toEqual([
      'id',
      'expectedUpdatedAt',
      'kind',
      'name',
      'taxIdType',
      'taxId',
    ])
    expect(partySchema.safeParse(input).success).toBe(true)
  })
})

describe('«otros impuestos»', () => {
  const need = { party_id: ID(5) }

  it('para todas las del proveedor: va por proveedor y se recuerda', () => {
    const remember = true
    const as = 'perc_iibb' as const
    // Lo que armaba `need-block.tsx` adentro de `OtherTaxes.apply`.
    const rememberIt = remember && need.party_id !== null
    const before = {
      kind: 'other_taxes_as' as const,
      proposalKey: rememberIt ? null : 'mc:1',
      partyId: rememberIt ? need.party_id : null,
      as,
      accountId: null,
      jurisdictionCode: 904,
      remember: rememberIt,
    }
    const now = otherTaxesChange({
      proposalKey: 'mc:1',
      partyId: need.party_id,
      as,
      accountId: ID(9),
      jurisdiction: 904,
      remember,
    })
    expect(now).toEqual(before)
    expect(importChangeSchema.safeParse(now).success).toBe(true)
  })

  it('solo para esta factura: va por hoja y no se recuerda', () => {
    const now = otherTaxesChange({
      proposalKey: 'mc:1',
      partyId: ID(5),
      as: 'account',
      accountId: ID(9),
      jurisdiction: 904,
      remember: false,
    })
    expect(now).toEqual({
      kind: 'other_taxes_as',
      proposalKey: 'mc:1',
      partyId: null,
      as: 'account',
      accountId: ID(9),
      jurisdictionCode: null,
      remember: false,
    })
    expect(importChangeSchema.safeParse(now).success).toBe(true)
  })

  it('sin proveedor reconocido nunca se recuerda, aunque la casilla esté tildada', () => {
    const now = otherTaxesChange({
      proposalKey: 'mc:1',
      partyId: null,
      as: 'internal',
      accountId: null,
      jurisdiction: 904,
      remember: true,
    })
    expect(now).toMatchObject({ proposalKey: 'mc:1', partyId: null, remember: false })
    expect(importChangeSchema.safeParse(now).success).toBe(true)
  })
})

describe('«Antes de empezar» de Mercado Pago', () => {
  it('manda los cuatro canales (los que no se usan, en null) y el corte', () => {
    const methods = { qr: ID(11), point: null, transfer_in: ID(12) }
    const conn = { updatedAt: '2026-10-12T15:00:00+00:00' }
    // Lo que armaba `mp-settings-card.tsx` adentro de `save`.
    const CHANNELS = ['qr', 'point', 'transfer_in', 'link'] as const
    const before = {
      expectedUpdatedAt: conn?.updatedAt ?? null,
      treasuryAccountId: ID(2),
      channelMethods: Object.fromEntries(
        CHANNELS.map((c) => [c, (methods as Record<string, string | null>)[c] ?? null]),
      ),
      dayCutoffHour: 5,
    }
    const now = mpSettingsInput({ updatedAt: conn.updatedAt, wallet: ID(2), methods, cutoff: 5 })
    expect(now).toEqual(before)
    expect(MP_SETTINGS_CHANNELS).toEqual(CHANNELS)
    expect(Object.keys(now.channelMethods ?? {})).toEqual(['qr', 'point', 'transfer_in', 'link'])
    expect(saveMpSettingsSchema.safeParse(now).success).toBe(true)
  })

  it('la primera vez no hay nada que comparar', () => {
    const now = mpSettingsInput({ updatedAt: null, wallet: ID(2), methods: {}, cutoff: 0 })
    expect(now.expectedUpdatedAt).toBeNull()
    expect(now.dayCutoffHour).toBe(0)
    expect(saveMpSettingsSchema.safeParse(now).success).toBe(true)
  })
})

describe('lo que el bar le enseña al banco', () => {
  const draft: RuleDraft = {
    label: '  Expensas del local ',
    pattern: ' EXPENSAS ',
    cuit: '30-71234567-1',
    direction: 'debit',
    kind: 'payment',
    component: 'comisiones',
    accountId: ID(21),
    partyId: ID(22),
    treasuryId: ID(23),
    active: true,
  }

  it('una regla nueva: lo mismo que «Guardar la regla»', () => {
    // Lo que armaba `bank-rules-card.tsx` adentro de `RuleDialog.submit`.
    const before = {
      id: null,
      expectedUpdatedAt: null,
      source: 'bank_statement',
      priority: 100,
      label: 'Expensas del local',
      match: { pattern: 'EXPENSAS', counterparty_cuit: '30712345671', direction: 'debit' },
      action: { kind: 'payment', party_id: ID(22) },
      active: true,
    }
    const now = ruleInput(null, draft)
    expect(now).toEqual(before)
    expect(saveImportRuleSchema.safeParse(now).success).toBe(true)
  })

  it('al editar conserva el id, la prioridad y la marca de concurrencia', () => {
    const now = ruleInput(
      { id: ID(30), priority: 40, updatedAt: '2026-10-12T15:00:00+00:00' },
      draft,
    )
    expect(now).toMatchObject({
      id: ID(30),
      priority: 40,
      expectedUpdatedAt: '2026-10-12T15:00:00+00:00',
    })
  })

  it('cada tipo manda solo su dato', () => {
    const action = (over: Partial<RuleDraft>) => ruleInput(null, { ...draft, ...over }).action
    expect(action({ kind: 'expense_component' })).toEqual({
      kind: 'expense_component',
      component: 'comisiones',
    })
    expect(action({ kind: 'transfer' })).toEqual({
      kind: 'transfer',
      treasury_account_id: ID(23),
    })
    expect(action({ kind: 'collection' })).toEqual({ kind: 'collection', party_id: ID(22) })
    expect(action({ kind: 'movement' })).toEqual({ kind: 'movement', account_id: ID(21) })
    expect(action({ kind: 'ignore' })).toEqual({ kind: 'ignore' })
    expect(action({ kind: 'review' })).toEqual({ kind: 'review' })
    expect(action({ kind: 'transfer', treasuryId: null })).toEqual({ kind: 'transfer' })
  })

  it('«entra o sale» no manda sentido; sin texto ni CUIT el match queda vacío', () => {
    expect(ruleInput(null, { ...draft, direction: 'any' }).match).toEqual({
      pattern: 'EXPENSAS',
      counterparty_cuit: '30712345671',
    })
    expect(ruleInput(null, { ...draft, pattern: '   ', cuit: '', direction: 'any' }).match).toEqual(
      {},
    )
  })
})
