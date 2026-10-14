import { notFound, redirect } from 'next/navigation'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { buildPostingContext, loadPostingCatalog } from '@/lib/accounting/context'
import { buildSetup } from '@/lib/accounting/home'
import { ONBOARDING_HAVE_AT_HAND } from '@/lib/accounting/onboarding'
import { getAccountingSettings, settleQuery } from '@/lib/accounting/queries'
import { getOnboarding } from '@/lib/accounting/queries/onboarding'
import { formatIsoDay, todayInCordoba } from '@/lib/dates'
import { listManagers } from '@/lib/salon/queries'
import {
  ACCOUNTING_READ_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { OpeningStep } from './_components/opening-step'
import { SetupDone } from './_components/setup-done'
import { SetupRail } from './_components/setup-rail'
import { SetupWizard } from './_components/setup-wizard'
import { configSteps, doneNextSteps } from './_lib/setup-next'
import { OPENING_RAIL_STEP, welcomeChecklist } from './_lib/wizard-steps'

export const metadata = { title: 'Puesta en marcha · Administración' }

/** «franco.perez@…» → «Franco.perez»: lo último que queda si no hay nombre. */
function nameFromEmail(email: string | null): string {
  const local = (email ?? '').split('@')[0]?.trim() ?? ''
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : ''
}

/** El nombre de la persona en el bar (el de Reservas), o el de su email. */
async function defaultDisplayName(access: TenantAccess): Promise<string> {
  try {
    const managers = await listManagers({ tenantId: access.tenant.id, onlyActive: false })
    const mine = managers.find((m) => m.user_id === access.user.id)
    if (mine?.display_name.trim()) return mine.display_name.trim().slice(0, 80)
  } catch (error) {
    console.error(
      '[administracion.configurar] nombre por defecto',
      error instanceof Error ? error.name : 'desconocido',
    )
  }
  return nameFromEmail(access.user.email).slice(0, 80)
}

/**
 * La puesta en marcha (H.3). Las tres ramas de siempre, con el mismo riel de
 * seis pasos: antes de configurar, el asistente (pasos 1 a 5), solo para el
 * dueño que puede hacerla; ya configurada y con los saldos iniciales
 * pendientes, el paso 6; y ya resuelto, «Listo». No hay parámetros de URL:
 * todo link a `/configurar` cae en lo que toca. Ninguna página confía solo en
 * el layout: acá se vuelve a mirar el acceso.
 */
export default async function ConfigurarPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const base = `/${tenantSlug}/administracion`

  let access: TenantAccess
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ACCOUNTING_READ_ROLES)
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(`${base}/configurar`)}`)
    }
    if (error instanceof RoleRequiredError || error instanceof TenantNotFoundError) notFound()
    throw error
  }

  const acc = access.accounting
  if (!acc.enabled) notFound()
  const today = todayInCordoba()

  // ─── Todavía sin configurar: el asistente ──────────────────────────────────
  if (!acc.setUp) {
    if (access.role !== 'owner' || !acc.canSetUp) notFound()
    return (
      <AdmPage width="comfortable">
        <AdmHeader title="Puesta en marcha" description="La armás una vez, en unos 15 minutos." />
        <SetupWizard
          tenantSlug={tenantSlug}
          today={today}
          tenantName={access.tenant.name}
          defaultDisplayName={await defaultDisplayName(access)}
          haveAtHand={welcomeChecklist(ONBOARDING_HAVE_AT_HAND)}
        />
      </AdmPage>
    )
  }

  // ─── Configurada ───────────────────────────────────────────────────────────
  if (!acc.read) notFound()
  const back = { href: base, label: 'Resumen' }

  if (!acc.write) {
    return (
      <AdmPage width="compact">
        <AdmHeader title="Puesta en marcha" back={back} />
        <ReadOnlyNotice
          description="La puesta en marcha y los saldos iniciales los cargan los dueños. Con Contabilidad ves todo en el Resumen y en los libros."
          href={base}
          linkLabel="Ir al Resumen"
        />
      </AdmPage>
    )
  }

  const settings = await getAccountingSettings(access.tenant.id)
  if (!settings) notFound()

  // ─── Listo ─────────────────────────────────────────────────────────────────
  if (settings.openingStatus !== 'pending') {
    // Lo próximo sale de la guía «Cómo arrancar»; si no carga, ese bloque no va.
    const onboarding = await settleQuery(getOnboarding(access.tenant.id))
    const strip =
      onboarding.ok && onboarding.data
        ? buildSetup({ summary: null, settings, onboarding: onboarding.data, canWrite: true, base })
        : null
    return (
      <AdmPage width="compact">
        <AdmHeader title="Puesta en marcha" back={back} />
        <SetupDone
          tenantSlug={tenantSlug}
          next={strip ? doneNextSteps(configSteps(strip)) : []}
          guideHref={strip?.guideHref}
        />
      </AdmPage>
    )
  }

  // ─── Paso 6: saldos iniciales ──────────────────────────────────────────────
  const catalog = await loadPostingCatalog(access.tenant.id)
  const ctx = buildPostingContext(catalog)
  const treasuries = catalog.treasuries
    .filter((t) => t.active)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'))
    .map((t) => ({ id: t.id, name: t.name, kind: t.kind }))
  const accounts = catalog.accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    postable: a.postable,
    active: a.active,
    description: a.description,
  }))
  const otherAccountIds = catalog.accounts
    .filter(
      (a) =>
        a.postable &&
        a.active &&
        a.manualSelectable &&
        !a.requiresParty &&
        !a.isTreasury &&
        a.systemKey !== 'opening_equity' &&
        a.systemKey !== 'share_capital',
    )
    .map((a) => a.id)

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        title="Saldos iniciales"
        description={`Lo que había en cada caja y lo que se debía al empezar el ${formatIsoDay(settings.booksStartDate)}. Se carga una sola vez.`}
        back={back}
      />
      <SetupRail current={OPENING_RAIL_STEP} orientation="horizontal" className="max-w-md" />
      <OpeningStep
        tenantSlug={tenantSlug}
        booksStartDate={settings.booksStartDate}
        treasuries={treasuries}
        ctx={ctx}
        accounts={accounts}
        otherAccountIds={otherAccountIds}
        loadedSinceStart={settings.hasDocuments}
      />
    </AdmPage>
  )
}
