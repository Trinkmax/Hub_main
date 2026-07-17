import { Camera, CheckCircle2, MessageCircle, Settings, TriangleAlert } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { getChannelsForTenant } from '@/lib/meta/channels'
import { isMetaConfigured } from '@/lib/meta/env'
import { isTokenExpiringSoon } from '@/lib/meta/token-refresh'
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

// Errores del flujo de conexión → mensaje legible (nunca JSON crudo).
const ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    'WhatsApp e Instagram todavía no están habilitados a nivel plataforma. Falta cargar META_APP_ID y META_APP_SECRET en el entorno (los obtenés al crear la app en Meta).',
  forbidden: 'No tenés permiso para conectar canales.',
  connect_failed:
    'No pudimos iniciar la conexión con Meta. Revisá la configuración de la app e intentá de nuevo.',
}

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

  const configured = await isMetaConfigured()
  const channels = await getChannelsForTenant(access.tenant.id)
  const wa = channels.find((c) => c.type === 'whatsapp')
  const ig = channels.find((c) => c.type === 'instagram')
  const now = new Date()
  const errorMsg = meta_error
    ? (ERROR_MESSAGES[meta_error] ?? `Error de conexión: ${meta_error}`)
    : null

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
      {errorMsg ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>{errorMsg}</p>
        </div>
      ) : null}

      {/* Aviso de configuración pendiente a nivel plataforma */}
      {!configured ? (
        <div className="card-hairline rounded-xl border border-warning/30 bg-warning/10 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning">
              <Settings className="size-5" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-display text-sm font-semibold tracking-tight">
                Configuración de Meta pendiente
              </h3>
              <p className="text-sm text-muted-foreground">
                Para conectar WhatsApp o Instagram primero hay que crear una app en Meta y cargar
                sus credenciales (<span className="font-mono text-xs">META_APP_ID</span> y{' '}
                <span className="font-mono text-xs">META_APP_SECRET</span>) en el entorno. Es un
                paso de plataforma que se hace una sola vez. Mientras tanto, la bandeja, las
                difusiones y las plantillas quedan listas para cuando conectes.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* WhatsApp */}
      <ChannelCard
        icon={<MessageCircle className="size-5" />}
        iconClass="bg-success/15 text-success"
        title="WhatsApp Business"
        subtitle="Conectá tu número para recibir, responder y mandar difusiones por WhatsApp."
        status={wa?.status ?? null}
        displayName={wa?.display_name ? wa.display_name : null}
        displayPrefix=""
        lastError={wa?.last_error ?? null}
        tokenExpiringSoon={isTokenExpiringSoon(wa?.token_expires_at ?? null, now)}
      >
        {wa && wa.status === 'connected' ? (
          <ChannelCardActions channelId={wa.id} type="whatsapp" tenantSlug={tenantSlug} />
        ) : (
          <ConnectButton type="whatsapp" tenantSlug={tenantSlug} disabled={!configured} />
        )}
      </ChannelCard>

      {/* Instagram */}
      <ChannelCard
        icon={<Camera className="size-5" />}
        iconClass="bg-warning/15 text-warning"
        title="Instagram"
        subtitle="Conectá tu cuenta para responder mensajes directos de Instagram desde la bandeja."
        status={ig?.status ?? null}
        displayName={ig?.display_name ? ig.display_name : null}
        displayPrefix="@"
        lastError={ig?.last_error ?? null}
        tokenExpiringSoon={isTokenExpiringSoon(ig?.token_expires_at ?? null, now)}
      >
        {ig && ig.status === 'connected' ? (
          <ChannelCardActions channelId={ig.id} type="instagram" tenantSlug={tenantSlug} />
        ) : (
          <ConnectButton type="instagram" tenantSlug={tenantSlug} disabled={!configured} />
        )}
      </ChannelCard>

      {/* Guía de pasos */}
      <div className="card-hairline rounded-xl border border-border/60 bg-card/60 p-5">
        <h3 className="font-display text-sm font-semibold tracking-tight">
          Cómo conectar WhatsApp
        </h3>
        <ol className="mt-3 space-y-2.5 text-sm text-muted-foreground">
          {[
            'Tocá “Conectar WhatsApp” y seguí los pasos de Meta (te vas a loguear con tu Facebook).',
            'Elegí tu cuenta de WhatsApp Business y el número que vas a usar.',
            'Sincronizá tus plantillas desde la pantalla de Plantillas.',
            'Mandá un mensaje de prueba desde Difusiones para confirmar que funciona.',
          ].map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold tabular-nums text-foreground">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function ChannelCard({
  icon,
  iconClass,
  title,
  subtitle,
  status,
  displayName,
  displayPrefix,
  lastError,
  tokenExpiringSoon,
  children,
}: {
  icon: React.ReactNode
  iconClass: string
  title: string
  subtitle: string
  status: 'connected' | 'disconnected' | 'error' | null
  displayName: string | null
  displayPrefix: string
  lastError: string | null
  tokenExpiringSoon: boolean
  children: React.ReactNode
}) {
  return (
    <div className="card-hairline overflow-hidden rounded-xl border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className={`flex size-10 items-center justify-center rounded-lg ${iconClass}`}>
            {icon}
          </div>
          <div>
            <h2 className="font-serif text-lg font-semibold tracking-tight">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </header>
      <div className="space-y-3 p-5">
        {displayName ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Cuenta: </span>
            <strong>
              {displayPrefix}
              {displayName}
            </strong>
          </p>
        ) : null}
        {tokenExpiringSoon && status === 'connected' ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              La conexión está por vencer (o ya venció). Reconectá para poder seguir enviando
              mensajes.
            </span>
          </div>
        ) : null}
        {lastError ? <p className="text-sm text-destructive">Último error: {lastError}</p> : null}
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: 'connected' | 'disconnected' | 'error' | null }) {
  if (status === 'connected')
    return (
      <Badge className="gap-1 bg-success text-success-foreground hover:bg-success/90">
        <span className="size-1.5 rounded-full bg-current" />
        Conectado
      </Badge>
    )
  if (status === 'error') return <Badge variant="destructive">Error</Badge>
  return <Badge variant="outline">No conectado</Badge>
}
