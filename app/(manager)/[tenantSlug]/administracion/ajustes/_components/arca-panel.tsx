import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Clock,
  Receipt,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import {
  arcaCardState,
  certificateNote,
  guideStatusText,
  guideStepById,
  progressPercent,
  progressText,
} from '@/components/administracion/guias/arca-guide-model'
import {
  GUIDE_STATUS_TEXT_CLASS,
  GuideStatusDot,
} from '@/components/administracion/guias/guide-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { ArcaConnectionView, ArcaGuideView, ArcaOverview } from '@/lib/arca/views'
import { formatDateTime } from '@/lib/dates'
import { formatCuit, padPv } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { ArcaChecksList } from './arca-checks'
import { ArcaDisconnectButton, ArcaEmissionSwitch } from './arca-connection-controls'
import { ArcaHomologacion } from './arca-homologacion'
import { ArcaClassesSelect } from './arca-step-actions'
import { ArcaTestAction } from './arca-test-action'
import { Callout } from './form-bits'

const CARD = 'card-hairline overflow-hidden rounded-xl border bg-card'

const BENEFITS = [
  {
    icon: BadgeCheck,
    title: 'Completá proveedores y clientes con solo poner la CUIT',
    body: 'ARCA trae el nombre, la condición frente al IVA y el domicilio.',
  },
  {
    icon: Receipt,
    title: 'Emití facturas de eventos sin salir de acá',
    body: 'Con CAE, el código de ARCA que hace válida cada factura.',
  },
  {
    icon: ShieldCheck,
    title: 'Probá en un clic que todo esté en regla',
    body: 'Si falta algo, te decimos qué es y cómo se arregla, en palabras simples.',
  },
] as const

/** Ajustes › ARCA, sin empezar (A): qué gana el bar y el botón a la guía. */
function NotStarted({
  guideHref,
  sasCuit,
  base,
  canWrite,
  disconnected,
}: {
  guideHref: string
  sasCuit: string | null
  base: string
  canWrite: boolean
  disconnected: boolean
}) {
  return (
    <section
      aria-labelledby="arca-conectar-titulo"
      className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5 sm:p-6"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative space-y-5">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            ARCA · la ex AFIP
          </p>
          <h3
            id="arca-conectar-titulo"
            className="font-serif text-2xl font-semibold tracking-tight text-balance"
          >
            Conectá ARCA y que la plataforma trabaje por vos
          </h3>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
            Con la conexión, la plataforma habla directo con ARCA (la agencia de impuestos, ex
            AFIP), sin que tengas que entrar al portal cada vez.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-lg border border-border/60 bg-background/50 p-4">
              <Icon className="size-5 text-primary" aria-hidden />
              <p className="mt-2 text-sm font-medium text-pretty">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground text-pretty">{body}</p>
            </li>
          ))}
        </ul>
        {disconnected ? (
          <Callout tone="info" title="ARCA está desconectado">
            La conexión anterior se borró. Para volver a usarlo, seguí la guía: los pasos que
            hiciste en ARCA siguen hechos, falta generar otro pedido y subir el certificado.
          </Callout>
        ) : null}
        {sasCuit ? null : (
          <Callout
            tone="warning"
            title="Primero cargá la CUIT de la SAS"
            action={
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={`${base}/ajustes?tab=sas`}>Ir a Datos de la SAS</Link>
              </Button>
            }
          >
            La conexión con ARCA se hace a nombre de la SAS: necesitamos su CUIT.
          </Callout>
        )}
        <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-xs text-muted-foreground text-pretty">
            <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Lleva unos 40 minutos. Lo hace quien maneja la clave fiscal de la SAS (el administrador
            de relaciones). Te guiamos pantalla por pantalla.
          </p>
          <Button
            asChild
            variant={canWrite ? 'default' : 'outline'}
            className="h-11 w-full shrink-0 gap-2 sm:w-auto"
          >
            <Link href={guideHref}>
              {canWrite ? 'Conectar ARCA' : 'Ver la guía'}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}

