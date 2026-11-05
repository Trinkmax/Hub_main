import { ChevronDown, CircleAlert, FilePenLine, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Amount } from '@/components/administracion/amount'
import { EntryPreview } from '@/components/administracion/entry-preview'
import { OpenFoldFromHash } from '@/components/administracion/guias/uso/open-fold-from-hash'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import {
  Planilla,
  PlanillaFoot,
  PlanillaTitle,
  SimplePage,
} from '@/components/administracion/planilla'
import { Button } from '@/components/ui/button'
import { trialAnomalies } from '@/lib/accounting/anomalies'
import { tryLoadPostingContext } from '@/lib/accounting/context'
import { buildIvaSettlement } from '@/lib/accounting/posting/iva-settlement'
import {
  type FiscalYearRow,
  getAccessOverview,
  getAccountingSettings,
  getAccountSystemKeys,
  getCloseChecklist,
  getDailyCloseCalendar,
  getMonthPackage,
  getPayrollMonthStatus,
  getTrialBalance,
  listFiscalYears,
  listPeriodEvents,
  type PeriodRow,
  settleQuery,
  verifyClosedPeriods,
} from '@/lib/accounting/queries'
import { getAppUrl } from '@/lib/app-url'
import {
  addMonthsToYearMonth,
  formatIsoDay,
  formatMonthLabel,
  monthOf,
  todayInCordoba,
} from '@/lib/dates'
import { type BookCounts, BookIndex } from '../_components/book-index'
import { ExportAllButton } from '../_components/export-button'
import { MonthPicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { ivaExpectedFrom } from '../_lib/iva'
import { earlierOpenMonth, focusMonth, monthNoun, monthPeriods } from '../_lib/months'
import { countText, downloadablePackage, packageCountText, packageFiles } from '../_lib/package'
import { requireBooksAccess } from '../_lib/page-access'
import {
  bookHref,
  monthAvailability,
  monthAvailabilityMessage,
  resolveBookMonth,
} from '../_lib/periods'
import { AllMonths } from './_components/all-months-table'
import {
  CloseFiscalYearButton,
  CloseMonthButton,
  ReopenMonthMenu,
} from './_components/close-actions'
import { CloseList } from './_components/close-list'
import { OpenFoldLink } from './_components/open-fold-link'
import { type SendAudience, SendStepBody } from './_components/send-step'
import { closeLines } from './_lib/close-lines'
import { type FiscalYearClosePreview, fiscalYearClosePreview } from './_lib/fiscal-year-close'
import { closeHeadline, closeReview, ivaClosePlan } from './_lib/review'

export const metadata = { title: 'Cierre de mes' }

const TITLE = 'font-serif text-2xl font-semibold tracking-tight'

function yearLabel(year: FiscalYearRow): string {
  return `${formatIsoDay(year.startDate)} al ${formatIsoDay(year.endDate)}`
}

/** La oración del IVA que toma el cierre, entera. */
function planText(plan: ReturnType<typeof ivaClosePlan>): string | null {
  if (!plan.text) return null
  return `${plan.text.lead}${plan.text.amount ?? ''}${plan.text.tail}`
}

/**
 * Cierre de mes: el checklist antes de sellar el mes, sin carátula. Arriba, el título con el mes y los
 * dos botones («Descargar los libros» y «Cerrar octubre»); después, una fila por cosa para mirar, con
 * su link. Debajo, lo que no se usa todos los días: mandarle los libros a la contadora, archivo por
 * archivo y todos los meses con su historial.
 *
 * - `?mes=yyyy-MM` deja MIRAR cualquier mes del ejercicio; cerrar, solo el que la base permite (el
 *   próximo abierto, en orden).
 * - La contadora ve todo, sin botones de carga: ni cerrar, ni reabrir, ni las acciones de los avisos.
 *   Descargar sí (descargar no es cargar).
 *
 * La lógica del cierre no cambió: `CloseMonthButton` recibe lo mismo de siempre (`warningKeys`, y del
 * IVA `expected`, la frase del diálogo y si se puede apagar).
 */
export default async function CierreDeMesPage({
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
  const path = `${books}/cierres`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, path)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const [yearsResult, settingsResult] = await Promise.all([
    settleQuery(listFiscalYears(tenantId)),
    settleQuery(getAccountingSettings(tenantId)),
  ])
  const settings = settingsResult.ok ? settingsResult.data : null

  if (!yearsResult.ok) {
    return (
      <SimplePage width="narrow">
        <h1 className={TITLE}>Cierre de mes</h1>
        <QueryErrorBlock code={yearsResult.code} message={yearsResult.message} />
      </SimplePage>
    )
  }

  const years = yearsResult.data
  const allPeriods = years.flatMap((y) => y.periods)
  const months = monthPeriods(allPeriods)

  if (months.length === 0) {
    return (
      <SimplePage width="narrow">
        <h1 className={TITLE}>Cierre de mes</h1>
        <Planilla>
          <div className="grid gap-1 px-3 py-6 text-center text-sm text-pretty">
            <p className="font-medium">Todavía no hay meses en los libros</p>
            <p className="text-muted-foreground">
              Aparecen solos cuando cargás el primer gasto o el primer cierre del día.
            </p>
          </div>
        </Planilla>
      </SimplePage>
    )
  }

  const resolved = resolveBookMonth(sp, today, focusMonth(allPeriods, today))
  const month = resolved.ok ? resolved : resolveBookMonth({}, today, focusMonth(allPeriods, today))
  if (!month.ok) throw new Error('período por defecto inválido')
  const found = months.find((p) => monthOf(p.month) === month.month) ?? null
  const availability = monthAvailability(month.month, today, settings?.booksStartDate)
  // Un mes que no empezó (o sin libros) se puede escribir en la URL: no hay nada que revisar ahí.
  const period: PeriodRow | null = found && availability === 'ok' ? found : null
  const year =
    years.find((y) => y.id === found?.fiscalYearId) ??
    years.find((y) => y.startDate <= today && today <= y.endDate) ??
    years.at(-1) ??
    null
  const lastClosed = [...months].reverse().find((p) => p.status === 'closed') ?? null
  const closed = period?.status === 'closed'
  const isOwner = access.role === 'owner'
  const minMonth = settings ? monthOf(settings.booksStartDate) : null

  const [
    checklistResult,
    calendarResult,
    trial,
    systemKeys,
    payroll,
    verify,
    events,
    loaded,
    overview,
    url,
  ] = await Promise.all([
    period && !closed ? settleQuery(getCloseChecklist(tenantId, period.month)) : null,
    period && !closed ? settleQuery(getDailyCloseCalendar(tenantId, month.month)) : null,
    period ? settleQuery(getTrialBalance(tenantId, { from: month.from, to: month.to })) : null,
    settleQuery(getAccountSystemKeys(tenantId)),
    period && !closed ? settleQuery(getPayrollMonthStatus(tenantId, month.month)) : null,
    settleQuery(verifyClosedPeriods(tenantId)),
    settleQuery(listPeriodEvents(tenantId, { limit: 30 })),
    canWrite ? tryLoadPostingContext(tenantId) : null,
    // `get_tenant_members` es de dueños: solo se pide para uno, y solo con el mes cerrado.
    period && closed && canWrite && isOwner
      ? settleQuery(getAccessOverview(tenantId, { includeMembers: true }))
      : null,
    period && closed ? getAppUrl() : null,
  ])
  const ctx = loaded?.ok ? loaded.ctx : null
  const changed = new Set(verify.ok ? verify.data.filter((v) => !v.ok).map((v) => v.periodId) : [])
  const changedMonths = months.filter((p) => changed.has(p.id))

  // El ejercicio que ya se puede cerrar: abierto, con todos sus meses cerrados.
  const fyCandidate =
    years.find(
      (y) =>
        y.status === 'open' &&
        y.periods.some((p) => p.kind === 'month') &&
        y.periods.every((p) => p.kind !== 'month' || p.status === 'closed'),
    ) ?? null
  const previousOpen = fyCandidate
    ? years.some((y) => y.endDate < fyCandidate.startDate && y.status === 'open')
    : false
  const fyPreview: FiscalYearClosePreview | null =
    canWrite && fyCandidate && ctx && !previousOpen
      ? await fiscalYearClosePreview(tenantId, fyCandidate, ctx)
      : null

  const picker = (
    <MonthPicker
      month={month.month}
      today={today}
      minMonth={minMonth}
      className="justify-self-start"
    />
  )
  const changedAlert =
    changedMonths.length > 0 ? (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-pretty font-medium">
          {changedMonths.map((p) => formatMonthLabel(p.month)).join(', ')}{' '}
          {changedMonths.length === 1 ? 'cambió' : 'cambiaron'} después de cerrarse: avisanos.
        </p>
      </div>
    ) : null
  const allMonths = (open: boolean) => (
    <AllMonths
      years={years}
      events={events.ok ? events.data : []}
      tenantSlug={tenantSlug}
      path={path}
      today={today}
      canWrite={canWrite}
      lastClosedId={lastClosed?.id ?? null}
      changed={changed}
      open={open}
    />
  )

  // ── Un mes sin libros (anterior al arranque, que no empezó, o un `?mes=` roto) ──
  if (!period) {
    // La salida: el mes que toca atender (o el de hoy), si no es este mismo.
    const target = focusMonth(allPeriods, today)
    const backTo =
      target !== month.month && months.some((p) => monthOf(p.month) === target) ? target : null
    return (
      <SimplePage width="narrow">
        <h1 className={TITLE}>Cierre de mes</h1>
        {picker}
        {!resolved.ok ? <PeriodError message={resolved.message} hint={null} /> : null}
        {changedAlert}
        <Planilla>
          <div className="grid justify-items-center gap-3 px-3 py-6 text-center text-sm">
            <p className="font-medium text-pretty">
              {availability === 'ok'
                ? `${month.label} no tiene libros todavía.`
                : monthAvailabilityMessage(availability, month.month, settings?.booksStartDate)}
            </p>
            {backTo ? (
              <Button asChild variant="outline" className="h-11 md:pointer-fine:h-9">
                <Link href={bookHref(path, { mes: backTo })}>Ir a {monthNoun(backTo)}</Link>
              </Button>
            ) : null}
          </div>
        </Planilla>
        {allMonths(true)}
      </SimplePage>
    )
  }

  // ── El mes elegido ──
  const noun = monthNoun(month.month)
  const nextNoun = monthNoun(addMonthsToYearMonth(month.month, 1))
  const finished = period.endsOn < today
  const earlier = earlierOpenMonth(allPeriods, month.month)
  const earlierMonth = earlier ? monthOf(earlier.month) : null
  const checklist = checklistResult?.ok ? checklistResult.data : null
  const calendar = calendarResult?.ok ? calendarResult.data : null
  const review = checklist
    ? closeReview({
        month: month.month,
        base,
        finished,
        canWrite,
        checklist,
        today,
        calendar,
        settings: settings ? { openingStatus: settings.openingStatus, cuit: settings.cuit } : null,
      })
    : null
  const headline = closeHeadline({
    month: month.month,
    period,
    today,
    canWrite,
    checklist,
    blockersCount: review?.blockersCount ?? 0,
    blockerWords: review?.blockerWords ?? null,
    earlierOpen: earlierMonth,
    path,
  })
  const canClose = Boolean(checklist?.canClose)
  const canReopen =
    canWrite && closed && period.id === lastClosed?.id && year !== null && year.status === 'open'

  // El IVA que toma el cierre: las mismas ramas de siempre, con otras palabras.
  const iva = checklist?.iva ?? null
  const plan = ivaClosePlan(iva, month.month)
  const ivaHref = bookHref(`${books}/posicion-iva`, { mes: month.month })
  const built =
    plan.settles && !plan.voidsOnly && iva && ctx
      ? buildIvaSettlement(
          { month: period.month, figures: iva.figures },
          ctx,
          // La vista previa no se guarda: no hace falta una referencia de verdad.
          { clientRef: '00000000-0000-4000-8000-000000000000' },
        )
      : null
  const ivaPreview = built?.ok && built.preview.length > 0 ? built.preview : null
  const plainPlan = planText(plan)

  const anomalies = trial?.ok
    ? trialAnomalies(trial.data.rows, systemKeys.ok ? systemKeys.data : new Map())
    : null
  const lines = closeLines({
    month: month.month,
    base,
    trial: trial?.ok
      ? { balanced: trial.data.balanced, differenceCents: trial.data.differenceCents }
      : null,
    oddAccounts: anomalies ? anomalies.size : null,
    review,
    payroll: payroll?.ok ? payroll.data : null,
    iva: plainPlan ? { text: plainPlan, href: ivaHref } : null,
    closed,
  })

  // Lo que se baja.
  const files = packageFiles(tenantSlug, month, today)
  const hasCuit = !settings || Boolean(settings.cuit)
  const downloadable = downloadablePackage(files, hasCuit)
  const missing = files.length - downloadable.length
  const audience: SendAudience =
    isOwner && overview?.ok
      ? {
          kind: 'owner',
          accountants: overview.data.accountants.map((a) => a.name),
          canInvite: access.accounting.admin,
        }
      : { kind: 'writer' }
  // Las cuentas de cada archivo son catorce lecturas: solo para quien vino a buscar los archivos.
  const counts: Promise<BookCounts> | null = canWrite
    ? null
    : settleQuery(getMonthPackage(tenantId, month.month)).then((pkg) =>
        pkg.ok ? new Map(pkg.data.files.map((f) => [f.libro, countText(f)])) : null,
      )

  return (
    <SimplePage width="narrow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 basis-72 gap-1">
          <h1 className={TITLE}>Cierre de {noun}</h1>
          <p className="text-sm text-muted-foreground text-pretty">
            <span className="font-medium text-foreground">{headline.lead}</span>
            {headline.rest ? ` ${headline.rest}` : null}
            {headline.link ? (
              <>
                {' '}
                <Link
                  href={headline.link.href}
                  className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {headline.link.label}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {downloadable.length > 0 ? (
            <ExportAllButton
              label="Descargar los libros"
              count={packageCountText(files.length, downloadable.length)}
              variant="outline"
              className="h-11 md:pointer-fine:h-9"
              files={downloadable.map((f) => ({
                href: f.href,
                fileName: f.fileName,
                title: f.title,
              }))}
            />
          ) : null}
          {canWrite && canClose && checklist ? (
            <CloseMonthButton
              tenantSlug={tenantSlug}
              month={period.month}
              monthNoun={noun}
              nextMonthNoun={nextNoun}
              warningKeys={checklist.warningKeys}
              iva={
                plan.settles && iva
                  ? {
                      expected: ivaExpectedFrom(iva),
                      summary: plan.summary,
                      // Con un IVA viejo anotado no se puede cerrar sin reemplazarlo.
                      optional: !plan.replaces,
                    }
                  : null
              }
            />
          ) : null}
          {canReopen ? (
            <ReopenMonthMenu tenantSlug={tenantSlug} month={period.month} monthNoun={noun} />
          ) : null}
        </div>
      </div>

      {picker}
      {!resolved.ok ? <PeriodError message={resolved.message} hint={null} /> : null}
      {changedAlert}
      {checklistResult && !checklistResult.ok ? (
        <QueryErrorBlock code={checklistResult.code} message={checklistResult.message} />
      ) : null}

      <Planilla>
        <CloseList lines={lines} label={`Lo que hay que mirar antes de cerrar ${noun}`} />
        {review && review.info.length > 0 ? (
          <ul className="grid gap-1 border-t border-border/70 px-3 py-2 text-sm">
            {review.info.map((text) => (
              <li key={text} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusPill tone="info">Para la contadora</StatusPill>
                <span className="min-w-0 flex-1 basis-56 text-muted-foreground text-pretty">
                  {text}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <PlanillaFoot className="justify-start gap-x-4 text-sm">
          <FootLink href={bookHref(`${books}/historia`, { mes: month.month })}>Historia</FootLink>
          <FootLink href={bookHref(`${books}/subdiarios`, { mes: month.month })}>
            Subdiarios
          </FootLink>
          <OpenFoldLink target="archivos" className={FOOT_LINK}>
            Archivo por archivo
          </OpenFoldLink>
          {!closed ? (
            <span className="text-xs text-muted-foreground">
              Lo que se descarga hoy puede cambiar hasta que cierres.
            </span>
          ) : null}
          {missing > 0 ? (
            <span className="text-xs text-muted-foreground">
              Se descargan {downloadable.length} de {files.length}: los {missing} de IVA necesitan
              la CUIT del bar.{' '}
              {canWrite ? (
                <FootLink href={`${base}/ajustes?tab=sas`}>Cargarla</FootLink>
              ) : (
                'Pedísela a los dueños.'
              )}
            </span>
          ) : null}
        </PlanillaFoot>
      </Planilla>

      {ivaPreview ? <EntryPreview entries={ivaPreview} label="Ver el asiento del IVA" /> : null}
      {closed && period.ivaSettlementDocumentId ? (
        <FootLink href={`${base}/comprobantes/${period.ivaSettlementDocumentId}`}>
          Ver cómo quedó anotado el IVA
        </FootLink>
      ) : null}

      {canWrite && fyCandidate ? (
        <FiscalYearPanel
          tenantSlug={tenantSlug}
          base={base}
          year={fyCandidate}
          previousOpen={previousOpen}
          preview={fyPreview}
        />
      ) : null}

      {canWrite && closed ? (
        <Fold title="Mandarle los libros a tu contadora" open>
          <SendStepBody
            month={month.month}
            audience={audience}
            link={`${url ?? ''}${bookHref(books, { mes: month.month })}`}
            inviteHref={`/${tenantSlug}/configuracion/equipo?rol=accountant`}
            fileCount={files.length}
            indexFold="archivos"
            receiptsHref={`${base}/compras?tab=comprobantes`}
          />
        </Fold>
      ) : null}

      <OpenFoldFromHash />
      <Fold id="archivos" title="Archivo por archivo" open={!canWrite}>
        <BookIndex
          tenantSlug={tenantSlug}
          booksPath={books}
          month={month}
          today={today}
          hasCuit={hasCuit}
          counts={counts}
          openAll={!canWrite}
        />
      </Fold>

      {allMonths(!canWrite)}
    </SimplePage>
  )
}

const FOOT_LINK =
  'w-fit rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-2.5'

function FootLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={FOOT_LINK}>
      {children}
    </Link>
  )
}

/** Lo que no se mira todos los días: plegado, en su hoja. */
function Fold({
  id,
  title,
  open = false,
  children,
}: {
  id?: string
  title: string
  open?: boolean
  children: ReactNode
}) {
  return (
    <details
      id={id}
      open={open}
      className="group/fold scroll-mt-24 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform duration-(--duration-fast) group-open/fold:rotate-0 motion-reduce:transition-none"
        />
        {title}
      </summary>
      <div className="border-t border-border/60 px-3 py-3">{children}</div>
    </details>
  )
}

function FiscalYearPanel({
  tenantSlug,
  base,
  year,
  previousOpen,
  preview,
}: {
  tenantSlug: string
  base: string
  year: FiscalYearRow
  previousOpen: boolean
  preview: FiscalYearClosePreview | null
}) {
  const label = year.endDate.slice(0, 4)
  return (
    <Planilla>
      <PlanillaTitle title={`Cerrar el ejercicio ${label}`} />
      <div className="space-y-4 px-3 py-3 text-sm">
        <p className="text-muted-foreground">{yearLabel(year)} · todos sus meses están cerrados.</p>
        {previousOpen ? (
          <p className="flex items-start gap-2 text-pretty">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            Primero hay que cerrar el ejercicio anterior.
          </p>
        ) : !preview ? (
          <p className="text-muted-foreground">
            No pudimos armar el cierre todavía. Recargá la página.
          </p>
        ) : !preview.ok ? (
          <p className="flex items-start gap-2 text-pretty text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {preview.message}
          </p>
        ) : (
          <>
            <p className="text-base font-semibold tabular-nums">
              Resultado del ejercicio: <Amount cents={Math.abs(preview.resultCents)} />
              {preview.resultCents > 0
                ? ' (positivo)'
                : preview.resultCents < 0
                  ? ' (negativo)'
                  : null}
            </p>
            <div className="space-y-2">
              <p className="font-medium">Ajustes de cierre cargados</p>
              {preview.adjustments.length === 0 ? (
                <p className="text-muted-foreground text-pretty">
                  Todavía no hay. La contadora los carga con «Asiento manual › Ajuste de cierre de
                  ejercicio» (amortizaciones, existencias, reclasificaciones).
                </p>
              ) : (
                <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                  {preview.adjustments.map((e) => (
                    <li
                      key={e.entryId}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <Link
                        href={`${base}/asientos/${e.entryId}`}
                        className="min-w-0 truncate rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {e.description || 'Ajuste de cierre'}
                      </Link>
                      <Amount cents={e.totalCents} className="shrink-0" />
                    </li>
                  ))}
                </ul>
              )}
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-11 gap-2 md:pointer-fine:h-8"
              >
                <Link href={`${base}/libros/asiento-manual?tipo=ajuste-cierre`}>
                  <FilePenLine className="size-3.5" aria-hidden />
                  Cargar un ajuste de cierre
                </Link>
              </Button>
            </div>
            <EntryPreview
              entries={preview.preview}
              label="Ver los tres asientos (refundición, cierre y apertura)"
            />
            <CloseFiscalYearButton
              tenantSlug={tenantSlug}
              fiscalYearId={year.id}
              label={label}
              resultCents={preview.resultCents}
              balanceSheetAccounts={preview.balanceSheetAccounts}
            />
          </>
        )}
      </div>
    </Planilla>
  )
}
