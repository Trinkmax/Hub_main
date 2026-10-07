import { describe, expect, it } from 'vitest'
import {
  deactivateRefusal,
  formFeedback,
  remapCompatible,
  remapRefusal,
} from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_lib/feedback'
import {
  buildImportPreview,
  importRowError,
  pastedRootCodes,
} from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_lib/import-preview'
import {
  SYSTEM_USE_GROUPS,
  SYSTEM_USES,
  systemKeysOf,
  systemUse,
} from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_lib/system-uses'
import {
  type ChartAccount,
  chartView,
  checkMove,
  createTypeChoice,
  deactivationBlock,
  editTypeChoice,
  expandedForLevel,
  groupsWithChildren,
  indexChart,
  initialExpanded,
  levelOfExpanded,
  moveCountText,
  moveSummary,
  moveTargets,
  proposeChildCode,
  proposeRootCode,
} from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_lib/tree'
import {
  accountPaths,
  compareAccountCode,
  normalizeCodeQuery,
  resolveParents,
  treeEntries,
} from '@/components/administracion/account-paths'
import { chartLevel, chartParentCode, STANDARD_CHART } from '@/lib/accounting/chart'
import { parseChartImportResult, parseSystemRemapResult } from '@/lib/accounting/queries/accounts'
import { accountSchema, chartImportSchema, systemRemapSchema } from '@/lib/accounting/schemas'
import { SYSTEM_ACCOUNT_KEYS } from '@/lib/accounting/system-keys'

// Plan de cuentas configurable (#16): el árbol por grupo (no por código), la búsqueda, los niveles,
// el código propuesto, mover con todo lo de adentro (cuántas se mueven), desactivar, las cuentas
// del sistema y la vista previa de «Importar plan».

const UPDATED = '2026-10-07T12:00:00.000+00:00'
let serial = 0
function uuid(): string {
  serial += 1
  return `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`
}

/** El plan estándar como lo siembra la base (madre por `acc_code_parent`), más la caja del asistente. */
function standardPlan(): ChartAccount[] {
  const ids = new Map(STANDARD_CHART.map((a) => [a.code, uuid()]))
  const plan: ChartAccount[] = STANDARD_CHART.map((a) => {
    const parentCode = chartParentCode(a.code)
    return {
      id: ids.get(a.code) ?? uuid(),
      code: a.code,
      name: a.name,
      type: a.type,
      normalSide: a.normalSide,
      parentId: parentCode ? (ids.get(parentCode) ?? null) : null,
      level: chartLevel(a.code),
      postable: a.postable,
      active: true,
      systemKey: a.systemKey,
      requiresParty: a.requiresParty,
      isTreasury: false,
      purchaseSelectable: a.purchaseSelectable,
      manualSelectable: true,
      description: a.description,
      balanceCents: null,
      hasChildren: false,
      updatedAt: UPDATED,
    }
  })
  plan.push({
    ...(plan.find((a) => a.code === '1.1.01.03.001') as ChartAccount),
    id: uuid(),
    code: '1.1.01.01.001',
    name: 'Caja',
    parentId: ids.get('1.1.01.01.000') ?? null,
    isTreasury: true,
    description: null,
  })
  return plan
}

function find(plan: readonly ChartAccount[], code: string): ChartAccount {
  const account = plan.find((a) => a.code === code)
  if (!account) throw new Error(`falta ${code}`)
  return account
}

function group(code: string, name: string, extra: Partial<ChartAccount> = {}): ChartAccount {
  return {
    id: uuid(),
    code,
    name,
    type: 'asset',
    normalSide: 'debit',
    parentId: null,
    level: 1,
    postable: false,
    active: true,
    systemKey: null,
    requiresParty: false,
    isTreasury: false,
    purchaseSelectable: false,
    manualSelectable: true,
    description: null,
    balanceCents: null,
    hasChildren: false,
    updatedAt: UPDATED,
    ...extra,
  }
}

