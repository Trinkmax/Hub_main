'use client'

import { Archive } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { normalizeSearchText } from '@/components/ui/combobox'
import {
  DataTable,
  type DataTableColumn,
  DataTableToolbar,
  ExportButton,
  useTableSelection,
  useTableSort,
} from '@/components/ui/data-table'
import { DueStatus } from '@/components/ui/due-status'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchField } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Pagination } from '@/components/ui/pagination'
import { Switch } from '@/components/ui/switch'
import type { SortAccessors } from '@/lib/table/sort'
import { CatalogBlock, CatalogFamily, DemoRow, DemoStack } from './catalog-block'
import { useCatalog } from './catalog-provider'
import { wait } from './demo-utils'
import { tourId } from './registry'
import {
  SAMPLE_SUPPLIERS,
  type SampleSupplier,
  sampleSuppliersCsv,
  supplierDueDate,
} from './sample-data'

// ─── Amount ──────────────────────────────────────────────────────────────────

const AMOUNT_CASES: ReadonlyArray<{ label: string; node: React.ReactNode }> = [
  { label: 'Positivo', node: <Amount cents={123_450} data-tour={tourId('amount')} /> },
  { label: 'Negativo (menos tipográfico)', node: <Amount cents={-123_450} tone="auto" /> },
  { label: 'Saldo deudor', node: <Amount cents={124_000_000} side="D" /> },
  { label: 'Saldo acreedor (auto)', node: <Amount cents={-76_350_000} side="auto" /> },
  { label: 'Sin centavos (KPIs)', node: <Amount cents={124_000_000} decimals={0} /> },
  { label: 'Dólares', node: <Amount cents={17_526} currency="USD" /> },
  {
    label: 'Sin $ (columna con $ en el encabezado)',
    node: <Amount cents={980_000} currency={false} />,
  },
  { label: 'Con signo siempre', node: <Amount cents={320_000} sign="always" tone="auto" /> },
  { label: 'Faltante (nunca $ 0)', node: <Amount cents={null} /> },
]

function AmountDemo() {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 type-body">
      {AMOUNT_CASES.map((item) => (
        <React.Fragment key={item.label}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="text-end">{item.node}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

// ─── DataTable ───────────────────────────────────────────────────────────────

/** Fijos a nivel de módulo: `useTableSort` los usa en un `useMemo`. */
const SORT_ACCESSORS: SortAccessors<SupplierRow> = {
  nombre: (row) => row.name,
  vence: (row) => row.dueDate,
  saldo: (row) => row.balanceCents,
}

type SupplierRow = SampleSupplier & { dueDate: string | null }

/** Una acción masiva: una isla que lee qué filas están elegidas. */
function MarkReviewed() {
  const selection = useTableSelection()
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        toast.success(
          selection.count === 1
            ? 'Marcaste 1 proveedor como revisado'
            : `Marcaste ${selection.count.toString()} proveedores como revisados`,
        )
        selection.clear()
      }}
    >
      <Archive aria-hidden="true" />
      Marcar revisados
    </Button>
  )
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const id = React.useId()
  return (
    <span className="flex items-center gap-2">
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onCheckedChange} />
      <Label htmlFor={id}>{label}</Label>
    </span>
  )
}

