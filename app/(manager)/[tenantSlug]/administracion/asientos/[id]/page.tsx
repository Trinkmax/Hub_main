import { ArrowRight, Ban, Info } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Amount } from '@/components/administracion/amount'
import { DueStatus } from '@/components/administracion/due-status'
import { EntryPreview, type EntryPreviewData } from '@/components/administracion/entry-preview'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { Panel } from '@/components/administracion/kit/panel'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { entryKindLabel, getDocument, getEntry, settleQuery } from '@/lib/accounting/queries'
import { formatDateTime, formatIsoDay, todayInCordoba } from '@/lib/dates'
import { QueryErrorBlock } from '../../libros/_components/report-error'
import { requireBooksAccess } from '../../libros/_lib/page-access'

export const metadata = { title: 'Asiento' }

/**
 * La ficha de un asiento: cómo quedó anotado un comprobante en los libros. Es
 * una pantalla de la contadora, pero un socio cae acá desde el diario o el
 * mayor; por eso abre con una oración para quien no es contador («Así quedó
 * anotado … en los libros») y el botón que lo lleva a lo que sí conoce: el
 * comprobante. Acá no se carga ni se cambia nada.
 */
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
      <AdmPage width="comfortable">
        <AdmHeader
          back={{ href: `${base}/libros/diario`, label: 'Libro diario' }}
          title="Asiento"
        />
        <QueryErrorBlock
          code={result.ok ? 'error' : result.code}
          message={result.ok ? 'No pudimos cargar el asiento.' : result.message}
        />
      </AdmPage>
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

  const documentName = doc ? `${doc.title} #${doc.seq}` : null

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={{ href: `${base}/libros/diario?mes=${month}`, label: 'Libro diario' }}
        title={<span className={provisional !== null ? 'italic' : undefined}>{title}</span>}
        badge={
          <>
            <ReadOnlyBadge className="ml-0" />
            {entry.status === 'voided' ? (
              <StatusPill tone="late">Anulado</StatusPill>
            ) : (
              <StatusPill tone="ok">Vigente</StatusPill>
            )}
          </>
        }
        description={
          <>
            <span className="font-medium text-foreground">{entry.description || '—'}</span>
            <span className="tabular-nums"> · {formatIsoDay(entry.entryDate)}</span> · Mes{' '}
            {entry.periodStatus === 'open' ? 'abierto' : 'cerrado'} · Lo cargó{' '}
            {entry.createdByName || 'alguien del equipo'} el {formatDateTime(entry.createdAt)}
          </>
        }
      />

      {/* Para quien no es contador: qué es esto y a dónde ir a ver lo que sí conoce. */}
      <section
        aria-label="De qué comprobante es"
        className="card-hairline flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        <div className="min-w-0 space-y-1">
          <p className="text-base leading-snug text-pretty">
            Así quedó anotado{' '}
            <span className="font-semibold">{documentName ?? 'este comprobante'}</span> en los
            libros.
          </p>
          <p className="text-sm text-muted-foreground">
            {entryKindLabel(entry.kind)} · por <Amount cents={entry.debitCents} /> · Debe = Haber
          </p>
        </div>
        <Button asChild className="h-11 shrink-0 gap-2 px-5">
          <Link href={`${base}/comprobantes/${entry.documentId}`}>
            Ver el comprobante
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </section>

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
        <Panel
          title="Con proveedores y clientes"
          description="Las líneas que dejan deuda o crédito, con lo que queda pendiente hoy."
        >
          <ul className="divide-y divide-border/60">
            {partidas.map((line) => (
              <li
                key={line.id}
                className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
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
        </Panel>
      ) : null}
    </AdmPage>
  )
}
