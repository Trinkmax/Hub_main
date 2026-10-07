import { ListTree } from 'lucide-react'
import type { AccountOption } from '@/components/administracion/account-combobox'
import type { PartyOption } from '@/components/administracion/party-combobox'
import { type StatementRow, StatementTable } from '@/components/administracion/statement-table'
import { EmptyState } from '@/components/ui/empty-state'
import { loadPostingCatalog, type PostingCatalog } from '@/lib/accounting/context'
import {
  exportHref,
  getLedger,
  type LedgerPage,
  type LedgerRow,
  REPORT_PAGE_LIMIT,
  settleQuery,
} from '@/lib/accounting/queries'
import { decodePageToken } from '@/lib/accounting/queries/shared'
import { formatIsoDay, todayInCordoba } from '@/lib/dates'
import { BookPage } from '../_components/book-page'
import { ExportButton } from '../_components/export-button'
import { KeysetPagination } from '../_components/keyset-pagination'
import { RangePicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { loadBookContext } from '../_lib/book-context'
import { keysetPageInfo } from '../_lib/keyset'
import { requireBooksAccess } from '../_lib/page-access'
import { bookHref, firstParam, periodParams, resolveBookRange } from '../_lib/periods'
import { LedgerFilters } from './_components/ledger-filters'

export const metadata = { title: 'Mayor' }

/** Movimientos por página del mayor (la base acepta hasta 500). */
const PAGE_SIZE = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuidParam(value: string | string[] | undefined): string | null {
  const v = firstParam(value)
  return v && UUID_RE.test(v) ? v : null
}

/**
 * Las cuentas para el buscador del mayor: todas las activas (y la elegida) de
 * los 5 niveles del plan (o más, si el plan es más hondo), también los grupos,
 * que en el mayor suman sus cuentas («Mayor de Caja y bancos»). Por eso acá
 * todas se pueden elegir. Va la madre de cada una (`parentId`): con códigos
 * del estilo `1.1.01.01.001` la ruta no sale de cortar el código.
 */
function accountOptions(catalog: PostingCatalog, selected: string | null): AccountOption[] {
  return catalog.accounts
    .filter((a) => a.active || a.id === selected)
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      parentId: a.parentId,
      postable: true,
      active: true,
      description: a.postable ? a.description : 'Grupo: suma todas sus cuentas.',
    }))
}

function partyOptions(catalog: PostingCatalog): PartyOption[] {
  return catalog.parties.map((p) => ({
    id: p.id,
    name: p.name,
    tradeName: p.tradeName,
    taxId: p.taxId,
    active: p.active,
  }))
}

export default async function MayorPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const path = `${base}/libros/mayor`
  const { access } = await requireBooksAccess(tenantSlug, path)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const range = resolveBookRange(sp, today)
  const shown = range.ok ? range : resolveBookRange({}, today)
  if (!shown.ok) throw new Error('período por defecto inválido')
  const despues = firstParam(sp.despues)
  const accountId = uuidParam(sp.cuenta)
  const rawCuenta = firstParam(sp.cuenta)

  const [ctx, catalogResult] = await Promise.all([
    loadBookContext(tenantId, today),
    settleQuery(loadPostingCatalog(tenantId)),
  ])
  const catalog = catalogResult.ok ? catalogResult.data : null
  const selected = catalog?.accounts.find((a) => a.id === accountId) ?? null
  const showParty = Boolean(selected?.postable && selected.requiresParty)
  const partyId = showParty ? uuidParam(sp.participe) : null

  const ledger =
    range.ok && accountId
      ? await settleQuery(
          getLedger(tenantId, {
            accountId,
            partyId,
            from: range.from,
            to: range.to,
            after: despues,
            limit: Math.min(PAGE_SIZE, REPORT_PAGE_LIMIT),
          }),
        )
      : null

  const period = periodParams(shown)
  const filterParams = { cuenta: accountId, participe: partyId }
  const page = ledger?.ok ? ledger.data : null
  const account = page?.account ?? null
  const accountName = account ? `${account.code} ${account.name}` : null
  const partyName = partyId ? catalog?.parties.find((p) => p.id === partyId)?.name : null

  const exportOne = account
    ? exportHref(tenantSlug, 'mayor', {
        desde: shown.from,
        hasta: shown.to,
        cuenta: account.id,
        participe: partyId,
      })
    : null
  const exportAll = exportHref(tenantSlug, 'mayor-general', { desde: shown.from, hasta: shown.to })
  const suffix = `${shown.from}_${shown.to}`

  return (
    <BookPage
      backHref={bookHref(`${base}/libros`, shown.month ? { mes: shown.month } : {})}
      title="Mayor"
      description={
        accountName
          ? `${accountName}${partyName ? ` · ${partyName}` : ''} · ${shown.label}`
          : `Los movimientos de una cuenta, con su saldo · ${shown.label}`
      }
      actions={
        <>
          {exportOne && account ? (
            <ExportButton
              href={exportOne}
              fileName={`administracion-${tenantSlug}-mayor-${account.code}-${suffix}.csv`}
              label="Exportar esta cuenta"
            />
          ) : null}
          <ExportButton
            href={exportAll}
            fileName={`administracion-${tenantSlug}-mayor-general-${suffix}.csv`}
            label="Exportar mayor general"
          />
        </>
      }
      toolbar={
        <div className="space-y-3">
          <RangePicker
            range={shown}
            today={today}
            fiscalYear={ctx.fiscalYear}
            minMonth={ctx.minMonth}
          />
          {catalog ? (
            <LedgerFilters
              accounts={accountOptions(catalog, accountId)}
              parties={partyOptions(catalog)}
              accountId={accountId}
              partyId={partyId}
              showParty={showParty}
            />
          ) : null}
        </div>
      }
    >
      {!range.ok ? <PeriodError message={range.message} /> : null}
      {!catalogResult.ok ? (
        <QueryErrorBlock code={catalogResult.code} message={catalogResult.message} />
      ) : null}

      {!accountId ? (
        rawCuenta ? (
          <PeriodError
            message="Esa cuenta no existe en este bar."
            hint="Elegila de nuevo con el buscador de arriba."
          />
        ) : catalogResult.ok ? (
          <EmptyState
            icon={ListTree}
            title="Elegí una cuenta"
            description="El mayor muestra los movimientos de una cuenta con su saldo. Buscala por nombre o por código, con o sin puntos (por ejemplo, «1.1.01.01» o «110101» encuentran Caja y bancos). Si elegís un grupo, suma todas sus cuentas."
          />
        ) : null
      ) : null}

      {ledger && !ledger.ok ? (
        <QueryErrorBlock code={ledger.code} message={ledger.message} />
      ) : null}

      {page && !page.account ? (
        <PeriodError
          message="Esa cuenta no existe en este bar."
          hint="Elegila de nuevo con el buscador de arriba."
        />
      ) : null}

      {page?.account ? (
        <LedgerView
          page={page}
          base={base}
          path={path}
          caption={`Mayor de ${accountName ?? ''}, ${shown.label}`}
          linkParams={{ ...period, ...filterParams }}
          seenBefore={decodePageToken(despues)?.seen ?? 0}
          isGroup={!page.account.postable}
        />
      ) : null}
    </BookPage>
  )
}

