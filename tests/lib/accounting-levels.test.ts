/**
 * El nivel «solo compras y pagos» de Administración, del lado de la app (pedido de los socios del
 * 22/11/2026: «dentro de administración, los empleados solo deberían poder ver compra y pagos»).
 *
 * La base es la que manda (RLS y permisos de cada función); acá se cuida lo que decide la app: a dónde
 * entra ese nivel, qué se le ofrece, y que nunca vea un saldo de caja ni un aviso inventado con un
 * saldo que no conoce.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import {
  treasuryAfter,
  treasuryAfterShort,
  treasuryAfterWords,
} from '@/components/administracion/acciones/gasto-papel'
import {
  ACCOUNTING_ACTIONS,
  canOpenAction,
  PURCHASE_ACTIONS,
} from '@/components/administracion/acciones/types'
import { texSuggestions } from '@/components/administracion/tex/suggestions'
import { visibleCommandEntries } from '@/components/command-palette/command-entries'
import { gateAllows, type NavViewer, resolveNavGroups } from '@/components/shell/nav-config'
import { resolveSection } from '@/components/shell/section-tabs-config'
import { accountingAllows, isPurchasesOnly } from '@/lib/accounting/access'
import { purchasesOnlyContext } from '@/lib/accounting/context'
import { PURCHASES_LEVEL_DOCUMENT_KINDS } from '@/lib/accounting/queries/labels'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { QuickExpenseValues } from '@/lib/accounting/server/document-types'
import { DEFAULT_TAX_SETTINGS } from '@/lib/accounting/taxes'
import type { PostingContext } from '@/lib/accounting/types'
import { getTenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess } from '@/lib/tenant/types'
import { whoIsTalking } from '@/lib/tex/system-prompt'
import { E5, prepare } from './accounting-fixtures'

const FULL: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: true,
  write: true,
  admin: true,
  canSetUp: false,
  buyRead: true,
  buyWrite: true,
  scope: 'full',
}
/** Un dueño con el nivel «solo compras y pagos». */
const BUYER: AccountingAccess = {
  ...FULL,
  read: false,
  write: false,
  admin: false,
  scope: 'purchases',
}
const ACCOUNTANT: AccountingAccess = { ...FULL, write: false, admin: false, buyWrite: false }
const NONE: AccountingAccess = {
  ...FULL,
  read: false,
  write: false,
  admin: false,
  buyRead: false,
  buyWrite: false,
  scope: null,
}

describe('las puertas', () => {
  it('ese nivel entra a Compras y pagos, y a nada más', () => {
    expect(accountingAllows(BUYER, 'buy_read')).toBe(true)
    expect(accountingAllows(BUYER, 'buy_write')).toBe(true)
    expect(accountingAllows(BUYER, 'read')).toBe(false)
    expect(accountingAllows(BUYER, 'write')).toBe(false)
    expect(accountingAllows(BUYER, 'admin')).toBe(false)
  })

  it('quien ve todo también entra a Compras, aunque la base todavía no mande esas claves', () => {
    const old: AccountingAccess = {
      enabled: true,
      setUp: true,
      read: true,
      write: true,
      admin: false,
      canSetUp: false,
    }
    expect(accountingAllows(old, 'buy_read')).toBe(true)
    expect(accountingAllows(old, 'buy_write')).toBe(true)
    expect(isPurchasesOnly(old)).toBe(false)
  })

  it('la contadora lee Compras y no carga; sin acceso, nada', () => {
    expect(accountingAllows(ACCOUNTANT, 'buy_read')).toBe(true)
    expect(accountingAllows(ACCOUNTANT, 'buy_write')).toBe(false)
    expect(accountingAllows(NONE, 'buy_read')).toBe(false)
    expect(accountingAllows(NONE, 'buy_write')).toBe(false)
  })

  it('con el módulo apagado no hay puerta que valga', () => {
    expect(accountingAllows({ ...BUYER, enabled: false }, 'buy_read')).toBe(false)
    expect(isPurchasesOnly({ ...BUYER, enabled: false })).toBe(false)
  })

  it('«solo compras y pagos» es exactamente eso: entra a compras y no ve el resto', () => {
    expect(isPurchasesOnly(BUYER)).toBe(true)
    expect(isPurchasesOnly(FULL)).toBe(false)
    expect(isPurchasesOnly(ACCOUNTANT)).toBe(false)
    expect(isPurchasesOnly(NONE)).toBe(false)
  })
})

