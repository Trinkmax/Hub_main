import { Ban, Info } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Amount } from '@/components/administracion/amount'
import { DueStatus } from '@/components/administracion/due-status'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import {
  Planilla,
  PlanillaTitle,
  PRow,
  PTable,
  PTd,
  PTh,
  PTotalRow,
  SimplePage,
} from '@/components/administracion/planilla'
import { Stamp } from '@/components/administracion/planilla/stamp'
import { VoucherText } from '@/components/administracion/voucher-text'
import { Button } from '@/components/ui/button'
import { loadPostingCatalog } from '@/lib/accounting/context'
import {
  entryKindLabel,
  getDocument,
  getEntry,
  getImputationFlags,
  listLineReimputations,
  settleQuery,
} from '@/lib/accounting/queries'
import {
  imputationFlagText,
  reimputeAccountOptions,
  reimputeTargets,
} from '@/lib/accounting/reimpute'
import { formatDateTime, formatIsoDay, todayInCordoba } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { BackLink, SLIDING_SHEET } from '../../libros/_components/book-page'
import { ReimputationList, ReimputeBlock } from '../../libros/_components/reimpute-form'
import { QueryErrorBlock } from '../../libros/_components/report-error'
import { requireBooksAccess } from '../../libros/_lib/page-access'

export const metadata = { title: 'Asiento' }

const TITLE = 'font-serif text-2xl font-semibold tracking-tight'

/**
 * La ficha de un asiento: cómo quedó anotado un comprobante en los libros, con sus renglones y a un
 * toque el comprobante. Es la versión de pantalla entera del panel del Mayor: se llega desde un link,
 * el historial o el cierre del ejercicio. Acá también se reimputa (Silvia, min. 12: «entrar al asiento
 * y cambiarle el número de cuenta»).
 */