describe('el árbol sale de los grupos, no del código (account-paths)', () => {
  it('ordena segmento a segmento y normaliza la búsqueda por código', () => {
    expect(['1.1.10', '1.1.2', '1.1.01.01.001', '1.1.01.01.000'].sort(compareAccountCode)).toEqual([
      '1.1.01.01.000',
      '1.1.01.01.001',
      '1.1.2',
      '1.1.10',
    ])
    expect(normalizeCodeQuery('1.1.01.00.000')).toBe('1.1.01')
    expect(normalizeCodeQuery('1.1.')).toBe('1.1')
    expect(normalizeCodeQuery('110101')).toBe('110101')
    expect(normalizeCodeQuery('caja')).toBe('caja')
  })

  it('sin parentId infiere la madre por el código (5 niveles con ceros y con puntos)', () => {
    const list = [
      { id: 'a', code: '1.0.00.00.000', name: 'ACTIVO' },
      { id: 'b', code: '1.1.00.00.000', name: 'Activo corriente' },
      { id: 'c', code: '1.1.03.00.000', name: 'Créditos' },
      { id: 'd', code: '1.1.03.04.000', name: 'Créditos fiscales' },
      { id: 'e', code: '1.1.03.04.028', name: 'IVA crédito fiscal' },
      { id: 'f', code: '5.3', name: 'Impuestos' },
      { id: 'g', code: '5.3.02', name: 'Tasas' },
      { id: 'h', code: '5.3.02.12', name: 'Sellos' },
    ]
    const parents = resolveParents(list)
    expect(parents.get('e')).toBe('d')
    expect(parents.get('d')).toBe('c')
    expect(parents.get('b')).toBe('a')
    expect(parents.get('a')).toBeNull()
    expect(parents.get('h')).toBe('g')
    expect(parents.get('f')).toBeNull()
    const paths = accountPaths(treeEntries(list))
    expect(paths.get('e')).toBe('ACTIVO › Activo corriente › Créditos › Créditos fiscales')
    expect(paths.get('a')).toBe('')
  })

  it('con parentId manda el grupo aunque el código diga otra cosa (cuenta movida)', () => {
    const list = [
      { id: 'r4', code: '4.0.00.00.000', name: 'RESULTADOS', parentId: null },
      { id: 'eg', code: '4.2.00.00.000', name: 'EGRESOS', parentId: 'r4' },
      { id: 'ex', code: '4.3.00.00.000', name: 'Extraordinarios', parentId: 'r4' },
      // «Gastos del local» se movió a Extraordinarios y conservó su código.
      { id: 'gl', code: '4.2.01.03.000', name: 'Gastos del local', parentId: 'ex' },
      { id: 'lz', code: '4.2.01.03.004', name: 'Energía eléctrica', parentId: 'gl' },
    ]
    const entries = treeEntries(list)
    expect(entries.map((e) => e.account.id)).toEqual(['r4', 'eg', 'ex', 'gl', 'lz'])
    expect(entries.find((e) => e.account.id === 'lz')?.depth).toBe(3)
    expect(accountPaths(entries).get('lz')).toBe('RESULTADOS › Extraordinarios › Gastos del local')
  })

  it('una madre que no está en la lista o un ciclo no pierden cuentas', () => {
    const list = [
      { id: 'x', code: '9', name: 'Huérfana', parentId: 'no-existe' },
      { id: 'p', code: '7', name: 'P', parentId: 'q' },
      { id: 'q', code: '8', name: 'Q', parentId: 'p' },
    ]
    expect(
      treeEntries(list)
        .map((e) => e.account.id)
        .sort(),
    ).toEqual(['p', 'q', 'x'])
  })
})