describe('las hojas de carga', () => {
  it('ese nivel abre «Nuevo gasto» y «Pagar»; las de cajas, ventas y socios, no', () => {
    const buyer = { write: false, buyWrite: true }
    expect(PURCHASE_ACTIONS).toEqual(['gasto', 'pagar'])
    expect(ACCOUNTING_ACTIONS.filter((action) => canOpenAction(action, buyer))).toEqual([
      'gasto',
      'pagar',
    ])
  })

  it('quien carga todo abre todas; la contadora, ninguna', () => {
    for (const action of ACCOUNTING_ACTIONS) {
      expect(canOpenAction(action, { write: true }), action).toBe(true)
      expect(canOpenAction(action, { write: false }), action).toBe(false)
      expect(canOpenAction(action, { write: false, buyWrite: false }), action).toBe(false)
    }
  })
})

describe('el menú, las pestañas y ⌘K', () => {
  const features = { ...getTenantFeatures({ feature_flags: {} }), accounting: true }
  const viewer = (accounting: AccountingAccess): NavViewer => ({
    role: 'owner',
    features,
    isPlatformAdmin: false,
    accounting,
  })

  it('la puerta `buy` abre con ese nivel; `read` sigue siendo del nivel completo', () => {
    expect(gateAllows({ accounting: 'buy' }, viewer(BUYER))).toBe(true)
    expect(gateAllows({ accounting: 'buy_or_setup' }, viewer(BUYER))).toBe(true)
    expect(gateAllows({ accounting: 'read' }, viewer(BUYER))).toBe(false)
    expect(gateAllows({ accounting: 'read_or_setup' }, viewer(BUYER))).toBe(false)
    expect(gateAllows({ accounting: 'buy' }, viewer(NONE))).toBe(false)
    // Quien todavía no configuró y puede hacerlo sigue viendo la entrada del menú.
    expect(
      gateAllows({ accounting: 'buy_or_setup' }, viewer({ ...NONE, setUp: false, canSetUp: true })),
    ).toBe(true)
    expect(gateAllows({ accounting: 'buy' }, viewer({ ...BUYER, enabled: false }))).toBe(false)
  })

  it('el menú lateral le muestra «Administración»', () => {
    const keys = (accounting: AccountingAccess) =>
      resolveNavGroups('owner', 'hub', features, false, accounting).flatMap((group) =>
        group.items.map((item) => item.key),
      )
    expect(keys(BUYER)).toContain('administracion')
    expect(keys(FULL)).toContain('administracion')
    expect(keys(NONE)).not.toContain('administracion')
  })

  it('las pestañas de la sección: a ese nivel le llega solo «Compras y pagos»', () => {
    const tabs = (accounting: AccountingAccess) =>
      resolveSection('administracion', 'hub', viewer(accounting)).tabs.map((tab) => tab.value)
    expect(tabs(BUYER)).toEqual(['compras'])
    expect(tabs(NONE)).toEqual([])
    // A quien ve todo no le cambia nada: Compras sigue en su lugar, entre las demás.
    expect(tabs(FULL)).toContain('compras')
    expect(tabs(FULL)).toContain('resumen')
    expect(tabs(FULL).length).toBeGreaterThan(4)
    expect(tabs(FULL)).toEqual(
      tabs({ enabled: true, setUp: true, read: true, write: true, admin: true, canSetUp: false }),
    )
  })

  it('⌘K: de Administración, solo lo de compras', () => {
    const ids = visibleCommandEntries({
      role: 'owner',
      features,
      isPlatformAdmin: false,
      accounting: BUYER,
    })
      .filter((entry) => entry.id.startsWith('acc-'))
      .map((entry) => entry.id)
    expect(ids.sort()).toEqual(
      ['acc-new-expense', 'acc-new-purchase', 'acc-pay', 'acc-suppliers', 'acc-vouchers'].sort(),
    )
  })

  it('⌘K: a quien carga todo no le cambia nada', () => {
    const count = (accounting: AccountingAccess) =>
      visibleCommandEntries({ role: 'owner', features, isPlatformAdmin: false, accounting }).filter(
        (entry) => entry.id.startsWith('acc-'),
      ).length
    const legacy: AccountingAccess = {
      enabled: true,
      setUp: true,
      read: true,
      write: true,
      admin: true,
      canSetUp: false,
    }
    expect(count(FULL)).toBe(count(legacy))
    expect(count(FULL)).toBeGreaterThan(20)
    expect(count(NONE)).toBe(0)
  })
})