function DataTableDemo() {
  const { basePath, today, density: catalogDensity } = useCatalog()
  const [empty, setEmpty] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [selectable, setSelectable] = React.useState(true)
  const [compact, setCompact] = React.useState(catalogDensity === 'compact')
  const [totals, setTotals] = React.useState(true)
  const [truncated, setTruncated] = React.useState(false)
  const [query, setQuery] = React.useState('')

  // La densidad del encabezado manda hasta que se toca la de acá.
  const [lastCatalogDensity, setLastCatalogDensity] = React.useState(catalogDensity)
  if (catalogDensity !== lastCatalogDensity) {
    setLastCatalogDensity(catalogDensity)
    setCompact(catalogDensity === 'compact')
  }

  const allRows = React.useMemo<SupplierRow[]>(
    () =>
      SAMPLE_SUPPLIERS.map((supplier) => ({
        ...supplier,
        dueDate: supplierDueDate(supplier, today),
      })),
    [today],
  )
  const filtered = React.useMemo(() => {
    const q = normalizeSearchText(query.trim())
    if (q === '') return allRows
    return allRows.filter((row) => normalizeSearchText(row.name).includes(q))
  }, [allRows, query])
  const { rows, sort, onSortChange } = useTableSort(filtered, SORT_ACCESSORS, {
    key: 'saldo',
    dir: 'desc',
  })
  const csvHref = React.useMemo(() => sampleSuppliersCsv(), [])

  const columns: DataTableColumn<SupplierRow>[] = [
    {
      id: 'nombre',
      header: 'Proveedor',
      cell: (row) => row.name,
      sort: { key: 'nombre' },
    },
    {
      id: 'rubro',
      header: 'Rubro',
      cell: (row) => row.category,
      hideBelow: 'lg',
      mobile: 'meta',
    },
    {
      id: 'vence',
      header: 'Vence',
      cell: (row) => <DueStatus dueDate={row.dueDate} settled={row.settled} today={today} />,
      sort: { key: 'vence', defaultDir: 'asc' },
      mobile: 'secondary',
    },
    {
      id: 'saldo',
      header: 'Saldo $',
      numeric: true,
      cell: (row) => <Amount cents={row.balanceCents} currency={false} />,
      sort: { key: 'saldo', defaultDir: 'desc' },
      footer: totals
        ? (list) => (
            <Amount cents={list.reduce((acc, row) => acc + row.balanceCents, 0)} currency={false} />
          )
        : undefined,
    },
  ]

  return (
    <DemoStack>
      <DemoRow label="Interruptores del ejemplo" className="gap-x-5 gap-y-3">
        <ToggleRow label="Vacía" checked={empty} onCheckedChange={setEmpty} />
        <ToggleRow label="Cargando" checked={loading} onCheckedChange={setLoading} />
        <ToggleRow label="Error" checked={failed} onCheckedChange={setFailed} />
        <ToggleRow label="Selección" checked={selectable} onCheckedChange={setSelectable} />
        <ToggleRow label="Compacta" checked={compact} onCheckedChange={setCompact} />
        <ToggleRow label="Totales" checked={totals} onCheckedChange={setTotals} />
        <ToggleRow label="Tope de 1.000" checked={truncated} onCheckedChange={setTruncated} />
      </DemoRow>
      <DataTable
        data-tour={tourId('data-table')}
        caption="Proveedores"
        columns={columns}
        rows={empty ? [] : rows}
        getRowId={(row) => row.id}
        rowHref={() => `${basePath}#data-table`}
        rowLabel={(row) => row.name}
        density={compact ? 'compact' : 'comfortable'}
        sort={sort}
        onSortChange={onSortChange}
        loading={loading}
        error={
          failed
            ? {
                message: 'No pudimos cargar los proveedores.',
                onRetry: async () => {
                  await wait(800)
                  setFailed(false)
                },
              }
            : null
        }
        truncated={truncated}
        selection={selectable ? { actions: <MarkReviewed /> } : undefined}
        empty={
          <EmptyState
            size="sm"
            title={
              query ? 'No hay resultados con esta búsqueda' : 'Todavía no cargaste proveedores'
            }
            description={
              query
                ? 'Probá con otra búsqueda.'
                : 'Cargá el primero para llevar su cuenta corriente.'
            }
          />
        }
        toolbar={
          <DataTableToolbar data-tour={tourId('data-table-toolbar')}>
            <SearchField
              aria-label="Buscar proveedor"
              placeholder="Buscar por nombre"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
            />
            <ExportButton
              href={csvHref}
              download="proveedores-de-ejemplo.csv"
              data-tour={tourId('export-button')}
            />
          </DataTableToolbar>
        }
      />
    </DemoStack>
  )
}

// ─── Pagination ──────────────────────────────────────────────────────────────

function PaginationDemo() {
  const { basePath } = useCatalog()
  const hrefFor = (page: number) => `${basePath}#pagina-${page.toString()}`
  return (
    <DemoStack>
      <DemoRow label="Con total: «26–50 de 140» y los números" stack>
        <Pagination
          page={2}
          pageSize={25}
          total={140}
          hrefFor={hrefFor}
          label="Paginación de proveedores"
          data-tour={tourId('pagination')}
        />
      </DemoRow>
      <DemoRow label="Por cursor (sin total): solo anterior y siguiente" stack>
        <Pagination
          page={1}
          pageSize={25}
          hasNextPage
          hrefFor={hrefFor}
          label="Paginación de movimientos"
        />
      </DemoRow>
    </DemoStack>
  )
}