describe('lo que se ve del árbol (chartView)', () => {
  const plan = standardPlan()
  const index = indexChart(plan)

  it('el plan estándar tiene 5 niveles y empieza por ACTIVO', () => {
    expect(index.maxLevel).toBe(5)
    expect(index.ordered.slice(0, 4).map((a) => a.code)).toEqual([
      '1.0.00.00.000',
      '1.1.00.00.000',
      '1.1.01.00.000',
      '1.1.01.01.000',
    ])
    // Toda cuenta que no es principal encuentra su grupo.
    expect(plan.filter((a) => a.parentId === null).map((a) => a.code)).toEqual([
      '1.0.00.00.000',
      '2.0.00.00.000',
      '3.0.00.00.000',
      '4.0.00.00.000',
      '5.0.00.00.000',
    ])
  })

  it('al entrar: las principales abiertas (nivel 2)', () => {
    const expanded = initialExpanded(index, null)
    expect(levelOfExpanded(index, expanded)).toBe(2)
    const view = chartView(index, { query: '', status: 'active', type: 'all', expanded })
    expect(view.rows.map((r) => r.code)).toEqual([
      '1.0.00.00.000',
      '1.1.00.00.000',
      '1.2.00.00.000',
      '2.0.00.00.000',
      '2.1.00.00.000',
      '2.2.00.00.000',
      '3.0.00.00.000',
      '3.1.00.00.000',
      '3.3.00.00.000',
      '4.0.00.00.000',
      '4.1.00.00.000',
      '4.2.00.00.000',
      '5.0.00.00.000',
      '5.1.00.00.000',
    ])
    expect(view.rows[0]).toMatchObject({ depth: 0, expandable: true, open: true })
    expect(view.rows[1]).toMatchObject({ depth: 1, expandable: true, open: false })
  })

  it('llegar con una cuenta (?cuenta=) abre su camino', () => {
    const iva = find(plan, '1.1.03.04.028')
    const expanded = initialExpanded(index, iva.id)
    const view = chartView(index, { query: '', status: 'active', type: 'all', expanded })
    expect(view.rows.some((r) => r.id === iva.id)).toBe(true)
  })

  it('«Ver hasta el nivel»: 1 solo principales, 5 todo', () => {
    expect(expandedForLevel(index, 1).size).toBe(0)
    expect(levelOfExpanded(index, new Set())).toBe(1)
    const all = expandedForLevel(index, 5)
    expect(all).toEqual(groupsWithChildren(index))
    expect(levelOfExpanded(index, all)).toBe(5)
    const view = chartView(index, { query: '', status: 'all', type: 'all', expanded: all })
    expect(view.rows).toHaveLength(plan.length)
    // Un grupo abierto a mano ya no es un nivel exacto.
    const custom = new Set(expandedForLevel(index, 2))
    custom.add(find(plan, '1.1.01.00.000').id)
    expect(levelOfExpanded(index, custom)).toBeNull()
  })

  it('buscar «1.1.01», «110101» o el código del grupo con ceros', () => {
    const none = new Set<string>()
    const codes = (query: string) =>
      chartView(index, { query, status: 'active', type: 'all', expanded: none })
        .rows.filter((r) => r.match)
        .map((r) => r.code)
    expect(codes('1.1.01')).toEqual([
      '1.1.01.00.000',
      '1.1.01.01.000',
      '1.1.01.01.001',
      '1.1.01.03.000',
      '1.1.01.03.001',
      '1.1.01.04.000',
      '1.1.01.04.001',
      '1.1.01.04.002',
    ])
    expect(codes('1.1.01.00.000')).toEqual(codes('1.1.01'))
    expect(codes('110101')).toEqual(['1.1.01.01.000', '1.1.01.01.001'])
    const view = chartView(index, {
      query: '110101',
      status: 'active',
      type: 'all',
      expanded: none,
    })
    // Buscando se abre el camino (sin desplegar a mano).
    expect(view.autoOpen).toBe(true)
    expect(view.rows.map((r) => r.code)).toEqual([
      '1.0.00.00.000',
      '1.1.00.00.000',
      '1.1.01.00.000',
      '1.1.01.01.000',
      '1.1.01.01.001',
    ])
    expect(codes('proveedores')).toContain('2.1.01.01.001')
  })

  it('por tipo: los egresos de adentro de «Resultado del ejercicio» se ven con su grupo', () => {
    const all = expandedForLevel(index, 5)
    const view = chartView(index, { query: '', status: 'active', type: 'expense', expanded: all })
    const byCode = new Map(view.rows.map((r) => [r.code, r]))
    expect(byCode.get('4.0.00.00.000')?.match).toBe(false) // ingreso: es el camino
    expect(byCode.get('4.2.00.00.000')?.match).toBe(true)
    expect(byCode.has('4.1.00.00.000')).toBe(false) // ingresos sin egresos adentro
    expect(byCode.has('1.0.00.00.000')).toBe(false)
    expect(view.matches).toBe(plan.filter((a) => a.type === 'expense').length)
  })

  it('inactivas: solo esas, con su camino abierto', () => {
    const withInactive = plan.map((a) => (a.code === '4.2.01.03.016' ? { ...a, active: false } : a))
    const idx = indexChart(withInactive)
    const view = chartView(idx, {
      query: '',
      status: 'inactive',
      type: 'all',
      expanded: new Set(),
    })
    expect(view.rows.filter((r) => r.match).map((r) => r.code)).toEqual(['4.2.01.03.016'])
    expect(view.rows.map((r) => r.code)).toEqual([
      '4.0.00.00.000',
      '4.2.00.00.000',
      '4.2.01.00.000',
      '4.2.01.03.000',
      '4.2.01.03.016',
    ])
  })
})

describe('código propuesto y tipo de una cuenta nueva', () => {
  const plan = standardPlan()
  const index = indexChart(plan)

  it('con el estilo del grupo (espejo de acc_next_child_code)', () => {
    expect(proposeChildCode(index, find(plan, '1.1.01.01.000'))).toBe('1.1.01.01.002')
    expect(proposeChildCode(index, find(plan, '4.0.00.00.000'))).toBe('4.3.00.00.000')
    expect(proposeChildCode(index, find(plan, '1.1.01.00.000'))).toBe('1.1.01.05.000')
    const dotted = indexChart([
      group('1', 'Activo'),
      group('1.1', 'Corriente'),
      group('1.1.01', 'Caja'),
      group('1.1.01.01', 'Caja chica', { postable: true }),
      group('1.1.01.02', 'Caja grande', { postable: true }),
    ])
    const cajaGroup = dotted.ordered.find((a) => a.code === '1.1.01') as ChartAccount
    expect(proposeChildCode(dotted, cajaGroup)).toBe('1.1.01.03')
  })

  it('el esquema sin puntos (1101 → 110103)', () => {
    const root = group('1101', 'Caja')
    const idx = indexChart([
      root,
      group('110101', 'Caja chica', { parentId: root.id, postable: true }),
      group('110102', 'Caja grande', { parentId: root.id, postable: true }),
    ])
    expect(proposeChildCode(idx, root)).toBe('110103')
  })

  it('una principal nueva: la siguiente con la misma forma', () => {
    expect(proposeRootCode(index)).toBe('6.0.00.00.000')
    expect(proposeRootCode(indexChart([group('1', 'A'), group('2', 'P')]))).toBe('3')
    expect(proposeRootCode(indexChart([]))).toBe('1')
  })

  it('tipo: principal elige; bajo resultados ingreso o egreso; en el resto el del grupo', () => {
    expect(createTypeChoice(null)).toEqual({
      kind: 'choose',
      options: ['asset', 'liability', 'equity', 'income', 'expense'],
      fallback: null,
    })
    expect(createTypeChoice(find(plan, '4.0.00.00.000'))).toEqual({
      kind: 'choose',
      options: ['income', 'expense'],
      fallback: 'income',
    })
    expect(createTypeChoice(find(plan, '1.1.03.02.000'))).toMatchObject({
      kind: 'fixed',
      type: 'asset',
    })
  })

  it('editar el tipo: solo bajo resultados o en una principal, nunca en una del sistema', () => {
    expect(editTypeChoice(index, find(plan, '1.1.03.04.028'))).toEqual({
      kind: 'fixed',
      type: 'asset',
      reason: 'La usa el sistema: no cambia de tipo.',
    })
    expect(editTypeChoice(index, find(plan, '4.2.01.03.000'))).toEqual({
      kind: 'choose',
      options: ['income', 'expense'],
      fallback: 'expense',
    })
    expect(editTypeChoice(index, find(plan, '1.1.03.02.004'))).toMatchObject({ kind: 'fixed' })
    expect(editTypeChoice(index, find(plan, '4.0.00.00.000'))).toMatchObject({
      kind: 'choose',
      options: ['income', 'expense'],
    })
    expect(editTypeChoice(index, find(plan, '1.0.00.00.000'))).toEqual({
      kind: 'fixed',
      type: 'asset',
      reason: 'Lo deciden las cuentas que tiene adentro.',
    })
    expect(editTypeChoice(index, find(plan, '1.1.01.01.001'))).toMatchObject({ kind: 'fixed' })
  })
})

