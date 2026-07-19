import { format } from 'date-fns'
import {
  Camera,
  Check,
  CheckCircle2,
  MessageCircle,
  Settings,
  TriangleAlert,
  Unplug,
} from 'lucide-react'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getChannelsForTenant } from '@/lib/meta/channels'
import { isMetaConfigured } from '@/lib/meta/env'
import { isTokenExpiringSoon } from '@/lib/meta/token-refresh'
import { formatPhoneForDisplay } from '@/lib/phone'
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

// Errores conocidos del flujo de conexión → mensaje en criollo (nunca JSON crudo).
const ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    'WhatsApp e Instagram todavía no están habilitados en la plataforma. Es un paso técnico que no depende de vos — avisale a quien administra la plataforma.',
  forbidden:
    'Solo el dueño puede conectar canales. Si sos el dueño, cerrá sesión y volvé a entrar con tu cuenta.',
  connect_failed:
    'No pudimos arrancar la conexión con Meta. Esperá un minuto y probá de nuevo. Si sigue fallando, avisanos.',
  missing_code_or_state:
    'La conexión con Meta se cortó a mitad de camino. Tocá "Conectar" otra vez y completá todos los pasos sin cerrar la ventana.',
  invalid_state:
    'La conexión tardó demasiado y venció. Tocá "Conectar" otra vez y completá los pasos de corrido.',
  tenant_not_found:
    'No pudimos encontrar tu bar al volver de Meta. Recargá la página y probá de nuevo.',
}

/**
 * Traduce un error del flujo de Meta (código propio o mensaje crudo de la API)
 * a una explicación accionable. Si el mensaje crudo aporta algo para soporte,
 * lo devolvemos aparte como `technical`.
 */
function translateMetaError(raw: string): { friendly: string; technical: string | null } {
  const exact = ERROR_MESSAGES[raw]
  if (exact) return { friendly: exact, technical: null }

  const lower = raw.toLowerCase()
  if (lower.includes('denied') || lower.includes('declined') || lower.includes('cancel')) {
    return {
      friendly:
        'Cancelaste la conexión en Meta (o no aceptaste los permisos). Cuando quieras, tocá "Conectar" de nuevo y aceptá todos los pasos.',
      technical: null,
    }
  }
  if (lower.includes('no waba')) {
    return {
      friendly:
        'Meta no nos dio acceso a ninguna cuenta de WhatsApp Business. Al conectar, elegí (o creá) una cuenta de WhatsApp Business y aceptá todos los permisos.',
      technical: null,
    }
  }
  if (lower.includes('no phone numbers')) {
    return {
      friendly:
        'Tu cuenta de WhatsApp Business no tiene ningún número cargado. Agregá un número desde Meta y volvé a intentar.',
      technical: null,
    }
  }
  if (
    lower.includes('renovación automática') ||
    (lower.includes('token') && (lower.includes('expir') || lower.includes('invalid')))
  ) {
    return {
      friendly:
        'La autorización que nos dio Meta venció y no se pudo renovar sola. Tocá "Volver a conectar" para arreglarlo — tarda un minuto.',
      technical: raw,
    }
  }
  return {
    friendly:
      'No se pudo completar la conexión. Probá de nuevo en un rato. Si sigue fallando, avisanos y pasanos el detalle técnico de abajo.',
    technical: raw,
  }
}

