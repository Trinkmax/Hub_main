import { BlockError } from '@/components/administracion/cajas-ventas/block-error'
import { HowToBanco } from '@/components/administracion/guias/how-to'
import { BankImport } from '@/components/administracion/importar/bank-import'
import {
  BankRulesCard,
  type BankRuleView,
} from '@/components/administracion/importar/bank-rules-card'
import { BackLink } from '@/components/administracion/importar/page-bits'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  AccountingContextError,
  loadPostingCatalog,
  type PostingCatalog,
} from '@/lib/accounting/context'
import { settleQuery } from '@/lib/accounting/queries/shared'
import {
  type ImportRuleRow,
  listImportBatches,
  listImportLayouts,
  listImportRules,
} from '@/lib/imports/server/queries'
import { importHref, importSourceHref } from '@/lib/imports/ui/labels'
import { requireImportAccess } from '../_lib/page-access'

export const metadata = { title: 'Importar el banco · Administración' }

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
 * Paso 1 del banco (diseño §4.3): de qué cuenta es el extracto, el archivo (con
 * «Contanos qué es cada columna» si el formato es nuevo) y las reglas del bar
 * para reconocer movimientos. La contadora ve un aviso con el link al historial.
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
    <>
      <BackLink href={importHref(tenantSlug)} label="Volver a Importar" />
      <PageHeader
        eyebrow="Administración"
        title="Banco"
        description="Subí los movimientos que exportás del home banking: reconocemos comisiones, impuestos, transferencias y pagos. Antes de cargar nada, revisás."
      />
    </>
  )

  if (!canWrite) {
    return (
      <PageShell width="comfortable">
        {header}
        <ReadOnlyNotice
          description="Acá se sube el extracto del banco. Con Contabilidad ves lo que se importó en el historial de Importar."
          href={importHref(tenantSlug)}
          linkLabel="Ir a Importar"
        />
      </PageShell>
    )
  }

  const [catalog, layouts, rules, previous] = await Promise.all([
    catalogOf(tenantId),
    settleQuery(listImportLayouts(tenantId)),
    settleQuery(listImportRules(tenantId, 'bank_statement')),
    settleQuery(listImportBatches(tenantId, { source: 'bank_statement', limit: 1 })),
  ])
  const ajustesHref = `/${tenantSlug}/administracion/ajustes?tab=cajas`
  const firstTime = !previous.ok || previous.data.length === 0

  if (!catalog.ok) {
    return (
      <PageShell width="comfortable">
        {header}
        <BlockError message={catalog.message} />
      </PageShell>
    )
  }

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
    <PageShell width="comfortable">
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-5">
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
            />
          ) : (
            <BlockError message={layouts.message} />
          )}
          {rules.ok ? (
            <BankRulesCard slug={tenantSlug} rules={rules.data.map(ruleView)} options={options} />
          ) : null}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20">
          <HowToBanco defaultOpen={firstTime} />
          <p className="rounded-xl border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground text-pretty">
            <span className="font-medium text-foreground">¿Cada cuánto?</span> Una vez por semana:
            muchos bancos guardan solo los últimos 3 meses. Si se pisan las fechas no pasa nada: lo
            que ya importaste no se repite.
          </p>
        </aside>
      </div>
    </PageShell>
  )
}