describe('los comprobantes de ese nivel', () => {
  it('compras con sus notas, gastos y pagos: los mismos que le deja ver la base', () => {
    expect([...PURCHASES_LEVEL_DOCUMENT_KINDS].sort()).toEqual(
      ['expense', 'payment', 'purchase', 'purchase_credit_note', 'purchase_debit_note'].sort(),
    )
    for (const kind of ['sales_close', 'cash_movement', 'manual', 'opening', 'bank_expense']) {
      expect(PURCHASES_LEVEL_DOCUMENT_KINDS.has(kind), kind).toBe(false)
    }
  })
})

describe('los saldos de las cajas no se le muestran ni se usan', () => {
  const box = { kind: 'cash' as const, balanceCents: 0, allowNegative: false }

  it('sin saber el saldo no hay «antes → después» ni «no alcanza»', () => {
    const after = treasuryAfter({ ...box, balanceKnown: false }, 5_000_00)
    expect(after).toEqual({ beforeCents: 0, afterCents: null, state: 'idle' })
    expect(treasuryAfterWords('cash', after)).toBeNull()
    expect(treasuryAfterShort('cash', after)).toBeNull()
  })

  it('con el saldo conocido, lo de siempre', () => {
    expect(treasuryAfter(box, 5_000_00).state).toBe('short')
    expect(treasuryAfter({ ...box, balanceKnown: true }, 5_000_00).state).toBe('short')
    expect(treasuryAfter({ ...box, balanceCents: 9_000_00 }, 5_000_00)).toMatchObject({
      state: 'ok',
      afterCents: 4_000_00,
    })
  })
})

