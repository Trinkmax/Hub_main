import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildEntryPanel,
  entryPanelVoid,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/entry-panel'
import { ACC_ERRORS, mapReimputeError } from '@/lib/accounting/errors'
import {
  imputationFlagText,
  isReimputableLine,
  isReimputeTarget,
  REIMPUTABLE_ROLES,
  REIMPUTE_CLOSED_MESSAGE,
  reimputeAccountOptions,
  reimputedMessage,
  reimputeSchema,
  reimputeTargets,
} from '@/lib/accounting/reimpute'

/**
 * Reimputar (Silvia, reunión del 29/10: «suelen encontrar que en energía eléctrica metieron una de
 * agua»): qué renglón se ofrece, a qué cuenta, qué se le dice a quien lo hace y lo que hace la acción.
 * La base lo vuelve a decidir: estos tests cuidan que no se ofrezca lo que va a rechazar.
 */

const auth = vi.hoisted(() => ({
  state: { ok: true, tenantId: 'tenant-1' } as Record<string, unknown>,
  need: [] as string[],
}))
const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  result: { data: null, error: null } as { data: unknown; error: unknown },
}))
const revalidate = vi.hoisted(() => ({ count: 0 }))

vi.mock('@/lib/accounting/access', () => ({
  authorizeAccounting: async (_slug: string, need: string) => {
    auth.need.push(need)
    return auth.state
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (name: string, args: unknown) => {
      rpc.calls.push({ name, args })
      return rpc.result
    },
  }),
}))
vi.mock('next/cache', () => ({
  revalidatePath: () => {
    revalidate.count += 1
  },
}))

const LINE = '00000000-0000-4000-8000-000000000001'
const ACCOUNT = '00000000-0000-4000-8000-000000000002'

beforeEach(() => {
  auth.state = { ok: true, tenantId: 'tenant-1' }
  auth.need = []
  rpc.calls = []
  rpc.result = { data: null, error: null }
  revalidate.count = 0
})

describe('qué renglón se puede reimputar', () => {
  const free = { partyId: null, treasuryAccountId: null }
  const plain = { requiresParty: false, isTreasury: false }

  it('los renglones de imputación', () => {
    expect([...REIMPUTABLE_ROLES]).toEqual([
      'net',
      'gross',
      'non_taxed',
      'exempt',
      'internal_tax',
      'manual',
      'counterpart',
    ])
    for (const role of REIMPUTABLE_ROLES) {
      expect(isReimputableLine({ role, ...free }, plain), role).toBe(true)
    }
  })

  it('nunca el IVA, una caja ni una partida', () => {
    for (const role of ['vat', 'vat_credit', 'treasury', 'payable', 'perception', 'other_tax']) {
      expect(isReimputableLine({ role, ...free }, plain), role).toBe(false)
    }
    expect(isReimputableLine({ role: 'net', partyId: 'p', treasuryAccountId: null }, plain)).toBe(
      false,
    )
    expect(isReimputableLine({ role: 'net', partyId: null, treasuryAccountId: 't' }, plain)).toBe(
      false,
    )
  })

  it('ni una cuenta de control ni la de una caja', () => {
    expect(
      isReimputableLine({ role: 'manual', ...free }, { requiresParty: true, isTreasury: false }),
    ).toBe(false)
    expect(
      isReimputableLine({ role: 'manual', ...free }, { requiresParty: false, isTreasury: true }),
    ).toBe(false)
  })
})

describe('a qué cuenta se puede pasar', () => {
  const ok = { postable: true, active: true, isTreasury: false, requiresParty: false }

  it('imputable, activa, sin caja ni partícipe', () => {
    expect(isReimputeTarget(ok)).toBe(true)
    expect(isReimputeTarget({ ...ok, postable: false })).toBe(false)
    expect(isReimputeTarget({ ...ok, active: false })).toBe(false)
    expect(isReimputeTarget({ ...ok, isTreasury: true })).toBe(false)
    expect(isReimputeTarget({ ...ok, requiresParty: true })).toBe(false)
  })

  it('el buscador lleva el plan entero: los grupos arman la ruta, no se eligen', () => {
    const options = reimputeAccountOptions([
      {
        id: 'g',
        code: '4.2',
        name: 'Egresos',
        parentId: null,
        description: null,
        ...ok,
        postable: false,
      },
      { id: 'a', code: '4.2.01', name: 'Agua', parentId: 'g', description: 'Agua', ...ok },
      {
        id: 'c',
        code: '1.1',
        name: 'Caja',
        parentId: null,
        description: null,
        ...ok,
        isTreasury: true,
      },
    ])
    expect(options.map((o) => [o.id, o.postable])).toEqual([
      ['g', false],
      ['a', true],
      ['c', false],
    ])
    expect(options[1]).toEqual({
      id: 'a',
      code: '4.2.01',
      name: 'Agua',
      parentId: 'g',
      postable: true,
      active: true,
      description: 'Agua',
    })
  })
})

