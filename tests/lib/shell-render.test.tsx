// @vitest-environment node
import { createElement as h, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ManagerError from '@/app/(manager)/[tenantSlug]/error'
import Loading from '@/app/(manager)/[tenantSlug]/loading'
import ManagerNotFound from '@/app/(manager)/[tenantSlug]/not-found'
import { ShellFrame } from '@/components/shell/shell-frame'
import { ShellInfoProvider } from '@/components/shell/shell-info'
import { SidebarContent } from '@/components/shell/sidebar-content'
import { SidebarProvider } from '@/components/shell/sidebar-state'
import { Topbar } from '@/components/shell/topbar'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getTenantFeatures, type TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess, TenantRole } from '@/lib/tenant/types'

/**
 * Shell del panel (kit §4) en el HTML del server: lo que un lector de
 * pantalla y el teclado encuentran al cargar. Plegado = `inert`, «estás acá»
 * con `aria-current` y su barra, foco «adentro» en los botones del menú,
 * filas de 44 px en el cajón, el topbar sin vidrio y con ⌘K también en el
 * celular, y los textos del error y del 404 del workspace.
 */

const nav = vi.hoisted(() => ({ pathname: '/hub', search: '' }))
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>()
  return {
    ...actual,
    usePathname: () => nav.pathname,
    useSearchParams: () => new URLSearchParams(nav.search),
    useParams: () => ({ tenantSlug: 'hub' }),
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    }),
  }
})
// El ThemeProvider importa la Server Action del tema: acá no hace falta.
vi.mock('@/lib/theme/actions', () => ({ setThemePreferenceAction: vi.fn() }))

const render = (el: ReactElement) => renderToStaticMarkup(el)

/** React escapa `& < > " '` en los atributos: se vuelven a leer como en el DOM. */
function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

type Tag = { name: string; attrs: Record<string, string>; inner: string }

/** Cada elemento `<name …>…</name>` (sin anidar el mismo tag) con sus atributos y su texto. */
function elements(html: string, name: string): Tag[] {
  const re = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g')
  return [...html.matchAll(re)].map((m) => ({
    name,
    attrs: Object.fromEntries(
      [...(m[1] ?? '').matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(([, k, v]) => [
        k ?? '',
        decode(v ?? ''),
      ]),
    ),
    inner: m[2] ?? '',
  }))
}

const textOf = (markup: string) => decode(markup.replace(/<[^>]+>/g, '')).trim()
const classes = (tag: Tag | undefined) => new Set((tag?.attrs.class ?? '').split(/\s+/))
const byText = (tags: Tag[], text: string) => tags.find((t) => textOf(t.inner).startsWith(text))

/** El elemento con ese id, como etiqueta de apertura con sus atributos. */
function attrsById(html: string, id: string): Record<string, string> | null {
  const open = [...html.matchAll(/<[a-z]+\s[^>]*>/g)].find((m) => m[0].includes(` id="${id}"`))
  if (!open) return null
  return Object.fromEntries(
    [...open[0].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)]
      .slice(1)
      .map(([, k, v]) => [k ?? '', decode(v ?? '')]),
  )
}

const tenant = { id: 't1', name: 'HUB', slug: 'hub', logo_url: null }
const accountingOn: TenantFeatures = {
  ...getTenantFeatures({ feature_flags: {} }),
  accounting: true,
}
const readOnly: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: true,
  write: false,
  admin: false,
  canSetUp: false,
}

function sidebar(role: TenantRole, opts: { touch?: boolean; accounting?: AccountingAccess } = {}) {
  return render(
    h(SidebarContent, {
      tenant,
      role,
      features: accountingOn,
      isPlatformAdmin: false,
      accounting: opts.accounting,
      touch: opts.touch,
    }),
  )
}

beforeEach(() => {
  nav.pathname = '/hub'
  nav.search = ''
})

