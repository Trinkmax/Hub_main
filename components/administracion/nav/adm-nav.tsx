'use client'

import {
  BookOpen,
  CalendarCheck,
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
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { activeSectionTab, type ResolvedSectionTab } from '@/components/shell/section-tabs-config'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  type AdmAudience,
  type AdmNavItem,
  admNavPinned,
  buildAdmNav,
  MONTH_END_VALUE,
  navRestScroll,
} from './adm-nav-model'
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
  // El mismo ícono que la parada «Fin de mes» de la guía.
  [MONTH_END_VALUE]: CalendarCheck,
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
  // 1280 px entra toda la fila sin tener que deslizarla. `snap-start`: cuando la fila se desliza,
  // descansa donde arranca una píldora.
  'relative inline-flex h-9 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-sm font-medium transition-colors motion-reduce:transition-none @6xl:px-3',
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

/**
 * Qué se ve según el ancho de la BARRA (del contenedor, no de la ventana: con el menú lateral
 * abierto la barra es 260 px más angosta que la pantalla). Cuatro cortes, todos medidos con las
 * píldoras reales:
 *
 * - `lg` + 56rem: entran los íconos de Guía y Ajustes al lado de «Cargar». Por debajo (un iPad
 *   apaisado con el menú abierto) quedan en «Más», que ahí va con «···» solo.
 * - `lg` + 63.75rem (una notebook de 1280 con el menú abierto): entran enteros «Importar» y
 *   «Contadora ▾». Por debajo los reemplaza «··· Más», que ya los trae: nunca una letra suelta.
 * - `lg` + 67.5rem: la píldora dice «Compras y pagos», como el título de la pantalla. En la
 *   tablet (sin «Cargar» en la barra) entra antes, desde 46rem.
 * - 72rem (`@6xl`): «Guía» con texto y las píldoras con más aire.
 *
 * Tailwind necesita las clases escritas enteras: por eso el corte se repite en cada una.
 */
const LABEL_FULL = 'hidden max-lg:@[46rem]:inline lg:@[67.5rem]:inline'
const LABEL_SHORT = 'max-lg:@[46rem]:hidden lg:@[67.5rem]:hidden'
/** Lo que va en la fila solo cuando entra entero (Importar, «Contadora ▾» y su separador). */
const WIDE_ONLY_PILL = 'hidden lg:@[63.75rem]:inline-flex'
const WIDE_ONLY_RULE = 'hidden lg:@[63.75rem]:block'

/**
 * El ícono de una píldora. La contadora tiene ocho píldoras (las cinco de todos, más Libros, Fin
 * de mes y Plan de cuentas): con ícono no entran en ninguna compu (medido: 13 px de más aun con
 * la barra al máximo, y «Importar» quedaba cortada). En la compu las suyas van sin ícono y entran
 * todas desde una notebook de 1280; en el celular y la tablet, donde la fila se desliza, lo
 * conservan.
 */
const PILL_ICON: Readonly<Record<AdmAudience, string>> = {
  owner: 'size-4 shrink-0',
  accountant: 'size-4 shrink-0 lg:hidden',
}

function PillLabel({ item }: { item: AdmNavItem }) {
  if (!item.shortLabel) return <>{item.label}</>
  return (
    <>
      <span className={LABEL_FULL}>{item.label}</span>
      <span className={LABEL_SHORT}>{item.shortLabel}</span>
    </>
  )
}

function NavPill({
  item,
  active,
  audience,
  quiet = false,
  className,
}: {
  item: AdmNavItem
  active: boolean
  audience: AdmAudience
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
      {Icon ? <Icon className={PILL_ICON[audience]} aria-hidden="true" /> : null}
      <PillLabel item={item} />
    </Link>
  )
}

type Fade = 'none' | 'start' | 'end' | 'both'

/**
 * El desvanecido de la fila. A la izquierda es corto: la fila descansa donde arranca una
 * píldora, así que solo le suaviza el borde a la primera para avisar que hay más para ese lado.
 * A la derecha hay desvanecido solo en la compu ancha; con «Más» a la vista no hace falta,
 * porque las píldoras pasan por debajo de «Más».
 */
const FADE_MASK: Readonly<Record<Fade, string>> = {
  none: '',
  start: '[mask-image:linear-gradient(to_right,transparent,black_0.75rem)]',
  end: 'lg:@[63.75rem]:[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent)]',
  both: '[mask-image:linear-gradient(to_right,transparent,black_0.75rem)] lg:@[63.75rem]:[mask-image:linear-gradient(to_right,transparent,black_0.75rem,black_calc(100%_-_2.5rem),transparent)]',
}

/** El aire a la izquierda de la fila (`pl-1`, `scroll-pl-1`): ahí descansa cada píldora. */
const ROW_INSET_PX = 4
/** Lo que el respaldo de «Más» apaga hacia la izquierda, además de lo que se monta sobre la fila. */
const MORE_HALO_PX = 12

