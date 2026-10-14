// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  AccountCreateForm,
  createAccountDefaults,
  createAccountInput,
} from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_components/account-create-form'
import { AccountEditForm } from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_components/account-edit-form'
import {
  CategoryList,
  NewCategoryButton,
} from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_components/category-list'
import { ChartWorkspace } from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_components/chart-workspace'
import {
  categoryCount,
  categoryListGroups,
  categoryUsedText,
  filterCategoryGroups,
  usedCategoryCount,
} from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_lib/categories'
import {
  type ChartAccount,
  indexChart,
} from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_lib/tree'
import {
  categoryGroups,
  categoryOptions,
  FIXED_ASSETS_GROUP_ID,
  FIXED_ASSETS_GROUP_NAME,
  FIXED_ASSETS_GROUP_NOTE,
} from '@/components/administracion/kit/category'
import { chartLevel, chartParentCode, STANDARD_CHART } from '@/lib/accounting/chart'

/**
 * «Tus categorías»: lo que ve un socio del plan de cuentas. Con el plan
 * estándar son 51, en los mismos grupos que el selector de «¿En qué se gastó?»
 * (los arma el kit: acá se comprueba que la lista no invente otros), y el alta
 * corta manda lo mismo que la completa con los valores de siempre.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/hub/administracion/plan-de-cuentas',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/accounting/actions/master', () => ({
  saveAccount: vi.fn(),
  importAccounts: vi.fn(),
  remapSystemAccount: vi.fn(),
}))

const plain = (text: string) => text.replaceAll(' ', ' ')

function idOf(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
}

/** El plan estándar como lo lee la página, con algunos saldos puestos a mano. */
function standardPlan(balances: Readonly<Record<string, number>> = {}): ChartAccount[] {
  const ids = new Map(STANDARD_CHART.map((a, i) => [a.code, idOf(i)]))
  return STANDARD_CHART.map((a) => {
    const parentCode = chartParentCode(a.code)
    return {
      id: ids.get(a.code) ?? '',
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
      balanceCents: balances[a.code] ?? 0,
      hasChildren: false,
      updatedAt: '2026-10-07T12:00:00.000+00:00',
    }
  })
}