describe('SidebarContent — la contadora', () => {
  it('el logo la lleva a Administración y el pie dice su rol en minúscula normal', () => {
    nav.pathname = '/hub/administracion/libros'
    const html = sidebar('accountant', { accounting: readOnly })
    const logo = elements(html, 'a').find((a) => a.attrs['aria-label'] === 'Ir al inicio de HUB')
    expect(logo?.attrs.href).toBe('/hub/administracion')
    expect(html).toContain('aria-label="Navegación principal"')
    expect(html).toContain('Contabilidad')
    expect(html).not.toContain('uppercase')
    expect(html).not.toContain('Configuración')
  })

  it('«Libros» es el lugar actual: aria-current, fondo elegido y la barra de 2 px', () => {
    nav.pathname = '/hub/administracion/libros'
    const html = sidebar('accountant', { accounting: readOnly })
    const links = elements(html, 'a')
    const libros = byText(links, 'Libros')
    expect(libros?.attrs['aria-current']).toBe('page')
    expect(classes(libros).has('bg-selected')).toBe(true)
    expect(libros?.inner).toContain('forced-colors:bg-[Highlight]')
    // El Resumen es exacto: no se prende en una sub-ruta.
    expect(byText(links, 'Resumen')?.attrs['aria-current']).toBeUndefined()
    expect(html.match(/forced-colors:bg-\[Highlight\]/g)?.length).toBe(1)
  })

  it('el título del grupo es la única mayúscula espaciada (type-group) y rotula la lista', () => {
    const html = sidebar('accountant', { accounting: readOnly })
    const heading = html.match(/<div id="([^"]+)" class="([^"]*)">([^<]*)<\/div>/)
    expect(heading?.[3]).toBe('Administración')
    expect(heading?.[2]?.split(' ')).toContain('type-group')
    const list = elements(html, 'ul').find((u) => u.attrs['aria-labelledby'] === heading?.[1])
    expect(list).toBeDefined()
  })
})

describe('SidebarContent — el dueño', () => {
  it('el logo lleva al Resumen del dueño', () => {
    const html = sidebar('owner')
    const logo = elements(html, 'a').find((a) => a.attrs['aria-label'] === 'Ir al inicio de HUB')
    expect(logo?.attrs.href).toBe('/hub')
  })

  it('un grupo plegado es inert y su botón dice qué controla', () => {
    const html = sidebar('owner')
    const agenda = byText(elements(html, 'button'), 'Agenda')
    expect(agenda?.attrs['aria-expanded']).toBe('false')
    const content = attrsById(html, agenda?.attrs['aria-controls'] ?? '')
    expect(content).not.toBeNull()
    expect(content).toHaveProperty('inert')
  })

  it('el grupo de la página abierta arranca abierto y sin inert', () => {
    nav.pathname = '/hub/reservas'
    const html = sidebar('owner')
    const agenda = byText(elements(html, 'button'), 'Agenda')
    expect(agenda?.attrs['aria-expanded']).toBe('true')
    const content = attrsById(html, agenda?.attrs['aria-controls'] ?? '')
    expect(content).not.toHaveProperty('inert')
  })

  it('un hijo activo abre a su padre y le apaga el resaltado', () => {
    nav.pathname = '/hub/estadisticas/senas'
    const html = sidebar('owner')
    const links = elements(html, 'a')
    expect(byText(links, 'Señas')?.attrs['aria-current']).toBe('page')
    expect(byText(links, 'Estadísticas')?.attrs['aria-current']).toBeUndefined()
    const expander = elements(html, 'button').find(
      (b) => b.attrs['aria-label'] === 'Subpáginas de Estadísticas',
    )
    expect(expander?.attrs['aria-expanded']).toBe('true')
    expect(attrsById(html, expander?.attrs['aria-controls'] ?? '')).not.toHaveProperty('hidden')
  })

  it('un padre cerrado esconde a sus hijos del Tab y del lector (hidden)', () => {
    const html = sidebar('owner')
    const expander = elements(html, 'button').find(
      (b) => b.attrs['aria-label'] === 'Subpáginas de Estadísticas',
    )
    expect(expander?.attrs['aria-expanded']).toBe('false')
    expect(attrsById(html, expander?.attrs['aria-controls'] ?? '')).toHaveProperty('hidden')
  })

  it('los links a otra pestaña son <a> comunes, avisan que abren otra pestaña y no se mueven', () => {
    const html = sidebar('owner')
    const verCarta = byText(elements(html, 'a'), 'Ver carta')
    expect(verCarta?.attrs.href).toBe('/carta/hub')
    expect(verCarta?.attrs.target).toBe('_blank')
    expect(verCarta?.attrs.rel).toBe('noopener noreferrer')
    expect(textOf(verCarta?.inner ?? '')).toContain(', abre en otra pestaña')
    expect(verCarta?.inner).not.toContain('translate')
  })

  it('todos los botones del menú tienen foco visible «adentro»', () => {
    const html = sidebar('owner')
    const buttons = elements(html, 'button')
    expect(buttons.length).toBeGreaterThan(3)
    for (const button of buttons) {
      expect(classes(button).has('focus-visible:outline-2')).toBe(true)
      expect(classes(button).has('-outline-offset-2')).toBe(true)
    }
  })
})

