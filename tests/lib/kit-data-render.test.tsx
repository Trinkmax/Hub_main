// @vitest-environment node
import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Amount } from '@/components/ui/amount'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  type DataTableColumn,
  DataTableFoot,
  DataTableFooter,
  DataTableGroupRow,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
  DataTableShell,
  DataTableToolbar,
  ExportButton,
  useTableSort,
} from '@/components/ui/data-table'
import { Pagination } from '@/components/ui/pagination'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { makePageHref } from '@/lib/table/pagination'
import { makeSortHref } from '@/lib/table/sort'

/**
 * Kit HUB §3.6 «Datos»: la tabla única en el HTML del server.
 *
 * Lo que se fija:
 * 1. `DataTable` declarativo: `aria-sort` y links de orden por URL, plata a la
 *    derecha con cifras tabulares, `<tfoot>` con la regla contable (raya
 *    simple arriba, doble abajo, en las celdas), fila-link con una sola
 *    parada de Tab, tarjetas del celular (doble marcado por CSS), selección
 *    con `<input type="hidden">` y los estados vacío, cargando, error y tope.
 * 2. `overflow-clip` y `border-separate` (riesgos 13 y 27 del kit).
 * 3. `Pagination` segura con links: los extremos deshabilitados son un
 *    `<span aria-disabled>`, nunca un link.
 * 4. Compatibilidad: los primitivos de antes (9 archivos) y los nombres de
 *    shadcn (`table.tsx`, 1 archivo) siguen armando una tabla.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    h('a', { href, ...rest }, children),
  useLinkStatus: () => ({ pending: false }),
}))

const render = (el: ReactElement) => renderToStaticMarkup(el)

/** Las etiquetas de apertura con `data-slot="<slot>"`, en orden. */
function slotTags(html: string, slot: string): string[] {
  return [...html.matchAll(new RegExp(`<[a-z0-9]+[^>]*data-slot="${slot}"[^>]*>`, 'g'))].map(
    (m) => m[0],
  )
}

/** React escapa `&`, `<`, `>` y comillas en los atributos: se leen como en el DOM. */
function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

function attrsOf(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k ?? '', unescapeHtml(v ?? '')]),
  )
}

/** Atributos del primer elemento con ese `data-slot`. */
const slotAttrs = (html: string, slot: string) => attrsOf(slotTags(html, slot)[0] ?? '')

const classesOf = (html: string, slot: string) =>
  new Set((slotAttrs(html, slot).class ?? '').split(/\s+/).filter(Boolean))

const count = (html: string, needle: string) => html.split(needle).length - 1

/** Los `<th>` del encabezado, con su texto visible. */
function headerCells(html: string): Array<{ attrs: Record<string, string>; text: string }> {
  return [...html.matchAll(/<th([^>]*data-slot="data-table-header"[^>]*)>([\s\S]*?)<\/th>/g)].map(
    ([, attrs, inner]) => ({
      attrs: attrsOf(attrs ?? ''),
      text: (inner ?? '').replace(/<[^>]+>/g, '').trim(),
    }),
  )
}

const tour = (id: string): object => ({ 'data-tour': id })

// ─── Datos de prueba ─────────────────────────────────────────────────────────

type Supplier = { id: string; name: string; cuit: string; due: string; balanceCents: number }

const SUPPLIERS: Supplier[] = [
  { id: 's1', name: 'Coca-Cola', cuit: '30-00000000-1', due: '15/10', balanceCents: 124000000 },
  { id: 's2', name: 'Arcor', cuit: '30-00000000-2', due: '20/10', balanceCents: 50050 },
  { id: 's3', name: 'Baggio', cuit: '30-00000000-3', due: '01/11', balanceCents: -1250 },
]

const sum = (rows: Supplier[]) => rows.reduce((acc, r) => acc + r.balanceCents, 0)

