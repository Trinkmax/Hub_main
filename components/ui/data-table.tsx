import { Download } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { ControlSizeProvider } from '@/components/ui/control-size'
import {
  DataTableGroupToggle,
  DataTableRowSelect,
  DataTableSelectAll,
  DataTableSelectionBar,
  DataTableSelectionProvider,
  DataTableSortIndicator,
} from '@/components/ui/data-table-client'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { nextSortDir, type SortDir, type SortState } from '@/lib/table/sort'
import { cn } from '@/lib/utils'

/**
 * La tabla del panel (kit HUB §3.6): una sola apariencia, dos capas.
 *
 * 1. **`DataTable` declarativo por columnas**, para el 80 % de las listas.
 *    Server-safe: las funciones `cell`, `rowHref`, `sortHref` y `footer` se
 *    ejecutan donde se renderiza (en el server, si la página es server). El
 *    orden y la paginación son links por URL (`lib/table/sort.ts`,
 *    `lib/table/pagination.ts` y `<Pagination>`); la selección son islas
 *    cliente que leen un contexto. Sin TanStack: ordenar y paginar lo hace la
 *    consulta.
 * 2. **Primitivos componibles** (`DataTableShell`, `DataTableScroll`,
 *    `DataTableRoot`, `DataTableHead`, `DataTableHeader`, `DataTableBody`,
 *    `DataTableGroupRow`, `DataTableRow`, `DataTableCell`, `DataTableFoot`,
 *    `DataTableFooter`…) para las tablas raras: la matriz de cupos, las filas
 *    agrupadas por servicio. Son los mismos nombres de antes y los 9 usos de
 *    hoy siguen andando.
 *
 * ```tsx
 * // app/(manager)/[tenantSlug]/proveedores/page.tsx (Server Component)
 * const sp = await searchParams
 * // La key se valida contra esta lista: nunca llega a .order() algo que no se declaró.
 * const sort = parseSort(sp.orden, { nombre: 'asc', saldo: 'desc' }, DEFAULT_SORT)
 * const page = parsePage(sp.page)
 * const { from, to } = pageSlice(page, 25) // .order(…).range(from, to) con count: 'exact'
 * <DataTable
 *   caption="Proveedores"
 *   rows={rows}
 *   getRowId={(r) => r.id}
 *   rowHref={(r) => `/${slug}/proveedores/${r.id}`}
 *   rowLabel={(r) => r.name}
 *   sort={sort}
 *   sortHref={makeSortHref(`/${slug}/proveedores`, sp, { fallback: DEFAULT_SORT })}
 *   columns={[
 *     { id: 'nombre', header: 'Proveedor', cell: (r) => r.name, sort: { key: 'nombre' } },
 *     { id: 'cuit', header: 'CUIT', cell: (r) => r.cuit, hideBelow: 'lg' },
 *     { id: 'saldo', header: 'Saldo $', numeric: true, sort: { key: 'saldo', defaultDir: 'desc' },
 *       cell: (r) => <Amount cents={r.balanceCents} currency={false} />,
 *       footer: (rows) => <Amount cents={sum(rows)} currency={false} /> },
 *   ]}
 *   toolbar={<DataTableToolbar><SearchField … /><ExportButton href={csvHref} /></DataTableToolbar>}
 *   pagination={<Pagination page={page} pageSize={25} total={total} hrefFor={makePageHref(…)} />}
 * />
 * ```
 *
 * **Reglas que el componente no puede chequear solo**
 * - Con campos de formulario en las celdas (el importe a aplicar de una orden
 *   de pago), `mobile="scroll"` o una vista propia: `cards` dibuja cada celda
 *   dos veces y un `<input>` escondido con `display: none` igual se envía, así
 *   que el `FormData` llegaría con cada valor duplicado.
 * - Funciones como props no cruzan a un componente cliente: `onSortChange`,
 *   `selection.onSelectedChange` y `error.onRetry` sirven solo si la tabla se
 *   renderiza adentro de un componente cliente.
 * - Un `thead` fijo no se pega al viewport adentro de un scroll horizontal:
 *   `stickyHeader="page"` saca el scroll horizontal de escritorio (usá
 *   `hideBelow` para que entren las columnas); las tablas anchas usan
 *   `maxHeight`, con el encabezado fijo adentro.
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type { SortDir, SortState } from '@/lib/table/sort'

export type DataTableDensity = 'comfortable' | 'compact'
export type DataTableAlign = 'start' | 'center' | 'end'
export type DataTableBreakpoint = 'sm' | 'md' | 'lg'
/** `page` pega debajo del topbar (`top-(--topbar-h)`); `container`, arriba del scroll de `maxHeight`. */
export type DataTableStickyHeader = 'container' | 'page' | false
/** Dónde va la columna en la tarjeta del celular (`mobile="cards"`). */
export type DataTableMobilePlacement = 'primary' | 'secondary' | 'value' | 'meta' | 'hidden'

export type DataTableColumn<Row> = {
  id: string
  header: React.ReactNode
  cell: (row: Row, index: number) => React.ReactNode
  /** Derecha + cifras tabulares, también el encabezado. La plata va con `<Amount currency={false}>` y el «$» en el encabezado («Saldo $»). */
  numeric?: boolean
  align?: DataTableAlign
  /** `'8rem'` o `'20%'`. En `mobile="scroll"` también es el ancho mínimo. */
  width?: string
  /** Columna ordenable: la key viaja en `?orden=` (las fechas empiezan `desc`, los nombres `asc`). */
  sort?: { key: string; defaultDir?: SortDir }
  /** Celda de totales (fila con la regla contable). Con función, recibe las filas. */
  footer?: React.ReactNode | ((rows: Row[]) => React.ReactNode)
  /**
   * Lugar en la tarjeta del celular. Default: la primera columna es
   * `primary`; las `numeric` y la de acciones (`headerHidden`) van a `value`
   * (a la derecha) y el resto a `secondary`.
   */
  mobile?: DataTableMobilePlacement
  /** Esconde la columna por debajo de ese ancho (en `cards` solo importa `lg`: abajo de `md` van las tarjetas). */
  hideBelow?: DataTableBreakpoint
  /** Columna de acciones: el encabezado queda solo para lectores de pantalla. */
  headerHidden?: boolean
  /** Va en el encabezado y en las celdas. */
  className?: string
}

