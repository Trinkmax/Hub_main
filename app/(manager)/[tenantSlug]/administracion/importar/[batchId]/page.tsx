import { ClipboardList } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ListPagination } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/list-pagination'
import { BalanceCheck } from '@/components/administracion/importar/review/balance-check'
import { RebuildButton } from '@/components/administracion/importar/review/batch-actions'
import { MoreOptions } from '@/components/administracion/importar/review/more-options'
import { MpInsights } from '@/components/administracion/importar/review/mp-insights'
import {
  type LookupView,
  NewSuppliers,
} from '@/components/administracion/importar/review/new-suppliers'
import { PostBar } from '@/components/administracion/importar/review/post-bar'
import {
  ProposalList,
  QuestionDeck,
  TeachHost,
} from '@/components/administracion/importar/review/proposal-list'
import {
  ANSWER_BUTTON,
  QuestionAnswers,
  QuestionCard,
} from '@/components/administracion/importar/review/question-card'
import {
  type ReviewOptions,
  ReviewProvider,
} from '@/components/administracion/importar/review/review-context'
import { ReviewHero, ReviewRoute } from '@/components/administracion/importar/review/review-hero'
import type { ProposalView } from '@/components/administracion/importar/review/types'
import {
  AdmHeader,
  AdmPage,
  EmptyTeach,
  PanelError,
  PillLink,
} from '@/components/administracion/kit'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import {
  AccountingContextError,
  loadPostingCatalog,
  type PostingCatalog,
} from '@/lib/accounting/context'
import { isUuid, settleQuery } from '@/lib/accounting/queries/shared'
import { getTreasuryAccount, listTreasuryBalances } from '@/lib/accounting/queries/treasury'
import { getArcaLookupStatus } from '@/lib/arca/queries'
import { formatDateTime } from '@/lib/dates'
import {
  getImportReview,
  getMpImportSettings,
  type ImportProposalRow,
  listImportProposals,
} from '@/lib/imports/server/queries'
import {
  filterCounts,
  needChips,
  pageFromQuery,
  REVIEW_FILTER_COPY,
  resolveReviewFilter,
} from '@/lib/imports/ui/filters'
import { displayBatchStatus } from '@/lib/imports/ui/inbox'
import {
  IMPORT_SOURCE_COPY,
  importBatchHref,
  importHref,
  importSourceHref,
  isUiImportSource,
} from '@/lib/imports/ui/labels'
import { MP_INSIGHTS_LIMIT, mpCut, mpDays } from '@/lib/imports/ui/mp-insights'
import { count, formatCount } from '@/lib/imports/ui/progress'
import {
  needPillLabel,
  otherQuestions,
  type ReviewStage,
  reviewHero,
  reviewTally,
  reviewTitle,
  routeSteps,
} from '@/lib/imports/ui/review-copy'
import { formatCents } from '@/lib/money'
import { firstParam, requireImportAccess } from '../_lib/page-access'

export const metadata = { title: 'Revisar un archivo · Administración' }

/** Hojas por página. */
const PAGE = 50
/** La medida de las píldoras de filtro: 44 px con el dedo, 36 con mouse. */
const FILTER_PILL =
  'h-11 px-4 text-sm md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]'

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
        // Para guardarle el CUIT a uno que ya estaba («Sí: es {proveedor}»).
        updatedAt: p.updatedAt,
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
      type: a.type,
      systemKey: a.systemKey,
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

/** Avisos del archivo que vale la pena mostrar junto al saldo (un reporte que no cierra solo). */
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
      `En el archivo del banco, el saldo no cierra en ${count(rows, 'renglón', 'renglones')}: revisá esas fechas en el home banking.`,
    )
  }
  return out
}

