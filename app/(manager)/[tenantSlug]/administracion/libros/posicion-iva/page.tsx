import { CalendarRange, CircleAlert, CircleCheck, Info, Percent, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Amount } from '@/components/administracion/amount'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import {
  exportHref,
  getDocument,
  getIvaPosition,
  type IvaPosition,
  settleQuery,
  vatRateLabel,
} from '@/lib/accounting/queries'
import { formatDate, formatIsoDay, monthName, todayInCordoba } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { BookPage } from '../_components/book-page'
import { ExportButton } from '../_components/export-button'
import { MonthPicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { loadBookContext } from '../_lib/book-context'
import { ivaExpectedFrom, rateRows } from '../_lib/iva'
import { requireBooksAccess } from '../_lib/page-access'
import {
  bookHref,
  monthAvailability,
  monthAvailabilityMessage,
  resolveBookMonth,
} from '../_lib/periods'
import { RegisterSettlementButton } from './_components/register-settlement'

export const metadata = { title: 'Posición de IVA' }

export default async function PosicionIvaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const path = `${base}/libros/posicion-iva`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, path)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const resolved = resolveBookMonth(sp, today)
  const month = resolved.ok ? resolved : resolveBookMonth({}, today)
  if (!month.ok) throw new Error('período por defecto inválido')
  const ctx = await loadBookContext(tenantId, today)
  const availability = monthAvailability(month.month, today, ctx.settings?.booksStartDate)
  const position =
    resolved.ok && availability === 'ok'
      ? await settleQuery(getIvaPosition(tenantId, month.month))
      : null
  const p = position?.ok ? position.data : null

  // «Pagar a ARCA» (dueño): la partida abierta de la liquidación del mes cerrado.
  const settlement =
    canWrite && p?.status === 'closed' && p.settlementDocumentId
      ? await settleQuery(getDocument(tenantId, p.settlementDocumentId))
      : null
  const payLine =
    settlement?.ok && settlement.data?.status === 'posted'
      ? (settlement.data.entry?.lines.find((l) => l.partyId && (l.openCents ?? 0) > 0) ?? null)
      : null

  const hasCuit = Boolean(ctx.settings?.cuit)
  const monthNoun = monthName(Number(month.month.slice(5, 7)))

  return (
    <BookPage
      backHref={bookHref(`${base}/libros`, { mes: month.month })}
      title="Posición de IVA"
      width="comfortable"
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>{month.label} · Estimado: la declaración jurada la presenta la contadora.</span>
          {p ? (
            <Badge
              variant="outline"
              className={cn(
                'font-normal',
                p.status === 'open'
                  ? 'border-warning/40 bg-warning/10 text-warning-text'
                  : 'border-success/30 bg-success/10 text-success',
              )}
            >
              {p.status === 'open'
                ? 'Mes abierto: puede cambiar'
                : `Cerrado${p.closedAt ? ` el ${formatDate(p.closedAt)}` : ''}`}
            </Badge>
          ) : null}
        </span>
      }
      actions={
        hasCuit && availability === 'ok' ? (
          <ExportButton
            href={exportHref(tenantSlug, 'posicion-iva', { mes: month.month })}
            fileName={`administracion-${tenantSlug}-posicion-iva-${month.month}.csv`}
          />
        ) : null
      }
      toolbar={<MonthPicker month={month.month} today={today} minMonth={ctx.minMonth} />}
    >
      {!resolved.ok ? <PeriodError message={resolved.message} /> : null}
      {availability !== 'ok' ? (
        <EmptyState
          icon={CalendarRange}
          title={monthAvailabilityMessage(availability, month.month, ctx.settings?.booksStartDate)}
          description="Elegí otro mes con las flechas de arriba."
        />
      ) : null}
      {position && !position.ok ? (
        <QueryErrorBlock code={position.code} message={position.message} />
      ) : null}

      {p && !p.applies ? (
        <EmptyState
          icon={Percent}
          title="La SAS no liquida IVA"
          description="Según los datos de la SAS no es responsable inscripta: no hay posición de IVA para calcular. Si cambió, avisale a la contadora."
        />
      ) : null}

      {p?.applies ? (
        <>
          <Cascade position={p} monthNoun={monthNoun} />

          <SettlementBlock
            position={p}
            base={base}
            tenantSlug={tenantSlug}
            canWrite={canWrite}
            monthNoun={monthNoun}
            payLineId={payLine?.id ?? null}
          />

          {p.pendingDocumentationCents > 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <div className="space-y-1 text-pretty">
                <p className="font-medium">
                  IVA de comisiones a documentar: <Amount cents={p.pendingDocumentationCents} />
                </p>
                <p className="text-muted-foreground">
                  Lo descontaron en las acreditaciones, pero falta la factura de la plataforma o de
                  la tarjeta. Se computa cuando se carga esa factura.
                </p>
              </div>
            </div>
          ) : null}

          <Reconciliation position={p} base={base} />
        </>
      ) : null}
    </BookPage>
  )
}

