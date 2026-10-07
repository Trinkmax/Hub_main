import { Camera, Check, MessageCircle, Unplug } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Callout } from '@/components/ui/callout'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Section } from '@/components/ui/section'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatDate } from '@/lib/dates'
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
import { CHANNEL_STATUS } from './_channel-status'
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

  // La config de Meta (platform_meta_config, cacheada) y los canales del
  // tenant son independientes: en paralelo, 2 hops → 1.
  const [configured, channels] = await Promise.all([
    isMetaConfigured(),
    getChannelsForTenant(access.tenant.id),
  ])
  const wa = channels.find((c) => c.type === 'whatsapp')
  const ig = channels.find((c) => c.type === 'instagram')
  const now = new Date()
  const connectError = meta_error ? translateMetaError(meta_error) : null

  return (
    <PageShell width="compact">
      <PageHeader
        title="Canales"
        description="Acá conectás el WhatsApp y el Instagram de tu bar. Una vez conectados, todos los mensajes con tus clientes entran y salen desde esta plataforma."
      />

      {meta_ok ? (
        <Callout
          tone="success"
          announce="polite"
          title={`¡Listo! ${meta_ok === 'whatsapp' ? 'WhatsApp' : 'Instagram'} quedó conectado.`}
        >
          {meta_ok === 'whatsapp'
            ? 'Siguiente paso: traé tus plantillas desde Plantillas para poder mandar difusiones.'
            : 'Los mensajes directos de Instagram van a empezar a caer en los chats.'}
        </Callout>
      ) : null}

      {connectError ? (
        <Callout tone="danger" announce="polite" title="No se pudo conectar">
          <p>{connectError.friendly}</p>
          {connectError.technical ? <TechnicalDetail text={connectError.technical} /> : null}
        </Callout>
      ) : null}

      {/* Aviso claro cuando la plataforma todavía no tiene credenciales de Meta */}
      {!configured ? (
        <Callout tone="warning" title="WhatsApp e Instagram todavía no están habilitados">
          Falta un paso técnico que no depende de vos: cargar las credenciales de la app de Meta (
          <span className="font-mono">META_APP_ID</span> y{' '}
          <span className="font-mono">META_APP_SECRET</span>). Avisale a quien administra la
          plataforma y se resuelve una sola vez. Mientras tanto podés dejar listos los chats, las
          difusiones y las plantillas.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-4">
        {/* WhatsApp */}
        <ChannelCard
          icon={<MessageCircle className="size-5" aria-hidden />}
          iconClass="bg-success-soft text-success-text"
          title="WhatsApp Business"
          purpose="Por acá entran y salen los mensajes de WhatsApp con tus clientes: chats, difusiones y automatizaciones."
          status={wa?.status ?? null}
          accountLabel={wa?.display_name ? formatAccountName(wa.display_name) : null}
          connectedAt={wa?.connected_at ? formatDate(wa.connected_at) : null}
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
          icon={<Camera className="size-5" aria-hidden />}
          iconClass="bg-secondary text-foreground"
          title="Instagram"
          purpose="Por acá entran los mensajes directos de Instagram, para responderlos desde los chats."
          status={ig?.status ?? null}
          accountLabel={ig?.display_name ? `@${ig.display_name}` : null}
          connectedAt={ig?.connected_at ? formatDate(ig.connected_at) : null}
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
      </div>

      {/* Guía de pasos */}
      <Section divider title="Cómo conectar WhatsApp">
        <ol className="flex flex-col gap-3 type-body text-muted-foreground">
          {[
            'Tocá «Conectar mi WhatsApp» y seguí los pasos de Meta (vas a entrar con tu cuenta de Facebook).',
            'Elegí tu cuenta de WhatsApp Business y el número del bar.',
            'Traé tus plantillas desde la pantalla de Plantillas.',
            'Mandá un mensaje de prueba desde Difusiones para confirmar que todo funciona.',
          ].map((step, i) => (
            <li key={step} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary type-caption font-semibold tabular-nums text-foreground"
              >
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        {/* Nota al pie, después de los pasos: como bajada del título se leía
            antes de explicar WhatsApp. */}
        <p className="max-w-prose text-pretty type-small text-muted-foreground">
          Instagram se conecta igual de fácil: tocá «Conectar mi Instagram» y entrá con la cuenta
          del bar.
        </p>
      </Section>
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
    <Card asChild padding="none" className="gap-0 overflow-clip">
      <section aria-label={title}>
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}
            >
              {icon}
            </div>
            <div className="min-w-0">
              <h2 className="type-subtitle text-foreground">{title}</h2>
              <p className="mt-0.5 type-small text-pretty text-muted-foreground">{purpose}</p>
            </div>
          </div>
          <StatusBadge status={status ?? 'disconnected'} map={CHANNEL_STATUS} />
        </header>

        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <StatusHero
            status={status}
            title={title}
            accountLabel={accountLabel}
            connectedAt={connectedAt}
            lastError={lastError}
          />

          {tokenExpiringSoon && status === 'connected' ? (
            <Callout tone="warning" title="La autorización de Meta está por vencer">
              Tocá «Reconectar» para que los mensajes sigan saliendo sin cortes.
            </Callout>
          ) : null}

          {/* Error suelto con la conexión todavía activa (ej. falló la renovación automática) */}
          {status === 'connected' && lastError ? <ConnectedWarning lastError={lastError} /> : null}

          <div className="flex flex-wrap items-center gap-2">{children}</div>
        </div>
      </section>
    </Card>
  )
}

/** El canal sigue conectado pero el último intento de algo falló: avisamos sin alarmar. */
function ConnectedWarning({ lastError }: { lastError: string }) {
  const info = translateMetaError(lastError)
  return (
    <Callout tone="warning">
      <p>{info.friendly}</p>
      {info.technical ? <TechnicalDetail text={info.technical} /> : null}
    </Callout>
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
      <Callout tone="success" icon={Check} title={accountLabel ?? title}>
        Conectado{connectedAt ? ` desde el ${connectedAt}` : ''}: los mensajes entran y salen con
        normalidad.
      </Callout>
    )
  }

  if (status === 'error') {
    const info = lastError ? translateMetaError(lastError) : null
    return (
      <Callout tone="danger" title="La conexión se cortó">
        <p>
          {accountLabel ? `${accountLabel}: ` : ''}los mensajes no están entrando ni saliendo.{' '}
          {info?.friendly ??
            'No sabemos bien qué pasó. Tocá «Volver a conectar» y, si sigue fallando, avisanos.'}
        </p>
        {info?.technical ? <TechnicalDetail text={info.technical} /> : null}
      </Callout>
    )
  }

  return (
    <Callout tone="neutral" icon={Unplug} title="Sin conectar">
      Conectalo y los mensajes de tus clientes empiezan a entrar solos a los chats.
    </Callout>
  )
}

/** Mensaje crudo de Meta, plegado: útil solo si hay que pedir ayuda. */
function TechnicalDetail({ text }: { text: string }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer type-caption text-muted-foreground underline underline-offset-2">
        Ver el detalle técnico (para soporte)
      </summary>
      <code className="mt-1 block overflow-x-auto rounded-sm bg-card px-2 py-1.5 font-mono type-caption text-muted-foreground">
        {text}
      </code>
    </details>
  )
}