/**
 * Revisar un archivo (los tres orígenes): arriba, la pila dibujada con el
 * número que cambia con la tarea y las vistas; la ruta de lo que falta; el
 * saldo contra el banco o Mercado Pago; «¿Los tenés de antes?»; la pregunta en
 * la mano con su papel al lado (o la lista de la vista elegida); y abajo, la
 * barra para cargar y «Más opciones».
 *
 * Las URLs son las de siempre (`?ver=`, `?falta=`, `?pagina=`,
 * `#proveedores-nuevos`) y cada respuesta manda lo mismo que antes. La
 * contadora ve todo sin ningún botón.
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
  const back = { href: importHref(tenantSlug), label: 'Importar' }

  const review = await settleQuery(getImportReview(tenantId, batchId))
  if (!review.ok) {
    return (
      <AdmPage>
        <AdmHeader back={back} title="Revisar un archivo" />
        <PanelError title="Este archivo" message={review.message} />
      </AdmPage>
    )
  }
  if (review.data === null) notFound()
  const r = review.data
  const batch = r.batch
  const source = isUiImportSource(batch.source) ? batch.source : null
  if (!source) {
    return (
      <AdmPage>
        <AdmHeader back={back} title="Revisar un archivo" />
        <EmptyTeach icon={ClipboardList} title="Este tipo de archivo todavía no se revisa acá">
          Por ahora se suben las compras de ARCA (Recibidos), Mercado Pago y el banco.
        </EmptyTeach>
      </AdmPage>
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

  // El saldo del archivo contra el del sistema: se compara recién cuando no queda nada por
  // contestar ni cargar (la misma condición de siempre).
  const proposals = counts.todos
  const reportFinal =
    typeof batch.meta.finalBalanceCents === 'number' ? batch.meta.finalBalanceCents : null
  const hasReportBalance =
    source !== 'arca_recibidos' && reportFinal !== null && batch.periodTo !== null && proposals > 0
  const settled =
    proposals > 0 && counts.listas === 0 && counts.revisar === 0 && (r.byStatus.posted ?? 0) > 0
  const wantsBalance = hasReportBalance && settled
  const wantsInsights = source === 'mp_release' && proposals > 0 && proposals <= MP_INSIGHTS_LIMIT

  const [list, catalog, lookup, balances, mpSettings, mpAll, bankAccount] = await Promise.all([
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
    wantsInsights
      ? settleQuery(listImportProposals(tenantId, batchId, { limit: MP_INSIGHTS_LIMIT }))
      : Promise.resolve(null),
    // El nombre de la cuenta para el título, cuando no se carga el catálogo entero.
    source === 'bank_statement' && batch.treasuryAccountId && !editable
      ? settleQuery(getTreasuryAccount(tenantId, batch.treasuryAccountId))
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
  const treasuryName =
    source === 'bank_statement' && batch.treasuryAccountId
      ? (catalog?.treasuries.find((t) => t.id === batch.treasuryAccountId)?.name ??
        (bankAccount?.ok ? (bankAccount.data?.name ?? null) : null) ??
        control?.name ??
        null)
      : null

  const shown = displayBatchStatus(batch)
  const stage: ReviewStage =
    shown.key === 'cancelled'
      ? 'cancelled'
      : shown.key === 'staging'
        ? 'staging'
        : shown.key === 'loaded'
          ? 'loaded'
          : shown.key === 'nothing'
            ? 'nothing'
            : 'pending'
  const title = reviewTitle({
    source,
    stage,
    periodFrom: batch.periodFrom,
    periodTo: batch.periodTo,
    treasuryName,
  })
  const tally = reviewTally(r.byStatus, r.alreadyLoaded)
  const duplicates = batch.counts?.duplicate ?? 0
  const hero = reviewHero({
    source,
    tally,
    readyCents: r.readyCents,
    duplicates,
    cancelled: batch.status === 'cancelled',
  })
  const readyCount = tally.ready
  const unit = copy.unit
  const description = [
    batch.fileName,
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
  const who = source === 'mp_release' ? 'Mercado Pago' : 'el banco'
  const newSuppliers = source === 'arca_recibidos' ? r.newSuppliers.length : 0
  const route = editable
    ? routeSteps({
        newSuppliers,
        questions: otherQuestions(counts.revisar, r.needs),
        ready: readyCount,
        hrefFor,
      })
    : []
  const rows = list.ok ? list.data.rows.map(viewOf) : []
  const viewLabel = resolved.need
    ? `${REVIEW_FILTER_COPY.revisar.label}: ${needPillLabel(resolved.need)}`
    : REVIEW_FILTER_COPY[resolved.filter].label

  return (
    <ReviewProvider
      slug={tenantSlug}
      batchId={batchId}
      source={source}
      editable={editable}
      canWrite={canWrite}
      options={options}
      booksStartDate={catalog?.settings.booksStartDate ?? null}
    >
      <AdmPage>
        <AdmHeader back={back} title={title} description={description} badge={<ReadOnlyBadge />} />

        {batch.status === 'cancelled' ? (
          <QuestionCard
            tone="info"
            headingLevel="h2"
            question={`Este archivo se descartó${batch.cancelledAt ? ` el ${formatDateTime(batch.cancelledAt)}` : ''}.`}
            context={`${batch.cancelReason ? `Motivo: ${batch.cancelReason}. ` : ''}Lo que ya se había cargado sigue registrado.`}
          />
        ) : null}
        {batch.status === 'staging' && proposals === 0 ? (
          (batch.counts?.items ?? 0) > 0 ? (
            <QuestionCard
              tone="info"
              headingLevel="h2"
              question="Este archivo no se terminó de armar."
              context={
                editable
                  ? 'Los renglones ya están guardados: falta armar los comprobantes.'
                  : 'Falta que alguien con acceso de carga lo arme.'
              }
            >
              {editable ? (
                <QuestionAnswers>
                  <RebuildButton
                    slug={tenantSlug}
                    batchId={batchId}
                    label="Armar ahora"
                    variant="default"
                  />
                </QuestionAnswers>
              ) : null}
            </QuestionCard>
          ) : (
            <QuestionCard
              tone="info"
              headingLevel="h2"
              question="Este archivo no se terminó de subir."
              context="Volvé a subir el mismo: sigo donde quedó, sin repetir nada."
            >
              {editable ? (
                <QuestionAnswers>
                  <Button asChild className={ANSWER_BUTTON}>
                    <Link href={importSourceHref(tenantSlug, source)}>Subirlo de nuevo</Link>
                  </Button>
                </QuestionAnswers>
              ) : null}
            </QuestionCard>
          )
        ) : null}

        {proposals === 0 && batch.status !== 'staging' ? (
          <EmptyTeach icon={ClipboardList} title="No hay nada para cargar de este archivo">
            {duplicates > 0
              ? 'Todos sus renglones ya habían entrado con otro archivo: no se repiten.'
              : 'El archivo no trajo movimientos.'}
          </EmptyTeach>
        ) : null}

        {proposals > 0 ? (
          <ReviewHero
            hero={hero}
            tally={tally}
            unit={unit[1]}
            active={resolved.filter}
            counts={counts}
            hrefFor={hrefFor}
          />
        ) : null}

        <ReviewRoute steps={route} />

        {editable && !options ? (
          <PanelError
            title="Tus proveedores y categorías"
            message="No pude leer tus proveedores y categorías. Sin eso no se puede contestar. Recargá en un rato."
          />
        ) : null}

        {hasReportBalance && reportFinal !== null && batch.periodTo ? (
          settled && !control ? null : (
            <BalanceCheck
              who={who}
              periodTo={batch.periodTo}
              reportCents={reportFinal}
              book={
                control
                  ? {
                      treasuryId: control.treasuryId,
                      name: control.name,
                      balanceCents: control.balanceCents,
                    }
                  : null
              }
              movementsHref={
                control ? `/${tenantSlug}/administracion/cajas/${control.treasuryId}` : null
              }
              warnings={warnings}
            />
          )
        ) : warnings.length > 0 ? (
          <div className="space-y-1 rounded-xl bg-warning/10 px-4 py-3">
            {warnings.map((w) => (
              <p key={w} className="text-sm text-warning-text text-pretty">
                {w}
              </p>
            ))}
          </div>
        ) : null}

        {mpAll?.ok ? (
          <MpInsights
            days={mpDays(mpAll.data.rows)}
            cut={mpCut(mpAll.data.rows)}
            slug={tenantSlug}
            periodFrom={batch.periodFrom}
            periodTo={batch.periodTo}
            open={counts.revisar === 0}
          />
        ) : null}

        {newSuppliers > 0 ? (
          <NewSuppliers
            rows={r.newSuppliers}
            lookup={lookupView}
            connectHref={`/${tenantSlug}/administracion/ajustes/arca`}
          />
        ) : null}

        {proposals > 0 ? (
          <section aria-label={viewLabel} className="space-y-4">
            {chips.length > 1 || resolved.need ? (
              // En el celular la fila se desliza (con tres o cuatro preguntas ocupaba media pantalla).
              <nav
                aria-label="Qué te pregunto"
                className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
              >
                <PillLink
                  href={hrefFor({ ver: 'revisar' })}
                  scroll={false}
                  active={resolved.need === null}
                  count={counts.revisar}
                  className={FILTER_PILL}
                >
                  Todas las preguntas
                </PillLink>
                {chips.map((c) => (
                  <PillLink
                    key={c.key}
                    href={hrefFor({ ver: 'revisar', falta: c.key })}
                    scroll={false}
                    active={resolved.need === c.key}
                    count={c.count}
                    className={FILTER_PILL}
                  >
                    {needPillLabel(c.key)}
                  </PillLink>
                ))}
              </nav>
            ) : null}

            {!list.ok ? (
              <PanelError title={viewLabel} message={list.message} />
            ) : rows.length === 0 ? (
              <EmptyTeach
                title={
                  resolved.filter === 'revisar'
                    ? 'No queda ninguna pregunta'
                    : resolved.filter === 'listas'
                      ? 'No hay nada listo para cargar'
                      : 'No hay nada acá'
                }
              >
                {resolved.filter === 'revisar' && counts.listas > 0
                  ? editable
                    ? `Ya podés cargar ${counts.listas === 1 ? 'el que está listo' : `los ${counts.listas}`} con el botón de abajo.`
                    : `${count(counts.listas, 'está listo', 'están listos')} para cargar.`
                  : resolved.filter === 'listas' && counts.revisar > 0
                    ? editable
                      ? 'Primero contestá lo que te pregunto.'
                      : 'Todavía quedan preguntas por contestar.'
                    : null}
              </EmptyTeach>
            ) : (
              <>
                {resolved.filter === 'revisar' && editable && options ? (
                  <QuestionDeck rows={rows} offset={(page - 1) * PAGE} total={listTotal} />
                ) : (
                  <ProposalList
                    rows={rows}
                    label={viewLabel}
                    grouped={resolved.filter === 'no-se-cargan'}
                  />
                )}
                {listTotal > rows.length ? (
                  <p className="text-xs text-muted-foreground">
                    Mostrando {formatCount((page - 1) * PAGE + 1)}–
                    {formatCount((page - 1) * PAGE + rows.length)} de {formatCount(listTotal)}
                  </p>
                ) : null}
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
          </section>
        ) : null}

        {editable ? (
          <PostBar
            readyCount={readyCount}
            readyCents={r.readyCents}
            months={r.months}
            movedToOpenMonth={r.movedToOpenMonth}
            warnings={r.warnings}
            unit={unit}
            showMoney={source === 'arca_recibidos'}
            pendingAnswers={counts.revisar + newSuppliers}
          />
        ) : null}

        {editable && proposals > 0 ? (
          <MoreOptions slug={tenantSlug} batchId={batchId} posted={r.byStatus.posted ?? 0} />
        ) : null}

        <TeachHost />
      </AdmPage>
    </ReviewProvider>
  )
}
