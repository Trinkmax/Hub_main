import { Ban, FilePenLine, FileText, Info, Lock, Repeat } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Amount } from '@/components/administracion/amount'
import { DueStatus } from '@/components/administracion/due-status'
import { EntryPreview, type EntryPreviewData } from '@/components/administracion/entry-preview'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageShell } from '@/components/ui/page-shell'
import {
  COLLECTION_STATUS_LABELS,
  type DocumentDetail,
  type DocumentLink,
  documentKindLabel,
  entryKindLabel,
  getAccountingSettings,
  getDocument,
  PAYMENT_STATUS_LABELS,
  settleQuery,
} from '@/lib/accounting/queries'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import {
  formatDateTime,
  formatIsoDay,
  formatMonthLabel,
  maxIsoDay,
  todayInCordoba,
} from '@/lib/dates'
import { formatCuit, formatVoucherNumber, formatVoucherRange } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { BackLink } from '../../libros/_components/book-page'
import { QueryErrorBlock } from '../../libros/_components/report-error'
import { ivaSummary } from '../../libros/_lib/iva'
import { requireBooksAccess } from '../../libros/_lib/page-access'
import {
  appliedByOthers,
  backLinkFor,
  creditNoteHref,
  documentActions,
} from '../_lib/document-view'
import { ReverseDocumentButton, VoidDocumentButton } from './_components/document-actions'

export const metadata = { title: 'Comprobante' }

/** Los que se leen como «Sin cobrar · Cobrada» en vez de «Impaga · Pagada». */
const RECEIVABLE_KINDS = new Set(['sales_invoice', 'sales_debit_note', 'sales_close'])

function linkText(doc: DocumentLink): string {
  return `${doc.title} #${doc.seq}`
}

function periodText(period: DocumentDetail['period']): string | null {
  if (!period) return null
  const year = period.month.slice(0, 4)
  const label =
    period.kind === 'fy_adjustments'
      ? `Ajustes de cierre ${year}`
      : period.kind === 'fy_opening'
        ? `Apertura ${year}`
        : formatMonthLabel(period.month)
  return `${label}: ${period.status === 'open' ? 'abierto' : 'cerrado'}`
}

