// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Wallet } from 'lucide-react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PanelError as HomePanelError } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/block-states'
import { RetryButton as HomeRetryButton } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/retry-button'
import { isQuickExpenseAccount } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/accounts'
import { TREASURY_ICONS } from '@/components/administracion/cajas-ventas/treasury-display'
import { treasuryToneSwatch } from '@/components/administracion/charts/palette'
import {
  CategoryPicker,
  categoryOptions,
  featuredCategories,
  PanelError,
  PanelLink,
  PaperSheet,
  RetryButton,
  StatusPill,
  TicketLabel,
  TicketRow,
  TicketStamp,
  ViewPills,
  WALLET_ICONS,
  WalletCard,
} from '@/components/administracion/kit'
import { TreasuryPicker } from '@/components/administracion/treasury-picker'
import type { TreasuryOption } from '@/components/administracion/treasury-select'
import { STANDARD_CHART } from '@/lib/accounting/chart'
import { type TreasuryTone, treasuryTones } from '@/lib/accounting/home'
import { formatCents, formatCentsShort } from '@/lib/money'

/**
 * Las piezas del kit que sumó la tanda 2, ya dibujadas: las vistas de una
 * pantalla, la tarjeta de una caja, la hoja de papel, el selector de
 * categoría, el sello de un acto terminado y el bloque que no cargó. Se fija lo
 * que leen el teclado y los lectores (roles, nombres, orden), no las clases.
 * `Ledger*` tiene su archivo (`adm-ledger`) y las cuentas de las categorías, el
 * suyo (`adm-category`).
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

/** El HTML con espacios comunes (la plata lleva un espacio duro después del «$»). */
function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(' ', ' ')
}

/** Lo que se lee: sin etiquetas y con los espacios colapsados. */
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function count(markup: string, piece: string): number {
  return markup.split(piece).length - 1
}

const BASE = '/hub/administracion'
/** Los tonos de las cajas de un bar típico, como los calcula el Resumen. */
const CASH: TreasuryTone = { kind: 'cash', step: 1 }
const BANK: TreasuryTone = { kind: 'bank', step: 1 }
const WALLET: TreasuryTone = { kind: 'wallet', step: 1 }
const LONG_NAME = 'Cuenta corriente en pesos del Banco de la Nación Argentina 1' // 60 caracteres

// ─── ViewPills ───────────────────────────────────────────────────────────────

