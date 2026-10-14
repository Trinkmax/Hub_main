import Link from 'next/link'
import { IIBB_JURISDICTIONS } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/jurisdictions'
import { HowToMisComprobantes } from '@/components/administracion/guias/how-to'
import {
  ArcaRulesCard,
  type ArcaRuleView,
} from '@/components/administracion/importar/bank-rules-card'
import { ImportUploader } from '@/components/administracion/importar/import-uploader'
import { AdmHeader, AdmPage } from '@/components/administracion/kit'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { todayInCordoba } from '@/lib/dates'
import {
  type ImportRuleRow,
  listImportBatches,
  listImportRules,
} from '@/lib/imports/server/queries'
import { wantedRange } from '@/lib/imports/ui/inbox'
import { importHref, importSourceHref } from '@/lib/imports/ui/labels'
import { requireImportAccess } from '../_lib/page-access'

export const metadata = { title: 'Subir las compras de ARCA · Administración' }

/** Lo que hace algo enseñado sobre «otros impuestos», en palabras. */
function ruleDoes(action: ImportRuleRow['action']): string {
  switch (action.other_taxes_as) {
    case 'perc_iibb': {
      const province = IIBB_JURISDICTIONS.find((j) => j.code === action.jurisdiction_code)?.name
      return province ? `son Ingresos Brutos de ${province}` : 'son Ingresos Brutos'
    }
    case 'perc_iva':
      return 'son IVA'
    case 'internal':
      return 'son impuestos internos'
    case 'account':
      return 'van a una categoría que elegiste'
    default:
      return 'se arman como me enseñaste'
  }
}

/**
 * «Subir las compras de ARCA»: los tres pasos (bajalo de ARCA, con las fechas
 * que hay que pedir y el paso a paso del portal → subilo acá → revisá y cargá).
 * El archivo se lee en el navegador; nada se carga hasta la revisión. Al pie,
 * lo que el bar ya le enseñó sobre «otros impuestos». La contadora ve un aviso
 * con la vuelta a Importar.
 */
export default async function ImportarArcaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { access, canWrite } = await requireImportAccess(
    tenantSlug,
    importSourceHref(tenantSlug, 'arca_recibidos'),
  )
  const tenantId = access.tenant.id
  const header = (
    <AdmHeader
      back={{ href: importHref(tenantSlug), label: 'Importar' }}
      title="Subir las compras de ARCA"
      description="Las facturas que te hicieron tus proveedores, sin tipear ninguna. Unos 5 minutos, una vez por mes."
    />
  )

  if (!canWrite) {
    return (
      <AdmPage width="comfortable">
        {header}
        <ReadOnlyNotice
          description="Acá se suben los archivos de ARCA. Con Contabilidad ves lo que se subió en Importar."
          href={importHref(tenantSlug)}
          linkLabel="Ir a Importar"
        />
      </AdmPage>
    )
  }

  const [settings, previous, rules] = await Promise.all([
    settleQuery(getAccountingSettings(tenantId)),
    settleQuery(listImportBatches(tenantId, { source: 'arca_recibidos', limit: 100 })),
    settleQuery(listImportRules(tenantId, 'arca_recibidos')),
  ])
  const sasCuit = settings.ok ? (settings.data?.cuit ?? null) : null
  const booksStartDate = settings.ok ? (settings.data?.booksStartDate ?? null) : null
  const batches = previous.ok ? previous.data : []
  const firstTime = batches.filter((b) => b.status !== 'cancelled').length === 0
  const learned: ArcaRuleView[] = rules.ok
    ? rules.data.map((r) => ({
        id: r.id,
        label: r.label,
        does: ruleDoes(r.action),
        active: r.active,
      }))
    : []

  return (
    <AdmPage width="comfortable">
      {header}
      <ImportUploader
        slug={tenantSlug}
        context={{ source: 'arca_recibidos', sasCuit }}
        howTo={<HowToMisComprobantes bare />}
        wanted={wantedRange('arca_recibidos', batches, todayInCordoba(), booksStartDate)}
        firstTime={firstTime}
        booksStartDate={booksStartDate}
        notice={
          settings.ok && !sasCuit ? (
            <p className="rounded-xl bg-secondary/50 px-3.5 py-2.5 text-sm text-pretty">
              Sin el CUIT del bar no puedo chequear que el archivo sea tuyo.{' '}
              <Link
                href={`/${tenantSlug}/administracion/ajustes?tab=sas`}
                className="rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cargar el CUIT
              </Link>
            </p>
          ) : null
        }
      />
      <ArcaRulesCard slug={tenantSlug} rules={learned} />
    </AdmPage>
  )
}
