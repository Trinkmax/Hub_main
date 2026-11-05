import Link from 'next/link'
import { Suspense } from 'react'
import { Amount } from '@/components/administracion/amount'
import { Planilla, PRow, PTable, PTd, PTh, PTotalRow } from '@/components/administracion/planilla'
import { Stamp } from '@/components/administracion/planilla/stamp'
import { ActionButton } from '@/components/administracion/quick-actions'
import { VoucherText } from '@/components/administracion/voucher-text'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  entryKindLabel,
  exportHref,
  getJournal,
  getJournalSummary,
  JOURNAL_PAGE_LIMIT,
  type JournalEntryRow,
  type JournalSummary,
  type QueryOutcome,
  settleQuery,
} from '@/lib/accounting/queries'
import { decodePageToken } from '@/lib/accounting/queries/shared'
import { formatIsoDay, todayInCordoba } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { BookPage, SLIDING_SHEET } from '../_components/book-page'
import { ClickableBody } from '../_components/clickable-body'
import { EntryPanelProvider, OpenEntryButton } from '../_components/entry-panel'
import { KeysetPagination } from '../_components/keyset-pagination'
import { RangePicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { loadBookContext } from '../_lib/book-context'
import { keysetPageInfo } from '../_lib/keyset'
import { requireBooksAccess } from '../_lib/page-access'
import { bookHref, firstParam, periodParams, resolveBookRange } from '../_lib/periods'
import { lineDetail } from '../mayor/_lib/ledger-rows'

export const metadata = { title: 'Libro diario' }

/** Asientos por página (el diario pide de a 100; la base acepta hasta 200). */
const PAGE_SIZE = 100

/**
 * El Libro diario: los asientos en orden, como en el papel. Fecha · Asiento · Cuenta · Debe · Haber,
 * el haber con sangría y el comprobante chiquito debajo. Tocar un asiento abre el mismo panel que el
 * Mayor. Los totales son de todo el período y llegan después de pintar la tabla.
 */
export default async function DiarioPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const path = `${base}/libros/diario`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, path)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const range = resolveBookRange(sp, today)
  const shown = range.ok ? range : resolveBookRange({}, today)
  if (!shown.ok) throw new Error('período por defecto inválido')
  const despues = firstParam(sp.despues)

  const [ctx, journal] = await Promise.all([
    loadBookContext(tenantId, today),
    range.ok
      ? settleQuery(
          getJournal(tenantId, {
            from: range.from,
            to: range.to,
            after: despues,
            limit: Math.min(PAGE_SIZE, JOURNAL_PAGE_LIMIT),
          }),
        )
      : Promise.resolve(null),
  ])
  // Los totales de TODO el período (no de la página) llegan después de pintar la tabla.
  const summary = range.ok
    ? settleQuery(getJournalSummary(tenantId, { from: range.from, to: range.to }))
    : null

  const period = periodParams(shown)
  const page = journal?.ok ? journal.data : null
  const info = page
    ? keysetPageInfo({
        seenBefore: decodePageToken(despues)?.seen ?? 0,
        rows: page.rows.length,
        totalRows: page.totalRows,
        pageSize: PAGE_SIZE,
      })
    : null

  return (
    <EntryPanelProvider tenantSlug={tenantSlug} canWrite={canWrite}>
      <BookPage
        title="Libro diario"
        toolbar={
          <RangePicker
            range={shown}
            today={today}
            fiscalYear={ctx.fiscalYear}
            minMonth={ctx.minMonth}
          />
        }
        aside={
          summary && page && page.rows.length > 0 ? (
            <Suspense fallback={null}>
              <SummarySeal summary={summary} />
            </Suspense>
          ) : null
        }
        exports={[
          {
            href: exportHref(tenantSlug, 'diario', { desde: shown.from, hasta: shown.to }),
            fileName: `administracion-${tenantSlug}-diario-${shown.from}_${shown.to}.csv`,
          },
        ]}
      >
        {!range.ok ? <PeriodError message={range.message} /> : null}
        {journal && !journal.ok ? (
          <QueryErrorBlock code={journal.code} message={journal.message} />
        ) : null}

        {page && info ? (
          <>
            <Planilla className={SLIDING_SHEET}>
              <PTable minWidth={680} label={`Libro diario, ${shown.label}`}>
                <thead>
                  <tr>
                    <PTh>Fecha</PTh>
                    <PTh>Asiento</PTh>
                    <PTh>Cuenta</PTh>
                    <PTh align="right">Debe</PTh>
                    <PTh align="right">Haber</PTh>
                  </tr>
                </thead>
                {page.rows.length === 0 ? (
                  <tbody>
                    <tr>
                      <PTd colSpan={5} className="py-6 text-center text-muted-foreground">
                        <EmptyJournal
                          base={base}
                          label={shown.label}
                          canWrite={canWrite}
                          nothingLoaded={ctx.settings !== null && !ctx.settings.hasDocuments}
                        />
                      </PTd>
                    </tr>
                  </tbody>
                ) : (
                  page.rows.map((entry) => <EntryRows key={entry.entryId} entry={entry} />)
                )}
                {page.rows.length > 0 && summary ? (
                  <tfoot>
                    <PTotalRow>
                      <PTd colSpan={3} className="font-semibold">
                        Totales
                      </PTd>
                      <PTd align="right" className="font-semibold">
                        <Suspense fallback={<TotalPending />}>
                          <SummaryAmount summary={summary} side="debit" />
                        </Suspense>
                      </PTd>
                      <PTd align="right" className="font-semibold">
                        <Suspense fallback={<TotalPending />}>
                          <SummaryAmount summary={summary} side="credit" />
                        </Suspense>
                      </PTd>
                    </PTotalRow>
                  </tfoot>
                ) : null}
              </PTable>
            </Planilla>
            <KeysetPagination
              info={info}
              noun="asientos"
              firstHref={bookHref(path, period)}
              nextHref={
                page.nextCursor ? bookHref(path, { ...period, despues: page.nextCursor }) : null
              }
            />
          </>
        ) : null}
      </BookPage>
    </EntryPanelProvider>
  )
}