/** Meta a veces devuelve un teléfono crudo como nombre de cuenta: lo formateamos. */
function formatAccountName(name: string): string {
  const compact = name.replace(/[\s-]/g, '')
  if (/^\+?\d{8,15}$/.test(compact)) {
    return formatPhoneForDisplay(compact.startsWith('+') ? compact : `+${compact}`)
  }
  return name
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
  const connectError = meta_error ? translateMetaError(meta_error) : null

  return (
    <PageShell width="compact">
      <PageHeader
        eyebrow="Configuración"
        title="Canales"
        description="Acá conectás el WhatsApp y el Instagram de tu bar. Una vez conectados, todos los mensajes con tus clientes entran y salen desde esta plataforma."
      />

      {meta_ok ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          <div className="space-y-0.5">
            <p className="font-medium">
              ¡Listo! {meta_ok === 'whatsapp' ? 'WhatsApp' : 'Instagram'} quedó conectado.
            </p>
            <p className="text-muted-foreground">
              {meta_ok === 'whatsapp'
                ? 'Siguiente paso: sincronizá tus plantillas para poder mandar difusiones.'
                : 'Los mensajes directos de Instagram van a empezar a caer en la bandeja.'}
            </p>
          </div>
        </div>
      ) : null}

      {connectError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium">No se pudo conectar</p>
              <p>{connectError.friendly}</p>
              {connectError.technical ? <TechnicalDetail text={connectError.technical} /> : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Aviso claro cuando la plataforma todavía no tiene credenciales de Meta */}
      {!configured ? (
        <div className="card-hairline rounded-xl border border-warning/30 bg-warning/10 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning">
              <Settings className="size-5" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-display text-sm font-semibold tracking-tight">
                WhatsApp e Instagram todavía no están habilitados
              </h3>
              <p className="text-sm text-muted-foreground">
                Falta un paso técnico que no depende de vos: cargar las credenciales de la app de
                Meta (<span className="font-mono text-xs">META_APP_ID</span> y{' '}
                <span className="font-mono text-xs">META_APP_SECRET</span>). Avisale a quien
                administra la plataforma y se resuelve una sola vez. Mientras tanto podés dejar
                listas la bandeja, las difusiones y las plantillas.
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
        purpose="Por acá entran y salen los mensajes de WhatsApp con tus clientes: bandeja, difusiones y automatizaciones."
        status={wa?.status ?? null}
        accountLabel={wa?.display_name ? formatAccountName(wa.display_name) : null}
        connectedAt={wa?.connected_at ? format(new Date(wa.connected_at), 'dd/MM/yyyy') : null}
        lastError={wa?.last_error ?? null}
        tokenExpiringSoon={isTokenExpiringSoon(wa?.token_expires_at ?? null, now)}
      >
        {wa && wa.status === 'connected' ? (
          <ChannelCardActions channelId={wa.id} type="whatsapp" tenantSlug={tenantSlug} />
        ) : (
          <ConnectButton
            type="whatsapp"
            tenantSlug={tenantSlug}
            disabled={!configured}
            label={wa?.status === 'error' ? 'Volver a conectar' : undefined}
          />
        )}
      </ChannelCard>

      {/* Instagram */}
      <ChannelCard
        icon={<Camera className="size-5" />}
        iconClass="bg-warning/15 text-warning"
        title="Instagram"
        purpose="Por acá entran los mensajes directos de Instagram, para responderlos desde la bandeja."
        status={ig?.status ?? null}
        accountLabel={ig?.display_name ? `@${ig.display_name}` : null}
        connectedAt={ig?.connected_at ? format(new Date(ig.connected_at), 'dd/MM/yyyy') : null}
        lastError={ig?.last_error ?? null}
        tokenExpiringSoon={isTokenExpiringSoon(ig?.token_expires_at ?? null, now)}
      >
        {ig && ig.status === 'connected' ? (
          <ChannelCardActions channelId={ig.id} type="instagram" tenantSlug={tenantSlug} />
        ) : (
          <ConnectButton
            type="instagram"
            tenantSlug={tenantSlug}
            disabled={!configured}
            label={ig?.status === 'error' ? 'Volver a conectar' : undefined}
          />
        )}
      </ChannelCard>

      {/* Guía de pasos */}
      <div className="card-hairline rounded-xl border border-border/60 bg-card/60 p-5">
        <h3 className="font-display text-sm font-semibold tracking-tight">
          Cómo conectar WhatsApp
        </h3>
        <ol className="mt-3 space-y-2.5 text-sm text-muted-foreground">
          {[
            'Tocá “Conectar mi WhatsApp” y seguí los pasos de Meta (vas a entrar con tu cuenta de Facebook).',
            'Elegí tu cuenta de WhatsApp Business y el número del bar.',
            'Sincronizá tus plantillas desde la pantalla de Plantillas.',
            'Mandá un mensaje de prueba desde Difusiones para confirmar que todo funciona.',
          ].map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold tabular-nums text-foreground">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          Instagram se conecta igual de fácil: tocá “Conectar mi Instagram” y entrá con la cuenta
          del bar.
        </p>
      </div>
    </PageShell>
  )
}

function ChannelCard({
  icon,
  iconClass,
  title,
  purpose,
  status,
  accountLabel,
  connectedAt,
  lastError,
  tokenExpiringSoon,
  children,
}: {
  icon: React.ReactNode
  iconClass: string
  title: string
  purpose: string
  status: 'connected' | 'disconnected' | 'error' | null
  accountLabel: string | null
  connectedAt: string | null
  lastError: string | null
  tokenExpiringSoon: boolean
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="card-hairline overflow-hidden rounded-xl border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}
          >
            {icon}
          </div>
          <div>
            <h2 className="font-serif text-lg font-semibold tracking-tight">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{purpose}</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className="space-y-3 p-5">
        <StatusHero
          status={status}
          title={title}
          accountLabel={accountLabel}
          connectedAt={connectedAt}
          lastError={lastError}
        />

        {tokenExpiringSoon && status === 'connected' ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <span>
              La autorización de Meta está por vencer (o ya venció). Tocá “Reconectar” para que los
              mensajes sigan saliendo sin cortes.
            </span>
          </div>
        ) : null}

        {/* Error suelto con la conexión todavía activa (ej. falló la renovación automática) */}
        {status === 'connected' && lastError ? <ConnectedWarning lastError={lastError} /> : null}

        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </section>
  )
}

/** El canal sigue conectado pero el último intento de algo falló: avisamos sin alarmar. */
function ConnectedWarning({ lastError }: { lastError: string }) {
  const info = translateMetaError(lastError)
  return (
    <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs">
      <p>{info.friendly}</p>
      {info.technical ? <TechnicalDetail text={info.technical} /> : null}
    </div>
  )
}

function StatusHero({
  status,
  title,
  accountLabel,
  connectedAt,
  lastError,
}: {
  status: 'connected' | 'disconnected' | 'error' | null
  title: string
  accountLabel: string | null
  connectedAt: string | null
  lastError: string | null
}) {
  if (status === 'connected') {
    return (
      <div className="flex items-center gap-3.5 rounded-lg border border-success/25 bg-success/10 px-4 py-3.5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
          <Check className="size-6" strokeWidth={3} aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-tight">{accountLabel ?? title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Conectado{connectedAt ? ` desde el ${connectedAt}` : ''} · los mensajes entran y salen
            con normalidad.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    const info = lastError ? translateMetaError(lastError) : null
    return (
      <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3.5">
        <div className="flex items-center gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <TriangleAlert className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight">La conexión se cortó</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {accountLabel ? `${accountLabel} · ` : ''}Los mensajes no están entrando ni saliendo.
            </p>
          </div>
        </div>
        <p className="text-sm">
          {info?.friendly ??
            'No sabemos bien qué pasó. Tocá "Volver a conectar" y, si sigue fallando, avisanos.'}
        </p>
        {info?.technical ? <TechnicalDetail text={info.technical} /> : null}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-dashed border-border px-4 py-3.5">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Unplug className="size-5" aria-hidden />
      </div>
      <div>
        <p className="text-base font-semibold leading-tight">Sin conectar</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Conectalo y los mensajes de tus clientes empiezan a entrar solos a la bandeja.
        </p>
      </div>
    </div>
  )
}

/** Mensaje crudo de Meta, plegado: útil solo si hay que pedir ayuda. */
function TechnicalDetail({ text }: { text: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline">
        Ver detalle técnico (para soporte)
      </summary>
      <code className="mt-1 block overflow-x-auto rounded bg-secondary px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
        {text}
      </code>
    </details>
  )
}

function StatusBadge({ status }: { status: 'connected' | 'disconnected' | 'error' | null }) {
  if (status === 'connected')
    return (
      <Badge variant="success" className="gap-1">
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        Conectado
      </Badge>
    )
  if (status === 'error') return <Badge variant="destructive">Necesita atención</Badge>
  return <Badge variant="outline">Sin conectar</Badge>
}