/** En curso (B): «4 de 9», la lista de pasos y «Seguir con la guía». */
function InProgress({
  slug,
  guideHref,
  guide,
  connection,
  canWrite,
}: {
  slug: string
  guideHref: string
  guide: ArcaGuideView
  connection: ArcaConnectionView | null
  canWrite: boolean
}) {
  const next = guide.summary.next ? guideStepById(guide.summary.next) : null
  const steps = guide.steps.map((s) => {
    const def = guideStepById(s.id)
    return { ...s, title: def?.title ?? s.id, optional: def?.optional ?? false }
  })
  return (
    <section aria-labelledby="arca-curso-titulo" className={CARD}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <h3 id="arca-curso-titulo" className="font-serif text-lg font-semibold tracking-tight">
            Conexión con ARCA
          </h3>
          <p className="text-xs text-muted-foreground">
            Producción · {progressText(guide.summary)}
          </p>
        </div>
        <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning-text">
          En curso
        </Badge>
      </header>
      <div className="space-y-5 px-5 py-5">
        <Progress
          value={progressPercent(guide.summary)}
          aria-label={`Conectar ARCA: ${progressText(guide.summary)}`}
        />
        {connection?.status === 'cert_ready' ? (
          <Callout tone="info" title="Ya subiste el certificado">
            Falta probar la conexión (paso 9). Antes, fijate que estén hechos los pasos 7 y 8.
          </Callout>
        ) : null}
        <ol className="grid gap-1 sm:grid-cols-2">
          {steps.map((s) => (
            <li key={s.id}>
              <Link
                href={`${guideHref}#paso-${s.n}`}
                className="flex min-h-11 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm outline-none transition-colors hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring"
              >
                <GuideStatusDot status={s.status} n={s.n} size="sm" />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className={cn('shrink-0 text-xs', GUIDE_STATUS_TEXT_CLASS[s.status])}>
                  {guideStatusText(s.status, s.optional)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
        {canWrite && connection?.status === 'cert_ready' ? (
          <ArcaTestAction
            slug={slug}
            environment="produccion"
            connection={connection}
            guideHref={guideHref}
          />
        ) : null}
      </div>
      <footer className="flex flex-col gap-2 border-t border-border/60 px-5 py-4 sm:flex-row">
        <Button asChild className="h-11 w-full gap-2 sm:w-auto md:h-9">
          <Link href={next ? `${guideHref}#paso-${next.n}` : guideHref}>
            Seguir con la guía
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </footer>
    </section>
  )
}

/** Conectado (C) o con un problema (D): el estado, la prueba, la emisión y los botones. */
function Connected({
  slug,
  guideHref,
  connection,
  canWrite,
}: {
  slug: string
  guideHref: string
  connection: ArcaConnectionView
  canWrite: boolean
}) {
  const ok = connection.status === 'connected'
  const cert = certificateNote(connection.certificate)
  const problem = connection.lastError
  const problemStep = problem?.step ? guideStepById(problem.step) : null
  return (
    <section aria-labelledby="arca-estado-titulo" className={CARD}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {ok ? (
            <ShieldCheck className="size-5 shrink-0 text-success" aria-hidden />
          ) : (
            <ShieldAlert className="size-5 shrink-0 text-destructive" aria-hidden />
          )}
          <h3 id="arca-estado-titulo" className="font-serif text-lg font-semibold tracking-tight">
            Conexión con ARCA
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={
              ok
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
            }
          >
            {connection.statusLabel}
          </Badge>
          <Badge variant="outline">{connection.environmentLabel}</Badge>
        </div>
      </header>

      {!ok && problem ? (
        <div className="px-5 pt-5">
          <Callout
            tone="error"
            title={problem.title}
            action={
              <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
                <Link href={problemStep ? `${guideHref}#paso-${problemStep.n}` : guideHref}>
                  Cómo se arregla
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            }
          >
            {problem.body}
          </Callout>
        </div>
      ) : null}

      <dl className="grid gap-4 px-5 py-5 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">CUIT de la SAS</dt>
          <dd className="text-sm tabular-nums">
            {connection.representedCuit ? formatCuit(connection.representedCuit) : '—'}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">Punto de venta de la plataforma</dt>
          <dd className="text-sm tabular-nums">
            {connection.pointOfSale ? (
              padPv(connection.pointOfSale, 4)
            ) : (
              <Link
                href={`${guideHref}#paso-2`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Sin cargar: paso 2
              </Link>
            )}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">Certificado</dt>
          <dd
            className={cn(
              'text-sm text-pretty',
              cert?.tone === 'warning' && 'text-warning-text',
              cert?.tone === 'error' && 'text-destructive',
            )}
          >
            {cert ? cert.text : '—'}
            {connection.alias ? (
              <span className="block text-xs text-muted-foreground">
                Alias <span className="font-mono">{connection.alias}</span>
              </span>
            ) : null}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">Última prueba</dt>
          <dd className="text-sm">
            {connection.lastTestAt ? formatDateTime(connection.lastTestAt) : 'Todavía no'}
          </dd>
        </div>
      </dl>

      {cert && cert.tone !== 'ok' && canWrite ? (
        <div className="px-5 pb-5">
          <Callout
            tone={cert.tone === 'error' ? 'error' : 'warning'}
            title={cert.tone === 'error' ? 'Renová el certificado' : 'Renovalo antes de que venza'}
            action={
              <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
                <Link href={`${guideHref}#renovar`}>
                  <RefreshCw className="size-4" aria-hidden />
                  Renovar
                </Link>
              </Button>
            }
          >
            Los certificados de ARCA duran 2 años. Renovarlo lleva unos minutos y la conexión sigue
            andando mientras tanto.
          </Callout>
        </div>
      ) : null}

      <div className="space-y-4 border-t border-border/60 px-5 py-5">
        <h4 className="text-sm font-semibold">Prueba de conexión</h4>
        {canWrite ? (
          <ArcaTestAction
            slug={slug}
            environment="produccion"
            connection={connection}
            guideHref={guideHref}
          />
        ) : connection.lastTest ? (
          <ArcaChecksList test={connection.lastTest} guideHref={guideHref} />
        ) : (
          <p className="text-sm text-muted-foreground">Todavía no se probó la conexión.</p>
        )}
      </div>

      <div className="space-y-5 border-t border-border/60 px-5 py-5">
        <ArcaEmissionSwitch slug={slug} connection={connection} readOnly={!canWrite} />
        <ArcaClassesSelect
          slug={slug}
          environment="produccion"
          connection={connection}
          readOnly={!canWrite}
        />
      </div>

      <footer className="flex flex-col gap-2 border-t border-border/60 px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center">
        <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
          <Link href={guideHref}>
            <BookOpen className="size-4" aria-hidden />
            Ver la guía
          </Link>
        </Button>
        {canWrite ? (
          <>
            <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
              <Link href={`${guideHref}#renovar`}>
                <RefreshCw className="size-4" aria-hidden />
                Renovar certificado
              </Link>
            </Button>
            <div className="sm:ml-auto">
              <ArcaDisconnectButton
                slug={slug}
                environment="produccion"
                className="w-full sm:w-auto"
              />
            </div>
          </>
        ) : null}
      </footer>
    </section>
  )
}

/**
 * Ajustes › ARCA (diseño §2.2): la conexión de producción en uno de cuatro estados (sin
 * empezar · en curso · conectado · con un problema), las facturas de ARCA que piden atención y,
 * plegadas al final, las pruebas en homologación. La contadora ve todo sin botones de carga.
 * Server component: las acciones son islas de cliente.
 */
export function ArcaPanel({
  slug,
  overview,
  canWrite,
}: {
  slug: string
  overview: ArcaOverview
  canWrite: boolean
}) {
  const base = `/${slug}/administracion`
  const guideHref = `${base}/ajustes/arca`
  const prod = overview.connections.produccion
  const guide = overview.guide.produccion
  const state = arcaCardState(prod, guide.summary)
  const attention = overview.attention.filter((a) => a.environment === 'produccion')

  return (
    <div className="space-y-6">
      {attention.length > 0 ? (
        <Callout
          tone="error"
          title={
            attention.length === 1
              ? 'Hay 1 factura de ARCA para verificar o cargar en los libros'
              : `Hay ${attention.length} facturas de ARCA para verificar o cargar en los libros`
          }
          action={
            // La verificación automática y «Cargarla ahora» viven en Factura de venta (para
            // quien carga); la contadora las ve en Ventas › Facturas.
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link
                href={canWrite ? `${base}/ventas/nueva-factura` : `${base}/ventas?tab=facturas`}
              >
                Ver
              </Link>
            </Button>
          }
        >
          {attention
            .slice(0, 3)
            .map((a) => a.label)
            .join(' · ')}
          {attention.length > 3 ? ' · …' : ''}
        </Callout>
      ) : null}

      {state === 'not_started' ? (
        <NotStarted
          guideHref={guideHref}
          sasCuit={overview.sas.cuit}
          base={base}
          canWrite={canWrite}
          disconnected={prod?.status === 'disconnected'}
        />
      ) : null}
      {state === 'in_progress' ? (
        <InProgress
          slug={slug}
          guideHref={guideHref}
          guide={guide}
          connection={prod}
          canWrite={canWrite}
        />
      ) : null}
      {(state === 'connected' || state === 'error') && prod ? (
        <Connected slug={slug} guideHref={guideHref} connection={prod} canWrite={canWrite} />
      ) : null}

      <ArcaHomologacion
        slug={slug}
        connection={overview.connections.homologacion}
        canWrite={canWrite}
      />
    </div>
  )
}
