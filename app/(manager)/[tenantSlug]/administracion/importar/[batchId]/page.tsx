import { CalendarRange, CheckCircle2, ClipboardList, Repeat2 } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Callout } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/form-bits'
import { ListPagination } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/list-pagination'
import { BlockError } from '@/components/administracion/cajas-ventas/block-error'
import { BackLink } from '@/components/administracion/importar/page-bits'
import {
  CancelBatchButton,
  RebuildButton,
} from '@/components/administracion/importar/review/batch-actions'
import {
  type LookupView,
  NewSuppliers,
} from '@/components/administracion/importar/review/new-suppliers'
import { PostBar } from '@/components/administracion/importar/review/post-bar'
import { ProposalList } from '@/components/administracion/importar/review/proposal-list'
import {
  type ReviewOptions,
  ReviewProvider,
} from '@/components/administracion/importar/review/review-context'
import type { ProposalView } from '@/components/administracion/importar/review/types'
import { ActionButton } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { SectionNav } from '@/components/administracion/section-nav'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { StatCard } from '@/components/ui/stat-card'
import {
  AccountingContextError,
  loadPostingCatalog,
  type PostingCatalog,
} from '@/lib/accounting/context'
import { isUuid, settleQuery } from '@/lib/accounting/queries/shared'
import { listTreasuryBalances } from '@/lib/accounting/queries/treasury'
import { getArcaLookupStatus } from '@/lib/arca/queries'
import { formatDateTime, formatIsoDay, formatMonthYear, formatRange } from '@/lib/dates'
import {
  getImportReview,
  getMpImportSettings,
  type ImportProposalRow,
  listImportProposals,
} from '@/lib/imports/server/queries'
import {
  filterCounts,
  NEED_SHORT_TEXT,
  needChips,
  pageFromQuery,
  REVIEW_FILTER_COPY,
  REVIEW_FILTERS,
  resolveReviewFilter,
} from '@/lib/imports/ui/filters'
import {
  IMPORT_SOURCE_COPY,
  importBatchHref,
  importHref,
  importSourceHref,
  isUiImportSource,
} from '@/lib/imports/ui/labels'
import { count, formatCount } from '@/lib/imports/ui/progress'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { firstParam, requireImportAccess } from '../_lib/page-access'

export const metadata = { title: 'Revisar la importación · Administración' }

/** Propuestas por página. */
const PAGE = 50

async function catalogOf(tenantId: string): Promise<PostingCatalog | null> {
  try {
    return await loadPostingCatalog(tenantId)
  } catch (error) {
    if (error instanceof AccountingContextError) return null
    throw error
  }
}

function viewOf(row: ImportProposalRow): ProposalView {
  const fv = row.formValues
  const decisions = row.summary.decisions ?? {}
  const partyId =
    typeof fv.partyId === 'string' && isUuid(fv.partyId) ? fv.partyId : (decisions.party_id ?? null)
  return {
    key: row.key,
    form: row.form,
    status: row.status,
    previewHash: row.previewHash,
    summary: row.summary,
    needs: row.needs,
    warningsAck: row.warningsAck,
    documentId: row.documentId,
    error: row.error,
    partyId,
    hasDecisions: Object.keys(decisions).length > 0 || row.warningsAck.length > 0,
    hasValues: Object.keys(fv).length > 0,
  }
}

function optionsOf(catalog: PostingCatalog): ReviewOptions {
  return {
    parties: catalog.parties
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        name: p.name,
        tradeName: p.tradeName,
        taxId: p.taxId,
        active: p.active,
        kind: p.kind,
      })),
    accounts: catalog.accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      postable: a.postable,
      active: a.active,
      parentId: a.parentId,
      purchase: a.purchaseSelectable && a.postable && a.active,
      treasury: a.isTreasury,
    })),
    treasuries: catalog.treasuries
      .filter((t) => t.active)
      .map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        balanceCents: t.balanceCents,
        active: t.active,
      })),
    methods: catalog.methods.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name })),
    iibbJurisdictionCode: catalog.settings.iibbJurisdictionCode,
  }
}