describe('los renglones de un comprobante', () => {
  const line = (id: string, role: string, over: Record<string, unknown> = {}) => ({
    id,
    role,
    accountId: 'agua',
    accountCode: '4.2.01.03.024',
    accountName: 'Agua',
    side: 'debit' as const,
    amountCents: 31_240_000,
    partyId: null,
    treasuryAccountId: null,
    ...over,
  })
  const accounts = new Map([
    ['agua', { requiresParty: false, isTreasury: false }],
    ['proveedores', { requiresParty: true, isTreasury: false }],
  ])
  const flag = {
    documentLineId: 'l1',
    usualAccountId: 'luz',
    usualAccountName: 'Energía eléctrica',
    partyName: 'EPEC',
  }

  it('solo los de imputación, con la habitual si está marcado', () => {
    const targets = reimputeTargets(
      {
        status: 'posted',
        lines: [
          line('l1', 'gross'),
          line('l2', 'payable', { accountId: 'proveedores', partyId: 'p', side: 'credit' }),
        ],
      },
      accounts,
      [flag],
    )
    expect(targets).toEqual([
      {
        lineId: 'l1',
        accountId: 'agua',
        accountCode: '4.2.01.03.024',
        accountName: 'Agua',
        side: 'debit',
        amountCents: 31_240_000,
        usual: { accountId: 'luz', accountName: 'Energía eléctrica', partyName: 'EPEC' },
      },
    ])
  })

  it('el marcado va primero: es el que se viene a cambiar', () => {
    const targets = reimputeTargets(
      { status: 'posted', lines: [line('l0', 'net'), line('l1', 'net')] },
      accounts,
      [flag],
    )
    expect(targets.map((t) => t.lineId)).toEqual(['l1', 'l0'])
  })

  it('un comprobante anulado no ofrece nada', () => {
    expect(reimputeTargets({ status: 'voided', lines: [line('l1', 'net')] }, accounts, [])).toEqual(
      [],
    )
  })

  it('una cuenta que no se encuentra no se ofrece', () => {
    expect(
      reimputeTargets(
        { status: 'posted', lines: [line('l1', 'net', { accountId: 'otra' })] },
        accounts,
        [],
      ),
    ).toEqual([])
  })
})

describe('lo que se le dice', () => {
  it('«EPEC siempre va a Energía eléctrica. Tocá para reimputar.»', () => {
    const flag = { partyName: 'EPEC', usualAccountName: 'Energía eléctrica' }
    expect(imputationFlagText(flag, { open: true })).toBe(
      'EPEC siempre va a Energía eléctrica. Tocá para reimputar.',
    )
    // Con el mes cerrado no se promete lo que no se puede.
    expect(imputationFlagText(flag, { open: false })).toBe(
      'EPEC siempre va a Energía eléctrica. Ese mes está cerrado.',
    )
    expect(imputationFlagText({ partyName: null, usualAccountName: 'Agua' }, { open: true })).toBe(
      'Este proveedor siempre va a Agua. Tocá para reimputar.',
    )
  })

  it('el toast', () => {
    expect(reimputedMessage('Energía eléctrica')).toBe(
      'Reimputada a Energía eléctrica. Quedó en el historial.',
    )
  })
})

