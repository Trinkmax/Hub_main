import {
  CalendarCheck,
  CircleAlert,
  CircleCheck,
  FilePenLine,
  Info,
  OctagonX,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Amount } from '@/components/administracion/amount'
import { EntryPreview } from '@/components/administracion/entry-preview'
import { plural } from '@/components/administracion/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { tryLoadPostingContext } from '@/lib/accounting/context'
import { buildIvaSettlement } from '@/lib/accounting/posting/iva-settlement'
import {
  type CloseChecklist,
  type FiscalYearRow,
  getCloseChecklist,
  listFiscalYears,
  listPeriodEvents,
  type PeriodEventRow,
  type PeriodRow,
  settleQuery,
  verifyClosedPeriods,
} from '@/lib/accounting/queries'
import type { PostingContext } from '@/lib/accounting/types'
import {
  addMonthsToYearMonth,
  formatDate,
  formatDateTime,
  formatIsoDay,
  formatMonthLabel,
  monthName,
  monthOf,
  todayInCordoba,
} from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { BookPage } from '../_components/book-page'
import { QueryErrorBlock } from '../_components/report-error'
import { ivaExpectedFrom } from '../_lib/iva'
import { requireBooksAccess } from '../_lib/page-access'
import {
  CloseFiscalYearButton,
  CloseMonthButton,
  ReopenFiscalYearMenu,
  ReopenMonthMenu,
} from './_components/close-actions'
import { blockerLine, type ChecklistLine, infoLine, warningLine } from './_lib/checklist'
import { type FiscalYearClosePreview, fiscalYearClosePreview } from './_lib/fiscal-year-close'

export const metadata = { title: 'Cierres de mes' }

/** `clientRef` de relleno para la vista previa de la liquidación (no se guarda). */
const PREVIEW_CLIENT_REF = '00000000-0000-4000-8000-000000000000'

function monthNounOf(month: string): string {
  return monthName(Number(month.slice(5, 7)))
}

function yearLabel(year: FiscalYearRow): string {
  return `${formatIsoDay(year.startDate)} al ${formatIsoDay(year.endDate)}`
}

function periodLabel(period: PeriodRow): string {
  if (period.kind === 'fy_adjustments') return `Ajustes de cierre ${period.endsOn.slice(0, 4)}`
  if (period.kind === 'fy_opening') return `Apertura ${period.startsOn.slice(0, 4)}`
  return formatMonthLabel(period.month)
}

