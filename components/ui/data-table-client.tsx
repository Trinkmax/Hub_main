'use client'

import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react'
import { useLinkStatus } from 'next/link'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ControlSizeProvider } from '@/components/ui/control-size'
import {
  headerCheckedState,
  pruneSelection,
  selectAllRows,
  selectionLabel,
  selectRange,
  setRowSelected,
} from '@/lib/table/selection'
import { type SortAccessors, type SortDir, type SortState, sortRows } from '@/lib/table/sort'
import { cn } from '@/lib/utils'

/**
 * Las islas cliente de `DataTable` (kit HUB §3.6). La tabla en sí es
 * server-safe (sus funciones `cell` corren en el server); lo único que
 * necesita estado vive acá y recibe solo strings, ids y nodos, nunca una
 * función desde el server.
 *
 * - **Selección:** `DataTableSelectionProvider` guarda los ids elegidos; las
 *   casillas, la barra «3 elegidos · [acciones] · Limpiar» y los
 *   `<input type="hidden">` lo leen por contexto. Las acciones de la barra son
 *   islas propias que leen `useTableSelection()`.
 * - **Orden:** la flecha del encabezado (`DataTableSortIndicator`) cambia al
 *   instante con el click, sin esperar al render del server; y
 *   `useTableSort()` ordena en memoria las listas chicas de un componente
 *   cliente.
 * - **Grupos plegables:** el botón de la fila de grupo.
 *
 * Normalmente no se importa de acá: `DataTable` las usa solas y
 * `@/components/ui/data-table` re-exporta los hooks.
 */

// ─── Selección ───────────────────────────────────────────────────────────────

export type TableSelection = {
  /** Los ids elegidos que están en pantalla, en el orden de las filas. */
  selected: readonly string[]
  count: number
  /** Los ids de las filas en pantalla. */
  rowIds: readonly string[]
  isSelected: (id: string) => boolean
  /** Alterna una fila, o la fija con `checked`. */
  toggle: (id: string, checked?: boolean) => void
  selectAll: () => void
  clear: () => void
}

type SelectionContextValue = TableSelection & {
  /** El click de una casilla de fila: con `range` (Mayús) marca desde la última tocada. */
  setRowChecked: (id: string, checked: boolean, range: boolean) => void
}

const SelectionContext = React.createContext<SelectionContextValue | null>(null)

const NO_IDS: readonly string[] = []

function useSelectionContext(component: string): SelectionContextValue {
  const context = React.useContext(SelectionContext)
  if (!context) {
    throw new Error(
      `${component} tiene que ir adentro de una DataTable con \`selection\` (o de DataTableSelectionProvider).`,
    )
  }
  return context
}

/**
 * Para las acciones masivas de la barra (`selection.actions`): una isla
 * cliente que lee qué filas están elegidas.
 *
 * ```tsx
 * 'use client'
 * function ArchiveSelected() {
 *   const { count, clear } = useTableSelection()
 *   return <Button type="submit" formAction={archiveCustomers} onClick={…}>Archivar {count}</Button>
 * }
 * ```
 */
export function useTableSelection(): TableSelection {
  return useSelectionContext('useTableSelection')
}

export type DataTableSelectionProviderProps = {
  /** Los ids de las filas en pantalla, en orden (strings: cruzan la frontera RSC). */
  rowIds: readonly string[]
  /**
   * Con `name`, un `<input type="hidden" name value>` por fila elegida adentro
   * de la tabla: si la tabla va dentro de un `<form action={…}>`, la acción
   * masiva es un formulario común.
   */
  name?: string
  /**
   * Sin `onSelectedChange`: lo elegido al montar. Con `onSelectedChange`
   * (solo desde un padre cliente): el valor controlado.
   */
  selected?: readonly string[]
  onSelectedChange?: (ids: string[]) => void
  children: React.ReactNode
}

