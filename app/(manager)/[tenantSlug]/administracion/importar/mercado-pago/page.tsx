import { BlockError } from '@/components/administracion/cajas-ventas/block-error'
import { HowToMercadoPago } from '@/components/administracion/guias/how-to'
import { ImportUploader } from '@/components/administracion/importar/import-uploader'
import { MpConnectCard } from '@/components/administracion/importar/mp-connect-card'
import {
  MpSettingsCard,
  type MpSettingsView,
} from '@/components/administracion/importar/mp-settings-card'
import { BackLink } from '@/components/administracion/importar/page-bits'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import { getMpImportSettings, listImportBatches } from '@/lib/imports/server/queries'
import { importHref, importSourceHref } from '@/lib/imports/ui/labels'
import { requireImportAccess } from '../_lib/page-access'

export const metadata = { title: 'Importar Mercado Pago · Administración' }

/**
 * Paso 1 de Mercado Pago (diseño §4.2): la configuración de una sola vez
 * (billetera, medio de cada canal y corte del día) y subir el reporte de
 * Liquidaciones. Se lee en el navegador (un reporte de 60 días puede pesar más
 * que lo que acepta el servidor de una vez). La conexión por API llega después.
 */
export default async function ImportarMercadoPagoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { access, canWrite } = await requireImportAccess(
    tenantSlug,
    importSourceHref(tenantSlug, 'mp_release'),
  )
  const tenantId = access.tenant.id
  const header = (
    <>
      <BackLink href={importHref(tenantSlug)} label="Volver a Importar" />
      <PageHeader
        eyebrow="Administración"
        title="Mercado Pago"
        description="Subí el reporte de «Liquidaciones»: separamos cada día lo que cobraste, la comisión, su IVA y los impuestos, y lo juntamos con tu cierre del día."
      />
    </>
  )

  if (!canWrite) {
    return (
      <PageShell width="comfortable">
        {header}
        <ReadOnlyNotice
          description="Acá se sube el reporte de Mercado Pago. Con Contabilidad ves lo que se importó en el historial de Importar."
          href={importHref(tenantSlug)}
          linkLabel="Ir a Importar"
        />
      </PageShell>
    )
  }

  const [mp, settings, treasuries, previous] = await Promise.all([
    settleQuery(getMpImportSettings(tenantId)),
    settleQuery(getAccountingSettings(tenantId)),
    settleQuery(listTreasuryAccounts(tenantId)),
    settleQuery(listImportBatches(tenantId, { source: 'mp_release', limit: 1 })),
  ])
  const ajustesHref = `/${tenantSlug}/administracion/ajustes?tab=cajas`
  const sasCuit = settings.ok ? (settings.data?.cuit ?? null) : null
  // Los CBU/CVU propios solo sirven para leer el reporte en el navegador (nunca se suben).
  const ownCbus = treasuries.ok ? treasuries.data.flatMap((t) => (t.cbuCvu ? [t.cbuCvu] : [])) : []
  const firstTime = !previous.ok || previous.data.length === 0

  const view: MpSettingsView | null = mp.ok
    ? {
        connection: mp.data.connection
          ? {
              treasuryAccountId: mp.data.connection.treasuryAccountId,
              channelMethods: mp.data.connection.channelMethods,
              dayCutoffHour: mp.data.connection.dayCutoffHour,
              updatedAt: mp.data.connection.updatedAt,
            }
          : null,
        effective: mp.data.effective
          ? {
              treasuryId: mp.data.effective.treasuryId,
              partyId: mp.data.effective.partyId,
              channelMethods: mp.data.effective.channelMethods,
              inferred: mp.data.effective.inferred,
            }
          : null,
        wallets: mp.data.wallets,
        methods: mp.data.methods,
        ownAccounts: mp.data.ownAccounts,
      }
    : null

  return (
    <PageShell width="comfortable">
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {!mp.ok ? (
            <BlockError message={mp.message} />
          ) : view ? (
            <MpSettingsCard slug={tenantSlug} settings={view} ajustesHref={ajustesHref} />
          ) : null}
          {view ? (
            <ImportUploader
              slug={tenantSlug}
              context={{
                source: 'mp_release',
                sasCuit,
                ownCbus,
                cutoffHour: view.connection?.dayCutoffHour ?? 0,
              }}
              blockedReason={
                view.effective
                  ? null
                  : 'Antes de subir el reporte, completá arriba cuál es tu cuenta de Mercado Pago y guardá.'
              }
            />
          ) : null}
          <MpConnectCard />
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20">
          <HowToMercadoPago defaultOpen={firstTime} />
          <p className="rounded-xl border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground text-pretty">
            <span className="font-medium text-foreground">¿Cada cuánto?</span> Una vez por semana
            está bien (el reporte deja bajar hasta 60 días). Si se pisan las fechas no pasa nada: lo
            que ya importaste no se repite.
          </p>
        </aside>
      </div>
    </PageShell>
  )
}