export type DataTableSelection = {
  /** Un `<input type="hidden" name value>` por fila elegida: con la tabla adentro de un `<form action>`, la acción masiva es un formulario común. */
  name?: string
  /** Sin `onSelectedChange`: lo elegido al cargar. Con `onSelectedChange` (solo desde un padre cliente): controlado. */
  selected?: string[]
  onSelectedChange?: (ids: string[]) => void
  /** Islas cliente que leen `useTableSelection()`: van en la barra «3 elegidos · … · Limpiar». */
  actions?: React.ReactNode
}

export type DataTableProps<Row> = Omit<React.ComponentProps<'div'>, 'children'> & {
  columns: DataTableColumn<Row>[]
  rows: Row[]
  getRowId: (row: Row) => string
  /** Nombre accesible de la tabla (y de la lista de tarjetas). Solo para lectores salvo `captionVisible`. */
  caption: string
  captionVisible?: boolean
  /** `comfortable` 44 px (listas, default) · `compact` 36 px (libros). */
  density?: DataTableDensity
  /** Default: `container` con `maxHeight`; si no, sin encabezado fijo. */
  stickyHeader?: DataTableStickyHeader
  /** Scroll interno; el encabezado fijo queda adentro. */
  maxHeight?: string
  /** Fila-link: el link estirado va en la celda principal. Una sola parada de Tab por fila. */
  rowHref?: (row: Row) => string | undefined
  /** El nombre de la fila («Coca-Cola»): etiqueta del link y de la casilla («Elegir Coca-Cola»). */
  rowLabel?: (row: Row) => string
  /** El orden actual, leído de `searchParams` con `parseSort`. */
  sort?: SortState
  /** Orden por link (server): `makeSortHref(pathname, searchParams)`. Gana sobre `onSortChange`. */
  sortHref?: (key: string, dir: SortDir) => string
  /** Orden en el cliente (`useTableSort`): solo desde un componente cliente. */
  onSortChange?: (key: string, dir: SortDir) => void
  selection?: DataTableSelection
  /** Filas de grupo (reservas por servicio o por día): agrupa filas SEGUIDAS con la misma key. */
  groupBy?: (row: Row) => { key: string; label: React.ReactNode }
  /**
   * Filas extra del `<tfoot>`, debajo de la de totales («Debe = Haber»). Son
   * filas de tabla: en `cards` el celular muestra solo los `footer` por
   * columna; si estas también hacen falta ahí, `mobile="scroll"`.
   */
  footerRows?: React.ReactNode
  /** Default `<EmptyState size="sm" title="Sin resultados" />`. Distinguí «sin datos todavía» de «sin resultados para el filtro». */
  empty?: React.ReactNode
  loading?: boolean
  error?: { message?: string; onRetry?: () => void } | null
  /**
   * Aviso de tope de PostgREST (corta en 1.000 filas en silencio). `true`
   * muestra el texto por defecto; un nodo, el propio («Mostramos los primeros
   * 1.000 movimientos. Acotá el período para ver todo.»).
   */
  truncated?: React.ReactNode
  /** `<DataTableToolbar>` con búsqueda, filtros y `ExportButton`. */
  toolbar?: React.ReactNode
  /** `<Pagination>`. */
  pagination?: React.ReactNode
  /** Default `cards` (listas): tarjetas debajo de `md`. `scroll` (libros): scroll horizontal y la primera columna fija. */
  mobile?: 'cards' | 'scroll'
}

// ─── Clases compartidas ──────────────────────────────────────────────────────

/**
 * La tabla.
 * - `border-separate border-spacing-0` con los bordes EN LAS CELDAS: con
 *   `border-collapse` (el del preflight) las celdas fijas pierden sus bordes
 *   al desplazarse y algunos navegadores no pintan `outline` en un `<tr>`.
 * - La densidad son variables (`--cell-px`, `--row-h`…) que heredan celdas,
 *   filas y encabezados, también los `<tr>` escritos a mano de las tablas
 *   viejas. Sin contexto de React: así los primitivos siguen server-safe.
 * - El pelo entre filas va en las celdas (un borde en un `<tr>` no se pinta
 *   con `border-separate`), sin el de la primera fila: ahí está el pelo del
 *   encabezado.
 */
const TABLE_CLASSES = [
  'w-full border-separate border-spacing-0 type-body text-foreground',
  '[--cell-px:1rem] [--cell-py:0.5rem] [--row-h:var(--row-comfortable)] [--head-h:2.25rem]',
  'data-[density=compact]:[--cell-px:0.75rem] data-[density=compact]:[--cell-py:0.375rem]',
  'data-[density=compact]:[--row-h:var(--row-compact)] data-[density=compact]:[--head-h:2rem]',
  '[&>tbody>tr>*]:border-t [&>tbody:first-of-type>tr:first-child>*]:border-t-0',
  // Grupo plegado (DataTableGroupRow collapsible): se esconden las demás filas de su <tbody>.
  '[&>tbody:has(>tr>th_[data-slot=data-table-group-toggle][aria-expanded=false])>tr:not([data-slot=data-table-group-row])]:hidden',
  // Con el encabezado fijo `page`, lo que se enfoca con Tab no queda abajo del encabezado (WCAG 2.4.11).
  '[&:has(>thead[data-sticky=page])_:is(tbody,tfoot)_:is(a[href],button,input,select,textarea)]:scroll-mt-9',
].join(' ')

/** Encabezado de columna: `bg-muted`, 36 px (32 en compacta), `type-label` en minúscula normal. */
const HEADER_CELL_CLASSES =
  'relative h-[var(--head-h,2.25rem)] border-b border-border-strong bg-muted px-[var(--cell-px,1rem)] py-1.5 text-start align-middle type-label text-muted-foreground'

const BODY_CELL_CLASSES =
  'px-[var(--cell-px,1rem)] py-[var(--cell-py,0.5rem)] text-start align-middle'

/** Sangría por nivel (`indent`): 12 px cada uno, como `AccountPicker`. */
const INDENT_CLASSES = 'ps-[calc(var(--cell-px,1rem)+var(--indent,0)*0.75rem)]'

/** Los controles de una fila-link quedan arriba del link estirado. */
const ABOVE_ROW_LINK =
  '[&:has([data-slot=data-table-row-link])_:is(a[href],button,input,select,textarea,[role=button],[role=checkbox]):not([data-slot=data-table-row-link])]:relative [&:has([data-slot=data-table-row-link])_:is(a[href],button,input,select,textarea,[role=button],[role=checkbox]):not([data-slot=data-table-row-link])]:z-10'

