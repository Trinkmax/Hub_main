import type { AccountOption } from '@/components/administracion/account-combobox'
import type { PartyOption } from '@/components/administracion/party-combobox'
import { Planilla } from '@/components/administracion/planilla'
import { loadPostingCatalog, type PostingCatalog } from '@/lib/accounting/context'
import {
  exportHref,
  getImputationFlags,
  getLedger,
  getTrialBalance,
  REPORT_PAGE_LIMIT,
  settleQuery,
} from '@/lib/accounting/queries'
import { decodePageToken } from '@/lib/accounting/queries/shared'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { todayInCordoba } from '@/lib/dates'
import { BackLink, BookPage } from '../_components/book-page'
import { EntryPanelProvider } from '../_components/entry-panel'
import { KeysetPagination } from '../_components/keyset-pagination'
import { RangePicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { loadBookContext } from '../_lib/book-context'
import { keysetPageInfo } from '../_lib/keyset'
import { requireBooksAccess } from '../_lib/page-access'
import { bookHref, firstParam, periodParams, resolveBookRange } from '../_lib/periods'
import { trialReturnFilters, trialRowAnchor } from '../_lib/trial'
import { LedgerFilters } from './_components/ledger-filters'
import { LedgerTable } from './_components/ledger-table'
import { accountsWithMovement, adjacentAccounts, ledgerViewRows } from './_lib/ledger-rows'

export const metadata = { title: 'Mayor' }

/** Movimientos por página del mayor (la base acepta hasta 500). */
const PAGE_SIZE = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuidParam(value: string | string[] | undefined): string | null {
  const v = firstParam(value)
  return v && UUID_RE.test(v) ? v : null
}

/**
 * Las cuentas para el buscador del mayor: todas las activas (y la elegida) de los niveles del plan,
 * también los grupos, que en el mayor suman sus cuentas («Mayor de Caja y bancos»). Por eso acá todas
 * se pueden elegir. Va la madre de cada una: con códigos del estilo `1.1.01.01.001` la ruta no sale de
 * cortar el código.
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

/**
 * El Mayor: una cuenta con todos sus movimientos y su saldo (Silvia, min. 10: «entro al mayor de la
 * cuenta para mirar qué movimiento me está generando el error»). Se llega tocando una fila de Sumas y
 * saldos, con el mismo período; las flechas dan vuelta la hoja a la cuenta anterior o a la siguiente.
 * Sin cuenta elegida abre en la primera con movimiento: nunca una hoja en blanco.
 */
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
  const { access, canWrite } = await requireBooksAccess(tenantSlug, path)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const range = resolveBookRange(sp, today)
  const shown = range.ok ? range : resolveBookRange({}, today)
  if (!shown.ok) throw new Error('período por defecto inválido')
  const despues = firstParam(sp.despues)
  const rawCuenta = firstParam(sp.cuenta)
  const volver = firstParam(sp.volver)

  const [ctx, catalogResult, trial, flags, firstOpenDate] = await Promise.all([
    loadBookContext(tenantId, today),
    settleQuery(loadPostingCatalog(tenantId)),
    range.ok ? settleQuery(getTrialBalance(tenantId, { from: range.from, to: range.to })) : null,
    range.ok ? settleQuery(getImputationFlags(tenantId, { from: range.from, to: range.to })) : null,
    loadFirstOpenDate(tenantId),
  ])
  const catalog = catalogResult.ok ? catalogResult.data : null
  const stops = trial?.ok ? accountsWithMovement(trial.data.rows) : []
  const accountId = uuidParam(sp.cuenta) ?? (rawCuenta ? null : (stops[0]?.accountId ?? null))
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
  const filterParams = { cuenta: accountId, participe: partyId, volver }
  const page = ledger?.ok ? ledger.data : null
  const account = page?.account ?? null
  const accountName = account ? `${account.code} ${account.name}` : null

  const { prev, next } = adjacentAccounts(stops, account?.code ?? selected?.code ?? null)
  const stepHref = (stop: { accountId: string }) =>
    bookHref(path, { ...period, cuenta: stop.accountId, volver })
  const trialFilters = trialReturnFilters(volver)
  const suffix = `${shown.from}_${shown.to}`

  return (
    <EntryPanelProvider tenantSlug={tenantSlug} canWrite={canWrite}>
      <BookPage
        title="Mayor"
        toolbar={
          <>
            {trialFilters ? (
              <BackLink
                href={`${bookHref(`${base}/libros/sumas-y-saldos`, { ...period, ...trialFilters })}${
                  account ? `#${trialRowAnchor(account.id)}` : ''
                }`}
              >
                Sumas y saldos
              </BackLink>
            ) : null}
            {catalog ? (
              <LedgerFilters
                accounts={accountOptions(catalog, accountId)}
                parties={partyOptions(catalog)}
                accountId={accountId}
                partyId={partyId}
                showParty={showParty}
                prev={
                  prev
                    ? {
                        href: stepHref(prev),
                        label: `Cuenta anterior: ${prev.code} ${prev.name}`,
                      }
                    : null
                }
                next={
                  next
                    ? {
                        href: stepHref(next),
                        label: `Cuenta siguiente: ${next.code} ${next.name}`,
                      }
                    : null
                }
              />
            ) : null}
            <RangePicker
              range={shown}
              today={today}
              fiscalYear={ctx.fiscalYear}
              minMonth={ctx.minMonth}
            />
          </>
        }
        exports={[
          ...(account
            ? [
                {
                  href: exportHref(tenantSlug, 'mayor', {
                    desde: shown.from,
                    hasta: shown.to,
                    cuenta: account.id,
                    participe: partyId,
                  }),
                  fileName: `administracion-${tenantSlug}-mayor-${account.code}-${suffix}.csv`,
                },
              ]
            : []),
          {
            href: exportHref(tenantSlug, 'mayor-general', { desde: shown.from, hasta: shown.to }),
            fileName: `administracion-${tenantSlug}-mayor-general-${suffix}.csv`,
            label: 'Mayor general',
          },
        ]}
      >
        {!range.ok ? <PeriodError message={range.message} /> : null}
        {!catalogResult.ok ? (
          <QueryErrorBlock code={catalogResult.code} message={catalogResult.message} />
        ) : null}

        {!accountId && rawCuenta ? (
          <PeriodError
            message="Esa cuenta no existe en este bar."
            hint="Elegila de nuevo con el buscador de arriba."
          />
        ) : null}

        {!accountId && !rawCuenta && range.ok ? (
          <Planilla>
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Ninguna cuenta tuvo movimiento en {shown.label.toLowerCase()}. Buscá una por código o
              por nombre.
            </p>
          </Planilla>
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

        {page?.account
          ? (() => {
              const seenBefore = decodePageToken(despues)?.seen ?? 0
              const opening = page.rows.find((r) => r.rowKind === 'opening') ?? null
              const lines = page.rows.filter((r) => r.rowKind === 'line')
              const info = keysetPageInfo({
                seenBefore,
                rows: lines.length,
                totalRows: page.totalRows,
                pageSize: PAGE_SIZE,
              })
              const first = lines[0]
              const last = lines.at(-1)
              const singlePage = info.isFirst && !page.nextCursor
              let debit = 0
              let credit = 0
              for (const r of lines) {
                debit += r.debitCents
                credit += r.creditCents
              }
              const linkParams = { ...period, ...filterParams }
              return (
                <>
                  <LedgerTable
                    rows={ledgerViewRows(lines, {
                      fallbackDate: page.from,
                      isGroup: !page.account.postable,
                      flags: flags?.ok ? flags.data : [],
                      firstOpenDate,
                    })}
                    caption={`Mayor de ${accountName ?? ''}, ${shown.label}`}
                    // En la primera página, el saldo de la base; en las siguientes, el saldo con
                    // que arranca la página (para leer de corrido).
                    opening={
                      opening
                        ? { label: 'Saldo inicial', balanceCents: opening.runningBalanceCents }
                        : first
                          ? {
                              label: 'Viene de la página anterior',
                              balanceCents:
                                first.runningBalanceCents - (first.debitCents - first.creditCents),
                            }
                          : null
                    }
                    totals={
                      page.periodTotals ??
                      (singlePage ? { debitCents: debit, creditCents: credit } : null)
                    }
                    closingCents={
                      page.nextCursor
                        ? null
                        : (last?.runningBalanceCents ?? opening?.runningBalanceCents ?? null)
                    }
                    emptyText={`Sin movimientos en ${shown.label.toLowerCase()}.`}
                  />
                  <KeysetPagination
                    info={info}
                    noun="movimientos"
                    firstHref={bookHref(path, linkParams)}
                    nextHref={
                      page.nextCursor
                        ? bookHref(path, { ...linkParams, despues: page.nextCursor })
                        : null
                    }
                  />
                </>
              )
            })()
          : null}
      </BookPage>
    </EntryPanelProvider>
  )
}
