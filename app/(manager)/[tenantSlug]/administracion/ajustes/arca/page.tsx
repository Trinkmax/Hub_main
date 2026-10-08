import { ArrowLeft, PartyPopper, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  arcaMockData,
  certificateNote,
  guideStatusText,
  nextStepLine,
  stepAnchor,
  suggestArcaAlias,
} from '@/components/administracion/guias/arca-guide-model'
import { MockDataProvider } from '@/components/administracion/guias/arca-mock/mock-data'
import type { GuideRailItem } from '@/components/administracion/guias/guide-rail'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { getAccountingSettings, listSalesPoints, settleQuery } from '@/lib/accounting/queries'
import { ARCA_GUIDE_STEPS, type ArcaGuideStepId } from '@/lib/arca/guide'
import { getArcaOverview, guideView } from '@/lib/arca/queries'
import type { ArcaGuideStepView } from '@/lib/arca/views'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { RetryButton } from '../../_resumen/retry-button'
import { Callout } from '../_components/form-bits'
import { ArcaGuideShell } from './_components/arca-guide-shell'
import {
  DeveloperNote,
  OfficialLinks,
  RenewSection,
  TroublesSection,
} from './_components/guide-footer'
import { Glossary, GoldenRules, GuideBefore } from './_components/guide-intro'
import { GuideSteps } from './_components/guide-steps'

export const metadata = { title: 'Conectar ARCA · Administración' }

/**
 * La guía «Conectar ARCA» (diseño §5.1): once pasos con las pantallas de ARCA dibujadas, lo que
 * hay que tocar y, donde la plataforma tiene algo que hacer, la acción ahí mismo (punto de
 * venta, Factura A, pedido, certificado y prueba). Cada paso se marca solo cuando la plataforma
 * lo puede ver, o con «Ya lo hice» cuando pasa solo en ARCA.
 *
 * Si las tablas de ARCA todavía no existen (migraciones sin aplicar) o la lectura falla, la guía
 * igual se ve entera, con el aviso «No pudimos cargar cómo va tu conexión» y «Reintentar». La
 * contadora la ve en modo lectura: sin acciones.
 */