/**
 * Fila. Hover (`--hover`) y presionado (`--active`) solo si la fila es link o
 * se puede elegir, sin transición; van como capa (`background-image`) para
 * sumarse al fondo de una fila elegida en vez de taparlo. La fila elegida es
 * `bg-selected`, por la prop `selected` o porque su casilla está marcada.
 */
const ROW_CLASSES = [
  'group/row h-[var(--row-h,var(--row-comfortable))]',
  'has-[[data-slot=data-table-row-link]]:relative',
  'pointer-coarse:has-[[data-slot=data-table-row-link]]:h-11',
  ABOVE_ROW_LINK,
  'has-[[data-slot=data-table-row-link]]:hover:[background-image:linear-gradient(var(--hover),var(--hover))]',
  'data-[interactive]:hover:[background-image:linear-gradient(var(--hover),var(--hover))]',
  'has-[[data-slot=data-table-row-link]]:active:[background-image:linear-gradient(var(--active),var(--active))]',
  'data-[selected]:bg-selected has-[[data-row-select][aria-checked=true]]:bg-selected',
].join(' ')

/**
 * El link estirado de una fila (o de una tarjeta): su `::after` cubre la
 * fila entera, así toda la fila navega con una sola parada de Tab. El anillo
 * de foco se dibuja en ese `::after` («adentro», 2 px): es la misma caja que la
 * fila, lo pintan todos los navegadores (Safari no pinta `outline` en un
 * `<tr>`) y un `outline` sobrevive al alto contraste, donde un `box-shadow` se
 * borra.
 */
const ROW_LINK_CLASSES =
  'outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--ring)'

/** Columna de la casilla: 40 px. */
const SELECT_COLUMN_CLASSES = 'w-10 min-w-10 max-w-10 px-3'

/** Primera columna fija (`mobile="scroll"`): lleva fondo propio y, para hover y elegida, la misma capa que la fila. */
const STICKY_BODY_CLASSES = [
  'sticky z-20 bg-card',
  'group-data-[interactive]/row:group-hover/row:[background-image:linear-gradient(var(--hover),var(--hover))]',
  'group-has-[[data-slot=data-table-row-link]]/row:group-hover/row:[background-image:linear-gradient(var(--hover),var(--hover))]',
  'group-data-[selected]/row:[background-image:linear-gradient(var(--selected),var(--selected))]',
  'group-has-[[data-row-select][aria-checked=true]]/row:[background-image:linear-gradient(var(--selected),var(--selected))]',
].join(' ')

/** Encabezado de la columna fija: la esquina va arriba de todo (también con el encabezado fijo). */
const STICKY_HEAD_CLASSES = 'sticky z-40'

/** `hideBelow` sin saber qué `display` restaurar: se esconde solo por debajo del corte. */
const HIDE_BELOW: Readonly<Record<DataTableBreakpoint, string>> = {
  sm: 'max-sm:hidden',
  md: 'max-md:hidden',
  lg: 'max-lg:hidden',
}

function alignClass(numeric: boolean, align: DataTableAlign | undefined): string {
  const resolved = align ?? (numeric ? 'end' : 'start')
  if (resolved === 'end') return 'text-end'
  if (resolved === 'center') return 'text-center'
  return 'text-start'
}

const ARIA_SORT: Readonly<Record<SortDir | 'none', 'ascending' | 'descending' | 'none'>> = {
  asc: 'ascending',
  desc: 'descending',
  none: 'none',
}

// ─── Primitivos: contenedor ──────────────────────────────────────────────────

/**
 * La caja: `rounded-xl border bg-card overflow-clip`. No `overflow-hidden`:
 * crea un contenedor de scroll y el encabezado fijo `page` deja de pegarse al
 * viewport. `overflow: clip` recorta las esquinas sin eso.
 */
function DataTableShell({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="data-table-shell"
      className={cn('relative overflow-clip rounded-xl border border-border bg-card', className)}
      {...props}
    />
  )
}

export type DataTableScrollProps = React.ComponentProps<'div'> & {
  /** Scroll interno: el encabezado fijo `container` queda adentro. */
  maxHeight?: string
}

/** Scroll horizontal (y vertical con `maxHeight`). */
function DataTableScroll({ maxHeight, className, style, ...props }: DataTableScrollProps) {
  return (
    <div
      data-slot="data-table-scroll"
      className={cn('overflow-x-auto', maxHeight !== undefined && 'overflow-y-auto', className)}
      style={maxHeight !== undefined ? { ...style, maxHeight } : style}
      {...props}
    />
  )
}

export type DataTableRootProps = React.ComponentProps<'table'> & {
  /** `comfortable` 44 px (default) · `compact` 36 px. */
  density?: DataTableDensity
  /** Nombre accesible: un `<caption>` solo para lectores. Para uno visible, `DataTableCaption`. */
  caption?: React.ReactNode
}

/** La `<table>`, con su densidad. */
function DataTableRoot({
  density = 'comfortable',
  caption,
  className,
  children,
  ...props
}: DataTableRootProps) {
  return (
    <table
      data-slot="data-table-root"
      data-density={density}
      className={cn(TABLE_CLASSES, className)}
      {...props}
    >
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      {children}
    </table>
  )
}