export default async function ComprobantePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params
  const base = `/${tenantSlug}/administracion`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, `${base}/comprobantes/${id}`)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const result = await settleQuery(getDocument(tenantId, id))
  if (result.ok && !result.data) notFound()
  if (!result.ok || !result.data) {
    return (
      <PageShell width="comfortable">
        <BackLink href={`${base}/libros`}>Volver a Libros</BackLink>
        <QueryErrorBlock
          code={result.ok ? 'error' : result.code}
          message={result.ok ? 'No pudimos cargar el comprobante.' : result.message}
        />
      </PageShell>
    )
  }

  const doc = result.data
  const actions = documentActions(doc, canWrite)
  const [settings, firstOpenDate] = actions.reverse
    ? await Promise.all([settleQuery(getAccountingSettings(tenantId)), loadFirstOpenDate(tenantId)])
    : [null, null]

  const back = backLinkFor(doc.kind, base, doc.accountingDate)
  const appliedCents = appliedByOthers(doc.kind)
    ? doc.allocations.reduce((sum, a) => (a.voidedOn ? sum : sum + a.amountCents), 0)
    : null
  const siblings = doc.bundleSiblings.filter((s) => s.status === 'posted').map(linkText)
  const openLine = doc.entry?.lines.find((l) => l.partyId && (l.openCents ?? 0) > 0) ?? null
  const statusLabels = RECEIVABLE_KINDS.has(doc.kind)
    ? COLLECTION_STATUS_LABELS
    : PAYMENT_STATUS_LABELS
  const kindLabel = documentKindLabel(doc.kind)
  const reversed = doc.reversedBy?.status === 'posted' ? doc.reversedBy : null

  return (
    <PageShell width="comfortable">
      <BackLink href={back.href}>{back.label}</BackLink>

      {/* Cabecera, como la ficha de un cliente. */}
      <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl"
        />
        {/* En el celular, el importe y los botones van debajo (al lado se pisaban con el título). */}
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {kindLabel} · #{doc.seq}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight">{doc.title}</h1>
              {doc.status === 'voided' ? (
                <Badge
                  variant="outline"
                  className="border-destructive/30 bg-destructive/10 text-destructive"
                >
                  Anulado
                </Badge>
              ) : reversed ? (
                <Badge
                  variant="outline"
                  className="border-destructive/30 bg-destructive/10 text-destructive"
                >
                  Anulado con fecha posterior
                </Badge>
              ) : (
                <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                  Vigente
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {doc.partyName ? (
                <span className="font-medium text-foreground">{doc.partyName}</span>
              ) : null}
              {doc.partyDocNumber && doc.partyDocNumber !== '0' ? (
                <span className="tabular-nums">
                  {doc.partyDocNumber.length === 11
                    ? `CUIT ${formatCuit(doc.partyDocNumber)}`
                    : `Doc. ${doc.partyDocNumber}`}
                </span>
              ) : null}
              <span className="tabular-nums">{formatIsoDay(doc.accountingDate)}</span>
              {periodText(doc.period) ? (
                <span className="inline-flex items-center gap-1">
                  {doc.period?.status === 'closed' ? <Lock className="size-3" aria-hidden /> : null}
                  {periodText(doc.period)}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Lo cargó {doc.createdByName || 'alguien del equipo'} el{' '}
              {formatDateTime(doc.createdAt)}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Amount
              cents={doc.totalCents}
              className="font-serif text-3xl font-semibold tracking-tight"
            />
            {doc.status === 'posted' && doc.paymentStatus !== 'none' && doc.openCents !== null ? (
              <p className="text-sm text-muted-foreground">
                {statusLabels[doc.paymentStatus]}
                {doc.openCents > 0 ? (
                  <>
                    {' · Pendiente '}
                    <Amount cents={doc.openCents} className="font-medium text-foreground" />
                  </>
                ) : null}
              </p>
            ) : null}
            {canWrite && (actions.settle || actions.void) ? (
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {actions.settle && openLine ? (
                  <ActionButton
                    action={actions.settle}
                    params={{ partida: openLine.id }}
                    className="h-11 md:h-9"
                  >
                    {actions.settle === 'pagar' ? 'Pagar' : 'Registrar un cobro'}
                  </ActionButton>
                ) : null}
                {actions.void ? (
                  <VoidDocumentButton
                    tenantSlug={tenantSlug}
                    documentId={doc.id}
                    title={doc.title}
                    siblings={siblings}
                    appliedCents={appliedCents}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <Facts doc={doc} today={today} />
      </div>

      <StatusNotes doc={doc} base={base} />

      {actions.reverse || actions.creditNote || actions.adjustment ? (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-pretty">
              <span className="font-medium">
                {doc.period ? formatMonthLabel(doc.period.month) : 'Ese mes'} está cerrado.
              </span>{' '}
              <span className="text-muted-foreground">
                No se puede cambiar: para corregirlo, cargá una nota de crédito, anulalo con fecha
                de hoy si fue un error de carga, o armá un asiento de ajuste.
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {actions.creditNote ? (
                <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
                  <Link href={creditNoteHref(actions.creditNote, base, doc)}>
                    <FileText className="size-4" aria-hidden />
                    Cargar una nota de crédito
                  </Link>
                </Button>
              ) : null}
              {actions.reverse ? (
                <ReverseDocumentButton
                  tenantSlug={tenantSlug}
                  documentId={doc.id}
                  title={doc.title}
                  documentMonth={doc.accountingDate}
                  today={today}
                  minDate={maxIsoDay(firstOpenDate ?? today, doc.accountingDate)}
                  ivaMode={
                    settings?.ok && settings.data ? settings.data.closedPeriodVoidIvaMode : null
                  }
                  hasFiscal={doc.fiscalVouchers.some((v) => !v.voided)}
                  appliedCents={appliedCents}
                />
              ) : null}
              {actions.adjustment ? (
                <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
                  <Link href={`${base}/libros/asiento-manual?corrige=${doc.id}`}>
                    <FilePenLine className="size-4" aria-hidden />
                    Armar asiento de ajuste
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Lines doc={doc} />
        <div className="space-y-6">
          {doc.fiscalVouchers.length > 0 ? <FiscalVouchers doc={doc} /> : null}
          <Allocations doc={doc} base={base} statusLabels={statusLabels} />
        </div>
      </div>

      <EntrySection doc={doc} base={base} />

      <HistorySection doc={doc} base={base} />
    </PageShell>
  )
}

function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('card-hairline rounded-xl border bg-card', className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="space-y-0.5">
          <h2 className="font-serif text-lg font-semibold tracking-tight">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function Facts({ doc, today }: { doc: DocumentDetail; today: string }) {
  const facts: ReactNode[] = []
  facts.push(
    <Fact key="issue" label="Fecha del comprobante">
      <span className="tabular-nums">{formatIsoDay(doc.issueDate)}</span>
    </Fact>,
  )
  if (doc.accountingDate !== doc.issueDate) {
    facts.push(
      <Fact key="acc" label="Fecha contable">
        <span className="tabular-nums">{formatIsoDay(doc.accountingDate)}</span>
      </Fact>,
    )
  }
  if (doc.dueDate) {
    facts.push(
      <Fact key="due" label="Vence">
        {doc.status === 'posted' && doc.openCents !== null ? (
          <DueStatus
            dueDate={doc.dueDate}
            today={today}
            settled={doc.openCents === 0}
            group={RECEIVABLE_KINDS.has(doc.kind) ? 'receivables' : 'payables'}
            showDate
            className="text-sm"
          />
        ) : (
          <span className="tabular-nums">{formatIsoDay(doc.dueDate)}</span>
        )}
      </Fact>,
    )
  }
  if (doc.shift) {
    facts.push(
      <Fact key="shift" label="Turno">
        {doc.shift}
      </Fact>,
    )
  }
  if (doc.countedCents !== null) {
    facts.push(
      <Fact key="counted" label="Contado">
        <Amount cents={doc.countedCents} />
      </Fact>,
    )
  }
  if (doc.expectedBookCents !== null) {
    facts.push(
      <Fact key="book" label="Según los libros">
        <Amount cents={doc.expectedBookCents} />
      </Fact>,
    )
  }
  return (
    <dl className="relative mt-5 grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-2 lg:grid-cols-4">
      {facts}
    </dl>
  )
}

/** Avisos de estado: anulado (con motivo), reemplazado, anulado con fecha posterior. */
function StatusNotes({ doc, base }: { doc: DocumentDetail; base: string }) {
  const notes: ReactNode[] = []
  if (doc.status === 'voided') {
    notes.push(
      <div
        key="voided"
        className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="space-y-1 text-pretty">
          <p className="font-medium">
            Anulado
            {doc.voidedAt ? ` el ${formatDateTime(doc.voidedAt)}` : ''}
            {doc.voidedByName ? ` por ${doc.voidedByName}` : ''}.
          </p>
          {doc.voidReason ? <p>Motivo: {doc.voidReason}</p> : null}
          {doc.replacedBy ? (
            <p>
              Lo reemplazó{' '}
              <Link
                href={`${base}/comprobantes/${doc.replacedBy.id}`}
                className="font-medium underline underline-offset-4"
              >
                {linkText(doc.replacedBy)}
              </Link>
              .
            </p>
          ) : null}
        </div>
      </div>,
    )
  }
  const reversed = doc.reversedBy?.status === 'posted' ? doc.reversedBy : null
  if (reversed) {
    notes.push(
      <div
        key="reversed"
        className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
      >
        <Repeat className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p className="text-pretty text-warning-text">
          Se anuló con fecha posterior:{' '}
          <Link
            href={`${base}/comprobantes/${reversed.id}`}
            className="font-medium underline underline-offset-4"
          >
            {linkText(reversed)}
          </Link>{' '}
          del {formatIsoDay(reversed.accountingDate)}. Este comprobante queda en su mes, que está
          cerrado.
        </p>
      </div>,
    )
  }
  if (doc.notes) {
    notes.push(
      <div
        key="notes"
        className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <p className="text-pretty">{doc.notes}</p>
      </div>,
    )
  }
  return notes.length > 0 ? notes : null
}

function Lines({ doc }: { doc: DocumentDetail }) {
  return (
    <Card title="Detalle" description="Cada renglón del comprobante, en palabras.">
      {doc.lines.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Sin renglones.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {doc.lines.map((line) => {
            const extra = [
              line.partyName,
              line.treasuryName,
              line.salesMethodName,
              line.certificateNumber ? `Certificado ${line.certificateNumber}` : null,
              line.reference,
              line.memo,
            ].filter((v): v is string => Boolean(v))
            return (
              <li key={line.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{line.roleLabel}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono text-[11px]">{line.accountCode}</span>{' '}
                    {line.accountName}
                  </p>
                  {extra.length > 0 ? (
                    <p className="text-xs text-muted-foreground">{extra.join(' · ')}</p>
                  ) : null}
                </div>
                <Amount cents={line.amountCents} className="shrink-0 text-sm font-medium" />
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function FiscalVouchers({ doc }: { doc: DocumentDetail }) {
  return (
    <Card title="Comprobante fiscal" description="Lo que va al Libro IVA.">
      <ul className="divide-y divide-border/60">
        {doc.fiscalVouchers.map((v) => {
          const s = ivaSummary(v.amounts)
          const number =
            v.numberTo !== null && v.numberTo !== v.numberFrom
              ? formatVoucherRange(v.pointOfSale, v.numberFrom, v.numberTo)
              : formatVoucherNumber(v.pointOfSale, v.numberFrom)
          return (
            <li key={v.id} className={cn('space-y-2 px-5 py-3', v.voided && 'opacity-70')}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {v.book === 'purchases' ? 'Libro IVA compras' : 'Libro IVA ventas'}
                  {v.isReversal ? ' · anulación' : ''}
                </p>
                {v.voided ? <Badge variant="muted">Anulado</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{number}</span> · {formatIsoDay(v.voucherDate)} ·{' '}
                {v.counterpartyName || 'Consumidor final'}
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Neto gravado</dt>
                <dd className="text-right">
                  <Amount cents={s.netCents} />
                </dd>
                <dt className="text-muted-foreground">IVA</dt>
                <dd className="text-right">
                  <Amount cents={s.vatCents} />
                </dd>
                {s.perceptionsCents !== 0 ? (
                  <>
                    <dt className="text-muted-foreground">Percepciones</dt>
                    <dd className="text-right">
                      <Amount cents={s.perceptionsCents} />
                    </dd>
                  </>
                ) : null}
                {s.otherCents !== 0 ? (
                  <>
                    <dt className="text-muted-foreground">No gravado, exento y otros</dt>
                    <dd className="text-right">
                      <Amount cents={s.otherCents} />
                    </dd>
                  </>
                ) : null}
                <dt className="font-medium">Total</dt>
                <dd className="text-right font-medium">
                  <Amount cents={s.totalCents} />
                </dd>
              </dl>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function Allocations({
  doc,
  base,
  statusLabels,
}: {
  doc: DocumentDetail
  base: string
  statusLabels: Readonly<Record<DocumentDetail['paymentStatus'], string>>
}) {
  if (doc.allocations.length === 0 && doc.openCents === null) return null
  return (
    <Card
      title="Pagos y cobros aplicados"
      description={
        doc.status === 'posted' && doc.openCents === 0 && doc.paymentStatus !== 'none'
          ? statusLabels[doc.paymentStatus]
          : undefined
      }
      actions={
        doc.status === 'posted' && doc.openCents !== null && doc.openCents > 0 ? (
          <span className="text-sm text-muted-foreground">
            Pendiente <Amount cents={doc.openCents} className="font-medium text-foreground" />
          </span>
        ) : null
      }
    >
      {doc.allocations.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Todavía no tiene nada aplicado.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {doc.allocations.map((a) => (
            <li
              key={a.id}
              className={cn(
                'flex items-start justify-between gap-4 px-5 py-3',
                a.voidedOn && 'text-muted-foreground',
              )}
            >
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className={cn(a.voidedOn && 'line-through')}>
                  {a.otherDocumentId && a.otherDocumentTitle ? (
                    <Link
                      href={`${base}/comprobantes/${a.otherDocumentId}`}
                      className="font-medium underline-offset-4 hover:text-primary hover:underline"
                    >
                      {a.otherDocumentTitle}
                      {a.otherDocumentSeq ? ` #${a.otherDocumentSeq}` : ''}
                    </Link>
                  ) : (
                    <span className="font-medium">Imputación manual</span>
                  )}
                  <span className="text-muted-foreground"> · el {formatIsoDay(a.appliedOn)}</span>
                </p>
                {a.voidedOn ? (
                  <p className="text-xs">
                    Desaplicada el {formatIsoDay(a.voidedOn)}: quedó a cuenta.
                  </p>
                ) : null}
              </div>
              <Amount
                cents={a.amountCents}
                className={cn('shrink-0 text-sm font-medium', a.voidedOn && 'line-through')}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function EntrySection({ doc, base }: { doc: DocumentDetail; base: string }) {
  const entry = doc.entry
  if (!entry) return null
  const data: EntryPreviewData = {
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
  // El mismo número que el diario y la página del asiento (provisorio mientras el mes está abierto).
  const number =
    entry.number !== null
      ? `Asiento N° ${entry.number}`
      : entry.status === 'voided'
        ? 'Asiento anulado'
        : entry.provisionalNumber !== null
          ? `Asiento N° ${entry.provisionalNumber}, provisorio: queda fijo al cerrar el mes`
          : 'Asiento sin número todavía: se numera al cerrar el mes'
  return (
    <section aria-labelledby="asiento-titulo" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 id="asiento-titulo" className="font-serif text-lg font-semibold tracking-tight">
            Asiento contable
          </h2>
          <p className="text-xs text-muted-foreground">
            {number} · {entryKindLabel(entry.kind)} · {formatIsoDay(entry.entryDate)}
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
          <Link href={`${base}/asientos/${entry.id}`}>Ver asiento</Link>
        </Button>
      </div>
      <EntryPreview entries={[data]} alwaysOpen />
    </section>
  )
}

function HistorySection({ doc, base }: { doc: DocumentDetail; base: string }) {
  const items: Array<{ key: string; content: ReactNode }> = [
    {
      key: 'created',
      content: (
        <>
          Lo cargó {doc.createdByName || 'alguien del equipo'} el {formatDateTime(doc.createdAt)}.
        </>
      ),
    },
  ]
  const link = (d: DocumentLink) => (
    <Link
      href={`${base}/comprobantes/${d.id}`}
      className="font-medium underline-offset-4 hover:text-primary hover:underline"
    >
      {linkText(d)}
    </Link>
  )
  if (doc.replaces) items.push({ key: 'replaces', content: <>Reemplaza a {link(doc.replaces)}.</> })
  if (doc.replacedBy)
    items.push({ key: 'replacedBy', content: <>Lo reemplazó {link(doc.replacedBy)}.</> })
  if (doc.reverses) items.push({ key: 'reverses', content: <>Anula a {link(doc.reverses)}.</> })
  if (doc.reversedBy)
    items.push({
      key: 'reversedBy',
      content: (
        <>
          Lo anuló {link(doc.reversedBy)} el {formatIsoDay(doc.reversedBy.accountingDate)}
          {doc.reversedBy.status === 'voided' ? ' (esa anulación después se anuló)' : ''}.
        </>
      ),
    })
  if (doc.corrects) items.push({ key: 'corrects', content: <>Corrige a {link(doc.corrects)}.</> })
  if (doc.related) items.push({ key: 'related', content: <>Corresponde a {link(doc.related)}.</> })
  if (doc.bundleSiblings.length > 0) {
    items.push({
      key: 'bundle',
      content: (
        <>
          Se guardó junto con{' '}
          {doc.bundleSiblings.map((s, i) => (
            <span key={s.id}>
              {i > 0 ? ', ' : ''}
              {link(s)}
              {s.status === 'voided' ? ' (anulado)' : ''}
            </span>
          ))}
          .
        </>
      ),
    })
  }
  if (doc.recurringExpenseId) {
    items.push({
      key: 'recurring',
      content: (
        <>
          Es de un{' '}
          <Link
            href={`${base}/compras/gastos-fijos/${doc.recurringExpenseId}`}
            className="font-medium underline-offset-4 hover:text-primary hover:underline"
          >
            gasto fijo
          </Link>
          .
        </>
      ),
    })
  }
  if (doc.overrideReason) {
    items.push({
      key: 'override',
      content: <>Se guardó con un aviso aceptado: {doc.overrideReason}</>,
    })
  }
  if (doc.status === 'voided') {
    items.push({
      key: 'voided',
      content: (
        <>
          Lo anuló {doc.voidedByName ?? 'alguien del equipo'}
          {doc.voidedAt ? ` el ${formatDateTime(doc.voidedAt)}` : ''}
          {doc.voidReason ? `: «${doc.voidReason}»` : ''}.
        </>
      ),
    })
  }

  return (
    <Card title="Historia">
      <ul className="space-y-2.5 px-5 py-4 text-sm">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
            />
            <span className="text-pretty">{item.content}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
