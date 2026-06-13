import {
  ArrowRight,
  Cake,
  Camera,
  CheckCircle2,
  type LucideIcon,
  Megaphone,
  MessageCircle,
  PartyPopper,
  Sparkles,
  Star,
  UserMinus,
  Users,
  Workflow,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { listAudiences } from '@/lib/audiences/queries'
import { listBroadcasts } from '@/lib/broadcasts/queries'
import { listFlows } from '@/lib/flows/queries'
import { getChannelsForTenant } from '@/lib/meta/channels'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Marketing' }
export const dynamic = 'force-dynamic'

export default async function MarketingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const tenantId = access.tenant.id

  const [channels, broadcasts, audiences, flows] = await Promise.all([
    getChannelsForTenant(tenantId),
    listBroadcasts(tenantId),
    listAudiences(tenantId),
    listFlows(tenantId),
  ])

  const wa = channels.find((c) => c.type === 'whatsapp')
  const ig = channels.find((c) => c.type === 'instagram')
  const waConnected = wa?.status === 'connected'
  const activeFlows = flows.filter((f) => f.active).length

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Crecimiento"
        title="Marketing"
        description="Centro de control para hablarle a tus clientes: canales, difusiones, audiencias y automatizaciones."
      />

      {/* 1. Estado de conexión de canales */}
      <section aria-label="Canales conectados" className="space-y-3">
        <h2 className="font-serif text-lg font-semibold tracking-tight">Canales</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChannelStatusCard
            tenantSlug={tenantSlug}
            icon={MessageCircle}
            name="WhatsApp Business"
            connected={waConnected}
            displayName={wa?.display_name}
            error={wa?.status === 'error' ? wa.last_error : null}
            accent="success"
          />
          <ChannelStatusCard
            tenantSlug={tenantSlug}
            icon={Camera}
            name="Instagram"
            connected={ig?.status === 'connected'}
            displayName={ig?.display_name}
            error={ig?.status === 'error' ? ig.last_error : null}
            accent="info"
          />
        </div>
      </section>

      {/* 2. Herramientas con conteo en vivo */}
      <section aria-label="Herramientas de marketing" className="space-y-3">
        <h2 className="font-serif text-lg font-semibold tracking-tight">Herramientas</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ToolCard
            href={`/${tenantSlug}/difusiones`}
            icon={Megaphone}
            title="Difusiones"
            helper="Mandá un mensaje masivo a una audiencia por WhatsApp."
            count={broadcasts.length}
          />
          <ToolCard
            href={`/${tenantSlug}/audiencias`}
            icon={Users}
            title="Audiencias"
            helper="Segmentá clientes por puntos, visitas o etiquetas."
            count={audiences.length}
          />
          <ToolCard
            href={`/${tenantSlug}/flows`}
            icon={Workflow}
            title="Flows"
            helper="Automatizaciones que se disparan solas."
            count={activeFlows}
            countLabel="activos"
          />
          <ToolCard
            href={`/${tenantSlug}/eventos/programados`}
            icon={PartyPopper}
            title="Eventos"
            helper="Programá eventos en el calendario y anunciálos a tu gente."
          />
        </div>
      </section>

      {/* 3. Primeros pasos / automatizaciones sugeridas */}
      <section
        aria-label="Primeros pasos"
        className="card-hairline space-y-4 rounded-xl border border-border/70 bg-card p-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h2 className="font-serif text-lg font-semibold tracking-tight">Primeros pasos</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Estas automatizaciones funcionan solas y traen gente de vuelta. Armá una en un minuto.
            </p>
          </div>
        </div>

        <ul className="grid gap-3 sm:grid-cols-3">
          <TipCard
            icon={Cake}
            title="Saludo de cumpleaños"
            helper="Mensaje automático el día del cumple, con un beneficio."
            href={`/${tenantSlug}/flows/nuevo`}
          />
          <TipCard
            icon={UserMinus}
            title="Recuperar inactivos"
            helper="Reenganchá a quienes no vienen hace tiempo."
            href={`/${tenantSlug}/flows/nuevo`}
          />
          <TipCard
            icon={Star}
            title="Reseña post-visita"
            helper="Pedí una reseña apenas se van, cuando la experiencia está fresca."
            href={`/${tenantSlug}/flows/nuevo`}
          />
        </ul>
      </section>
    </PageShell>
  )
}

function ChannelStatusCard({
  tenantSlug,
  icon: Icon,
  name,
  connected,
  displayName,
  error,
  accent,
}: {
  tenantSlug: string
  icon: LucideIcon
  name: string
  connected: boolean
  displayName?: string | null
  error?: string | null
  accent: 'success' | 'info'
}) {
  return (
    <div
      className={cn(
        'card-hairline flex flex-col gap-3 rounded-xl border bg-card p-5',
        connected ? 'border-border/70' : 'border-dashed border-border/80',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              accent === 'success' ? 'bg-success/15 text-success' : 'bg-info/15 text-info',
            )}
          >
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium leading-tight">{name}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {connected && displayName ? displayName : 'No vinculado todavía.'}
            </p>
          </div>
        </div>
        {connected ? (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="size-3" />
            Conectado
          </Badge>
        ) : (
          <Badge variant="muted">Sin conectar</Badge>
        )}
      </div>

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}

      {!connected ? (
        <Button asChild size="sm" className="w-full gap-2 sm:w-auto sm:self-start">
          <Link href={`/${tenantSlug}/configuracion/canales`}>
            <Icon className="size-4" />
            Conectar {name.split(' ')[0]}
          </Link>
        </Button>
      ) : (
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="gap-1.5 self-start text-muted-foreground"
        >
          <Link href={`/${tenantSlug}/configuracion/canales`}>
            Administrar
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      )}
    </div>
  )
}

function ToolCard({
  href,
  icon: Icon,
  title,
  helper,
  count,
  countLabel,
}: {
  href: string
  icon: LucideIcon
  title: string
  helper: string
  count?: number
  countLabel?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'card-hairline group flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4',
        'transition-colors hover:border-primary/40 hover:bg-[--cream-tint]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        {count !== undefined ? (
          <Badge variant="muted" className="tabular-nums">
            {count}
            {countLabel ? ` ${countLabel}` : ''}
          </Badge>
        ) : null}
      </div>
      <div>
        <h3 className="flex items-center gap-1 font-medium leading-tight">
          {title}
          <ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
        </h3>
        <p className="mt-1 text-xs text-muted-foreground text-pretty">{helper}</p>
      </div>
    </Link>
  )
}

function TipCard({
  icon: Icon,
  title,
  helper,
  href,
}: {
  icon: LucideIcon
  title: string
  helper: string
  href: string
}) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          'flex h-full flex-col gap-2 rounded-lg border border-border/70 bg-background/60 p-4',
          'transition-colors hover:border-primary/40 hover:bg-[--cream-tint]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <Icon className="size-5 text-primary" />
        <span className="text-sm font-medium leading-tight">{title}</span>
        <span className="text-xs text-muted-foreground text-pretty">{helper}</span>
      </Link>
    </li>
  )
}
