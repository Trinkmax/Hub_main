import { notFound, redirect } from 'next/navigation'
import {
  GlossaryLink,
  PlatformDoesCard,
  StaysManualCard,
} from '@/components/administracion/guias/onboarding/onboarding-extras'
import {
  OnboardingGuide,
  type OnboardingGuideProblem,
} from '@/components/administracion/guias/onboarding/onboarding-guide'
import type { SupplierMessageData } from '@/components/administracion/guias/onboarding/supplier-message'
import { SimplePage } from '@/components/administracion/planilla'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
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

export const metadata = { title: 'Puesta en marcha · Administración' }

/**
 * La Puesta en marcha (`/guias/como-arrancar`): la barra de avance y una planilla Estado · Paso ·
 * [Ir] con lo de una sola vez; abajo, igual, lo de todos los días, semanas y meses. Cada paso abre
 * su detalle: dónde, qué y cómo. Lo que la plataforma puede ver se marca solo
 * (`acc_report_onboarding`); lo demás, con «Ya lo hice» (`markOnboardingStep`). Al pie, plegado: lo
 * que sigue siendo a mano y lo que la plataforma hace sola, y el link al glosario de la guía.
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
    <SimplePage width="narrow">
      <h1 className="sr-only">Puesta en marcha</h1>
      <ReadOnlyBadge className="w-fit" />

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

      <StaysManualCard base={base} />
      <PlatformDoesCard />

      <GlossaryLink base={base} />
    </SimplePage>
  )
}
