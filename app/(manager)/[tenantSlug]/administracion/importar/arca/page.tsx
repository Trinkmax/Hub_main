import Link from 'next/link'
import { HowToMisComprobantes } from '@/components/administracion/guias/how-to'
import { ImportUploader } from '@/components/administracion/importar/import-uploader'
import { BackLink } from '@/components/administracion/importar/page-bits'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { listImportBatches } from '@/lib/imports/server/queries'
import { importHref, importSourceHref } from '@/lib/imports/ui/labels'
import { requireImportAccess } from '../_lib/page-access'

export const metadata = { title: 'Importar compras de ARCA · Administración' }

/**
 * Paso 1 de «Mis Comprobantes» (diseño §4.1): soltar el archivo de Recibidos,
 * ver qué trae y subirlo. Se lee en el navegador; nada se carga en los libros
 * hasta la revisión. La contadora ve un aviso con el link al historial.
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
    <>
      <BackLink href={importHref(tenantSlug)} label="Volver a Importar" />
      <PageHeader
        eyebrow="Administración"
        title="Compras desde ARCA"
        description="Soltá el archivo de «Mis Comprobantes › Recibidos» que bajaste de ARCA (la ex AFIP). Armamos las compras y los proveedores nuevos; antes de cargar nada, revisás."
      />
    </>
  )

  if (!canWrite) {
    return (
      <PageShell width="comfortable">
        {header}
        <ReadOnlyNotice
          description="Acá se suben los archivos de ARCA. Con Contabilidad ves lo que se importó en el historial de Importar."
          href={importHref(tenantSlug)}
          linkLabel="Ir a Importar"
        />
      </PageShell>
    )
  }

  const [settings, previous] = await Promise.all([
    settleQuery(getAccountingSettings(tenantId)),
    settleQuery(listImportBatches(tenantId, { source: 'arca_recibidos', limit: 1 })),
  ])
  const sasCuit = settings.ok ? (settings.data?.cuit ?? null) : null
  const firstTime = !previous.ok || previous.data.length === 0

  return (
    <PageShell width="comfortable">
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {settings.ok && !sasCuit ? (
            <p className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning-text text-pretty">
              Cargá la CUIT de la SAS en{' '}
              <Link
                href={`/${tenantSlug}/administracion/ajustes?tab=sas`}
                className="font-medium underline underline-offset-2"
              >
                Ajustes › Datos de la SAS
              </Link>
              : así chequeamos que el archivo sea de tu SAS y no de otra CUIT.
            </p>
          ) : null}
          <ImportUploader slug={tenantSlug} context={{ source: 'arca_recibidos', sasCuit }} />
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20">
          <HowToMisComprobantes defaultOpen={firstTime} />
          <p className="rounded-xl border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground text-pretty">
            <span className="font-medium text-foreground">¿Cada cuánto?</span> Una vez por mes, del
            día 11 en adelante: bajá del 1 del mes anterior a hoy. Si se pisan las fechas no pasa
            nada: lo que ya importaste no se repite.
          </p>
        </aside>
      </div>
    </PageShell>
  )
}