describe('ViewPills: las vistas de una pantalla', () => {
  const items = [
    { key: 'mes', label: 'El mes', href: `${BASE}/ventas`, active: false },
    {
      key: 'cobrar',
      label: 'Plata por cobrar',
      shortLabel: 'Por cobrar',
      href: `${BASE}/ventas?tab=clientes`,
      count: 3,
      active: true,
    },
    { key: 'facturas', label: 'Facturas', href: `${BASE}/ventas?tab=facturas`, active: false },
  ]

  it('es una navegación con nombre y un link por vista, en orden', () => {
    const out = html(<ViewPills label="Vistas de Ventas" items={items} />)
    expect(out).toMatch(/<nav [^>]*aria-label="Vistas de Ventas"/)
    expect(count(out, '<a ')).toBe(3)
    const hrefs = [...out.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs).toEqual([
      `${BASE}/ventas`,
      `${BASE}/ventas?tab=clientes`,
      `${BASE}/ventas?tab=facturas`,
    ])
  })

  it('marca la vista en la que estás, y solo esa', () => {
    const out = html(<ViewPills label="Vistas de Ventas" items={items} />)
    expect(count(out, 'aria-current="page"')).toBe(1)
    expect(out).toMatch(/<a [^>]*aria-current="page"[^>]*href="[^"]*tab=clientes"/)
  })

  it('el nombre corto y el largo van los dos: cada ancho muestra el suyo', () => {
    const out = html(<ViewPills label="Vistas de Ventas" items={items} />)
    expect(out).toContain('>Por cobrar<')
    expect(out).toContain('>Plata por cobrar<')
    // El contador va en su pastilla, nunca pegado al nombre.
    expect(out).toMatch(/Plata por cobrar<\/span><\/span><span[^>]*>3<\/span>/)
  })

  it('lleva el ícono de cada vista, que no se lee', () => {
    const out = html(
      <ViewPills
        label="Vistas de Cajas"
        items={[
          { key: 'hay', label: 'Lo que hay', href: `${BASE}/cajas`, icon: Wallet, active: true },
        ]}
      />,
    )
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(text(out)).toBe('Lo que hay')
  })

  it('`aside` va después de las vistas y fuera de la navegación', () => {
    const out = html(
      <ViewPills label="Vistas de Ventas" items={items} aside={<span>Octubre 2026</span>} />,
    )
    expect(out.indexOf('</nav>')).toBeLessThan(out.indexOf('Octubre 2026'))
  })

  it('si no entran lado a lado, `aside` baja solo a su renglón: no hay corte por ancho de ventana', () => {
    const out = html(
      <ViewPills label="Vistas de Ventas" items={items} aside={<span>Octubre 2026</span>} />,
    )
    const wrapper = /^<div class="([^"]*)"/.exec(out)?.[1] ?? ''
    expect(wrapper).toContain('flex-wrap')
    expect(wrapper).not.toContain('sm:flex-row')
    expect(wrapper).not.toContain('flex-col')
    // La navegación y el `aside` pueden achicarse hasta el ancho de la página, no más.
    expect(out).toMatch(/<nav [^>]*class="[^"]*min-w-0[^"]*max-w-full/)
    // En el celular la fila desliza con desvanecido; desde `sm` baja de renglón (nada queda cortado).
    const list = /<ul class="([^"]*)"/.exec(out)?.[1] ?? ''
    expect(list).toContain('overflow-x-auto')
    expect(list).toContain('max-sm:[mask-image:')
    expect(list).toContain('sm:flex-wrap')
    expect(list).toContain('sm:overflow-visible')
  })

  it('44 px donde se toca con el dedo (también en una tablet); 36 solo con mouse', () => {
    const out = html(<ViewPills label="Vistas de Ventas" items={items} />)
    for (const link of out.match(/<a [^>]*>/g) ?? []) {
      expect(link).toContain('h-11')
      expect(link).toContain('md:pointer-fine:h-9')
      expect(link).not.toMatch(/(?<![:\w-])md:h-9/)
    }
  })

  it('`ariaLabel` es lo que escucha un lector en lugar del texto', () => {
    const out = html(
      <ViewPills
        label="Meses"
        items={[
          {
            key: '2026-10',
            label: 'Octubre',
            href: `${BASE}/gastos-fijos`,
            count: 3,
            active: true,
            ariaLabel: 'Octubre, este mes: 3 por pagar',
          },
          {
            key: '2026-11',
            label: 'Noviembre',
            href: `${BASE}/gastos-fijos?mes=2026-11`,
            active: false,
          },
        ]}
      />,
    )
    expect(out).toMatch(
      /<a (?=[^>]*aria-current="page")[^>]*aria-label="Octubre, este mes: 3 por pagar"/,
    )
    expect(count(out, 'aria-label="Octubre')).toBe(1)
  })

  it('una vista en cero se dibuja apagada, con su contador, y no se puede tocar', () => {
    const out = html(
      <ViewPills
        label="Vistas de la revisión"
        items={[
          { key: 'faltan', label: 'Faltan', href: `${BASE}/importar/b1`, count: 4, active: true },
          {
            key: 'cargados',
            label: 'Cargados',
            href: `${BASE}/importar/b1?ver=cargados`,
            count: 0,
            active: false,
            disabled: true,
          },
        ]}
      />,
    )
    // Un solo link: la apagada no lleva a ningún lado ni entra en el orden de Tab.
    expect(count(out, '<a ')).toBe(1)
    expect(out).not.toContain('ver=cargados')
    const off = /<span aria-disabled="true" class="([^"]*)">(.*?)<\/span><\/li>/.exec(out)
    expect(off).not.toBeNull()
    expect(off?.[0]).not.toContain('tabindex')
    expect(text(off?.[2] ?? '')).toBe('Cargados 0')
    // Se ve como una píldora en reposo, apagada, del mismo tamaño que las otras.
    expect(off?.[1]).toContain('opacity-50')
    expect(off?.[1]).toContain('rounded-full')
    expect(off?.[1]).toContain('h-11')
    expect(text(out)).toBe('Faltan 4 Cargados 0')
  })

  it('`scroll={false}` no agrega nada al HTML y la vista sigue siendo un link', () => {
    const out = html(
      <ViewPills
        label="Vistas"
        items={[
          { key: 'a', label: 'Lo pendiente', href: `${BASE}/x?ver=a`, active: true, scroll: false },
        ]}
      />,
    )
    expect(out).toMatch(/<a [^>]*href="\/hub\/administracion\/x\?ver=a"/)
    expect(out).not.toContain('scroll=')
  })

  it('trae a la vista la elegida solo donde la fila desliza: en la compu la página no arranca corrida', () => {
    // `scroll-initial-target` sin `max-sm:` apunta a la PÁGINA cuando la fila no
    // desliza (desde `sm`): Ventas, Compras, Cajas y los libros abrían 244 px abajo.
    const out = html(<ViewPills label="Vistas de Ventas" items={items} />)
    expect(out).toContain('max-sm:[scroll-initial-target:nearest]')
    expect(out).not.toMatch(/(^|[\s"])\[scroll-initial-target:nearest\]/)
    // Una sola: la de la vista elegida.
    expect(out.match(/scroll-initial-target/g)).toHaveLength(1)
  })

  it('sin vistas no dibuja una navegación vacía', () => {
    expect(html(<ViewPills label="Vistas" items={[]} />)).toBe('')
    const onlyAside = html(<ViewPills label="Vistas" items={[]} aside={<span>Octubre</span>} />)
    expect(onlyAside).not.toContain('<nav')
    expect(text(onlyAside)).toBe('Octubre')
  })
})

// ─── WalletCard ──────────────────────────────────────────────────────────────

describe('WalletCard: la tarjeta de una caja', () => {
  it('nombre, qué es, la plata, el estado, el pie y la acción, en ese orden', () => {
    const out = html(
      <WalletCard
        name="Caja"
        kind="cash"
        detail="Efectivo"
        tone={CASH}
        amount={formatCentsShort(39_475_700)}
        status={<StatusPill tone="ok">Contada hace 3 días</StatusPill>}
        footer="Último movimiento: ayer"
        action={<button type="button">Contar</button>}
      />,
    )
    expect(out.startsWith('<article')).toBe(true)
    expect(text(out)).toBe(
      'Caja Efectivo $ 394.757 Contada hace 3 días Último movimiento: ayer Contar',
    )
    expect(out).toMatch(/<h3[^>]*>Caja<\/h3>/)
  })

  it('el color sale del TIPO de caja, y la que no tiene uno propio va en neutro', () => {
    for (const kind of ['bank', 'cash', 'wallet'] as const) {
      for (const step of [1, 2, 3] as const) {
        const out = html(<WalletCard name="Caja" kind={kind} tone={{ kind, step }} />)
        const where = `${kind} ${step}`
        // El lomo, y el lavado del mismo color.
        expect(out, where).toContain(`bg-(--adm-k-${kind}-${step})`)
        expect(out, where).toContain(`from-(--adm-k-${kind}-${step})/10`)
        expect(out, where).toContain(`to-(--adm-k-${kind}-${step})/3`)
        expect(out, where).not.toContain('adm-neutral')
        // Ya no se pinta por la posición en la lista.
        expect(out, where).not.toMatch(/bg-adm-s\d/)
      }
    }
    const neutral = html(<WalletCard name="Visa" kind="credit_card" tone={null} />)
    expect(neutral).toContain('bg-adm-neutral')
    expect(neutral).toContain('from-adm-neutral/10')
    expect(neutral).not.toContain('--adm-k-')
  })

  it('una caja tiene el mismo color acá y en el Resumen (HUB: efectivo dorado, billetera celeste)', () => {
    // Las dos cajas de HUB, en el orden de Ajustes, como las recibe el Resumen.
    const tones = treasuryTones([
      { id: 'caja', kind: 'cash' },
      { id: 'mp', kind: 'wallet' },
      { id: 'visa', kind: 'credit_card' },
    ])
    const caja = html(<WalletCard name="Caja Efectivo" kind="cash" tone={tones.caja ?? null} />)
    const mp = html(<WalletCard name="Mercado Pago" kind="wallet" tone={tones.mp ?? null} />)
    const visa = html(<WalletCard name="Visa" kind="credit_card" tone={tones.visa ?? null} />)
    expect(caja).toContain('bg-(--adm-k-cash-1)')
    expect(mp).toContain('bg-(--adm-k-wallet-1)')
    // La tarjeta de la empresa no tiene tono: `treasuryTones` no la devuelve.
    expect(visa).toContain('bg-adm-neutral')
    // El lomo es la misma clase que `treasuryToneSwatch`, y esa es la del héroe del Resumen.
    expect(caja).toContain(treasuryToneSwatch(tones.caja))
    const hero = readFileSync(
      join(process.cwd(), 'app/(manager)/[tenantSlug]/administracion/_resumen/hero-block.tsx'),
      'utf8',
    )
    for (const kind of ['bank', 'cash', 'wallet'] as const) {
      for (const step of [1, 2, 3] as const) {
        const swatch = treasuryToneSwatch({ kind, step })
        expect(swatch).toBe(`bg-(--adm-k-${kind}-${step})`)
        expect(hero, swatch).toContain(`'${swatch}'`)
      }
    }
    expect(treasuryToneSwatch(null)).toBe('bg-adm-neutral')
    expect(treasuryToneSwatch(undefined)).toBe('bg-adm-neutral')
  })

  it('el ícono de cada tipo es el mismo que usa Cajas, sin depender de su archivo', () => {
    expect(Object.keys(WALLET_ICONS).sort()).toEqual(Object.keys(TREASURY_ICONS).sort())
    for (const kind of Object.keys(WALLET_ICONS) as (keyof typeof WALLET_ICONS)[]) {
      expect(WALLET_ICONS[kind], kind).toBe(TREASURY_ICONS[kind])
    }
    const source = readFileSync(
      join(process.cwd(), 'components/administracion/kit/wallet-card.tsx'),
      'utf8',
    )
    // Lo nombra en un comentario; lo que no puede es importarlo.
    expect(source).not.toMatch(/from '[^']*cajas-ventas/)
  })

  it('sin `amount` no inventa un número: nunca «$ 0» por un dato que falta', () => {
    const out = html(<WalletCard name="Caja" kind="cash" detail="Efectivo" tone={CASH} />)
    expect(text(out)).toBe('Caja Efectivo')
    expect(out).not.toContain('$')
  })

  it('cero es un dato y se escribe', () => {
    const out = html(
      <WalletCard name="Caja" kind="cash" tone={CASH} amount={formatCentsShort(0)} />,
    )
    expect(text(out)).toBe('Caja $ 0')
  })

  it('un descubierto conserva su signo y su rótulo', () => {
    const out = html(
      <WalletCard
        name="Banco"
        kind="bank"
        tone={BANK}
        amountLabel="Descubierto"
        amount={formatCentsShort(-524_300)}
      />,
    )
    expect(text(out)).toBe('Banco Descubierto − $ 5.243')
  })

  it('un importe de nueve cifras con centavos entra entero', () => {
    const out = html(
      <WalletCard name="Banco" kind="bank" tone={BANK} amount={formatCents(12_345_678_950)} />,
    )
    expect(text(out)).toBe('Banco $ 123.456.789,50')
  })

  it('un importe que no es texto va tal cual', () => {
    const out = html(
      <WalletCard name="Visa" kind="credit_card" tone={null} amount={<b>Sin deuda</b>} />,
    )
    expect(out).toContain('<b>Sin deuda</b>')
  })

  it('`empty` es un casillero que pregunta, sin ningún número', () => {
    const out = html(
      <WalletCard
        name="Mercado Pago"
        kind="wallet"
        detail="Billetera"
        tone={WALLET}
        amount={formatCentsShort(0)}
        empty
      />,
    )
    expect(text(out)).toBe('Mercado Pago Billetera ¿cuánto hay?')
    expect(out).not.toContain('$')
  })

  it('con `href` el nombre es el link (uno solo) y la acción queda afuera', () => {
    const out = html(
      <WalletCard
        name="Caja"
        kind="cash"
        tone={CASH}
        href={`${BASE}/cajas/c1`}
        action={<button type="button">Contar</button>}
      />,
    )
    expect(count(out, '<a ')).toBe(1)
    expect(out).toMatch(
      /<h3[^>]*><a [^>]*href="\/hub\/administracion\/cajas\/c1"[^>]*>Caja<\/a><\/h3>/,
    )
    expect(out).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<button/)
  })

  it('sin `href` no es un link', () => {
    expect(html(<WalletCard name="Caja" kind="cash" tone={CASH} />)).not.toContain('<a ')
  })

  it('el ícono del tipo de caja no se lee', () => {
    const out = html(<WalletCard name="Caja" kind="cash" tone={CASH} />)
    expect(out).toMatch(/<span aria-hidden="true"[^>]*><svg/)
  })

  it('lleva un cuerpo propio (la ficha, el dorso de Ajustes) entre el estado y el pie', () => {
    const out = html(
      <WalletCard name="Caja" kind="cash" tone={CASH} size="lg" footer="Editar">
        <p>Alias hub.sas.mp</p>
      </WalletCard>,
    )
    expect(text(out)).toBe('Caja Alias hub.sas.mp Editar')
  })

  it('un nombre de 60 caracteres queda entero para lectores y al pasar el mouse', () => {
    expect(LONG_NAME).toHaveLength(60)
    for (const size of ['sm', 'md', 'lg'] as const) {
      const out = html(<WalletCard name={LONG_NAME} kind="bank" tone={BANK} size={size} />)
      expect(out, size).toContain(`title="${LONG_NAME}"`)
      expect(text(out), size).toBe(LONG_NAME)
    }
  })

  it('una caja que ya no se usa pierde su color pero no su nombre ni su plata', () => {
    const out = html(
      <WalletCard
        name="Caja vieja"
        kind="cash"
        tone={CASH}
        amount={formatCentsShort(100_000)}
        muted
      />,
    )
    expect(text(out)).toBe('Caja vieja $ 1.000')
    expect(out).not.toContain('--adm-k-')
    expect(out).toContain('bg-adm-neutral')
  })
})