describe('los errores de la base, con palabras de quien reimputa', () => {
  const pg = (message: string) => ({ message, code: 'P0001', details: null, hint: null })

  it('mes cerrado: cómo se sigue, no «cargalo con fecha de un mes abierto»', () => {
    const state = mapReimputeError(pg('period_closed'))
    expect(state.message).toBe(REIMPUTE_CLOSED_MESSAGE)
    expect(state.code).toBe('conflict')
  })

  it('una cuenta que no sirve no es un error de programación', () => {
    const state = mapReimputeError(pg('line_account_invalid'))
    expect(state.message).toContain('Esa cuenta no sirve para reimputar')
    expect(state.detail?.bug).toBe(false)
    expect(state.code).toBe('conflict')
  })

  it('el renglón que no se puede, la misma cuenta y el comprobante anulado', () => {
    expect(mapReimputeError(pg('line_not_reimputable')).message).toBe(
      ACC_ERRORS.line_not_reimputable.message,
    )
    expect(mapReimputeError(pg('account_unchanged')).message).toBe(
      'El renglón ya está en esa cuenta.',
    )
    expect(mapReimputeError(pg('document_voided')).message).toBe(
      'Este comprobante está anulado: ya no se puede reimputar.',
    )
  })

  it('lo demás, como en todas las acciones', () => {
    expect(mapReimputeError(pg('forbidden')).code).toBe('forbidden')
    expect(mapReimputeError({ message: 'algo raro', code: 'XX000' }).code).toBe('error')
  })

  it('no toca lo que la carga de comprobantes ya decía', () => {
    expect(ACC_ERRORS.line_account_invalid).toMatchObject({ code: 'error', bug: true })
    expect(ACC_ERRORS.period_closed.fallback).toContain('Cargalo con fecha de un mes abierto')
  })
})

describe('el zod de la acción', () => {
  it('acepta lo que manda el formulario y normaliza el motivo', () => {
    expect(
      reimputeSchema.parse({ lineId: LINE, accountId: ACCOUNT, reason: '  era de EPEC  ' }),
    ).toEqual({ lineId: LINE, accountId: ACCOUNT, reason: 'era de EPEC' })
    expect(
      reimputeSchema.parse({ lineId: LINE, accountId: ACCOUNT, reason: '  ' }).reason,
    ).toBeNull()
    expect(reimputeSchema.parse({ lineId: LINE, accountId: ACCOUNT }).reason).toBeNull()
  })

  it('rechaza ids rotos, un motivo larguísimo y claves de más', () => {
    expect(reimputeSchema.safeParse({ lineId: 'x', accountId: ACCOUNT }).success).toBe(false)
    expect(reimputeSchema.safeParse({ lineId: LINE, accountId: 'x' }).success).toBe(false)
    expect(
      reimputeSchema.safeParse({ lineId: LINE, accountId: ACCOUNT, reason: 'a'.repeat(301) })
        .success,
    ).toBe(false)
    expect(
      reimputeSchema.safeParse({ lineId: LINE, accountId: ACCOUNT, tenantId: 'otro' }).success,
    ).toBe(false)
  })
})

describe('reimputeLine', () => {
  async function run(input: unknown = { lineId: LINE, accountId: ACCOUNT, reason: 'era de EPEC' }) {
    const { reimputeLine } = await import('@/lib/accounting/actions/reimpute')
    return reimputeLine('hub', input)
  }

  it('alcanza con el acceso de lectura: la contadora también reimputa', async () => {
    rpc.result = {
      data: {
        document_id: 'doc',
        line_id: LINE,
        from: { id: 'a', code: '4.1', name: 'Agua' },
        to: { id: 'b', code: '4.2', name: 'Energía eléctrica' },
      },
      error: null,
    }
    const state = await run()
    expect(auth.need).toEqual(['read'])
    expect(rpc.calls).toEqual([
      {
        name: 'acc_reimpute_line',
        args: {
          p_tenant_id: 'tenant-1',
          p_line_id: LINE,
          p_account_id: ACCOUNT,
          p_reason: 'era de EPEC',
        },
      },
    ])
    expect(state).toMatchObject({
      ok: true,
      message: 'Reimputada a Energía eléctrica. Quedó en el historial.',
      data: { documentId: 'doc', to: { name: 'Energía eléctrica' } },
    })
    expect(revalidate.count).toBe(1)
  })

  it('sin permiso no llega a la base', async () => {
    auth.state = { ok: false, state: { ok: false, code: 'forbidden', message: 'No.' } }
    const state = await run()
    expect(state).toMatchObject({ ok: false, code: 'forbidden' })
    expect(rpc.calls).toEqual([])
  })

  it('con datos rotos tampoco', async () => {
    const state = await run({ lineId: 'x', accountId: ACCOUNT })
    expect(state).toMatchObject({ ok: false, code: 'invalid', message: 'Elegí el renglón.' })
    expect(rpc.calls).toEqual([])
  })

  it('lo que rechaza la base vuelve con su mensaje y no se revalida nada', async () => {
    rpc.result = { data: null, error: { message: 'period_closed', code: 'P0001' } }
    const state = await run()
    expect(state).toMatchObject({ ok: false, message: REIMPUTE_CLOSED_MESSAGE })
    expect(revalidate.count).toBe(0)
  })
})