export function DataTableSelectionProvider({
  rowIds,
  name,
  selected,
  onSelectedChange,
  children,
}: DataTableSelectionProviderProps) {
  const controlled = onSelectedChange !== undefined
  const [inner, setInner] = React.useState<readonly string[]>(() => selected ?? NO_IDS)
  const raw = controlled ? (selected ?? NO_IDS) : inner
  // Si las filas cambian (otra página, otro filtro), lo que ya no se ve se
  // suelta: una acción masiva nunca toca filas que no están en pantalla.
  const current = React.useMemo(() => pruneSelection(rowIds, raw), [rowIds, raw])
  // La última fila tocada: el ancla del rango con Mayús.
  const anchor = React.useRef<string | null>(null)

  const value = React.useMemo<SelectionContextValue>(() => {
    const chosen = new Set(current)
    const commit = (next: string[]) => {
      if (!controlled) setInner(next)
      onSelectedChange?.(next)
    }
    return {
      selected: current,
      count: current.length,
      rowIds,
      isSelected: (id) => chosen.has(id),
      toggle: (id, checked) => {
        anchor.current = id
        commit(setRowSelected(rowIds, current, id, checked ?? !chosen.has(id)))
      },
      setRowChecked: (id, checked, range) => {
        const next = range
          ? selectRange(rowIds, current, anchor.current, id, checked)
          : setRowSelected(rowIds, current, id, checked)
        anchor.current = id
        commit(next)
      },
      selectAll: () => commit(selectAllRows(rowIds)),
      clear: () => {
        anchor.current = null
        commit([])
      },
    }
  }, [current, rowIds, controlled, onSelectedChange])

  return (
    <SelectionContext.Provider value={value}>
      {children}
      {name ? current.map((id) => <input key={id} type="hidden" name={name} value={id} />) : null}
    </SelectionContext.Provider>
  )
}

/**
 * Los `<input type="hidden">` de lo elegido, para un `<form>` propio adentro
 * de `selection.actions` (cuando la tabla no va dentro de un formulario).
 * Usá esto o `selection.name`, no los dos en el mismo formulario.
 */
export function DataTableSelectionInputs({ name }: { name: string }) {
  const { selected } = useSelectionContext('DataTableSelectionInputs')
  return selected.map((id) => <input key={id} type="hidden" name={name} value={id} />)
}

/**
 * La casilla de una fila. `data-row-select` es el gancho del CSS de la fila
 * (`bg-selected` con `:has([aria-checked=true])`), así la `<tr>` puede seguir
 * renderizándose en el server. Va con `z-10` para quedar arriba del link
 * estirado de una fila-link.
 */
export function DataTableRowSelect({
  rowId,
  label,
  className,
}: {
  rowId: string
  /** «Elegir Coca-Cola». */
  label: string
  className?: string
}) {
  const selection = useSelectionContext('DataTableRowSelect')
  // El Mayús viaja del click al cambio: Radix no le pasa el evento a onCheckedChange.
  const withShift = React.useRef(false)
  return (
    <Checkbox
      data-row-select=""
      aria-label={label}
      checked={selection.isSelected(rowId)}
      // Mayús + click en un botón extiende la selección de TEXTO de la página
      // hasta acá: se evita, el rango que importa es el de filas.
      onMouseDown={(event) => {
        if (event.shiftKey) event.preventDefault()
      }}
      onClick={(event) => {
        withShift.current = event.shiftKey
      }}
      onCheckedChange={(checked) => {
        selection.setRowChecked(rowId, checked === true, withShift.current)
        withShift.current = false
      }}
      className={cn('z-10', className)}
    />
  )
}

/** «Elegir todo», en el encabezado: vacía, con guion (algunas) o marcada (todas). */
export function DataTableSelectAll({
  label = 'Elegir todas las filas',
  className,
}: {
  label?: string
  className?: string
}) {
  const selection = useSelectionContext('DataTableSelectAll')
  const state = headerCheckedState(selection.rowIds, selection.selected)
  return (
    <Checkbox
      data-select-all=""
      aria-label={label}
      checked={state}
      disabled={selection.rowIds.length === 0}
      // Con guion o vacía elige todo; marcada, suelta todo.
      onCheckedChange={() => (state === true ? selection.clear() : selection.selectAll())}
      className={cn('z-10', className)}
    />
  )
}

/**
 * La barra de lo elegido: «3 elegidos · [acciones] · Limpiar». Arriba de la
 * tabla en escritorio y fija abajo en el celular. Aparece con la primera fila
 * elegida.
 *
 * La cuenta se anuncia desde una región `role="status"` que está siempre
 * montada (una región viva que aparece junto con su texto no se anuncia).
 */