describe('las categorías del plan estándar', () => {
  const plan = standardPlan()
  const groups = categoryListGroups(plan)

  it('son 51, las que tienen tildado «Aparece en «¿En qué se gastó?»»', () => {
    expect(categoryCount(groups)).toBe(51)
    expect(categoryCount(groups)).toBe(
      plan.filter((a) => a.postable && a.purchaseSelectable).length,
    )
  })

  it('son los MISMOS grupos, en el mismo orden y con los mismos nombres que el selector', () => {
    const byId = new Map(plan.map((a) => [a.id, a]))
    const fromKit = categoryGroups(
      categoryOptions(plan, (id) => byId.get(id)?.purchaseSelectable === true),
    )
    expect(groups.map((g) => [g.id, g.name])).toEqual(fromKit.map((g) => [g.id, g.name]))
    expect(groups.map((g) => g.items.map((i) => [i.id, i.shortName]))).toEqual(
      fromKit.map((g) => g.options.map((o) => [o.id, o.shortName])),
    )
  })

  it('los bienes van juntos en el último grupo, «Equipos y muebles», con su aclaración', () => {
    const last = groups.at(-1)
    expect(last?.id).toBe(FIXED_ASSETS_GROUP_ID)
    expect(last?.name).toBe(FIXED_ASSETS_GROUP_NAME)
    expect(last?.name).toBe('Equipos y muebles')
    expect(last?.note).toBe(FIXED_ASSETS_GROUP_NOTE)
    expect(last?.note).toBe('Quedan en el bar: no son gasto del mes.')
    const byId = new Map(plan.map((a) => [a.id, a]))
    expect(last?.items.every((i) => byId.get(i.id)?.type === 'asset')).toBe(true)
    // Es un grupo armado, no una cuenta del plan: ahí no hay «Agregar en …».
    expect(last?.parentId).toBeNull()
    // Los demás son grupos de verdad y ninguno lleva aclaración.
    for (const group of groups.slice(0, -1)) {
      expect(group.note).toBeNull()
      expect(group.parentId).toBe(group.id)
      expect(byId.get(group.id)?.postable).toBe(false)
    }
  })

  it('cada categoría trae su «para qué se usa» y lo anotado; nunca un cero', () => {
    const first = plan.find((a) => a.postable && a.purchaseSelectable && a.type === 'expense')
    if (!first) throw new Error('el plan estándar tiene categorías de gasto')
    const withUse = categoryListGroups(standardPlan({ [first.code]: 85_650_000 }))
    const item = withUse.flatMap((g) => g.items).find((i) => i.id === first.id)
    expect(item?.usedCents).toBe(85_650_000)
    expect(plain(categoryUsedText(item?.usedCents ?? null))).toBe('$ 856.500 en el año')
    expect(usedCategoryCount(withUse)).toBe(1)
    // Sin uso (saldo en cero, negativo o sin saldos): se dice con palabras.
    expect(usedCategoryCount(groups)).toBe(0)
    expect(categoryUsedText(null)).toBe('sin uso')
    expect(categoryUsedText(0)).toBe('sin uso')
    expect(categoryUsedText(-500)).toBe('sin uso')
    const noBalances = categoryListGroups(plan.map((a) => ({ ...a, balanceCents: null })))
    expect(noBalances.flatMap((g) => g.items).every((i) => i.usedCents === null)).toBe(true)
  })

  it('una cuenta inactiva o sin el tilde no es una categoría', () => {
    const target = plan.find((a) => a.postable && a.purchaseSelectable)
    if (!target) throw new Error('el plan estándar tiene categorías')
    const inactive = plan.map((a) => (a.id === target.id ? { ...a, active: false } : a))
    expect(categoryCount(categoryListGroups(inactive))).toBe(50)
    const unticked = plan.map((a) => (a.id === target.id ? { ...a, purchaseSelectable: false } : a))
    expect(categoryCount(categoryListGroups(unticked))).toBe(50)
  })

  it('el buscador: por nombre, por «para qué se usa» y por grupo, sin tildes ni mayúsculas', () => {
    expect(filterCategoryGroups(groups, '')).toHaveLength(groups.length)
    expect(filterCategoryGroups(groups, '   ')).toHaveLength(groups.length)
    expect(filterCategoryGroups(groups, 'zzzz no existe')).toEqual([])

    const sample = groups[0]?.items[0]
    if (!sample) throw new Error('hay categorías')
    const byName = filterCategoryGroups(groups, sample.shortName.toUpperCase())
    expect(byName.flatMap((g) => g.items).some((i) => i.id === sample.id)).toBe(true)

    // Por el nombre del grupo: trae el grupo entero.
    const group = groups[0]
    if (!group) throw new Error('hay grupos')
    const byGroup = filterCategoryGroups(groups, group.name)
    expect(byGroup.find((g) => g.id === group.id)?.items).toHaveLength(group.items.length)

    // Los grupos que quedan vacíos no se devuelven.
    for (const found of byName) expect(found.items.length).toBeGreaterThan(0)
  })

  it('un nombre de 60 caracteres no rompe nada', () => {
    const long = 'Servicio técnico de la cámara de frío y de los equipos de la barra'
    const target = plan.find((a) => a.postable && a.purchaseSelectable)
    if (!target) throw new Error('el plan estándar tiene categorías')
    const renamed = plan.map((a) => (a.id === target.id ? { ...a, name: long } : a))
    const item = categoryListGroups(renamed)
      .flatMap((g) => g.items)
      .find((i) => i.id === target.id)
    expect(item?.shortName).toBe(long)
  })
})