type CascadeRow = {
  key: string
  op?: '−' | '='
  label: string
  /** Para lectores: «menos», «da». */
  opText?: string
  cents: number
  sub?: boolean
  strong?: boolean
}

function Cascade({ position: p, monthNoun }: { position: IvaPosition; monthNoun: string }) {
  const tech = p.technicalBalanceCents
  const rows: CascadeRow[] = [
    { key: 'df', label: 'Débito fiscal', cents: p.debitFiscal.totalCents, strong: true },
    ...rateRows(p.debitFiscal.byRate).map((r) => ({
      key: `df-${r.bp}`,
      label: `IVA ${vatRateLabel(r.bp)}`,
      cents: r.cents,
      sub: true,
    })),
    {
      key: 'cf',
      op: '−',
      opText: 'menos',
      label: 'Crédito fiscal',
      cents: p.creditFiscal.totalCents,
      strong: true,
    },
    ...rateRows(p.creditFiscal.byRate).map((r) => ({
      key: `cf-${r.bp}`,
      label: `IVA ${vatRateLabel(r.bp)}`,
      cents: r.cents,
      sub: true,
    })),
  ]
  if (p.technicalBalancePrevCents !== 0) {
    rows.push({
      key: 'st0',
      op: '−',
      opText: 'menos',
      label: 'Saldo técnico a favor del mes anterior',
      cents: p.technicalBalancePrevCents,
    })
  }
  rows.push({
    key: 'tech',
    op: '=',
    opText: 'da',
    label: tech < 0 ? 'Saldo técnico a favor' : 'Saldo técnico',
    cents: Math.abs(tech),
    strong: true,
  })
  if (p.perceptionsCents !== 0) {
    rows.push({
      key: 'perc',
      op: '−',
      opText: 'menos',
      label: 'Percepciones de IVA',
      cents: p.perceptionsCents,
    })
  }
  if (p.withholdingsCents !== 0) {
    rows.push({
      key: 'ret',
      op: '−',
      opText: 'menos',
      label: 'Retenciones de IVA',
      cents: p.withholdingsCents,
    })
  }
  if (p.freeBalancePrevCents !== 0) {
    rows.push({
      key: 'ld0',
      op: '−',
      opText: 'menos',
      label: 'Libre disponibilidad del mes anterior',
      cents: p.freeBalancePrevCents,
    })
  }

  let result: ReactNode
  if (p.toPayCents > 0) {
    result = (
      <ResultRow label="A pagar" cents={p.toPayCents} hint="A ARCA, con la declaración jurada." />
    )
  } else if (p.inFavorCents > 0) {
    const parts = [
      p.technicalBalanceNewCents > 0
        ? `saldo técnico ${formatCents(p.technicalBalanceNewCents)}`
        : null,
      p.freeBalanceNewCents > 0
        ? `libre disponibilidad ${formatCents(p.freeBalanceNewCents)}`
        : null,
    ].filter(Boolean)
    result = (
      <ResultRow
        label="A favor"
        cents={p.inFavorCents}
        hint={parts.length > 0 ? `Queda para el mes siguiente: ${parts.join(' · ')}.` : undefined}
      />
    )
  } else {
    result = (
      <tr>
        <td colSpan={3} className="px-5 py-4 text-sm font-medium">
          Sin IVA para pagar ni a favor.
        </td>
      </tr>
    )
  }

  return (
    <section aria-labelledby="posicion-titulo" className="card-hairline rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <h2 id="posicion-titulo" className="font-serif text-lg font-semibold tracking-tight">
            Cómo da {monthNoun}
          </h2>
          <p className="text-xs text-muted-foreground">
            Primero el saldo técnico, después los pagos a cuenta y la libre disponibilidad (art.
            24).
          </p>
        </div>
      </header>
      <table className="w-full text-sm">
        <caption className="sr-only">Posición de IVA de {monthNoun}</caption>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={cn(row.strong && 'border-t border-border/60 first:border-t-0')}
            >
              <td
                aria-hidden
                className="w-8 py-2 pl-5 text-center text-muted-foreground tabular-nums"
              >
                {row.op ?? ''}
              </td>
              <td
                className={cn('py-2 pr-3', row.sub ? 'pl-4 text-muted-foreground' : 'font-medium')}
              >
                {row.opText ? <span className="sr-only">{row.opText} </span> : null}
                {row.label}
              </td>
              <td
                className={cn(
                  'py-2 pr-5 text-right',
                  row.sub ? 'text-muted-foreground' : 'font-medium',
                )}
              >
                <Amount cents={row.cents} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-[3px] border-double border-border">{result}</tfoot>
      </table>
    </section>
  )
}

