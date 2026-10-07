import { BookText, CircleAlert, CircleCheck } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import {
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import {
  entryKindLabel,
  exportHref,
  getJournal,
  JOURNAL_PAGE_LIMIT,
  type JournalEntryRow,
  settleQuery,
} from '@/lib/accounting/queries'
import { decodePageToken } from '@/lib/accounting/queries/shared'
import { formatIsoDay, todayInCordoba } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { BookPage, WideBookHint } from '../_components/book-page'
import { ExportButton } from '../_components/export-button'
import { KeysetPagination } from '../_components/keyset-pagination'
import { RangePicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { loadBookContext } from '../_lib/book-context'
import { keysetPageInfo } from '../_lib/keyset'
import { requireBooksAccess } from '../_lib/page-access'
import { bookHref, firstParam, periodParams, resolveBookRange } from '../_lib/periods'

export const metadata = { title: 'Libro diario' }

/** Asientos por página (el diario pide de a 100; la base acepta hasta 200). */
const PAGE_SIZE = 100

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

  const period = periodParams(shown)
  const exportLink = exportHref(tenantSlug, 'diario', { desde: shown.from, hasta: shown.to })
  const fileName = `administracion-${tenantSlug}-diario-${shown.from}_${shown.to}.csv`
  const page = journal?.ok ? journal.data : null
  const info = page
    ? keysetPageInfo({
        seenBefore: decodePageToken(despues)?.seen ?? 0,
        rows: page.rows.length,
        totalRows: page.totalRows,
        pageSize: PAGE_SIZE,
      })
    : null
  const description = page
    ? `${shown.label} · ${plural(page.totalRows, 'asiento', 'asientos')}`
    : shown.label

  return (
    <BookPage
      backHref={bookHref(`${base}/libros`, shown.month ? { mes: shown.month } : {})}
      title="Libro diario"
      description={description}
      actions={<ExportButton href={exportLink} fileName={fileName} />}
      toolbar={
        <RangePicker
          range={shown}
          today={today}
          fiscalYear={ctx.fiscalYear}
          minMonth={ctx.minMonth}
        />
      }
    >
      {!range.ok ? <PeriodError message={range.message} /> : null}
      {journal && !journal.ok ? (
        <QueryErrorBlock code={journal.code} message={journal.message} />
      ) : null}

      {page && info ? (
        page.rows.length === 0 ? (
          <EmptyJournal
            base={base}
            label={shown.label}
            canWrite={canWrite}
            nothingLoaded={ctx.settings !== null && !ctx.settings.hasDocuments}
          />
        ) : (
          <>
            {page.rows.some((e) => e.numberIsProvisional) ? (
              <p className="text-xs text-muted-foreground">
                Los números en <span className="italic">cursiva</span> son provisorios: quedan fijos
                al cerrar el mes.
              </p>
            ) : null}
            <WideBookHint />
            <JournalTable
              rows={page.rows}
              base={base}
              caption={`Libro diario, ${shown.label}`}
              totalsLabel={
                info.isFirst && !page.nextCursor ? 'Totales del período' : 'Totales de esta página'
              }
            />
            <KeysetPagination
              info={info}
              noun="asientos"
              firstHref={bookHref(path, period)}
              nextHref={
                page.nextCursor ? bookHref(path, { ...period, despues: page.nextCursor }) : null
              }
            />
          </>
        )
      ) : null}
    </BookPage>
  )
}

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
    <EmptyState
      icon={BookText}
      title={nothingLoaded ? 'Todavía no hay nada cargado' : `No hay asientos en ${label}`}
      description={
        canWrite
          ? 'El diario se arma solo: cada gasto, pago o cierre del día que cargues suma su asiento acá.'
          : 'Cuando los dueños carguen gastos, ventas y pagos, sus asientos aparecen acá.'
      }
      action={
        canWrite ? (
          <div className="flex flex-wrap justify-center gap-2">
            <ActionButton action="gasto" className="h-11 gap-2 md:h-9" />
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href={`${base}/ventas/cierre`}>Cierre del día</Link>
            </Button>
          </div>
        ) : null
      }
    />
  )
}

/** El número del asiento: congelado, o provisorio (en cursiva) mientras el mes está abierto. */
function EntryNumber({ entry }: { entry: JournalEntryRow }) {
  if (entry.number === null) return <span className="text-muted-foreground">—</span>
  return entry.numberIsProvisional ? (
    <span className="italic" title="Provisorio: se numera al cerrar el mes">
      {entry.number}
      <span className="sr-only"> (provisorio)</span>
    </span>
  ) : (
    <span>{entry.number}</span>
  )
}