function rowDetail(row: LedgerRow, isGroup: boolean): string | null {
  const parts = [
    isGroup && row.accountCode ? `${row.accountCode} ${row.accountName ?? ''}`.trim() : null,
    row.description,
    row.partyName,
    row.memo,
  ].filter((p): p is string => Boolean(p?.trim()))
  return parts.length > 0 ? parts.join(' · ') : null
}

function voucherOf(row: LedgerRow): string {
  const number =
    row.entryNumber === null
      ? null
      : `Asiento ${row.entryNumber}${row.numberIsProvisional ? ' (provisorio)' : ''}`
  const label = row.documentLabel ?? null
  if (label && number) return `${label} · ${number}`
  return label ?? number ?? 'Asiento'
}

function LedgerView({
  page,
  base,
  path,
  caption,
  linkParams,
  seenBefore,
  isGroup,
}: {
  page: LedgerPage
  base: string
  path: string
  caption: string
  linkParams: Record<string, string | null | undefined>
  seenBefore: number
  isGroup: boolean
}) {
  const openingRow = page.rows.find((r) => r.rowKind === 'opening') ?? null
  const lines = page.rows.filter((r) => r.rowKind === 'line')
  const info = keysetPageInfo({
    seenBefore,
    rows: lines.length,
    totalRows: page.totalRows,
    pageSize: PAGE_SIZE,
  })
  const singlePage = info.isFirst && !page.nextCursor

  const rows: StatementRow[] = lines.map((row, index) => ({
    id: `${row.entryId ?? 'linea'}-${seenBefore + index}`,
    date: row.entryDate ?? page.from,
    voucher: voucherOf(row),
    href: row.entryId ? `${base}/asientos/${row.entryId}` : null,
    detail: rowDetail(row, isGroup),
    debitCents: row.debitCents || null,
    creditCents: row.creditCents || null,
    balanceCents: row.runningBalanceCents,
  }))

  // En la primera página, el «Saldo anterior» de la base; en las siguientes,
  // el saldo con que arranca la página (para leer de corrido).
  const first = lines[0]
  const opening = openingRow
    ? { balanceCents: openingRow.runningBalanceCents, label: 'Saldo anterior' }
    : first
      ? {
          balanceCents: first.runningBalanceCents - (first.debitCents - first.creditCents),
          label: 'Viene de la página anterior',
        }
      : null

  const last = lines.at(-1)
  const closingCents = last?.runningBalanceCents ?? openingRow?.runningBalanceCents ?? null
  let debit = 0
  let credit = 0
  for (const r of lines) {
    debit += r.debitCents
    credit += r.creditCents
  }

  return (
    <>
      <StatementTable
        rows={rows}
        caption={caption}
        balanceMode="side"
        opening={opening}
        totals={singlePage ? { debitCents: debit, creditCents: credit } : null}
        closing={
          !page.nextCursor && closingCents !== null
            ? { label: `Saldo al ${formatIsoDay(page.to)}`, balanceCents: closingCents }
            : null
        }
        emptyText="No hay movimientos en este período."
        footnote="Saldo: D = deudor, A = acreedor. Cada movimiento lleva a su asiento."
      />
      <KeysetPagination
        info={info}
        noun="movimientos"
        firstHref={bookHref(path, linkParams)}
        nextHref={
          page.nextCursor ? bookHref(path, { ...linkParams, despues: page.nextCursor }) : null
        }
      />
    </>
  )
}
