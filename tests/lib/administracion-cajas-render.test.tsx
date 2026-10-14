// @vitest-environment node
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CajasAcciones,
  CajasArchivos,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/cajas-acciones'
import { FlowBlocks } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/flow-blocks'
import { ProjectionBlock } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/projection-block'
import { RecentActivity } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/recent-activity'
import { TreasuryBalances } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/treasury-balances'
import { Wallet } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/wallet'
import {
  WalletEmpty,
  WalletNoTreasuries,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/wallet-empty'
import {
  activityFromMovement,
  groupByDay,
  movementFromTreasuryRow,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/activity'
import {
  cajaHero,
  treasuryCountStatus,
  walletTotals,
  walletView,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/wallet-view'
import {
  CajaActivity,
  CajaActivityEmpty,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/[id]/_components/caja-activity'
import { CajaHero } from '@/app/(manager)/[tenantSlug]/administracion/cajas/[id]/_components/caja-hero'
import { PendingBlock } from '@/app/(manager)/[tenantSlug]/administracion/cajas/[id]/_components/pending-block'
import type { SubledgerPage } from '@/lib/accounting/queries/books'
import type { CashFlowRow, TreasuryBalanceRow } from '@/lib/accounting/queries/treasury'

/**
 * Cajas y bancos ya dibujado: lo que la pantalla le promete a cada uno. Las
 * cuentas y las frases tienen sus tests en `administracion-cajas-vista`; acá se
 * cuida lo que solo se ve armado: que el bar recién arrancado no vea ningún
 * «$ 0» y tenga UN solo botón, que la contadora no reciba ningún botón de
 * carga, y que con plata haya una tarjeta por caja y un solo botón relleno.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
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

/** El HTML con los importes legibles (sin el espacio duro) y sin los comentarios de React. */
function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(NB, ' ').replaceAll('<!-- -->', '')
}

/** Lo que una persona puede apretar para CARGAR algo: los rótulos de carga de toda el área. */
const WRITE_LABELS = [
  'Cargar lo que hay',
  'Cargar lo que había',
  'Contar la caja',
  '>Contar<',
  'Ya me entró<',
  'Pagar el resumen',
  'Mover plata',
  'Otra entrada o salida',
  'Un socio puso o sacó plata',
  'Gastos del banco',
  'Agregar una caja o cuenta',
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

function wallet(rows: TreasuryBalanceRow[], canWrite: boolean) {
  const view = walletView(rows, POSTED, { today: TODAY, canWrite, base: BASE })
  if (view.kind !== 'normal') throw new Error('estado inesperado')
  return html(
    <Wallet
      view={view}
      base={BASE}
      canWrite={canWrite}
      table={
        <TreasuryBalances
          items={rows.map((r) => ({
            id: r.treasuryId,
            name: r.name,
            kind: r.kind,
            balanceCents: r.balanceCents,
            pendingWalletCents: r.pendingWalletCents,
            lastCheckedOn: r.lastCheckedOn,
            lastMovementDate: r.lastMovementDate,
            active: r.active,
            detail: r.alias ?? r.bankName ?? null,
          }))}
          availableCents={walletTotals(rows).availableCents}
          today={TODAY}
          since={POSTED.booksStartDate}
          base={BASE}
          exportHref="/api/administracion/export?libro=cajas-y-bancos"
          exportFileName="cajas.csv"
        />
      }
    />,
  )
}

describe('la billetera de un bar recién arrancado (HUB)', () => {
  function empty(canWrite: boolean) {
    const view = walletView(HUB, PENDING, { today: TODAY, canWrite, base: BASE })
    if (view.kind !== 'opening_pending') throw new Error('estado inesperado')
    return html(<WalletEmpty view={view} canWrite={canWrite} />)
  }

  it('no muestra ningún «$ 0» y enseña los tres pasos', () => {
    const markup = empty(true)
    expect(markup).toContain('Todavía no sé cuánta plata hay')
    expect(markup).not.toMatch(/\$\s?0/)
    expect(markup).toContain('Decime cuánto hay hoy en cada caja')
    expect(markup).toContain('Cargá el cierre de cada día')
    expect(markup).toContain('Una vez por semana, contá')
    // Las cajas son casilleros que esperan su monto.
    expect(markup).toContain('Caja Efectivo')
    expect(markup).toContain('Billetera · alias hubsas')
    expect(markup.match(/¿cuánto hay\?/g)).toHaveLength(2)
    // Explica qué entra sola, con el nombre de SU caja.
    expect(markup).toContain('El efectivo entra solo a Caja Efectivo.')
    expect(markup).toContain('queda en camino hasta que decís «ya me entró»')
  })

  it('tiene UN solo botón: «Cargar lo que hay»', () => {
    const markup = empty(true)
    expect(markup.match(/Cargar lo que hay/g)).toHaveLength(1)
    expect(markup).toContain(`href="${BASE}/configurar"`)
    // Ningún botón de hoja: contar antes de decir cuánto hay es el consejo equivocado.
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('Contar')
    // El otro link es callado: agregar una cuenta antes de cargar.
    expect(markup).toContain(`href="${BASE}/ajustes?tab=cajas"`)
  })

  it('la contadora ve lo mismo sin ningún botón ni link de carga', () => {
    ui.readOnly = true
    const markup = empty(false)
    expect(markup).toContain('Todavía no sé cuánta plata hay')
    expect(markup).toContain('Los dueños todavía no cargaron cuánto había en cada caja al empezar.')
    expect(markup.match(/¿cuánto hay\?/g)).toHaveLength(2)
    expect(markup).not.toMatch(/\$\s?0/)
    expectNoWriteControls(markup)
    expect(markup).not.toContain('<a ')
    expect(markup).not.toContain('<button')
  })

  it('sin ninguna caja, el paso es agregar la primera (y la contadora no lo recibe)', () => {
    const view = walletView([], PENDING, { today: TODAY, canWrite: true, base: BASE })
    if (view.kind !== 'no_treasuries') throw new Error('estado inesperado')
    const markup = html(<WalletNoTreasuries view={view} />)
    expect(markup).toContain('Todavía no hay cajas cargadas')
    expect(markup).toContain(`href="${BASE}/ajustes?tab=cajas"`)
    const reader = walletView([], PENDING, { today: TODAY, canWrite: false, base: BASE })
    if (reader.kind !== 'no_treasuries') throw new Error('estado inesperado')
    expect(html(<WalletNoTreasuries view={reader} />)).not.toContain('<a ')
  })
})

describe('la billetera de un bar con plata', () => {
  it('el total, la oración y una tarjeta por caja con su link', () => {
    const markup = wallet(DEMO, true)
    expect(markup).toContain('Plata disponible hoy')
    expect(markup).toContain('Repartida en 3 lugares.')
    expect(markup).toContain('2 sin contar esta semana')
    for (const id of ['caja', 'mp', 'banco']) {
      expect(markup).toContain(`href="${BASE}/cajas/${id}"`)
    }
    expect(markup).toContain('394.757')
    expect(markup).toContain('$ 1.400.000 en camino')
    expect(markup).toContain('Contada hace 6 días')
    expect(markup).toContain('Banco · Banco de la Nación Argentina')
    expect(markup).toContain('Último movimiento: hoy')
    // El lomo de cada tarjeta lleva el color de su tipo (el del Resumen).
    for (const tone of ['cash', 'wallet', 'bank']) {
      expect(markup).toContain(`bg-(--adm-k-${tone}-1)`)
    }
  })

  it('un solo botón relleno en toda la pantalla', () => {
    const markup = wallet(DEMO, true)
    // Tres botones de tarjeta (uno por caja) y «Exportar», en la tabla plegada.
    const buttons = [...markup.matchAll(/<button[^>]*data-slot="button"[^>]*>/g)].map((m) => m[0])
    expect(buttons).toHaveLength(4)
    expect(buttons.filter((b) => /class="[^"]*\bbg-primary\b/.test(b))).toHaveLength(1)
    // El relleno es el de la primera caja a la que le toca: la Caja, que nunca se contó.
    expect(buttons[0]).toMatch(/bg-primary/)
    expect(buttons[0]).toContain('aria-label="Contar Caja"')
    expect(markup).toContain('Ya me entró')
  })

  it('la tabla queda plegada, con su «Exportar»', () => {
    const markup = wallet(DEMO, true)
    expect(markup).toContain('Ver como tabla y exportar')
    expect(markup).toMatch(/<details class="group\/table">/)
    expect(markup).toContain('Último conteo')
    expect(markup).toContain('Exportar')
    expect(markup).toContain('+ $ 1.400.000,00 en camino')
    // La tabla ya no trae botones de carga por fila.
    expect(markup).not.toMatch(/Mover<\/button>/)
  })

  it('la contadora no ve NINGÚN botón de carga y la tabla viene abierta', () => {
    ui.readOnly = true
    const markup = wallet(DEMO, false)
    expect(markup).toContain('Plata disponible hoy')
    expect(markup).toMatch(/<details open=""/)
    expectNoWriteControls(markup)
    // Lo único que queda para apretar es exportar; las tarjetas siguen llevando a su ficha.
    const buttons = [...markup.matchAll(/<button[^>]*>.*?<\/button>/gs)].map((m) => m[0])
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toContain('Exportar')
    expect(markup).toContain(`href="${BASE}/cajas/caja"`)
  })

  it('una caja desactivada con saldo va aparte, sin botón; la tarjeta de la empresa, con «Pagar el resumen»', () => {
    const markup = wallet(
      [
        ...DEMO,
        row({ treasuryId: 'visa', name: 'Visa', kind: 'credit_card', balanceCents: -8_000_000 }),
        row({ treasuryId: 'vieja', name: 'Caja vieja', active: false, balanceCents: 5_000_000 }),
      ],
      true,
    )
    expect(markup).toContain('Tarjetas de la empresa')
    expect(markup).toContain('Debés')
    expect(markup).toContain('aria-label="Pagar el resumen de Visa"')
    expect(markup).toContain('Desactivada · no suma a lo disponible')
    expect(markup).not.toContain('aria-label="Contar Caja vieja"')
  })

  it('con movimientos pero sin saldo inicial, lo avisa arriba (la contadora, sin el botón)', () => {
    const rows = HUB.map((r, i) =>
      i === 0 ? { ...r, balanceCents: 500_000, lastMovementDate: TODAY } : r,
    )
    const view = walletView(rows, PENDING, { today: TODAY, canWrite: true, base: BASE })
    if (view.kind !== 'normal') throw new Error('estado inesperado')
    const markup = html(<Wallet view={view} base={BASE} canWrite table={null} />)
    expect(markup).toContain('Falta decir con cuánto arrancaste')
    expect(markup).toContain('Los números cuentan solo lo cargado desde el 12/10.')
    expect(markup).toContain('Cargar lo que había')
    ui.readOnly = true
    const reader = walletView(rows, PENDING, { today: TODAY, canWrite: false, base: BASE })
    if (reader.kind !== 'normal') throw new Error('estado inesperado')
    const readerMarkup = html(<Wallet view={reader} base={BASE} canWrite={false} table={null} />)
    expect(readerMarkup).toContain('Falta decir con cuánto arrancaste')
    expectNoWriteControls(readerMarkup)
  })
})

describe('la fila de acciones', () => {
  const actions = (over: Partial<Parameters<typeof CajasAcciones>[0]> = {}) =>
    html(<CajasAcciones base={BASE} hasNonCash {...over} />)
  const files = (over: Partial<Parameters<typeof CajasArchivos>[0]> = {}) =>
    html(<CajasArchivos base={BASE} hasWallet hasBank {...over} />)

  it('las cuatro cosas de esta pantalla, cada una con su nombre entero para lectores', () => {
    const markup = actions()
    for (const label of [
      'Mover plata',
      'Contar la caja',
      'Un socio puso o sacó plata',
      'Gastos del banco',
    ]) {
      expect(markup).toContain(`aria-label="${label}"`)
    }
    expect(markup).toContain(`href="${BASE}/cajas/gasto-bancario"`)
  })

  it('sin bancos ni billeteras no ofrece gastos del banco ni subir archivos', () => {
    const markup = actions({ hasNonCash: false })
    expect(markup).not.toContain('Gastos del banco')
    expect(markup.match(/<button/g)).toHaveLength(3)
    expect(files({ hasWallet: false, hasBank: false })).toBe('')
  })

  it('«¿Tenés el archivo?» ofrece subir lo que el bar tiene: Mercado Pago, el banco o los dos', () => {
    const both = files()
    expect(both).toContain('¿Tenés el archivo? Se carga solo:')
    expect(both).toContain(`href="${BASE}/importar/mercado-pago"`)
    expect(both).toContain(`href="${BASE}/importar/banco"`)
    const onlyWallet = files({ hasBank: false })
    expect(onlyWallet).toContain('subí el reporte de Mercado Pago')
    expect(onlyWallet).not.toContain('importar/banco')
    const onlyBank = files({ hasWallet: false })
    expect(onlyBank).toContain('subí los movimientos del banco')
    expect(onlyBank).not.toContain('importar/mercado-pago')
    // Los links van adentro de la oración: no la parten en renglones sueltos.
    expect(both).not.toContain('inline-flex')
  })

  it('la contadora no ve nada', () => {
    ui.readOnly = true
    expect(actions()).toBe('')
    expect(files()).toBe('')
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
    expect(markup).toContain('Mover plata')
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
    expect(markup).not.toContain('Mover plata')
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
    expect(markup).toContain('↓ − $ 12.000')
    expect(markup).toContain('↑ + $ 120.013')
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
          periodLabel="Octubre 2026"
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
      expect(pending).toContain('Cargar lo que hay')
      expect(pending).not.toContain('Cargar el cierre')
      // A un banco la plata llega desde otra caja.
      const moved = empty({ treasury: bank, methods: [] })
      expect(moved).toContain('Todavía no pasó nada por Banco Nación')
      expect(moved).toMatch(/<button[^>]*>Mover plata<\/button>/)
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
      expect(markup).toContain('No hubo movimientos en octubre 2026')
      expect(markup).toContain(`href="${BASE}/cajas/caja?mes=2026-09"`)
      expect(markup).toContain('Ir a septiembre, el último mes con movimientos')
      expectNoWriteControls(markup)
      // Sin saber cuándo fue el último, no inventa un mes.
      expect(empty({ everMoved: true })).toContain('Probá con otro período.')
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

describe('«Últimos movimientos»', () => {
  const page = (rows: SubledgerPage['rows'], nextCursor: string | null = null) =>
    Promise.resolve({
      ok: true as const,
      data: {
        rows,
        nextCursor,
        totalRows: rows.length,
        kind: 'treasury' as const,
        from: '2026-09-30',
        to: TODAY,
      },
    })
  const line = (
    key: string,
    date: string,
    values: Record<string, string | number>,
  ): SubledgerPage['rows'][number] => ({
    rowKind: 'line',
    documentId: `doc-${key}`,
    entryId: `e-${key}`,
    date,
    values,
  })
  const props = {
    base: BASE,
    today: TODAY,
    swatches: { caja: 'bg-(--adm-k-cash-1)', banco: 'bg-(--adm-k-bank-1)' },
    kinds: { caja: 'cash', banco: 'bank' } as const,
    lastMovementDate: '2026-10-08',
  }

  it('si ninguna caja se movió en dos semanas, dice cuándo fue el último', async () => {
    const markup = html(await RecentActivity({ ...props, page: null }))
    expect(markup).toContain('Últimos movimientos')
    expect(markup).toContain('No hubo movimientos en los últimos 14 días. El último fue el 08/10.')
  })

  it('cuenta lo que pasó en palabras y junta las dos líneas de un pasaje', async () => {
    const transfer = {
      document_kind: 'transfer',
      description: 'Movimiento entre cuentas · Caja → Banco Nación',
    }
    const rows = [
      {
        rowKind: 'opening' as const,
        documentId: null,
        entryId: null,
        date: '2026-09-30',
        values: {},
      },
      line('1', '2026-10-12', {
        document_kind: 'expense',
        description: 'Gasto · Hielo',
        outflow_cents: 1_200_000,
        treasury_id: 'caja',
        treasury_name: 'Caja',
      }),
      {
        ...line('2', TODAY, {
          ...transfer,
          memo: 'De Caja',
          inflow_cents: 20_000_000,
          treasury_id: 'banco',
          treasury_name: 'Banco Nación',
        }),
        documentId: 'pase',
      },
      {
        ...line('3', TODAY, {
          ...transfer,
          memo: 'A Banco Nación',
          outflow_cents: 20_000_000,
          treasury_id: 'caja',
          treasury_name: 'Caja',
        }),
        documentId: 'pase',
      },
    ]
    const markup = html(await RecentActivity({ ...props, page: page(rows) }))
    // Un solo renglón para el pasaje (el nombre va también en su `title`).
    expect(markup.match(/>Caja → Banco Nación</g)).toHaveLength(1)
    expect(markup).toContain('↔ $ 200.000')
    expect(markup).toContain('Plata movida entre cajas')
    expect(markup).toContain('Hielo')
    // A la izquierda, qué pasó; de qué caja es va debajo de la plata.
    expect(markup).toMatch(/text-muted-foreground[^"]*">Gasto<\/div>/)
    expect(markup).toMatch(/text-xs tabular-nums text-muted-foreground">Caja<\/div>/)
    expect(markup).not.toContain('Gasto · ')
    expect(markup).toContain(`href="${BASE}/comprobantes/doc-1"`)
    expect(markup).toContain('bg-(--adm-k-cash-1)')
    expect(markup.indexOf('Martes 13/10 · hoy')).toBeLessThan(markup.indexOf('Lunes 12/10 · ayer'))
    expect(markup).toContain('Para ver todo lo de una caja, tocá su tarjeta.')
  })

  it('si la base cortó la lectura, no muestra una lista que no es la más nueva', async () => {
    const markup = html(
      await RecentActivity({
        ...props,
        page: page(
          [line('1', TODAY, { document_kind: 'expense', description: 'Gasto · Hielo' })],
          'cursor',
        ),
      }),
    )
    expect(markup).toContain('Hubo muchos movimientos estos días: miralos en cada caja.')
    expect(markup).not.toContain('Hielo')
  })

  it('si la lectura falla, el bloque conserva su lugar y ofrece reintentar', async () => {
    const failed = Promise.resolve({
      ok: false as const,
      code: 'error' as const,
      message: 'Sin conexión: no pudimos cargar esto. Probá de nuevo.',
    })
    const markup = html(await RecentActivity({ ...props, page: failed }))
    expect(markup).toContain('Últimos movimientos')
    expect(markup).toContain('Sin conexión: no pudimos cargar esto.')
    expect(markup).toContain('Reintentar')
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
    expect(markup).toContain('Mover plata entre cajas no cuenta.')
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
    expect(markup).toContain('Esta semana (hasta el dom 18/10)')
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