describe('el alta corta manda lo mismo que la completa', () => {
  const parentId = '00000000-0000-4000-8000-0000000000aa'

  it('en un grupo de gastos, con los valores de siempre', () => {
    const defaults = createAccountDefaults('expense')
    expect(defaults).toEqual({
      kind: 'postable',
      requiresParty: false,
      purchase: true,
      contra: false,
      manual: true,
    })
    const sent = createAccountInput({
      isRoot: false,
      parentChoice: parentId,
      // Adentro de un grupo de egresos el tipo se elige entre ingreso y egreso, y arranca en egreso.
      typeChoice: 'choose',
      type: 'expense',
      shownCode: '4.2.01.01.009',
      codeTouched: false,
      code: '',
      name: 'Hielo',
      description: '  Bolsas de hielo para la barra  ',
      postable: defaults.kind === 'postable',
      requiresParty: defaults.requiresParty,
      showPurchase: true,
      purchase: defaults.purchase,
      contra: defaults.contra,
      manual: defaults.manual,
    })
    // Lo que mandaba (y sigue mandando) el formulario completo sin tocar nada más que el nombre.
    expect(sent).toEqual({
      mode: 'create',
      parentId,
      type: 'expense',
      // Sin tocar el código, lo elige la base (el siguiente libre del grupo).
      code: null,
      name: 'Hielo',
      postable: true,
      contra: false,
      requiresParty: false,
      purchaseSelectable: true,
      manualSelectable: true,
      description: 'Bolsas de hielo para la barra',
    })
  })

  it('en un grupo que fija el tipo (un activo), no se manda tipo', () => {
    const sent = createAccountInput({
      isRoot: false,
      parentChoice: parentId,
      typeChoice: 'fixed',
      type: null,
      shownCode: '1.2.01.01.009',
      codeTouched: false,
      code: '',
      name: 'Heladera exhibidora',
      description: '',
      postable: true,
      requiresParty: false,
      showPurchase: true,
      purchase: createAccountDefaults('asset').purchase,
      contra: false,
      manual: true,
    })
    expect(sent).toMatchObject({ type: null, purchaseSelectable: false, description: null })
  })

  it('fuera de los gastos, el tilde de «¿En qué se gastó?» arranca apagado', () => {
    expect(createAccountDefaults('asset').purchase).toBe(false)
    expect(createAccountDefaults(null).purchase).toBe(false)
    expect(createAccountDefaults(undefined).purchase).toBe(false)
  })

  it('las reglas de siempre: un grupo no lleva tildes; una principal lleva su código', () => {
    const base = {
      isRoot: false,
      parentChoice: parentId,
      typeChoice: 'fixed' as const,
      type: null,
      shownCode: '5.2.01.01.009',
      codeTouched: true,
      code: ' 5.2.01.01.050 ',
      name: 'x',
      description: '',
      postable: false,
      requiresParty: true,
      showPurchase: false,
      purchase: true,
      contra: true,
      manual: false,
    }
    expect(createAccountInput(base)).toMatchObject({
      code: '5.2.01.01.050',
      postable: false,
      contra: false,
      requiresParty: false,
      purchaseSelectable: false,
      manualSelectable: true,
      description: null,
    })
    expect(
      createAccountInput({
        ...base,
        isRoot: true,
        parentChoice: 'raiz',
        typeChoice: 'choose',
        type: 'expense',
        shownCode: ' 6.0.00.00.000 ',
      }),
    ).toMatchObject({ parentId: null, type: 'expense', code: '6.0.00.00.000' })
    // Código tocado y vaciado: vuelve a elegirlo la base.
    expect(createAccountInput({ ...base, code: '   ' }).code).toBeNull()
  })
})