export function DataFamily() {
  return (
    <CatalogFamily id="datos">
      <CatalogBlock
        id="amount"
        purpose="Plata desde centavos, server-safe y sin `Intl`: `−$ 1.234,50`, con espacio duro y menos tipográfico."
        yes="Toda plata que se muestra. En saldos, `side` («1.240.000 A»); en columnas, `currency={false}` y el $ en el encabezado."
        no="`(cents / 100).toLocaleString()` o los `fmtCents` locales: el ICU del server y el del navegador dan cadenas distintas."
        usage={`<Amount cents={factura.totalCents} />
<Amount cents={saldo} side="auto" />          // 763.500,00 A
<Amount cents={importe} currency={false} />    // en una columna «Saldo $»`}
        a11y={[
          'La «A» o «D» de un saldo va oculta y al lado se lee «acreedor» o «deudor»: el `title` de un `abbr` no se lee de forma confiable.',
          'El faltante se ve «—» y se lee «sin dato». Nunca `$ 0`.',
          'El color acompaña (tono `auto`) y nunca es la única señal: el signo ya lo dice.',
        ]}
      >
        <AmountDemo />
      </CatalogBlock>

      <CatalogBlock
        id="data-table"
        compat="`table.tsx` re-exporta los primitivos con los nombres de shadcn, y `FilterBar` y `FilterSearch` son `DataTableToolbar` y `SearchField`. `DataTableRow onClick` no anda con teclado (`@deprecated`)."
        wide
        sample
        purpose="La tabla del panel: un solo aspecto, declarativa por columnas o con primitivos, ordenada y paginada por URL."
        yes="Toda lista. En el server, `sortHref` y `Pagination` por URL; en el cliente (como acá), `useTableSort`."
        no="Un `<ul>` en una tarjeta o una tabla hecha a mano. Con campos en las celdas, `mobile=&quot;scroll&quot;` (las tarjetas los duplicarían)."
        usage={`<DataTable
  caption="Proveedores"
  rows={rows}
  getRowId={(r) => r.id}
  rowHref={(r) => \`/\${slug}/proveedores/\${r.id}\`}
  rowLabel={(r) => r.name}
  sort={sort}
  sortHref={makeSortHref(\`/\${slug}/proveedores\`, sp)}
  columns={[
    { id: 'nombre', header: 'Proveedor', cell: (r) => r.name, sort: { key: 'nombre' } },
    { id: 'saldo', header: 'Saldo $', numeric: true, sort: { key: 'saldo', defaultDir: 'desc' },
      cell: (r) => <Amount cents={r.balanceCents} currency={false} />,
      footer: (rows) => <Amount cents={sum(rows)} currency={false} /> },
  ]}
  selection={{ name: 'ids', actions: <ArchiveSelected /> }}
  toolbar={<DataTableToolbar><SearchField /><ExportButton href={csv} /></DataTableToolbar>}
  pagination={<Pagination page={page} pageSize={25} total={total} hrefFor={pageHref} />}
/>`}
        a11y={[
          '`<table>` real con `<caption>`; el encabezado ordenable lleva `aria-sort` y su flecha cambia al instante.',
          'Fila-link: una sola parada de Tab por fila, con el anillo en toda la fila. Nunca `onClick` en un `<tr>`.',
          'Selección: «Elegir Distribuidora del Centro SA» en cada casilla, Mayús + click elige un rango y la barra anuncia «3 elegidos».',
          'En el celular las filas pasan a tarjetas (y la barra de lo elegido queda fija abajo); los totales siguen con la regla contable.',
        ]}
      >
        <DataTableDemo />
      </CatalogBlock>

      <CatalogBlock
        id="pagination"
        purpose="Paginación por URL: «1–25 de 702», números en escritorio y «Página 2 de 29» en el celular."
        yes="Debajo de una lista larga paginada en la consulta (`pageSlice` + `count: 'exact'`)."
        no="Listas chicas que entran enteras, o un «Cargar más» infinito."
        usage={`<Pagination page={page} pageSize={25} total={total}
  hrefFor={makePageHref(\`/\${slug}/proveedores\`, sp)} label="Paginación de proveedores" />`}
        a11y={[
          'Un `<nav>` con nombre; la página actual lleva `aria-current="page"` y relleno verde.',
          '«Anterior» y «Siguiente» deshabilitados son un `<span aria-disabled="true">`, nunca un link que igual navega.',
          'Los números miden 32 px y agrandan su área a 44 con el dedo.',
        ]}
      >
        <PaginationDemo />
      </CatalogBlock>
    </CatalogFamily>
  )
}
