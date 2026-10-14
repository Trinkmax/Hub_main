import { ArrowRight, BookText, FilePenLine, Lock, Users } from 'lucide-react'
import Link from 'next/link'
import { MonthStrip } from '@/components/administracion/charts/month-strip'
import {
  ActionTile,
  AdmHeader,
  AdmPage,
  EmptyTeach,
  MoneyHero,
  Panel,
  PanelLink,
  PillLink,
  RetryButton,
  StatusPill,
} from '@/components/administracion/kit'
import { LauncherButton } from '@/components/administracion/nav/launcher'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import {
  type FiscalYearRow,
  getAccountingSettings,
  getIvaPosition,
  getMonthPackage,
  listFiscalYears,
  settleQuery,
} from '@/lib/accounting/queries'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { addDays, monthOf, todayInCordoba } from '@/lib/dates'
import { type BookCounts, BookIndex } from './_components/book-index'
import { ExportAllButton } from './_components/export-button'
import { MonthPicker } from './_components/period-picker'
import { PeriodError } from './_components/report-error'
import { ivaHero } from './_lib/iva-story'
import {
  earlierOpenMonth,
  focusMonth,
  monthHeadline,
  monthNoun,
  monthPeriods,
  monthStripModel,
} from './_lib/months'
import {
  countText,
  downloadablePackage,
  packageCountText,
  packageFiles,
  packageStatusLine,
} from './_lib/package'
import { requireBooksAccess } from './_lib/page-access'
import {
  bookHref,
  monthAvailability,
  monthAvailabilityMessage,
  resolveBookMonth,
} from './_lib/periods'

export const metadata = { title: 'Libros' }