describe('mover con todo lo de adentro (cuántas se mueven)', () => {
  const plan = standardPlan()
  const extra = group('4.3.00.00.000', 'Resultados extraordinarios', {
    type: 'expense',
    parentId: find(plan, '4.0.00.00.000').id,
    level: 2,
  })
  const full = [...plan, extra]
  const index = indexChart(full)
  const local = find(full, '4.2.01.03.000')

  it('un grupo se mueve con sus 23 cuentas: la confirmación dice 24', () => {
    expect(checkMove(index, local, extra)).toEqual({
      ok: true,
      typeAfter: 'expense',
      typeChanges: false,
    })
    const summary = moveSummary(index, local, extra)
    expect(summary).toMatchObject({ count: 24, descendants: 23, inactive: 0 })
    expect(summary.from?.code).toBe('4.2.01.00.000')
    expect(summary.to?.code).toBe('4.3.00.00.000')
    expect(moveCountText(summary, local.name)).toBe(
      'Se mueven 24 cuentas: «Gastos del local» y las 23 que tiene adentro.',
    )
  })

  it('una sola cuenta, y las desactivadas también se cuentan', () => {
    const leaf = find(full, '4.2.01.03.004')
    const one = moveSummary(index, leaf, extra)
    expect(one).toMatchObject({ count: 1, descendants: 0 })
    expect(moveCountText(one, leaf.name)).toBe('Se mueve 1 cuenta.')
    const withInactive = indexChart(
      full.map((a) => (a.code === '4.2.01.03.016' ? { ...a, active: false } : a)),
    )
    expect(moveSummary(withInactive, local, extra).inactive).toBe(1)
    const smallGroup = find(full, '4.2.02.05.000')
    expect(moveCountText(moveSummary(index, smallGroup, extra), smallGroup.name)).toBe(
      'Se mueven 2 cuentas: «Seguros» y la que tiene adentro.',
    )
  })

  it('nunca adentro de sí misma, de una imputable ni donde ya está', () => {
    expect(checkMove(index, local, local)).toMatchObject({ ok: false })
    const egresos = find(full, '4.2.00.00.000')
    expect(checkMove(index, egresos, local)).toEqual({
      ok: false,
      reason: 'No puede ir adentro de sí misma ni de lo que tiene adentro.',
    })
    expect(checkMove(index, local, find(full, '4.2.01.03.004'))).toMatchObject({
      ok: false,
      reason: 'Es una cuenta imputable: no puede tener cuentas adentro.',
    })
    expect(checkMove(index, local, find(full, '4.2.01.00.000'))).toEqual({
      ok: false,
      reason: 'Ya está adentro de ese grupo.',
    })
  })

  it('a otro tipo: una suelta cambia de tipo; las del sistema, de una caja o con cuentas adentro no', () => {
    const otherDebts = find(full, '2.1.01.06.000')
    expect(checkMove(index, find(full, '1.1.03.02.004'), otherDebts)).toEqual({
      ok: true,
      typeAfter: 'liability',
      typeChanges: true,
    })
    expect(checkMove(index, find(full, '1.1.03.04.028'), otherDebts)).toEqual({
      ok: false,
      reason: 'La usa el sistema: solo puede ir a un grupo de activo.',
    })
    expect(checkMove(index, find(full, '1.1.01.01.001'), otherDebts)).toMatchObject({
      ok: false,
    })
    expect(checkMove(index, local, find(full, '1.1.00.00.000'))).toEqual({
      ok: false,
      reason: 'Tiene cuentas adentro: solo puede ir a un grupo de egresos.',
    })
  })

  it('como principal: solo un grupo', () => {
    expect(checkMove(index, local, null)).toMatchObject({ ok: true, typeChanges: false })
    expect(checkMove(index, find(full, '4.2.01.03.004'), null)).toMatchObject({ ok: false })
  })

  it('hasta 8 niveles, contando lo que tiene adentro', () => {
    const chain: ChartAccount[] = []
    let parent: ChartAccount | null = null
    for (let level = 1; level <= 8; level += 1) {
      const g: ChartAccount = group(`9${'.1'.repeat(level - 1)}`, `N${level}`, {
        parentId: parent?.id ?? null,
        level,
      })
      chain.push(g)
      parent = g
    }
    const x = group('8.0', 'X', { parentId: chain[0]?.id ?? null, level: 2 })
    const y = group('8.0.1', 'Y', { parentId: x.id, level: 3 })
    const z = group('8.0.1.1', 'Z', { parentId: y.id, level: 4, postable: true })
    const idx = indexChart([...chain, x, y, z])
    // X tiene 2 niveles adentro: debajo de uno de nivel 5 queda en 8; de nivel 6, en 9.
    expect(checkMove(idx, x, chain[4] ?? null).ok).toBe(true)
    expect(checkMove(idx, x, chain[5] ?? null)).toEqual({
      ok: false,
      reason: 'Quedaría a más de 8 niveles.',
    })
  })

  it('los destinos posibles de un grupo de egresos', () => {
    const codes = moveTargets(index, local).map((g) => g.code)
    expect(codes).toContain('4.3.00.00.000')
    expect(codes).toContain('4.0.00.00.000')
    expect(codes).toContain('5.1.01.02.000')
    expect(codes).not.toContain('4.2.01.00.000') // donde ya está
    expect(codes).not.toContain('4.2.01.03.000') // ella misma
    expect(codes).not.toContain('1.1.00.00.000') // otro tipo
  })
})

