import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listScheduledEventsForDateRange } from '@/lib/salon/queries'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { BroadcastForm } from '../_components/broadcast-form'

const TZ = 'America/Argentina/Cordoba'

function ymdInTz(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export const metadata = { title: 'Nueva difusión' }
export const dynamic = 'force-dynamic'

export default async function NuevaDifusionPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const prefillName = typeof sp.prefillName === 'string' ? sp.prefillName.slice(0, 80) : ''
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const supabase = await createClient()
  const now = new Date()
  const fromYmd = ymdInTz(now)
  const toYmd = ymdInTz(new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000))
  const [channelsRes, templatesRes, audiencesRes, scheduled] = await Promise.all([
    supabase
      .from('channels')
      .select('id, type, display_name, status')
      .eq('tenant_id', access.tenant.id)
      .eq('status', 'connected'),
    supabase
      .from('message_templates')
      .select('id, name, language, channel_id, status, components')
      .eq('tenant_id', access.tenant.id)
      .eq('status', 'approved')
      .order('name'),
    supabase
      .from('audiences')
      .select('id, name, customer_count_cached')
      .eq('tenant_id', access.tenant.id)
      .order('updated_at', { ascending: false }),
    listScheduledEventsForDateRange({ tenantId: access.tenant.id, from: fromYmd, to: toYmd }),
  ])

  // Próximos eventos del calendario para el dropdown "anunciar un evento".
  const events = scheduled.map((e) => ({
    id: e.id,
    name: e.name_override ?? e.template?.name ?? 'Evento',
    date: e.event_date,
    time: e.starts_at_local.slice(0, 5),
  }))

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/${tenantSlug}/mensajeria/difusiones`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Volver a difusiones
      </Link>
      <PageHeader
        eyebrow="Mensajería"
        title="Nueva difusión"
        description="Elegí canal, template y audiencia. Programá el envío o despachá ahora."
      />
      <BroadcastForm
        tenantSlug={tenantSlug}
        channels={channelsRes.data ?? []}
        templates={templatesRes.data ?? []}
        audiences={audiencesRes.data ?? []}
        events={events}
        initialName={prefillName}
      />
    </div>
  )
}