function ResultRow({ label, cents, hint }: { label: string; cents: number; hint?: string }) {
  return (
    <tr>
      <td aria-hidden className="w-8 py-4 pl-5 text-center text-muted-foreground">
        =
      </td>
      <td className="py-4 pr-3">
        <span className="block font-serif text-xl font-semibold tracking-tight">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </td>
      <td className="py-4 pr-5 text-right align-top">
        <Amount cents={cents} className="font-serif text-2xl font-semibold tracking-tight" />
      </td>
    </tr>
  )
}

function SettlementBlock({
  position: p,
  base,
  tenantSlug,
  canWrite,
  monthNoun,
  payLineId,
}: {
  position: IvaPosition
  base: string
  tenantSlug: string
  canWrite: boolean
  monthNoun: string
  payLineId: string | null
}) {
  const docLink = p.settlementDocumentId ? (
    <Button asChild variant="outline" className="h-11 md:h-9">
      <Link href={`${base}/comprobantes/${p.settlementDocumentId}`}>Ver la liquidación</Link>
    </Button>
  ) : null

  let text: string
  let actions: ReactNode = null
  // Se registró una liquidación y después se cargó algo del mes: hay que
  // registrarla de nuevo (la base anula la vieja; si ahora da cero, solo la anula).
  const stale = Boolean(p.settlementDocumentId) && p.settlementUpToDate === false
  if (p.status === 'closed') {
    text = p.settlementDocumentId
      ? `La liquidación de ${monthNoun} quedó registrada al cerrar el mes.`
      : `${capitalize(monthNoun)} está cerrado y no tuvo liquidación de IVA (dio cero o se cerró sin liquidar).`
    actions = (
      <>
        {docLink}
        {payLineId ? (
          <ActionButton action="pagar" params={{ partida: payLineId }} className="h-11 md:h-9">
            Pagar a ARCA
          </ActionButton>
        ) : null}
      </>
    )
  } else if (p.isZero && !stale) {
    text = `Por ahora ${monthNoun} no tiene IVA para liquidar.`
  } else if (p.mode === 'manual') {
    if (p.settlementDocumentId && !stale) {
      text = 'La liquidación del mes ya está registrada.'
      actions = docLink
    } else {
      text = !stale
        ? 'La liquidación del IVA se registra a mano: cuando el mes esté completo, registrala.'
        : p.isZero
          ? 'La liquidación registrada quedó vieja y ahora el mes da cero: anulala antes de cerrar.'
          : 'La liquidación registrada quedó vieja: después se cargó algo del mes.'
      actions = (
        <>
          {docLink}
          {canWrite ? (
            <RegisterSettlementButton
              tenantSlug={tenantSlug}
              month={p.month}
              monthLabel={monthNoun}
              expected={ivaExpectedFrom(p)}
              again={stale}
              zero={p.isZero}
              resultText={
                p.isZero
                  ? `Se anula la liquidación anterior: el IVA de ${monthNoun} ahora da cero.`
                  : p.toPayCents > 0
                    ? `Queda el asiento con IVA a pagar de ${formatCents(p.toPayCents)} a ARCA, con fecha del último día del mes.`
                    : p.inFavorCents > 0
                      ? `Queda el asiento con ${formatCents(p.inFavorCents)} a favor para el mes siguiente.`
                      : 'Queda el asiento de la liquidación, sin IVA a pagar.'
              }
            />
          ) : null}
        </>
      )
    }
  } else {
    text = 'La liquidación del IVA se registra sola al cerrar el mes.'
    actions = canWrite ? (
      <Button asChild variant="outline" className="h-11 md:h-9">
        <Link href={`${base}/libros/cierres`}>Ir a Cierres de mes</Link>
      </Button>
    ) : (
      docLink
    )
  }

  return (
    <div className="card-hairline flex flex-col gap-3 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium">Liquidación del IVA</p>
        <p className="text-sm text-muted-foreground text-pretty">{text}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

function Reconciliation({ position: p, base }: { position: IvaPosition; base: string }) {
  const r = p.reconciliation
  const rows = [
    {
      key: 'cf',
      label: 'Crédito fiscal',
      book: r.purchasesBookVatComputableCents,
      bookLabel: 'Libro IVA compras (computable)',
      journal: r.journalVatCreditCents,
    },
    {
      key: 'df',
      label: 'Débito fiscal',
      book: r.salesBookVatCents,
      bookLabel: 'Libro IVA ventas',
      journal: r.journalVatDebitCents,
    },
  ]
  return (
    <section
      aria-labelledby="conciliacion-titulo"
      className="card-hairline rounded-xl border bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <h2 id="conciliacion-titulo" className="font-serif text-lg font-semibold tracking-tight">
            Conciliación con los libros
          </h2>
          <p className="text-xs text-muted-foreground">
            Lo que dicen los libros IVA contra lo que quedó en el mayor.
          </p>
        </div>
        {r.matches ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
            <CircleCheck className="size-3.5" aria-hidden />
            Coinciden
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning-text">
            <TriangleAlert className="size-3.5" aria-hidden />
            Hay diferencias
          </span>
        )}
      </header>
      <div className="divide-y divide-border/60">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-3 sm:items-center"
          >
            <span className="font-medium">{row.label}</span>
            <span className="flex justify-between gap-2 sm:block sm:text-right">
              <span className="text-xs text-muted-foreground sm:block">{row.bookLabel}</span>
              <Amount cents={row.book} />
            </span>
            <span className="flex justify-between gap-2 sm:block sm:text-right">
              <span className="text-xs text-muted-foreground sm:block">Mayor</span>
              <Amount cents={row.journal} />
            </span>
          </div>
        ))}
      </div>
      {r.differences.length > 0 ? (
        <div className="border-t border-border/60 px-5 py-4">
          <p className="mb-2 text-sm font-medium">Asientos que movieron IVA sin comprobante</p>
          <ul className="divide-y divide-border/60 text-sm">
            {r.differences.map((d, i) => (
              <li
                key={`${d.entryId ?? d.documentId ?? 'dif'}-${i.toString()}`}
                className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0">
                  {d.entryId ? (
                    <Link
                      href={`${base}/asientos/${d.entryId}`}
                      className="font-medium underline-offset-4 hover:text-primary hover:underline"
                    >
                      {d.label || 'Asiento'}
                    </Link>
                  ) : (
                    <span className="font-medium">{d.label || 'Asiento'}</span>
                  )}
                  {d.entryDate ? (
                    <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                      {formatIsoDay(d.entryDate)}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 gap-4 text-xs text-muted-foreground">
                  {d.vatCreditCents !== 0 ? (
                    <span>
                      Crédito <Amount cents={d.vatCreditCents} className="text-foreground" />
                    </span>
                  ) : null}
                  {d.vatDebitCents !== 0 ? (
                    <span>
                      Débito <Amount cents={d.vatDebitCents} className="text-foreground" />
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {r.differencesCount > r.differences.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Y {r.differencesCount - r.differences.length} asientos más: están en el libro diario.
            </p>
          ) : null}
        </div>
      ) : null}
      {!r.fullyExplained ? (
        <div className="border-t border-border/60 p-4">
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-pretty">
              Hay una diferencia que no explica ningún asiento (
              {formatCents(r.unexplainedVatCreditCents)} de crédito y{' '}
              {formatCents(r.unexplainedVatDebitCents)} de débito): avisanos.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}