describe('«Anular» desde el panel', () => {
  const doc = (over: Record<string, unknown> = {}) =>
    ({
      kind: 'purchase',
      status: 'posted',
      partyId: 'p',
      openCents: 100,
      period: { status: 'open' },
      reversedBy: null,
      title: 'Factura B 0012-00088123',
      bundleSiblings: [],
      allocations: [],
      ...over,
    }) as unknown as Parameters<typeof entryPanelVoid>[0]

  it('con el mes abierto y permiso de escritura, con los mismos avisos que la ficha', () => {
    const allocations = [
      { amountCents: 500, voidedOn: null },
      { amountCents: 900, voidedOn: '2026-10-01' },
    ]
    const siblings = [{ title: 'Pago', seq: 126, status: 'posted', kind: 'payment' }]
    expect(entryPanelVoid(doc({ allocations, bundleSiblings: siblings }), true, ['nota'])).toEqual({
      title: 'Factura B 0012-00088123',
      siblings: ['Pago #126'],
      appliedCents: 500,
      appliedWord: 'pagos',
      notes: ['nota'],
    })
  })

  it('la contadora no anula', () => {
    expect(entryPanelVoid(doc(), false, [])).toBeNull()
  })

  it('con el mes cerrado se corrige desde la ficha', () => {
    expect(entryPanelVoid(doc({ period: { status: 'closed' } }), true, [])).toBeNull()
  })

  it('lo que puede estar en ARCA también: la ficha lo mira antes', () => {
    expect(entryPanelVoid(doc({ kind: 'sales_invoice' }), true, [])).toBeNull()
    const sibling = { title: 'Factura', seq: 1, status: 'posted', kind: 'sales_invoice' }
    expect(
      entryPanelVoid(doc({ kind: 'collection', bundleSiblings: [sibling] }), true, []),
    ).toBeNull()
  })
})

