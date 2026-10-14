import { HowToBanco } from '@/components/administracion/guias/how-to'
import { BankImport } from '@/components/administracion/importar/bank-import'
import {
  BankRulesCard,
  type BankRuleView,
} from '@/components/administracion/importar/bank-rules-card'
import { AdmHeader, AdmPage, PanelError } from '@/components/administracion/kit'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import {
  AccountingContextError,
  loadPostingCatalog,
  type PostingCatalog,
} from '@/lib/accounting/context'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { todayInCordoba } from '@/lib/dates'
import {
  type ImportRuleRow,
  listImportBatches,
  listImportLayouts,
  listImportRules,
} from '@/lib/imports/server/queries'
import { wantedRange } from '@/lib/imports/ui/inbox'
import { importHref, importSourceHref } from '@/lib/imports/ui/labels'
import { requireImportAccess } from '../_lib/page-access'

export const metadata = { title: 'Subir los movimientos del banco · Administración' }

async function catalogOf(
  tenantId: string,
): Promise<{ ok: true; data: PostingCatalog } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await loadPostingCatalog(tenantId) }
  } catch (error) {
    if (error instanceof AccountingContextError) return { ok: false, message: error.state.message }
    throw error
  }
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function ruleView(r: ImportRuleRow): BankRuleView {
  const direction = r.match.direction
  return {
    id: r.id,
    priority: r.priority,
    label: r.label,
    pattern: text(r.match.pattern),
    counterpartyCuit: text(r.match.counterparty_cuit),
    direction: direction === 'credit' || direction === 'debit' ? direction : null,
    kind: text(r.action.kind) ?? 'review',
    component: text(r.action.component),
    accountId: text(r.action.account_id),
    partyId: text(r.action.party_id),
    treasuryId: text(r.action.treasury_account_id),
    active: r.active,
    serverSafe: r.serverSafe,
    updatedAt: r.updatedAt,
  }
}

/**
 * «Subir los movimientos del banco»: los tres pasos (bajalo del home banking →
 * subilo acá, eligiendo de qué cuenta es y, si el banco es nuevo, contando qué
 * es cada columna → revisá y cargá). Al pie, plegado, lo que el bar ya le
 * enseñó a reconocer. La contadora ve un aviso con la vuelta a Importar.
 */
export default async function ImportarBancoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { access, canWrite } = await requireImportAccess(
    tenantSlug,
    importSourceHref(tenantSlug, 'bank_statement'),
  )
  const tenantId = access.tenant.id
  const header = (
    <AdmHeader
      back={{ href: importHref(tenantSlug), label: 'Importar' }}
      title="Subir los movimientos del banco"
      description="Comisiones, impuestos, transferencias y pagos, sin tipearlos. Y de paso ves si tu saldo coincide. Una vez por semana."
    />
  )

  if (!canWrite) {
    return (
      <AdmPage width="comfortable">
        {header}
        <ReadOnlyNotice
          description="Acá se suben los movimientos del banco. Con Contabilidad ves lo que se subió en Importar."
          href={importHref(tenantSlug)}
          linkLabel="Ir a Importar"
        />
      </AdmPage>
    )
  }

  const [catalog, layouts, rules, previous] = await Promise.all([
    catalogOf(tenantId),
    settleQuery(listImportLayouts(tenantId)),
    settleQuery(listImportRules(tenantId, 'bank_statement')),
    settleQuery(listImportBatches(tenantId, { source: 'bank_statement', limit: 100 })),
  ])
  const ajustesHref = `/${tenantSlug}/administracion/ajustes?tab=cajas`
  const batches = previous.ok ? previous.data : []
  const firstTime = batches.filter((b) => b.status !== 'cancelled').length === 0

  if (!catalog.ok) {
    return (
      <AdmPage width="comfortable">
        {header}
        <PanelError title="Tus cuentas" message={catalog.message} />
      </AdmPage>
    )
  }

  const booksStartDate = catalog.data.settings.booksStartDate
  const banks = catalog.data.treasuries
    .filter((t) => t.active && t.kind === 'bank')
    .map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      balanceCents: t.balanceCents,
      active: t.active,
    }))
  const options = {
    parties: catalog.data.parties
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        name: p.name,
        tradeName: p.tradeName,
        taxId: p.taxId,
        active: p.active,
      })),
    accounts: catalog.data.accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      postable: a.postable && !a.isTreasury,
      active: a.active,
      parentId: a.parentId,
    })),
    treasuries: catalog.data.treasuries
      .filter((t) => t.active)
      .map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        balanceCents: t.balanceCents,
        active: t.active,
      })),
  }

  return (
    <AdmPage width="comfortable">
      {header}
      {layouts.ok ? (
        <BankImport
          slug={tenantSlug}
          banks={banks}
          layouts={layouts.data.map((l) => ({
            id: l.id,
            signature: l.signature,
            mapping: l.mapping,
          }))}
          ajustesHref={ajustesHref}
          howTo={<HowToBanco bare />}
          wanted={wantedRange('bank_statement', batches, todayInCordoba(), booksStartDate)}
          firstTime={firstTime}
          booksStartDate={booksStartDate}
        />
      ) : (
        <PanelError title="Subir los movimientos" message={layouts.message} />
      )}
      {/* Sin cuenta del banco y sin nada enseñado, «Lo que ya sé reconocer» era un plegable vacío. */}
      {rules.ok && (banks.length > 0 || rules.data.length > 0) ? (
        <BankRulesCard slug={tenantSlug} rules={rules.data.map(ruleView)} options={options} />
      ) : null}
    </AdmPage>
  )
}