export default async function CierresPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params
  const base = `/${tenantSlug}/administracion`
  const path = `${base}/libros/cierres`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, path)
  const tenantId = access.tenant.id
  const today = todayInCordoba()
  const description = canWrite
    ? 'Cerrá cada mes cuando esté completo: después no se puede cargar nada con fecha de ese mes.'
    : 'Qué meses están cerrados, quién los cerró y cuándo.'

  const yearsResult = await settleQuery(listFiscalYears(tenantId))
  if (!yearsResult.ok) {
    return (
      <BookPage
        backHref={`${base}/libros`}
        title="Cierres de mes"
        description={description}
        width="comfortable"
      >
        <QueryErrorBlock code={yearsResult.code} message={yearsResult.message} />
      </BookPage>
    )
  }

  const years = yearsResult.data
  const months = years.flatMap((y) => y.periods.filter((p) => p.kind === 'month'))
  const nextOpen = months.find((p) => p.status === 'open') ?? null
  const lastClosed = [...months].reverse().find((p) => p.status === 'closed') ?? null

  const [checklist, verify, events, loaded] = await Promise.all([
    canWrite && nextOpen ? settleQuery(getCloseChecklist(tenantId, nextOpen.month)) : null,
    settleQuery(verifyClosedPeriods(tenantId)),
    settleQuery(listPeriodEvents(tenantId, { limit: 30 })),
    canWrite ? tryLoadPostingContext(tenantId) : null,
  ])
  const ctx = loaded?.ok ? loaded.ctx : null
  const changed = new Set(verify.ok ? verify.data.filter((v) => !v.ok).map((v) => v.periodId) : [])

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

  const readyMonth = checklist?.ok && checklist.data.canClose ? nextOpen?.id : null

  return (
    <BookPage
      backHref={`${base}/libros`}
      title="Cierres de mes"
      description={description}
      width="comfortable"
    >
      {years.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="Todavía no hay meses en los libros"
          description="Aparecen solos a medida que cargás comprobantes."
        />
      ) : null}

      {canWrite && nextOpen ? (
        checklist && !checklist.ok ? (
          <QueryErrorBlock code={checklist.code} message={checklist.message} />
        ) : checklist?.ok ? (
          <ClosePanel
            tenantSlug={tenantSlug}
            base={base}
            period={nextOpen}
            checklist={checklist.data}
            ctx={ctx}
          />
        ) : null
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

      {[...years].reverse().map((year) => {
        const next = years.find((y) => y.startDate > year.endDate) ?? null
        return (
          <YearCard
            key={year.id}
            year={year}
            tenantSlug={tenantSlug}
            canWrite={canWrite}
            today={today}
            nextOpenId={nextOpen?.id ?? null}
            readyId={readyMonth ?? null}
            lastClosedId={lastClosed?.id ?? null}
            changed={changed}
            showAdjustments={year.periods.every((p) => p.kind !== 'month' || p.status === 'closed')}
            canReopenYear={canWrite && year.status === 'closed' && next?.status !== 'closed'}
          />
        )
      })}

      {events.ok && events.data.length > 0 ? (
        <EventsCard events={events.data} years={years} />
      ) : null}
    </BookPage>
  )
}