describe('SidebarContent — cajón del celular', () => {
  it('todas las filas miden 44 px', () => {
    const html = sidebar('owner', { touch: true })
    const rows = [...elements(html, 'a'), ...elements(html, 'button')].filter(
      (t) => t.attrs['aria-label'] !== 'Ir al inicio de HUB',
    )
    expect(rows.length).toBeGreaterThan(5)
    for (const row of rows) {
      const c = classes(row)
      expect(c.has('min-h-11') || c.has('size-11')).toBe(true)
    }
  })
})

describe('ShellFrame', () => {
  it('plegado: el menú lateral es inert (fuera de Tab y del árbol accesible)', () => {
    const html = render(
      <SidebarProvider initialCollapsed>
        <ShellFrame sidebar="menú">página</ShellFrame>
      </SidebarProvider>,
    )
    const aside = elements(html, 'aside')[0]
    expect(aside?.attrs.id).toBe('menu-lateral')
    expect(aside?.attrs).toHaveProperty('inert')
    expect(aside?.attrs['aria-hidden']).toBeUndefined()
    expect(html).toContain('lg:pl-0')
  })

  it('abierto: 256 px de menú y el contenido corrido lo mismo', () => {
    const html = render(
      <SidebarProvider initialCollapsed={false}>
        <ShellFrame sidebar="menú">página</ShellFrame>
      </SidebarProvider>,
    )
    const aside = elements(html, 'aside')[0]
    expect(aside?.attrs).not.toHaveProperty('inert')
    expect(classes(aside).has('w-(--sidebar-w)')).toBe(true)
    expect(classes(aside).has('bg-surface')).toBe(true)
    expect(html).toContain('lg:pl-(--sidebar-w)')
    expect(html).not.toContain('backdrop-blur')
  })
})

