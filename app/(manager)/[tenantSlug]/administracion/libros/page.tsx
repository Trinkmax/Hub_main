import {
  BookText,
  CalendarCheck,
  FilePenLine,
  History,
  Info,
  Layers,
  ListTree,
  type LucideIcon,
  Percent,
  Receipt,
  ReceiptText,
  Scale,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'
import { plural } from '@/components/administracion/format'
import { ActionButton } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  EXPORT_BOOK_INFO,
  type ExportBook,
  exportHref,
  getAccountingSettings,
  getMonthPackage,
  type MonthPackageFile,
  settleQuery,
} from '@/lib/accounting/queries'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import {
  addDays,
  formatDate,
  formatIsoDay,
  formatMonthLabel,
  minIsoDay,
  monthOf,
  todayInCordoba,
} from '@/lib/dates'
import { ExportAllButton, ExportButton } from './_components/export-button'
import { MonthPicker } from './_components/period-picker'
import { PeriodError, ReportError } from './_components/report-error'
import { requireBooksAccess } from './_lib/page-access'
import { bookHref, resolveBookMonth } from './_lib/periods'

export const metadata = { title: 'Libros' }

type BookCard = {
  key: string
  icon: LucideIcon
  title: string
  description: string
  href: string
  exportBook?: ExportBook
  exportLabel?: string
}

const UNIT_SINGULAR: Readonly<Record<NonNullable<MonthPackageFile['unit']>, string>> = {
  asientos: 'asiento',
  cuentas: 'cuenta',
  comprobantes: 'comprobante',
  filas: 'fila',
  proveedores: 'proveedor',
  clientes: 'cliente',
}

function countText(file: MonthPackageFile): string | null {
  if (file.unit === null) return null
  if (file.rows === null) return 'Sin contar todavía'
  if (file.rows === 0) return 'Sin movimientos'
  return plural(file.rows, UNIT_SINGULAR[file.unit], file.unit)
}

/** «Septiembre 2026 · cerrado el 05/10/2026 por Franco» · «Octubre 2026 · mes abierto…». */
function packageStatusLine(
  month: string,
  pkg: {
    status: 'open' | 'closed' | 'missing'
    closedAt: string | null
    closedByName: string | null
  },
): string {
  const label = formatMonthLabel(month)
  if (pkg.status === 'open') {
    return `${label} · mes abierto: los números pueden cambiar hasta que se cierre`
  }
  if (pkg.status !== 'closed') return label
  const when = pkg.closedAt ? ` el ${formatDate(pkg.closedAt)}` : ''
  const who = pkg.closedByName ? ` por ${pkg.closedByName}` : ''
  return `${label} · cerrado${when}${who}`
}

/** Los parámetros de período que pide cada libro del paquete (F.15). */
function exportParamsFor(
  libro: ExportBook,
  month: { month: string; from: string; to: string },
  today: string,
) {
  switch (EXPORT_BOOK_INFO[libro].period) {
    case 'mes':
      return { mes: month.month }
    case 'rango':
      return { desde: month.from, hasta: month.to }
    case 'fecha':
      return { hasta: minIsoDay(month.to, today) }
    default:
      return {}
  }
}