describe('desactivar: las reglas de la base en criollo', () => {
  const plan = standardPlan()
  const index = indexChart(plan)

  it('la del sistema no, un grupo con cuentas activas no, con saldo no', () => {
    expect(deactivationBlock(index, find(plan, '1.1.03.04.028'), true)).toContain(
      'La usa el sistema',
    )
    expect(deactivationBlock(index, find(plan, '4.2.01.03.000'), true)).toContain(
      'cuentas activas adentro',
    )
    const withBalance = { ...find(plan, '1.1.03.02.004'), balanceCents: 150_000 }
    expect(deactivationBlock(index, withBalance, true)).toMatch(/^Tiene saldo \(.*1\.500,00\)/)
    expect(deactivationBlock(index, withBalance, false)).toBeNull()
    expect(deactivationBlock(index, find(plan, '1.1.03.02.004'), true)).toBeNull()
  })

  it('lo que contesta la base, según la cuenta', () => {
    const inUse = {
      ok: false as const,
      code: 'conflict' as const,
      message: 'catálogo',
      detail: { key: 'account_in_use' },
    }
    expect(deactivateRefusal(inUse, find(plan, '1.1.01.01.001'))).toContain('caja o banco activo')
    expect(deactivateRefusal(inUse, find(plan, '4.2.01.03.000'))).toBe(
      'Tiene cuentas activas adentro: desactivalas primero.',
    )
    expect(deactivateRefusal(inUse, find(plan, '1.1.03.02.004'))).toContain('gasto fijo')
    expect(
      deactivateRefusal(
        { ...inUse, detail: { key: 'account_has_balance' } },
        find(plan, '1.1.03.02.004'),
      ),
    ).toContain('asiento manual')
  })
})

describe('cada error en su campo (formFeedback)', () => {
  it('el código repetido va al campo; lo que no tiene campo, arriba de los botones', () => {
    const taken = {
      ok: false as const,
      code: 'invalid' as const,
      message: 'Ese código ya existe en el plan de cuentas.',
      detail: { key: 'code_taken' },
    }
    expect(formFeedback(taken, ['code', 'name'])).toEqual({
      fields: { code: 'Ese código ya existe en el plan de cuentas.' },
      message: null,
    })
    const moves = { ...taken, code: 'conflict' as const, detail: { key: 'account_has_movements' } }
    expect(formFeedback(moves, ['code']).message).toContain('ya tiene movimientos')
    const zod = {
      ok: false as const,
      code: 'invalid' as const,
      message: 'Recargá la página y probá de nuevo.',
      fieldErrors: { expectedUpdatedAt: 'Recargá la página y probá de nuevo.' },
    }
    expect(formFeedback(zod, ['code']).message).toBe('Recargá la página y probá de nuevo.')
  })
})

