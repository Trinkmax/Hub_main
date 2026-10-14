import { ListTree } from 'lucide-react'
import type { AccountOption } from '@/components/administracion/account-combobox'
import { Amount } from '@/components/administracion/amount'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { PillLink } from '@/components/administracion/kit/pill'
import type { PartyOption } from '@/components/administracion/party-combobox'
import { type StatementRow, StatementTable } from '@/components/administracion/statement-table'
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
import { formatDayMonth, formatIsoDay, todayInCordoba } from '@/lib/dates'
import { BookPage, PERIOD_ROW } from '../_components/book-page'
import { BookTotals } from '../_components/book-totals'
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

/** Las cuentas del sistema que más se miran en el mayor, con el nombre que les da un socio. */
const QUICK_SYSTEM_ACCOUNTS: ReadonlyArray<{ systemKey: string; label: string }> = [
  { systemKey: 'payable_suppliers', label: 'Proveedores' },
  { systemKey: 'vat_credit', label: 'IVA de compras' },
  { systemKey: 'vat_debit', label: 'IVA de ventas' },
  { systemKey: 'vat_payable', label: 'IVA a pagar' },
]

/**
 * «Las más buscadas»: una píldora por caja o cuenta del bar y las cuatro del
 * sistema. El mayor abría vacío y pedía saber qué cuenta buscar entre más de
 * doscientas; con esto las de todos los días están a un toque.
 */
