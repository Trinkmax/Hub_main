import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { buildPostingContext, loadPostingCatalog } from '@/lib/accounting/context'
import { getAccountingSettings } from '@/lib/accounting/queries'
import { formatIsoDay, monthName, todayInCordoba } from '@/lib/dates'
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
import { SetupWizard } from './_components/setup-wizard'

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
 * La puesta en marcha (H.3). Antes de configurar: el asistente (pasos 0–2),
 * solo para el dueño que puede hacerla. Después: los saldos iniciales (paso 3)
 * mientras falten y, ya resuelto, «Listo» (paso 4). Ninguna página confía solo
 * en el layout: acá se vuelve a mirar el acceso.
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
      <PageShell width="compact">
        <PageHeader
          eyebrow="Administración"
          title="Administración de la SAS"
          description="La configurás una vez, en unos minutos."
        />
        <SetupWizard
          tenantSlug={tenantSlug}
          today={today}
          tenantName={access.tenant.name}
          defaultDisplayName={await defaultDisplayName(access)}
        />
      </PageShell>
    )
  }

  // ─── Configurada ───────────────────────────────────────────────────────────
  if (!acc.read) notFound()

  const back = (
    <Link
      href={base}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3" aria-hidden />
      Volver al Resumen
    </Link>
  )

  if (!acc.write) {
    return (
      <PageShell width="compact">
        {back}
        <PageHeader eyebrow="Administración" title="Puesta en marcha" />
        <ReadOnlyNotice
          description="La puesta en marcha y los saldos iniciales los cargan los dueños. Con Contabilidad ves todo en el Resumen y en los libros."
          href={base}
          linkLabel="Ir al Resumen"
        />
      </PageShell>
    )
  }

  const settings = await getAccountingSettings(access.tenant.id)
  if (!settings) notFound()

  if (settings.openingStatus !== 'pending') {
    return (
      <PageShell width="compact">
        {back}
        <PageHeader eyebrow="Administración" title="Puesta en marcha" />
        <SetupDone tenantSlug={tenantSlug} />
      </PageShell>
    )
  }

  // ─── Paso 3: saldos iniciales ──────────────────────────────────────────────
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
  const startMonth = monthName(Number(settings.booksStartDate.slice(5, 7)))

  return (
    <PageShell width="compact">
      {back}
      <PageHeader
        eyebrow="Administración"
        title={`Saldos al ${formatIsoDay(settings.booksStartDate)}`}
        description="Lo que había el primer día de los libros: así las cajas y las cuentas arrancan con los números reales."
      />
      <OpeningStep
        tenantSlug={tenantSlug}
        booksStartDate={settings.booksStartDate}
        firstMonthName={startMonth}
        treasuries={treasuries}
        ctx={ctx}
        accounts={accounts}
        otherAccountIds={otherAccountIds}
      />
    </PageShell>
  )
}