/**
 * La fila que se desliza. Deja la activa ENTERA a la vista (sin mover la página, y sin moverse
 * si ya se veía: ver `navRestScroll`) y sabe de qué lado sigue. La barra de scroll está oculta:
 * que haya más lo dicen la píldora que asoma por debajo de «Más» y el borde suavizado.
 */
function useSlidingRow(active: string | null, moreRef: RefObject<HTMLElement | null>) {
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

  const settle = useCallback(() => {
    const row = ref.current
    if (!row) return
    const max = row.scrollWidth - row.clientWidth
    if (max > 0) {
      const rowBox = row.getBoundingClientRect()
      // Las píldoras que se ven (`offsetParent` es null con display: none): según el ancho,
      // «Importar» y «Contadora» están o no en la fila.
      const pills = Array.from(row.children).filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.matches('a, button') && node.offsetParent !== null,
      )
      const more = moreRef.current
      const cover =
        more && more.offsetParent !== null
          ? Math.max(0, rowBox.right - more.getBoundingClientRect().left) + MORE_HALO_PX
          : 0
      const next = navRestScroll({
        pills: pills.map((node) => {
          const box = node.getBoundingClientRect()
          return {
            start: box.left - rowBox.left + row.scrollLeft,
            end: box.right - rowBox.left + row.scrollLeft,
          }
        }),
        active: pills.findIndex((node) => node.hasAttribute('data-nav-current')),
        width: row.clientWidth,
        cover,
        inset: ROW_INSET_PX,
        current: row.scrollLeft,
        max,
      })
      if (Math.abs(next - row.scrollLeft) >= 1) row.scrollLeft = next
    }
    measure()
  }, [measure, moreRef])

  // Layout effect: corre antes de pintar, así la fila no aparece en cero y después salta.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` no se lee adentro, pero al cambiar de pantalla hay que volver a acomodar la fila (el DOM ya marca la nueva con data-nav-current)
  useLayoutEffect(() => {
    settle()
  }, [active, settle])

  useEffect(() => {
    const row = ref.current
    if (!row) return
    row.addEventListener('scroll', measure, { passive: true })
    // Girar el teléfono o plegar el menú cambia cuánto entra.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(settle)
    observer?.observe(row)
    // La tipografía puede llegar después del primer paint y cambiar el ancho de las píldoras.
    let alive = true
    void document.fonts?.ready.then(() => {
      if (alive) settle()
    })
    return () => {
      alive = false
      row.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [measure, settle])

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

/**
 * «Contadora ▾» en la compu del dueño: Fin de mes, Libros y Plan de cuentas, a mano pero sin
 * ocupar lugar. Queda rellena cuando estás en cualquiera de las tres.
 */
function BooksMenu({ items, active }: { items: readonly AdmNavItem[]; active: string | null }) {
  const current = items.some((item) => item.value === active)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-nav-current={current ? '' : undefined}
          className={cn(PILL, current ? PILL_ACTIVE : PILL_QUIET, WIDE_ONLY_PILL)}
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
 * El respaldo de «Más»: un degradé corto del color del fondo, solo hacia la izquierda (de donde
 * vienen las píldoras) y del alto de una píldora. Lo que pasa por debajo se va apagando hasta
 * meterse atrás de «Más»: se lee que la fila sigue, no que una palabra quedó cortada contra un
 * botón. Llega hasta la mitad de «Más» para tapar también las esquinas de su borde redondo.
 * Se ve solo mientras hay píldoras por debajo.
 */
const MORE_BACKING = cn(
  "before:pointer-events-none before:absolute before:inset-y-0 before:-left-4 before:-z-10 before:w-[2.125rem] before:content-['']",
  'before:bg-[linear-gradient(to_right,transparent,var(--background)_1rem)]',
  'before:opacity-0 before:transition-opacity before:duration-200 data-under:before:opacity-100 motion-reduce:before:transition-none',
)
/**
 * «Más» marcada por Guía o Ajustes solo mientras sus íconos no están en la barra: desde
 * `lg` + 56rem los marca la barra, y «Más» vuelve al reposo para no tener dos rellenas.
 */
const MORE_ACTIVE_NARROW = cn(
  PILL_ACTIVE,
  'lg:@4xl:border-border/70 lg:@4xl:bg-card lg:@4xl:text-foreground lg:@4xl:shadow-none lg:@4xl:hover:bg-cream-tint dark:lg:@4xl:hover:bg-accent/40',
)

/**
 * «··· Más»: lo que no es de todos los días (Fin de mes, Importar, Libros, Plan de cuentas) y lo
 * que antes no tenía lugar fijo (Guía y Ajustes). Queda fijo al final de la fila, fuera de lo
 * que se desliza y un poco montado sobre ella, para que esté siempre a un toque y las píldoras
 * pasen por debajo. En la compu ancha no se ve: ahí todo eso entra en la barra.
 */
function MoreMenu({
  items,
  active,
  inBar,
  under,
  wrapRef,
}: {
  items: readonly AdmNavItem[]
  active: string | null
  /** Las que la barra también muestra con ícono cuando hay lugar (Guía, Ajustes). */
  inBar: readonly string[]
  /** Hay píldoras pasando por debajo: se dibuja el respaldo. */
  under: boolean
  wrapRef: RefObject<HTMLSpanElement | null>
}) {
  const [open, setOpen] = useState(false)
  const current = items.some((item) => item.value === active)
  const onlyNarrow = current && active !== null && inBar.includes(active)
  return (
    <>
      <span
        ref={wrapRef}
        data-under={under ? '' : undefined}
        className={cn(
          'relative z-10 -ml-9 shrink-0 rounded-full bg-background lg:@[63.75rem]:hidden',
          MORE_BACKING,
        )}
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Más de Administración"
          data-nav-more=""
          onClick={() => setOpen(true)}
          className={cn(
            PILL,
            onlyNarrow ? MORE_ACTIVE_NARROW : current ? PILL_ACTIVE : PILL_IDLE,
            // Con «Cargar» al lado y poco ancho (iPad apaisado), «···» solo.
            'lg:@max-4xl:w-9 lg:@max-4xl:justify-center lg:@max-4xl:px-0',
          )}
        >
          <Ellipsis className="size-4 shrink-0" aria-hidden="true" />
          <span className="lg:@max-4xl:hidden">Más</span>
        </button>
      </span>
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
 *   (Fin de mes, Libros, Plan de cuentas) más callados · a la derecha Guía, Ajustes y «＋ Cargar»
 *   (el lanzador). Si la barra es angosta (un iPad apaisado, una notebook chica con el menú
 *   abierto), Importar y «Contadora ▾» pasan a «··· Más» en vez de quedar cortados.
 * - Celular: la misma fila, que se desliza por debajo de «··· Más», fijo al final. «Cargar» ahí
 *   es el botón flotante (`AdmFab`, que monta el layout).
 * - Contadora: Libros, Fin de mes y Plan de cuentas son píldoras (es su zona) y no hay «Cargar».
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
  const moreRef = useRef<HTMLSpanElement>(null)
  const { ref: rowRef, fade } = useSlidingRow(active, moreRef)
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
          className="mx-auto flex w-full max-w-7xl items-center px-4 py-1 sm:px-6 lg:px-8"
        >
          <div
            ref={rowRef}
            className={cn(
              // El aire de la fila (py, pl) es para que el anillo de foco y la zona de toque de
              // las píldoras no queden recortados por el scroll. A la derecha deja lugar para
              // «Más», que va montado sobre el final de la fila (`pr-12`): al llegar al fondo,
              // la última píldora queda entera a su izquierda. `snap`: descansa donde arranca
              // una píldora, nunca con medio borde asomando.
              '-ml-1 flex min-w-0 flex-1 snap-x snap-proximity scroll-pl-1 items-center gap-1.5 overflow-x-auto py-1.5 pr-12 pl-1 [scrollbar-width:none] lg:@[63.75rem]:-mr-1 lg:@[63.75rem]:pr-1 [&::-webkit-scrollbar]:hidden',
              FADE_MASK[fade],
            )}
          >
            {model.primary.map((item) => (
              <NavPill
                key={item.value}
                item={item}
                active={item.value === active}
                audience={audience}
              />
            ))}
            {model.quiet.length > 0 || model.books.length > 0 ? (
              <span
                aria-hidden="true"
                className={cn('mx-1 h-5 w-px shrink-0 bg-border @6xl:mx-1.5', WIDE_ONLY_RULE)}
              />
            ) : null}
            {model.quiet.map((item) => (
              <NavPill
                key={item.value}
                item={item}
                active={item.value === active}
                audience={audience}
                quiet
                className={WIDE_ONLY_PILL}
              />
            ))}
            {model.books.length > 0 ? <BooksMenu items={model.books} active={active} /> : null}
          </div>

          <MoreMenu
            items={model.more}
            active={active}
            inBar={[model.guide.value, model.settings.value]}
            under={fade === 'end' || fade === 'both'}
            wrapRef={moreRef}
          />

          <div className="ml-3 hidden shrink-0 items-center gap-1.5 lg:flex">
            <Link
              href={model.guide.href}
              aria-label={model.guide.label}
              aria-current={guideActive ? 'page' : undefined}
              className={cn(PILL, guideActive ? PILL_ACTIVE : PILL_IDLE, 'hidden @4xl:inline-flex')}
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
                'hidden w-9 justify-center px-0 @4xl:inline-flex @6xl:px-0',
                settingsActive ? PILL_ACTIVE : PILL_QUIET,
              )}
            >
              <Settings className="size-4 shrink-0" aria-hidden="true" />
            </Link>
            <LauncherButton className="@4xl:ml-1" />
          </div>
        </nav>
      </div>
    </>
  )
}
