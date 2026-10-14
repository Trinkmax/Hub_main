import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { type ExportBook, MONTH_PACKAGE_BOOKS } from '@/lib/accounting/queries/labels'
import { cn } from '@/lib/utils'
import { type BookPeriod, bookPeriodParams } from '../_lib/book-nav'
import { bookExport, type PackageMonth } from '../_lib/package'
import { bookHref } from '../_lib/periods'
import { ExportButton } from './export-button'

/**
 * El índice de los libros de un mes: UN solo listado que funde las diez
 * tarjetas de antes y la lista de quince descargas. Cada renglón es un libro:
 * su nombre, una línea que dice qué trae, cuántos registros tiene, «Ver» y el
 * botón de exportarlo.
 *
 * Los conteos llegan DESPUÉS: el índice se pinta sin esperarlos (son ~14
 * lecturas) y cada cifra aparece en su lugar; si el conteo falla queda «—» y el
 * índice sigue andando. Server-safe (los conteos son un componente async).
 */

type IndexEntry = {
  key: string
  title: string
  line: string
  /** La pantalla del libro, relativa a `/libros`. `null` = solo se exporta. */
  view: { path: string; params?: Record<string, string>; period: 'mes' | 'rango' } | null
  /** El archivo que se exporta desde el renglón. */
  libro: ExportBook
  /** Un renglón chico debajo de otro (las alícuotas de un Libro IVA). */
  sub?: boolean
}

type IndexGroup = {
  key: string
  title: string
  /** Plegado para el dueño (es herramienta de la contadora); ella lo ve abierto. */
  foldForOwner: boolean
  entries: IndexEntry[]
}

/**
 * El orden es también el de las dos columnas de la compu: «Lo de todos los días» y «Control» a la
 * izquierda; «IVA» y los dos plegados de la contadora a la derecha. Con «Control» al final, la
 * columna derecha quedaba con tres renglones contra ocho.
 */