describe('el panel del asiento', () => {
  const docLine = (id: string, role: string, over: Record<string, unknown> = {}) => ({
    id,
    role,
    accountId: 'agua',
    accountCode: '4.2.01.03.024',
    accountName: 'Agua',
    side: 'debit',
    amountCents: 31_240_000,
    partyId: null,
    treasuryAccountId: null,
    ...over,
  })
  const doc = (over: Record<string, unknown> = {}) =>
    ({
      id: 'doc-epec',
      seq: 88,
      kind: 'purchase',
      status: 'posted',
      title: 'Factura B 0012-00088123',
      partyId: 'p-epec',
      partyName: 'EPEC',
      notes: 'Bajó de la app',
      openCents: 0,
      reversedBy: null,
      period: { status: 'open' },
      bundleSiblings: [],
      allocations: [],
      lines: [
        docLine('l-gasto', 'gross'),
        docLine('l-deuda', 'payable', {
          accountId: 'proveedores',
          accountName: 'Proveedores',
          partyId: 'p-epec',
          side: 'credit',
        }),
      ],
      ...over,
    }) as unknown as Parameters<typeof buildEntryPanel>[0]['doc']
  const entry = (over: Record<string, unknown> = {}) =>
    ({
      id: 'e-131',
      documentId: 'doc-epec',
      kind: 'standard',
      entryDate: '2026-10-14',
      number: null,
      provisionalNumber: 131,
      description: 'EPEC · Factura B',
      status: 'posted',
      isMirror: false,
      periodStatus: 'open',
      createdByName: 'Franco',
      createdAt: '2026-10-14T15:00:00Z',
      voidedAt: null,
      voidedByName: null,
      voidReason: null,
      debitCents: 31_240_000,
      creditCents: 31_240_000,
      lines: [
        {
          id: 'je-1',
          accountId: 'agua',
          accountCode: '4.2.01.03.024',
          accountName: 'Agua',
          side: 'debit',
          amountCents: 31_240_000,
          partyName: null,
          memo: null,
        },
        {
          id: 'je-2',
          accountId: 'proveedores',
          accountCode: '2.1.01.01.001',
          accountName: 'Proveedores',
          side: 'credit',
          amountCents: 31_240_000,
          partyName: 'EPEC',
          memo: null,
        },
      ],
      ...over,
    }) as unknown as Parameters<typeof buildEntryPanel>[0]['entry']
  const flag = {
    documentId: 'doc-epec',
    documentLineId: 'l-gasto',
    accountingDate: '2026-10-14',
    partyName: 'EPEC',
    amountCents: 31_240_000,
    accountId: 'agua',
    accountCode: '4.2.01.03.024',
    accountName: 'Agua',
    usualAccountId: 'luz',
    usualAccountCode: '4.2.01.03.023',
    usualAccountName: 'Energía eléctrica',
  }
  const accounts = new Map([
    ['agua', { requiresParty: false, isTreasury: false }],
    ['proveedores', { requiresParty: true, isTreasury: false }],
  ])
  const input = (over: Partial<Parameters<typeof buildEntryPanel>[0]> = {}) => ({
    doc: doc(),
    entry: entry(),
    canWrite: true,
    accounts,
    flags: [],
    reimputations: [],
    attachments: [],
    attachmentsError: null,
    voidNotes: [],
    options: null,
    ...over,
  })

  it('el asiento con su número provisorio, el comprobante y quién lo cargó', () => {
    const panel = buildEntryPanel(input())
    expect(panel.entry).toMatchObject({
      id: 'e-131',
      number: 131,
      provisional: true,
      createdByName: 'Franco',
    })
    expect(panel.document).toMatchObject({
      id: 'doc-epec',
      title: 'Factura B 0012-00088123',
      notes: 'Bajó de la app',
      notesLabel: 'Detalle',
      month: '2026-10',
      periodOpen: true,
    })
    expect(panel.lines.map((l) => [l.accountName, l.side])).toEqual([
      ['Agua', 'debit'],
      ['Proveedores', 'credit'],
    ])
  })

  it('la nota de un asiento manual es su respaldo', () => {
    const panel = buildEntryPanel(input({ doc: doc({ kind: 'manual', notes: 'Contrato 123' }) }))
    expect(panel.document).toMatchObject({ notes: 'Contrato 123', notesLabel: 'Respaldo' })
  })

  it('un número congelado no es provisorio', () => {
    const panel = buildEntryPanel(input({ entry: entry({ number: 131, provisionalNumber: null }) }))
    expect(panel.entry).toMatchObject({ number: 131, provisional: false })
  })

  it('se reimputa el renglón del gasto, no la deuda', () => {
    expect(buildEntryPanel(input()).targets.map((t) => t.lineId)).toEqual(['l-gasto'])
  })

  it('el renglón marcado trae la cuenta habitual; los otros no', () => {
    const panel = buildEntryPanel(input({ flags: [flag] }))
    expect(panel.lines[0]?.usual).toEqual({
      accountId: 'luz',
      accountName: 'Energía eléctrica',
      partyName: 'EPEC',
    })
    expect(panel.lines[1]?.usual).toBeNull()
    expect(panel.targets[0]?.usual?.accountId).toBe('luz')
  })

  it('una marca de otro comprobante no se mete', () => {
    const panel = buildEntryPanel(input({ flags: [{ ...flag, documentId: 'otro' }] }))
    expect(panel.lines[0]?.usual).toBeNull()
    expect(panel.targets[0]?.usual).toBeNull()
  })

  it('con el mes cerrado lo sabe, sale de donde sale', () => {
    const closed = buildEntryPanel(input({ doc: doc({ period: { status: 'closed' } }) }))
    expect(closed.document.periodOpen).toBe(false)
    // Sin período en el comprobante (un espejo, por ejemplo), lo dice el asiento.
    const fromEntry = buildEntryPanel(
      input({ doc: doc({ period: null }), entry: entry({ periodStatus: 'closed' }) }),
    )
    expect(fromEntry.document.periodOpen).toBe(false)
  })

  it('la contadora ve el panel y puede reimputar, pero no anular', () => {
    const panel = buildEntryPanel(input({ canWrite: false }))
    expect(panel.voidable).toBeNull()
    expect(panel.targets.length).toBe(1)
  })

  it('una foto que no se pudo leer se dice, y el resto del panel sale igual', () => {
    const panel = buildEntryPanel(input({ attachmentsError: 'No pudimos traer la foto.' }))
    expect(panel.attachmentsError).toBe('No pudimos traer la foto.')
    expect(panel.lines).toHaveLength(2)
  })
})