/** Avisos del archivo que vale la pena mostrar arriba (saldos que no cierran). */
function fileWarnings(meta: Record<string, unknown>): string[] {
  const checks =
    typeof meta.checks === 'object' && meta.checks !== null
      ? (meta.checks as Record<string, unknown>)
      : {}
  const out: string[] = []
  if (checks.total === 'mismatch') {
    const diff = typeof checks.totalDiffCents === 'number' ? checks.totalDiffCents : null
    out.push(
      `En el reporte, el saldo inicial más los movimientos no da el saldo final${diff !== null ? ` (diferencia: ${formatCents(Math.abs(diff))})` : ''}. Igual podés cargar lo de abajo; si podés, bajá el reporte de nuevo.`,
    )
  }
  if (checks.balance === 'mismatch') {
    const rows = typeof checks.mismatchRows === 'number' ? checks.mismatchRows : 0
    out.push(
      `En el extracto, el saldo no cierra en ${count(rows, 'fila', 'filas')}: revisá esas fechas en el home banking.`,
    )
  }
  return out
}

/**
 * Revisar y cargar una importación (diseño §4.0–§4.3, los tres orígenes): el
 * resumen arriba (listos, para revisar, ya cargados), los proveedores nuevos,
 * la lista con lo que falta y su arreglo en el lugar, y la barra «Cargar N
 * comprobantes» que carga de a 15. La contadora ve todo sin botones.
 */