export function DataTableSelectionBar({
  actions,
  className,
}: {
  /** Islas cliente que leen `useTableSelection()` (botones `sm` por defecto). */
  actions?: React.ReactNode
  className?: string
}) {
  const selection = useSelectionContext('DataTableSelectionBar')
  const label = selection.count > 0 ? selectionLabel(selection.count) : ''
  return (
    <>
      <span role="status" className="sr-only">
        {label}
      </span>
      {selection.count > 0 ? (
        <div
          data-slot="data-table-selection-bar"
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-2',
            // Celular: fija abajo, sobre la tabla, con el respiro del área segura.
            'max-md:fixed max-md:inset-x-4 max-md:bottom-[calc(1rem+env(safe-area-inset-bottom))] max-md:z-40 max-md:shadow-float',
            className,
          )}
        >
          <span aria-hidden="true" className="type-label tabular-nums text-foreground">
            {label}
          </span>
          {actions ? (
            <ControlSizeProvider size="sm">
              <div className="flex flex-wrap items-center gap-2">{actions}</div>
            </ControlSizeProvider>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ms-auto"
            onClick={selection.clear}
          >
            Limpiar
          </Button>
        </div>
      ) : null}
    </>
  )
}

// ─── Orden ───────────────────────────────────────────────────────────────────

/**
 * La flecha de un encabezado ordenable. Con orden por link la página se
 * vuelve a renderizar en el server: mientras tanto (`useLinkStatus`) la flecha
 * ya muestra el sentido nuevo, así responde al click. Nunca rota: una rotación
 * llegaría tarde, desconectada del click (§3.6). Las columnas que no son la
 * ordenada la muestran tenue al pasar el mouse o con el foco.
 */
export function DataTableSortIndicator({ dir, next }: { dir: SortDir | null; next: SortDir }) {
  // Afuera de un <Link> (orden en el cliente) devuelve siempre { pending: false }.
  const { pending } = useLinkStatus()
  const shown = pending ? next : dir
  const Icon = (shown ?? next) === 'asc' ? ArrowUp : ArrowDown
  return (
    <Icon
      aria-hidden="true"
      data-slot="data-table-sort-icon"
      className={cn(
        'size-3.5 shrink-0',
        shown
          ? 'opacity-100'
          : 'opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60',
      )}
    />
  )
}

export type UseTableSortResult<Row> = {
  rows: Row[]
  sort: SortState | undefined
  onSortChange: (key: string, dir: SortDir) => void
}

/**
 * Orden en memoria para un componente cliente con una lista chica (la que ya
 * vino entera). Para listas paginadas, el orden va por URL (`sortHref`).
 *
 * ```tsx
 * const { rows, sort, onSortChange } = useTableSort(items, { nombre: (r) => r.name, saldo: (r) => r.balanceCents })
 * <DataTable rows={rows} sort={sort} onSortChange={onSortChange} … />
 * ```
 *
 * Faltantes al final en los dos sentidos; textos sin tildes, «ñ» después de
 * «n» y números por su valor (`lib/table/sort.ts`).
 */
export function useTableSort<Row>(
  rows: Row[],
  accessors: SortAccessors<Row>,
  initial: SortState,
): UseTableSortResult<Row> & { sort: SortState }
export function useTableSort<Row>(
  rows: Row[],
  accessors: SortAccessors<Row>,
  initial?: SortState,
): UseTableSortResult<Row>
export function useTableSort<Row>(
  rows: Row[],
  accessors: SortAccessors<Row>,
  initial?: SortState,
): UseTableSortResult<Row> {
  const [sort, setSort] = React.useState<SortState | undefined>(initial)
  const sorted = React.useMemo(
    () => (sort ? sortRows(rows, accessors, sort) : rows),
    [rows, accessors, sort],
  )
  const onSortChange = React.useCallback((key: string, dir: SortDir) => setSort({ key, dir }), [])
  return { rows: sorted, sort, onSortChange }
}

// ─── Grupos plegables ────────────────────────────────────────────────────────

/**
 * El botón de una fila de grupo plegable (`DataTableGroupRow collapsible`).
 * Solo cambia `aria-expanded`: la tabla esconde por CSS las otras filas del
 * mismo `<tbody>` cuando el botón dice `false`, así las filas siguen viniendo
 * del server. Cada grupo plegable va en su propio `DataTableBody`.
 */
export function DataTableGroupToggle({
  defaultOpen = true,
  children,
}: {
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <button
      type="button"
      data-slot="data-table-group-toggle"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      className="-mx-1 inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-1 text-start outline-offset-2 outline-(--ring) focus-visible:outline-2"
    >
      <ChevronRight
        aria-hidden="true"
        className={cn(
          'size-3.5 shrink-0 text-muted-foreground transition-[rotate] duration-(--duration-quick) ease-(--ease-ui) motion-reduce:transition-none',
          open && 'rotate-90',
        )}
      />
      <span>{children}</span>
    </button>
  )
}