export default async function LibrosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, `${base}/libros`)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const [settingsResult, firstOpenDate] = await Promise.all([
    settleQuery(getAccountingSettings(tenantId)),
    loadFirstOpenDate(tenantId),
  ])
  const settings = settingsResult.ok ? settingsResult.data : null
  // Sin mes en la URL: el último mes cerrado (lo que la contadora viene a buscar); si no hay, el de hoy.
  const lastClosedMonth = firstOpenDate ? monthOf(addDays(firstOpenDate, -1)) : null
  const resolved = resolveBookMonth(sp, today, lastClosedMonth)
  const month = resolved.ok ? resolved : resolveBookMonth({}, today)
  if (!month.ok) throw new Error('período por defecto inválido')
  const minMonth = settings ? monthOf(settings.booksStartDate) : null

  const pkg = resolved.ok ? await settleQuery(getMonthPackage(tenantId, month.month)) : null
  const monthParams = { mes: month.month }
  const books = `${base}/libros`

  const cards: BookCard[] = [
    {
      key: 'diario',
      icon: BookText,
      title: 'Libro diario',
      description: 'Todos los asientos, en orden.',
      href: bookHref(`${books}/diario`, monthParams),
      exportBook: 'diario',
    },
    {
      key: 'mayor',
      icon: ListTree,
      title: 'Mayor',
      description: 'Los movimientos de una cuenta, con su saldo.',
      href: bookHref(`${books}/mayor`, monthParams),
      exportBook: 'mayor-general',
      exportLabel: 'Exportar mayor general',
    },
    {
      key: 'sumas-y-saldos',
      icon: Scale,
      title: 'Sumas y saldos',
      description: 'El balance de comprobación del período.',
      href: bookHref(`${books}/sumas-y-saldos`, monthParams),
      exportBook: 'sumas-y-saldos',
    },
    {
      key: 'iva-compras',
      icon: Receipt,
      title: 'Libro IVA compras',
      description: 'Los comprobantes de compra con IVA del mes.',
      href: bookHref(`${books}/iva-compras`, monthParams),
      exportBook: 'iva-compras',
    },
    {
      key: 'iva-ventas',
      icon: ReceiptText,
      title: 'Libro IVA ventas',
      description: 'Lo facturado en el mes.',
      href: bookHref(`${books}/iva-ventas`, monthParams),
      exportBook: 'iva-ventas',
    },
    {
      key: 'posicion-iva',
      icon: Percent,
      title: 'Posición de IVA',
      description: 'Cuánto IVA da el mes (estimado).',
      href: bookHref(`${books}/posicion-iva`, monthParams),
      exportBook: 'posicion-iva',
    },
    {
      key: 'subdiarios',
      icon: Layers,
      title: 'Subdiarios',
      description: 'Compras, pagos, ventas, cobranzas y cada caja.',
      href: bookHref(`${books}/subdiarios`, monthParams),
    },
    {
      key: 'historia',
      icon: History,
      title: 'Historia',
      description: 'Quién cargó, anuló o cerró qué.',
      href: bookHref(`${books}/historia`, monthParams),
      exportBook: 'historia',
    },
    {
      key: 'cierres',
      icon: CalendarCheck,
      title: 'Cierres de mes',
      description: canWrite
        ? 'Cerrar el mes, reabrirlo y el cierre del ejercicio.'
        : 'Qué meses están cerrados, quién los cerró y cuándo.',
      href: `${books}/cierres`,
    },
    ...(canWrite
      ? [
          {
            key: 'asiento-manual',
            icon: FilePenLine,
            title: 'Asiento manual',
            description: 'Ajustes y el asiento de sueldos que te pasa la contadora.',
            href: `${books}/asiento-manual`,
          } satisfies BookCard,
        ]
      : []),
  ]

  const fileName = (libro: ExportBook) => `administracion-${tenantSlug}-${libro}-${month.month}.csv`
  const files =
    pkg?.ok && pkg.data.status !== 'missing'
      ? pkg.data.files.map((file) => ({
          ...file,
          href: exportHref(tenantSlug, file.libro, exportParamsFor(file.libro, month, today)),
          fileName: fileName(file.libro),
        }))
      : []
  const needsCuit = settings !== null && !settings.cuit
  // Sin el CUIT de la SAS los libros de IVA no se pueden bajar (409): no se ofrecen.
  const blocked = (libro: ExportBook) => needsCuit && Boolean(EXPORT_BOOK_INFO[libro].needsSasCuit)
  const downloadable = files.filter((f) => !blocked(f.libro))

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title={
          <>
            Libros <ReadOnlyBadge />
          </>
        }
        description="Los libros de la SAS de cada mes, para mirarlos acá o bajarlos para la contadora."
      />

      <MonthPicker month={month.month} today={today} minMonth={minMonth} />
      {!resolved.ok ? <PeriodError message={resolved.message} /> : null}

      {settings && !settings.hasDocuments ? (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <div className="flex-1 space-y-2 text-pretty">
            <p className="font-medium">Todavía no hay nada cargado.</p>
            <p className="text-muted-foreground">
              {canWrite
                ? 'Los libros se arman solos: cada gasto, cierre del día o pago que cargues suma su asiento acá. No hace falta escribir nada en los libros.'
                : 'Cuando los dueños carguen gastos, ventas y pagos, vas a ver acá los libros de cada mes, listos para bajar.'}
            </p>
            {canWrite ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <ActionButton action="gasto" size="sm" className="h-11 gap-2 md:h-8" />
                <Button asChild size="sm" variant="outline" className="h-11 md:h-8">
                  <Link href={`${base}/ventas/cierre`}>Cierre del día</Link>
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <section aria-label="Libros" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <Card
              key={card.key}
              className="card-hairline relative h-full gap-3 border-border/70 bg-card/85 p-6"
            >
              <div className="flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary shadow-2xs">
                <Icon className="size-5" aria-hidden />
              </div>
              <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                {card.title}
              </h2>
              <p className="text-sm text-muted-foreground">{card.description}</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" className="h-11 md:h-8">
                  <Link href={card.href} aria-label={`Ver ${card.title}`}>
                    Ver
                  </Link>
                </Button>
                {card.exportBook && !blocked(card.exportBook) ? (
                  <ExportButton
                    size="sm"
                    className="h-11 md:h-8"
                    href={exportHref(
                      tenantSlug,
                      card.exportBook,
                      exportParamsFor(card.exportBook, month, today),
                    )}
                    fileName={fileName(card.exportBook)}
                    label={card.exportLabel ?? 'Exportar'}
                  />
                ) : null}
              </div>
            </Card>
          )
        })}
      </section>

      <section
        aria-labelledby="paquete-del-mes"
        className="card-hairline rounded-xl border bg-card"
      >
        <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <h2 id="paquete-del-mes" className="font-serif text-lg font-semibold tracking-tight">
              Paquete del mes para la contadora
            </h2>
            <p className="text-xs text-muted-foreground">
              {pkg?.ok ? packageStatusLine(month.month, pkg.data) : formatMonthLabel(month.month)}
            </p>
          </div>
          {downloadable.length > 0 ? (
            <ExportAllButton
              className="h-11 md:h-9"
              files={downloadable.map((f) => ({
                href: f.href,
                fileName: f.fileName,
                title: f.title,
              }))}
            />
          ) : null}
        </header>

        {needsCuit ? (
          <div className="mx-5 mt-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div className="space-y-1 text-pretty">
              <p className="font-medium text-warning-text">
                Falta el CUIT de la SAS para bajar los libros de IVA.
              </p>
              <p className="text-muted-foreground">
                {canWrite ? (
                  <>
                    Completalo en{' '}
                    <Link
                      href={`${base}/ajustes?tab=sas`}
                      className="font-medium text-foreground underline underline-offset-4"
                    >
                      Ajustes › Datos de la SAS
                    </Link>
                    .
                  </>
                ) : (
                  'Pediles a los dueños que lo completen en Ajustes › Datos de la SAS.'
                )}
              </p>
            </div>
          </div>
        ) : null}

        {pkg === null ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Elegí un mes para ver su paquete.
          </p>
        ) : !pkg.ok ? (
          <div className="p-5">
            <ReportError message={pkg.message} />
          </div>
        ) : pkg.data.status === 'missing' ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground text-pretty">
            {settings
              ? `${formatMonthLabel(month.month)} no tiene libros: Administración arranca el ${formatIsoDay(settings.booksStartDate)}.`
              : `${formatMonthLabel(month.month)} no tiene libros.`}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {files.map((file) => {
              const count = countText(file)
              return (
                <li
                  key={file.libro}
                  className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{file.title}</p>
                    <p className="text-xs text-muted-foreground">{file.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                    {count ? (
                      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                    ) : null}
                    {blocked(file.libro) ? (
                      <span className="text-xs text-muted-foreground">Falta el CUIT</span>
                    ) : (
                      <ExportButton
                        size="sm"
                        className="h-11 md:h-8"
                        href={file.href}
                        fileName={file.fileName}
                        label="Descargar"
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </PageShell>
  )
}
