import { Ban, Info } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Amount } from '@/components/administracion/amount'
import { DueStatus } from '@/components/administracion/due-status'
import { EntryPreview, type EntryPreviewData } from '@/components/administracion/entry-preview'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageShell } from '@/components/ui/page-shell'
import { entryKindLabel, getDocument, getEntry, settleQuery } from '@/lib/accounting/queries'
import { formatDateTime, formatIsoDay, todayInCordoba } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { BackLink } from '../../libros/_components/book-page'
import { QueryErrorBlock } from '../../libros/_components/report-error'
import { requireBooksAccess } from '../../libros/_lib/page-access'

export const metadata = { title: 'Asiento' }

export default async function AsientoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params
  const base = `/${tenantSlug}/administracion`
  const { access } = await requireBooksAccess(tenantSlug, `${base}/asientos/${id}`)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const result = await settleQuery(getEntry(tenantId, id))
  if (result.ok && !result.data) notFound()
  if (!result.ok || !result.data) {
    return (
      <PageShell width="comfortable">
        <BackLink href={`${base}/libros/diario`}>Volver al libro diario</BackLink>
        <QueryErrorBlock
          code={result.ok ? 'error' : result.code}
          message={result.ok ? 'No pudimos cargar el asiento.' : result.message}
        />
      </PageShell>
    )
  }

  const entry = result.data
  const docResult = await settleQuery(getDocument(tenantId, entry.documentId))
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

  const preview: EntryPreviewData = {
    documentRef: entry.id,
    description: entry.description,
    date: entry.entryDate,
    lines: entry.lines.map((l) => ({
      id: l.id,
      accountCode: l.accountCode,
      accountName: l.accountName,
      partyName: l.partyName,
      debitCents: l.side === 'debit' ? l.amountCents : null,
      creditCents: l.side === 'credit' ? l.amountCents : null,
      note: l.memo,
    })),
  }
  const partidas = entry.lines.filter((l) => l.partyId)

  return (
    <PageShell width="comfortable">
      <BackLink href={`${base}/libros/diario?mes=${month}`}>Volver al libro diario</BackLink>

      <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl"
        />
        {/* En el celular, el importe y los botones van debajo (al lado se pisaban con el título). */}
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Asiento · {entryKindLabel(entry.kind)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <h1
                className={cn(
                  'font-display text-2xl font-semibold tracking-tight',
                  provisional !== null && 'italic',
                )}
              >
                {title}
              </h1>
              {entry.status === 'voided' ? (
                <Badge
                  variant="outline"
                  className="border-destructive/30 bg-destructive/10 text-destructive"
                >
                  Anulado
                </Badge>
              ) : (
                <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                  Vigente
                </Badge>
              )}
            </div>
            <p className="text-sm font-medium">{entry.description || '—'}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="tabular-nums">{formatIsoDay(entry.entryDate)}</span>
              <span>Mes {entry.periodStatus === 'open' ? 'abierto' : 'cerrado'}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Lo cargó {entry.createdByName || 'alguien del equipo'} el{' '}
              {formatDateTime(entry.createdAt)}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Amount
              cents={entry.debitCents}
              className="font-serif text-3xl font-semibold tracking-tight"
            />
            <p className="text-xs text-muted-foreground">Debe = Haber</p>
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href={`${base}/comprobantes/${entry.documentId}`}>
                {doc ? `Ver ${doc.title} #${doc.seq}` : 'Ver comprobante'}
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {entry.status === 'voided' ? (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
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

      {entry.status === 'posted' && entry.number === null ? (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p className="text-pretty">
            {provisional !== null
              ? `El N° ${provisional} es provisorio (por eso va en cursiva): queda fijo al cerrar el mes.`
              : 'El número queda fijo al cerrar el mes. Mientras tanto, en el libro diario se ve uno provisorio (en cursiva).'}
          </p>
        </div>
      ) : null}

      {entry.isMirror ? (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p className="text-pretty">
            Es un asiento espejo del cierre del ejercicio: está en el libro diario como lo pide la
            contadora, pero no cambia ningún saldo.
          </p>
        </div>
      ) : null}

      <EntryPreview entries={[preview]} alwaysOpen />

      {partidas.length > 0 ? (
        <section className="card-hairline rounded-xl border bg-card">
          <header className="border-b border-border/60 px-5 py-4">
            <h2 className="font-serif text-lg font-semibold tracking-tight">
              Con proveedores y clientes
            </h2>
            <p className="text-xs text-muted-foreground">
              Las líneas que dejan deuda o crédito, con lo que queda pendiente hoy.
            </p>
          </header>
          <ul className="divide-y divide-border/60">
            {partidas.map((line) => (
              <li
                key={line.id}
                className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
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
        </section>
      ) : null}
    </PageShell>
  )
}