describe('el contexto del motor para ese nivel', () => {
  /** El contexto de la base con el impuesto al cheque automático prendido. */
  function withBankTax(ctx: PostingContext): PostingContext {
    return {
      ...ctx,
      settings: {
        ...ctx.settings,
        taxSettings: { ...DEFAULT_TAX_SETTINGS, auto: true, bankTaxBp: 60 },
      },
    }
  }

  it('las cajas quedan sin saldo y sin tope; el impuesto al cheque, apagado; lo demás, igual', () => {
    const { ctx } = prepare()
    const full = withBankTax(ctx)
    const trimmed = purchasesOnlyContext(full)
    expect(trimmed.treasuries.size).toBe(full.treasuries.size)
    for (const treasury of trimmed.treasuries.values()) {
      expect(treasury.balanceCents).toBe(0)
      expect(treasury.allowNegative).toBe(true)
    }
    expect(trimmed.settings.taxSettings?.bankTaxBp).toBe(0)
    expect(trimmed.settings.taxSettings?.auto).toBe(true)
    expect(trimmed.accounts).toBe(full.accounts)
    expect(trimmed.parties).toBe(full.parties)
    expect(trimmed.sys).toBe(full.sys)
    // No toca el original: es el de todos los demás.
    expect(full.settings.taxSettings?.bankTaxBp).toBe(60)
    expect([...full.treasuries.values()].some((t) => !t.allowNegative)).toBe(true)
  })

  it('una compra pagada con una cuenta que cobra el impuesto: sin el gasto bancario, y lo que arma es válido', () => {
    const { ctx, r } = prepare()
    const full = withBankTax(ctx)
    const values = {
      ...E5.input(r),
      clientRef: '00000000-0000-4000-8000-0000000000bb',
    } as QuickExpenseValues

    const everyone = previewDocumentForm('quick_expense', values, full)
    const buyer = previewDocumentForm('quick_expense', values, purchasesOnlyContext(full))
    if (!everyone.ok || !buyer.ok) throw new Error('la vista previa tenía que armarse')

    const kinds = (preview: typeof everyone) => preview.preview.map((entry) => entry.kind)
    expect(kinds(everyone)).toContain('bank_expense')
    expect(kinds(buyer)).not.toContain('bank_expense')
    expect(kinds(buyer).length).toBe(kinds(everyone).length - 1)
    // Otro bundle, otro hash: por eso se recorta igual al mostrar y al guardar.
    expect(buyer.hash).not.toBe(everyone.hash)
  })

  it('no le inventa «la caja quedaría en negativo» con un saldo que no conoce', () => {
    const { ctx, r } = prepare()
    // Como le llega de la base: todas las cajas en cero.
    const zeroed: PostingContext = {
      ...ctx,
      treasuries: new Map(
        [...ctx.treasuries].map(([id, treasury]) => [
          id,
          { ...treasury, balanceCents: 0, allowNegative: false },
        ]),
      ),
    }
    const values = {
      ...E5.input(r),
      clientRef: '00000000-0000-4000-8000-0000000000bb',
    } as QuickExpenseValues

    const raw = previewDocumentForm('quick_expense', values, zeroed)
    const trimmed = previewDocumentForm('quick_expense', values, purchasesOnlyContext(zeroed))
    if (!raw.ok || !trimmed.ok) throw new Error('la vista previa tenía que armarse')
    const keys = (preview: typeof raw) => preview.warnings.map((warning) => warning.key)
    expect(keys(raw)).toContain('treasury_negative')
    expect(keys(trimmed)).not.toContain('treasury_negative')
  })
})

describe('Tex con «solo compras y pagos»', () => {
  it('no le ofrece lo de Administración que Tex no le puede resolver', () => {
    // Con acceso a leer Administración, en Compras van las de Compras.
    expect(texSuggestions('/hub/administracion/compras', 'owner')).toContain('Cargá una compra')
    // Sin él (ese nivel o sin acceso), en cualquier pantalla de Administración van las de siempre…
    const chips = texSuggestions('/hub/administracion/compras', 'owner', { accounting: false })
    for (const notHis of ['Cargá una compra', 'Pagale a un proveedor', '¿Cuánta plata hay?']) {
      expect(chips, notHis).not.toContain(notHis)
    }
    expect(chips.length).toBeGreaterThan(0)
    expect(
      texSuggestions('/hub/administracion/cajas', 'owner', { accounting: false }),
    ).not.toContain('¿Cuánta plata hay?')
    // …y fuera de Administración no cambia nada (los pedidos de /compras siguen siendo suyos).
    expect(texSuggestions('/hub/compras', 'owner', { accounting: false })).toContain(
      '¿Qué pedidos hay para mandar?',
    )
    expect(texSuggestions('/hub', 'owner', { accounting: false })).not.toContain(
      '¿Cuánta plata hay?',
    )
    expect(texSuggestions('/hub', 'owner')).toContain('¿Cuánta plata hay?')
  })

  it('Tex sabe que tiene ese acceso: lo manda a la pantalla, no le dice que le falta', () => {
    const who = whoIsTalking('owner', false, false, true)
    expect(who).toContain('solo compras y pagos')
    expect(who).toContain('Compras y pagos')
    expect(who).not.toContain('decile que le falta ese acceso')
    // Sin acceso a Administración, como siempre.
    expect(whoIsTalking('owner', false, false)).toContain('le falta ese acceso')
    // Con acceso completo, el nivel no cambia nada.
    expect(whoIsTalking('owner', true, true, false)).toBe(whoIsTalking('owner', true))
  })
})