function TotalPending() {
  return <Skeleton className="ml-auto inline-block h-4 w-24 align-middle" />
}

/** El Debe o el Haber de todo el período; «—» si no se pudo sumar. */
async function SummaryAmount({
  summary,
  side,
}: {
  summary: Promise<QueryOutcome<JournalSummary>>
  side: 'debit' | 'credit'
}) {
  const result = await summary
  if (!result.ok) return <span className="text-muted-foreground">—</span>
  return (
    <Amount
      cents={side === 'debit' ? result.data.debitCents : result.data.creditCents}
      currency={false}
    />
  )
}

async function SummarySeal({ summary }: { summary: Promise<QueryOutcome<JournalSummary>> }) {
  const result = await summary
  if (!result.ok) return null
  return result.data.balanced ? <Stamp>Debe = Haber</Stamp> : <Stamp tone="bad">No cuadra</Stamp>
}

/** Una oración y sus botones, adentro de la misma planilla. */
function EmptyJournal({
  base,
  label,
  canWrite,
  nothingLoaded,
}: {
  base: string
  label: string
  canWrite: boolean
  nothingLoaded: boolean
}) {
  return (
    <div className="grid justify-items-center gap-3">
      <p className="text-pretty">
        {nothingLoaded
          ? 'Todavía no hay nada cargado.'
          : `No hay asientos en ${label.toLowerCase()}.`}{' '}
        {canWrite
          ? 'Cada gasto, pago o cierre del día que cargues suma su asiento acá.'
          : 'Cuando los dueños carguen gastos, ventas y pagos, sus asientos aparecen acá.'}
      </p>
      {canWrite ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ActionButton action="gasto" className="h-11 gap-2 md:pointer-fine:h-9" />
          <Button asChild variant="outline" className="h-11 md:pointer-fine:h-9">
            <Link href={`${base}/ventas/cierre`}>Cierre del día</Link>
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** El número del asiento: congelado, o provisorio (en cursiva) mientras el mes está abierto. */
function EntryNumber({ entry }: { entry: JournalEntryRow }) {
  if (entry.number === null) return <span>Ver</span>
  return entry.numberIsProvisional ? (
    <span className="italic" title="Provisorio: se numera al cerrar el mes">
      #{entry.number}
      <span className="sr-only"> (provisorio)</span>
    </span>
  ) : (
    <span>#{entry.number}</span>
  )
}

/** Un asiento: su fecha y su número en el primer renglón; el haber, con sangría. */
function EntryRows({ entry }: { entry: JournalEntryRow }) {
  const caption = lineDetail(
    {
      documentLabel: entry.documentLabel,
      description: entry.description,
      partyName: null,
      memo: null,
    },
    false,
  )
  return (
    <ClickableBody className="border-b border-border last:border-b-0">
      {entry.lines.map((line, index) => {
        const isCredit = line.debitCents === 0 && line.creditCents !== 0
        return (
          <PRow key={`${entry.entryId}:${line.lineNo}`} className="cursor-pointer">
            <PTd className="align-top whitespace-nowrap text-muted-foreground">
              {index === 0 ? formatIsoDay(entry.entryDate) : null}
            </PTd>
            <PTd className="align-top whitespace-nowrap">
              {index === 0 ? (
                <OpenEntryButton
                  entryId={entry.entryId}
                  aria-label={
                    entry.number === null
                      ? `Ver el asiento del ${formatIsoDay(entry.entryDate)}`
                      : `Ver el asiento ${entry.number}${entry.numberIsProvisional ? ' (provisorio)' : ''}`
                  }
                >
                  <EntryNumber entry={entry} />
                </OpenEntryButton>
              ) : null}
            </PTd>
            <PTd className={cn('align-top', isCredit && 'pl-8')}>
              <span className="block">
                {line.accountName}
                {line.partyName ? (
                  <span className="text-muted-foreground"> · {line.partyName}</span>
                ) : null}
              </span>
              {line.memo && line.memo !== line.accountName && line.memo !== entry.documentLabel ? (
                <span className="block text-xs text-muted-foreground">{line.memo}</span>
              ) : null}
              {index === 0 ? (
                <span className="block text-xs text-muted-foreground text-pretty">
                  {entry.documentLabel ? <VoucherText text={entry.documentLabel} /> : null}
                  {entry.documentLabel && caption ? ' · ' : null}
                  {caption}
                  {entry.kind !== 'standard' ? ` · ${entryKindLabel(entry.kind)}` : null}
                </span>
              ) : null}
            </PTd>
            <PTd align="right" className="align-top">
              {line.debitCents ? <Amount cents={line.debitCents} currency={false} /> : null}
            </PTd>
            <PTd align="right" className="align-top">
              {line.creditCents ? <Amount cents={line.creditCents} currency={false} /> : null}
            </PTd>
          </PRow>
        )
      })}
    </ClickableBody>
  )
}