// ─── PaperSheet ──────────────────────────────────────────────────────────────

describe('PaperSheet: una hoja de papel', () => {
  it('es un documento con nombre: el membrete', () => {
    const out = html(
      <PaperSheet title="Datos de la SAS" aside="como en la constancia">
        <p>CUIT</p>
      </PaperSheet>,
    )
    const title = /<p id="([^"]+)"[^>]*>Datos de la SAS<\/p>/.exec(out)
    expect(title).not.toBeNull()
    expect(out).toMatch(new RegExp(`^<article [^>]*aria-labelledby="${title?.[1]}"`))
    expect(text(out)).toBe('Datos de la SAS como en la constancia CUIT')
  })

  it('`aria-label` manda sobre el membrete', () => {
    const out = html(
      <PaperSheet title="Factura B" aria-label="Así va a quedar la factura">
        <p>Total</p>
      </PaperSheet>,
    )
    expect(out).toMatch(/^<article [^>]*aria-label="Así va a quedar la factura"/)
    expect(out).not.toContain('aria-labelledby')
  })

  it('sin membrete es solo la hoja', () => {
    const out = html(
      <PaperSheet size="sm">
        <p>0003-00001234</p>
      </PaperSheet>,
    )
    expect(out).not.toContain('<header')
    expect(text(out)).toBe('0003-00001234')
  })

  it('es papel: claro también en modo oscuro, con la tinta del ticket', () => {
    const out = html(
      <PaperSheet title="Factura B">
        <p>Total</p>
      </PaperSheet>,
    )
    expect(out).toContain('force-light')
    expect(out).toContain('--foreground:var(--adm-paper-ink)')
    expect(out).toContain('--border:var(--adm-paper-rule)')
  })

  it('adentro valen las piezas del ticket', () => {
    const out = html(
      <PaperSheet title="Factura B">
        <TicketLabel>Detalle</TicketLabel>
        <TicketRow label="Neto" value={formatCents(1_000_000)} />
        <TicketStamp tone="factura">Con factura B</TicketStamp>
      </PaperSheet>,
    )
    expect(text(out)).toBe('Factura B Detalle Neto $ 10.000,00 Con factura B')
  })
})