function quickAccounts(catalog: PostingCatalog): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = []
  const seen = new Set<string>()
  const push = (id: string | null | undefined, label: string) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push({ id, label })
  }
  for (const treasury of catalog.treasuries) {
    if (treasury.active) push(treasury.accountId, treasury.name)
  }
  for (const quick of QUICK_SYSTEM_ACCOUNTS) {
    const account = catalog.accounts.find((a) => a.systemKey === quick.systemKey && a.active)
    push(account?.id, quick.label)
  }
  return out
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

  const totals = page?.account ? page.periodTotals : null

  return (
    <BookPage
      backHref={bookHref(`${base}/libros`, shown.month ? { mes: shown.month } : {})}
      title="Mayor"
      description={
        accountName
          ? `${accountName}${partyName ? ` · ${partyName}` : ''} · ${shown.label}`
          : `Los movimientos de una cuenta, con su saldo · ${shown.label}`
      }
      exports={[
        ...(exportOne && account
          ? [
              {
                href: exportOne,
                fileName: `administracion-${tenantSlug}-mayor-${account.code}-${suffix}.csv`,
                label: 'Exportar esta cuenta',
              },
            ]
          : []),
        {
          href: exportAll,
          fileName: `administracion-${tenantSlug}-mayor-general-${suffix}.csv`,
          label: 'Exportar mayor general',
        },
      ]}
      booksPath={`${base}/libros`}
      book="mayor"
      period={shown}
      toolbar={
        <div className="space-y-3">
          <RangePicker
            className={PERIOD_ROW}
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
      totals={
        // En la segunda página la base no manda los totales del período: la banda no se dibuja.
        totals ? (
          <BookTotals
            items={[
              {
                key: 'anterior',
                label: 'Saldo anterior',
                value: <Amount cents={totals.openingCents} side currency={false} />,
              },
              {
                key: 'debe',
                label: 'Debe',
                value: <Amount cents={totals.debitCents} currency={false} />,
              },
              {
                key: 'haber',
                label: 'Haber',
                value: <Amount cents={totals.creditCents} currency={false} />,
              },
              {
                key: 'saldo',
                label: `Saldo al ${formatDayMonth(shown.to)}`,
                value: <Amount cents={totals.closingCents} side currency={false} />,
              },
            ]}
          />
        ) : null
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
        ) : catalog ? (
          <>
            <QuickAccounts
              accounts={quickAccounts(catalog)}
              hrefFor={(id) => bookHref(path, { ...period, cuenta: id })}
            />
            <EmptyTeach icon={ListTree} title="O buscá cualquier cuenta arriba">
              El mayor muestra los movimientos de una cuenta con su saldo. Buscala por nombre o por
              código, con o sin puntos (por ejemplo, «1.1.01.01» o «110101» encuentran Caja y
              bancos). Si elegís un grupo, suma todas sus cuentas.
            </EmptyTeach>
          </>
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

function QuickAccounts({
  accounts,
  hrefFor,
}: {
  accounts: ReadonlyArray<{ id: string; label: string }>
  hrefFor: (id: string) => string
}) {
  if (accounts.length === 0) return null
  return (
    <nav aria-labelledby="mas-buscadas" className="space-y-2">
      <h2
        id="mas-buscadas"
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
      >
        Las más buscadas
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {accounts.map((account) => (
          <li key={account.id}>
            <PillLink
              href={hrefFor(account.id)}
              className="h-11 px-4 text-sm md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]"
            >
              {account.label}
            </PillLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * El detalle de un movimiento sin repetir lo que ya se lee: el comprobante
 * («Pago · Carnicería» con el comprobante «Pago» queda «Carnicería») ni el
 * proveedor si la descripción ya lo nombra.
 */
function rowDetail(row: LedgerRow, isGroup: boolean): string | null {
  const label = row.documentLabel?.trim()
  // El comprobante ya es el título del renglón: se saca de la descripción, venga adelante
  // («Pago · Carnicería») o atrás («Tostadero Serrano SA · Factura A 0003-00004512»).
  const text = row.description?.trim()
  const description = !label
    ? text
    : text?.startsWith(`${label} · `)
      ? text.slice(label.length + 3)
      : text?.endsWith(` · ${label}`)
        ? text.slice(0, -(label.length + 3))
        : text
  const parts: string[] = []
  for (const raw of [
    // En un grupo, de qué cuenta es: el nombre alcanza («Caja», «Banco Nación»);
    // con el código adelante el detalle no entraba en dos líneas.
    isGroup ? (row.accountName ?? row.accountCode) : null,
    description,
    row.partyName,
    row.memo,
  ]) {
    const part = raw?.trim()
    // La leyenda de la línea suele ser el comprobante otra vez («Factura A 0003-00004512»).
    if (!part || part === label || parts.some((p) => p.includes(part))) continue
    parts.push(part)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/** «Asiento 12» (con «(provisorio)» mientras el mes está abierto), o `null` sin número. */
function entryLabel(row: LedgerRow): string | null {
  if (row.entryNumber === null) return null
  return `Asiento ${row.entryNumber}${row.numberIsProvisional ? ' (provisorio)' : ''}`
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

  const rows: StatementRow[] = lines.map((row, index) => {
    const entryHref = row.entryId ? `${base}/asientos/${row.entryId}` : null
    const entry = entryLabel(row)
    const label = row.documentLabel?.trim() || null
    // Con comprobante: el nombre lleva a su ficha y «Asiento 12», en gris, a cómo quedó en los
    // libros. Sin comprobante, el link es al asiento, como siempre.
    const toDocument = Boolean(label && row.documentId)
    return {
      id: `${row.entryId ?? 'linea'}-${seenBefore + index}`,
      date: row.entryDate ?? page.from,
      voucher: label ?? entry ?? 'Asiento',
      href: toDocument ? `${base}/comprobantes/${row.documentId}` : entryHref,
      secondaryHref: toDocument ? entryHref : null,
      secondaryLabel: toDocument ? (entry ?? 'Ver el asiento') : undefined,
      detail: rowDetail(row, isGroup),
      debitCents: row.debitCents || null,
      creditCents: row.creditCents || null,
      balanceCents: row.runningBalanceCents,
    }
  })

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
        footnote="Saldo: D = deudor, A = acreedor. El comprobante lleva a su ficha; «Asiento N», a cómo quedó en los libros."
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