/** `<caption>` visible (va primero adentro de la tabla). */
function DataTableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="data-table-caption"
      className={cn(
        'px-[var(--cell-px,1rem)] py-3 text-start type-small text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

// ─── Primitivos: encabezado ──────────────────────────────────────────────────

export type DataTableHeadProps = React.ComponentProps<'thead'> & {
  /** `true` (de antes) = `container`. `page` pega debajo del topbar. */
  sticky?: boolean | 'container' | 'page'
}

function DataTableHead({ sticky = false, className, ...props }: DataTableHeadProps) {
  const mode = sticky === true ? 'container' : sticky || undefined
  return (
    <thead
      data-slot="data-table-head"
      data-sticky={mode}
      className={cn(
        // Fijas las celdas, no el thead: es lo que más navegadores respetan, y
        // con border-separate cada celda se lleva su borde.
        mode && '[&>tr>th]:sticky [&>tr>th]:z-30 [&>tr>th[data-sticky-col]]:z-40',
        mode === 'container' && '[&>tr>th]:top-0',
        mode === 'page' && '[&>tr>th]:top-(--topbar-h)',
        className,
      )}
      {...props}
    />
  )
}

export type DataTableHeaderProps = Omit<React.ComponentProps<'th'>, 'align'> & {
  /** Derecha + cifras tabulares (la flecha de orden va adelante del texto). */
  numeric?: boolean
  align?: DataTableAlign
  width?: string
  /**
   * Orden de esta columna: `'asc'`/`'desc'` si es la ordenada, `null` si se
   * puede ordenar pero no es la actual. Sin `sort`, la columna no se ordena
   * (y no lleva `aria-sort`).
   */
  sort?: SortDir | null
  /** El sentido al tocarla. Default: el contrario del actual, o `asc`. */
  nextDir?: SortDir
  /** Orden por link (server): el link ya armado para `nextDir`. */
  sortHref?: string
  /** Orden en el cliente: solo desde un componente cliente. */
  onSort?: () => void
}

const SORT_CONTROL_CLASSES = cn(
  'group/sort inline-flex items-center gap-1 rounded-sm text-start text-muted-foreground hover:text-foreground',
  // Todo el encabezado es el objetivo; el anillo va «adentro» de la celda.
  ROW_LINK_CLASSES,
)

/**
 * `<th>`. Ordenable: lleva `aria-sort` (`ascending`, `descending` o `none`)
 * y su contenido es un `<Link>` (o un botón en modo cliente) con la flecha.
 */
function DataTableHeader({
  numeric = false,
  align,
  width,
  sort,
  nextDir,
  sortHref,
  onSort,
  scope = 'col',
  className,
  style,
  children,
  ...props
}: DataTableHeaderProps) {
  const sortable = sort !== undefined
  const next: SortDir = nextDir ?? (sort === 'asc' ? 'desc' : 'asc')
  const label = sortable ? (
    <>
      <span>{children}</span>
      <DataTableSortIndicator dir={sort} next={next} />
    </>
  ) : null
  const reversed = numeric || align === 'end'

  let content: React.ReactNode = children
  if (sortable && sortHref !== undefined) {
    content = (
      <Link
        href={sortHref}
        data-slot="data-table-sort"
        className={cn(
          SORT_CONTROL_CLASSES,
          reversed && 'flex-row-reverse',
          sort && 'text-foreground',
        )}
      >
        {label}
      </Link>
    )
  } else if (sortable && onSort !== undefined) {
    content = (
      <button
        type="button"
        data-slot="data-table-sort"
        onClick={onSort}
        className={cn(
          SORT_CONTROL_CLASSES,
          'cursor-pointer',
          reversed && 'flex-row-reverse',
          sort && 'text-foreground',
        )}
      >
        {label}
      </button>
    )
  } else if (sortable) {
    // Ordenada pero sin control (el orden lo fija la página): solo la flecha.
    content = (
      <span className={cn('inline-flex items-center gap-1', reversed && 'flex-row-reverse')}>
        {label}
      </span>
    )
  }

  return (
    <th
      data-slot="data-table-header"
      scope={scope}
      {...props}
      aria-sort={sortable ? ARIA_SORT[sort ?? 'none'] : props['aria-sort']}
      style={width !== undefined ? { ...style, width } : style}
      className={cn(
        HEADER_CELL_CLASSES,
        alignClass(numeric, align),
        numeric && 'type-amount',
        className,
      )}
    >
      {content}
    </th>
  )
}

// ─── Primitivos: cuerpo ──────────────────────────────────────────────────────

/** `<tbody>`. Cada grupo plegable va en el suyo. */
function DataTableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="data-table-body" className={className} {...props} />
}

export type DataTableGroupRowProps = Omit<React.ComponentProps<'tr'>, 'children'> & {
  label: React.ReactNode
  /** Cuántas columnas cubre (todas). */
  colSpan: number
  /** Un botón con `aria-expanded` pliega las demás filas de su `DataTableBody` (plan de cuentas). */
  collapsible?: boolean
  defaultOpen?: boolean
}

/**
 * Fila de grupo: `bg-muted/60 type-label`, con `<th scope="rowgroup">`. Va
 * primera adentro de su `DataTableBody` (el grupo es el `<tbody>`).
 */
function DataTableGroupRow({
  label,
  colSpan,
  collapsible = false,
  defaultOpen = true,
  className,
  ...props
}: DataTableGroupRowProps) {
  return (
    <tr data-slot="data-table-group-row" className={cn('bg-muted/60', className)} {...props}>
      <th
        scope="rowgroup"
        colSpan={colSpan}
        className="h-[var(--head-h,2.25rem)] px-[var(--cell-px,1rem)] py-1.5 text-start align-middle type-label text-foreground"
      >
        {collapsible ? (
          <DataTableGroupToggle defaultOpen={defaultOpen}>{label}</DataTableGroupToggle>
        ) : (
          label
        )}
      </th>
    </tr>
  )
}

export type DataTableRowProps = Omit<React.ComponentProps<'tr'>, 'onClick'> & {
  /**
   * Fila-link: el link estirado va en la celda `primary` (o en la primera
   * `DataTableCell`). Los demás controles de la fila quedan arriba solos.
   */
  href?: string
  /** Nombre accesible del link, si el contenido de la celda no alcanza. */
  linkLabel?: string
  /** Elegida: `bg-selected`. Con `DataTable selection` no hace falta (lo lee de la casilla). */
  selected?: boolean
  /** Hover aunque no sea link (filas que se eligen). */
  interactive?: boolean
  /**
   * @deprecated Un `onClick` en un `<tr>` no anda con teclado. Usá `href`
   * (fila-link) o un botón en una celda. Sigue andando por compatibilidad.
   */
  onClick?: React.MouseEventHandler<HTMLTableRowElement>
}

/** Pone el link de la fila en su celda principal (o en la primera). */
function withRowLink(children: React.ReactNode, href: string, linkLabel?: string): React.ReactNode {
  const items = React.Children.toArray(children)
  const isCell = (node: React.ReactNode): node is React.ReactElement<DataTableCellProps> =>
    React.isValidElement(node) && node.type === DataTableCell
  let target = items.findIndex((node) => isCell(node) && node.props.primary === true)
  if (target === -1) target = items.findIndex(isCell)
  if (target === -1) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[DataTableRow] `href` necesita una DataTableCell hija directa para poner el link de la fila.',
      )
    }
    return children
  }
  return items.map((node, index) =>
    index === target && isCell(node) ? React.cloneElement(node, { href, linkLabel }) : node,
  )
}