describe('cuentas del sistema', () => {
  it('cada clave del motor tiene su uso en criollo, en un grupo', () => {
    for (const key of SYSTEM_ACCOUNT_KEYS) {
      expect(SYSTEM_USES[key].label.length).toBeGreaterThan(3)
      expect(SYSTEM_USES[key].use).toMatch(/\.$/)
    }
    const grouped = SYSTEM_USE_GROUPS.flatMap((g) => systemKeysOf(g.value))
    expect(grouped.sort()).toEqual([...SYSTEM_ACCOUNT_KEYS].sort())
    expect(new Set(Object.values(SYSTEM_USES).map((u) => u.label)).size).toBe(
      SYSTEM_ACCOUNT_KEYS.length,
    )
    expect(systemUse('vat_credit')?.label).toBe('IVA crédito fiscal')
    expect(systemUse('no_existe')).toBeNull()
  })

  it('solo sirven cuentas del mismo tipo, lado y control (espejo de la base)', () => {
    const plan = standardPlan()
    const vatCredit = find(plan, '1.1.03.04.028')
    const candidate = group('1.1.03.04.040', 'IVA CF compras', { postable: true })
    expect(remapCompatible(vatCredit, candidate)).toBe(true)
    expect(remapCompatible(vatCredit, { ...candidate, requiresParty: true })).toBe(false)
    expect(remapCompatible(vatCredit, { ...candidate, normalSide: 'credit' })).toBe(false)
    expect(remapCompatible(vatCredit, { ...candidate, type: 'expense' })).toBe(false)
    expect(remapCompatible(vatCredit, { ...candidate, postable: false })).toBe(false)
    expect(remapCompatible(vatCredit, { ...candidate, active: false })).toBe(false)
    expect(remapCompatible(vatCredit, { ...candidate, isTreasury: true })).toBe(false)
    expect(remapCompatible(vatCredit, { ...candidate, systemKey: 'vat_debit' })).toBe(false)
    expect(remapCompatible(vatCredit, vatCredit)).toBe(false)
    expect(
      remapRefusal({
        ok: false,
        code: 'invalid',
        message: 'catálogo',
        detail: { key: 'system_remap_incompatible', reason: 'type' },
      }),
    ).toBe('Esa cuenta es de otro tipo. Elegí otra.')
  })

  it('lo que devuelve acc_remap_system_account', () => {
    expect(
      parseSystemRemapResult({
        system_key: 'vat_credit',
        changed: true,
        from: { id: '00000000-0000-4000-8000-000000000001', code: '1.1.03.04.028', name: 'IVA' },
        to: {
          id: '00000000-0000-4000-8000-000000000002',
          code: '1.1.03.04.040',
          name: 'IVA CF compras',
          type: 'asset',
        },
        parties_repointed: 0,
      }),
    ).toEqual({
      systemKey: 'vat_credit',
      changed: true,
      from: { id: '00000000-0000-4000-8000-000000000001', code: '1.1.03.04.028', name: 'IVA' },
      to: {
        id: '00000000-0000-4000-8000-000000000002',
        code: '1.1.03.04.040',
        name: 'IVA CF compras',
      },
      partiesRepointed: 0,
    })
    expect(parseSystemRemapResult({ to: null })).toBeNull()
  })
})