function Lines({
  lines,
  tone,
}: {
  lines: readonly ChecklistLine[]
  tone: 'blocker' | 'warning' | 'info'
}) {
  if (lines.length === 0) return null
  const Icon = tone === 'blocker' ? OctagonX : tone === 'warning' ? TriangleAlert : Info
  return (
    <ul className="space-y-2">
      {lines.map((line) => (
        <li key={line.key} className="flex items-start gap-3 text-sm">
          <Icon
            aria-hidden
            className={cn(
              'mt-0.5 size-4 shrink-0',
              tone === 'blocker' && 'text-destructive',
              tone === 'warning' && 'text-warning',
              tone === 'info' && 'text-info',
            )}
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className={cn('text-pretty', tone === 'blocker' && 'font-medium')}>{line.text}</p>
            {line.detail ? <p className="text-xs text-muted-foreground">{line.detail}</p> : null}
          </div>
          {line.href && line.linkLabel ? (
            <Button asChild variant="outline" size="sm" className="h-11 shrink-0 md:h-8">
              <Link href={line.href}>{line.linkLabel}</Link>
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function ClosePanel({
  tenantSlug,
  base,
  period,
  checklist,
  ctx,
}: {
  tenantSlug: string
  base: string
  period: PeriodRow
  checklist: CloseChecklist
  ctx: PostingContext | null
}) {
  const monthNoun = monthNounOf(period.month)
  const nextMonthNoun = monthNounOf(addMonthsToYearMonth(monthOf(period.month), 1))
  const month = { first: period.month, endsOn: checklist.endsOn ?? period.endsOn }
  const blockers = checklist.blockers.map((b) => blockerLine(b, base, month))
  const warnings = checklist.warnings.map((w) => warningLine(w, base))
  const info = checklist.info.map(infoLine).filter((l): l is ChecklistLine => l !== null)

  const iva = checklist.iva
  // Modo «al cerrar» (SAS responsable inscripta): el cierre registra la
  // liquidación si hace falta (`will_generate`) y reemplaza la que quedó vieja
  // (`replaces_document_id`), también cuando el mes ahora da cero (la anula).
  const onClose = Boolean(iva?.applies && iva.mode === 'on_close')
  const replaces = onClose && iva ? iva.replacesDocumentId : null
  const settles = Boolean(onClose && iva && (iva.willGenerate || replaces))
  const voidsOnly = Boolean(settles && iva && !iva.willGenerate)
  const built =
    settles && !voidsOnly && iva && ctx
      ? buildIvaSettlement({ month: period.month, figures: iva.figures }, ctx, {
          clientRef: PREVIEW_CLIENT_REF,
        })
      : null
  const ivaPreview = built?.ok && built.preview.length > 0 ? built.preview : null
  const again = replaces ? ' de nuevo (la anterior quedó vieja)' : ''

  let ivaText: ReactNode = null
  let ivaSummary = ''
  if (iva?.applies) {
    if (voidsOnly) {
      ivaSummary = `Se anula la liquidación del IVA que quedó vieja: ahora el IVA de ${monthNoun} da cero.`
      ivaText = `Al cerrar se anula la liquidación del IVA que quedó vieja: ahora el IVA de ${monthNoun} da cero.`
    } else if (settles && iva) {
      if (iva.toPayCents > 0) {
        ivaSummary = `Se registra la liquidación del IVA${again}: a pagar ${formatCents(iva.toPayCents)}.`
        ivaText = (
          <>
            Al cerrar se registra la liquidación del IVA{again}: a pagar{' '}
            <Amount cents={iva.toPayCents} className="font-medium" />.
          </>
        )
      } else if (iva.inFavorCents > 0) {
        ivaSummary = `Se registra la liquidación del IVA${again}: quedan ${formatCents(iva.inFavorCents)} a favor.`
        ivaText = (
          <>
            Al cerrar se registra la liquidación del IVA{again}: quedan{' '}
            <Amount cents={iva.inFavorCents} className="font-medium" /> a favor.
          </>
        )
      } else {
        ivaSummary = `Se registra la liquidación del IVA${again}: no queda nada a pagar.`
        ivaText = `Al cerrar se registra la liquidación del IVA${again}: no queda nada a pagar.`
      }
    } else if (iva.isZero) {
      ivaText = `El IVA de ${monthNoun} da cero: no hay liquidación.`
    } else if (iva.mode === 'manual') {
      ivaText = 'La liquidación del IVA se registra a mano, en Posición de IVA.'
    } else if (iva.settlementDocumentId) {
      ivaText = 'La liquidación del IVA del mes ya está registrada.'
    }
  }

  return (
    <section aria-labelledby="cerrar-titulo" className="card-hairline rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="space-y-0.5">
          <h2 id="cerrar-titulo" className="font-serif text-lg font-semibold tracking-tight">
            Cerrar {formatMonthLabel(period.month).toLowerCase()}
          </h2>
          <p className="text-xs text-muted-foreground">
            {checklist.canClose
              ? 'Listo para cerrar. Revisá los avisos: no frenan el cierre.'
              : 'Todavía no se puede cerrar.'}
          </p>
        </div>
        {checklist.canClose ? (
          <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
            Listo para cerrar
          </Badge>
        ) : null}
      </header>

      <div className="space-y-5 px-5 py-4">
        <Lines lines={blockers} tone="blocker" />
        {warnings.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Para revisar
            </p>
            <Lines lines={warnings} tone="warning" />
          </div>
        ) : checklist.canClose ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <CircleCheck className="size-4" aria-hidden />
            No hay avisos: está todo cargado.
          </p>
        ) : null}
        <Lines lines={info} tone="info" />

        <div className="space-y-1 rounded-lg border border-border/60 bg-secondary/20 px-4 py-3 text-sm">
          <p>
            {checklist.entriesCount !== null
              ? plural(checklist.entriesCount, 'asiento', 'asientos')
              : '—'}
            {checklist.debitTotalCents !== null ? (
              <>
                {' · Debe '}
                <Amount cents={checklist.debitTotalCents} />
                {' · Haber '}
                <Amount cents={checklist.creditTotalCents ?? checklist.debitTotalCents} />
              </>
            ) : null}
          </p>
          {checklist.numberFrom !== null && checklist.numberTo !== null ? (
            <p className="text-muted-foreground">
              Los asientos de {monthNoun} van a quedar numerados del {checklist.numberFrom} al{' '}
              {checklist.numberTo}.
            </p>
          ) : null}
        </div>

        {ivaText ? <p className="text-sm text-pretty">{ivaText}</p> : null}
        {ivaPreview ? (
          <EntryPreview entries={ivaPreview} label="Ver el asiento de la liquidación" />
        ) : null}
      </div>

      {checklist.canClose ? (
        <footer className="flex justify-end border-t border-border/60 px-5 py-4">
          <CloseMonthButton
            tenantSlug={tenantSlug}
            month={period.month}
            monthNoun={monthNoun}
            nextMonthNoun={nextMonthNoun}
            warningKeys={checklist.warningKeys}
            iva={
              settles && iva
                ? {
                    expected: ivaExpectedFrom(iva),
                    summary: ivaSummary,
                    // Con una liquidación vieja no se puede cerrar sin reemplazarla.
                    optional: !replaces,
                  }
                : null
            }
          />
        </footer>
      ) : null}
    </section>
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
    <section aria-labelledby="ejercicio-titulo" className="card-hairline rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="space-y-0.5">
          <h2 id="ejercicio-titulo" className="font-serif text-lg font-semibold tracking-tight">
            Cerrar el ejercicio {label}
          </h2>
          <p className="text-xs text-muted-foreground">
            {yearLabel(year)} · todos sus meses están cerrados.
          </p>
        </div>
      </header>
      <div className="space-y-4 px-5 py-4 text-sm">
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
              {preview.resultCents > 0
                ? 'Ganancia de '
                : preview.resultCents < 0
                  ? 'Pérdida de '
                  : 'Resultado: '}
              <Amount cents={Math.abs(preview.resultCents)} />
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
                        className="min-w-0 truncate underline-offset-4 hover:text-primary hover:underline"
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
    </section>
  )
}

function YearCard({
  year,
  tenantSlug,
  canWrite,
  today,
  nextOpenId,
  readyId,
  lastClosedId,
  changed,
  showAdjustments,
  canReopenYear,
}: {
  year: FiscalYearRow
  tenantSlug: string
  canWrite: boolean
  today: string
  nextOpenId: string | null
  readyId: string | null
  lastClosedId: string | null
  changed: ReadonlySet<string>
  showAdjustments: boolean
  canReopenYear: boolean
}) {
  const rows = [...year.periods]
    .filter(
      (p) =>
        p.kind === 'month' ||
        p.status === 'closed' ||
        (p.kind === 'fy_adjustments' && showAdjustments),
    )
    .reverse()
  return (
    <section
      aria-label={`Ejercicio ${yearLabel(year)}`}
      className="card-hairline overflow-hidden rounded-xl border bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="space-y-0.5">
          <h2 className="font-serif text-lg font-semibold tracking-tight">
            Ejercicio {yearLabel(year)}
          </h2>
          <p className="text-xs text-muted-foreground">
            {year.status === 'closed'
              ? `Cerrado${year.closedAt ? ` el ${formatDate(year.closedAt)}` : ''}${year.closedByName ? ` por ${year.closedByName}` : ''}`
              : 'Abierto'}
          </p>
        </div>
        {canReopenYear ? (
          <ReopenFiscalYearMenu
            tenantSlug={tenantSlug}
            fiscalYearId={year.id}
            label={year.endDate.slice(0, 4)}
          />
        ) : null}
      </header>
      <ul className="divide-y divide-border/60">
        {rows.map((p) => (
          <PeriodItem
            key={p.id}
            period={p}
            tenantSlug={tenantSlug}
            today={today}
            isNext={p.id === nextOpenId}
            isReady={p.id === readyId}
            canReopen={canWrite && p.id === lastClosedId && year.status === 'open'}
            changed={changed.has(p.id)}
          />
        ))}
      </ul>
    </section>
  )
}

function PeriodItem({
  period: p,
  tenantSlug,
  today,
  isNext,
  isReady,
  canReopen,
  changed,
}: {
  period: PeriodRow
  tenantSlug: string
  today: string
  isNext: boolean
  isReady: boolean
  canReopen: boolean
  changed: boolean
}) {
  const closed = p.status === 'closed'
  const current = p.kind === 'month' && p.startsOn <= today && today <= p.endsOn
  const future = p.startsOn > today
  let detail: string
  if (closed) {
    const when = p.closedAt ? ` el ${formatDate(p.closedAt)}` : ''
    const who = p.closedByName ? ` por ${p.closedByName}` : ''
    const count =
      p.entriesCount !== null
        ? ` · ${plural(p.entriesCount, 'asiento', 'asientos')}${
            p.numberFrom !== null && p.numberTo !== null ? ` (${p.numberFrom}–${p.numberTo})` : ''
          }`
        : ''
    detail = `Cerrado${when}${who}${count}`
  } else if (current) {
    detail = 'En curso'
  } else if (future) {
    detail = 'Todavía no empezó'
  } else if (isNext) {
    detail = isReady ? 'Listo para cerrar' : 'Es el próximo para cerrar'
  } else {
    detail = 'Abierto'
  }

  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{periodLabel(p)}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
        {changed ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <CircleAlert className="size-3.5" aria-hidden />
            Este mes cambió después de cerrarse: avisanos.
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {closed ? (
          <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
            Cerrado
          </Badge>
        ) : isReady ? (
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
            Listo para cerrar
          </Badge>
        ) : (
          <Badge variant="muted">Abierto</Badge>
        )}
        {canReopen ? (
          <ReopenMonthMenu
            tenantSlug={tenantSlug}
            month={p.month}
            monthNoun={monthNounOf(p.month)}
          />
        ) : null}
      </div>
    </li>
  )
}

const EVENT_VERB: Readonly<Record<PeriodEventRow['action'], string>> = {
  closed: 'cerró',
  reopened: 'reabrió',
  fy_closed: 'cerró el ejercicio',
  fy_reopened: 'reabrió el ejercicio',
}

function EventsCard({
  events,
  years,
}: {
  events: readonly PeriodEventRow[]
  years: readonly FiscalYearRow[]
}) {
  const periods = new Map(years.flatMap((y) => y.periods.map((p) => [p.id, p] as const)))
  const yearsById = new Map(years.map((y) => [y.id, y] as const))
  return (
    <section aria-labelledby="historia-cierres" className="card-hairline rounded-xl border bg-card">
      <header className="border-b border-border/60 px-5 py-4">
        <h2 id="historia-cierres" className="font-serif text-lg font-semibold tracking-tight">
          Historia de cierres
        </h2>
        <p className="text-xs text-muted-foreground">
          Quién cerró o reabrió qué, cuándo y por qué.
        </p>
      </header>
      <ul className="divide-y divide-border/60">
        {events.map((e) => {
          const period = e.periodId ? periods.get(e.periodId) : undefined
          const year = e.fiscalYearId ? yearsById.get(e.fiscalYearId) : undefined
          const what =
            e.action === 'fy_closed' || e.action === 'fy_reopened'
              ? year
                ? ` ${yearLabel(year)}`
                : ''
              : period
                ? ` ${periodLabel(period)}`
                : ' un mes'
          return (
            <li key={e.id} className="space-y-0.5 px-5 py-3 text-sm">
              <p className="text-pretty">
                <span className="font-medium">{e.actorName || 'Alguien del equipo'}</span>{' '}
                {EVENT_VERB[e.action]}
                {what}
                {e.reason ? <span className="text-muted-foreground">: «{e.reason}»</span> : null}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {formatDateTime(e.createdAt)}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