export default async function AsientoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params
  const base = `/${tenantSlug}/administracion`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, `${base}/asientos/${id}`)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const result = await settleQuery(getEntry(tenantId, id))
  if (result.ok && !result.data) notFound()
  if (!result.ok || !result.data) {
    return (
      <SimplePage width="narrow">
        <div className="grid gap-1">
          <BackLink href={`${base}/libros/diario`}>Libro diario</BackLink>
          <h1 className={TITLE}>Asiento</h1>
        </div>
        <QueryErrorBlock
          code={result.ok ? 'error' : result.code}
          message={result.ok ? 'No pudimos cargar el asiento.' : result.message}
        />
      </SimplePage>
    )
  }

  const entry = result.data
  const [docResult, catalog, flags, reimputations] = await Promise.all([
    settleQuery(getDocument(tenantId, entry.documentId)),
    settleQuery(loadPostingCatalog(tenantId)),
    settleQuery(getImputationFlags(tenantId, { from: entry.entryDate, to: entry.entryDate })),
    settleQuery(listLineReimputations(tenantId, entry.documentId)),
  ])
  const doc = docResult.ok ? docResult.data : null
  const month = entry.entryDate.slice(0, 7)
  // Mes abierto: el número que se ve en el diario (provisorio, en cursiva) hasta cerrar el mes.
  const provisional =
    entry.number === null && entry.status === 'posted' ? entry.provisionalNumber : null
  const title =
    entry.number !== null
      ? `Asiento N° ${entry.number}`
      : entry.status === 'voided'
        ? 'Asiento anulado'
        : provisional !== null
          ? `Asiento N° ${provisional}`
          : 'Asiento sin número todavía'

  const partidas = entry.lines.filter((l) => l.partyId)
  const documentName = doc ? `${doc.title} #${doc.seq}` : null
  const ownFlags = flags.ok ? flags.data.filter((f) => f.documentId === entry.documentId) : []
  const usualOf = new Map(ownFlags.map((f) => [f.accountId, f]))
  const periodOpen = entry.periodStatus === 'open'
  const targets =
    doc && catalog.ok
      ? reimputeTargets(doc, new Map(catalog.data.accounts.map((a) => [a.id, a])), ownFlags)
      : []

  return (
    <SimplePage width="narrow">
      <div className="grid gap-1">
        <BackLink href={`${base}/libros/diario?mes=${month}`}>Libro diario</BackLink>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className={cn(TITLE, provisional !== null && 'italic')}>{title}</h1>
          {entry.status === 'voided' ? <StatusPill tone="late">Anulado</StatusPill> : null}
          {provisional !== null ? (
            <span className="text-xs text-muted-foreground">
              Provisorio: se fija al cerrar el mes
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground text-pretty">
          <span className="font-medium text-foreground">{entry.description || '—'}</span>
          <span className="tabular-nums"> · {formatIsoDay(entry.entryDate)}</span> ·{' '}
          {entryKindLabel(entry.kind)} · Mes {periodOpen ? 'abierto' : 'cerrado'} · Lo cargó{' '}
          {entry.createdByName || 'alguien del equipo'} el {formatDateTime(entry.createdAt)}
        </p>
      </div>

      {entry.status === 'voided' ? (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="space-y-1 text-pretty">
            <p className="font-medium">
              Anulado
              {entry.voidedAt ? ` el ${formatDateTime(entry.voidedAt)}` : ''}
              {entry.voidedByName ? ` por ${entry.voidedByName}` : ''}. No cuenta en los libros.
            </p>
            {entry.voidReason ? <p>Motivo: {entry.voidReason}</p> : null}
          </div>
        </div>
      ) : null}

      {entry.isMirror ? (
        <p className="flex items-start gap-2 text-sm text-pretty">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          Es un asiento espejo del cierre del ejercicio: está en el libro diario como lo pide la
          contadora, pero no cambia ningún saldo.
        </p>
      ) : null}

      <Planilla className={SLIDING_SHEET}>
        <PlanillaTitle
          title={documentName ? <VoucherText text={documentName} /> : 'Este comprobante'}
          actions={
            <Button asChild variant="outline" size="sm" className="h-11 md:pointer-fine:h-8">
              <Link href={`${base}/comprobantes/${entry.documentId}`}>Abrir comprobante</Link>
            </Button>
          }
        />
        <PTable minWidth={480} label={`Los renglones del ${title.toLowerCase()}`}>
          <thead>
            <tr>
              <PTh>Código</PTh>
              <PTh>Cuenta</PTh>
              <PTh align="right">Debe</PTh>
              <PTh align="right">Haber</PTh>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((line) => {
              const flag = usualOf.get(line.accountId)
              return (
                <PRow key={line.id} flagged={Boolean(flag)}>
                  <PTd className="align-top font-mono text-xs whitespace-nowrap text-muted-foreground">
                    {line.accountCode}
                  </PTd>
                  <PTd className={cn('align-top', line.side === 'credit' && 'pl-8')}>
                    {line.accountName}
                    {line.partyName ? (
                      <span className="text-muted-foreground"> · {line.partyName}</span>
                    ) : null}
                    {line.memo && line.memo !== line.accountName ? (
                      <span className="block text-xs text-muted-foreground">{line.memo}</span>
                    ) : null}
                    {flag ? (
                      <span className="block text-xs font-medium text-destructive">
                        {imputationFlagText(flag, { open: periodOpen })}
                      </span>
                    ) : null}
                  </PTd>
                  <PTd align="right" className="align-top">
                    {line.side === 'debit' ? (
                      <Amount cents={line.amountCents} currency={false} />
                    ) : null}
                  </PTd>
                  <PTd align="right" className="align-top">
                    {line.side === 'credit' ? (
                      <Amount cents={line.amountCents} currency={false} />
                    ) : null}
                  </PTd>
                </PRow>
              )
            })}
          </tbody>
          <tfoot>
            <PTotalRow>
              <PTd colSpan={2} className="font-semibold">
                <span className="flex flex-wrap items-center gap-2">
                  Totales
                  {entry.debitCents === entry.creditCents ? (
                    <Stamp>Debe = Haber</Stamp>
                  ) : (
                    <Stamp tone="bad">No cuadra</Stamp>
                  )}
                </span>
              </PTd>
              <PTd align="right" className="font-semibold">
                <Amount cents={entry.debitCents} currency={false} />
              </PTd>
              <PTd align="right" className="font-semibold">
                <Amount cents={entry.creditCents} currency={false} />
              </PTd>
            </PTotalRow>
          </tfoot>
        </PTable>
      </Planilla>

      {catalog.ok ? (
        <ReimputeBlock
          tenantSlug={tenantSlug}
          base={base}
          targets={targets}
          accounts={reimputeAccountOptions(catalog.data.accounts)}
          periodOpen={periodOpen}
          month={month}
          documentId={entry.documentId}
          canWrite={canWrite}
        />
      ) : null}

      {reimputations.ok ? (
        <ReimputationList
          items={reimputations.data}
          className="rounded-xl border border-border/70 bg-card p-3 shadow-xs sm:p-4"
        />
      ) : null}

      {partidas.length > 0 ? (
        <Planilla>
          <PlanillaTitle title="Con proveedores y clientes" />
          <ul className="divide-y divide-border/60">
            {partidas.map((line) => (
              <li
                key={line.id}
                className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{line.partyName ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono text-[11px]">{line.accountCode}</span>{' '}
                    {line.accountName} · {line.side === 'debit' ? 'Debe' : 'Haber'}{' '}
                    <Amount cents={line.amountCents} />
                  </p>
                  {line.dueDate && entry.status === 'posted' ? (
                    <DueStatus
                      dueDate={line.dueDate}
                      today={today}
                      settled={line.openCents === 0}
                      group={line.side === 'debit' ? 'receivables' : 'payables'}
                      showDate
                    />
                  ) : null}
                </div>
                {entry.status === 'posted' && line.openCents !== null ? (
                  <p className="shrink-0 text-sm sm:text-right">
                    {line.openCents > 0 ? (
                      <>
                        <span className="text-muted-foreground">Pendiente </span>
                        <Amount cents={line.openCents} className="font-medium" />
                      </>
                    ) : (
                      <span className="text-muted-foreground">Sin pendiente</span>
                    )}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Planilla>
      ) : null}
    </SimplePage>
  )
}
