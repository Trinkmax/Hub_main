'use client'

import {
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  FileUp,
  LayoutDashboard,
  LibraryBig,
  ListTree,
  type LucideIcon,
  Settings,
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { scrollLeftToCenter } from '@/components/shell/section-tabs'
import { activeSectionTab, type ResolvedSectionTab } from '@/components/shell/section-tabs-config'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { type AdmAudience, type AdmNavItem, admNavPinned, buildAdmNav } from './adm-nav-model'
import { LauncherButton } from './launcher'
import { NavDialog } from './nav-dialog'

const ICONS: Readonly<Record<string, LucideIcon>> = {
  resumen: LayoutDashboard,
  ventas: TrendingUp,
  compras: Truck,
  'gastos-fijos': CalendarClock,
  cajas: Wallet,
  importar: FileUp,
  libros: LibraryBig,
  'plan-de-cuentas': ListTree,
  guias: BookOpen,
  ajustes: Settings,
}

/**
 * El mismo corrimiento que `SectionTabsBar` (`components/shell/section-tabs-bar.tsx`, que no se
 * toca porque lo comparten Clientes, Marketing y Estadísticas): las páginas angostas de la
 * sección (3xl, 6xl) se centran solas y quedarían corridas de la barra, así que se les da el
 * margen que tendría una de 7xl y el título arranca justo debajo de la primera píldora. Vale para
 * lo que viene después de la barra en el layout (la página o su loading, que son hermanas).
 */
const ALIGN_NARROW_PAGES =
  '[&~:is(.max-w-xl,.max-w-2xl,.max-w-3xl,.max-w-4xl,.max-w-5xl,.max-w-6xl)]:ms-[max(0px,calc((100%_-_80rem)/2))]'

/**
 * Con la barra pegada arriba hay 112 px tapados (topbar + barra) en vez de 56. Dos avisos para
 * las páginas, sin tocarlas:
 * - los links con ancla (`#historial`, un paso de ARCA) frenan debajo de la barra, no detrás;
 * - `--adm-nav-h` dice cuánto ocupa la barra pegada (0 si no está pegada), para lo que una
 *   página quiera pegar debajo: `top-[calc(5rem+var(--adm-nav-h,0px))]`.
 */
const PINNED_OFFSETS = '[&~*]:[--adm-nav-h:3.5rem] [&~*_[id]]:scroll-mt-32'

const FOCUS =
  'outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/**
 * Píldora de 36 px. El `after` le estira la zona de toque a 44 px sin agrandarla a la vista (la
 * fila tiene ese aire arriba y abajo).
 */
const PILL = cn(
  // Un poco más apretadas hasta que la barra es ancha: con el menú abierto en una notebook de
  // 1280 px entra toda la fila sin tener que deslizarla.
  'relative inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-sm font-medium transition-colors motion-reduce:transition-none @6xl:px-3',
  "after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
  FOCUS,
)
/** La activa va rellena (verde en claro, dorado en oscuro): nunca solo un contorno. */
const PILL_ACTIVE = 'border-primary bg-primary text-primary-foreground shadow-xs'
/** El mismo reposo que las píldoras del kit (`kit/pill.tsx`), para que toda la sección se lea igual. */
const PILL_IDLE =
  'border-border/70 bg-card text-foreground hover:bg-cream-tint dark:hover:bg-accent/40'
/** Lo de la contadora y los importadores: sin borde ni fondo, para que no compita. */
const PILL_QUIET =
  'border-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground'

/** Qué etiqueta se ve según el ancho de la barra (del contenedor, no de la ventana). */
const LABEL_SWAP = {
  // «Fijos» solo en el celular.
  phone: { full: 'hidden @2xl:inline', short: '@2xl:hidden' },
  // «Compras y pagos» entra recién con la barra ancha (el menú plegado o una pantalla grande).
  wide: { full: 'hidden @6xl:inline', short: '@6xl:hidden' },
} as const

function PillLabel({ item }: { item: AdmNavItem }) {
  if (!item.shortLabel) return <>{item.label}</>
  const swap = item.value === 'compras' ? LABEL_SWAP.wide : LABEL_SWAP.phone
  return (
    <>
      <span className={swap.full}>{item.label}</span>
      <span className={swap.short}>{item.shortLabel}</span>
    </>
  )
}

function NavPill({
  item,
  active,
  quiet = false,
  className,
}: {
  item: AdmNavItem
  active: boolean
  quiet?: boolean
  className?: string
}) {
  const Icon = quiet ? null : ICONS[item.value]
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      data-nav-current={active ? '' : undefined}
      className={cn(PILL, active ? PILL_ACTIVE : quiet ? PILL_QUIET : PILL_IDLE, className)}
    >
      {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
      <PillLabel item={item} />
    </Link>
  )
}

type Fade = 'none' | 'start' | 'end' | 'both'

/** El desvanecido de la fila: de qué lado todavía hay píldoras por ver. */
const FADE_MASK: Readonly<Record<Fade, string>> = {
  none: '',
  start: '[mask-image:linear-gradient(to_right,transparent,black_2rem)]',
  end: '[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent)]',
  both: '[mask-image:linear-gradient(to_right,transparent,black_2rem,black_calc(100%_-_2.5rem),transparent)]',
}

/**
 * La fila que se desliza: trae la activa al centro (sin mover la página) y sabe de qué lado
 * sigue, para desvanecer ese borde. La barra de scroll está oculta, así que el desvanecido es la
 * única señal de que hay más.
 */
function useSlidingRow(active: string | null) {
  const ref = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<Fade>('none')

  const measure = useCallback(() => {
    const row = ref.current
    if (!row) return
    const overflow = row.scrollWidth - row.clientWidth
    // 4 px de margen: los anchos con decimales no dejan llegar justo al borde.
    const start = row.scrollLeft > 4
    const end = overflow - row.scrollLeft > 4
    setFade(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none')
  }, [])

  // Layout effect: corre antes de pintar, así la fila no aparece en cero y después salta.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` no se lee adentro, pero cambiar de pantalla tiene que volver a centrar la nueva (el DOM ya la marca con data-nav-current)
  useLayoutEffect(() => {
    const row = ref.current
    if (!row) return
    const overflow = row.scrollWidth - row.clientWidth
    // La marcada puede estar dos veces en el DOM (la píldora de la compu y «Más» del celular):
    // vale la que se ve (`offsetParent` es null con display: none).
    const current = Array.from(row.querySelectorAll<HTMLElement>('[data-nav-current]')).find(
      (node) => node.offsetParent !== null,
    )
    if (current && overflow > 0) {
      const rowBox = row.getBoundingClientRect()
      const box = current.getBoundingClientRect()
      row.scrollLeft = scrollLeftToCenter({
        scrollLeft: row.scrollLeft,
        overflow,
        navLeft: rowBox.left,
        navWidth: rowBox.width,
        tabLeft: box.left,
        tabWidth: box.width,
      })
    }
    measure()
  }, [active, measure])

  useEffect(() => {
    const row = ref.current
    if (!row) return
    row.addEventListener('scroll', measure, { passive: true })
    // Girar el teléfono o plegar el menú cambia cuánto entra.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(row)
    return () => {
      row.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [measure])

  return { ref, fade }
}

/**
 * ¿La barra ya quedó pegada bajo el topbar? Un centinela de 1 px justo antes: cuando pasa por
 * debajo del topbar (56 px), la barra está pegada. Recién ahí se le pone el fondo; quieta arriba
 * de la página va transparente, como iban las pestañas, sin partir el degradé del panel.
 */
function useStuck(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const sentinel = ref.current
    if (!enabled || !sentinel || typeof IntersectionObserver === 'undefined') {
      setStuck(false)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(entry ? !entry.isIntersecting : false),
      { rootMargin: '-56px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [enabled])

  return { ref, stuck }
}

/** «Contadora ▾» en la compu del dueño: Libros y Plan de cuentas, a mano pero sin ocupar lugar. */
function BooksMenu({ items, active }: { items: readonly AdmNavItem[]; active: string | null }) {
  const current = items.some((item) => item.value === active)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-nav-current={current ? '' : undefined}
          className={cn(PILL, current ? PILL_ACTIVE : PILL_QUIET, 'hidden lg:inline-flex')}
        >
          Contadora
          <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 rounded-xl p-1.5">
        {items.map((item) => {
          const Icon = ICONS[item.value]
          const isActive = item.value === active
          return (
            <DropdownMenuItem
              key={item.value}
              asChild
              className={cn('items-start gap-2.5 rounded-lg px-2.5 py-2', isActive && 'bg-accent')}
            >
              <Link href={item.href} aria-current={isActive ? 'page' : undefined}>
                {Icon ? <Icon className="mt-0.5 size-4" aria-hidden="true" /> : null}
                <span className="min-w-0">
                  <span className="block font-medium">{item.label}</span>
                  {item.hint ? (
                    <span className="block text-xs text-pretty text-muted-foreground">
                      {item.hint}
                    </span>
                  ) : null}
                </span>
              </Link>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * «··· Más» en el celular: lo que no es de todos los días (Importar, Libros, Plan de cuentas) y
 * lo que antes no tenía lugar fijo (Guía y Ajustes solo se alcanzaban desde el Resumen). Queda
 * fijo al final de la fila, fuera de lo que se desliza, para que esté siempre a un toque.
 */
function MoreMenu({ items, active }: { items: readonly AdmNavItem[]; active: string | null }) {
  const [open, setOpen] = useState(false)
  const current = items.some((item) => item.value === active)
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(PILL, current ? PILL_ACTIVE : PILL_IDLE, 'lg:hidden')}
      >
        <Ellipsis className="size-4 shrink-0" aria-hidden="true" />
        Más
      </button>
      <NavDialog
        open={open}
        onOpenChange={setOpen}
        title="Más de Administración"
        description="Lo que no se usa todos los días."
      >
        <ul className="grid gap-1">
          {items.map((item) => {
            const Icon = ICONS[item.value]
            const isActive = item.value === active
            return (
              <li key={item.value}>
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex min-h-14 items-center gap-3 rounded-2xl px-2.5 py-2 transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none',
                    isActive && 'bg-accent/60',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-full',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-foreground/80',
                    )}
                  >
                    {Icon ? <Icon className="size-[18px]" aria-hidden="true" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{item.label}</span>
                    {item.hint ? (
                      <span className="block text-sm text-pretty text-muted-foreground">
                        {item.hint}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      </NavDialog>
    </>
  )
}

/**
 * La navegación de Administración: una sola fila arriba de cada pantalla de la sección.
 *
 * - Compu: las pantallas de todos los días como píldoras con ícono · Importar y «Contadora ▾»
 *   más callados · a la derecha Guía, Ajustes y «＋ Cargar» (el lanzador).
 * - Celular: la misma fila, que se desliza y se desvanece donde sigue, y «··· Más» fijo al final.
 *   «Cargar» ahí es el botón flotante (`QuickActionsBar`).
 * - Contadora: Libros y Plan de cuentas son píldoras (es su zona) y no hay «Cargar».
 *
 * Quién ve qué lo decide `resolveSection('administracion', …)` en el layout: acá llegan solo las
 * pestañas permitidas. «Cargar» depende del permiso de escritura del contexto (`readOnly`).
 */
export function AdmNav({
  label,
  tabs,
  audience,
}: {
  /** Nombre accesible de la barra: «Secciones de Administración». */
  label: string
  tabs: readonly ResolvedSectionTab[]
  audience: AdmAudience
}) {
  const pathname = usePathname()
  const { tenantSlug } = useAccounting()
  const model = useMemo(
    () => buildAdmNav(tabs, { base: `/${tenantSlug}/administracion`, audience }),
    [tabs, tenantSlug, audience],
  )
  const active = activeSectionTab(model.all, pathname)
  const pinned = admNavPinned(model.all, pathname)
  const { ref: rowRef, fade } = useSlidingRow(active)
  const { ref: sentinelRef, stuck } = useStuck(pinned)

  // Sin pestañas no hay a quién mostrarle nada (sin sesión resuelta la sección falla cerrada).
  if (tabs.length === 0) return null

  const settingsActive = active === model.settings.value
  const guideActive = active === model.guide.value

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="-mb-px h-px" />
      <div
        data-stuck={stuck ? '' : undefined}
        className={cn(
          '@container z-10 border-b border-transparent transition-[background-color,border-color,box-shadow] duration-200 motion-reduce:transition-none',
          'data-stuck:border-border/60 data-stuck:bg-background/85 data-stuck:shadow-xs data-stuck:backdrop-blur',
          pinned && 'sticky top-14',
          pinned && PINNED_OFFSETS,
          ALIGN_NARROW_PAGES,
        )}
      >
        <nav
          aria-label={label}
          className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-1 sm:px-6 lg:gap-3 lg:px-8"
        >
          <div
            ref={rowRef}
            className={cn(
              // El aire de la fila (py/px) es para que el anillo de foco y la zona de toque de
              // las píldoras no queden recortados por el scroll. En el celular arranca en el
              // borde de la pantalla (a la derecha no: ahí está «Más»).
              '-ml-4 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1.5 pr-1 pl-4 [scrollbar-width:none] sm:-ml-6 sm:pl-6 lg:-mx-1 lg:px-1 [&::-webkit-scrollbar]:hidden',
              FADE_MASK[fade],
            )}
          >
            {model.primary.map((item) => (
              <NavPill key={item.value} item={item} active={item.value === active} />
            ))}
            {model.quiet.length > 0 || model.books.length > 0 ? (
              <span
                aria-hidden="true"
                className="mx-1 hidden h-5 w-px shrink-0 bg-border lg:block @6xl:mx-1.5"
              />
            ) : null}
            {model.quiet.map((item) => (
              <NavPill
                key={item.value}
                item={item}
                active={item.value === active}
                quiet
                className="hidden lg:inline-flex"
              />
            ))}
            {model.books.length > 0 ? <BooksMenu items={model.books} active={active} /> : null}
          </div>

          <MoreMenu items={model.more} active={active} />

          <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
            <Link
              href={model.guide.href}
              aria-label={model.guide.label}
              aria-current={guideActive ? 'page' : undefined}
              className={cn(PILL, guideActive ? PILL_ACTIVE : PILL_IDLE)}
            >
              <BookOpen className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden @6xl:inline">{model.guide.label}</span>
            </Link>
            <Link
              href={model.settings.href}
              aria-label={model.settings.label}
              title={model.settings.label}
              aria-current={settingsActive ? 'page' : undefined}
              className={cn(
                PILL,
                'w-9 justify-center px-0 @6xl:px-0',
                settingsActive ? PILL_ACTIVE : PILL_QUIET,
              )}
            >
              <Settings className="size-4 shrink-0" aria-hidden="true" />
            </Link>
            <LauncherButton className="ml-1" />
          </div>
        </nav>
      </div>
    </>
  )
}