describe('«Tus categorías» ya dibujada', () => {
  function render(readOnly: boolean, balancesAvailable = true): string {
    return plain(
      renderToStaticMarkup(
        <ChartWorkspace
          tenantSlug="hub"
          accounts={standardPlan()}
          readOnly={readOnly}
          canAdmin={!readOnly}
          balancesAvailable={balancesAvailable}
          initialAccountId={null}
        >
          <NewCategoryButton />
          <CategoryList suppliersHref="/hub/administracion/compras?tab=proveedores&filtro=sin-clasificar" />
        </ChartWorkspace>,
      ),
    )
  }

  it('el dueño: el título que afirma, el buscador, los grupos y el alta', () => {
    const html = render(false)
    expect(html).toContain('Tenés 51 categorías para clasificar lo que gastás')
    expect(html).toContain('Buscar una categoría')
    expect(html).toContain('Equipos y muebles')
    expect(html).toContain('Quedan en el bar: no son gasto del mes.')
    expect(html).toContain('Nueva categoría')
    expect(html).toContain('Agregar en ')
    // Casi sin gastos cargados (como HUB): se dice qué va a aparecer, sin un solo «$ 0».
    expect(html).toContain('Todavía cargaste muy pocos gastos')
    // …y el aviso alcanza: ningún «sin uso» repetido en cada renglón.
    expect(html).not.toContain('sin uso')
    expect(html).not.toMatch(/\$ 0\b/)
    expect(html).toContain('Clasificar proveedores')
    expect(html).toContain('/hub/administracion/compras?tab=proveedores&amp;filtro=sin-clasificar')
    // Sin códigos de cuenta: eso es del plan completo.
    expect(html).not.toContain('1.0.00.00.000')
    // El número de cada grupo dice qué cuenta («· 3 categorías»): nunca va suelto al lado del
    // nombre, que es el «2 6» que el dueño rechazó.
    expect(html).toMatch(/Personal<span[^>]*>· 3 categorías<\/span>/)
    expect(html).not.toMatch(/<span class="font-mono[^"]*">\d+<\/span>/)
  })

  it('la contadora: la misma lista, sin ningún botón de alta', () => {
    const html = render(true)
    expect(html).toContain('Tenés 51 categorías para clasificar lo que gastás')
    expect(html).not.toContain('Nueva categoría')
    expect(html).not.toContain('Agregar en ')
  })

  it('sin saldos no se muestra ningún importe ni «sin uso»', () => {
    const html = render(false, false)
    expect(html).not.toContain('sin uso')
    expect(html).not.toContain('en el año')
    expect(html).not.toContain('Todavía cargaste muy pocos gastos')
  })

  it('el alta corta: nombre y «para qué se usa»; lo demás, en «Más opciones»', () => {
    const plan = standardPlan()
    const index = indexChart(plan)
    const group = categoryListGroups(plan)[0]
    if (!group?.parentId) throw new Error('el primer grupo es una cuenta del plan')
    const html = renderToStaticMarkup(
      createElement(AccountCreateForm, {
        tenantSlug: 'hub',
        index,
        initialParent: group.parentId,
        simple: true,
        onDone: () => {},
        onBusyChange: () => {},
      }),
    )
    expect(html).toContain(`Va adentro de <span class="font-medium">${group.name}</span>`)
    expect(html).toContain('Nombre')
    expect(html).toContain('Para qué se usa')
    expect(html).toContain('Más opciones')
    expect(html).toContain('(las usa la contadora)')
    expect(html).toContain('Crear categoría')
    // Lo demás sigue en el formulario (plegado), con sus valores de siempre.
    expect(html).toContain('Qué es')
    expect(html).toContain('Código')
    expect(html).toContain('Regularizadora')
    expect(html).toContain('Se usa en asientos manuales')
    // «Más opciones» arranca plegado.
    expect(html).not.toMatch(/<details[^>]*\sopen/)

    const full = renderToStaticMarkup(
      createElement(AccountCreateForm, {
        tenantSlug: 'hub',
        index,
        initialParent: group.parentId,
        onDone: () => {},
        onBusyChange: () => {},
      }),
    )
    expect(full).toContain('Adentro de')
    expect(full).toContain('Crear cuenta')
    expect(full).not.toContain('Más opciones')
  })

  it('«Nueva categoría» (el alta corta sin grupo) pide un grupo de gastos, no una principal', () => {
    const index = indexChart(standardPlan())
    const html = plain(
      renderToStaticMarkup(
        createElement(AccountCreateForm, {
          tenantSlug: 'hub',
          index,
          initialParent: undefined,
          simple: true,
          onDone: () => {},
          onBusyChange: () => {},
        }),
      ),
    )
    // Fuera de los gastos el tilde de «¿En qué se gastó?» arranca apagado y acá está plegado:
    // por eso el alta corta solo ofrece grupos de gastos (lo demás, desde «Plan completo»).
    // Y los ofrece como en la lista: los MISMOS grupos, por su nombre, para tocar. Ni el código
    // ni la ruta del plan («4.2.00.00.000 EGRESOS», «RESULTADO DEL EJERCICIO ›…»), ni un grupo
    // que no esté en «Tus categorías».
    expect(html).toContain('¿En qué grupo va?')
    expect(html).toContain('role="radiogroup"')
    const offered = [...html.matchAll(/role="radio"[^>]*>([^<]+)</g)].map((m) => m[1])
    const listed = categoryListGroups(index.ordered)
      .filter((group) => group.parentId !== null)
      .map((group) => group.name)
    expect(listed.length).toBeGreaterThan(3)
    expect(offered).toEqual(listed)
    expect(offered).toContain('Personal')
    expect(offered).toContain('Gastos del local')
    expect(offered).not.toContain('EGRESOS')
    expect(html).not.toContain('Adentro de')
    expect(html).not.toContain('Código o nombre del grupo')
    expect(html).not.toMatch(/\d\.\d\.\d\d\.\d\d\.\d{3}/)
    expect(html).not.toContain('RESULTADO DEL EJERCICIO')
    expect(html).not.toContain('Va al mismo nivel que ACTIVO o PASIVO')
    expect(html).toContain('Primero elegí el grupo donde va.')
    expect(html).toContain('Crear categoría')

    // La completa sigue ofreciendo todo el plan.
    const full = plain(
      renderToStaticMarkup(
        createElement(AccountCreateForm, {
          tenantSlug: 'hub',
          index,
          initialParent: undefined,
          onDone: () => {},
          onBusyChange: () => {},
        }),
      ),
    )
    expect(full).toContain('El grupo donde va la cuenta.')
    expect(full).not.toContain('El grupo de gastos donde va')
  })

  it('editar desde «Tus categorías»: primero el nombre y «para qué se usa»; lo demás, plegado', () => {
    const plan = standardPlan()
    const index = indexChart(plan)
    const group = categoryListGroups(plan)[0]
    const category = group?.items[0]
    const account = category ? index.byId.get(category.id) : undefined
    if (!account) throw new Error('el plan estándar tiene categorías')
    const render = (simple: boolean) =>
      plain(
        renderToStaticMarkup(
          createElement(AccountEditForm, {
            tenantSlug: 'hub',
            index,
            account,
            balancesAvailable: true,
            simple,
            onDone: () => {},
            onMove: () => {},
            onChangeActive: () => {},
            onBusyChange: () => {},
          }),
        ),
      )

    const short = render(true)
    const more = short.indexOf('Más opciones')
    expect(more).toBeGreaterThan(-1)
    // Lo que un socio sabe contestar va antes del plegable…
    expect(short.indexOf('for="ae-name"')).toBeGreaterThan(-1)
    expect(short.indexOf('for="ae-name"')).toBeLessThan(more)
    expect(short.indexOf('for="ae-description"')).toBeLessThan(more)
    // …y lo de la contadora (grupo, código, tipo y tildes), adentro, plegado.
    for (const inside of [
      'Mover',
      'for="ae-code"',
      'for="ae-type"',
      'Lleva proveedor o cliente',
      'Se usa en asientos manuales',
    ]) {
      expect(short.indexOf(inside), inside).toBeGreaterThan(more)
    }
    expect(short).toContain('(las usa la contadora)')
    expect(short).not.toMatch(/<details[^>]*\sopen/)
    expect(short).toContain('Desactivar la categoría')
    expect(short).toContain('Ver sus movimientos')
    expect(short).not.toContain('Ver mayor')

    // Desde «Plan completo» sigue la ficha entera, sin nada plegado. Los campos son los mismos:
    // lo que se manda no depende de dónde se abrió.
    const full = render(false)
    expect(full).not.toContain('Más opciones')
    expect(full.indexOf('for="ae-code"')).toBeLessThan(full.indexOf('for="ae-name"'))
    expect(full).toContain('Desactivar la cuenta')
    expect(full).toContain('Ver mayor')
    for (const id of ['ae-code', 'ae-name', 'ae-description', 'ae-manual']) {
      expect(short, id).toContain(`id="${id}"`)
      expect(full, id).toContain(`id="${id}"`)
    }
  })

  it('el tilde se llama como la pregunta del gasto, en el alta y en la edición', () => {
    const dir = 'app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_components'
    for (const file of ['account-create-form.tsx', 'account-edit-form.tsx']) {
      const source = readFileSync(join(process.cwd(), dir, file), 'utf8')
      expect(source, file).toContain('label="Aparece en «¿En qué se gastó?»"')
      expect(source, file).not.toContain('label="Aparece en «¿En qué?»"')
    }
  })
})
