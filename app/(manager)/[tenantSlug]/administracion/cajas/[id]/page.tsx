import { ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, Scale, Wallet } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BlockError, PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { RangeFilter } from '@/components/administracion/cajas-ventas/period-filters'
import {
  firstParam,
  hrefWith,
  periodParams,
  resolveRange,
} from '@/components/administracion/cajas-ventas/periods'
import {
  CheckedStatus,
  cardBalanceText,
  TreasuryIcon,
} from '@/components/administracion/cajas-ventas/treasury-display'
import { balanceText } from '@/components/administracion/format'
import { ActionButton } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { type StatementRow, StatementTable } from '@/components/administracion/statement-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/ui/stat-card'
import { exportHref, TREASURY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { getTreasuryAccount, getTreasuryMovements } from '@/lib/accounting/queries/treasury'
import { formatIsoDay, todayInCordoba } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

export const metadata = { title: 'Movimientos de una caja' }

/**
 * El detalle sin repetir el comprobante: con «Gasto», la descripción
 * «Gasto · Hielo» queda en «Hielo» (y si es igual al comprobante, no va).
 */
function detailText(description: string | null, label: string): string | null {
  if (!description || description === label) return null
  const prefix = `${label} · `
  return description.startsWith(prefix) ? description.slice(prefix.length) || null : description
}

export default async function CajaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug, id } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const { access } = await requireAdminPage(tenantSlug, `${base}/cajas/${id}`)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const treasury = await getTreasuryAccount(tenantId, id)
  if (!treasury) notFound()

  const range = resolveRange(sp, today)
  const after = firstParam(sp.despues)
  const page = range.ok
    ? await settleQuery(
        getTreasuryMovements(tenantId, {
          treasuryId: treasury.id,
          from: range.from,
          to: range.to,
          after,
        }),
      )
    : null

  const isCard = treasury.kind === 'credit_card'
  // En la tarjeta de la empresa el saldo es una deuda: se lee como la de un proveedor.
  const sign = isCard ? -1 : 1
  const data = page?.ok ? page.data : null
  const rows: StatementRow[] = (data?.rows ?? [])
    .filter((r) => r.rowKind === 'line')
    .map((r, index) => {
      const label = r.documentLabel ?? r.description ?? 'Movimiento'
      const detail = [detailText(r.description, label), r.counterpart].filter(Boolean).join(' · ')
      return {
        id: `${r.entryId ?? 'linea'}-${index}`,
        date: r.entryDate ?? (range.ok ? range.from : today),
        voucher: label,
        href: r.documentId ? `${base}/comprobantes/${r.documentId}` : null,
        detail: detail || null,
        debitCents: r.inCents > 0 ? r.inCents : null,
        creditCents: r.outCents > 0 ? r.outCents : null,
        balanceCents: sign * r.balanceCents,
      }
    })
  const firstPage = after === null
  // El mes en curso termina después de hoy: si no hay nada cargado con fecha
  // posterior (las filas vienen en orden y esta es la última página), el saldo
  // del cierre es el de hoy. «Saldo al 31/10» un 7 de octubre parece una proyección.
  const lastDate = rows.at(-1)?.date ?? null
  const closingDay = !range.ok
    ? today
    : range.to > today &&
        range.from <= today &&
        data !== null &&
        !data.nextCursor &&
        (lastDate === null || lastDate <= today)
      ? today
      : range.to
  const detail = [treasury.bankName, treasury.alias ? `Alias ${treasury.alias}` : null]
    .filter(Boolean)
    .join(' · ')
  const fileName = range.ok
    ? `administracion-${tenantSlug}-${treasury.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${range.from}-${range.to}.csv`
    : 'administracion.csv'

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Link
        href={`${base}/cajas`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Volver a cajas y bancos
      </Link>

      <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-wrap items-start gap-4">
          <TreasuryIcon kind={treasury.kind} className="size-14 rounded-full [&_svg]:size-6" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                {treasury.name}
              </h1>
              <Badge variant="outline">{TREASURY_KIND_LABELS[treasury.kind] ?? 'Cuenta'}</Badge>
              {treasury.active ? null : <Badge variant="muted">Desactivada</Badge>}
              <ReadOnlyBadge className="ml-0" />
            </div>
            {detail ? <p className="mt-1 text-sm text-muted-foreground">{detail}</p> : null}
            <CheckedStatus lastCheckedOn={treasury.lastCheckedOn} today={today} className="mt-2" />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <ActionButton
              action="mover"
              params={{ caja: treasury.id }}
              size="sm"
              className="h-11 gap-2 md:h-8"
            >
              <ArrowLeftRight className="size-3.5" aria-hidden />
              Mover plata
            </ActionButton>
            <ActionButton
              action="ajustar"
              params={{ caja: treasury.id }}
              size="sm"
              variant="outline"
              className="h-11 gap-2 md:h-8"
            >
              <Scale className="size-3.5" aria-hidden />
              Ajustar saldo
            </ActionButton>
          </div>
        </div>
      </div>

      {data ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            icon={Wallet}
            label={range.ok && closingDay === today ? 'Saldo hoy' : 'Saldo al cierre'}
            value={
              isCard
                ? cardBalanceText(data.closingCents)
                : balanceText(data.closingCents, 'treasury', { decimals: 0 })
            }
            hint={range.ok ? `Al ${formatIsoDay(closingDay)}` : undefined}
          />
          <StatCard
            icon={ArrowDownLeft}
            iconClassName="text-success"
            label={isCard ? 'Pagos' : 'Entró'}
            value={formatCentsShort(data.inCents)}
            hint={range.ok ? range.label : undefined}
          />
          <StatCard
            icon={ArrowUpRight}
            iconClassName="text-destructive"
            label={isCard ? 'Consumos' : 'Salió'}
            value={formatCentsShort(data.outCents)}
            hint={range.ok ? range.label : undefined}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeFilter
          range={
            range.ok
              ? range
              : {
                  kind: 'month',
                  month: today.slice(0, 7),
                  from: today,
                  to: today,
                  label: '',
                }
          }
          today={today}
        />
        {range.ok ? (
          <ExportButton
            href={exportHref(tenantSlug, 'subdiario-disponibilidades', {
              caja: treasury.id,
              desde: range.from,
              hasta: range.to,
            })}
            fileName={fileName}
            className="h-11 md:h-9"
          />
        ) : null}
      </div>

      {!range.ok ? (
        <PeriodError message={range.message} />
      ) : !page?.ok || !data ? (
        <BlockError message={page && !page.ok ? page.message : ''} />
      ) : (
        <>
          <StatementTable
            rows={rows}
            caption={`Movimientos de ${treasury.name}, ${range.label}`}
            balanceMode={isCard ? 'payable' : 'treasury'}
            columnLabels={
              isCard ? { debit: 'Pagos', credit: 'Consumos' } : { debit: 'Entró', credit: 'Salió' }
            }
            opening={firstPage ? { balanceCents: sign * data.openingCents } : null}
            totals={
              firstPage && !data.nextCursor
                ? { debitCents: data.inCents, creditCents: data.outCents }
                : null
            }
            closing={
              !data.nextCursor
                ? {
                    label: `Saldo al ${formatIsoDay(closingDay)}`,
                    balanceCents: sign * data.closingCents,
                  }
                : null
            }
            emptyText="No hubo movimientos en este período."
            footnote={
              data.totalRows > rows.length
                ? `Mostrando ${rows.length} de ${data.totalRows} movimientos del período.`
                : undefined
            }
          />
          {data.nextCursor || !firstPage ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {!firstPage ? (
                <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
                  <Link href={hrefWith(`${base}/cajas/${treasury.id}`, periodParams(range))}>
                    Volver al principio
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              {data.nextCursor ? (
                <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
                  <Link
                    href={hrefWith(`${base}/cajas/${treasury.id}`, {
                      ...periodParams(range),
                      despues: data.nextCursor,
                    })}
                  >
                    Ver los siguientes
                  </Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
