import { Camera, CheckCircle2, MessageCircle, TriangleAlert } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { getChannelsForTenant } from '@/lib/meta/channels'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ChannelCardActions } from './_channel-actions'
import { ConnectButton } from './_connect-button'

export const metadata = { title: 'Canales' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ meta_ok?: string; meta_error?: string }>

export default async function CanalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: SearchParams
}) {
  const { tenantSlug } = await params
  const { meta_ok, meta_error } = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const channels = await getChannelsForTenant(access.tenant.id)
  const wa = channels.find((c) => c.type === 'whatsapp')
  const ig = channels.find((c) => c.type === 'instagram')

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuración"
        title="Canales"
        description="Conectá WhatsApp Business e Instagram para recibir y enviar mensajes desde la bandeja."
      />

      {meta_ok ? (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          <p>
            <strong>{meta_ok === 'whatsapp' ? 'WhatsApp' : 'Instagram'}</strong> conectado
            correctamente.
          </p>
        </div>
      ) : null}
      {meta_error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>Error de conexión: {meta_error}</p>
        </div>
      ) : null}

      <div className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-success/15 text-success">
              <MessageCircle className="size-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold tracking-tight">
                WhatsApp Business
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Embedded Signup. Templates aprobados por Meta para enviar fuera de ventana 24h.
              </p>
            </div>
          </div>
          {wa ? <StatusBadge status={wa.status} /> : <Badge variant="outline">No conectado</Badge>}
        </header>
        <div className="space-y-3 p-5">
          {wa?.display_name ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Cuenta: </span>
              <strong>{wa.display_name}</strong>
            </p>
          ) : null}
          {wa?.last_error ? (
            <p className="text-sm text-destructive">Último error: {wa.last_error}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {wa && wa.status === 'connected' ? (
              <ChannelCardActions channelId={wa.id} type="whatsapp" tenantSlug={tenantSlug} />
            ) : (
              <ConnectButton type="whatsapp" tenantSlug={tenantSlug} />
            )}
          </div>
        </div>
      </div>

      <div className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-warning/15 text-warning">
              <Camera className="size-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold tracking-tight">Instagram</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Login con Instagram Business para responder DMs.
              </p>
            </div>
          </div>
          {ig ? <StatusBadge status={ig.status} /> : <Badge variant="outline">No conectado</Badge>}
        </header>
        <div className="space-y-3 p-5">
          {ig?.display_name ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Cuenta: </span>
              <strong>@{ig.display_name}</strong>
            </p>
          ) : null}
          {ig?.last_error ? (
            <p className="text-sm text-destructive">Último error: {ig.last_error}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {ig && ig.status === 'connected' ? (
              <ChannelCardActions channelId={ig.id} type="instagram" tenantSlug={tenantSlug} />
            ) : (
              <ConnectButton type="instagram" tenantSlug={tenantSlug} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: 'connected' | 'disconnected' | 'error' }) {
  if (status === 'connected')
    return (
      <Badge className="gap-1 bg-success text-success-foreground hover:bg-success/90">
        <span className="size-1.5 rounded-full bg-current" />
        Conectado
      </Badge>
    )
  if (status === 'error') return <Badge variant="destructive">Error</Badge>
  return <Badge variant="outline">Desconectado</Badge>
}
