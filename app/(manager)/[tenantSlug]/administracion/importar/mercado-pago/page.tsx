import Link from 'next/link'
import { HowToMercadoPago } from '@/components/administracion/guias/how-to'
import { ImportUploader } from '@/components/administracion/importar/import-uploader'
import { MpConnectCard } from '@/components/administracion/importar/mp-connect-card'
import {
  MpSettingsCard,
  type MpSettingsView,
} from '@/components/administracion/importar/mp-settings-card'
import { AdmHeader, AdmPage, PanelError } from '@/components/administracion/kit'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import { todayInCordoba } from '@/lib/dates'
import { getMpImportSettings, listImportBatches } from '@/lib/imports/server/queries'
import { wantedRange } from '@/lib/imports/ui/inbox'
import { importHref, importSourceHref } from '@/lib/imports/ui/labels'
import { requireImportAccess } from '../_lib/page-access'

export const metadata = { title: 'Subir el reporte de Mercado Pago · Administración' }

/**
 * «Subir el reporte de Mercado Pago»: arriba, lo que se contesta una sola vez
 * (la cuenta, cómo se llama cada cobro en el cierre y de qué día es lo de
 * después de medianoche); después los tres pasos. El reporte se lee en el
 * navegador (uno de 60 días puede pesar más de lo que acepta el servidor de una
 * vez) y con lo GUARDADO en «Antes de empezar». La conexión directa llega
 * después.
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
    <AdmHeader
      back={{ href: importHref(tenantSlug), label: 'Importar' }}
      title="Subir el reporte de Mercado Pago"
      description="Lo que cobraste, lo que se quedó Mercado Pago y lo que te depositó, día por día. Una vez por semana."
    />
  )

  if (!canWrite) {
    return (
      <AdmPage width="comfortable">
        {header}
        <ReadOnlyNotice
          description="Acá se sube el reporte de Mercado Pago. Con Contabilidad ves lo que se subió en Importar."
          href={importHref(tenantSlug)}
          linkLabel="Ir a Importar"
        />
      </AdmPage>
    )
  }

  const [mp, settings, treasuries, previous] = await Promise.all([
    settleQuery(getMpImportSettings(tenantId)),
    settleQuery(getAccountingSettings(tenantId)),
    settleQuery(listTreasuryAccounts(tenantId)),
    settleQuery(listImportBatches(tenantId, { source: 'mp_release', limit: 100 })),
  ])
  const base = `/${tenantSlug}/administracion`
  const ajustesHref = `${base}/ajustes?tab=cajas`
  const sasCuit = settings.ok ? (settings.data?.cuit ?? null) : null
  const booksStartDate = settings.ok ? (settings.data?.booksStartDate ?? null) : null
  // Los CBU/CVU propios solo sirven para leer el reporte en el navegador (nunca se suben).
  const ownCbus = treasuries.ok ? treasuries.data.flatMap((t) => (t.cbuCvu ? [t.cbuCvu] : [])) : []
  const batches = previous.ok ? previous.data : []
  const firstTime = batches.filter((b) => b.status !== 'cancelled').length === 0

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
    <AdmPage width="comfortable">
      {header}
      {!mp.ok ? <PanelError title="Antes de empezar, una sola vez" message={mp.message} /> : null}
      {view ? (
        <>
          <MpSettingsCard slug={tenantSlug} settings={view} ajustesHref={ajustesHref} />
          <ImportUploader
            slug={tenantSlug}
            context={{
              source: 'mp_release',
              sasCuit,
              ownCbus,
              cutoffHour: view.connection?.dayCutoffHour ?? 0,
            }}
            blockedReason={
              view.effective ? null : 'Primero contame cuál es tu cuenta de Mercado Pago (arriba).'
            }
            howTo={<HowToMercadoPago bare />}
            wanted={wantedRange('mp_release', batches, todayInCordoba(), booksStartDate)}
            firstTime={firstTime}
            booksStartDate={booksStartDate}
            stepOneExtra={
              <p className="rounded-xl bg-secondary/50 px-3.5 py-2.5 text-sm text-pretty">
                Con este mismo archivo podés completar el cierre de cada día: en{' '}
                <Link
                  href={`${base}/ventas/cierre`}
                  className="rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Cierre del día
                </Link>{' '}
                tocá «Completar con el reporte de Mercado Pago».
              </p>
            }
          />
        </>
      ) : null}
      <MpConnectCard />
    </AdmPage>
  )
}