function JournalTable({
  rows,
  base,
  caption,
  totalsLabel,
}: {
  rows: readonly JournalEntryRow[]
  base: string
  caption: string
  totalsLabel: string
}) {
  let debit = 0
  let credit = 0
  for (const entry of rows) {
    for (const line of entry.lines) {
      debit += line.debitCents
      credit += line.creditCents
    }
  }
  const balanced = debit === credit

  return (
    <>
      {/* Compu y tablet: el diario completo. */}
      <DataTableShell className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">{caption}</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader className="w-16">N°</DataTableHeader>
                <DataTableHeader className="w-28">Fecha</DataTableHeader>
                <DataTableHeader>Cuenta</DataTableHeader>
                <DataTableHeader>Proveedor o cliente</DataTableHeader>
                <DataTableHeader className="w-36 text-right">Debe</DataTableHeader>
                <DataTableHeader className="w-36 text-right">Haber</DataTableHeader>
              </tr>
            </DataTableHead>
            {rows.map((entry) => (
              <tbody key={entry.entryId} className="border-b border-border/60 last:border-b-0">
                <tr className="bg-secondary/20">
                  <DataTableCell className="py-2 font-medium tabular-nums">
                    <Link
                      href={`${base}/asientos/${entry.entryId}`}
                      className="rounded-sm underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={
                        entry.number === null
                          ? `Ver el asiento del ${formatIsoDay(entry.entryDate)}`
                          : `Ver el asiento ${entry.number}${entry.numberIsProvisional ? ' (provisorio)' : ''}`
                      }
                    >
                      <EntryNumber entry={entry} />
                    </Link>
                  </DataTableCell>
                  <DataTableCell className="whitespace-nowrap py-2 tabular-nums text-muted-foreground">
                    {formatIsoDay(entry.entryDate)}
                  </DataTableCell>
                  <DataTableCell colSpan={4} className="py-2">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium">{entry.description || '—'}</span>
                      {entry.documentLabel ? (
                        <Link
                          href={`${base}/comprobantes/${entry.documentId}`}
                          className="text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                        >
                          {entry.documentLabel}
                          {entry.documentSeq ? ` · #${entry.documentSeq}` : ''}
                        </Link>
                      ) : null}
                      {entry.kind !== 'standard' ? (
                        <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {entryKindLabel(entry.kind)}
                        </span>
                      ) : null}
                      {entry.createdByName ? (
                        <span className="text-xs text-muted-foreground">
                          Cargado por {entry.createdByName}
                        </span>
                      ) : null}
                    </span>
                  </DataTableCell>
                </tr>
                {entry.lines.map((line) => {
                  const isCredit = line.debitCents === 0 && line.creditCents !== 0
                  return (
                    <tr key={`${entry.entryId}:${line.lineNo}`}>
                      <DataTableCell className="py-1.5">{null}</DataTableCell>
                      <DataTableCell className="py-1.5">{null}</DataTableCell>
                      <DataTableCell className={cn('py-1.5', isCredit && 'pl-10')}>
                        <span className="flex items-baseline gap-1.5">
                          {isCredit ? <span className="text-muted-foreground">a</span> : null}
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {line.accountCode}
                          </span>
                          <span>{line.accountName}</span>
                        </span>
                        {line.memo ? (
                          <span className="block text-xs text-muted-foreground">{line.memo}</span>
                        ) : null}
                      </DataTableCell>
                      <DataTableCell className="py-1.5 text-muted-foreground">
                        {line.partyName ?? null}
                      </DataTableCell>
                      <DataTableCell className="py-1.5 text-right">
                        {line.debitCents ? (
                          <Amount cents={line.debitCents} currency={false} />
                        ) : null}
                      </DataTableCell>
                      <DataTableCell className="py-1.5 text-right">
                        {line.creditCents ? (
                          <Amount cents={line.creditCents} currency={false} />
                        ) : null}
                      </DataTableCell>
                    </tr>
                  )
                })}
              </tbody>
            ))}
            <tfoot className="bg-secondary/30 font-semibold">
              <tr className="border-t border-border">
                <DataTableCell colSpan={4} className="text-xs">
                  <span className="flex flex-wrap items-center gap-2">
                    {totalsLabel}
                    <BalanceSeal balanced={balanced} />
                  </span>
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={debit} currency={false} />
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={credit} currency={false} />
                </DataTableCell>
              </tr>
            </tfoot>
          </DataTableRoot>
        </DataTableScroll>
      </DataTableShell>

      {/* Celular: la lista simplificada (cada asiento lleva a su detalle). */}
      <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
        <ul aria-label={caption} className="divide-y divide-border/60">
          {rows.map((entry) => (
            <li key={entry.entryId}>
              <Link
                href={`${base}/asientos/${entry.entryId}`}
                className="flex items-start justify-between gap-3 px-4 py-3 outline-none hover:bg-cream-tint focus-visible:bg-cream-tint"
              >
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    N° <EntryNumber entry={entry} /> · {formatIsoDay(entry.entryDate)}
                  </span>
                  <span className="block truncate text-sm font-medium">
                    {entry.description || entry.documentLabel || '—'}
                  </span>
                  {entry.documentLabel ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.documentLabel}
                    </span>
                  ) : null}
                </span>
                <Amount cents={entry.totalCents} className="shrink-0 text-sm font-medium" />
              </Link>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 bg-secondary/30 px-4 py-3 text-sm font-semibold">
            <span className="flex items-center gap-2">
              {totalsLabel}
              <BalanceSeal balanced={balanced} />
            </span>
            <Amount cents={debit} />
          </li>
        </ul>
      </div>
    </>
  )
}

/** «Debe = Haber» (o el aviso, que no debería verse nunca). */
function BalanceSeal({ balanced }: { balanced: boolean }) {
  return balanced ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">
      <CircleCheck className="size-3" aria-hidden />
      Debe = Haber
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
      <CircleAlert className="size-3" aria-hidden />
      No cuadra: avisanos
    </span>
  )
}