const GROUPS: readonly IndexGroup[] = [
  {
    key: 'diario',
    title: 'Lo de todos los días',
    foldForOwner: false,
    entries: [
      {
        key: 'diario',
        title: 'Libro diario',
        line: 'Todo lo que se anotó, en orden.',
        view: { path: 'diario', period: 'rango' },
        libro: 'diario',
      },
      {
        key: 'mayor',
        title: 'Mayor',
        line: 'Los movimientos de cada cuenta, con su saldo.',
        view: { path: 'mayor', period: 'rango' },
        libro: 'mayor-general',
      },
      {
        key: 'sumas-y-saldos',
        title: 'Sumas y saldos',
        line: 'El saldo de todas las cuentas al cierre del mes.',
        view: { path: 'sumas-y-saldos', period: 'rango' },
        libro: 'sumas-y-saldos',
      },
    ],
  },
  {
    key: 'control',
    title: 'Control',
    foldForOwner: false,
    entries: [
      {
        key: 'historia',
        title: 'Historia',
        line: 'Quién cargó, anuló o cerró qué.',
        view: { path: 'historia', period: 'rango' },
        libro: 'historia',
      },
    ],
  },
  {
    key: 'iva',
    title: 'IVA',
    foldForOwner: false,
    entries: [
      {
        key: 'iva-compras',
        title: 'Libro IVA compras',
        line: 'Tus compras con factura.',
        view: { path: 'iva-compras', period: 'mes' },
        libro: 'iva-compras',
      },
      {
        key: 'iva-compras-alicuotas',
        title: 'Alícuotas de compras',
        line: 'Una fila por comprobante y alícuota.',
        view: null,
        libro: 'iva-compras-alicuotas',
        sub: true,
      },
      {
        key: 'iva-ventas',
        title: 'Libro IVA ventas',
        line: 'Lo que vendiste con factura.',
        view: { path: 'iva-ventas', period: 'mes' },
        libro: 'iva-ventas',
      },
      {
        key: 'iva-ventas-alicuotas',
        title: 'Alícuotas de ventas',
        line: 'Una fila por comprobante y alícuota.',
        view: null,
        libro: 'iva-ventas-alicuotas',
        sub: true,
      },
      {
        key: 'posicion-iva',
        title: 'Posición de IVA',
        line: 'Cuánto IVA da el mes (estimado).',
        view: { path: 'posicion-iva', period: 'mes' },
        libro: 'posicion-iva',
      },
    ],
  },
  {
    key: 'subdiarios',
    title: 'Subdiarios',
    foldForOwner: true,
    entries: [
      {
        key: 'sub-compras',
        title: 'Compras',
        line: 'Facturas, notas y gastos de contado.',
        view: { path: 'subdiarios', params: { tipo: 'compras' }, period: 'rango' },
        libro: 'subdiario-compras',
      },
      {
        key: 'sub-pagos',
        title: 'Pagos',
        line: 'Lo que se les pagó a proveedores y organismos.',
        view: { path: 'subdiarios', params: { tipo: 'pagos' }, period: 'rango' },
        libro: 'subdiario-pagos',
      },
      {
        key: 'sub-ventas',
        title: 'Ventas',
        line: 'Los cierres del día y las facturas sueltas.',
        view: { path: 'subdiarios', params: { tipo: 'ventas' }, period: 'rango' },
        libro: 'subdiario-ventas',
      },
      {
        key: 'sub-ventas-medios',
        title: 'Ventas por medio',
        line: 'Lo vendido con cada medio de cobro, día por día.',
        view: { path: 'subdiarios', params: { tipo: 'ventas-por-medio' }, period: 'rango' },
        libro: 'subdiario-ventas-medios',
      },
      {
        key: 'sub-cobranzas',
        title: 'Cobranzas',
        line: 'Lo que entró de tarjetas, apps y clientes, con sus descuentos.',
        view: { path: 'subdiarios', params: { tipo: 'cobranzas' }, period: 'rango' },
        libro: 'subdiario-cobranzas',
      },
      {
        key: 'sub-cajas',
        title: 'Cajas y bancos',
        line: 'Lo que entró y salió de cada caja o cuenta.',
        view: { path: 'subdiarios', params: { tipo: 'cajas' }, period: 'rango' },
        libro: 'subdiario-disponibilidades',
      },
    ],
  },
  {
    key: 'saldos',
    title: 'Saldos al cierre',
    foldForOwner: true,
    entries: [
      {
        key: 'saldos-proveedores',
        title: 'Saldos de proveedores',
        line: 'Cuánto se le debe a cada uno.',
        view: null,
        libro: 'saldos-proveedores',
      },
      {
        key: 'saldos-clientes',
        title: 'Saldos de clientes',
        line: 'Cuánto falta cobrar.',
        view: null,
        libro: 'saldos-clientes',
      },
    ],
  },
]

/** Lo que se sabe de cuántos registros trae cada archivo (`null` si la lectura falló). */
export type BookCounts = ReadonlyMap<ExportBook, string | null> | null

const GROUP_TITLE = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground'

export function BookIndex({
  tenantSlug,
  booksPath,
  month,
  today,
  hasCuit,
  counts,
  /** La contadora ve todos los grupos abiertos. */
  openAll,
}: {
  tenantSlug: string
  /** `/<bar>/administracion/libros`. */
  booksPath: string
  month: PackageMonth
  today: string
  hasCuit: boolean
  /** La promesa de los conteos: cada renglón la espera en su propio `Suspense`. */
  counts: Promise<BookCounts>
  openAll: boolean
}) {
  const period: BookPeriod = { kind: 'month', month: month.month, from: month.from, to: month.to }
  return (
    <div className="gap-x-10 lg:columns-2">
      {GROUPS.map((group) => {
        const list = (
          <ul className="divide-y divide-border/50">
            {group.entries.map((entry) => (
              <IndexRow
                key={entry.key}
                entry={entry}
                tenantSlug={tenantSlug}
                booksPath={booksPath}
                month={month}
                period={period}
                today={today}
                hasCuit={hasCuit}
                counts={counts}
              />
            ))}
          </ul>
        )
        if (!group.foldForOwner) {
          return (
            <section key={group.key} className="mb-5 break-inside-avoid">
              <h3 className={cn(GROUP_TITLE, 'mb-1')}>{group.title}</h3>
              {list}
            </section>
          )
        }
        return (
          <details key={group.key} open={openAll} className="group/fold mb-5 break-inside-avoid">
            <summary
              className={cn(
                GROUP_TITLE,
                'flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-9 [&::-webkit-details-marker]:hidden',
              )}
            >
              <ChevronDown
                aria-hidden
                className="size-3.5 -rotate-90 transition-transform duration-(--duration-fast) group-open/fold:rotate-0 motion-reduce:transition-none"
              />
              {group.title}
              <span className="text-[11px] font-normal normal-case tracking-normal tabular-nums">
                · {group.entries.length} libros
              </span>
            </summary>
            {list}
          </details>
        )
      })}
    </div>
  )
}

