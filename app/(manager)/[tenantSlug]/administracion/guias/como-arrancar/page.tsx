import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  GlossaryCard,
  PlatformDoesCard,
  StaysManualCard,
} from '@/components/administracion/guias/onboarding/onboarding-extras'
import {
  OnboardingGuide,
  type OnboardingGuideProblem,
} from '@/components/administracion/guias/onboarding/onboarding-guide'
import type { SupplierMessageData } from '@/components/administracion/guias/onboarding/supplier-message'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { supplierRequestMessage, supplierRequestWhy } from '@/lib/accounting/onboarding'
import { getAccountingSettings, settleQuery } from '@/lib/accounting/queries'
import { getOnboarding } from '@/lib/accounting/queries/onboarding'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { RetryButton } from '../../_resumen/retry-button'
import { Callout } from '../../ajustes/_components/form-bits'

export const metadata = { title: 'Cómo arrancar · Administración' }

/**
 * «Cómo arrancar con Administración» (diseño §5.2): qué se carga una sola
 * vez, qué todos los días, todas las semanas y todos los meses, con dónde
 * (link a la pantalla exacta), qué y cómo. Lo que la plataforma puede ver se
 * marca solo (`acc_report_onboarding`); lo que pasa afuera, con «Ya lo hice»
 * (`markOnboardingStep`). Al pie: lo que sigue siendo a mano, lo que la
 * plataforma hace sola y las palabras que se usan.
 *
 * Sin el estado de la base (su parte todavía no está), la guía se ve entera
 * sin marcas. La contadora la ve en modo lectura.
 */
export default async function ComoArrancarPage({
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
      redirect(
        `/login?reason=session&redirectTo=${encodeURIComponent(`${base}/guias/como-arrancar`)}`,
      )
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

  const [onboarding, settings] = await Promise.all([
    settleQuery(getOnboarding(tenantId)),
    settleQuery(getAccountingSettings(tenantId)),
  ])

  const overview = onboarding.ok ? onboarding.data : null
  const problem: OnboardingGuideProblem | null = !onboarding.ok
    ? { kind: 'error', message: onboarding.message }
    : overview === null
      ? { kind: 'unavailable' }
      : null

  const sas = settings.ok ? settings.data : null
  const supplier: SupplierMessageData = !settings.ok
    ? { status: 'error' }
    : sas && sas.legalName.trim() !== ''
      ? {
          status: 'ready',
          message: supplierRequestMessage({
            legalName: sas.legalName,
            cuit: sas.cuit,
            ivaCondition: sas.ivaCondition,
          }),
          why: supplierRequestWhy(sas.ivaCondition),
          missingCuit: !sas.cuit,
        }
      : { status: 'missing' }

  return (
    <PageShell width="comfortable">
      <Link
        href={`${base}/guias`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" aria-hidden="true" />
        Volver a Guías
      </Link>

      <PageHeader
        eyebrow="Administración"
        title={
          <>
            Cómo arrancar con Administración
            <ReadOnlyBadge />
          </>
        }
        description="Qué se carga una sola vez, qué todos los días y qué hace la plataforma sola. Te vamos marcando lo que ya está."
      />

      {canWrite ? null : (
        <Callout tone="info" title="La completan los dueños que cargan">
          Muestra qué falta cargar, dónde y cómo. Vos podés ver cómo van: no hace falta que hagas
          nada acá.
        </Callout>
      )}

      {problem?.kind === 'error' ? (
        <Callout tone="error" title="No pudimos cargar tu avance." action={<RetryButton />}>
          {problem.message} Mientras tanto, la guía se puede seguir igual.
        </Callout>
      ) : null}

      <OnboardingGuide
        slug={tenantSlug}
        data={overview?.data ?? null}
        problem={problem}
        canWrite={canWrite}
        supplier={supplier}
        booksStartDate={sas?.booksStartDate ?? null}
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <StaysManualCard base={base} />
        <PlatformDoesCard />
      </div>

      <GlossaryCard />
    </PageShell>
  )
}