const COLUMNS: DataTableColumn<Supplier>[] = [
  { id: 'nombre', header: 'Proveedor', cell: (r) => r.name, sort: { key: 'nombre' } },
  { id: 'cuit', header: 'CUIT', cell: (r) => r.cuit, hideBelow: 'lg' },
  { id: 'vence', header: 'Vence', cell: (r) => r.due, sort: { key: 'vence', defaultDir: 'desc' } },
  {
    id: 'saldo',
    header: 'Saldo $',
    numeric: true,
    sort: { key: 'saldo', defaultDir: 'desc' },
    cell: (r) => <Amount cents={r.balanceCents} currency={false} />,
    footer: (rows) => <Amount cents={sum(rows)} currency={false} />,
  },
]

function suppliersTable(extra: Partial<Parameters<typeof DataTable<Supplier>>[0]> = {}) {
  return (
    <DataTable
      {...tour('proveedores-tabla')}
      caption="Proveedores"
      columns={COLUMNS}
      rows={SUPPLIERS}
      getRowId={(r) => r.id}
      rowHref={(r) => `/hub/proveedores/${r.id}`}
      rowLabel={(r) => r.name}
      sort={{ key: 'saldo', dir: 'desc' }}
      sortHref={makeSortHref('/hub/proveedores', { q: 'co', page: '2' })}
      {...extra}
    />
  )
}

// ─── DataTable: estructura y orden ───────────────────────────────────────────

describe('DataTable: tabla real con nombre y orden por URL', () => {
  const html = render(suppliersTable())

  it('pasa data-tour a la raíz y nombra la tabla con un caption solo para lectores', () => {
    expect(slotAttrs(html, 'data-table')['data-tour']).toBe('proveedores-tabla')
    expect(html).toContain('<caption class="sr-only">Proveedores</caption>')
  })

  it('aria-sort: la ordenada dice su sentido, las ordenables none, las demás nada', () => {
    const cells = headerCells(html)
    const byText = Object.fromEntries(cells.map((c) => [c.text, c.attrs]))
    expect(byText['Saldo $']?.['aria-sort']).toBe('descending')
    expect(byText.Proveedor?.['aria-sort']).toBe('none')
    expect(byText.Vence?.['aria-sort']).toBe('none')
    expect(byText.CUIT?.['aria-sort']).toBeUndefined()
    expect(cells.every((c) => c.attrs.scope === 'col')).toBe(true)
  })

  it('cada encabezado ordenable es un link al sentido siguiente, sin la página', () => {
    const hrefs = slotTags(html, 'data-table-sort').map((tag) => attrsOf(tag).href)
    expect(hrefs).toEqual([
      '/hub/proveedores?q=co&orden=nombre.asc',
      '/hub/proveedores?q=co&orden=vence.desc',
      '/hub/proveedores?q=co&orden=saldo.asc',
    ])
  })

  it('la plata va a la derecha con cifras tabulares, también el encabezado', () => {
    const saldo = headerCells(html).find((c) => c.text === 'Saldo $')
    expect(saldo?.attrs.class).toContain('text-end')
    expect(saldo?.attrs.class).toContain('type-amount')
    const amountCell = slotTags(html, 'data-table-cell').find((t) => t.includes('type-amount'))
    expect(amountCell).toContain('text-end')
    expect(html).toContain('1.240.000,00')
    expect(html).toContain('−12,50')
  })

  it('caja con overflow-clip (no hidden) y tabla border-separate (riesgos 13 y 27)', () => {
    const shell = classesOf(html, 'data-table-shell')
    expect(shell.has('overflow-clip')).toBe(true)
    expect(shell.has('overflow-hidden')).toBe(false)
    const table = classesOf(html, 'data-table-root')
    expect(table.has('border-separate')).toBe(true)
    expect(table.has('border-spacing-0')).toBe(true)
    expect(slotAttrs(html, 'data-table-root')['data-density']).toBe('comfortable')
  })

  it('hideBelow esconde la columna solo por debajo del corte', () => {
    const cuit = headerCells(html).find((c) => c.text === 'CUIT')
    expect(cuit?.attrs.class).toContain('max-lg:hidden')
  })
})

