import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { todayInCordoba } from '@/lib/salon/date-presets'
import type { DepositBasis } from '@/lib/salon/deposits'
import { getDepositsBounds, getDepositsByDay } from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { DepositsDashboard } from './_components/deposits-dashboard'

export const metadata = { title: 'Señas · Ingresos por día' }
export const dynamic = 'force-dynamic'

// Mes real, no solo cuatro dígitos y dos dígitos: `2026-13` y `0000-01` pasarían
// un `\d{4}-\d{2}` y llegarían a Postgres como una fecha inexistente (22008), que
// tira la pantalla entera en vez de caer al mes actual.
const YM_RE = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/

/**
 * Mes calendario completo. Arranca del día de HOY EN CÓRDOBA, no del `new Date()`
 * del server: entre las 21:00 y las 00:00 el runtime en UTC ya está en el día
 * siguiente y el primer día de mes abriría el mes que viene.
 */
function monthRange(monthStr: string): { from: string; to: string } {
  const [y, m] = monthStr.split('-').map(Number)
  const year = y ?? 1970
  const month = m ?? 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const mm = String(month).padStart(2, '0')
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

export default async function SenasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    // Explícito: la RLS de `salon_reservations` deja leer a cualquier miembro
    // del tenant (mozo y cocina incluidos). Acá se ve plata: solo el dueño.
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  // Cualquier valor raro cae al default, sin romper la pantalla.
  const basis: DepositBasis = sp.fecha === 'carga' ? 'created' : 'reservation'
  const currentYM =
    typeof sp.month === 'string' && YM_RE.test(sp.month) ? sp.month : todayInCordoba().slice(0, 7)
  const wantsAll = sp.periodo === 'todo'

  // "Todo el histórico" pregunta primero hasta dónde llegan los datos. Si el bar
  // todavía no cargó una reserva, se cae al mes actual y la pantalla muestra su
  // estado vacío en vez de un rango inventado.
  const bounds = wantsAll ? await getDepositsBounds({ tenantId: access.tenant.id, basis }) : null
  const period: 'mes' | 'todo' = bounds ? 'todo' : 'mes'
  const range = bounds ?? monthRange(currentYM)

  const report = await getDepositsByDay({
    tenantId: access.tenant.id,
    basis,
    from: range.from,
    to: range.to,
  })

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/estadisticas`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Estadísticas
          </Link>
        }
        title="Señas"
        description="La plata que entra por señas, día por día. Cuenta todas las reservas: las que están en pie y las que se cayeron."
      />
      <DepositsDashboard
        tenantSlug={tenantSlug}
        report={report}
        currentYM={currentYM}
        period={period}
      />
    </PageShell>
  )
}
