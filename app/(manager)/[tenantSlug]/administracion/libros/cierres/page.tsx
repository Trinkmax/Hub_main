import { ArrowRight, CalendarCheck, CircleAlert, FilePenLine, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Amount } from '@/components/administracion/amount'
import { CloseStrip } from '@/components/administracion/charts/close-strip'
import { MonthStrip } from '@/components/administracion/charts/month-strip'
import { compactCents } from '@/components/administracion/charts/scale'
import { EntryPreview } from '@/components/administracion/entry-preview'
import { plural } from '@/components/administracion/format'
import {
  AdmHeader,
  AdmPage,
  EmptyTeach,
  Panel,
  PanelLink,
  StepCard,
} from '@/components/administracion/kit'
import { LauncherButton } from '@/components/administracion/nav/launcher'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { tryLoadPostingContext } from '@/lib/accounting/context'
import { buildIvaSettlement } from '@/lib/accounting/posting/iva-settlement'
import {
  type FiscalYearRow,
  getAccessOverview,
  getAccountingSettings,
  getCloseChecklist,
  getDailyCloseCalendar,
  getIvaPosition,
  listFiscalYears,
  listPeriodEvents,
  type PeriodRow,
  settleQuery,
  verifyClosedPeriods,
} from '@/lib/accounting/queries'
import { getAppUrl } from '@/lib/app-url'
import {
  addMonthsToYearMonth,
  formatDate,
  formatIsoDay,
  formatMonthLabel,
  monthOf,
  todayInCordoba,
} from '@/lib/dates'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { ivaExpectedFrom } from '../_lib/iva'
import { ivaHero } from '../_lib/iva-story'
import {
  earlierOpenMonth,
  focusMonth,
  monthNoun,
  monthPeriods,
  monthStripModel,
  monthTitle,
} from '../_lib/months'
import { downloadablePackage, packageFiles } from '../_lib/package'
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
import { CloseStepBody } from './_components/close-step'
import { coverLine, MonthCover, type MonthCoverData } from './_components/month-cover'
import { ReviewStep } from './_components/review-step'
import { type SendAudience, SendStepBody } from './_components/send-step'
import { type FiscalYearClosePreview, fiscalYearClosePreview } from './_lib/fiscal-year-close'
import {
  closeHeadline,
  closeReview,
  closeStripDays,
  closeWaitText,
  firstReviewAction,
  ivaClosePlan,
  stepStates,
} from './_lib/review'

export const metadata = { title: 'Fin de mes' }

/** `clientRef` de relleno para la vista previa del asiento del IVA (no se guarda). */
const PREVIEW_CLIENT_REF = '00000000-0000-4000-8000-000000000000'

/** Cuánto dura el «sellazo» del papel después de cerrar. */
const JUST_CLOSED_MS = 90_000

function yearLabel(year: FiscalYearRow): string {
  return `${formatIsoDay(year.startDate)} al ${formatIsoDay(year.endDate)}`
}

/**
 * «Fin de mes»: el mes que se sella. A la izquierda, tres pasos a la vista que
 * se tildan solos (revisar los avisos · cerrar el mes · mandarle los libros a
 * la contadora); a la derecha, el papel del mes, que recibe el sello «CERRADO».
 * Es el espejo mensual del cierre del día: mismo gesto, otra escala.
 *
 * - `?mes=yyyy-MM` deja MIRAR cualquier mes del ejercicio; cerrar, solo el que
 *   la base permite (el próximo abierto, en orden).
 * - Un solo botón primario: la primera acción del paso que toca.
 * - La contadora ve todo, sin un solo botón de carga: ni cerrar, ni reabrir, ni
 *   las acciones de los avisos. Descargar sí (descargar no es cargar).
 *
 * La lógica del cierre no cambió: `CloseMonthButton` recibe lo mismo de siempre
 * (`warningKeys`, y del IVA `expected`, la frase del diálogo y si se puede
 * apagar).
 */