function DataTableRow({
  href,
  linkLabel,
  selected = false,
  interactive = false,
  onClick,
  className,
  children,
  ...props
}: DataTableRowProps) {
  return (
    <tr
      data-slot="data-table-row"
      data-selected={selected ? '' : undefined}
      data-interactive={interactive || onClick ? '' : undefined}
      onClick={onClick}
      className={cn(ROW_CLASSES, onClick && 'cursor-pointer', className)}
      {...props}
    >
      {href !== undefined ? withRowLink(children, href, linkLabel) : children}
    </tr>
  )
}

export type DataTableCellProps = Omit<React.ComponentProps<'td'>, 'align'> & {
  /** Derecha + cifras tabulares. */
  numeric?: boolean
  align?: DataTableAlign
  /** La columna principal: en tinta y 500. */
  primary?: boolean
  /** Nivel de sangría (12 px cada uno): plan de cuentas, Haber del diario. */
  indent?: number
  /** El contenido pasa a ser el link estirado de la fila. */
  href?: string
  linkLabel?: string
}

function DataTableCell({
  numeric = false,
  align,
  primary = false,
  indent,
  href,
  linkLabel,
  className,
  style,
  children,
  ...props
}: DataTableCellProps) {
  const cellStyle =
    indent !== undefined && indent > 0
      ? ({ ...style, '--indent': indent } as React.CSSProperties)
      : style
  return (
    <td
      data-slot="data-table-cell"
      className={cn(
        BODY_CELL_CLASSES,
        alignClass(numeric, align),
        numeric && 'type-amount',
        primary && 'font-medium text-foreground',
        indent !== undefined && indent > 0 && INDENT_CLASSES,
        className,
      )}
      style={cellStyle}
      {...props}
    >
      {href !== undefined ? (
        <Link
          href={href}
          data-slot="data-table-row-link"
          aria-label={linkLabel}
          className={ROW_LINK_CLASSES}
        >
          {children}
        </Link>
      ) : (
        children
      )}
    </td>
  )
}

// ─── Primitivos: pie ─────────────────────────────────────────────────────────

/**
 * `<tfoot>` con **la regla contable**: la primera fila con raya simple arriba
 * y la última con raya doble abajo, en las celdas. No `border-double`: aplica
 * a los cuatro lados y, con una sola fila de totales, haría doble también la
 * de arriba. Las cifras van en semibold; «Totales» en `type-label`.
 */
function DataTableFoot({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="data-table-foot"
      className={cn(
        '[&>tr]:h-[var(--row-h,var(--row-comfortable))] [&>tr>*]:font-semibold',
        '[&>tr:first-child>*]:border-t [&>tr:first-child>*]:border-t-rule',
        '[&>tr:last-child>*]:border-b-[3px] [&>tr:last-child>*]:[border-bottom-style:double] [&>tr:last-child>*]:border-b-rule',
        className,
      )}
      {...props}
    />
  )
}

/** La barra de abajo de la caja (la de antes): cuenta, notas, un paginador chico. */
function DataTableFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="data-table-footer"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 type-small text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

// ─── Primitivos: estados ─────────────────────────────────────────────────────

/** Una fila de ancho completo con `EmptyState size="sm"` (o lo que se pase). */
function DataTableEmpty({
  colSpan,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'tr'>, 'children'> & {
  colSpan: number
  children?: React.ReactNode
}) {
  return (
    <tr data-slot="data-table-empty" className={className} {...props}>
      <td colSpan={colSpan} className="p-0">
        {children ?? <EmptyState size="sm" title="Sin resultados" />}
      </td>
    </tr>
  )
}

const LOADING_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5'] as const

/** Filas esqueleto del alto de la densidad (el `aria-busy` lo pone la tabla). */
function DataTableLoading({ rows = 5, columns }: { rows?: number; columns: number }) {
  const rowIndexes = Array.from({ length: Math.max(0, Math.floor(rows)) }, (_, i) => i)
  const columnIndexes = Array.from({ length: Math.max(1, Math.floor(columns)) }, (_, i) => i)
  return rowIndexes.map((row) => (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: un <tr> sin tabindex no es enfocable; la fila esqueleto es decorativa y el «Cargando…» lo anuncia la tabla
    <tr
      key={`loading-${row.toString()}`}
      data-slot="data-table-loading"
      aria-hidden="true"
      className="h-[var(--row-h,var(--row-comfortable))]"
    >
      {columnIndexes.map((column) => (
        <td key={`loading-${row.toString()}-${column.toString()}`} className={BODY_CELL_CLASSES}>
          <Skeleton
            className={cn('h-3', LOADING_WIDTHS[(row + column) % LOADING_WIDTHS.length] ?? 'w-1/2')}
          />
        </td>
      ))}
    </tr>
  ))
}

/** Una fila con `ErrorState size="sm"` y «Reintentar» (este, solo desde un componente cliente). */
function DataTableError({
  colSpan,
  message,
  onRetry,
  ...props
}: Omit<React.ComponentProps<'tr'>, 'children'> & {
  colSpan: number
  message?: string
  onRetry?: () => void
}) {
  return (
    <tr data-slot="data-table-error" {...props}>
      <td colSpan={colSpan} className="p-0">
        <ErrorState size="sm" description={message} onRetry={onRetry} />
      </td>
    </tr>
  )
}

const DEFAULT_TRUNCATED =
  'Mostramos las primeras 1.000 filas. Acotá el período o los filtros para ver todo.'

/** El aviso de tope de 1.000 filas de PostgREST, arriba de la tabla. */
function DataTableTruncated({
  children,
  ...props
}: Omit<React.ComponentProps<typeof Callout>, 'tone'>) {
  return (
    <Callout data-slot="data-table-truncated" tone="warning" {...props}>
      {children ?? DEFAULT_TRUNCATED}
    </Callout>
  )
}

// ─── Barra de herramientas y exportar ────────────────────────────────────────

/**
 * Arriba de la tabla (sucesor de `FilterBar`): el buscador crece, después los
 * filtros y, a la derecha, «Exportar». Pone todos los controles en `sm`
 * (`ControlSizeProvider`): buscador, segmentado, chips, período y botones
 * miden lo mismo sin repetir la prop.
 */
function DataTableToolbar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <ControlSizeProvider size="sm">
      <div
        data-slot="data-table-toolbar"
        className={cn(
          'flex flex-wrap items-center gap-2',
          '[&>[data-slot=search-field]]:min-w-48 [&>[data-slot=search-field]]:flex-1',
          '[&>form:has([data-slot=search-field])]:min-w-48 [&>form:has([data-slot=search-field])]:flex-1',
          '[&>[data-slot=export-button]]:ms-auto',
          className,
        )}
        {...props}
      />
    </ControlSizeProvider>
  )
}

