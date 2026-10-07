'use client'

import {
  BookOpen,
  ChevronDown,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  Receipt,
  Search,
  SunMoon,
  Truck,
  Users,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import type { ResolvedNavGroup } from '@/components/shell/nav-config'
import { SidebarNav } from '@/components/shell/sidebar-nav'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { KbdShortcut } from '@/components/ui/kbd-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CatalogBlock, CatalogFamily } from './catalog-block'
import { useCatalog } from './catalog-provider'

// ─── Menú lateral ────────────────────────────────────────────────────────────

/**
 * Grupos de ejemplo para el `SidebarNav` real. El ítem «Componentes» es esta
 * página (queda activo); los demás son anclas de la misma página, salvo
 * «Documentación», que lleva de verdad.
 */
function sampleNavGroups(basePath: string, tenantSlug: string): ResolvedNavGroup[] {
  return [
    {
      id: 'catalogo-hoy',
      label: 'Hoy',
      items: [
        { label: 'Resumen', href: `${basePath}#sidebar-resumen`, iconKey: 'LayoutDashboard' },
        {
          label: 'Agenda',
          href: `${basePath}#sidebar-agenda`,
          iconKey: 'CalendarDays',
          children: [
            { label: 'Reservas', href: `${basePath}#sidebar-reservas`, iconKey: 'CalendarCheck' },
            { label: 'Eventos', href: `${basePath}#sidebar-eventos`, iconKey: 'PartyPopper' },
          ],
        },
      ],
    },
    {
      id: 'catalogo-administracion',
      label: 'Administración',
      collapsible: true,
      items: [
        { label: 'Proveedores', href: `${basePath}#sidebar-proveedores`, iconKey: 'Truck' },
        { label: 'Comprobantes', href: `${basePath}#sidebar-comprobantes`, iconKey: 'Receipt' },
        { label: 'Cajas y bancos', href: `${basePath}#sidebar-cajas`, iconKey: 'Landmark' },
      ],
    },
    {
      id: 'catalogo-sistema',
      label: 'Sistema',
      items: [
        { label: 'Documentación', href: `/${tenantSlug}/docs`, iconKey: 'BookOpen' },
        { label: 'Componentes', href: basePath, iconKey: 'LayoutGrid', exact: true },
        {
          label: 'Carta pública',
          href: `${basePath}#sidebar-carta`,
          iconKey: 'UtensilsCrossed',
          newTab: true,
        },
      ],
    },
  ]
}

function SidebarDemo() {
  const { basePath, tenantSlug } = useCatalog()
  const groups = React.useMemo(() => sampleNavGroups(basePath, tenantSlug), [basePath, tenantSlug])
  return (
    <div className="flex max-w-72 flex-col overflow-clip rounded-lg border border-border bg-surface text-surface-foreground">
      {/* La fila de marca: mide lo mismo que el topbar y su pelo sigue el del topbar. */}
      <div className="flex h-(--topbar-h) shrink-0 items-center border-b border-border pl-4">
        <span className="font-display text-[22px] leading-none font-semibold text-foreground">
          HUB<span className="text-primary">!</span>
        </span>
      </div>
      <nav aria-label="Menú lateral de ejemplo">
        <React.Suspense fallback={null}>
          <SidebarNav groups={groups} />
        </React.Suspense>
      </nav>
      <div className="border-t border-border px-4 py-3">
        <p className="truncate type-small font-medium text-foreground">Bar de ejemplo</p>
        <p className="mt-0.5 type-caption text-subtle-foreground">Dueño</p>
      </div>
    </div>
  )
}

// ─── Topbar y paleta ─────────────────────────────────────────────────────────

const THEME_OPTIONS = [
  { value: 'auto', label: 'Automático' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
] as const

/** El menú de la cuenta, con la misma forma que el real; acá no cambia el tema ni cierra la sesión. */
function UserMenuReplica() {
  const [theme, setTheme] = React.useState('auto')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menú de usuario"
          className="press relative flex shrink-0 items-center gap-1 rounded-full p-0.5 pr-1.5 text-muted-foreground outline-(--ring) outline-offset-2 hit-area hover:bg-hover hover:text-foreground focus-visible:outline-2 data-[state=open]:bg-hover data-[state=open]:text-foreground"
        >
          <Avatar size="sm">
            <AvatarFallback className="font-semibold">D</AvatarFallback>
          </Avatar>
          <ChevronDown className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5 pt-2 pb-2">
          <span className="truncate type-label text-foreground">duenio@ejemplo.com</span>
          <span className="truncate">Dueño · Bar de ejemplo</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SunMoon aria-hidden="true" />
            Tema
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                {THEME_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuItem>
          <KeyRound aria-hidden="true" />
          Cambiar contraseña
        </DropdownMenuItem>
        <DropdownMenuItem>
          <BookOpen aria-hidden="true" />
          Documentación
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => toast('En el catálogo no se cierra la sesión')}>
          <LogOut aria-hidden="true" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PaletteDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const run = (label: string) => {
    onOpenChange(false)
    toast(`Elegiste «${label}»`)
  }
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar páginas y acciones…" />
      <CommandList>
        <CommandEmpty />
        <CommandGroup heading="Recientes">
          <CommandItem onSelect={() => run('Proveedores')}>
            <Truck aria-hidden="true" />
            Proveedores
            <CommandShortcut>Administración › Proveedores</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Acciones rápidas">
          <CommandItem onSelect={() => run('Nuevo comprobante de compra')}>
            <Receipt aria-hidden="true" />
            Nuevo comprobante de compra
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Ir a">
          <CommandItem onSelect={() => run('Resumen')}>
            <LayoutDashboard aria-hidden="true" />
            Resumen
          </CommandItem>
          <CommandItem onSelect={() => run('Clientes')}>
            <Users aria-hidden="true" />
            Clientes
            <CommandShortcut>Club › Clientes</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <CommandFooter />
    </CommandDialog>
  )
}

function TopbarDemo() {
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  return (
    <>
      <header className="flex h-(--topbar-h) items-center gap-2 rounded-lg border border-border bg-background px-3">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Abrir el menú"
          className="md:hidden"
        >
          <Menu aria-hidden="true" />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Ocultar menú"
              className="max-md:hidden"
            >
              <PanelLeftClose aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Ocultar menú</TooltipContent>
        </Tooltip>
        <div className="flex min-w-0 flex-1 items-center">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Buscar o ir a…"
            className="md:hidden"
            onClick={() => setPaletteOpen(true)}
          >
            <Search aria-hidden="true" />
          </Button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-(--control-md) w-full max-w-md items-center gap-2 rounded-md border border-input bg-card px-3 text-left type-body text-subtle-foreground outline-(--ring) -outline-offset-1 transition-colors duration-(--duration-quick) hover:text-muted-foreground focus-visible:outline-2 md:flex"
          >
            <Search className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Buscar o ir a…</span>
            <KbdShortcut keys={['mod', 'k']} />
          </button>
        </div>
        <UserMenuReplica />
      </header>
      <PaletteDialog open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  )
}

function PaletteDemo() {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Search aria-hidden="true" />
        Abrir la paleta de ejemplo
      </Button>
      <span className="type-small text-muted-foreground">
        La de verdad se abre con <KbdShortcut keys={['mod', 'k']} /> desde cualquier pantalla.
      </span>
      <PaletteDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}

export function ShellFamily() {
  return (
    <CatalogFamily id="shell">
      <CatalogBlock
        id="sidebar"
        purpose="El menú lateral real (`SidebarNav`) con grupos de ejemplo: un solo «estás acá», grupos que se pliegan y links a otra pestaña."
        yes="La navegación entre áreas del panel. En el celular es el mismo contenido en un cajón (`Sheet` izquierda)."
        no="Navegar dentro de una página (`TabsNav`, `SectionNav`)."
        usage={`// components/shell/sidebar-content.tsx
<nav aria-label="Navegación principal">
  <SidebarNav groups={resolveNavGroups(role, slug, features, isPlatformAdmin, accounting)} />
</nav>`}
        a11y={[
          'El activo lleva `aria-current="page"`, fondo `--selected` y una barra de 2 px que se ve en alto contraste.',
          'Los grupos que se pliegan son botones con `aria-expanded`; plegados llevan `inert` (salen del Tab y del lector).',
          'Los links a otra pestaña suman «, abre en otra pestaña» para el lector.',
          'Foco «adentro» en las filas: van pegadas entre sí.',
        ]}
      >
        <SidebarDemo />
      </CatalogBlock>

      <CatalogBlock
        id="topbar"
        purpose="La barra de arriba: papel sólido con un pelo, el menú, ⌘K con aspecto de campo y el menú de la cuenta (con el tema adentro)."
        yes="Una sola vez, en el shell. Acá es una réplica: el menú de la cuenta no cambia el tema ni cierra la sesión."
        no="Sumarle íconos: el tema vive en el menú de la cuenta y el catálogo se abre desde Documentación y ⌘K."
        usage={`<header className="sticky top-0 z-20 flex h-(--topbar-h) items-center gap-2 border-b border-border bg-background px-4">
  <MobileShell … /><SidebarToggle />
  <CommandPalette … />
  <UserMenu … />
</header>`}
        a11y={[
          'Mide `--topbar-h` y el documento tiene `scroll-padding-top` de ese alto: lo enfocado nunca queda abajo de la barra.',
          '«Ocultar menú» y el menú del celular llevan `aria-expanded` y `aria-controls`.',
          'En el celular, la lupa de 44 px abre la misma paleta.',
        ]}
      >
        <TopbarDemo />
      </CatalogBlock>

      <CatalogBlock
        id="palette"
        purpose="La paleta ⌘K: recientes, acciones rápidas e «Ir a», al instante."
        yes="Llegar a cualquier pantalla o acción sin el mouse. El placeholder dice lo que busca: páginas y acciones."
        no="Buscar clientes o proveedores (la búsqueda de entidades es la fase 2, por Route Handler)."
        usage={`<CommandDialog open={open} onOpenChange={setOpen}>
  <CommandInput placeholder="Buscar páginas y acciones…" />
  <CommandList>…</CommandList>
  <CommandFooter />
</CommandDialog>`}
        a11y={[
          '⌘K o Ctrl+K desde cualquier lado; Esc cierra y el foco vuelve a donde estaba.',
          'Sin animación de entrada ni de salida: se usa decenas de veces por día.',
        ]}
      >
        <PaletteDemo />
      </CatalogBlock>
    </CatalogFamily>
  )
}