describe('DataTable: totales con la regla contable', () => {
  const html = render(suppliersTable())

  it('<tfoot> con raya simple arriba y doble abajo, en las celdas', () => {
    const foot = classesOf(html, 'data-table-foot')
    expect(foot.has('[&>tr:first-child>*]:border-t')).toBe(true)
    expect(foot.has('[&>tr:first-child>*]:border-t-rule')).toBe(true)
    expect(foot.has('[&>tr:last-child>*]:border-b-[3px]')).toBe(true)
    expect(foot.has('[&>tr:last-child>*]:[border-bottom-style:double]')).toBe(true)
    // Nunca border-double: doblaría también la raya de arriba.
    expect([...foot].some((c) => c.includes('border-double'))).toBe(false)
  })

  it('«Totales» es el encabezado de la fila y la suma sale de las filas', () => {
    const tfoot = html.slice(html.indexOf('<tfoot'), html.indexOf('</tfoot>'))
    expect(tfoot).toMatch(/<th scope="row"[^>]*><span class="type-label">Totales<\/span><\/th>/)
    // 1.240.000 + 500,50 − 12,50
    expect(tfoot).toContain('1.240.488,00')
  })

  it('en el celular los totales también se ven, con la misma regla', () => {
    const totals = classesOf(html, 'data-table-cards-totals')
    expect(totals.has('md:hidden')).toBe(true)
    expect(totals.has('[border-bottom-style:double]')).toBe(true)
    const block = html.slice(html.indexOf('data-slot="data-table-cards-totals"'))
    expect(block).toContain('<dt class="type-small text-muted-foreground">Saldo $</dt>')
  })
})

describe('DataTable: fila-link y tarjetas del celular', () => {
  const html = render(suppliersTable())

  it('la celda principal lleva el link estirado (tabla y tarjeta: una parada de Tab en cada vista)', () => {
    const links = slotTags(html, 'data-table-row-link')
    expect(links).toHaveLength(SUPPLIERS.length * 2)
    expect(attrsOf(links[0] ?? '').href).toBe('/hub/proveedores/s1')
    expect(attrsOf(links[0] ?? '')['aria-label']).toBe('Coca-Cola')
    expect(attrsOf(links[0] ?? '').class).toContain('after:inset-0')
    // El anillo va en el ::after (toda la fila), adentro.
    expect(attrsOf(links[0] ?? '').class).toContain('focus-visible:after:-outline-offset-2')
  })

  it('la fila-link es relative, pinta hover y presionado, y mide 44 px con el dedo', () => {
    const row = classesOf(html, 'data-table-row')
    expect(row.has('has-[[data-slot=data-table-row-link]]:relative')).toBe(true)
    expect(row.has('pointer-coarse:has-[[data-slot=data-table-row-link]]:h-11')).toBe(true)
    expect(
      row.has(
        'has-[[data-slot=data-table-row-link]]:active:[background-image:linear-gradient(var(--active),var(--active))]',
      ),
    ).toBe(true)
    // Nunca un onClick en el <tr>.
    expect(slotAttrs(html, 'data-table-row').onclick).toBeUndefined()
  })

  it('doble marcado por CSS: tabla desde md, tarjetas debajo', () => {
    expect(classesOf(html, 'data-table-root').has('hidden')).toBe(true)
    expect(classesOf(html, 'data-table-root').has('md:table')).toBe(true)
    const cards = slotAttrs(html, 'data-table-cards')
    expect(cards['aria-label']).toBe('Proveedores')
    expect(cards.class).toContain('md:hidden')
    expect(slotTags(html, 'data-table-card')).toHaveLength(SUPPLIERS.length)
  })

  it('en la tarjeta cada dato lleva su encabezado para el lector', () => {
    const card = html.slice(
      html.indexOf('data-slot="data-table-card"'),
      html.indexOf('</li>', html.indexOf('data-slot="data-table-card"')),
    )
    expect(card).toContain('<span class="sr-only">Saldo $: </span>')
    expect(card).toContain('<span class="sr-only">Vence: </span>')
  })
})