export type ExportButtonProps = Omit<React.ComponentProps<'a'>, 'children' | 'href'> & {
  /** El route handler que devuelve el CSV (`;` y BOM, para el Excel de la contadora). */
  href: string
  /** Default «Exportar». */
  label?: string
  /** Sin `size`, el de la barra (`sm` en `DataTableToolbar`). */
  size?: ButtonProps['size']
}

/**
 * Link de descarga (`<a download>`, no `<Link>`: un `<Link>` prefetchearía el
 * route handler). Va en `DataTableToolbar` o en las acciones del encabezado.
 */
function ExportButton({ href, label = 'Exportar', size, className, ...props }: ExportButtonProps) {
  return (
    <Button asChild variant="secondary" size={size} className={className}>
      <a href={href} download data-slot="export-button" {...props}>
        <Download aria-hidden="true" />
        {label}
      </a>
    </Button>
  )
}

// ─── DataTable declarativo ───────────────────────────────────────────────────

type RowEntry<Row> = { row: Row; index: number }
type RowGroup<Row> = {
  key: string
  label: React.ReactNode
  grouped: boolean
  items: RowEntry<Row>[]
}

/** Agrupa filas SEGUIDAS con la misma key, sin reordenar (el orden lo decide la consulta). */
function groupRows<Row>(
  rows: Row[],
  groupBy: ((row: Row) => { key: string; label: React.ReactNode }) | undefined,
): RowGroup<Row>[] {
  if (!groupBy) {
    return [
      {
        key: 'all',
        label: null,
        grouped: false,
        items: rows.map((row, index) => ({ row, index })),
      },
    ]
  }
  const groups: RowGroup<Row>[] = []
  rows.forEach((row, index) => {
    const { key, label } = groupBy(row)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push({ row, index })
    else groups.push({ key, label, grouped: true, items: [{ row, index }] })
  })
  return groups
}

/** La columna principal: la marcada `mobile: 'primary'`, si no la primera que se ve. */
function primaryColumnIndex<Row>(columns: DataTableColumn<Row>[]): number {
  const explicit = columns.findIndex((column) => column.mobile === 'primary')
  if (explicit !== -1) return explicit
  const visible = columns.findIndex((column) => column.mobile !== 'hidden' && !column.headerHidden)
  return visible === -1 ? 0 : visible
}

function placementOf<Row>(
  column: DataTableColumn<Row>,
  index: number,
  primaryIndex: number,
): DataTableMobilePlacement {
  if (index === primaryIndex) return 'primary'
  if (column.mobile) return column.mobile
  // Las acciones (`headerHidden`) van a la derecha de la tarjeta, como la plata.
  return column.numeric || column.headerHidden ? 'value' : 'secondary'
}

/** La celda en la tarjeta: con el encabezado solo para lectores, así «$ 1.234» no queda suelto. */
function CardItem({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="min-w-0">
      <span className="sr-only">{header}: </span>
      {children}
    </span>
  )
}

function CardLine({ items }: { items: Array<{ key: string; node: React.ReactNode }> }) {
  return items.map((item, index) => (
    <React.Fragment key={item.key}>
      {index > 0 ? <span aria-hidden="true">·</span> : null}
      {item.node}
    </React.Fragment>
  ))
}

const CARD_CLASSES = [
  'relative flex items-start gap-3 px-4 py-3',
  ABOVE_ROW_LINK,
  'has-[[data-slot=data-table-row-link]]:hover:[background-image:linear-gradient(var(--hover),var(--hover))]',
  'data-[interactive]:hover:[background-image:linear-gradient(var(--hover),var(--hover))]',
  'has-[[data-slot=data-table-row-link]]:active:[background-image:linear-gradient(var(--active),var(--active))]',
  'has-[[data-row-select][aria-checked=true]]:bg-selected',
].join(' ')

/**
 * Lista declarativa por columnas (ver el comentario de arriba del archivo).
 * Server-safe: se puede usar desde un Server Component.
 */