describe('«Importar plan»: de lo que contesta la base a la vista previa', () => {
  const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  // Lo que devuelve acc_import_accounts (ensayo; jsonb_strip_nulls saca las claves nulas).
  const raw = {
    dry_run: true,
    applied: false,
    total: 8,
    creates: 2,
    updates: 2,
    unchanged: 1,
    errors: 3,
    rows: [
      {
        row: 1,
        code: '1.1.01.01.000',
        name: 'CAJA Y BANCOS',
        action: 'update',
        account_id: ID(1),
        parent_code: '1.1.01.00.000',
        level: 4,
        type: 'asset',
        normal_side: 'debit',
        postable: false,
        changes: ['name'],
        previous: {
          name: 'Caja y bancos',
          parent_code: '1.1.01.00.000',
          type: 'asset',
          normal_side: 'debit',
          postable: false,
        },
      },
      {
        row: 2,
        code: '1.1.01.02.000',
        name: 'BANCOS',
        action: 'create',
        parent_code: '1.1.01.00.000',
        level: 4,
        type: 'asset',
        normal_side: 'debit',
        postable: false,
      },
      {
        row: 3,
        code: '1.1.01.02.001',
        name: 'BANCO GALICIA',
        action: 'create',
        parent_code: '1.1.01.02.000',
        level: 5,
        type: 'asset',
        normal_side: 'debit',
        postable: true,
      },
      {
        row: 4,
        code: '1.1.03.04.028',
        name: 'IVA CREDITO FISCAL',
        action: 'update',
        account_id: ID(4),
        parent_code: '1.1.03.04.000',
        level: 5,
        type: 'asset',
        normal_side: 'debit',
        postable: true,
        system_key: 'vat_credit',
        changes: ['name', 'parent'],
        previous: {
          name: 'IVA crédito fiscal',
          parent_code: '1.1.03.02.000',
          type: 'asset',
          normal_side: 'debit',
          postable: true,
        },
      },
      {
        row: 5,
        code: '2.1.01.01.001',
        name: 'Proveedores',
        action: 'none',
        account_id: ID(5),
        parent_code: '2.1.01.01.000',
        level: 5,
        type: 'liability',
        normal_side: 'credit',
        postable: true,
        system_key: 'payable_suppliers',
      },
      {
        row: 6,
        code: '6.0.00.00.000',
        name: 'CUENTAS DE ORDEN',
        action: 'error',
        level: 1,
        error: 'import_type_required',
        error_detail: {},
      },
      {
        row: 7,
        code: '6.1.00.00.000',
        name: 'DEUDORAS',
        action: 'error',
        parent_code: '6.0.00.00.000',
        level: 2,
        error: 'import_parent_has_errors',
        error_detail: { parent_code: '6.0.00.00.000' },
      },
      {
        row: 8,
        code: '1.1.01.02.001',
        name: 'BANCO REPETIDO',
        action: 'error',
        error: 'import_duplicate_code',
        error_detail: { row: 3 },
      },
    ],
  }
  const planNames = new Map([
    ['1.1.01.00.000', 'Caja, bancos y valores a depositar'],
    ['1.1.03.04.000', 'Anticipos de impuestos y créditos fiscales'],
    ['2.1.01.01.000', 'Deudas comerciales'],
  ])

  it('lee el jsonb: una fila con error siempre es error y los conteos salen de las filas', () => {
    const parsed = parseChartImportResult({
      ...raw,
      rows: [
        ...raw.rows,
        { row: 9, code: '7', name: 'X', action: 'create', error: 'code_invalid' },
      ],
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.rows[8]).toMatchObject({ action: 'error', error: 'code_invalid' })
    expect(parsed).toMatchObject({ dryRun: true, applied: false, total: 9, errors: 4, creates: 2 })
    expect(parsed?.rows[0]).toMatchObject({
      accountId: ID(1),
      parentCode: '1.1.01.00.000',
      changes: ['name'],
      previous: { name: 'Caja y bancos', postable: false, description: null },
    })
    expect(parsed?.rows[5]).toMatchObject({ parentCode: null, type: null, errorDetail: {} })
    expect(parseChartImportResult(null)).toBeNull()
  })

  it('nuevas, las que cambian (y qué), sin cambios y errores por línea, con su grupo', () => {
    const result = parseChartImportResult(raw)
    if (!result) throw new Error('sin resultado')
    const preview = buildImportPreview(result, planNames)
    expect(preview.counts).toEqual({ total: 8, creates: 2, updates: 2, unchanged: 1, errors: 3 })
    expect(preview.canImport).toBe(false)
    expect(preview.missingTypes).toBe(1)

    const [caja, bancos, galicia, iva, proveedores, orden, deudoras, repetido] = preview.rows
    expect(caja).toMatchObject({
      kind: 'changed',
      status: 'Cambia',
      parentName: 'Caja, bancos y valores a depositar',
      details: ['Nombre: «Caja y bancos» → «CAJA Y BANCOS»'],
    })
    expect(bancos).toMatchObject({ kind: 'new', status: 'Nueva', postable: false })
    // El grupo inferido que también viene en lo pegado se nombra como en lo pegado.
    expect(galicia).toMatchObject({
      kind: 'new',
      parentCode: '1.1.01.02.000',
      parentName: 'BANCOS',
    })
    expect(iva).toMatchObject({
      kind: 'changed',
      systemLabel: 'IVA crédito fiscal',
      details: [
        'Nombre: «IVA crédito fiscal» → «IVA CREDITO FISCAL»',
        'Pasa adentro de 1.1.03.04.000 Anticipos de impuestos y créditos fiscales',
      ],
    })
    expect(proveedores).toMatchObject({
      kind: 'same',
      status: 'Sin cambios',
      systemLabel: 'Proveedores',
    })
    expect(orden).toMatchObject({
      kind: 'error',
      rootNeedsType: true,
      error: 'Es una cuenta principal nueva: elegí su tipo.',
    })
    expect(deudoras?.error).toBe('Su grupo (6.0.00.00.000) tiene un problema: corregilo primero.')
    expect(repetido?.error).toBe('Ese código ya está en la línea 3.')
  })

  it('con el tipo elegido se puede importar', () => {
    const fixed = parseChartImportResult({
      ...raw,
      rows: [
        ...raw.rows.slice(0, 5),
        {
          row: 6,
          code: '6.0.00.00.000',
          name: 'CUENTAS DE ORDEN',
          action: 'create',
          level: 1,
          type: 'asset',
          normal_side: 'debit',
          postable: false,
        },
      ],
    })
    if (!fixed) throw new Error('sin resultado')
    const preview = buildImportPreview(fixed, planNames)
    expect(preview.canImport).toBe(true)
    expect(preview.missingTypes).toBe(0)
    // La principal nueva sigue mostrando su tipo para poder cambiarlo.
    expect(preview.rows[5]).toMatchObject({ kind: 'new', rootNeedsType: true, type: 'asset' })
  })

  it('el tipo elegido viaja solo a las líneas que quedan como principales', () => {
    const pasted = [
      { code: '6.0.00.00.000' },
      { code: '6.1.00.00.000' },
      { code: '1.1.01.02.000' },
      { code: '7' },
      { code: '7.01' },
    ]
    expect(pastedRootCodes(pasted, ['1.0.00.00.000', '1.1.01.00.000'])).toEqual(
      new Set(['6.0.00.00.000', '7']),
    )
  })

  it('los errores de cada línea, en criollo', () => {
    expect(
      importRowError({
        error: 'parent_is_postable',
        errorDetail: { parent_code: '1.1.01.01.001' },
      }),
    ).toBe('1.1.01.01.001 es una cuenta imputable: no puede tener cuentas adentro.')
    expect(
      importRowError({
        error: 'import_treasury_conflict',
        errorDetail: { account_code: '1.1.01.01.001', account_name: 'Caja' },
      }),
    ).toBe('Es la cuenta de la caja «Caja»: su nombre se cambia desde Ajustes › Cajas y cuentas.')
    expect(
      importRowError({ error: 'import_parent_not_found', errorDetail: { parent_code: '9.9' } }),
    ).toBe('No encontramos el grupo 9.9 ni en el plan ni en lo que pegaste.')
    expect(importRowError({ error: 'algo_raro', errorDetail: {} })).toBe('Revisá esta línea.')
  })
})

describe('esquemas del plan (zod en el borde)', () => {
  const U = '00000000-0000-4000-8000-000000000001'
  const messageAt = (schema: typeof accountSchema, value: unknown, path: string) => {
    const r = schema.safeParse(value)
    if (r.success) return null
    return r.error.issues.find((i) => i.path.join('.') === path)?.message ?? null
  }

  it('una cuenta principal: grupo, con tipo y código', () => {
    const ok = accountSchema.safeParse({
      mode: 'create',
      parentId: null,
      type: 'asset',
      code: '6.0.00.00.000',
      name: 'Cuentas de orden',
      postable: false,
    })
    expect(ok.success).toBe(true)
    const base = { mode: 'create', parentId: null, name: 'Cuentas de orden', postable: false }
    expect(messageAt(accountSchema, { ...base, code: '6.0.00.00.000' }, 'type')).toBe(
      'Elegí el tipo de la cuenta.',
    )
    expect(messageAt(accountSchema, { ...base, type: 'asset' }, 'code')).toContain(
      'cuenta principal',
    )
    expect(
      messageAt(accountSchema, { ...base, type: 'asset', code: '6', postable: true }, 'postable'),
    ).toBe('Una cuenta principal es siempre un grupo.')
    expect(messageAt(accountSchema, { mode: 'create', name: 'Sin grupo' }, 'parentId')).toBe(
      'Elegí el grupo.',
    )
  })

  it('alta adentro de un grupo de resultados con otro tipo; edición que mueve o pasa a principal', () => {
    const created = accountSchema.safeParse({
      mode: 'create',
      parentId: U,
      type: 'expense',
      name: 'Resultados extraordinarios',
      postable: false,
    })
    expect(created.success && created.data.mode === 'create' && created.data.type).toBe('expense')
    expect(
      messageAt(
        accountSchema,
        { mode: 'create', parentId: U, name: 'Grupo', postable: false, requiresParty: true },
        'requiresParty',
      ),
    ).toBe('Solo una cuenta imputable puede llevar proveedor o cliente.')
    const moved = accountSchema.safeParse({
      mode: 'update',
      id: U,
      expectedUpdatedAt: UPDATED,
      parentId: null,
    })
    expect(moved.success && moved.data.mode === 'update' && moved.data.parentId).toBeNull()
    expect(
      accountSchema.safeParse({
        mode: 'update',
        id: U,
        expectedUpdatedAt: UPDATED,
        type: 'income',
        requiresParty: true,
        code: '4.2.01.03.034',
      }).success,
    ).toBe(true)
  })

  it('importar: entre 1 y 2000 líneas; usar otra cuenta: una clave del motor', () => {
    expect(chartImportSchema.safeParse({ rows: [], dryRun: true }).error?.issues[0]?.message).toBe(
      'Pegá al menos una cuenta con su código y su nombre.',
    )
    const many = Array.from({ length: 2001 }, (_, i) => ({ code: `9.${i}`, name: 'X' }))
    expect(
      chartImportSchema.safeParse({ rows: many, dryRun: true }).error?.issues[0]?.message,
    ).toBe('Se pueden importar hasta 2000 cuentas por vez: partí la lista en tandas.')
    expect(
      chartImportSchema.safeParse({
        rows: [{ code: '6', name: 'ORDEN', type: 'activo' }],
        dryRun: true,
      }).error?.issues[0]?.message,
    ).toBe('Elegí el tipo de cuenta.')
    expect(
      chartImportSchema.safeParse({
        rows: [{ code: ' 1.1.01.01.001 ', name: 'CAJA' }],
        dryRun: false,
      }).data?.rows[0]?.code,
    ).toBe('1.1.01.01.001')
    expect(systemRemapSchema.safeParse({ systemKey: 'vat_credit', accountId: U }).success).toBe(
      true,
    )
    expect(
      systemRemapSchema.safeParse({ systemKey: 'otra_cosa', accountId: U }).error?.issues[0]
        ?.message,
    ).toBe('Recargá la página y probá de nuevo.')
  })
})