describe('DataTable: libros (mobile="scroll", compacta)', () => {
  const html = render(suppliersTable({ mobile: 'scroll', density: 'compact', rowHref: undefined }))

  it('sin tarjetas y con la tabla siempre visible, adentro de un scroll horizontal', () => {
    expect(html).not.toContain('data-slot="data-table-cards"')
    expect(classesOf(html, 'data-table-root').has('hidden')).toBe(false)
    expect(classesOf(html, 'data-table-scroll').has('overflow-x-auto')).toBe(true)
    expect(slotAttrs(html, 'data-table-root')['data-density']).toBe('compact')
  })

  it('la primera columna queda fija con su borde en la celda y anchos mínimos', () => {
    const first = headerCells(html)[0]
    expect(first?.attrs.class).toContain('sticky')
    expect(first?.attrs.class).toContain('left-0')
    expect(first?.attrs['data-sticky-col']).toBe('')
    const firstCell = slotTags(html, 'data-table-cell')[0] ?? ''
    expect(firstCell).toContain('border-r-border')
    expect(headerCells(html)[1]?.attrs.class).toContain('min-w-32')
  })
})

describe('DataTable: encabezado fijo', () => {
  it('con maxHeight el fijo queda adentro del scroll', () => {
    const html = render(suppliersTable({ maxHeight: '24rem' }))
    expect(slotAttrs(html, 'data-table-head')['data-sticky']).toBe('container')
    expect(slotAttrs(html, 'data-table-scroll').style).toContain('max-height:24rem')
  })

  it('page pega debajo del topbar y no mete un scroll horizontal en el medio', () => {
    const html = render(suppliersTable({ stickyHeader: 'page' }))
    const head = classesOf(html, 'data-table-head')
    expect(slotAttrs(html, 'data-table-head')['data-sticky']).toBe('page')
    expect(head.has('[&>tr>th]:top-(--topbar-h)')).toBe(true)
    expect(html).not.toContain('data-slot="data-table-scroll"')
  })
})

describe('DataTable: selección (islas cliente)', () => {
  const html = render(
    suppliersTable({ selection: { name: 'ids', selected: ['s2'] }, rowHref: undefined }),
  )

  it('cada fila tiene su casilla con nombre, y «elegir todo» queda con guion', () => {
    expect(count(html, 'aria-label="Elegir Coca-Cola"')).toBe(2) // tabla + tarjeta
    expect(html).toMatch(
      /aria-checked="mixed"[^>]*data-select-all=""|data-select-all=""[^>]*aria-checked="mixed"/,
    )
  })

  it('un hidden por elegida: la acción masiva es un <form action> común', () => {
    expect(count(html, '<input type="hidden" name="ids" value="s2"/>')).toBe(1)
    expect(html).not.toContain('value="s1"/>')
  })

  it('las filas que se eligen pintan hover y la elegida se ve por su casilla', () => {
    expect(slotAttrs(html, 'data-table-row')['data-interactive']).toBe('')
    expect(
      classesOf(html, 'data-table-row').has(
        'has-[[data-row-select][aria-checked=true]]:bg-selected',
      ),
    ).toBe(true)
  })

  it('aparece la barra con la cuenta y «Limpiar»', () => {
    const bar = html.slice(html.indexOf('data-slot="data-table-selection-bar"'))
    expect(bar).toContain('1 elegido')
    expect(bar).toContain('Limpiar')
    expect(html).toMatch(/<span role="status" class="sr-only">1 elegido<\/span>/)
  })
})