function IndexRow({
  entry,
  tenantSlug,
  booksPath,
  month,
  period,
  today,
  hasCuit,
  counts,
}: {
  entry: IndexEntry
  tenantSlug: string
  booksPath: string
  month: PackageMonth
  period: BookPeriod
  today: string
  hasCuit: boolean
  counts: Promise<BookCounts>
}) {
  const file = bookExport(tenantSlug, entry.libro, month, today)
  const blocked = file.needsCuit && !hasCuit
  const viewHref = entry.view
    ? bookHref(`${booksPath}/${entry.view.path}`, {
        ...entry.view.params,
        ...bookPeriodParams({ period: entry.view.period }, period),
      })
    : null
  // Solo se cuentan los archivos del paquete (y la posición es una sola hoja: no tiene cuenta).
  // Sumas y saldos tampoco: su archivo trae TODAS las cuentas del plan («229 cuentas»), y la
  // pantalla cuenta las que tuvieron movimiento («32»): dos números distintos para lo mismo.
  const counted =
    entry.libro !== 'posicion-iva' &&
    entry.libro !== 'sumas-y-saldos' &&
    (MONTH_PACKAGE_BOOKS as readonly ExportBook[]).includes(entry.libro)
  const count = counted ? (
    <Suspense fallback={<CountPending />}>
      <BookIndexCount counts={counts} libro={entry.libro} />
    </Suspense>
  ) : null
  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-1.5',
        entry.sub && 'pl-4',
      )}
    >
      <div className="min-w-0">
        {/* La cuenta va en la línea del nombre, en gris (si no entra, baja sola a su renglón). En
            el celular iba pegada a la descripción y se leía como parte de la oración. */}
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn('text-sm', entry.sub ? 'text-foreground/90' : 'font-medium')}>
            {entry.title}
          </span>
          {count ? (
            <>
              {/* Los puntos que llevan el ojo del libro a su cuenta, como en un índice de papel. */}
              <span
                aria-hidden
                className="hidden min-w-4 flex-1 -translate-y-[0.2em] border-b border-dotted border-border sm:block"
              />
              <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            </>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground text-pretty">{entry.line}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {viewHref ? (
          <Link
            href={viewHref}
            aria-label={`Ver ${entry.title}`}
            className="inline-flex h-11 items-center rounded-md px-2.5 text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:h-9"
          >
            Ver
          </Link>
        ) : null}
        {blocked ? (
          <span className="px-1 text-xs text-muted-foreground">Falta la CUIT</span>
        ) : (
          <ExportButton
            iconOnly
            href={file.href}
            fileName={file.fileName}
            label={`Exportar ${entry.title} (CSV)`}
          />
        )}
      </div>
    </li>
  )
}

function CountPending() {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-14 animate-pulse rounded-full bg-muted align-middle motion-reduce:animate-none"
    />
  )
}

/** La cuenta de un libro («35 asientos», «Sin movimientos»); «—» si no se pudo contar. */
export async function BookIndexCount({
  counts,
  libro,
}: {
  counts: Promise<BookCounts>
  libro: ExportBook
}) {
  const map = await counts.catch(() => null)
  return <>{map?.get(libro) ?? '—'}</>
}