export default async function ImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; batchId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug, batchId } = await params
  const sp = await searchParams
  const { access, canWrite } = await requireImportAccess(
    tenantSlug,
    importBatchHref(tenantSlug, batchId),
  )
  if (!isUuid(batchId)) notFound()
  const tenantId = access.tenant.id
  const back = <BackLink href={importHref(tenantSlug)} label="Volver a Importar" />

  const review = await settleQuery(getImportReview(tenantId, batchId))
  if (!review.ok) {
    return (
      <PageShell>
        {back}
        <PageHeader eyebrow="Administración" title="Revisar la importación" />
        <BlockError message={review.message} />
      </PageShell>
    )
  }
  if (review.data === null) notFound()
  const r = review.data
  const batch = r.batch
  const source = isUiImportSource(batch.source) ? batch.source : null
  if (!source) {
    return (
      <PageShell>
        {back}
        <PageHeader eyebrow="Administración" title="Revisar la importación" />
        <EmptyState
          icon={ClipboardList}
          title="Este tipo de archivo todavía no se revisa acá"
          description="Por ahora se importan las compras de ARCA (Recibidos), Mercado Pago y el banco."
        />
      </PageShell>
    )
  }
  const copy = IMPORT_SOURCE_COPY[source]
  const editable = canWrite && ['staging', 'review', 'posting'].includes(batch.status)
  const counts = filterCounts(r.byStatus)
  const resolved = resolveReviewFilter(
    { ver: firstParam(sp.ver), falta: firstParam(sp.falta) },
    counts,
    r.needs,
  )
  const expected = resolved.need ? (r.needs[resolved.need] ?? 0) : counts[resolved.filter]
  const page = pageFromQuery(firstParam(sp.pagina), expected, PAGE)

  // Control de saldo al terminar (diseño §4.2.2): la cuenta en los libros al final del período
  // contra el saldo final del archivo (Mercado Pago y banco), cuando ya no queda nada por cargar.
  const proposalsCount = counts.todos
  const reportFinal =
    typeof batch.meta.finalBalanceCents === 'number' ? batch.meta.finalBalanceCents : null
  const settled =
    proposalsCount > 0 &&
    counts.listas === 0 &&
    counts.revisar === 0 &&
    (r.byStatus.posted ?? 0) > 0
  const wantsBalance =
    source !== 'arca_recibidos' && reportFinal !== null && batch.periodTo !== null && settled

  const [list, catalog, lookup, balances, mpSettings] = await Promise.all([
    settleQuery(
      listImportProposals(tenantId, batchId, {
        statuses: resolved.statuses,
        need: resolved.need,
        limit: PAGE,
        offset: (page - 1) * PAGE,
      }),
    ),
    editable ? catalogOf(tenantId) : Promise.resolve(null),
    editable && source === 'arca_recibidos' && r.newSuppliers.length > 0
      ? settleQuery(getArcaLookupStatus(tenantId))
      : Promise.resolve(null),
    wantsBalance
      ? settleQuery(listTreasuryBalances(tenantId, { asOf: batch.periodTo }))
      : Promise.resolve(null),
    wantsBalance && source === 'mp_release'
      ? settleQuery(getMpImportSettings(tenantId))
      : Promise.resolve(null),
  ])
  const options = catalog ? optionsOf(catalog) : null
  const lookupView: LookupView = lookup?.ok
    ? { environment: lookup.data.environment, testData: lookup.data.testData }
    : null
  const controlTreasuryId =
    source === 'bank_statement'
      ? batch.treasuryAccountId
      : mpSettings?.ok
        ? (mpSettings.data.effective?.treasuryId ??
          mpSettings.data.connection?.treasuryAccountId ??
          null)
        : null
  const control =
    balances?.ok && controlTreasuryId && reportFinal !== null
      ? (balances.data.find((t) => t.treasuryId === controlTreasuryId) ?? null)
      : null
  const treasuryName = batch.treasuryAccountId
    ? (catalog?.treasuries.find((t) => t.id === batch.treasuryAccountId)?.name ??
      (source === 'bank_statement' ? (control?.name ?? null) : null))
    : null

  const readyCount = (r.byStatus.ready ?? 0) + (r.byStatus.posting ?? 0)
  const proposals = proposalsCount
  const unit = copy.unit
  const description = [
    batch.fileName,
    batch.periodFrom && batch.periodTo ? formatRange(batch.periodFrom, batch.periodTo) : null,
    `subido${batch.createdByName ? ` por ${batch.createdByName}` : ''} el ${formatDateTime(batch.createdAt)}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const hrefFor = (query: Record<string, string | number | null>) =>
    importBatchHref(tenantSlug, batchId, query)
  const chips = resolved.filter === 'revisar' ? needChips(r.needs) : []
  const listTotal = list.ok ? list.data.total : 0
  const totalPages = Math.max(1, Math.ceil(listTotal / PAGE))
  const warnings = fileWarnings(batch.meta)
  const duplicates = batch.counts?.duplicate ?? 0

  return (
    <ReviewProvider
      slug={tenantSlug}
      batchId={batchId}
      source={source}
      editable={editable}
      canWrite={canWrite}
      options={options}
    >
      <PageShell>
        {back}
        <PageHeader
          eyebrow="Administración"
          title={
            <>
              {/* «Banco · Banco Nación» repetía: si la cuenta ya lo dice, va sola. */}
              {treasuryName
                ? treasuryName.toLowerCase().startsWith(copy.title.toLowerCase())
                  ? treasuryName
                  : `${copy.title} · ${treasuryName}`
                : copy.title}{' '}
              <ReadOnlyBadge />
            </>
          }
          description={description}
          actions={
            editable && proposals > 0 ? (
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <RebuildButton slug={tenantSlug} batchId={batchId} />
                <CancelBatchButton
                  slug={tenantSlug}
                  batchId={batchId}
                  posted={r.byStatus.posted ?? 0}
                />
              </div>
            ) : null
          }
        />

        {batch.status === 'cancelled' ? (
          <Callout tone="info" title="Esta importación se canceló">
            {batch.cancelledAt ? `El ${formatDateTime(batch.cancelledAt)}. ` : ''}
            {batch.cancelReason ? `Motivo: ${batch.cancelReason}. ` : ''}Lo que no se había cargado
            quedó afuera; lo cargado sigue en los libros.
          </Callout>
        ) : null}
        {batch.status === 'done' ? (
          <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <p>Listo: se cargó todo lo que había para cargar de este archivo.</p>
          </div>
        ) : null}
        {batch.status === 'staging' && proposals === 0 ? (
          (batch.counts?.items ?? 0) > 0 ? (
            <Callout
              tone="warning"
              title="Esta importación no se terminó de armar"
              action={
                editable ? (
                  <RebuildButton
                    slug={tenantSlug}
                    batchId={batchId}
                    label="Armar ahora"
                    variant="default"
                  />
                ) : null
              }
            >
              {editable
                ? 'Las filas ya están guardadas: falta armar los comprobantes.'
                : 'Las filas ya están guardadas: falta que alguien con acceso de carga arme los comprobantes.'}
            </Callout>
          ) : (
            <Callout
              tone="warning"
              title="Esta importación no se terminó de subir"
              action={
                editable ? (
                  <Link
                    href={importSourceHref(tenantSlug, source)}
                    className="inline-flex min-h-11 items-center font-medium underline underline-offset-2"
                  >
                    Subir el archivo de nuevo
                  </Link>
                ) : null
              }
            >
              Volvé a subir el mismo archivo: seguimos desde donde quedó, sin repetir nada.
            </Callout>
          )
        ) : null}

        {proposals === 0 && batch.status !== 'staging' ? (
          <EmptyState
            icon={ClipboardList}
            title="No hay nada para cargar de este archivo"
            description={
              (batch.counts?.duplicate ?? 0) > 0
                ? 'Todas sus filas ya estaban en otra importación: no se repiten.'
                : 'El archivo no trajo movimientos para cargar.'
            }
          />
        ) : null}

        {proposals > 0 ? (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={CheckCircle2}
              iconClassName="text-success"
              label="Listos para cargar"
              value={formatCount(readyCount)}
              hint={formatCentsShort(r.readyCents)}
            />
            <StatCard
              icon={ClipboardList}
              iconClassName="text-warning"
              label="Para revisar"
              value={formatCount(counts.revisar)}
              hint={counts.revisar > 0 ? formatCentsShort(r.pendingCents) : 'Nada pendiente'}
            />
            <StatCard
              icon={Repeat2}
              label="Ya estaban cargados"
              value={formatCount(r.alreadyLoaded)}
              hint="No se cargan dos veces"
            />
            <StatCard
              icon={CalendarRange}
              iconClassName="text-primary"
              label="Cargados"
              value={formatCount(r.byStatus.posted ?? 0)}
              hint={`de ${count(proposals, unit[0], unit[1])}`}
            />
          </section>
        ) : null}

        {editable && !options ? (
          <Callout tone="error" title="No pudimos cargar tus proveedores y cuentas.">
            Sin eso no se puede completar lo que falta. Recargá la página en un rato; si sigue,
            avisanos.
          </Callout>
        ) : null}
        {control && reportFinal !== null && batch.periodTo ? (
          control.balanceCents === reportFinal ? (
            <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <p className="text-pretty">
                {control.name} cierra con {source === 'mp_release' ? 'el reporte' : 'el extracto'}:{' '}
                {formatCents(control.balanceCents)} al {formatIsoDay(batch.periodTo)}.
              </p>
            </div>
          ) : (
            <Callout
              tone="warning"
              title={`${control.name} no cierra con ${source === 'mp_release' ? 'el reporte' : 'el extracto'}`}
              action={
                <ActionButton
                  action="ajustar"
                  params={{ caja: control.treasuryId }}
                  variant="outline"
                  className="h-11 w-full sm:w-auto md:h-9"
                >
                  Ajustar saldo
                </ActionButton>
              }
            >
              Al {formatIsoDay(batch.periodTo)}, en los libros queda en{' '}
              {formatCents(control.balanceCents)} y{' '}
              {source === 'mp_release' ? 'Mercado Pago' : 'el banco'} dice{' '}
              {formatCents(reportFinal)}. La diferencia (
              {formatCents(Math.abs(control.balanceCents - reportFinal))}) suele ser algo cargado
              dos veces o un movimiento que falta.
            </Callout>
          )
        ) : null}
        {warnings.map((w) => (
          <Callout key={w} tone="warning">
            {w}
          </Callout>
        ))}
        {duplicates > 0 ? (
          <p className="text-sm text-muted-foreground">
            {count(duplicates, 'fila ya estaba', 'filas ya estaban')} en otra importación: no se
            repiten.
          </p>
        ) : null}
        {r.months.length > 0 ? (
          <p className="text-sm text-muted-foreground text-pretty">
            Lo listo va a los libros de{' '}
            {r.months
              .map(
                (m) =>
                  `${formatMonthYear(m.month)} (${m.count} · ${formatCentsShort(m.totalCents)})`,
              )
              .join(', ')}
            .
            {r.movedToOpenMonth > 0
              ? ` ${count(r.movedToOpenMonth, 'es', 'son')} de un mes ya cerrado: se cargan el primer día abierto.`
              : ''}
          </p>
        ) : null}

        {source === 'arca_recibidos' && r.newSuppliers.length > 0 ? (
          <NewSuppliers
            rows={r.newSuppliers}
            lookup={lookupView}
            connectHref={`/${tenantSlug}/administracion/ajustes/arca`}
          />
        ) : null}

        {proposals > 0 ? (
          <div className="space-y-4">
            <SectionNav
              label="Filtrar los comprobantes"
              active={resolved.filter}
              items={REVIEW_FILTERS.map((f) => ({
                value: f,
                label: REVIEW_FILTER_COPY[f].label,
                shortLabel: REVIEW_FILTER_COPY[f].shortLabel,
                href: hrefFor({ ver: f }),
                count: counts[f],
              }))}
            />
            {chips.length > 1 || resolved.need ? (
              <nav aria-label="Qué falta" className="flex flex-wrap gap-2">
                <Link
                  href={hrefFor({ ver: 'revisar' })}
                  scroll={false}
                  aria-current={resolved.need === null ? 'true' : undefined}
                  className={cn(
                    'inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium md:h-9',
                    resolved.need === null
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:bg-secondary',
                  )}
                >
                  Todo lo que falta
                </Link>
                {chips.map((c) => (
                  <Link
                    key={c.key}
                    href={hrefFor({ ver: 'revisar', falta: c.key })}
                    scroll={false}
                    aria-current={resolved.need === c.key ? 'true' : undefined}
                    className={cn(
                      'inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium md:h-9',
                      resolved.need === c.key
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:bg-secondary',
                    )}
                  >
                    {c.label}
                    <span className="tabular-nums opacity-80">{c.count}</span>
                  </Link>
                ))}
              </nav>
            ) : null}

            {!list.ok ? (
              <BlockError message={list.message} />
            ) : list.data.rows.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title={
                  resolved.filter === 'revisar'
                    ? 'No queda nada para revisar'
                    : resolved.filter === 'listas'
                      ? 'No hay nada listo para cargar'
                      : 'No hay nada acá'
                }
                description={
                  resolved.filter === 'revisar' && counts.listas > 0
                    ? `Ya podés cargar ${count(counts.listas, unit[0], unit[1])} con el botón de abajo.`
                    : resolved.filter === 'listas' && counts.revisar > 0
                      ? 'Primero completá lo que falta en «Para revisar».'
                      : undefined
                }
              />
            ) : (
              <>
                <ProposalList
                  rows={list.data.rows.map(viewOf)}
                  label={
                    resolved.need
                      ? `${REVIEW_FILTER_COPY.revisar.label}: ${NEED_SHORT_TEXT[resolved.need]}`
                      : REVIEW_FILTER_COPY[resolved.filter].label
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Mostrando {formatCount((page - 1) * PAGE + 1)}–
                  {formatCount((page - 1) * PAGE + list.data.rows.length)} de{' '}
                  {formatCount(listTotal)}
                </p>
                <ListPagination
                  page={page}
                  totalPages={totalPages}
                  hrefFor={(n) =>
                    hrefFor({
                      ver: resolved.filter,
                      falta: resolved.need,
                      pagina: n > 1 ? n : null,
                    })
                  }
                />
              </>
            )}
          </div>
        ) : null}

        {editable ? (
          <PostBar
            readyCount={readyCount}
            readyCents={r.readyCents}
            months={r.months}
            movedToOpenMonth={r.movedToOpenMonth}
            warnings={r.warnings}
            unit={unit}
          />
        ) : null}
      </PageShell>
    </ReviewProvider>
  )
}