// ─── Ticket: lo que se sumó ──────────────────────────────────────────────────

describe('TicketStamp y TicketLabel', () => {
  const inkOf = (markup: string) => /text-\[color:[^\s"]+/.exec(markup)?.[0]

  it('`ok` sella un acto terminado con la misma tinta verde que «con factura»', () => {
    const ok = html(<TicketStamp tone="ok">Cargado</TicketStamp>)
    const invoice = html(<TicketStamp tone="factura">Con factura A</TicketStamp>)
    const none = html(<TicketStamp tone="sin">Sin factura</TicketStamp>)
    expect(text(ok)).toBe('Cargado')
    expect(inkOf(ok)).toBeDefined()
    expect(inkOf(ok)).toBe(inkOf(invoice))
    expect(inkOf(ok)).not.toBe(inkOf(none))
  })

  it('ningún sello es rojo: «sin factura» no es una alarma', () => {
    for (const tone of ['factura', 'sin', 'ok'] as const) {
      const out = html(<TicketStamp tone={tone}>Sello</TicketStamp>)
      expect(out, tone).not.toContain('destructive')
    }
  })

  it('el sello no se anima si nadie lo pide', () => {
    expect(html(<TicketStamp tone="ok">Cerrado</TicketStamp>)).not.toContain('adm-stamp-in')
    expect(
      html(
        <TicketStamp tone="ok" animate>
          Cerrado
        </TicketStamp>,
      ),
    ).toContain('adm-stamp-in')
  })

  it('`TicketLabel` es el rótulo de un bloque del papel', () => {
    const out = html(<TicketLabel className="mt-3">Cuándo entra</TicketLabel>)
    expect(out).toMatch(/^<p class="[^"]*mt-3[^"]*">Cuándo entra<\/p>$/)
  })
})

// ─── PanelError, PanelLink, RetryButton ──────────────────────────────────────

describe('el bloque que no cargó', () => {
  const SLOW = 'Tardó demasiado. Probá de nuevo o con un período más corto.'

  it('conserva su título, dice por qué y ofrece reintentar', () => {
    const out = html(<PanelError title="Entró y salió" message="Sin conexión: probá de nuevo." />)
    expect(out).toMatch(/<h2[^>]*>Entró y salió<\/h2>/)
    expect(out).toMatch(/<p role="alert"[^>]*>Sin conexión: probá de nuevo\.<\/p>/)
    expect(out).toMatch(/<button[^>]*type="button"[^>]*>.*Reintentar<\/button>/)
    expect(text(out)).toBe('Entró y salió Sin conexión: probá de nuevo. Reintentar')
  })

  it('el botón puede decir otra cosa', () => {
    const out = html(
      <PanelError title="Movimientos" message="No pudimos leerlos." retryLabel="Volver a cargar" />,
    )
    expect(text(out)).toBe('Movimientos No pudimos leerlos. Volver a cargar')
    expect(out).not.toContain('Reintentar')
  })

  it('el del kit dice el motivo tal cual; el del Resumen saca lo del período', () => {
    expect(text(html(<PanelError title="Cajas" message={SLOW} />))).toContain(
      'o con un período más corto',
    )
    const home = html(<HomePanelError title="Cajas" message={SLOW} />)
    expect(text(home)).toBe('Cajas Tardó demasiado. Probá de nuevo. Reintentar')
  })

  it('el Resumen y el kit usan el mismo «Reintentar»', () => {
    expect(HomeRetryButton).toBe(RetryButton)
    expect(text(html(<RetryButton />))).toBe('Reintentar')
    expect(text(html(<RetryButton label="Probar de nuevo" />))).toBe('Probar de nuevo')
  })

  it('`PanelLink` es un link de verdad', () => {
    const out = html(<PanelLink href={`${BASE}/cajas`}>Ver cajas</PanelLink>)
    expect(out).toMatch(/^<a [^>]*href="\/hub\/administracion\/cajas"[^>]*>Ver cajas<\/a>$/)
  })
})

// ─── TreasuryPicker ──────────────────────────────────────────────────────────

describe('TreasuryPicker: elegir una caja', () => {
  const treasury = (n: number, over: Partial<TreasuryOption> = {}): TreasuryOption => ({
    id: `t${n}`,
    name: `Caja ${n}`,
    kind: 'cash',
    balanceCents: n * 10_000_000,
    ...over,
  })
  const two = [treasury(1, { name: 'Caja' }), treasury(2, { name: 'Mercado Pago', kind: 'wallet' })]
  const six = [1, 2, 3, 4, 5, 6].map((n) => treasury(n))
  const noop = () => {}
  const radios = (markup: string) =>
    [...markup.matchAll(/<button[^>]*role="radio"[^>]*>(.*?)<\/button>/g)].map((m) => ({
      tag: m[0],
      text: text(m[1] ?? ''),
    }))

  it('con dos cajas son dos píldoras a la vista, cada una con su nombre y lo que tiene', () => {
    const out = html(
      <TreasuryPicker
        value={null}
        onValueChange={noop}
        treasuries={two}
        aria-labelledby="pregunta"
      />,
    )
    expect(out).toMatch(/role="radiogroup"[^>]*aria-labelledby="pregunta"/)
    const chips = radios(out)
    expect(chips).toHaveLength(2)
    expect(chips[0]?.text).toMatch(/^Caja \$ 100\.000/)
    expect(chips[1]?.text).toMatch(/^Mercado Pago \$ 200\.000/)
    // Ninguna elegida todavía, y no hay desplegable.
    expect(count(out, 'aria-checked="true"')).toBe(0)
    expect(out).not.toContain('role="combobox"')
  })

  it('la elegida queda marcada, y es la parada de Tab del grupo', () => {
    const out = html(<TreasuryPicker value="t2" onValueChange={noop} treasuries={two} />)
    const chips = radios(out)
    expect(chips.map((c) => /aria-checked="true"/.test(c.tag))).toEqual([false, true])
    expect(chips.map((c) => /tabindex="0"/.test(c.tag))).toEqual([false, true])
  })

  it('con seis cajas cae al desplegable de siempre', () => {
    const out = html(<TreasuryPicker value={null} onValueChange={noop} treasuries={six} />)
    expect(out).toContain('role="combobox"')
    expect(out).not.toContain('role="radiogroup"')
    expect(radios(out)).toEqual([])
  })

  it('`max` corre el límite', () => {
    const out = html(<TreasuryPicker value={null} onValueChange={noop} treasuries={six} max={6} />)
    expect(radios(out)).toHaveLength(6)
    expect(out).not.toContain('role="combobox"')
  })

  it('la sugerida lo dice («Te sugiero») pero no se elige sola', () => {
    const out = html(
      <TreasuryPicker value={null} onValueChange={noop} treasuries={two} suggestedId="t2" />,
    )
    const chips = radios(out)
    expect(chips[0]?.text).toMatch(/^Caja \$ 100\.000/)
    expect(chips[1]?.text).toMatch(/^Te sugiero Mercado Pago \$ 200\.000/)
    expect(chips[1]?.tag).toMatch(/aria-label="Mercado Pago, [^"]*, sugerida"/)
    expect(chips[0]?.tag).not.toContain('sugerida')
    // Una píldora rellena es algo que la persona tocó: la sugerida no lo es.
    expect(count(out, 'aria-checked="true"')).toBe(0)
    expect(count(out, 'Te sugiero')).toBe(1)
  })

  it('una sugerida que no está entre las cajas no dibuja nada, y en el desplegable se ignora', () => {
    const pills = html(
      <TreasuryPicker value={null} onValueChange={noop} treasuries={two} suggestedId="no-existe" />,
    )
    expect(pills).not.toContain('Te sugiero')
    const select = html(
      <TreasuryPicker value={null} onValueChange={noop} treasuries={six} suggestedId="t2" />,
    )
    expect(select).toContain('role="combobox"')
    expect(select).not.toContain('Te sugiero')
    expect(select).not.toContain('suggestedid')
  })

  it('el grupo se puede enfocar por código (ir al primer campo con error) sin sumar una parada de Tab', () => {
    const out = html(<TreasuryPicker value={null} onValueChange={noop} treasuries={two} invalid />)
    expect(out).toMatch(/role="radiogroup"[^>]*tabindex="-1"[^>]*aria-invalid="true"/)
  })

  it('las que no se usan y las tarjetas que no valen no cuentan', () => {
    const list = [
      ...two,
      treasury(3, { name: 'Visa', kind: 'credit_card' }),
      treasury(4, { active: false }),
      treasury(5, { active: false }),
      treasury(6, { active: false }),
    ]
    const out = html(
      <TreasuryPicker value={null} onValueChange={noop} treasuries={list} excludeCards />,
    )
    expect(radios(out).map((c) => c.text.split(' $')[0])).toEqual(['Caja', 'Mercado Pago'])
  })
})

// ─── CategoryPicker ──────────────────────────────────────────────────────────

describe('CategoryPicker: «¿En qué se gastó?»', () => {
  const PLAN = STANDARD_CHART.map((a) => ({
    id: a.code,
    code: a.code,
    name: a.name,
    type: a.type,
    postable: a.postable,
    active: true,
    requiresParty: a.requiresParty,
    isTreasury: false,
    purchaseSelectable: a.purchaseSelectable,
    systemKey: a.systemKey,
  }))
  const quick = new Set(PLAN.filter(isQuickExpenseAccount).map((a) => a.id))
  const options = categoryOptions(PLAN, (id) => quick.has(id))
  const featured = featuredCategories(PLAN)
  // Hay grupos que se llaman igual que su única cuenta («Seguros»): acá va la cuenta.
  const idOf = (name: string) => PLAN.find((a) => a.postable && a.name === name)?.id ?? ''
  const RENT = idOf('Alquiler')
  const ALCOHOL = idOf('Compras: bebidas con alcohol')
  const INSURANCE = idOf('Seguros')
  const noop = () => {}

  /** Los rótulos de las filas, en el orden en que salen. */
  const rows = (markup: string) =>
    [...markup.matchAll(/<legend[^>]*>([^<]+)<\/legend>/g)].map((m) => m[1])
  const pressed = (markup: string) =>
    [...markup.matchAll(/<button[^>]*aria-pressed="true"[^>]*>(.*?)<\/button>/g)].map((m) =>
      text(m[1] ?? ''),
    )

  it('las filas van de lo más probable a lo menos', () => {
    const out = html(
      <CategoryPicker
        options={options}
        value={null}
        onChange={noop}
        featured={featured}
        pinned={[RENT]}
        suggestedId={idOf('Internet')}
      />,
    )
    expect(rows(out)).toEqual(['Sugerida', 'Mercadería', 'Las que más usás', 'Otra cosa'])
  })

  it('la mercadería va con nombre corto y no se repite en «Otra cosa»', () => {
    const out = html(
      <CategoryPicker options={options} value={null} onChange={noop} featured={featured} />,
    )
    expect(rows(out)).toEqual(['Mercadería', 'Otra cosa'])
    expect(out).toContain('>Bebidas con alcohol<')
    expect(out).not.toContain('>Compras: bebidas con alcohol<')
    expect(count(out, '>Bebidas con alcohol<')).toBe(1)
    // Sus dos grupos quedan vacíos y no se ofrecen.
    expect(out).not.toContain('>Alimentos y bebidas<')
    expect(out).not.toContain('>Insumos y descartables<')
  })

  it('«Otra cosa» ofrece los grupos del plan, cerrados, con los equipos al final', () => {
    const out = html(
      <CategoryPicker options={options} value={null} onChange={noop} featured={featured} />,
    )
    const groups = [...out.matchAll(/<button[^>]*aria-expanded="false"[^>]*>(.*?)<\/button>/g)].map(
      (m) => text(m[1] ?? ''),
    )
    expect(groups).toEqual([
      'Personal',
      'Impuestos, tasas y contribuciones',
      'Gastos del local',
      'Comisiones y costos de cobro',
      'Honorarios',
      'Gastos bancarios y financieros',
      'Equipos y muebles',
    ])
    expect(out).not.toContain('aria-expanded="true"')
    // Cerrados: sus categorías no están a la vista.
    expect(out).not.toContain('>Alquiler<')
  })

  it('un grupo con una sola categoría de su mismo nombre es un chip directo', () => {
    const out = html(<CategoryPicker options={options} value={INSURANCE} onChange={noop} />)
    expect(pressed(out)).toEqual(['Seguros'])
    expect(out).not.toMatch(/<button[^>]*aria-expanded[^>]*>(?:(?!<\/button>).)*Seguros/)
  })

  it('la elegida va marcada, y debajo su nombre contable', () => {
    const out = html(
      <CategoryPicker options={options} value={ALCOHOL} onChange={noop} featured={featured} />,
    )
    expect(pressed(out)).toEqual(['Bebidas con alcohol'])
    expect(text(out)).toContain('En los libros va a «Compras: bebidas con alcohol».')
  })

  it('si la elegida está adentro de un grupo, ese grupo arranca abierto', () => {
    const out = html(
      <CategoryPicker options={options} value={RENT} onChange={noop} featured={featured} />,
    )
    const open =
      /<button[^>]*aria-expanded="true"[^>]*aria-controls="([^"]+)"[^>]*>(.*?)<\/button>/.exec(out)
    expect(text(open?.[2] ?? '')).toBe('Gastos del local')
    expect(out).toContain(`<fieldset id="${open?.[1]}" aria-label="Gastos del local"`)
    expect(pressed(out)).toEqual(['Alquiler'])
    expect(count(out, 'aria-expanded="true"')).toBe(1)
  })

  it('si la elegida ya está a la vista arriba, no abre ningún grupo', () => {
    const out = html(
      <CategoryPicker
        options={options}
        value={RENT}
        onChange={noop}
        featured={featured}
        pinned={[RENT]}
      />,
    )
    expect(out).not.toContain('aria-expanded="true"')
    expect(pressed(out)).toEqual(['Alquiler'])
  })

  it('«Las que más usás» no repite la mercadería ni la sugerida', () => {
    const out = html(
      <CategoryPicker
        options={options}
        value={null}
        onChange={noop}
        featured={featured}
        pinned={[ALCOHOL, RENT, INSURANCE]}
        suggestedId={INSURANCE}
      />,
    )
    const fieldsets = out.split('<fieldset')
    const pinnedRow = fieldsets.find((f) => f.includes('>Las que más usás</legend>')) ?? ''
    expect(text(pinnedRow.slice(pinnedRow.indexOf('</legend>')))).toBe('Alquiler')
  })

  it('un id que no es una categoría elegible no dibuja nada', () => {
    const out = html(
      <CategoryPicker
        options={options}
        value="no-existe"
        onChange={noop}
        featured={['no-existe', ...featured]}
        pinned={['tampoco']}
        suggestedId="menos"
      />,
    )
    expect(rows(out)).toEqual(['Mercadería', 'Otra cosa'])
    expect(pressed(out)).toEqual([])
    expect(out).not.toContain('En los libros va a')
  })

  it('si la sugerida es mercadería, se marca en su fila y no sale dos veces', () => {
    const out = html(
      <CategoryPicker
        options={options}
        value={ALCOHOL}
        onChange={noop}
        featured={featured}
        suggestedId={ALCOHOL}
      />,
    )
    // Sin fila «Sugerida»: el chip ya está en «Mercadería».
    expect(rows(out)).toEqual(['Mercadería', 'Otra cosa'])
    expect(count(out, '>Bebidas con alcohol<')).toBe(1)
    // Una sola elegida, y para lectores dice que es la sugerida.
    expect(pressed(out)).toEqual(['Sugerida: Bebidas con alcohol'])
    expect(out).toMatch(
      /<span class="sr-only">Sugerida: <\/span><span[^>]*>Bebidas con alcohol<\/span>/,
    )
    // Sin elegir, lleva la chispa (que no se lee) en vez del tilde.
    const idle = html(
      <CategoryPicker
        options={options}
        value={null}
        onChange={noop}
        featured={featured}
        suggestedId={ALCOHOL}
      />,
    )
    expect(rows(idle)).toEqual(['Mercadería', 'Otra cosa'])
    expect(count(idle, 'Sugerida: ')).toBe(1)
    expect(pressed(idle)).toEqual([])
  })

  it('un chip directo que ya está arriba no se repite en «Otra cosa»', () => {
    const out = html(
      <CategoryPicker
        options={options}
        value={INSURANCE}
        onChange={noop}
        featured={featured}
        pinned={[INSURANCE]}
      />,
    )
    expect(count(out, '>Seguros<')).toBe(1)
    expect(pressed(out)).toEqual(['Seguros'])
    // Sugerida (que no es mercadería): va en su fila y tampoco se repite abajo.
    const suggested = html(
      <CategoryPicker
        options={options}
        value={INSURANCE}
        onChange={noop}
        featured={featured}
        suggestedId={INSURANCE}
      />,
    )
    expect(rows(suggested)).toEqual(['Sugerida', 'Mercadería', 'Otra cosa'])
    expect(count(suggested, '>Seguros<')).toBe(1)
    expect(pressed(suggested)).toEqual(['Seguros'])
  })

  it('una elegida que no es un chip (`outside`) se ve arriba, rellena, con su nombre contable', () => {
    const OUTSIDE = { id: 'cuenta-rara', name: 'Compras: repuestos de máquinas' }
    const out = html(
      <CategoryPicker
        options={options}
        value={OUTSIDE.id}
        onChange={noop}
        featured={featured}
        outside={OUTSIDE}
      />,
    )
    expect(rows(out)).toEqual(['Elegida', 'Mercadería', 'Otra cosa'])
    // Nombre corto en el chip (sin «Compras: »), el contable entero debajo.
    expect(pressed(out)).toEqual(['Repuestos de máquinas'])
    expect(out).toMatch(/<button[^>]*data-category-chip=""[^>]*aria-pressed="true"/)
    expect(text(out)).toContain('En los libros va a «Compras: repuestos de máquinas».')
    expect(out).not.toContain('aria-expanded="true"')
  })

  it('`outside` no se dibuja si no es la elegida, ni si la elegida ya es una opción', () => {
    const OUTSIDE = { id: 'cuenta-rara', name: 'Compras: repuestos de máquinas' }
    const other = html(
      <CategoryPicker options={options} value={RENT} onChange={noop} outside={OUTSIDE} />,
    )
    expect(rows(other)).not.toContain('Elegida')
    expect(pressed(other)).toEqual(['Alquiler'])
    const none = html(
      <CategoryPicker options={options} value={null} onChange={noop} outside={OUTSIDE} />,
    )
    expect(rows(none)).not.toContain('Elegida')
    expect(none).not.toContain('En los libros va a')
    // Una opción de verdad gana: el chip es el de siempre, en su lugar.
    const real = html(
      <CategoryPicker
        options={options}
        value={RENT}
        onChange={noop}
        outside={{ id: RENT, name: 'Otro nombre' }}
      />,
    )
    expect(rows(real)).not.toContain('Elegida')
    expect(text(real)).toContain('En los libros va a «Alquiler».')
  })

  it('con error, el grupo se deja enfocar por código y no suma una parada de Tab', () => {
    const out = html(
      <CategoryPicker options={options} value={null} onChange={noop} featured={featured} invalid />,
    )
    // `querySelector('[aria-invalid="true"]')?.focus()` lo encuentra y `.focus()` anda.
    expect(out).toMatch(/^<fieldset [^>]*aria-invalid="true"[^>]*tabindex="-1"/)
    expect(count(out, 'aria-invalid="true"')).toBe(1)
    // Los chips, que es adonde pasa el foco, son los primeros controles del grupo.
    expect(out).toMatch(/data-category-chip=""/)
    expect(html(<CategoryPicker options={options} value={null} onChange={noop} />)).toMatch(
      /^<fieldset [^>]*tabindex="-1"/,
    )
  })

  it('«Ver el plan completo» solo aparece si alguien lo atiende', () => {
    const without = html(<CategoryPicker options={options} value={null} onChange={noop} />)
    const withPlan = html(
      <CategoryPicker options={options} value={null} onChange={noop} onOpenFullPlan={noop} />,
    )
    expect(without).not.toContain('Ver el plan completo')
    expect(withPlan).toMatch(/<button[^>]*type="button"[^>]*>Ver el plan completo<\/button>/)
  })

  it('toma el nombre de la pregunta visible; sin ella, uno propio', () => {
    const labelled = html(
      <CategoryPicker
        options={options}
        value={null}
        onChange={noop}
        id="cat"
        aria-labelledby="pregunta"
      />,
    )
    expect(labelled).toMatch(/^<fieldset id="cat" aria-labelledby="pregunta"/)
    expect(labelled).not.toMatch(/^<fieldset[^>]*aria-label=/)
    const alone = html(<CategoryPicker options={options} value={null} onChange={noop} />)
    expect(alone).toMatch(/^<fieldset [^>]*aria-label="Categoría"/)
  })

  it('sin la mercadería ni las más usadas, la fila se llama «Categorías»', () => {
    const out = html(<CategoryPicker options={options} value={null} onChange={noop} />)
    expect(rows(out)).toEqual(['Categorías'])
  })

  it('sin categorías lo dice, y deja el camino al plan completo', () => {
    const out = html(
      <CategoryPicker options={[]} value={null} onChange={noop} onOpenFullPlan={noop} />,
    )
    expect(text(out)).toBe('Todavía no hay categorías para elegir. Ver el plan completo')
    expect(rows(out)).toEqual([])
  })

  it('todo lo que se toca es un botón que no manda el formulario', () => {
    const out = html(
      <CategoryPicker
        options={options}
        value={RENT}
        onChange={noop}
        featured={featured}
        onOpenFullPlan={noop}
      />,
    )
    const buttons = [...out.matchAll(/<button[^>]*>/g)].map((m) => m[0])
    expect(buttons.length).toBeGreaterThan(10)
    for (const button of buttons) expect(button).toContain('type="button"')
  })
})
