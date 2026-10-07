import { ArrowLeft, Star } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { PageHeader } from '@/components/ui/page-header'
import { getCustomerById } from '@/lib/customers/queries'
import { listActiveRewards } from '@/lib/points/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { RedeemForm } from './redeem-form'

export const metadata = { title: 'Canjear puntos' }

export default async function CanjearPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner', 'cashier'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const [customer, rewards] = await Promise.all([
    getCustomerById({ tenantId: access.tenant.id, id }),
    listActiveRewards({ tenantId: access.tenant.id }),
  ])
  if (!customer) notFound()

  const c = customer as unknown as {
    id: string
    first_name: string
    last_name: string
    points_balance: number
  }
  const initials = `${c.first_name?.[0] ?? ''}${c.last_name?.[0] ?? ''}`.toUpperCase() || '?'

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/${tenantSlug}/clientes/${id}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Volver a la ficha
      </Link>

      <PageHeader
        eyebrow="Operación"
        title="Canjear puntos"
        description="Tocá la recompensa que el cliente quiere y confirmá el descuento."
      />

      <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-primary/15 blur-3xl"
        />
        <div className="relative flex items-center gap-4">
          <Avatar className="size-12">
            <AvatarFallback className="bg-secondary font-display text-base font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Cliente</p>
            <p className="font-display text-lg font-semibold">
              {c.first_name} {c.last_name}
            </p>
          </div>
          <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-right">
            <p className="flex items-center justify-end gap-1 text-[11px] font-medium uppercase tracking-wider text-primary">
              <Star className="size-3" />
              Balance
            </p>
            <p className="font-display text-2xl font-semibold tabular-nums text-primary">
              {c.points_balance.toLocaleString('es-AR')}
            </p>
          </div>
        </div>
      </div>

      <RedeemForm
        tenantSlug={tenantSlug}
        customerId={c.id}
        balance={c.points_balance}
        rewards={rewards}
      />
    </div>
  )
}
