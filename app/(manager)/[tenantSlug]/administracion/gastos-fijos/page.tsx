import { HandCoins } from 'lucide-react'
import { ActionButton, QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { todayInCordoba } from '@/lib/dates'
import { RecurringTab } from '../compras/_components/recurring-tab'
import { gastosFijosHref } from '../compras/_lib/links'
import { requireComprasAccess } from '../compras/_lib/page-access'

export const metadata = { title: 'Gastos fijos' }

/**
 * Gastos fijos, con pestaña propia en Administración (pedido de los socios,
 * 12/10/2026: hasta entonces era una pestaña de Compras). La lista es la misma
 * (`RecurringTab`); el alta y la edición siguen en
 * `/compras/gastos-fijos/[id]`. La misma puerta que Compras: leen los dueños
 * con acceso y la contadora, y solo quien carga ve los botones.
 */
export default async function GastosFijosPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { access, canWrite } = await requireComprasAccess(tenantSlug, gastosFijosHref(tenantSlug))

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title={
          <>
            Gastos fijos
            <ReadOnlyBadge />
          </>
        }
        description="Alquiler, luz, internet: te avisamos antes de que venzan."
        actions={
          canWrite ? (
            <div className="hidden flex-wrap items-center gap-2 lg:flex">
              <ActionButton action="pagar" variant="outline" className="gap-2">
                <HandCoins className="size-4" aria-hidden />
                Pagar
              </ActionButton>
            </div>
          ) : null
        }
      />

      <RecurringTab
        tenantId={access.tenant.id}
        tenantSlug={tenantSlug}
        today={todayInCordoba()}
        canWrite={canWrite}
      />

      <QuickActionsBar />
    </PageShell>
  )
}
