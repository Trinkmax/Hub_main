// @vitest-environment node
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  accountBalanceLine,
  MovementsTable,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/account-sheet'
import { AccountsTable } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/accounts-table'
import { FlowBlocks } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/flow-blocks'
import {
  MONEY_IN,
  MONEY_OUT,
  MoneyButtons,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/money-buttons'
import { ProjectionBlock } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/projection-block'
import {
  activityFromMovement,
  groupByDay,
  movementFromTreasuryRow,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/activity'
import {
  type CajaAccountMeta,
  cajaHero,
  cajaView,
  treasuryCountStatus,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/wallet-view'
import {
  CajaActivity,
  CajaActivityEmpty,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/[id]/_components/caja-activity'
import { CajaHero } from '@/app/(manager)/[tenantSlug]/administracion/cajas/[id]/_components/caja-hero'
import { PendingBlock } from '@/app/(manager)/[tenantSlug]/administracion/cajas/[id]/_components/pending-block'
import type { CashFlowRow, TreasuryBalanceRow } from '@/lib/accounting/queries/treasury'

/**
 * Caja ya dibujada: lo que la pantalla le promete a cada uno. Las cuentas y las
 * frases tienen sus tests en `administracion-cajas-vista`; acá se cuida lo que
 * solo se ve armado: que el bar recién arrancado no vea ningún «$ 0», que la
 * contadora no reciba ningún botón de carga, y que con plata haya una fila por
 * cuenta y el total con su doble raya.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
// Las acciones del servidor no se llaman al pintar: se reemplazan para no cargar el servidor.
vi.mock('@/lib/accounting/actions/master', () => ({ saveTreasuryAccount: vi.fn() }))
vi.mock('@/lib/accounting/actions/taxes', () => ({ setTreasuryBankTax: vi.fn() }))
vi.mock('@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/account-movements-action', () => ({
  fetchAccountMovements: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/cajas',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
// El contexto lo monta el layout de la sección junto con las hojas (que acá no hacen falta).
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => ({
    tenantSlug: 'hub',
    today: '2026-10-13',
    access: { read: true, write: !ui.readOnly, admin: !ui.readOnly },
    readOnly: ui.readOnly,
    openAction: () => {},
    closeAction: () => {},
  }),
  useAccountingOptional: () => ({ readOnly: ui.readOnly }),
}))

afterEach(() => {
  ui.readOnly = false
})

const TODAY = '2026-10-13'
const BASE = '/hub/administracion'
const NB = String.fromCharCode(160)
const STAMP = '2026-10-12T15:00:00.000+00:00'

/** El HTML con los importes legibles (sin el espacio duro) y sin los comentarios de React. */
function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(NB, ' ').replaceAll('<!-- -->', '')
}

/** Lo que una persona puede apretar para CARGAR algo: los rótulos de carga de toda el área. */
const WRITE_LABELS = [
  'Cargar lo que había',
  'Cargar lo que había',
  'Contar la caja',
  '>Contar<',
  'Ya me entró<',
  'Pagar el resumen',
  'Mover plata',
  'Transferir a otra cuenta',
  'Otra entrada o salida',
  'Un socio puso o sacó plata',
  'Gastos del banco',
  'Entró plata',
  'Salió plata',
  'Agregar una caja o cuenta',
  'Agregar cuenta',
  'Agregala',
  'Subí el reporte',
  'Subí los movimientos',
  'Subir el reporte',
  'Subir los movimientos',
  'subí el reporte',
  'Completarlos',
  'Cargar el cierre',
]

function expectNoWriteControls(markup: string) {
  for (const label of WRITE_LABELS) expect(markup, label).not.toContain(label)
  // Ningún botón que abra una hoja ni un link a una pantalla de carga.
  expect(markup).not.toMatch(/href="[^"]*\/(configurar|importar|gasto-bancario|ajustes)/)
}

function row(over: Partial<TreasuryBalanceRow>): TreasuryBalanceRow {
  return {
    treasuryId: 'caja',
    accountId: null,
    name: 'Caja',
    kind: 'cash',
    accountCode: '1.1.01.01.001',
    alias: null,
    bankName: null,
    allowNegative: false,
    active: true,
    balanceCents: 0,
    pendingWalletCents: 0,
    lastMovementDate: null,
    lastCheckedOn: null,
    ...over,
  }
}

const HUB = [
  row({ treasuryId: 'efectivo', name: 'Caja Efectivo', kind: 'cash' }),
  row({ treasuryId: 'mp', name: 'Mercado Pago', kind: 'wallet', alias: 'hubsas' }),
]

const DEMO = [
  row({ treasuryId: 'caja', balanceCents: 39_475_700, lastMovementDate: '2026-10-12' }),
  row({
    treasuryId: 'mp',
    name: 'Mercado Pago',
    kind: 'wallet',
    balanceCents: 47_141_000,
    pendingWalletCents: 140_000_000,
    lastMovementDate: '2026-10-08',
    lastCheckedOn: '2026-10-07',
  }),
  row({
    treasuryId: 'banco',
    name: 'Banco Nación',
    kind: 'bank',
    bankName: 'Banco de la Nación Argentina',
    balanceCents: 4_186_342_800,
    lastMovementDate: '2026-10-13',
  }),
]

const PENDING = { openingStatus: 'pending', booksStartDate: '2026-10-12' } as const
const POSTED = { openingStatus: 'posted', booksStartDate: '2026-09-01' } as const

function table(
  rows: TreasuryBalanceRow[],
  settings: Parameters<typeof cajaView>[2],
  canWrite: boolean,
  meta?: ReadonlyMap<string, CajaAccountMeta>,
) {
  const catalog =
    meta ??
    new Map(rows.map((r) => [r.treasuryId, { updatedAt: STAMP, chargesBankTax: null }] as const))
  return html(
    <AccountsTable
      tenantSlug="hub"
      base={BASE}
      view={cajaView(rows, catalog, settings, { today: TODAY, canWrite, base: BASE })}
      exportHref="/api/administracion/export?libro=cajas-y-bancos"
      exportFileName="cajas.csv"
    />,
  )
}

describe('Caja en un bar recién arrancado (HUB)', () => {
  it('no muestra ningún «$ 0»: las cuentas esperan su monto y el total no afirma nada', () => {
    const markup = table(HUB, PENDING, true)
    expect(markup).toContain('Todavía no sé cuánta plata hay')
    expect(markup).not.toMatch(/\$\s?0/)
    expect(markup.match(/¿cuánto hay\?/g)).toHaveLength(2)
    expect(markup).toContain('Caja Efectivo')
    expect(markup).toContain('Mercado Pago')
    expect(markup).toContain('adm-double-rule')
    expect(markup).toContain('Sin dato')
  })

  it('el botón es «Cargar lo que había», y ninguna fila ofrece contar', () => {
    const markup = table(HUB, PENDING, true)
    expect(markup.match(/Cargar lo que había/g)).toHaveLength(1)
    expect(markup).toContain(`href="${BASE}/configurar"`)
    expect(markup).not.toContain('>Contar<')
    // El resto de lo que se hace con una cuenta sigue estando.
    expect(markup).toContain('aria-label="Más opciones de Caja Efectivo"')
    expect(markup).toContain('Agregar cuenta')
  })

  it('la contadora ve lo mismo sin ningún botón ni link de carga', () => {
    ui.readOnly = true
    const markup = table(HUB, PENDING, false)
    expect(markup).toContain('Todavía no sé cuánta plata hay')
    expect(markup).toContain('Los dueños todavía no cargaron cuánto había en cada caja al empezar.')
    expect(markup.match(/¿cuánto hay\?/g)).toHaveLength(2)
    expect(markup).not.toMatch(/\$\s?0/)
    expectNoWriteControls(markup)
  })

  it('sin ninguna cuenta, el renglón para agregar la primera ya está abierto', () => {
    const markup = table([], PENDING, true)
    expect(markup).toContain('Todavía no hay cajas cargadas')
    expect(markup).toContain('aria-label="Nombre de la cuenta"')
    expect(markup).toContain('aria-label="Tipo de cuenta"')
    expect(markup).toContain('>Crear<')
    expect(markup).toContain('Cancelar')
    // Sin cuentas no hay total que dibujar.
    expect(markup).not.toContain('adm-double-rule')
    // La contadora no lo recibe.
    ui.readOnly = true
    const reader = table([], PENDING, false)
    expect(reader).toContain('Todavía no hay cajas cargadas')
    expect(reader).not.toContain('Crear')
    expect(reader).not.toContain('<table')
  })
})

describe('Caja en un bar con plata', () => {
  it('una sola tabla: Cuenta, Tipo, Último movimiento, Saldo, y el total con doble raya', () => {
    const markup = table(DEMO, POSTED, true)
    for (const head of ['Cuenta', 'Tipo', 'Último movimiento', 'Saldo']) {
      expect(markup).toContain(`>${head}<`)
    }
    expect(markup).toContain('aria-label="Cuánto hay en cada cuenta"')
    expect(markup).toContain('$ 394.757')
    expect(markup).toContain('$ 41.863.428')
    expect(markup).toContain('+ $ 1.400.000 en camino')
    expect(markup).toContain('Efectivo')
    expect(markup).toContain('Billetera')
    expect(markup).toMatch(/adm-double-rule.*\$ 42\.729\.595/s)
    expect(markup).toContain('data-slot="money-ticker"')
  })

  it('ya no están el héroe, las tarjetas, los dibujos ni las cuatro acciones', () => {
    const markup = table(DEMO, POSTED, true)
    expect(markup).not.toContain('adm-hero')
    expect(markup).not.toContain('Plata disponible hoy')
    expect(markup).not.toContain('Cómo se movió la plata')
    expect(markup).not.toContain('Últimos movimientos')
    expect(markup).not.toContain('Mover plata')
    expect(markup).not.toContain('Un socio puso o sacó plata')
  })

  it('al pasar por la fila, [Contar] y [⋯]; la que le toca deja su botón a la vista', () => {
    const counted = table(
      DEMO.map((r) => ({ ...r, lastCheckedOn: '2026-10-12', pendingWalletCents: 0 })),
      POSTED,
      true,
    )
    const hoverOnly = 'group-hover/row:opacity-100'
    const contar = counted.match(/<button[^>]*aria-label="Contar Caja"[^>]*>/)?.[0] ?? ''
    expect(contar).toContain(hoverOnly)
    const menu = counted.match(/<button[^>]*aria-label="Más opciones de Caja"[^>]*>/)?.[0] ?? ''
    expect(menu).toContain(hoverOnly)

    const due = table(DEMO, POSTED, true)
    const nunca = due.match(/<button[^>]*aria-label="Contar Caja"[^>]*>/)?.[0] ?? ''
    expect(nunca).not.toContain(hoverOnly)
    // Dice por qué, para quien pasa el mouse.
    expect(nunca).toContain('title="Todavía no la contaste"')
    const entro = due.match(/<button[^>]*aria-label="Ya me entró lo de Mercado Pago"[^>]*>/)?.[0]
    expect(entro).toBeDefined()
  })

  it('el nombre es un botón: con el teclado también se abren los movimientos', () => {
    const markup = table(DEMO, POSTED, true)
    expect(markup).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>Banco Nación<\/button>/)
  })

  it('al pie: el detalle, los datos de las cuentas, exportar y «Agregar cuenta» en el lugar', () => {
    const markup = table(DEMO, POSTED, true)
    expect(markup).toContain(`href="${BASE}/cajas?tab=flujo"`)
    expect(markup).toContain('Ver el detalle')
    expect(markup).toContain(`href="${BASE}/ajustes?tab=cajas"`)
    expect(markup).toContain('Exportar')
    expect(markup).toContain('Agregar cuenta')
    // Cerrado hasta que se pide.
    expect(markup).not.toContain('aria-label="Nombre de la cuenta"')
  })

  it('la contadora no ve NINGÚN botón de carga; las filas siguen abriendo los movimientos', () => {
    ui.readOnly = true
    const markup = table(DEMO, POSTED, false)
    expect(markup).toContain('$ 394.757')
    expect(markup).toMatch(/adm-double-rule.*\$ 42\.729\.595/s)
    expectNoWriteControls(markup)
    expect(markup).not.toContain('Más opciones')
    expect(markup).not.toContain('Agregar cuenta')
    // Lo único para apretar: el nombre de cada cuenta (uno por fila) y exportar.
    const buttons = [...markup.matchAll(/<button[^>]*>.*?<\/button>/gs)].map((m) => m[0])
    expect(buttons).toHaveLength(DEMO.length + 1)
    expect(buttons.filter((b) => b.includes('aria-haspopup="dialog"'))).toHaveLength(DEMO.length)
    expect(markup).toContain('Ver el detalle')
  })

  it('lo que no suma va aparte: la tarjeta de la empresa con «Pagar el resumen», y una desactivada', () => {
    const markup = table(
      [
        ...DEMO,
        row({ treasuryId: 'visa', name: 'Visa', kind: 'credit_card', balanceCents: -8_000_000 }),
        row({ treasuryId: 'vieja', name: 'Caja vieja', active: false, balanceCents: 5_000_000 }),
      ],
      POSTED,
      true,
    )
    expect(markup).toContain('Aparte: no suman')
    expect(markup).toContain('Debés')
    expect(markup).toContain('$ 80.000')
    expect(markup).toContain('aria-label="Pagar el resumen de Visa"')
    expect(markup).toContain('Efectivo · desactivada')
    expect(markup).not.toContain('aria-label="Contar Caja vieja"')
    // El total no los cuenta y queda arriba de ellos.
    expect(markup.indexOf('$ 42.729.595')).toBeLessThan(markup.indexOf('Aparte: no suman'))
  })

  it('un descubierto se dice con palabras, en la fila y en el total', () => {
    const markup = table(
      [
        row({
          treasuryId: 'banco',
          name: 'Banco',
          kind: 'bank',
          balanceCents: -1_200_000,
          lastMovementDate: TODAY,
        }),
      ],
      POSTED,
      true,
    )
    expect(markup.match(/Descubierto/g)).toHaveLength(2)
    expect(markup).not.toMatch(/[−-]\s?\$/)
  })

  it('con movimientos pero sin saldo inicial, lo avisa arriba (la contadora, sin el botón)', () => {
    const rows = HUB.map((r, i) =>
      i === 0 ? { ...r, balanceCents: 500_000, lastMovementDate: TODAY } : r,
    )
    const markup = table(rows, PENDING, true)
    expect(markup).toContain('Falta decir con cuánto arrancaste')
    expect(markup).toContain('Los números cuentan solo lo cargado desde el 12/10.')
    expect(markup).toContain('Cargar lo que había')
    ui.readOnly = true
    const reader = table(rows, PENDING, false)
    expect(reader).toContain('Falta decir con cuánto arrancaste')
    expectNoWriteControls(reader)
  })

  it('si el catálogo no cargó, la tabla sale igual: sin lo que necesita ese dato', () => {
    const markup = table(DEMO, POSTED, true, new Map())
    expect(markup).toContain('$ 394.757')
    expect(markup).toContain('aria-label="Más opciones de Caja"')
  })
})

describe('«Entró plata» y «Salió plata»', () => {
  it('dos botones arriba, y cada uno abre un menú chico', () => {
    const markup = html(<MoneyButtons base={BASE} />)
    expect(markup).toContain('Entró plata')
    expect(markup).toContain('Salió plata')
    expect(markup).toContain('aria-haspopup="menu"')
  })

  it('lo que entra: un cobro, o algo que se anota aparte', () => {
    expect(MONEY_IN.map((i) => [i.label, 'action' in i ? i.action : i.path])).toEqual([
      ['Cobro', 'cobrar'],
      ['Socio puso plata', 'movimiento'],
      ['Otro', 'movimiento'],
    ])
  })

  it('lo que sale: un pago, un socio, los gastos del banco u otra cosa', () => {
    expect(MONEY_OUT.map((i) => [i.label, 'action' in i ? i.action : i.path])).toEqual([
      ['Pago', 'pagar'],
      ['Socio sacó plata', 'movimiento'],
      ['Gasto del banco', '/cajas/gasto-bancario'],
      ['Otro', 'movimiento'],
    ])
  })

  it('la contadora no los ve', () => {
    ui.readOnly = true
    expect(html(<MoneyButtons base={BASE} />)).toBe('')
  })
})

describe('el panel lateral de una cuenta', () => {
  const account = (rows: TreasuryBalanceRow[]) => {
    const found = cajaView(rows, new Map(), POSTED, { today: TODAY, base: BASE })
    const first = found.accounts[0] ?? found.apart[0]
    if (!first) throw new Error('sin cuenta')
    return first
  }

  it('dice lo que hay como la fila: sin un menos, y sin afirmar un cero que no es dato', () => {
    expect(accountBalanceLine(account([DEMO[0] as TreasuryBalanceRow]))).toBe(`Saldo $${NB}394.757`)
    expect(
      accountBalanceLine(
        account([row({ kind: 'bank', balanceCents: -1_200_000, lastMovementDate: TODAY })]),
      ),
    ).toBe(`Descubierto $${NB}12.000`)
    expect(
      accountBalanceLine(account([row({ kind: 'credit_card', balanceCents: -8_000_000 })])),
    ).toBe(`Debés $${NB}80.000`)
    expect(accountBalanceLine(account([row({ kind: 'credit_card', balanceCents: 0 })]))).toBe(
      'Sin deuda',
    )
    const pending = cajaView(HUB, new Map(), PENDING, { today: TODAY, base: BASE }).accounts[0]
    if (!pending) throw new Error('sin cuenta')
    expect(accountBalanceLine(pending)).toBe('Todavía no se cargó cuánto hay')
  })

  it('Fecha, Concepto, Entró y Salió; cada renglón lleva a su comprobante', () => {
    const markup = html(
      <MovementsTable
        base={BASE}
        card={false}
        movements={[
          {
            key: 'a',
            date: '2026-10-13',
            title: 'Cervecería Sierras',
            sub: 'Pago',
            inCents: 0,
            outCents: 30_000_000,
            path: '/comprobantes/doc-1',
          },
          {
            key: 'b',
            date: '2026-10-12',
            title: 'Lo que había al arrancar',
            sub: 'Saldos iniciales',
            inCents: 81_200_000,
            outCents: 0,
            path: null,
          },
        ]}
      />,
    )
    for (const head of ['Fecha', 'Concepto', 'Entró', 'Salió']) {
      expect(markup).toContain(`>${head}<`)
    }
    expect(markup).toContain('13/10')
    expect(markup).toContain('$ 300.000')
    expect(markup).toContain('$ 812.000')
    expect(markup).toContain(`href="${BASE}/comprobantes/doc-1"`)
    expect(markup).toContain('Pago')
  })

  it('en la tarjeta de la empresa lo que entra son pagos y lo que sale, consumos', () => {
    const markup = html(<MovementsTable base={BASE} card movements={[]} />)
    expect(markup).toContain('>Pagos<')
    expect(markup).toContain('>Consumos<')
    expect(markup).not.toContain('>Entró<')
  })
})

describe('la ficha de una caja', () => {
  const period = { kind: 'month', month: '2026-10', from: '2026-10-01', to: '2026-10-31' } as const
  const hero = (over: Partial<Parameters<typeof CajaHero>[0]> = {}) =>
    html(
      <CajaHero
        treasuryId="caja"
        name="Caja"
        kind="cash"
        tone={{ kind: 'cash', step: 1 }}
        active
        hero={cajaHero({
          kind: 'cash',
          period,
          openingCents: 27_475_700,
          inCents: 972_654_700,
          outCents: 165_791_800,
          closingCents: 834_338_600,
          closingDay: TODAY,
          today: TODAY,
        })}
        count={treasuryCountStatus(
          { kind: 'cash', active: true, lastCheckedOn: '2026-10-10', hasMovements: true },
          { today: TODAY, since: '2026-09-01' },
        )}
        pendingCents={0}
        base={BASE}
        canWrite
        {...over}
      />,
    )

  it('sin saldos iniciales y sin movimientos: no dice «$ 0» y el botón es cargar lo que hay', () => {
    const markup = hero({ opening: { href: `${BASE}/configurar` } })
    expect(markup).toContain('Todavía no sé cuánto hay')
    expect(markup).toContain(`href="${BASE}/configurar"`)
    expect(markup).toContain('Cargar lo que había')
    // Contarla antes anotaría toda la plata como sobrante: ese botón no está.
    expect(markup).not.toContain('Contar la caja')
    expect(markup).not.toMatch(/\$\s?0</)
    ui.readOnly = true
    const reader = hero({ opening: { href: `${BASE}/configurar` }, canWrite: false })
    expect(reader).toContain('Todavía no sé cuánto hay')
    expectNoWriteControls(reader)
  })

  it('el número con su oración y su cuenta, y EL botón para contarla', () => {
    const markup = hero()
    expect(markup).toContain('Hay hoy')
    expect(markup).toContain('En octubre entraron $ 9.726.547 y salieron $ 1.657.918.')
    expect(markup).toContain('¿Cómo se calcula?')
    expect(markup).toContain('Había al empezar octubre')
    expect(markup).toContain('¿Coincide con lo que hay de verdad?')
    expect(markup).toContain('Contada hace 3 días')
    expect(markup).toContain('aria-label="Contar Caja"')
    // Dice qué mueve a esta caja.
    expect(markup).toContain('Sube sola con el cierre del día')
    // En efectivo no hay gastos del banco ni archivos que subir.
    expect(markup).toContain('Transferir a otra cuenta')
    expect(markup).toContain('Otra entrada o salida')
    expect(markup).not.toContain('Gastos del banco')
    expect(markup).not.toContain('importar')
  })

  it('una billetera con plata en camino: el botón pasa a ser «Ya me entró»', () => {
    const markup = hero({ kind: 'wallet', name: 'Mercado Pago', pendingCents: 140_000_000 })
    expect(markup).toContain('¿Ya te entró lo que estaba en camino?')
    expect(markup).toContain('$ 1.400.000 en camino')
    expect(markup).toContain('aria-label="Ya me entró lo de Mercado Pago"')
    expect(markup).toContain(`href="${BASE}/cajas/gasto-bancario?caja=caja"`)
    expect(markup).toContain(`href="${BASE}/importar/mercado-pago"`)
  })

  it('la tarjeta de la empresa no ofrece «otra entrada o salida»', () => {
    const markup = hero({ kind: 'credit_card', name: 'Visa' })
    expect(markup).toContain('Pagar el resumen')
    expect(markup).not.toContain('Otra entrada o salida')
  })

  it('la contadora ve el número, la cuenta y el estado del conteo; ningún botón', () => {
    ui.readOnly = true
    const markup = hero({ canWrite: false, kind: 'wallet', pendingCents: 140_000_000 })
    expect(markup).toContain('Hay hoy')
    expect(markup).toContain('¿Cómo se calcula?')
    expect(markup).toContain('$ 1.400.000 en camino')
    expect(markup).toContain('El conteo de esta caja')
    expectNoWriteControls(markup)
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('<a ')
  })

  it('una caja desactivada no se cuenta ni se mueve', () => {
    const markup = hero({ active: false, count: null })
    expect(markup).toContain('Está desactivada')
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('Transferir a otra cuenta')
  })

  it('si no se pudieron leer los movimientos, queda lo que hay hoy (nunca un «$ 0» inventado)', () => {
    const markup = hero({ hero: null, fallback: { label: 'Hay hoy', cents: 39_475_700 } })
    expect(markup).toContain('394.757')
    expect(markup).not.toContain('¿Cómo se calcula?')
    const nothing = hero({ hero: null, fallback: null })
    expect(nothing).toContain('Sin dato')
    expect(nothing).not.toMatch(/\$\s?0</)
  })

  it('los movimientos, día por día y en palabras', () => {
    const rows = [
      {
        rowKind: 'line' as const,
        entryId: 'e1',
        entryDate: '2026-10-12',
        documentId: 'd1',
        documentKind: 'sales_close',
        documentLabel: 'Cierre del día',
        description: 'Cierre del día lunes 12/10/2026',
        memo: 'Efectivo',
        inCents: 12_001_300,
        outCents: 0,
        balanceCents: 40_675_700,
      },
      {
        rowKind: 'line' as const,
        entryId: 'e2',
        entryDate: TODAY,
        documentId: 'd2',
        documentKind: 'expense',
        documentLabel: 'Gasto',
        description: 'Gasto · Hielo',
        memo: null,
        inCents: 0,
        outCents: 1_200_000,
        balanceCents: 39_475_700,
      },
    ]
    const days = groupByDay(
      rows
        .map((r, i) => movementFromTreasuryRow(r, i, { id: 'caja', name: 'Caja' }))
        .filter((m) => m !== null)
        .map((m) => activityFromMovement(m, { view: 'one', kindOf: () => 'cash' })),
      { today: TODAY, newestFirst: true },
    )
    const markup = html(
      <CajaActivity
        label="Movimientos de Caja"
        days={days}
        base={BASE}
        mode="money"
        empty={null}
      />,
    )
    // Lo más nuevo, arriba.
    expect(markup.indexOf('Martes 13/10 · hoy')).toBeLessThan(markup.indexOf('Lunes 12/10 · ayer'))
    expect(markup).toContain('Hielo')
    expect(markup).toContain('Ventas del lunes 12/10')
    // En una lista angosta (el celular), el título corto: los dos están y el ancho elige.
    expect(markup).toContain('Ventas del lun 12/10')
    // La flecha dice la dirección; sin signo al lado (decían lo mismo).
    expect(markup).toContain('↓ $ 12.000')
    expect(markup).toContain('↑ $ 120.013')
    expect(markup).not.toMatch(/[↑↓] [+−]/)
    expect(markup).toContain('Al cierre del día quedó en $ 394.757')
    expect(markup).toContain(`href="${BASE}/comprobantes/d2"`)
    // El filtro, con «Todo» apretado.
    expect(markup).toMatch(/aria-pressed="true"[^>]*>(<span>)?Todo/)
    // Sin movimientos, lo que la página le pase.
    expect(
      html(
        <CajaActivity label="x" days={[]} base={BASE} mode="money" empty={<p>Nada todavía</p>} />,
      ),
    ).toBe('<p>Nada todavía</p>')
  })

  describe('sin movimientos en el período', () => {
    const empty = (over: Partial<Parameters<typeof CajaActivityEmpty>[0]> = {}) =>
      html(
        <CajaActivityEmpty
          treasury={{ id: 'caja', name: 'Caja', kind: 'cash' }}
          everMoved={false}
          lastMovementDate={null}
          period={{ kind: 'month', month: '2026-10', from: '2026-10-01', to: '2026-10-31' }}
          methods={['Efectivo']}
          openingPending={false}
          base={BASE}
          canWrite
          {...over}
        />,
      )
    const bank = { id: 'banco', name: 'Banco Nación', kind: 'bank' } as const

    it('una caja que nunca se movió enseña qué la mueve sola y el paso que sigue', () => {
      const cash = empty()
      expect(cash).toContain('Todavía no pasó nada por Caja')
      expect(cash).toContain('lo cobrado con: Efectivo')
      expect(cash).toContain(`href="${BASE}/ventas/cierre"`)
      expect(cash).toContain('Cargar el cierre')
      // Con los saldos iniciales pendientes, el paso de todas es decir cuánto hay.
      const pending = empty({ openingPending: true })
      expect(pending).toContain(`href="${BASE}/configurar"`)
      expect(pending).toContain('Cargar lo que había')
      expect(pending).not.toContain('Cargar el cierre')
      // A un banco la plata llega desde otra caja.
      const moved = empty({ treasury: bank, methods: [] })
      expect(moved).toContain('Todavía no pasó nada por Banco Nación')
      expect(moved).toMatch(/<button[^>]*>Transferir a otra cuenta<\/button>/)
    })

    it('la contadora lee lo mismo y no recibe ningún paso de carga', () => {
      ui.readOnly = true
      const cases = [{}, { openingPending: true }, { treasury: bank, methods: [] }]
      for (const over of cases) {
        const reader = empty({ ...over, canWrite: false })
        expect(reader).toContain('Todavía no pasó nada por')
        expectNoWriteControls(reader)
        expect(reader).not.toContain('/ventas/cierre')
        expect(reader).not.toContain('<button')
        expect(reader).not.toContain('<a ')
      }
    })

    it('con historia pero nada en el período, lleva al último mes con movimientos (también a la contadora)', () => {
      ui.readOnly = true
      const markup = empty({ everMoved: true, lastMovementDate: '2026-09-28', canWrite: false })
      expect(markup).toContain('En octubre no hubo movimientos')
      expect(markup).toContain(`href="${BASE}/cajas/caja?mes=2026-09"`)
      expect(markup).toContain('Ir a septiembre, el último mes con movimientos')
      expectNoWriteControls(markup)
      // Sin saber cuándo fue el último, no inventa un mes.
      expect(empty({ everMoved: true })).toContain('Probá con otro período.')
    })

    it('unos días sin movimientos adentro del último mes que sí tuvo: ofrece ver el mes entero', () => {
      const markup = empty({
        everMoved: true,
        lastMovementDate: '2026-10-06',
        period: { kind: 'range', month: null, from: '2026-10-09', to: '2026-10-11' },
      })
      expect(markup).toContain('Del 09/10 al 11/10 no hubo movimientos')
      expect(markup).toContain(`href="${BASE}/cajas/caja?mes=2026-10"`)
      expect(markup).toContain('Ver todo octubre')
      // No manda «a octubre» a quien ya está mirando octubre.
      expect(markup).not.toContain('el último mes con movimientos')
      // Un rango que cruza a otro mes sí lleva al último con movimientos.
      expect(
        empty({
          everMoved: true,
          lastMovementDate: '2026-09-28',
          period: { kind: 'range', month: null, from: '2026-10-09', to: '2026-10-11' },
        }),
      ).toContain('Ir a septiembre, el último mes con movimientos')
    })
  })

  it('lo que está en camino: cuánto, desde cuándo y cómo se confirma', async () => {
    const check = Promise.resolve({
      ok: true as const,
      data: {
        bookCents: 47_141_000,
        lastAdjustmentDate: null,
        lastCheckedOn: null,
        openWalletItems: [
          {
            lineId: 'l1',
            method: 'QR Mercado Pago',
            accountingDate: '2026-10-05',
            openCents: 62_000_000,
          },
          {
            lineId: 'l2',
            method: 'Transferencia',
            accountingDate: '2026-10-06',
            openCents: 78_000_000,
          },
        ],
        estimates: {
          commissionCents: 3_100_000,
          commissionVatCents: 651_000,
          sircupaCents: 549_000,
        },
      },
    })
    const props = {
      check,
      name: 'Mercado Pago',
      balanceCents: 47_141_000,
      pendingCents: 140_000_000,
      swatch: 'bg-(--adm-k-wallet-1)',
      base: BASE,
    }
    const markup = html(await PendingBlock({ ...props, canWrite: true }))
    expect(markup).toContain('Hay $ 1.400.000 en camino')
    expect(markup).toContain('desde el 05/10')
    expect(markup).toContain('se va a quedar con unos $ 43.000 (estimado con tus tasas)')
    expect(markup).toContain('QR Mercado Pago')
    expect(markup).toContain(`href="${BASE}/importar/mercado-pago"`)
    // No trae un segundo botón: el de la pantalla es «Ya me entró», en la tarjeta.
    expect(markup).not.toContain('<button')
    ui.readOnly = true
    const reader = html(await PendingBlock({ ...props, canWrite: false }))
    expect(reader).toContain('Hay $ 1.400.000 en camino')
    expectNoWriteControls(reader)
  })
})

function flow(month: string, category: string, inflow: number, outflow: number): CashFlowRow {
  return {
    month,
    category,
    categoryLabel: category,
    inflowCents: inflow,
    outflowCents: outflow,
    netCents: inflow - outflow,
  }
}

describe('«Entró y salió»', () => {
  const rows = [
    flow('2026-09-01', 'sales', 2_000_000_000, 0),
    flow('2026-09-01', 'suppliers', 0, 79_000_000),
    flow('2026-10-01', 'sales', 994_680_000, 0),
    flow('2026-10-01', 'bank', 0, 21_000_000),
  ]
  const blocks = (over: Partial<Parameters<typeof FlowBlocks>[0]> = {}) =>
    html(
      <FlowBlocks
        rows={rows}
        label="Agosto – octubre 2026"
        tableFirst={false}
        everMoved
        {...over}
      />,
    )

  it('afirma si entró más de lo que salió y a dónde se fue', () => {
    const markup = blocks()
    expect(markup).toContain('Entró más plata de la que salió')
    expect(markup).toContain('De septiembre a octubre entró $ 29.946.800 y salió $ 1.000.000')
    expect(markup).toContain('De cada $ 100 que salieron, $ 79 fueron a proveedores')
    // Una sola fuente de plata: se dice en una oración, sin segundo dibujo.
    expect(markup).toContain('Todo lo que entró fue por ventas cobradas.')
    expect(markup).toContain('Transferir entre cuentas no cuenta.')
    expect(markup).toContain('Ver como tabla')
  })

  it('la contadora arranca en la tabla', () => {
    expect(blocks()).toMatch(/Ver como tabla<\/button>/)
    expect(blocks({ tableFirst: true })).toMatch(/Ver como gráfico<\/button>/)
  })

  it('sin nada cargado nunca, enseña qué va a aparecer (sin ceros)', () => {
    const markup = blocks({ rows: [], everMoved: false })
    expect(markup).toContain('Todavía no entró ni salió plata de las cajas')
    expect(markup).toContain('Cuando cargues cierres, gastos y pagos')
    expect(markup).not.toMatch(/\$\s?0/)
    // Con historia, el vacío es de este período.
    expect(blocks({ rows: [] })).toContain('No entró ni salió plata en este período')
  })
})

describe('«Las próximas 4 semanas»', () => {
  const weeks = [
    {
      weekStart: '2026-10-13',
      inCents: 20_000_000,
      outCents: 10_000_000,
      projectedBalanceCents: 60_000_000,
    },
    {
      weekStart: '2026-10-19',
      inCents: 0,
      outCents: 91_000_000,
      projectedBalanceCents: -31_000_000,
    },
    { weekStart: '2026-10-26', inCents: 0, outCents: 0, projectedBalanceCents: -31_000_000 },
    { weekStart: '2026-11-02', inCents: 0, outCents: 0, projectedBalanceCents: -31_000_000 },
  ]
  const block = (over: Partial<Parameters<typeof ProjectionBlock>[0]> = {}) =>
    html(
      <ProjectionBlock
        projection={{ ok: true, data: weeks }}
        availableCents={50_000_000}
        known
        today={TODAY}
        base={BASE}
        canWrite
        {...over}
      />,
    )

  it('dice la verdad: sin contar lo que se va a vender, en ámbar y rotulado «estimado»', () => {
    const markup = block()
    expect(markup).toContain('Sin contar lo que vendas, la semana del 19/10 faltarían $ 310.000')
    expect(markup).toContain('No cuenta lo que vas a vender.')
    // Lo dice la oración, no una píldora que le saque lugar al título en el celular.
    expect(markup).toContain('Estimado. Cuenta la plata que hay hoy')
    // El nombre corto deja «queda $ X» siempre a la derecha; hasta cuándo va, en gris debajo.
    expect(markup).toContain('>Esta semana<')
    expect(markup).toContain('hasta el dom 18/10')
    // El lado que es cero no se nombra.
    expect(markup).not.toMatch(/entra \$\s?0</)
    expect(markup).toContain('faltarían $ 310.000')
    expect(markup).toContain('queda </span><span class="font-medium">$ 600.000')
    // Ámbar, no rojo: es una estimación.
    expect(markup).toContain('data-tone="warn"')
    expect(markup).not.toContain('data-tone="late"')
    expect(markup).toContain(`href="${BASE}/gastos-fijos/completar"`)
  })

  it('sin saber cuánta plata hay, no dibuja ningún saldo estimado', () => {
    const markup = block({ known: false })
    expect(markup).toContain('Las próximas 4 semanas')
    expect(markup).toContain('Para estimar si te alcanza, primero decime cuánta plata hay.')
    expect(markup).toContain(`href="${BASE}/configurar"`)
    expect(markup).not.toContain('faltarían')
    expect(markup).not.toContain('600.000')
    // Lo que hay que pagar sí se sabe: se dice (HUB arrancó con dos compras vencidas).
    expect(markup).toContain('Lo que ya se sabe:')
    expect(markup).toContain('$ 1.010.000')
    expect(markup).toContain('Los gastos fijos sin monto no entran en esta cuenta.')
  })

  it('sin saber cuánta plata hay y sin nada que pagar, no inventa «$ 0 para pagar»', () => {
    const markup = block({
      known: false,
      projection: { ok: true, data: weeks.map((w) => ({ ...w, outCents: 0 })) },
    })
    expect(markup).not.toContain('Lo que ya se sabe')
  })

  it('con todo en cero, dice que no vence nada (no cuatro filas de «$ 0»)', () => {
    const markup = block({
      projection: {
        ok: true,
        data: weeks.map((w) => ({ ...w, inCents: 0, outCents: 0, projectedBalanceCents: 0 })),
      },
    })
    expect(markup).toContain('No hay nada que venza en las próximas 4 semanas.')
    expect(markup).not.toMatch(/\$\s?0/)
  })

  it('si la lectura falla, el bloque NO desaparece', () => {
    const markup = block({
      projection: { ok: false, code: 'error', message: 'No pudimos cargar esto.' },
    })
    expect(markup).toContain('Las próximas 4 semanas')
    expect(markup).toContain('No pudimos cargar esto.')
    expect(markup).toContain('Reintentar')
  })

  it('la contadora no recibe ningún link de carga', () => {
    ui.readOnly = true
    expectNoWriteControls(block({ canWrite: false }))
    expectNoWriteControls(block({ canWrite: false, known: false }))
  })
})