/**
 * Libros: las pestañas del año y el mes abierto. Arriba, una fila con los meses
 * del ejercicio (candado = cerrado, punteado = falta cerrar, anillo = en curso);
 * el elegido se abre abajo con un título que AFIRMA qué pasa con ese mes y EL
 * botón del paso siguiente. Después, el índice de sus libros, que es la
 * herramienta de la contadora: un solo listado con «Ver» y exportar.
 *
 * Los avisos del mes NO se piden acá: viven en «Fin de mes» (un solo lugar para
 * lo mismo). El título sale del período y de la fecha, sin lecturas de más, y
 * los conteos del índice llegan después de pintar (`Suspense`).
 */
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
  const books = `${base}/libros`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, books)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const [settingsResult, firstOpenDate, yearsResult] = await Promise.all([
    settleQuery(getAccountingSettings(tenantId)),
    loadFirstOpenDate(tenantId),
    settleQuery(listFiscalYears(tenantId)),
  ])
  const settings = settingsResult.ok ? settingsResult.data : null
  const years: FiscalYearRow[] = yearsResult.ok ? yearsResult.data : []
  const allPeriods = years.flatMap((y) => y.periods)

  // Sin mes en la URL: quien cierra ve el mes que le toca; la contadora, el último cerrado
  // (lo que viene a buscar) y, si no hay, el de hoy.
  const lastClosedMonth = firstOpenDate ? monthOf(addDays(firstOpenDate, -1)) : null
  const fallback =
    canWrite && yearsResult.ok && allPeriods.length > 0
      ? focusMonth(allPeriods, today)
      : lastClosedMonth
  const resolved = resolveBookMonth(sp, today, fallback)
  const month = resolved.ok ? resolved : resolveBookMonth({}, today)
  if (!month.ok) throw new Error('período por defecto inválido')
  const minMonth = settings ? monthOf(settings.booksStartDate) : null

  const period = monthPeriods(allPeriods).find((p) => monthOf(p.month) === month.month) ?? null
  const availability = monthAvailability(month.month, today, settings?.booksStartDate)
  const hasBooks = resolved.ok && availability === 'ok' && period !== null
  // El ejercicio del mes elegido; si el mes no tiene libros, el de hoy (o el último).
  const year =
    years.find((y) => y.id === period?.fiscalYearId) ??
    years.find((y) => y.startDate <= today && today <= y.endDate) ??
    years.at(-1) ??
    null

  const registered = settings?.ivaCondition === 'responsable_inscripto'
  const ivaResult =
    hasBooks && registered ? await settleQuery(getIvaPosition(tenantId, month.month)) : null

  // Los conteos NO se esperan: cada renglón del índice los recibe cuando llegan.
  const counts: Promise<BookCounts> = hasBooks
    ? settleQuery(getMonthPackage(tenantId, month.month)).then((pkg) =>
        pkg.ok ? new Map(pkg.data.files.map((f) => [f.libro, countText(f)])) : null,
      )
    : Promise.resolve(null)

  const hasCuit = !settings || Boolean(settings.cuit)
  const files = packageFiles(tenantSlug, month, today)
  const downloadable = downloadablePackage(files, hasCuit)
  const noun = monthNoun(month.month)

  const headline = resolved.ok
    ? monthHeadline({
        month: month.month,
        period: availability === 'ok' ? period : null,
        earlierOpen: earlierOpenMonth(allPeriods, month.month),
        today,
        canWrite,
        booksPath: books,
        unavailable:
          availability === 'ok'
            ? null
            : monthAvailabilityMessage(availability, month.month, settings?.booksStartDate),
      })
    : null

  const downloadAll = (className?: string) =>
    downloadable.length > 0 ? (
      <ExportAllButton
        className={className}
        label="Descargar el paquete del mes"
        count={packageCountText(files.length, downloadable.length)}
        // Para la contadora es EL botón de la pantalla; para el dueño, el suyo es el del mes.
        variant={canWrite ? 'outline' : 'default'}
        files={downloadable.map((f) => ({ href: f.href, fileName: f.fileName, title: f.title }))}
      />
    ) : null

  return (
    <AdmPage>
      <AdmHeader
        title="Libros"
        badge={<ReadOnlyBadge className="ml-0" />}
        description={
          canWrite
            ? 'Se arman solos con lo que cargás. A fin de mes los revisás, cerrás el mes y se los mandás a tu contadora.'
            : 'Los libros de cada mes, para mirarlos acá o descargarlos.'
        }
      />

      {!resolved.ok ? <PeriodError message={resolved.message} /> : null}

      <div className="space-y-2">
        {years.length > 1 ? (
          <nav aria-label="Ejercicios" className="flex flex-wrap gap-1.5">
            {years.map((y) => {
              const months = monthPeriods(y.periods).filter((p) => p.startsOn <= today)
              const target = months.at(-1)
              return (
                <PillLink
                  key={y.id}
                  href={target ? bookHref(books, { mes: monthOf(target.month) }) : books}
                  active={y.id === year?.id}
                  scroll={false}
                >
                  {y.endDate.slice(0, 4)}
                </PillLink>
              )
            })}
          </nav>
        ) : null}

        {year ? (
          <nav aria-label="Meses del ejercicio">
            <MonthStrip
              months={monthStripModel(year.periods, {
                today,
                selected: resolved.ok ? month.month : null,
                hrefFor: (m) => bookHref(books, { mes: m }),
              })}
            />
          </nav>
        ) : (
          // Sin los ejercicios (no se pudieron leer, o el bar todavía no tiene): el mes con flechas.
          <MonthPicker month={month.month} today={today} minMonth={minMonth} />
        )}

        {headline ? (
          <section
            aria-label={`El mes de ${noun}`}
            className="card-hairline grid gap-6 rounded-2xl border bg-card p-5 shadow-xs sm:p-6 lg:grid-cols-12"
          >
            <div
              className={
                ivaResult ? 'flex flex-col items-start gap-4 lg:col-span-7' : 'lg:col-span-12'
              }
            >
              <div className="space-y-2">
                {headline.kind === 'closed' ? (
                  <StatusPill tone="ok" icon={Lock}>
                    Cerrado
                  </StatusPill>
                ) : null}
                <h2 className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl">
                  {headline.title}
                </h2>
                {headline.sentence ? (
                  <p className="max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
                    {headline.sentence}
                  </p>
                ) : null}
              </div>
              {headline.action ? (
                <Button
                  asChild
                  variant={headline.action.emphasis === 'primary' ? 'default' : 'outline'}
                  className="mt-4 h-12 w-full gap-2 px-5 text-base sm:w-auto lg:mt-0"
                >
                  <Link href={headline.action.href}>
                    {headline.action.label}
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              ) : null}
              {headline.link ? (
                <PanelLink href={headline.link.href} className="mt-3 lg:mt-0">
                  {headline.link.label}
                  <ArrowRight className="size-3.5" aria-hidden />
                </PanelLink>
              ) : null}
            </div>

            {ivaResult ? (
              <div className="border-t border-border/60 pt-5 lg:col-span-5 lg:border-l lg:border-t-0 lg:pt-0 lg:pl-6">
                {ivaResult.ok ? (
                  <MonthIva
                    month={month.month}
                    position={ivaResult.data}
                    href={bookHref(`${books}/posicion-iva`, { mes: month.month })}
                  />
                ) : (
                  <div className="flex flex-col items-start gap-3">
                    <p role="alert" className="text-sm text-muted-foreground">
                      No pudimos calcular el IVA.
                    </p>
                    <RetryButton />
                  </div>
                )}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      {canWrite ? (
        <section aria-labelledby="se-carga-a-mano" className="space-y-2">
          <h2
            id="se-carga-a-mano"
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
          >
            Se carga a mano
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <ActionTile
              icon={Users}
              title="Sueldos del mes"
              hint="Los números que te pasa tu contadora"
              href={`${books}/asiento-manual?tipo=sueldos`}
            />
            <ActionTile
              icon={FilePenLine}
              title="Asiento manual"
              hint="Un ajuste que te dicta la contadora"
              href={`${books}/asiento-manual`}
            />
          </div>
        </section>
      ) : null}

      {settings && !settings.hasDocuments ? (
        <EmptyTeach
          icon={BookText}
          title="Los libros se arman solos"
          action={canWrite ? <LauncherButton /> : undefined}
        >
          {canWrite
            ? 'Cada gasto, cierre del día o pago que cargues queda anotado acá. Vos no escribís nada en los libros.'
            : 'Cuando los dueños carguen gastos, ventas y pagos, vas a ver acá los libros de cada mes, listos para descargar.'}
        </EmptyTeach>
      ) : null}

      <Panel
        id="paquete-del-mes"
        title={`Los libros de ${noun}`}
        description={
          <>
            {packageStatusLine(month.month, {
              status: hasBooks && period ? period.status : 'missing',
              closedAt: period?.closedAt ?? null,
              closedByName: period?.closedByName ?? null,
            })}
            .{canWrite ? ' Son los libros que usa tu contadora: acá no se escribe nada.' : null}
          </>
        }
        action={hasBooks ? <div className="hidden sm:block">{downloadAll('h-10')}</div> : null}
      >
        {!resolved.ok ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Elegí un mes para ver sus libros.
          </p>
        ) : !hasBooks ? (
          <p className="py-6 text-center text-sm text-muted-foreground text-pretty">
            {availability === 'ok'
              ? `${month.label} no tiene libros todavía.`
              : monthAvailabilityMessage(availability, month.month, settings?.booksStartDate)}
          </p>
        ) : (
          <div className="space-y-4">
            {/* En el celular el botón va acá: al lado del título no entra. */}
            <div className="sm:hidden">{downloadAll('h-11 w-full')}</div>
            {hasCuit ? null : (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl bg-secondary/50 px-3 py-2.5 text-sm text-pretty">
                <StatusPill tone="warn">Falta la CUIT</StatusPill>
                <span>
                  Sin la CUIT del bar no se pueden descargar los{' '}
                  {files.length - downloadable.length} archivos de IVA.
                </span>
                {canWrite ? (
                  <PanelLink href={`${base}/ajustes?tab=sas`}>Cargarla</PanelLink>
                ) : (
                  <span className="text-muted-foreground">Pedísela a los dueños.</span>
                )}
              </p>
            )}
            <BookIndex
              tenantSlug={tenantSlug}
              booksPath={books}
              month={month}
              today={today}
              hasCuit={hasCuit}
              counts={counts}
              openAll={!canWrite}
            />
          </div>
        )}
      </Panel>

      <QuickActionsBar />
    </AdmPage>
  )
}

/** El IVA del mes en el panel: el número (o por qué no hay), su estado y el link a la cuenta. */
function MonthIva({
  month,
  position,
  href,
}: {
  month: string
  position: Parameters<typeof ivaHero>[0]
  href: string
}) {
  const hero = ivaHero(position, month)
  const link = (
    <PanelLink href={href}>
      Ver la cuenta
      <ArrowRight className="size-3.5" aria-hidden />
    </PanelLink>
  )
  if (hero.cents === null) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          IVA de {monthNoun(month)}
        </p>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
          {hero.brief}
        </p>
        {hero.kind === 'zero' ? link : null}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <MoneyHero size="md" cents={hero.cents} label={hero.label} sentence={hero.brief} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusPill tone={position.status === 'open' ? 'info' : 'muted'}>
          {position.status === 'open' ? 'Estimado' : 'Mes cerrado'}
        </StatusPill>
        {link}
      </div>
    </div>
  )
}
