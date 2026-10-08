import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArcaGuideCard,
  DownloadGuides,
  OnboardingGuideCard,
} from '@/components/administracion/guias/onboarding/guides-index'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { settleQuery } from '@/lib/accounting/queries'
import { getOnboarding } from '@/lib/accounting/queries/onboarding'
import { getArcaOverview } from '@/lib/arca/queries'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { RetryButton } from '../_resumen/retry-button'

export const metadata = { title: 'Guías · Administración' }

/**
 * Guías de Administración (diseño §5.2.1): «Cómo arrancar» y «Conectar ARCA»
 * con su avance, y las mini guías para bajar los tres archivos que carga la
 * plataforma (Mis Comprobantes, Mercado Pago y el banco). La contadora la ve
 * entera, sin los botones de importar.
 *
 * Cada lectura va por su lado (`settleQuery`): si una falla o su parte de la
 * base todavía no está, esa tarjeta lo dice y la página se ve igual.
 */
export default async function GuiasPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params
  const base = `/${tenantSlug}/administracion`

  let access: TenantAccess
  try {
    access = await requireAccountingAccess(tenantSlug, 'read')
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(`${base}/guias`)}`)
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
  const canWrite = access.role === 'owner' && access.accounting.write

  const [onboarding, arca] = await Promise.all([
    settleQuery(getOnboarding(tenantId)),
    settleQuery(getArcaOverview(tenantId)),
  ])

  return (
    <PageShell>
      <Link
        href={base}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" aria-hidden="true" />
        Volver al Resumen
      </Link>

      <PageHeader
        eyebrow="Administración"
        title={
          <>
            Guías
            <ReadOnlyBadge />
          </>
        }
        description="Paso a paso, con dónde, qué y cómo: para dejar Administración andando y para que la plataforma cargue sola casi todo."
      />

      <section aria-label="Guías paso a paso" className="grid gap-4 md:grid-cols-2">
        <OnboardingGuideCard
          href={`${base}/guias/como-arrancar`}
          outcome={onboarding}
          canWrite={canWrite}
          retry={<RetryButton />}
        />
        <ArcaGuideCard
          href={`${base}/ajustes/arca`}
          outcome={arca}
          canWrite={canWrite}
          retry={<RetryButton />}
        />
      </section>

      <DownloadGuides base={base} canWrite={canWrite} />
    </PageShell>
  )
}
