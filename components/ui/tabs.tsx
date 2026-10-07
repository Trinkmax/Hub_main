'use client'

import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { LucideIcon } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import * as React from 'react'
import { formatNumber } from '@/lib/format/number-kind'
import { cn } from '@/lib/utils'

/*
 * Pestañas subrayadas del kit HUB (§3.3): las secciones de una página. Mismos
 * exports de Radix que antes (`Tabs`, `TabsList`, `TabsTrigger`,
 * `TabsContent`), así los 9 archivos del panel siguen andando; el look de
 * caja se va y queda el subrayado.
 *
 * Además exporta las piezas que comparte con `TabsNav` y `SectionNav`
 * (`route-nav.tsx`): las clases de la fila y del disparador y el hook de la
 * fila con scroll. Todo esto es cliente: desde un Server Component se usan
 * los componentes, nunca el hook ni las funciones.
 */

// ── Lógica pura (con tests) ─────────────────────────────────────────────────

/**
 * La query con `?param=value`, o `null` si la URL ya dice eso: así no se
 * escribe el historial de gusto. Conserva los otros parámetros.
 */
export function searchWithParam(search: string, param: string, value: string): string | null {
  const params = new URLSearchParams(search)
  if (params.get(param) === value) return null
  params.set(param, value)
  return `?${params.toString()}`
}

/**
 * Cuando el parámetro de la URL cambia desde afuera (un link del menú a
 * `?tab=…`, atrás o adelante): la pestaña a elegir, o `null` si no hay que
 * tocar nada. Sin parámetro vuelve al default del server.
 */
export function tabForUrlChange(
  urlValue: string | null,
  defaultValue: string | undefined,
  current: string | undefined,
): string | null {
  const target = urlValue ?? defaultValue
  if (target === undefined || target === current) return null
  return target
}

/** De qué lado de una fila con scroll horizontal queda contenido escondido. */
export type OverflowEdges = 'none' | 'start' | 'end' | 'both'

/** El píxel de tolerancia absorbe el redondeo de los anchos con decimales. */
export function overflowEdges(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): OverflowEdges {
  const start = scrollLeft > 1
  const end = scrollLeft + clientWidth < scrollWidth - 1
  if (start && end) return 'both'
  if (start) return 'start'
  if (end) return 'end'
  return 'none'
}

/**
 * El `scrollLeft` que deja entero a un hijo de la fila, con `margin` de aire
 * para que no quede abajo de la máscara del borde. Es el
 * `scrollIntoView({ inline: 'nearest' })` de la spec hecho a mano: el nativo
 * también mueve la página en vertical, y al montar la página saltaba.
 * `item.left` se mide desde el inicio del contenido (no de lo visible).
 */
export function nearestScrollLeft(
  view: { scrollLeft: number; clientWidth: number; scrollWidth: number },
  item: { left: number; width: number },
  margin = 0,
): number {
  const max = Math.max(0, view.scrollWidth - view.clientWidth)
  const start = item.left - margin
  const end = item.left + item.width + margin
  let next = view.scrollLeft
  // Más ancho que lo visible: que se vea el principio, que es donde se lee.
  if (start < view.scrollLeft || end - start > view.clientWidth) next = start
  else if (end > view.scrollLeft + view.clientWidth) next = end - view.clientWidth
  return Math.min(max, Math.max(0, next))
}

// ── Fila con scroll (compartida con TabsNav y SectionNav) ───────────────────

/** Ancho de la máscara del borde: el activo se corre al menos esto adentro. */
const EDGE_FADE_PX = 32

/**
 * Layout effect en el navegador (corre antes de pintar: la fila no salta) y
 * nada en el server, como `@radix-ui/react-use-layout-effect`.
 */
const useBrowserLayoutEffect = globalThis.document ? React.useLayoutEffect : () => {}

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    }
  }
}