describe('Topbar', () => {
  // `role` es el rol del bar, no un rol ARIA: en una variable para que el lint no lo confunda.
  const owner: TenantRole = 'owner'
  const topbar = () =>
    render(
      <ThemeProvider initialPreference="auto">
        <TooltipProvider>
          <SidebarProvider initialCollapsed={false}>
            <Topbar
              tenant={tenant}
              role={owner}
              features={accountingOn}
              isPlatformAdmin={false}
              accounting={readOnly}
              email="franco@hub.bar"
            />
          </SidebarProvider>
        </TooltipProvider>
      </ThemeProvider>,
    )

  it('papel sólido con un pelo, a la altura del token y sin vidrio', () => {
    const header = elements(topbar(), 'header')[0]
    const c = classes(header)
    expect(c.has('h-(--topbar-h)')).toBe(true)
    expect(c.has('bg-background')).toBe(true)
    expect(c.has('border-b')).toBe(true)
    expect(header?.inner).not.toContain('backdrop-blur')
  })

  it('los dos botones de menú dicen qué controlan', () => {
    const buttons = elements(topbar(), 'button')
    const drawer = buttons.find((b) => b.attrs['aria-label'] === 'Abrir menú')
    expect(drawer?.attrs['aria-expanded']).toBe('false')
    expect(classes(drawer).has('lg:hidden')).toBe(true)
    const collapse = buttons.find((b) => b.attrs['aria-label'] === 'Ocultar menú')
    expect(collapse?.attrs['aria-expanded']).toBe('true')
    expect(collapse?.attrs['aria-controls']).toBe('menu-lateral')
  })

  it('⌘K: lupa en el celular y campo desde md, sin prometer clientes', () => {
    const html = topbar()
    const buttons = elements(html, 'button')
    const loupe = buttons.find((b) => b.attrs['aria-label'] === 'Buscar o ir a…')
    expect(classes(loupe).has('md:hidden')).toBe(true)
    expect(loupe?.attrs['aria-keyshortcuts']).toBe('Meta+K Control+K')
    const field = buttons.find((b) => textOf(b.inner).startsWith('Buscar o ir a…'))
    expect(classes(field).has('md:flex')).toBe(true)
    expect(field?.attrs['aria-keyshortcuts']).toBe('Meta+K Control+K')
    expect(html).not.toMatch(/clientes/i)
  })

  it('a la derecha, solo el menú de la cuenta (el tema está adentro)', () => {
    const html = topbar()
    const account = elements(html, 'button').find(
      (b) => b.attrs['aria-label'] === 'Menú de usuario',
    )
    expect(account?.attrs['aria-haspopup']).toBe('menu')
    expect(html).not.toContain('Tema actual')
  })
})

describe('error, 404 y carga del workspace', () => {
  const inShell = (el: ReactElement) =>
    render(
      <ShellInfoProvider tenantSlug="hub" homeHref="/hub/administracion">
        {el}
      </ShellInfoProvider>,
    )

  it('el 404 es un estado vacío con su h1 y dos salidas, al inicio de quien mira', () => {
    const html = inShell(h(ManagerNotFound))
    const title = elements(html, 'h1')[0]
    expect(textOf(title?.inner ?? '')).toBe('No encontramos esta página')
    expect(html).toContain('Puede que el link esté viejo o que no tengas acceso.')
    const home = byText(elements(html, 'a'), 'Ir al Resumen')
    expect(home?.attrs.href).toBe('/hub/administracion')
    expect(byText(elements(html, 'button'), 'Volver')).toBeDefined()
  })

  it('el error dice qué pasó, muestra el código y nunca el mensaje', () => {
    const error = Object.assign(new Error('datos de alguien'), { digest: '3f2a9c71b0d4' })
    const html = inShell(h(ManagerError, { error, reset: vi.fn() }))
    expect(textOf(elements(html, 'h1')[0]?.inner ?? '')).toBe('Algo se rompió en esta pantalla')
    expect(html).toContain(
      'No es tu culpa. Probá de nuevo; si sigue pasando, avisanos con este código.',
    )
    expect(textOf(html)).toContain('Código: 3f2a9c71…')
    expect(html).not.toContain('datos de alguien')
    expect(byText(elements(html, 'a'), 'Ir al Resumen')?.attrs.href).toBe('/hub/administracion')
    expect(byText(elements(html, 'button'), 'Reintentar')).toBeDefined()
  })

  it('sin código, no pide «este código»', () => {
    const html = inShell(h(ManagerError, { error: new Error('x'), reset: vi.fn() }))
    expect(html).toContain('No es tu culpa. Probá de nuevo; si sigue pasando, avisanos.')
    expect(html).not.toContain('este código')
  })

  it('la carga no trae un <main> propio y avisa una sola vez', () => {
    const html = render(h(Loading))
    expect(html).not.toContain('<main')
    expect(html).toContain('aria-busy="true"')
    expect(html.match(/role="status"/g)?.length).toBe(1)
    expect(html).toContain('data-slot="skeleton-page-header"')
    expect(html).toContain('data-slot="skeleton-kpi-group"')
  })
})
