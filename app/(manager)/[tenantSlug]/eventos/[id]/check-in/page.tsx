import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { getEvent, listReservations } from '@/lib/events/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { CheckInBoard } from './check-in-board'

export const metadata = { title: 'Check-in' }

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner', 'cashier', 'waiter'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const detail = await getEvent({ tenantId: access.tenant.id, id })
  if (!detail) notFound()
  const reservations = await listReservations({ tenantId: access.tenant.id, eventId: id })
  const eligible = reservations.filter((r) => r.status === 'confirmed' || r.status === 'checked_in')
  const checkedIn = eligible.filter((r) => r.status === 'checked_in').length

  return (
    <div className="bg-app-gradient min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Modo check-in
            </p>
            <h1 className="truncate font-display text-lg font-semibold">{detail.event.name}</h1>
            <p className="text-xs text-muted-foreground tabular-nums">
              {checkedIn}/{detail.confirmed_seats} confirmadas ingresadas
              {detail.event.capacity !== null ? ` · cupo ${detail.event.capacity}` : ''}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href={`/${tenantSlug}/eventos/${id}`}>
              <ArrowLeft className="size-3.5" />
              Salir
            </Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <CheckInBoard tenantSlug={tenantSlug} reservations={eligible} />
      </main>
    </div>
  )
}