/**
 * La fila de pestañas cuando no entra: marca `data-overflow` (la máscara
 * desvanece el lado que tiene más) y, al montar y cada vez que cambia
 * `activeKey`, corre la fila para que el activo (`activeSelector`) se vea
 * entero. Solo toca el `scrollLeft` de la fila, nunca el de la página.
 */
export function useScrollRow<T extends HTMLElement>(
  activeKey: unknown,
  activeSelector: string,
  externalRef?: React.Ref<T>,
) {
  const rowRef = React.useRef<T | null>(null)
  const [edges, setEdges] = React.useState<OverflowEdges>('none')

  const measure = React.useCallback(() => {
    const row = rowRef.current
    if (row) setEdges(overflowEdges(row.scrollLeft, row.clientWidth, row.scrollWidth))
  }, [])

  // Scroll del usuario y cambios de ancho (de la fila o de una pestaña).
  React.useEffect(() => {
    const row = rowRef.current
    if (!row) return
    row.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(row)
    for (const child of Array.from(row.children)) observer?.observe(child)
    return () => {
      row.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [measure])

  // Una pestaña que aparece o un contador que crece cambian el ancho del
  // contenido sin cambiar el de la fila: se vuelve a medir en cada render.
  React.useEffect(() => {
    measure()
  })

  useBrowserLayoutEffect(() => {
    // `activeKey` no se lee: es el aviso de que cambió la activa (el DOM ya la marcó).
    void activeKey
    const row = rowRef.current
    const active = row?.querySelector<HTMLElement>(activeSelector)
    if (!row || !active) return
    const rowBox = row.getBoundingClientRect()
    const box = active.getBoundingClientRect()
    const next = nearestScrollLeft(
      { scrollLeft: row.scrollLeft, clientWidth: row.clientWidth, scrollWidth: row.scrollWidth },
      { left: box.left - rowBox.left + row.scrollLeft, width: box.width },
      EDGE_FADE_PX,
    )
    if (Math.abs(next - row.scrollLeft) >= 1) row.scrollLeft = next
  }, [activeKey, activeSelector])

  const ref = React.useMemo(() => mergeRefs<T>(rowRef, externalRef), [externalRef])
  return { ref, overflow: edges === 'none' ? undefined : edges }
}

/**
 * La fila. El pelo de abajo es un `box-shadow` inset y no un `border-b`: con
 * `overflow-x-auto`, el `-mb-px` que tendría que pisar el borde queda
 * recortado (el subrayado se ve de 1 px) y deja 1 px de scroll vertical. Así
 * lo hacen Radix Themes y Primer. En alto contraste el `box-shadow`
 * desaparece y la fila suma un `border-b` real. Sin barra de scroll: lo que
 * sobra lo anuncia la máscara del borde.
 *
 * `min-h-min`: la fila nunca es más baja que sus pestañas, aunque llegue un
 * alto fijo (`calendar-tabs` pasa `h-10`): con el dedo miden 44 y, como la
 * fila es un contenedor con scroll, recortaría justo el subrayado. El
 * `min-height` le gana al `height`.
 */
export const tabsListClasses = [
  'relative flex min-h-min min-w-0 items-stretch gap-4 overflow-x-auto overscroll-x-contain',
  'snap-x snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
  'shadow-[inset_0_-1px_0_0_var(--border)] forced-colors:border-b',
  'data-[overflow=start]:[mask-image:linear-gradient(to_right,transparent,#000_2rem)]',
  'data-[overflow=end]:[mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)]',
  'data-[overflow=both]:[mask-image:linear-gradient(to_right,transparent,#000_2rem,#000_calc(100%_-_2rem),transparent)]',
].join(' ')

/**
 * El disparador (y el link de `TabsNav`): 40 px, 44 con el dedo. El activo se
 * marca con `data-state="active"` (Radix lo pone solo; los links lo reciben
 * a mano) y es un `border-b-2`, no un pseudo-elemento: un borde sobrevive al
 * alto contraste. En ese modo el borde transparente de los inactivos se
 * pintaría con el color del sistema, por eso va en `Canvas`, y el activo en
 * `Highlight`.
 *
 * `px-1` + `gap-4` en la fila: el foco «adentro» (2 px hacia adentro) necesita
 * aire para no pisar la primera y la última letra, y entre textos quedan los
 * 24 px del `gap-6` de la spec. Sin transición: se recorre con las flechas.
 */
export const tabsTriggerClasses = [
  'relative inline-flex min-h-10 shrink-0 snap-start items-center justify-center gap-2 whitespace-nowrap px-1 pointer-coarse:min-h-11',
  'border-b-2 border-transparent type-label text-muted-foreground',
  'hover:text-foreground',
  'outline-(--ring) -outline-offset-2 focus-visible:outline-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'forced-colors:border-[Canvas]',
  'data-[state=active]:border-primary data-[state=active]:text-foreground forced-colors:data-[state=active]:border-[Highlight]',
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
].join(' ')

/** Contador al lado de la etiqueta: 12 px, cifras tabulares, sin píldora. */
export const tabsCountClasses = 'type-caption type-amount text-subtle-foreground'

// ── Tabs ────────────────────────────────────────────────────────────────────

/** El valor activo, para que la lista lo lleve a la vista cuando cambia. */
const TabsValueContext = React.createContext<string | undefined>(undefined)

export type TabsProps = React.ComponentProps<typeof TabsPrimitive.Root> & {
  /**
   * Nombre del parámetro de la URL (`tab`, `vista`). El primer valor es el
   * `defaultValue` que calcula el server; cada cambio escribe `?<param>=` con
   * `history.replaceState` (no pide RSC ni deja una entrada por pestaña).
   * Arregla «entra pero no sale»: el link de una pestaña se puede copiar. Si
   * la URL cambia desde afuera (un link del menú a `?tab=…`, atrás o
   * adelante), la pestaña la sigue. Lee `useSearchParams`: las rutas del
   * panel son dinámicas; en una estática haría falta un `<Suspense>` arriba.
   */
  syncParam?: string
}

function TabsRoot({
  className,
  value,
  defaultValue,
  onValueChange,
  activeValue,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & { activeValue: string | undefined }) {
  return (
    <TabsValueContext.Provider value={activeValue}>
      <TabsPrimitive.Root
        data-slot="tabs"
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        className={cn('flex flex-col gap-2', className)}
        {...props}
      />
    </TabsValueContext.Provider>
  )
}

/** Sin `syncParam`: Radix tal cual (controlado o no); solo se mira el valor. */
function PlainTabs({ value, defaultValue, onValueChange, ...props }: TabsProps) {
  const [seen, setSeen] = React.useState(defaultValue)
  const handleValueChange = React.useCallback(
    (next: string) => {
      setSeen(next)
      onValueChange?.(next)
    },
    [onValueChange],
  )
  return (
    <TabsRoot
      {...props}
      value={value}
      defaultValue={defaultValue}
      onValueChange={handleValueChange}
      activeValue={value ?? seen}
    />
  )
}

/**
 * Con `syncParam`. Siempre controla a Radix (con `''` mientras no haya valor:
 * pasar de no controlado a controlado le hace tirar un aviso). `useSearchParams`
 * vive solo acá: las pestañas sin URL no lo llaman.
 */
function SyncedTabs({
  syncParam,
  value,
  defaultValue,
  onValueChange,
  ...props
}: TabsProps & { syncParam: string }) {
  const urlValue = useSearchParams()?.get(syncParam) ?? null
  const [own, setOwn] = React.useState(defaultValue)
  const current = value ?? own

  const select = React.useCallback(
    (next: string) => {
      setOwn(next)
      onValueChange?.(next)
    },
    [onValueChange],
  )

  // La URL cambió desde afuera (un link del menú, atrás o adelante): manda la
  // URL; si le sacaron el parámetro, el default del server (que en una
  // navegación llega junto con la URL nueva). La que escribimos nosotros ya
  // coincide con `current` y no hace nada.
  const lastUrlValue = React.useRef(urlValue)
  React.useEffect(() => {
    if (urlValue === lastUrlValue.current) return
    lastUrlValue.current = urlValue
    const target = tabForUrlChange(urlValue, defaultValue, current)
    if (target !== null) select(target)
  }, [urlValue, defaultValue, current, select])

  // El valor cambió (click, flechas o el padre): se escribe la URL. Se compara
  // contra el último valor y no con un «ya monté»: el doble efecto del
  // StrictMode (Next lo prende en dev) daría vuelta la bandera y escribiría
  // `?tab=` al cargar. La URL que llegó es la que el server ya leyó.
  const lastWritten = React.useRef(current)
  React.useEffect(() => {
    if (current === lastWritten.current) return
    lastWritten.current = current
    if (current === undefined) return
    const next = searchWithParam(window.location.search, syncParam, current)
    if (next === null) return
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${next}${window.location.hash}`,
    )
  }, [current, syncParam])

  return <TabsRoot {...props} value={current ?? ''} onValueChange={select} activeValue={current} />
}

/**
 * Raíz de las pestañas. Para paneles pesados, `activationMode="manual"`: las
 * flechas mueven el foco y Enter o Espacio eligen.
 */
function Tabs({ syncParam, ...props }: TabsProps) {
  return syncParam ? <SyncedTabs syncParam={syncParam} {...props} /> : <PlainTabs {...props} />
}

/**
 * La fila de disparadores: un pelo abajo, scroll horizontal con `scroll-snap`
 * cuando no entra y una máscara que desvanece el lado que tiene más. Al montar
 * (y al cambiar de pestaña) lleva la activa a la vista. `data-tour` y el resto
 * de las props llegan al `role="tablist"`.
 */
function TabsList({ className, ref, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  const activeValue = React.useContext(TabsValueContext)
  const row = useScrollRow<HTMLDivElement>(activeValue, '[role="tab"][data-state="active"]', ref)
  return (
    <TabsPrimitive.List
      ref={row.ref}
      data-slot="tabs-list"
      data-overflow={row.overflow}
      className={cn(tabsListClasses, className)}
      {...props}
    />
  )
}

export type TabsTriggerProps = React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  /** Contador al lado de la etiqueta («Reseñas 12»), en cifras tabulares. */
  count?: number
  /**
   * Ícono de 16 px antes de la etiqueta. Es un componente: desde un Server
   * Component no cruza al cliente, así que ahí el ícono va como hijo
   * (`<BarChart3 />`), que toma el mismo tamaño. Con `asChild`, `icon` y
   * `count` no se dibujan (el hijo decide).
   */
  icon?: LucideIcon
}

function TabsTrigger({ className, count, icon: Icon, children, ...props }: TabsTriggerProps) {
  const decorated = !props.asChild
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerClasses, className)}
      {...props}
    >
      {decorated && Icon ? <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} /> : null}
      {children}
      {decorated && count !== undefined ? (
        <span data-slot="tabs-count" className={tabsCountClasses}>
          {formatNumber(count)}
        </span>
      ) : null}
    </TabsPrimitive.Trigger>
  )
}

export type TabsContentProps = React.ComponentProps<typeof TabsPrimitive.Content>

/**
 * El panel. `forceMount` pasa tal cual: Radix lo deja montado pero visible, así
 * que el inactivo se oculta solo (`data-[state=inactive]:hidden`); el
 * `className="hidden"` que pone a mano `landing-editor` sigue valiendo. Es
 * enfocable (Radix le pone `tabIndex=0`): con Tab desde la fila se llega al
 * contenido aunque no tenga nada enfocable, con anillo «afuera».
 */
function TabsContent({ className, ...props }: TabsContentProps) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        'flex-1 rounded-md outline-offset-2 outline-(--ring) focus-visible:outline-2 data-[state=inactive]:hidden',
        className,
      )}
      {...props}
    />
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