function DataTable<Row>({
  columns,
  rows,
  getRowId,
  caption,
  captionVisible = false,
  density = 'comfortable',
  stickyHeader,
  maxHeight,
  rowHref,
  rowLabel,
  sort,
  sortHref,
  onSortChange,
  selection,
  groupBy,
  footerRows,
  empty,
  loading = false,
  error = null,
  truncated,
  toolbar,
  pagination,
  mobile = 'cards',
  className,
  ...props
}: DataTableProps<Row>) {
  const cards = mobile === 'cards'
  // Con scroll interno el fijo va adentro: `page` no tiene sentido ahí.
  const sticky: DataTableStickyHeader =
    maxHeight !== undefined
      ? stickyHeader === false
        ? false
        : 'container'
      : (stickyHeader ?? false)
  const stickyFirst = mobile === 'scroll'
  const selectable = selection !== undefined
  const primaryIndex = primaryColumnIndex(columns)
  const columnCount = columns.length + (selectable ? 1 : 0)
  const state: 'error' | 'loading' | 'empty' | 'rows' = error
    ? 'error'
    : loading
      ? 'loading'
      : rows.length === 0
        ? 'empty'
        : 'rows'
  const ids = rows.map((row) => getRowId(row))
  const groups = groupRows(rows, groupBy)
  const hasColumnFooter = columns.some((column) => column.footer !== undefined)
  const showFooter = state === 'rows' && (hasColumnFooter || footerRows != null)
  const interactiveSort = sortHref !== undefined || onSortChange !== undefined
  const emptyNode = empty ?? <EmptyState size="sm" title="Sin resultados" />

  const stickyCellClass = (index: number, cell: 'head' | 'body' | 'foot') => {
    if (!stickyFirst || index !== 0) return undefined
    return cn(
      cell === 'head'
        ? STICKY_HEAD_CLASSES
        : cell === 'body'
          ? STICKY_BODY_CLASSES
          : 'sticky z-20 bg-card',
      selectable ? 'left-10' : 'left-0',
      'border-r border-r-border',
    )
  }
  const selectCellSticky = (cell: 'head' | 'body') =>
    stickyFirst
      ? cn(cell === 'head' ? STICKY_HEAD_CLASSES : STICKY_BODY_CLASSES, 'left-0')
      : undefined
  // En libros (scroll horizontal) cada columna tiene su ancho mínimo: si no, el
  // texto se aprieta hasta la palabra más larga.
  const minWidthClass = (column: DataTableColumn<Row>) =>
    stickyFirst && column.width === undefined
      ? column.numeric
        ? 'min-w-24'
        : 'min-w-32'
      : undefined

  const headerRow = (
    <tr>
      {selectable ? (
        <DataTableHeader
          className={cn(SELECT_COLUMN_CLASSES, selectCellSticky('head'))}
          data-sticky-col={stickyFirst ? '' : undefined}
        >
          <DataTableSelectAll />
        </DataTableHeader>
      ) : null}
      {columns.map((column, index) => {
        const key = column.sort?.key
        const current = key !== undefined && sort?.key === key ? sort.dir : null
        // Con control de orden, toda columna ordenable dice su estado; sin
        // control, solo la ordenada muestra su flecha.
        const columnSort =
          key === undefined ? undefined : interactiveSort ? current : (current ?? undefined)
        const next = key !== undefined ? nextSortDir(sort, key, column.sort?.defaultDir) : undefined
        return (
          <DataTableHeader
            key={column.id}
            numeric={column.numeric}
            align={column.align}
            width={column.width}
            sort={columnSort}
            nextDir={next}
            sortHref={
              key !== undefined && next !== undefined && sortHref ? sortHref(key, next) : undefined
            }
            onSort={
              key !== undefined && next !== undefined && !sortHref && onSortChange
                ? () => onSortChange(key, next)
                : undefined
            }
            data-sticky-col={stickyFirst && index === 0 ? '' : undefined}
            style={
              stickyFirst && column.width !== undefined ? { minWidth: column.width } : undefined
            }
            className={cn(
              column.hideBelow && HIDE_BELOW[column.hideBelow],
              stickyCellClass(index, 'head'),
              minWidthClass(column),
              column.className,
            )}
          >
            {column.headerHidden ? <span className="sr-only">{column.header}</span> : column.header}
          </DataTableHeader>
        )
      })}
    </tr>
  )

  const selectLabel = (row: Row, index: number) =>
    `Elegir ${rowLabel?.(row) ?? `la fila ${(index + 1).toString()}`}`

  const renderRow = ({ row, index }: RowEntry<Row>) => {
    const id = ids[index] ?? getRowId(row)
    const href = rowHref?.(row)
    const label = rowLabel?.(row)
    return (
      <DataTableRow key={id} interactive={selectable}>
        {selectable ? (
          <td className={cn(BODY_CELL_CLASSES, SELECT_COLUMN_CLASSES, selectCellSticky('body'))}>
            <DataTableRowSelect rowId={id} label={selectLabel(row, index)} />
          </td>
        ) : null}
        {columns.map((column, columnIndex) => (
          <DataTableCell
            key={column.id}
            numeric={column.numeric}
            align={column.align}
            primary={columnIndex === primaryIndex}
            href={columnIndex === primaryIndex ? href : undefined}
            linkLabel={columnIndex === primaryIndex ? label : undefined}
            className={cn(
              column.hideBelow && HIDE_BELOW[column.hideBelow],
              stickyCellClass(columnIndex, 'body'),
              column.className,
            )}
          >
            {column.cell(row, index)}
          </DataTableCell>
        ))}
      </DataTableRow>
    )
  }

  const body =
    state === 'rows' ? (
      groups.map((group, groupIndex) => (
        <DataTableBody key={`${groupIndex.toString()}:${group.key}`}>
          {group.grouped ? <DataTableGroupRow label={group.label} colSpan={columnCount} /> : null}
          {group.items.map(renderRow)}
        </DataTableBody>
      ))
    ) : (
      <DataTableBody>
        {state === 'loading' ? (
          <DataTableLoading columns={columnCount} />
        ) : state === 'error' ? (
          <DataTableError colSpan={columnCount} message={error?.message} onRetry={error?.onRetry} />
        ) : (
          <DataTableEmpty colSpan={columnCount}>{emptyNode}</DataTableEmpty>
        )}
      </DataTableBody>
    )

  const footer = showFooter ? (
    <DataTableFoot>
      {hasColumnFooter ? (
        <tr>
          {selectable ? (
            <td
              className={cn(
                BODY_CELL_CLASSES,
                SELECT_COLUMN_CLASSES,
                stickyFirst && 'sticky left-0 z-20 bg-card',
              )}
            />
          ) : null}
          {columns.map((column, index) => {
            const hide = column.hideBelow && HIDE_BELOW[column.hideBelow]
            if (index === 0 && column.footer === undefined) {
              return (
                <th
                  key={column.id}
                  scope="row"
                  className={cn(
                    BODY_CELL_CLASSES,
                    'text-foreground',
                    hide,
                    stickyCellClass(index, 'foot'),
                    column.className,
                  )}
                >
                  {/* El span lleva su propio peso: el pie pone semibold a las cifras. */}
                  <span className="type-label">Totales</span>
                </th>
              )
            }
            const content =
              typeof column.footer === 'function' ? column.footer(rows) : column.footer
            return (
              <DataTableCell
                key={column.id}
                numeric={column.numeric}
                align={column.align}
                className={cn(hide, stickyCellClass(index, 'foot'), column.className)}
              >
                {content}
              </DataTableCell>
            )
          })}
        </tr>
      ) : null}
      {footerRows}
    </DataTableFoot>
  ) : null

  const table = (
    <DataTableRoot
      density={density}
      caption={captionVisible ? undefined : caption}
      className={cn(cards && 'hidden md:table')}
    >
      {captionVisible ? (
        <DataTableCaption className="type-subtitle text-foreground">{caption}</DataTableCaption>
      ) : null}
      <DataTableHead sticky={sticky}>{headerRow}</DataTableHead>
      {body}
      {footer}
    </DataTableRoot>
  )

  // El scroll horizontal crea un contenedor de scroll y el fijo `page` dejaría
  // de pegarse al viewport: con `page` no hay scroll en escritorio.
  let framed: React.ReactNode
  if (maxHeight !== undefined)
    framed = <DataTableScroll maxHeight={maxHeight}>{table}</DataTableScroll>
  else if (sticky !== 'page') framed = <DataTableScroll>{table}</DataTableScroll>
  else if (!cards)
    framed = (
      <div data-slot="data-table-scroll" className="max-md:overflow-x-auto">
        {table}
      </div>
    )
  else framed = table

  const renderCard = ({ row, index }: RowEntry<Row>) => {
    const id = ids[index] ?? getRowId(row)
    const href = rowHref?.(row)
    const label = rowLabel?.(row)
    const lines: Record<
      'primary' | 'secondary' | 'value' | 'meta',
      Array<{ key: string; node: React.ReactNode }>
    > = { primary: [], secondary: [], value: [], meta: [] }
    columns.forEach((column, columnIndex) => {
      const placement = placementOf(column, columnIndex, primaryIndex)
      if (placement === 'hidden') return
      const content = column.cell(row, index)
      if (placement === 'primary') {
        lines.primary.push({
          key: column.id,
          node:
            columnIndex === primaryIndex && href !== undefined ? (
              <Link
                href={href}
                data-slot="data-table-row-link"
                aria-label={label}
                className={ROW_LINK_CLASSES}
              >
                {content}
              </Link>
            ) : (
              content
            ),
        })
        return
      }
      lines[placement].push({
        key: column.id,
        node: <CardItem header={column.header}>{content}</CardItem>,
      })
    })
    return (
      <li
        key={id}
        data-slot="data-table-card"
        data-interactive={selectable ? '' : undefined}
        className={CARD_CLASSES}
      >
        {selectable ? (
          <DataTableRowSelect rowId={id} label={selectLabel(row, index)} className="mt-0.5" />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {lines.primary.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-1.5 type-body font-medium text-foreground">
              <CardLine items={lines.primary} />
            </div>
          ) : null}
          {lines.secondary.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-1.5 type-small text-muted-foreground">
              <CardLine items={lines.secondary} />
            </div>
          ) : null}
          {lines.meta.length > 0 ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 type-caption text-muted-foreground">
              <CardLine items={lines.meta} />
            </div>
          ) : null}
        </div>
        {lines.value.length > 0 ? (
          <div className="flex shrink-0 flex-col items-end gap-0.5 text-end type-amount font-medium text-foreground">
            {lines.value.map((item) => (
              <React.Fragment key={item.key}>{item.node}</React.Fragment>
            ))}
          </div>
        ) : null}
      </li>
    )
  }

  // Celular (`cards`): la misma información como tarjetas-fila. Doble marcado,
  // CSS puro y correcto en SSR: la tabla es `hidden md:table` y esto `md:hidden`.
  let cardList: React.ReactNode = null
  if (cards && state === 'rows') {
    cardList = (
      <ul
        data-slot="data-table-cards"
        aria-label={caption}
        className="divide-y divide-border md:hidden"
      >
        {groups.map((group, groupIndex) =>
          group.grouped ? (
            <li key={`${groupIndex.toString()}:${group.key}`} data-slot="data-table-card-group">
              <div className="bg-muted/60 px-4 py-2 type-label text-foreground">{group.label}</div>
              <ul className="divide-y divide-border border-t border-border">
                {group.items.map(renderCard)}
              </ul>
            </li>
          ) : (
            group.items.map(renderCard)
          ),
        )}
      </ul>
    )
  } else if (cards) {
    cardList = (
      <div data-slot="data-table-cards" className="md:hidden">
        {state === 'loading' ? (
          <ul aria-hidden="true" className="divide-y divide-border">
            {[0, 1, 2].map((item) => (
              <li key={item} className="flex items-start gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-2.5 w-2/5" />
                </div>
                <Skeleton className="mt-1 h-3 w-16" />
              </li>
            ))}
          </ul>
        ) : state === 'error' ? (
          <ErrorState size="sm" description={error?.message} onRetry={error?.onRetry} />
        ) : (
          emptyNode
        )}
      </div>
    )
  }

  // Los totales por columna también en el celular, con la regla contable. Las
  // `footerRows` son filas de tabla: van solo en la tabla (con `mobile="scroll"`
  // se ven también en el celular).
  const cardTotals =
    cards && showFooter && hasColumnFooter ? (
      <div
        data-slot="data-table-cards-totals"
        className="border-t border-t-rule border-b-[3px] border-b-rule px-4 py-3 [border-bottom-style:double] md:hidden"
      >
        <p className="mb-1 type-label text-foreground">Totales</p>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
          {columns.map((column) =>
            column.footer === undefined ? null : (
              <React.Fragment key={column.id}>
                <dt className="type-small text-muted-foreground">{column.header}</dt>
                <dd className="text-end type-amount font-semibold text-foreground">
                  {typeof column.footer === 'function' ? column.footer(rows) : column.footer}
                </dd>
              </React.Fragment>
            ),
          )}
        </dl>
      </div>
    ) : null

  const content = (
    <>
      {toolbar}
      {truncated ? (
        <DataTableTruncated>{truncated === true ? undefined : truncated}</DataTableTruncated>
      ) : null}
      {selectable ? <DataTableSelectionBar actions={selection.actions} /> : null}
      <DataTableShell aria-busy={state === 'loading' ? true : undefined}>
        {state === 'loading' ? (
          <span role="status" className="sr-only">
            Cargando…
          </span>
        ) : null}
        {framed}
        {cardList}
        {cardTotals}
      </DataTableShell>
      {pagination}
    </>
  )

  return (
    <div
      data-slot="data-table"
      data-density={density}
      data-mobile={mobile}
      className={cn(
        'flex min-w-0 flex-col gap-3',
        // En el celular la barra de lo elegido va fija abajo: se reserva su lugar
        // para que no tape las últimas filas ni la paginación.
        'max-md:has-[[data-slot=data-table-selection-bar]]:pb-20',
        className,
      )}
      {...props}
    >
      {selectable ? (
        <DataTableSelectionProvider
          rowIds={ids}
          name={selection.name}
          selected={selection.selected}
          onSelectedChange={selection.onSelectedChange}
        >
          {content}
        </DataTableSelectionProvider>
      ) : (
        content
      )}
    </div>
  )
}

export type { TableSelection, UseTableSortResult } from '@/components/ui/data-table-client'
export {
  DataTableSelectionInputs,
  useTableSelection,
  useTableSort,
} from '@/components/ui/data-table-client'
export {
  DataTable,
  DataTableBody,
  DataTableCaption,
  DataTableCell,
  DataTableEmpty,
  DataTableError,
  DataTableFoot,
  DataTableFooter,
  DataTableGroupRow,
  DataTableHead,
  DataTableHeader,
  DataTableLoading,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
  DataTableShell,
  DataTableToolbar,
  DataTableTruncated,
  ExportButton,
}