describe('DataTable: vacío, cargando, error y tope', () => {
  it('vacío: una fila de ancho completo con EmptyState (y el mismo en el celular)', () => {
    const html = render(suppliersTable({ rows: [] }))
    expect(html).toMatch(/<td colSpan="4" class="p-0">/)
    expect(count(html, 'Sin resultados')).toBe(2)
    expect(html).not.toContain('<tfoot')
  })

  it('cargando: filas esqueleto del alto de la densidad y aria-busy', () => {
    const html = render(suppliersTable({ loading: true }))
    expect(slotAttrs(html, 'data-table-shell')['aria-busy']).toBe('true')
    expect(slotTags(html, 'data-table-loading')).toHaveLength(5)
    expect(html).toContain('Cargando…')
    expect(html).not.toContain('Coca-Cola')
  })

  it('error: ErrorState chico con el mensaje', () => {
    const html = render(suppliersTable({ error: { message: 'Se cortó la conexión.' } }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('Se cortó la conexión.')
    expect(html).not.toContain('Coca-Cola')
  })

  it('tope de 1.000 filas: aviso arriba de la tabla', () => {
    const html = render(suppliersTable({ truncated: true }))
    expect(slotAttrs(html, 'data-table-truncated')['data-tone']).toBe('warning')
    expect(html).toContain('Mostramos las primeras 1.000 filas.')
    const custom = render(
      suppliersTable({
        truncated: 'Mostramos los primeros 1.000 movimientos. Acotá el período para ver todo.',
      }),
    )
    expect(custom).toContain('Mostramos los primeros 1.000 movimientos.')
  })
})

describe('DataTable: filas de grupo', () => {
  const html = render(
    suppliersTable({
      groupBy: (r) =>
        r.balanceCents > 100000
          ? { key: 'alto', label: 'Saldo alto' }
          : { key: 'bajo', label: 'Saldo bajo' },
    }),
  )

  it('cada grupo es su <tbody> con un <th scope="rowgroup">', () => {
    expect(count(html, '<tbody')).toBe(2)
    expect(html).toMatch(/<th scope="rowgroup" colSpan="4"[^>]*>Saldo alto<\/th>/)
    expect(html).toMatch(/<th scope="rowgroup" colSpan="4"[^>]*>Saldo bajo<\/th>/)
    expect(classesOf(html, 'data-table-group-row').has('bg-muted/60')).toBe(true)
  })

  it('en el celular los grupos son listas anidadas', () => {
    expect(slotTags(html, 'data-table-card-group')).toHaveLength(2)
  })
})

// ─── Orden en el cliente ─────────────────────────────────────────────────────

/** Un componente cliente con la lista entera en memoria (`useTableSort`). */
function ClientSortedSuppliers() {
  const { rows, sort, onSortChange } = useTableSort(
    SUPPLIERS,
    { nombre: (r) => r.name, saldo: (r) => r.balanceCents },
    { key: 'nombre', dir: 'asc' },
  )
  return (
    <DataTable
      caption="Proveedores"
      columns={COLUMNS}
      rows={rows}
      getRowId={(r) => r.id}
      sort={sort}
      onSortChange={onSortChange}
      mobile="scroll"
    />
  )
}

describe('DataTable: orden en el cliente (useTableSort)', () => {
  const html = render(<ClientSortedSuppliers />)

  it('las filas salen ordenadas por el orden inicial', () => {
    const names = [
      ...html.matchAll(/<td data-slot="data-table-cell"[^>]*font-medium[^>]*>([^<]+)</g),
    ]
    expect(names.map((m) => m[1])).toEqual(['Arcor', 'Baggio', 'Coca-Cola'])
  })

  it('los encabezados ordenables son botones y la ordenada dice su sentido', () => {
    const controls = slotTags(html, 'data-table-sort')
    expect(controls).toHaveLength(3)
    expect(controls.every((tag) => tag.startsWith('<button type="button"'))).toBe(true)
    const byText = Object.fromEntries(headerCells(html).map((c) => [c.text, c.attrs]))
    expect(byText.Proveedor?.['aria-sort']).toBe('ascending')
    expect(byText['Saldo $']?.['aria-sort']).toBe('none')
  })
})

describe('data-tour llega al DOM (anclajes de los tours, §3.0)', () => {
  it('en los primitivos de caja, la barra y la paginación', () => {
    const html = render(
      <div>
        <DataTableShell {...tour('shell')} />
        <DataTableScroll {...tour('scroll')} />
        <DataTableFooter {...tour('footer')} />
        <Pagination
          {...tour('paginacion')}
          page={1}
          pageSize={25}
          total={30}
          hrefFor={(p) => `/x?page=${p}`}
        />
      </div>,
    )
    expect(slotAttrs(html, 'data-table-shell')['data-tour']).toBe('shell')
    expect(slotAttrs(html, 'data-table-scroll')['data-tour']).toBe('scroll')
    expect(slotAttrs(html, 'data-table-footer')['data-tour']).toBe('footer')
    expect(slotAttrs(html, 'pagination')['data-tour']).toBe('paginacion')
  })
})

// ─── Barra y exportar ────────────────────────────────────────────────────────

describe('DataTableToolbar y ExportButton', () => {
  it('la barra pone los controles en sm y Exportar es un link de descarga', () => {
    const html = render(
      <DataTableToolbar {...tour('toolbar')}>
        <ExportButton href="/api/x/export?periodo=2026-09" />
      </DataTableToolbar>,
    )
    expect(slotAttrs(html, 'control-size')['data-size']).toBe('sm')
    expect(slotAttrs(html, 'data-table-toolbar')['data-tour']).toBe('toolbar')
    const exportLink = slotAttrs(html, 'export-button')
    expect(exportLink.href).toBe('/api/x/export?periodo=2026-09')
    expect(exportLink.download).toBe('')
    expect(html).toContain('Exportar')
  })
})

// ─── Pagination ──────────────────────────────────────────────────────────────

describe('Pagination: segura con links', () => {
  const hrefFor = makePageHref('/hub/clientes', { q: 'ana', page: '1' })

  it('en la primera página «Anterior» es un span deshabilitado, nunca un link', () => {
    const html = render(
      <Pagination
        page={1}
        pageSize={25}
        total={702}
        hrefFor={hrefFor}
        label="Paginación de clientes"
      />,
    )
    const prev = slotAttrs(html, 'pagination-prev')
    expect(slotTags(html, 'pagination-prev')[0]).toMatch(/^<span/)
    expect(prev['aria-disabled']).toBe('true')
    expect(prev.href).toBeUndefined()
    const next = slotAttrs(html, 'pagination-next')
    expect(next.href).toBe('/hub/clientes?q=ana&page=2')
    expect(next.rel).toBe('next')
    expect(slotAttrs(html, 'pagination')['aria-label']).toBe('Paginación de clientes')
  })

  it('«1–25 de 702», la actual con aria-current y relleno verde, y «…»', () => {
    const html = render(<Pagination page={1} pageSize={25} total={702} hrefFor={hrefFor} />)
    expect(html).toContain('1–25 de 702')
    const current = slotTags(html, 'pagination-page').find((t) => t.includes('aria-current="page"'))
    expect(current).toContain('bg-primary')
    expect(attrsOf(current ?? '').href).toBe('/hub/clientes?q=ana')
    expect(html).toContain('<li aria-hidden="true"')
    expect(html).toContain('Página 1 de 29')
  })

  it('en la última página «Siguiente» se deshabilita y «Anterior» lleva rel="prev"', () => {
    const html = render(<Pagination page={29} pageSize={25} total={702} hrefFor={hrefFor} />)
    expect(slotTags(html, 'pagination-next')[0]).toMatch(/^<span/)
    expect(slotAttrs(html, 'pagination-prev').rel).toBe('prev')
    expect(slotAttrs(html, 'pagination-prev').href).toBe('/hub/clientes?q=ana&page=28')
    expect(html).toContain('701–702 de 702')
  })

  it('sin total (por cursor): «Página 3» y el siguiente según hasNextPage', () => {
    const html = render(<Pagination page={3} pageSize={25} hasNextPage hrefFor={hrefFor} />)
    expect(html).toContain('Página 3')
    expect(html).not.toContain('data-slot="pagination-page"')
    expect(slotAttrs(html, 'pagination-next').href).toBe('/hub/clientes?q=ana&page=4')
    const last = render(<Pagination page={3} pageSize={25} hrefFor={hrefFor} />)
    expect(slotTags(last, 'pagination-next')[0]).toMatch(/^<span/)
  })
})

// ─── Compatibilidad ──────────────────────────────────────────────────────────

describe('Compatibilidad: los primitivos de antes', () => {
  const html = render(
    <DataTableShell>
      <header>Destinatarios</header>
      <DataTableScroll>
        <DataTableRoot>
          <DataTableHead sticky>
            <tr>
              <DataTableHeader>Cliente</DataTableHeader>
              <DataTableHeader className="hidden md:table-cell">Teléfono</DataTableHeader>
              <DataTableHeader className="text-right">Puntos</DataTableHeader>
              <DataTableHeader className="w-8" />
            </tr>
          </DataTableHead>
          <DataTableBody>
            <tr className="transition-colors hover:bg-secondary/40">
              <DataTableCell className="font-medium">Ana</DataTableCell>
              <DataTableCell className="hidden md:table-cell">351</DataTableCell>
              <DataTableCell className="text-right">12</DataTableCell>
              <DataTableCell />
            </tr>
            <DataTableRow className="bg-success/10">
              <DataTableCell colSpan={4}>Todavía no hay destinatarios para mostrar.</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTableRoot>
      </DataTableScroll>
      <DataTableFooter>
        <span>2 reservas</span>
      </DataTableFooter>
    </DataTableShell>,
  )

  it('arma la misma tabla, con el encabezado nuevo y los className de antes', () => {
    expect(html).toContain('<header>Destinatarios</header>')
    expect(slotAttrs(html, 'data-table-head')['data-sticky']).toBe('container')
    const cells = headerCells(html)
    expect(cells.map((c) => c.text)).toEqual(['Cliente', 'Teléfono', 'Puntos', ''])
    // El className de antes gana (cn): text-right en vez de text-start.
    expect(cells[2]?.attrs.class).toContain('text-right')
    expect(cells[2]?.attrs.class).not.toContain('text-start')
    // Minúscula normal: se fue el 11 px en mayúsculas espaciadas.
    expect(cells[0]?.attrs.class).toContain('type-label')
    expect(cells[0]?.attrs.class).not.toContain('uppercase')
    // React 19 escribe colSpan con mayúscula: los atributos HTML no distinguen.
    expect(html).toContain('colSpan="4"')
    expect(classesOf(html, 'data-table-footer').has('type-small')).toBe(true)
  })

  it('una fila común no pinta hover ni es clickeable', () => {
    const row = slotAttrs(html, 'data-table-row')
    expect(row['data-interactive']).toBeUndefined()
    expect(row.class).toContain('bg-success/10')
  })

  it('DataTableRow href pone el link en la celda principal', () => {
    const row = render(
      <table>
        <tbody>
          <DataTableRow href="/hub/clientes/1">
            <DataTableCell>12/10</DataTableCell>
            <DataTableCell primary>Ana Pérez</DataTableCell>
          </DataTableRow>
        </tbody>
      </table>,
    )
    expect(row).toMatch(
      /<td[^>]*font-medium[^>]*><a href="\/hub\/clientes\/1" data-slot="data-table-row-link"[^>]*>Ana Pérez<\/a><\/td>/,
    )
    expect(count(row, 'data-slot="data-table-row-link"')).toBe(1)
  })

  it('DataTableGroupRow y DataTableFoot como primitivos', () => {
    const table = render(
      <DataTableRoot density="compact" caption="Plan de cuentas">
        <DataTableBody>
          <DataTableGroupRow label="1 ACTIVO" colSpan={2} collapsible />
          <tr>
            <DataTableCell indent={2}>1.1.01 Caja</DataTableCell>
            <DataTableCell numeric>10,00</DataTableCell>
          </tr>
        </DataTableBody>
        <DataTableFoot>
          <tr>
            <DataTableCell>Totales</DataTableCell>
            <DataTableCell numeric>10,00</DataTableCell>
          </tr>
        </DataTableFoot>
      </DataTableRoot>,
    )
    expect(table).toMatch(/data-slot="data-table-group-toggle" aria-expanded="true"/)
    expect(table).toContain('--indent:2')
    expect(table).toContain('<tfoot data-slot="data-table-foot"')
    expect(table).toContain('<caption class="sr-only">Plan de cuentas</caption>')
  })
})

describe('Compatibilidad: los nombres de shadcn (table.tsx)', () => {
  const html = render(
    <Table>
      <TableCaption>Lista accesible de todas las mesas físicas.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Mesa</TableHead>
          <TableHead scope="col" className="text-right">
            Acciones
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">M1</TableCell>
          <TableCell>
            <button type="button">Imprimir QR</button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  )

  it('son los primitivos de DataTable con el caption visible abajo', () => {
    expect(slotAttrs(html, 'table-container').class).toContain('overflow-x-auto')
    expect(classesOf(html, 'data-table-root').has('caption-bottom')).toBe(true)
    expect(html).toContain('Lista accesible de todas las mesas físicas.')
    expect(slotAttrs(html, 'data-table-caption').class).toContain('type-small')
    expect(headerCells(html).map((c) => c.text)).toEqual(['Mesa', 'Acciones'])
    expect(html).toContain('Imprimir QR')
  })
})