export default async function FinDeMesPage({
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
  const badge = <ReadOnlyBadge className="ml-0" />

  if (!yearsResult.ok) {
    return (
      <AdmPage width="comfortable">
        <AdmHeader back={{ href: books, label: 'Libros' }} title="Fin de mes" badge={badge} />
        <QueryErrorBlock code={yearsResult.code} message={yearsResult.message} />
      </AdmPage>
    )
  }

  const years = yearsResult.data
  const allPeriods = years.flatMap((y) => y.periods)
  const months = monthPeriods(allPeriods)

  if (months.length === 0) {
    return (
      <AdmPage width="comfortable">
        <AdmHeader back={{ href: books, label: 'Libros' }} title="Fin de mes" badge={badge} />
        <EmptyTeach
          icon={CalendarCheck}
          title="Todavía no hay meses en los libros"
          action={canWrite ? <LauncherButton /> : undefined}
        >
          Aparecen solos cuando cargás el primer gasto o el primer cierre del día.
        </EmptyTeach>
      </AdmPage>
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

  const [checklistResult, calendarResult, closedIvaResult, verify, events, loaded, overview, url] =
    await Promise.all([
      period && !closed ? settleQuery(getCloseChecklist(tenantId, period.month)) : null,
      period ? settleQuery(getDailyCloseCalendar(tenantId, month.month)) : null,
      period && closed ? settleQuery(getIvaPosition(tenantId, month.month)) : null,
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

  const strip = (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      {year ? (
        <nav aria-label="Meses del ejercicio" className="min-w-0 flex-1 basis-full sm:basis-96">
          <MonthStrip
            months={monthStripModel(year.periods, {
              today,
              selected: resolved.ok ? month.month : null,
              hrefFor: (m) => bookHref(path, { mes: m }),
              alertIds: changed,
            })}
          />
        </nav>
      ) : null}
      <PanelLink
        href={`${base}/guias/dia-a-dia#receta-fin-de-mes`}
        className="text-muted-foreground"
      >
        ¿Cómo es el fin de mes?
      </PanelLink>
    </div>
  )
  const changedAlert =
    changedMonths.length > 0 ? (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-pretty font-medium">
          {changedMonths.map((p) => formatMonthLabel(p.month)).join(', ')}{' '}
          {changedMonths.length === 1 ? 'cambió' : 'cambiaron'} después de cerrarse: avisanos.
        </p>
      </div>
    ) : null

  // ── Un mes sin libros (anterior al arranque, que no empezó, o un `?mes=` roto) ──
  if (!period) {
    return (
      <AdmPage width="comfortable">
        <AdmHeader
          back={{ href: books, label: 'Libros' }}
          title="Fin de mes"
          badge={badge}
          description={
            <span className="font-medium text-foreground">
              {availability === 'ok'
                ? `${month.label} no tiene libros todavía.`
                : monthAvailabilityMessage(availability, month.month, settings?.booksStartDate)}
            </span>
          }
        />
        {!resolved.ok ? <PeriodError message={resolved.message} hint={null} /> : null}
        {changedAlert}
        {strip}
        <AllMonths
          years={years}
          events={events.ok ? events.data : []}
          tenantSlug={tenantSlug}
          path={path}
          today={today}
          canWrite={canWrite}
          lastClosedId={lastClosed?.id ?? null}
          changed={changed}
          open
        />
      </AdmPage>
    )
  }

  // ── El mes elegido ──
  const noun = monthNoun(month.month)
  const name = monthTitle(month.month)
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
  const [reviewState, closeState, sendState] = checklist
    ? stepStates({ closed, canClose, hasWork: review?.hasWork ?? false })
    : closed
      ? stepStates({ closed: true, canClose: false, hasWork: false })
      : (['current', 'todo', 'todo'] as const)
  const primaryAction =
    canWrite && review && reviewState === 'current' ? firstReviewAction(review) : null

  // El IVA que toma el cierre: las mismas ramas de siempre, con otras palabras.
  const iva = checklist?.iva ?? null
  const plan = ivaClosePlan(iva, month.month)
  const built =
    plan.settles && !plan.voidsOnly && iva && ctx
      ? buildIvaSettlement({ month: period.month, figures: iva.figures }, ctx, {
          clientRef: PREVIEW_CLIENT_REF,
        })
      : null
  const ivaPreview = built?.ok && built.preview.length > 0 ? built.preview : null

  // El papel del mes.
  const position = closed ? (closedIvaResult?.ok ? closedIvaResult.data : null) : iva
  const hero = position ? ivaHero(position, month.month) : null
  const registered = settings?.ivaCondition === 'responsable_inscripto'
  const cover: MonthCoverData = {
    month: month.month,
    closed,
    closedAt: period.closedAt,
    soldCents: calendar && calendar.loadedDays > 0 ? calendar.soldCents : null,
    daysText: calendar
      ? `${calendar.loadedDays} de ${calendar.loadedDays + calendar.missingDays}`
      : null,
    ivaText: hero && hero.cents !== null ? hero.short : null,
    ivaApplies: position ? position.applies : registered,
    justClosed:
      closed && period.closedAt !== null
        ? Date.now() - Date.parse(period.closedAt) < JUST_CLOSED_MS
        : false,
  }
  const mobileLine = coverLine(cover, {
    sold: cover.soldCents !== null ? compactCents(cover.soldCents) : null,
    iva:
      hero && hero.cents !== null
        ? `${compactCents(hero.cents)} ${hero.kind === 'in_favor' ? 'a favor' : 'a pagar'}`
        : null,
  })

  // «Cómo queda en los libros»: los totales, la numeración y el asiento del IVA.
  const entriesCount = closed ? period.entriesCount : (checklist?.entriesCount ?? null)
  const debitTotal = closed ? period.debitTotalCents : (checklist?.debitTotalCents ?? null)
  const creditTotal = closed ? period.debitTotalCents : (checklist?.creditTotalCents ?? debitTotal)
  const numberFrom = closed ? period.numberFrom : (checklist?.numberFrom ?? null)
  const numberTo = closed ? period.numberTo : (checklist?.numberTo ?? null)
  const coverBooks: ReactNode =
    entriesCount !== null ? (
      <>
        <p>
          {plural(entriesCount, 'asiento', 'asientos')}
          {debitTotal !== null ? (
            <>
              {' · Debe '}
              <Amount cents={debitTotal} />
              {' · Haber '}
              <Amount cents={creditTotal ?? debitTotal} />
            </>
          ) : null}
        </p>
        {numberFrom !== null && numberTo !== null ? (
          <p className="text-muted-foreground text-pretty">
            Los asientos de {noun} {closed ? 'quedaron' : 'van a quedar'} numerados del {numberFrom}{' '}
            al {numberTo}.
          </p>
        ) : null}
        {ivaPreview ? <EntryPreview entries={ivaPreview} label="Ver el asiento del IVA" /> : null}
        {closed && period.ivaSettlementDocumentId ? (
          <PanelLink href={`${base}/comprobantes/${period.ivaSettlementDocumentId}`}>
            Ver cómo quedó anotado el IVA
            <ArrowRight className="size-3.5" aria-hidden />
          </PanelLink>
        ) : null}
      </>
    ) : null

  // Paso 1.
  const reviewSummary = closed
    ? 'Mes cerrado: no queda nada para revisar.'
    : !review
      ? null
      : !finished
        ? canWrite
          ? `Lo que cargues con fecha de ${noun} entra en este mes.`
          : `Lo que los dueños carguen con fecha de ${noun} entra en este mes.`
        : review.hasWork
          ? 'Lo que dice «Aviso» no frena el cierre; lo que dice «Falta», sí.'
          : 'No hay avisos.'

  // Paso 2.
  const canReopen =
    canWrite && closed && period.id === lastClosed?.id && year !== null && year.status === 'open'
  const closedLine = `Cerrado${period.closedAt ? ` el ${formatDate(period.closedAt)}` : ''}${
    period.closedByName ? ` por ${period.closedByName}` : ''
  }.`
  const closeSummary = closed
    ? closedLine
    : !canWrite
      ? 'Abierto: lo cierran los dueños.'
      : canClose
        ? `Deja ${noun} fijo: después no se puede cargar ni cambiar nada con esa fecha. Si hiciera falta, se reabre.`
        : closeWaitText({
            month: month.month,
            period,
            today,
            earlierOpen: earlierMonth,
            openingPending: checklist?.blockers.some((b) => b.key === 'opening_pending') ?? false,
            blockersCount: review?.blockersCount ?? 0,
          })

  // Paso 3.
  const files = packageFiles(tenantSlug, month, today)
  const hasCuit = !settings || Boolean(settings.cuit)
  const downloadable = downloadablePackage(files, hasCuit)
  const audience: SendAudience = !canWrite
    ? { kind: 'reader' }
    : isOwner && overview?.ok
      ? {
          kind: 'owner',
          accountants: overview.data.accountants.map((a) => a.name),
          canInvite: access.accounting.admin,
        }
      : { kind: 'writer' }
  const monthBooksHref = `${bookHref(books, { mes: month.month })}#paquete-del-mes`

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={{ href: bookHref(books, { mes: month.month }), label: 'Libros' }}
        title="Fin de mes"
        badge={badge}
        description={
          <>
            <span className="font-medium text-foreground">{headline.lead}</span>
            {headline.rest ? ` ${headline.rest}` : null}
            {headline.link ? (
              <>
                {' '}
                <Link
                  href={headline.link.href}
                  className="font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {headline.link.label}
                </Link>
              </>
            ) : null}
          </>
        }
      />

      {!resolved.ok ? <PeriodError message={resolved.message} hint={null} /> : null}
      {changedAlert}
      {strip}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        <div className="order-2 min-w-0 space-y-4 lg:order-1 lg:col-span-7">
          <StepCard
            open
            n={1}
            id="paso-1"
            state={reviewState}
            title={canWrite ? 'Revisá los avisos' : 'Lo que falta revisar'}
            summary={reviewSummary}
          >
            {closed ? null : checklistResult && !checklistResult.ok ? (
              <QueryErrorBlock code={checklistResult.code} message={checklistResult.message} />
            ) : review ? (
              <ReviewStep
                review={review}
                primaryAction={primaryAction}
                strip={
                  calendar ? (
                    <CloseStrip
                      days={closeStripDays(calendar, canWrite ? base : null)}
                      showLegend={false}
                      foldFuture
                    />
                  ) : null
                }
              />
            ) : null}
          </StepCard>

          <StepCard
            open
            n={2}
            id="paso-2"
            state={closeState}
            title={canWrite ? `Cerrá ${noun}` : 'El cierre'}
            summary={closeSummary}
            action={
              canReopen ? (
                <ReopenMonthMenu tenantSlug={tenantSlug} month={period.month} monthNoun={noun} />
              ) : undefined
            }
          >
            {canWrite && canClose && checklist ? (
              <CloseStepBody
                plan={plan}
                position={iva}
                ivaHref={bookHref(`${books}/posicion-iva`, { mes: month.month })}
              >
                <CloseMonthButton
                  tenantSlug={tenantSlug}
                  month={period.month}
                  monthNoun={noun}
                  nextMonthNoun={nextNoun}
                  warningKeys={checklist.warningKeys}
                  emphasis={closeState === 'current' ? 'primary' : 'quiet'}
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
              </CloseStepBody>
            ) : null}
          </StepCard>

          <StepCard
            open
            n={3}
            id="paso-3"
            state={sendState}
            title={canWrite ? 'Mandale los libros a tu contadora' : 'Los libros'}
            summary={
              closed
                ? `${name} ya está cerrado: los números no cambian más.`
                : 'Cuando el mes esté cerrado.'
            }
          >
            {closed ? (
              <SendStepBody
                month={month.month}
                audience={audience}
                link={`${url ?? ''}${bookHref(books, { mes: month.month })}`}
                inviteHref={`/${tenantSlug}/configuracion/equipo?rol=accountant`}
                files={files}
                downloadable={downloadable}
                cuitHref={`${base}/ajustes?tab=sas`}
                indexHref={monthBooksHref}
                receiptsHref={`${base}/compras?tab=comprobantes`}
                primary={sendState === 'current'}
              />
            ) : (
              <PanelLink
                href={monthBooksHref}
                className="max-w-full text-left whitespace-normal text-pretty text-muted-foreground"
              >
                <span>Descargar igual lo que hay hasta hoy (puede cambiar)</span>
                <ArrowRight className="size-3.5 shrink-0" aria-hidden />
              </PanelLink>
            )}
          </StepCard>
        </div>

        <aside
          aria-label={`El mes de ${noun}`}
          className="order-1 min-w-0 lg:sticky lg:top-20 lg:order-2 lg:col-span-5"
        >
          <MonthCover
            data={cover}
            mobileLine={mobileLine}
            books={coverBooks}
            booksOpen={!canWrite}
          />
        </aside>
      </div>

      {canWrite && fyCandidate ? (
        <FiscalYearPanel
          tenantSlug={tenantSlug}
          base={base}
          year={fyCandidate}
          previousOpen={previousOpen}
          preview={fyPreview}
        />
      ) : null}

      <AllMonths
        years={years}
        events={events.ok ? events.data : []}
        tenantSlug={tenantSlug}
        path={path}
        today={today}
        canWrite={canWrite}
        lastClosedId={lastClosed?.id ?? null}
        changed={changed}
        open={!canWrite}
      />

      <QuickActionsBar />
    </AdmPage>
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
    <Panel
      title={`Cerrar el ejercicio ${label}`}
      description={`${yearLabel(year)} · todos sus meses están cerrados.`}
    >
      <div className="space-y-4 text-sm">
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
            <p className="font-serif text-xl font-semibold tracking-tight">
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
                <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
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
              <Button asChild variant="outline" size="sm" className="h-11 gap-2 md:h-8">
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
    </Panel>
  )
}
