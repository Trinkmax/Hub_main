// @vitest-environment node
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ACCESS_REQUEST_MESSAGE,
  AdministracionApagada,
  AdministracionPendiente,
  AdministracionSinAcceso,
  joinNames,
} from '@/app/(manager)/[tenantSlug]/administracion/_components/gate-screens'
import { AccessPanel } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/access-panel'
import { IntegrityPanel } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/integrity-panel'
import { MethodsPanel } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/methods-panel'
import { AccountantDrawer } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/portada/accountant-drawer'
import {
  SetupNext,
  SetupPills,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/portada/setup-next'
import { SalesPointsPanel } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/sales-points-panel'
import {
  PeriodSettingsForm,
  SasSettingsForm,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/settings-forms'
import {
  FiscalYearsList,
  PeriodSettingsView,
  periodState,
  SasSettingsView,
  yearTitle,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/settings-views'
import { TreasuriesPanel } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/treasuries-panel'
import {
  maskedTail,
  treasuryLine,
  treasuryMissing,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/treasury-card'
import type { SystemPartyRow } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/payloads'
import { initialsOf, PersonChip } from '@/components/administracion/puerta/person-chip'
import { ReadOnlyBadge, ReadOnlyNotice } from '@/components/administracion/read-only'
import type { SetupStep } from '@/lib/accounting/home'
import type { AccessOverview, AccessPersonRow } from '@/lib/accounting/queries/access'
import type { FiscalYearRow, PeriodRow } from '@/lib/accounting/queries/periods'
import type {
  AccountingSettings,
  SalesMethodRow,
  SalesPointRow,
} from '@/lib/accounting/queries/settings'
import type { TreasuryAccountRow } from '@/lib/accounting/queries/treasury'
import type { PartyRates } from '@/lib/accounting/types'

/**
 * La puerta de Administración y el modo lectura.
 *
 * - Los tres carteles de quien todavía no entra: qué pasa, a quién pedírselo (con su nombre,
 *   nunca un email) y, si hay algo para hacer, UNA acción.
 * - La contadora (solo lectura) no ve NINGÚN control de carga en Ajustes: ni «Agregar», ni
 *   lápices, ni interruptores, ni «Dar acceso», ni «Guardar cambios». Cada caso se prueba contra
 *   su versión con permiso de carga, para que el test no pase por estar vacío.
 */

// Las acciones del servidor no se llaman al pintar: se reemplazan para no cargar el servidor.
vi.mock('@/lib/accounting/actions/master', () => ({
  saveTreasuryAccount: vi.fn(),
  saveSalesMethod: vi.fn(),
  saveSalesPoint: vi.fn(),
  saveParty: vi.fn(),
  saveSettings: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/access', () => ({
  claimAccountingAdmin: vi.fn(),
  grantAccountingAccess: vi.fn(),
  revokeAccountingAccess: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/ajustes',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

/** El HTML del primer render, sin los separadores `<!-- -->` que React pone entre textos. */
const html = (node: ReactElement) => renderToString(node).replaceAll('<!-- -->', '')

/** Cuántos botones y links hay (lo que se puede tocar). */
const buttons = (out: string) => (out.match(/<button\b/g) ?? []).length
const links = (out: string) => (out.match(/<a\b/g) ?? []).length

const STAMP = '2026-10-12T15:00:00.000+00:00'

// ─── La puerta ───────────────────────────────────────────────────────────────

describe('los carteles de la puerta', () => {
  it('«Privado»: qué pasa, a quién pedírselo y el mensaje para copiar', () => {
    const out = html(
      createElement(AdministracionSinAcceso, { adminNames: ['Franco Pérez', 'Nacho'] }),
    )
    expect(out).toContain('Cartel: Privado')
    expect(out).toContain('Administración es privada')
    expect(out).toContain('La ven solo los socios habilitados y la contadora.')
    expect(out).toContain('Pedile acceso a')
    expect(out).toContain('Franco Pérez')
    expect(out).toContain('Nacho')
    // Para lectores, la frase entera.
    expect(out).toContain('aria-label="Pedile acceso a Franco Pérez y Nacho"')
    // UNA acción: copiar el mensaje.
    expect(buttons(out)).toBe(1)
    expect(out).toContain('Copiar el mensaje para pedirlo')
    expect(out).toContain(ACCESS_REQUEST_MESSAGE)
    expect(ACCESS_REQUEST_MESSAGE).toBe(
      'Hola, ¿me habilitás en Administración? Se hace en Administración › Ajustes › Accesos.',
    )
    // Un solo título de página.
    expect((out.match(/<h1\b/g) ?? []).length).toBe(1)
  })

  it('«Privado» sin nombres: igual dice a quién', () => {
    const out = html(createElement(AdministracionSinAcceso, { adminNames: [] }))
    expect(out).toContain('Pedile acceso a quien la administra.')
    expect(out).toContain('Copiar el mensaje para pedirlo')
  })

  it('«Pronto», para un dueño: quién la configura, y nada para hacer', () => {
    const out = html(createElement(AdministracionPendiente, { who: 'owner', adminNames: ['Luz'] }))
    expect(out).toContain('Cartel: Pronto')
    expect(out).toContain('Todavía no está lista')
    expect(out).toContain(
      'La está configurando otro socio. Cuando termine, te puede habilitar desde Ajustes › Accesos.',
    )
    expect(out).toContain('aria-label="La configura Luz"')
    expect(buttons(out)).toBe(0)
    expect(links(out)).toBe(0)
  })

  it('«Pronto», para la contadora: sin nombres ni acciones', () => {
    const out = html(
      createElement(AdministracionPendiente, { who: 'accountant', adminNames: ['Luz'] }),
    )
    expect(out).toContain('Todavía no está lista')
    expect(out).toContain(
      'Cuando los dueños la configuren, vas a ver acá los libros, el IVA y las cuentas corrientes.',
    )
    expect(out).not.toContain('Luz')
    expect(buttons(out)).toBe(0)
  })

  it('«Apagada», para la contadora', () => {
    const out = html(createElement(AdministracionApagada))
    expect(out).toContain('Cartel: Apagada')
    expect(out).toContain('Administración está apagada')
    expect(out).toContain(
      'Avisales a los dueños: cuando la vuelvan a prender, vas a ver acá los libros y las cuentas.',
    )
    expect(buttons(out)).toBe(0)
    expect(links(out)).toBe(0)
  })

  it('ningún cartel muestra un email, ni ofrece cargar nada', () => {
    const names = ['Franco Pérez', 'Nacho', 'Luz']
    const all = [
      html(createElement(AdministracionSinAcceso, { adminNames: names })),
      html(createElement(AdministracionPendiente, { who: 'owner', adminNames: names })),
      html(createElement(AdministracionPendiente, { who: 'accountant', adminNames: names })),
      html(createElement(AdministracionApagada)),
    ].join('\n')
    expect(all).not.toContain('@')
    expect(all).not.toMatch(/Guardar|Cargar |Agregar|Pagar|Anular|Importar/)
    expect(all).not.toMatch(/ganancia|en negro|en blanco/i)
  })

  it('juntar nombres', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['Franco'])).toBe('Franco')
    expect(joinNames(['Franco', 'Nacho'])).toBe('Franco y Nacho')
    expect(joinNames(['Franco', 'Nacho', 'Luz'])).toBe('Franco, Nacho y Luz')
  })
})

describe('una persona', () => {
  it('las iniciales salen del nombre (nunca de un símbolo)', () => {
    expect(initialsOf('Franco Pérez')).toBe('FP')
    expect(initialsOf('nacho')).toBe('N')
    expect(initialsOf('franco.perez')).toBe('FP')
    expect(initialsOf('Socios (demo)')).toBe('SD')
    expect(initialsOf('María de los Ángeles Fernández')).toBe('MD')
    expect(initialsOf('élida')).toBe('É')
    expect(initialsOf('   ')).toBe('?')
    expect(initialsOf('')).toBe('?')
  })

  it('un nombre de 60 caracteres se corta en pantalla y queda entero en el `title`', () => {
    const long = 'María de los Ángeles Fernández de la Fuente y Álvarez Soler'
    const out = html(createElement(PersonChip, { name: long, sub: 'Sin acceso', tone: 'hollow' }))
    expect(out).toContain(`title="${long}"`)
    expect(out).toContain('truncate')
    expect(out).toContain('Sin acceso')
  })
})

describe('la etiqueta y el cartel de solo lectura', () => {
  it('la etiqueta va sin margen propio (la acomoda el encabezado)', () => {
    const out = html(createElement(ReadOnlyBadge, { show: true }))
    expect(out).toContain('Solo lectura')
    expect(out).not.toContain('ml-2')
    expect(html(createElement('div', null, createElement(ReadOnlyBadge, { show: false })))).toBe(
      '<div></div>',
    )
  })

  it('el cartel respeta lo que le pasa cada pantalla', () => {
    const out = html(
      createElement(ReadOnlyNotice, {
        description: 'Con Contabilidad podés verlos en Compras › Comprobantes.',
        href: '/hub/administracion/compras?tab=comprobantes',
        linkLabel: 'Ir a Comprobantes',
      }),
    )
    expect(out).toContain('Cartel: Solo lectura')
    expect(out).toContain('Esta pantalla es para cargar')
    expect(out).toContain('Con Contabilidad podés verlos en Compras › Comprobantes.')
    expect(out).toContain('href="/hub/administracion/compras?tab=comprobantes"')
    expect(out).toContain('Ir a Comprobantes')
    // Una sola salida: a donde se mira.
    expect(links(out)).toBe(1)
    expect(buttons(out)).toBe(0)
    expect(
      html(
        createElement(ReadOnlyNotice, {
          title: 'La puesta en marcha es de los dueños',
          description: 'x',
          href: '/hub',
          linkLabel: 'Ir',
        }),
      ),
    ).toContain('La puesta en marcha es de los dueños')
  })
})

// ─── Ajustes en modo lectura ─────────────────────────────────────────────────

const person = (over: Partial<AccessPersonRow> & Pick<AccessPersonRow, 'userId' | 'displayName'>) =>
  ({
    id: `row-${over.userId}`,
    isAdmin: false,
    source: 'grant',
    grantedByName: 'Franco',
    grantedAt: STAMP,
    revokedAt: null,
    revokedByName: null,
    revokeReason: null,
    updatedAt: STAMP,
    ...over,
  }) satisfies AccessPersonRow

const OVERVIEW: AccessOverview = {
  active: [
    person({ userId: 'u1', displayName: 'Franco', isAdmin: true, source: 'setup' }),
    person({ userId: 'u2', displayName: 'Nacho' }),
  ],
  revoked: [],
  ownersWithoutAccess: [
    { userId: 'u3', name: 'Luz' },
    { userId: 'u4', name: 'Ana' },
  ],
  accountants: [],
  adminCount: 1,
}

describe('Accesos: solo quien da accesos ve controles', () => {
  const panel = (isAdmin: boolean, canWrite: boolean, showMembers = true) =>
    html(
      createElement(AccessPanel, {
        tenantSlug: 'hub',
        overview: OVERVIEW,
        currentUserId: 'u1',
        isAdmin,
        canWrite,
        showMembers,
      }),
    )

  it('quien da accesos: «Dar acceso» en la misma fila, «Da accesos» y «Sacar acceso»', () => {
    const out = panel(true, true)
    expect(out).toContain('2')
    expect(out).toContain('de 4 socios entran')
    expect((out.match(/Dar acceso</g) ?? []).length).toBe(2)
    expect((out.match(/Sacar acceso/g) ?? []).length).toBe(2)
    expect((out.match(/role="switch"/g) ?? []).length).toBe(2)
    expect(out).toContain('Sumar a la contadora')
    // El único que da accesos soy yo.
    expect(out).toContain('Solo vos podés habilitar a otros.')
    expect(out).toContain('Tiene que quedar al menos una persona que dé accesos')
    expect(out).not.toContain('@')
  })

  it('un dueño que no da accesos lo lee en palabras, sin controles', () => {
    const out = panel(false, true).replace('Los accesos los da Franco.', '')
    expect(out).toContain('Ve y carga')
    expect(out).toContain('Da accesos')
    expect(out).not.toContain('role="switch"')
    expect(out).not.toMatch(/Dar acceso|Sacar acceso|Pasar a darlos yo|Sumar a la contadora/)
    expect(buttons(out)).toBe(0)
  })

  it('la contadora: no ve la lista de socios ni ningún control', () => {
    const out = html(
      createElement(AccessPanel, {
        tenantSlug: 'hub',
        overview: { ...OVERVIEW, ownersWithoutAccess: [], accountants: [] },
        currentUserId: 'contadora',
        isAdmin: false,
        canWrite: false,
        showMembers: false,
      }),
    )
    expect(out).toContain('personas entran')
    expect(out).toContain('Los accesos los da Franco.')
    expect(out).toContain('La contadora entra con su propio usuario, en modo lectura.')
    expect(out).not.toContain('Todavía no entran')
    expect(out).not.toContain('role="switch"')
    expect(buttons(out)).toBe(0)
    expect(links(out)).toBe(0)
  })

  it('con la contadora ya sumada: «Sumar a otra» es solo de quien da accesos', () => {
    const withAccountant = { ...OVERVIEW, accountants: [{ userId: 'c1', name: 'Marta' }] }
    const render = (isAdmin: boolean) =>
      html(
        createElement(AccessPanel, {
          tenantSlug: 'hub',
          overview: withAccountant,
          currentUserId: 'u1',
          isAdmin,
          canWrite: true,
          showMembers: true,
        }),
      )
    expect(render(true)).toContain('Marta')
    expect(render(true)).toContain('Solo lectura')
    expect(render(true)).toContain('Sumar a otra')
    expect(render(true)).toContain('href="/hub/configuracion/equipo?rol=accountant"')
    expect(render(false)).toContain('Marta')
    expect(render(false)).not.toContain('Sumar a otra')
    expect(links(render(false))).toBe(0)
  })

  it('nadie da accesos: solo quien puede cargar ve «Pasar a darlos yo»', () => {
    const none = {
      ...OVERVIEW,
      active: OVERVIEW.active.map((a) => ({ ...a, isAdmin: false })),
      adminCount: 0,
    }
    const render = (canWrite: boolean) =>
      html(
        createElement(AccessPanel, {
          tenantSlug: 'hub',
          overview: none,
          currentUserId: 'u2',
          isAdmin: false,
          canWrite,
          showMembers: canWrite,
        }),
      )
    expect(render(true)).toContain('Nadie está dando los accesos.')
    expect(render(true)).toContain('Pasar a darlos yo')
    expect(render(false)).not.toContain('Pasar a darlos yo')
  })
})

const cajaRow = (
  over: Partial<TreasuryAccountRow> & Pick<TreasuryAccountRow, 'id' | 'name' | 'kind'>,
) =>
  ({
    accountId: `acc-${over.id}`,
    accountCode: '1.1.01.02',
    bankPartyId: null,
    bankName: null,
    cbuCvu: null,
    alias: null,
    accountNumber: null,
    allowNegative: false,
    lastCheckedOn: null,
    sort: 10,
    active: true,
    systemKey: null,
    updatedAt: STAMP,
    ...over,
  }) satisfies TreasuryAccountRow

const CAJAS: TreasuryAccountRow[] = [
  cajaRow({ id: 'caja', name: 'Caja Efectivo', kind: 'cash', accountCode: '1.1.01.01' }),
  cajaRow({ id: 'mp', name: 'Mercado Pago', kind: 'wallet', alias: 'bar.mp' }),
  cajaRow({ id: 'vieja', name: 'Caja vieja', kind: 'cash', active: false }),
]

describe('Cajas y cuentas', () => {
  const panel = (readOnly: boolean) =>
    html(
      createElement(TreasuriesPanel, {
        tenantSlug: 'hub',
        rows: CAJAS,
        // Nueve cifras: el saldo no se parte ni se muestra en centavos sueltos.
        balances: { caja: 12_345_678_950, mp: 0 },
        tones: { caja: { kind: 'cash', step: 1 }, mp: { kind: 'wallet', step: 1 } },
        readOnly,
        afterCreate: 'opening',
      }),
    )

  it('quien carga: editar, ver movimientos, «En uso», agregar y el empujón del banco', () => {
    const out = panel(false)
    expect(out).toContain('Agregar una caja o cuenta')
    expect(out).toContain('No hay ningún banco cargado')
    expect(out).toContain('Agregar el banco')
    expect(out).toContain('aria-label="Editar Caja Efectivo"')
    expect(out).toContain('href="/hub/administracion/cajas/caja"')
    expect((out.match(/role="switch"/g) ?? []).length).toBe(3)
    expect(out).toContain('Las que ya no se usan')
    // El código de la cuenta es de la contadora: el dueño no lo ve.
    expect(out).not.toContain('Cuenta 1.1.01')
    expect(out).toContain('123.456.789,50')
    expect(out).toContain('Falta el CVU')
    expect(out).toContain('Alias bar.mp')
  })

  it('la contadora: las mismas tarjetas, sin controles y con el código de la cuenta', () => {
    const out = panel(true)
    expect(out).toContain('Caja Efectivo')
    expect(out).toContain('Cuenta 1.1.01.01')
    expect(out).toContain('No hay ningún banco cargado')
    expect(out).not.toContain('role="switch"')
    expect(out).not.toMatch(/Agregar|Editar|Ver movimientos|En uso/)
    expect(buttons(out)).toBe(0)
    expect(links(out)).toBe(0)
  })

  it('el renglón de la tarjeta: alias y los últimos cuatro del CBU, nunca entero', () => {
    const bank = { kind: 'bank' as const, bankName: null, alias: null, cbuCvu: null }
    expect(treasuryLine({ ...bank, alias: 'hub.sas', cbuCvu: '0110599520000001234567' })).toBe(
      'Alias hub.sas · CBU ···· 4567',
    )
    expect(treasuryLine({ ...bank, kind: 'wallet', cbuCvu: '0000003100012345678901' })).toBe(
      'CVU ···· 8901',
    )
    expect(treasuryLine(bank)).toBeNull()
    expect(treasuryLine({ ...bank, kind: 'cash' })).toBe('Billetes y monedas')
    expect(treasuryLine({ ...bank, kind: 'credit_card', bankName: 'Banco Galicia' })).toBe(
      'La emite Banco Galicia',
    )
    expect(treasuryLine({ ...bank, kind: 'other' })).toBeNull()
    expect(maskedTail('0110 5995 2000 0001 2345 67')).toBe('···· 4567')
    expect(treasuryMissing({ kind: 'bank', cbuCvu: null })).toBe('Falta el CBU')
    expect(treasuryMissing({ kind: 'wallet', cbuCvu: null })).toBe('Falta el CVU')
    expect(treasuryMissing({ kind: 'bank', cbuCvu: '1' })).toBeNull()
    expect(treasuryMissing({ kind: 'cash', cbuCvu: null })).toBeNull()
  })
})

const NO_RATES: PartyRates = {
  commissionBp: null,
  iibbWithholdingBp: null,
  vatWithholdingBp: null,
  incomeTaxWithholdingBp: null,
  sircupaBp: null,
}
const partyRow = (over: Partial<SystemPartyRow> & Pick<SystemPartyRow, 'id' | 'name' | 'kind'>) =>
  ({
    systemKey: over.id,
    taxId: null,
    active: true,
    commissionVatMode: 'per_settlement',
    rates: NO_RATES,
    updatedAt: STAMP,
    ...over,
  }) satisfies SystemPartyRow

const PARTIES: SystemPartyRow[] = [
  partyRow({
    id: 'pedidosya',
    name: 'PedidosYa',
    kind: 'delivery_platform',
    rates: { ...NO_RATES, commissionBp: 2500 },
  }),
  partyRow({ id: 'rappi', name: 'Rappi', kind: 'delivery_platform' }),
  partyRow({ id: 'pedix', name: 'Pedix', kind: 'delivery_platform', active: false }),
  partyRow({ id: 'arca', name: 'ARCA', kind: 'tax_agency', commissionVatMode: 'none' }),
]

const medio = (over: Partial<SalesMethodRow> & Pick<SalesMethodRow, 'id' | 'name' | 'kind'>) =>
  ({
    channel: 'salon',
    treasuryAccountId: null,
    treasuryName: null,
    partyId: null,
    partyName: null,
    settlementDays: 0,
    sort: 10,
    active: true,
    systemKey: null,
    updatedAt: STAMP,
    ...over,
  }) satisfies SalesMethodRow

const MEDIOS: SalesMethodRow[] = [
  medio({
    id: 'efectivo',
    name: 'Efectivo',
    kind: 'treasury',
    treasuryAccountId: 'caja',
    treasuryName: 'Caja Efectivo',
  }),
  medio({
    id: 'pya',
    name: 'PedidosYa',
    kind: 'receivable',
    channel: 'delivery',
    partyId: 'pedidosya',
    partyName: 'PedidosYa',
    settlementDays: 14,
    sort: 20,
  }),
  medio({
    id: 'rappi',
    name: 'Rappi',
    kind: 'receivable',
    channel: 'delivery',
    partyId: 'rappi',
    partyName: 'Rappi',
    settlementDays: 14,
    sort: 30,
  }),
  medio({
    id: 'pedix',
    name: 'Pedix',
    kind: 'receivable',
    channel: 'delivery',
    partyId: 'pedix',
    partyName: 'Pedix',
    settlementDays: 14,
    sort: 40,
  }),
  medio({ id: 'senas', name: 'Seña aplicada', kind: 'advance', sort: 50, active: false }),
]

describe('Medios de cobro', () => {
  const panel = (readOnly: boolean) =>
    html(
      createElement(MethodsPanel, {
        tenantSlug: 'hub',
        methods: MEDIOS,
        treasuries: [
          { id: 'caja', name: 'Caja Efectivo', kind: 'cash', active: true, bankPartyId: null },
        ],
        parties: PARTIES,
        readOnly,
        cuitOpen: readOnly,
      }),
    )

  it('quien carga: agregar, cambiar el orden, la comisión como píldora y «Prenderla»', () => {
    const out = panel(false)
    expect(out).toContain('Agregar un medio')
    expect(out).toContain('Cambiar el orden')
    expect(out).toContain('aria-label="Editar PedidosYa"')
    expect(out).toContain('Cargar la comisión')
    expect(out).toContain('Pedix está apagada')
    expect(out).toContain('Prenderla')
    expect(out).toContain('Abrir el cierre del día')
    expect((out.match(/role="switch"/g) ?? []).length).toBe(MEDIOS.length)
    // El título afirma el único caso con comisión, y dice qué falta.
    expect(out).toMatch(/Con PedidosYa, de cada \$.10\.000 te llegan \$.6\.975\./)
    expect(out).toContain('Sin comisión cargada: Rappi y Pedix.')
  })

  it('sin comisión cargada nunca se afirma que «llegan $ 10.000»', () => {
    const out = panel(false)
    expect(out).toContain('Falta la comisión')
    expect(out).not.toMatch(/10\.000<\/span><span[^>]*>\s*te llegan/)
    // El efectivo sí llega entero, dicho con palabras.
    expect(out).toContain('Llega entero')
  })

  it('la columna del cierre lista los prendidos, numerados y en su orden', () => {
    const out = panel(false)
    expect(out).toContain('Tu columna del cierre')
    for (const name of ['Efectivo', 'PedidosYa', 'Rappi', 'Pedix']) expect(out).toContain(name)
    expect(out).toContain('Apagados')
  })

  it('la contadora: ningún control, y la lista de CUIT abierta', () => {
    const out = panel(true)
    expect(out).toContain('PedidosYa')
    expect(out).toContain('Prendido')
    expect(out).toContain('CUIT de tarjetas, apps, bancos y organismos')
    expect(out).toMatch(/<details[^>]*id="cuit"[^>]*open=""/)
    expect(out).not.toContain('role="switch"')
    expect(out).not.toMatch(
      /Agregar un medio|Cambiar el orden|Cargar la comisión|Prenderla|Abrir el cierre del día|aria-label="Editar/,
    )
    // Lo único que se toca son controles de lectura: «Ver como tabla» y «¿Cómo se calcula?».
    expect(buttons(out)).toBe(1)
    expect(out).toContain('Ver como tabla')
  })

  it('para el dueño la lista de CUIT viene plegada, y están todos', () => {
    const out = panel(false)
    expect(out).not.toMatch(/<details[^>]*id="cuit"[^>]*open=""/)
    expect(out).toContain('4 sin CUIT')
    expect(out).toContain('ARCA')
    expect(out).toContain('aria-label="Editar ARCA"')
  })
})

const punto = (number: number, label: string, active = true): SalesPointRow => ({
  id: `pv-${number}`,
  number,
  label,
  defaultChannel: 'salon',
  active,
  updatedAt: STAMP,
})

describe('Puntos de venta', () => {
  const panel = (points: SalesPointRow[], readOnly: boolean) =>
    html(
      createElement(SalesPointsPanel, { tenantSlug: 'hub', points, readOnly, arca: 'not_started' }),
    )

  it('vacío (el bar recién arranca): enseña qué pasa y ofrece agregar el primero', () => {
    const out = panel([], false)
    expect(out).toContain('Todavía no cargaste con qué número facturás')
    expect(out).toContain('todo el día queda como venta sin factura: se registra igual')
    expect(out).toContain('Agregar el primero')
    expect(out).toContain('Si todavía no facturan, dejalo así.')
    expect(out).toContain('Ejemplo')
    expect(out).toContain('Con factura o sin factura, todo queda registrado en los libros.')
    expect(out).toContain('ARCA sin conectar')
    expect(out).toContain('href="/hub/administracion/ajustes?tab=arca"')
    expect(out).not.toMatch(/en negro|en blanco|fuera de los libros/i)
  })

  it('con puntos de venta: el número grande, su canal y sus controles', () => {
    const out = panel([punto(3, 'Salón'), punto(5, 'Delivery', false)], false)
    expect(out).toContain('0003')
    expect(out).toContain('0005')
    expect(out).toContain('Agregar un punto de venta')
    expect(out).toContain('aria-label="Editar el punto de venta 3"')
    expect((out.match(/role="switch"/g) ?? []).length).toBe(2)
  })

  it('la contadora: sin agregar, sin lápices y sin interruptores', () => {
    for (const out of [panel([], true), panel([punto(3, 'Salón')], true)]) {
      expect(out).not.toContain('role="switch"')
      expect(out).not.toMatch(/Agregar|aria-label="Editar|dejalo así/)
      expect(buttons(out)).toBe(0)
    }
  })
})

const SETTINGS: AccountingSettings = {
  legalName: 'Bar de Prueba SAS',
  cuit: null,
  ivaCondition: 'responsable_inscripto',
  iibbRegime: 'local',
  iibbNumber: null,
  iibbJurisdictionCode: 904,
  activityStartDate: null,
  fiscalAddress: null,
  booksStartDate: '2026-10-12',
  fiscalYearEndMonth: 12,
  ivaSettlementMode: 'on_close',
  ivaDueDay: 20,
  iibbDueDay: 15,
  vatToleranceCents: 100,
  bankTaxCreditComputableBp: 3300,
  bankTaxDebitComputableBp: 3300,
  uninvoicedSalesMode: 'separate_accounts',
  closedPeriodVoidIvaMode: 'adjustment_only',
  dueSoonDays: 7,
  openingStatus: 'pending',
  setupCompletedAt: STAMP,
  updatedAt: STAMP,
  hasDocuments: true,
  hasClosedPeriods: false,
}

describe('Datos de la SAS y Ejercicio', () => {
  it('el dueño: la hoja con sus campos; la fecha de arranque trabada dice por qué', () => {
    const out = html(
      createElement(SasSettingsForm, {
        tenantSlug: 'hub',
        settings: SETTINGS,
        today: '2026-10-13',
        how: ['Bajá la constancia de inscripción.'],
      }),
    )
    expect(out).toContain('Guardar cambios')
    expect(out).toContain('como en la constancia')
    // La CUIT que falta se nota.
    expect(out).toContain('Falta')
    expect(out).toContain('La piden los libros de IVA, ARCA y los importadores.')
    expect(out).toContain('Cargás desde el')
    expect(out).toContain('12/10/2026')
    expect(out).toContain(
      'Ya hay comprobantes cargados: la fecha de arranque no se puede cambiar desde acá. Todo lo anterior a ese día no se carga.',
    )
    expect(out).toContain('Primer ejercicio: del 12/10/2026 al 31/12/2026.')
    expect(out).toContain('¿De dónde saco estos datos?')
    // Ya no se dice «asiento de apertura» ni «Los libros arrancan el».
    expect(out).not.toMatch(/asiento de apertura|Los libros arrancan el/)
  })

  it('sin comprobantes todavía: la fecha se puede cambiar y dice qué significa', () => {
    const out = html(
      createElement(SasSettingsForm, {
        tenantSlug: 'hub',
        settings: { ...SETTINGS, hasDocuments: false },
        today: '2026-10-13',
        how: [],
      }),
    )
    expect(out).toContain('id="aj-books-start"')
    expect(out).toContain('Todo lo anterior a ese día no se carga acá')
    // El cierre del ejercicio: doce chips, no un desplegable.
    expect((out.match(/role="radio"/g) ?? []).length).toBeGreaterThanOrEqual(12 + 3 + 4)
    expect(out).not.toContain('role="combobox"')
  })

  it('la contadora: la misma hoja con los valores escritos, sin campos ni botones', () => {
    const out = html(createElement(SasSettingsView, { settings: SETTINGS }))
    expect(out).toContain('Bar de Prueba SAS')
    expect(out).toContain('Sin cargar')
    expect(out).toContain('Falta')
    expect(out).toContain('12/10/2026')
    expect(out).not.toMatch(/<input|<button|Guardar/)
  })

  it('Ejercicio: el dueño guarda; la contadora lee los mismos dos grupos', () => {
    const form = html(createElement(PeriodSettingsForm, { tenantSlug: 'hub', settings: SETTINGS }))
    expect(form).toContain('Avisos y vencimientos')
    expect(form).toContain('¿Con cuántos días de anticipación te avisamos que algo vence?')
    expect(form).toContain('Reglas contables')
    expect(form).toContain('id="reglas"')
    expect(form).toContain(
      'Con las dos opciones quedan registradas igual; cambia solo en qué cuenta.',
    )
    expect(form).toContain('Guardar cambios')
    const view = html(createElement(PeriodSettingsView, { settings: SETTINGS }))
    expect(view).toContain('Avisos y vencimientos')
    expect(view).toContain('Reglas contables')
    expect(view).toContain('id="reglas"')
    expect(view).not.toMatch(/<input|<button|Guardar/)
  })
})

const period = (over: Partial<PeriodRow> & Pick<PeriodRow, 'id' | 'month'>): PeriodRow => ({
  fiscalYearId: 'fy',
  kind: 'month',
  startsOn: over.month,
  endsOn: `${over.month.slice(0, 8)}28`,
  status: 'open',
  closedAt: null,
  closedByName: null,
  numberFrom: null,
  numberTo: null,
  entriesCount: null,
  debitTotalCents: null,
  ivaSettlementDocumentId: null,
  ...over,
})

describe('los meses del ejercicio', () => {
  const year: FiscalYearRow = {
    id: 'fy',
    startDate: '2026-10-12',
    endDate: '2026-12-31',
    status: 'open',
    openingNumberReserved: false,
    closedAt: null,
    closedByName: null,
    periods: [
      period({ id: 'oct', month: '2026-10-01', startsOn: '2026-10-12', endsOn: '2026-10-31' }),
      period({ id: 'nov', month: '2026-11-01', endsOn: '2026-11-30' }),
      period({ id: 'dic', month: '2026-12-01', endsOn: '2026-12-31' }),
      period({
        id: 'aj',
        month: '2026-12-01',
        kind: 'fy_adjustments',
        startsOn: '2026-12-31',
        endsOn: '2026-12-31',
      }),
    ],
  }

  it('el título afirma cuántos meses están cerrados', () => {
    expect(yearTitle(year)).toBe('Ejercicio 2026: ningún mes cerrado todavía')
    const two = {
      ...year,
      periods: year.periods.map((p, i) => (i < 2 ? { ...p, status: 'closed' as const } : p)),
    }
    expect(yearTitle(two)).toBe('Ejercicio 2026: 2 de 3 meses cerrados')
    const all = {
      ...year,
      periods: year.periods.map((p) => ({ ...p, status: 'closed' as const })),
    }
    expect(yearTitle(all)).toBe('Ejercicio 2026: los 3 meses cerrados')
    expect(yearTitle({ ...year, status: 'closed' })).toBe('Ejercicio 2026: cerrado')
    expect(yearTitle({ ...year, periods: [] })).toBe('Ejercicio 2026')
  })

  it('el estado de cada período es el de la tira de Libros', () => {
    const [oct, nov, , aj] = year.periods as [PeriodRow, PeriodRow, PeriodRow, PeriodRow]
    expect(periodState(oct, '2026-10-13')).toBe('current')
    expect(periodState(nov, '2026-10-13')).toBe('future')
    expect(periodState(oct, '2026-11-02')).toBe('to_close')
    expect(periodState({ ...oct, status: 'closed' }, '2026-11-02')).toBe('closed')
    // El período de ajustes no es un mes: abierto, sin más.
    expect(periodState(aj, '2026-10-13')).toBe('open')
  })

  it('la tira, con «Ver como tabla» y el link a «Libros › Fin de mes»', () => {
    const out = html(
      createElement(FiscalYearsList, {
        years: [year],
        cierresHref: '/hub/administracion/libros/cierres',
        today: '2026-10-13',
      }),
    )
    expect(out).toContain('Ejercicio 2026: ningún mes cerrado todavía')
    expect(out).toContain('Del 12/10/2026 al 31/12/2026.')
    for (const label of ['Oct', 'Nov', 'Dic', 'Ajustes']) expect(out).toContain(label)
    expect(out).toContain('En curso')
    expect(out).toContain('Ver como tabla')
    expect(out).toContain('Libros › Fin de mes')
    expect(out).not.toContain('Cierres de mes')
    expect(out).toContain('href="/hub/administracion/libros/cierres?mes=2026-10"')
  })

  it('sin ejercicios, lo dice', () => {
    const out = html(
      createElement(FiscalYearsList, { years: [], cierresHref: '/x', today: '2026-10-13' }),
    )
    expect(out).toContain(
      'Todavía no hay ejercicios: se arman solos con la fecha de arranque de los libros.',
    )
  })
})

describe('la portada', () => {
  const step = (over: Partial<SetupStep>): SetupStep => ({
    id: 'opening',
    title: 'Cargá lo que hay hoy en cada caja',
    detail:
      'Los saldos iniciales: cuánta plata hay y cuánto se debe. Sin eso, todo arranca en cero.',
    done: false,
    optional: false,
    action: { kind: 'href', href: '/hub/administracion/configurar', label: 'Cargar lo que hay' },
    ...over,
  })
  const sas = step({
    id: 'sas_data',
    title: 'Completá los datos de la SAS',
    detail: 'Falta la CUIT.',
    action: { kind: 'href', href: '/hub/administracion/ajustes?tab=sas', label: 'Completar' },
  })

  it('quien carga: el paso que falta, en grande, con UN botón y lo que sigue', () => {
    const out = html(
      createElement(SetupNext, {
        view: { kind: 'urgent', step: step({}), after: [sas] },
        guideHref: '/hub/administracion/guias/como-arrancar',
      }),
    )
    expect(out).toContain('Puesta en marcha')
    expect(out).toContain('Cargá lo que hay hoy en cada caja')
    expect(out).toContain('Cargar lo que hay')
    expect(out).toContain('href="/hub/administracion/configurar"')
    expect(out).toContain('Después:')
    expect(out).toContain('Completá los datos de la SAS')
    expect(out).toContain('Ver todo lo que falta')
    // No repite el «N de M» del Resumen.
    expect(out).not.toMatch(/\d+ de \d+/)
  })

  it('lo que puede esperar es una línea; con todo hecho, lo dice', () => {
    const later = html(
      createElement(SetupNext, {
        view: { kind: 'later', steps: [sas], more: 2 },
        guideHref: '/g',
      }),
    )
    expect(later).toContain('Para completar cuando puedas:')
    expect(later).toContain('y 2 más')
    expect(later).toContain('Ver todo')
    const done = html(createElement(SetupNext, { view: { kind: 'complete' }, guideHref: '/g' }))
    expect(done).toContain('La puesta en marcha está completa.')
  })

  it('la contadora: lo que falta en dos píldoras, sin ningún botón ni link', () => {
    const out = html(
      createElement(SetupPills, {
        steps: [
          step({ title: 'Faltan los saldos iniciales', action: null }),
          step({ id: 'sas_data', title: 'Falta el CUIT de la SAS', action: null }),
          step({ id: 'x', title: 'Otro', action: null }),
        ],
      }),
    )
    expect(out).toContain('Faltan los saldos iniciales')
    expect(out).toContain('Falta el CUIT de la SAS')
    expect(out).not.toContain('Otro')
    expect(buttons(out)).toBe(0)
    expect(links(out)).toBe(0)
    expect(html(createElement('div', null, createElement(SetupPills, { steps: [] })))).toBe(
      '<div></div>',
    )
  })

  it('el cajón de la contadora: para el dueño va callado; para ella es «Tu zona»', () => {
    const owner = html(
      createElement(AccountantDrawer, { base: '/hub/administracion', mine: false }),
    )
    expect(owner).toContain('Para la contadora')
    expect(owner).toContain('Si no te los pidió, no hace falta tocar nada.')
    const mine = html(createElement(AccountantDrawer, { base: '/hub/administracion', mine: true }))
    expect(mine).toContain('Tu zona')
    for (const out of [owner, mine]) {
      expect(out).toContain('href="/hub/administracion/ajustes?tab=ejercicio"')
      expect(out).toContain('href="/hub/administracion/ajustes?tab=ejercicio#reglas"')
      expect(out).toContain('href="/hub/administracion/ajustes?tab=participes#cuit"')
      expect(out).toContain('href="/hub/administracion/ajustes?tab=integridad"')
      expect(out).toContain('href="/hub/administracion/ajustes?tab=arca#homologacion"')
      // Son links: acá no se guarda nada.
      expect(buttons(out)).toBe(0)
    }
  })
})

describe('Integridad', () => {
  it('«Verificar» es una lectura: lo ve también quien solo lee', () => {
    const out = html(
      createElement(IntegrityPanel, {
        verifyHref: '/hub/administracion/ajustes?tab=integridad&verificar=1',
        ran: false,
        checks: null,
        closed: null,
      }),
    )
    expect(out).toContain('Revisar que todo cierre')
    expect(out).toContain('Verificar')
    expect(out).toContain('verificar=1')
  })

  it('corrida: el veredicto y cada revisión con su estado en palabras', () => {
    const out = html(
      createElement(IntegrityPanel, {
        verifyHref: '/x',
        ran: true,
        checks: {
          ok: true,
          data: [
            { checkKey: 'entries_balanced', ok: true, detail: null },
            { checkKey: 'allocations_valid', ok: false, detail: { count: 2 } },
          ],
        },
        closed: { ok: true, data: [] },
      }),
    )
    expect(out).toContain('Hay cosas que no cierran.')
    expect(out).toContain('Bien')
    expect(out).toContain('No cierra')
    expect(out).toContain('2 casos para revisar.')
    expect(out).toContain('Si algo no cierra, avisanos')
  })
})