export default async function ConectarArcaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const base = `/${tenantSlug}/administracion`

  let access: TenantAccess
  try {
    access = await requireAccountingAccess(tenantSlug, 'read')
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(`${base}/ajustes/arca`)}`)
    }
    if (
      error instanceof AccountingDisabledError ||
      error instanceof AccountingForbiddenError ||
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError
    ) {
      notFound()
    }
    throw error
  }

  const tenantId = access.tenant.id
  const canWrite = access.accounting.write
  const now = new Date()

  const [overviewResult, pointsResult] = await Promise.all([
    settleQuery(getArcaOverview(tenantId, { now })),
    settleQuery(listSalesPoints(tenantId)),
  ])
  const overview = overviewResult.ok ? overviewResult.data : null
  let sas = overview?.sas ?? null
  if (!sas) {
    // Sin las tablas de ARCA: la razón social y la CUIT salen igual de Datos de la SAS.
    const settings = await settleQuery(getAccountingSettings(tenantId))
    sas =
      settings.ok && settings.data
        ? { legalName: settings.data.legalName, cuit: settings.data.cuit }
        : { legalName: null, cuit: null }
  }

  const connection = overview?.connections.produccion ?? null
  const guide = overview?.guide.produccion ?? guideView(null, sas, [], now)
  const states = Object.fromEntries(guide.steps.map((s) => [s.id, s])) as Record<
    ArcaGuideStepId,
    ArcaGuideStepView
  >
  const items: GuideRailItem[] = ARCA_GUIDE_STEPS.map((step) => {
    const state = states[step.id]
    return {
      id: step.id,
      anchor: stepAnchor(step.n),
      n: step.n,
      title: step.title,
      status: state.status,
      statusText: guideStatusText(state.status, step.optional),
      optional: step.optional,
    }
  })
  const next = nextStepLine(guide.summary, guide.steps)
  const connected = connection?.status === 'connected'
  const headline = next
    ? `${next.prefix}: ${next.step.n}. ${next.step.title}`
    : connected
      ? '¡Listo! ARCA quedó conectado.'
      : 'Revisá los pasos que faltan.'

  const suggestedAlias = suggestArcaAlias(tenantSlug, 'produccion')
  const alias = connection?.hasCsr && connection.alias ? connection.alias : suggestedAlias
  const mockData = arcaMockData({
    legalName: sas.legalName,
    cuit: sas.cuit,
    alias,
    pointOfSale: connection?.pointOfSale ?? null,
  })
  const salesPoints = pointsResult.ok
    ? pointsResult.data.map((p) => ({ number: p.number, label: p.label }))
    : []
  const cert = certificateNote(connection?.certificate ?? null)

  return (
    <PageShell width="comfortable">
      <Link
        href={`${base}/ajustes?tab=arca`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" aria-hidden />
        Volver a Ajustes
      </Link>
      <PageHeader
        eyebrow="Administración"
        title={
          <>
            Conectar ARCA
            <ReadOnlyBadge />
          </>
        }
        description="Unos 40 minutos. Lo hace quien maneja la clave fiscal de la SAS. Vamos marcando cada paso solos."
      />

      {!overviewResult.ok ? (
        <Callout
          tone="error"
          title="No pudimos cargar cómo va tu conexión."
          action={<RetryButton />}
        >
          {overviewResult.message} Mientras tanto, podés leer la guía entera.
        </Callout>
      ) : null}

      {!canWrite ? (
        <Callout tone="info" title="Estás viendo la guía en modo lectura">
          Los pasos los hace un dueño con acceso de carga. Acá ves en qué paso está cada uno.
        </Callout>
      ) : null}

      {connected ? (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
          <PartyPopper className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="font-serif text-lg font-semibold tracking-tight text-success">
              ¡Listo! ARCA quedó conectado.
            </p>
            <p className="text-sm text-muted-foreground text-pretty">
              Ya podés completar proveedores con la CUIT y, cuando quieras, prender la emisión de
              facturas en{' '}
              <Link
                href={`${base}/ajustes?tab=arca`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Ajustes › ARCA
              </Link>
              .
            </p>
          </div>
        </div>
      ) : null}

      {cert && cert.tone !== 'ok' ? (
        <Callout
          tone={cert.tone === 'error' ? 'error' : 'warning'}
          title={cert.tone === 'error' ? 'El certificado venció' : 'El certificado vence pronto'}
          action={
            <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
              <a href="#renovar">
                <RefreshCw className="size-4" aria-hidden />
                Cómo se renueva
              </a>
            </Button>
          }
        >
          {cert.text}
        </Callout>
      ) : null}

      <GuideBefore base={base} sasCuit={sas.cuit} />
      {/* Las mini maquetas de las reglas también muestran la razón social y la CUIT del bar. */}
      <MockDataProvider value={mockData}>
        <GoldenRules sasName={mockData.sasName} />
      </MockDataProvider>
      <Glossary />

      <ArcaGuideShell
        items={items}
        summary={guide.summary}
        currentId={guide.summary.next}
        headline={headline}
        initialOpen={guide.summary.next ? [guide.summary.next] : []}
        mockData={mockData}
      >
        <GuideSteps
          data={{
            slug: tenantSlug,
            base,
            canWrite,
            states,
            connection,
            sasName: sas.legalName,
            sasCuit: sas.cuit,
            suggestedAlias,
            salesPoints,
          }}
        />
        <RenewSection slug={tenantSlug} connection={connection} canWrite={canWrite} />
        <TroublesSection />
        <DeveloperNote base={base} />
        <OfficialLinks />
      </ArcaGuideShell>
    </PageShell>
  )
}
