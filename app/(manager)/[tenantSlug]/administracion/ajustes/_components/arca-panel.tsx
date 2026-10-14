import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  ChevronRight,
  Clock,
  Receipt,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import {
  arcaCardState,
  certificateNote,
  guideStatusText,
  guideStepById,
  nextStepLine,
  progressText,
} from '@/components/administracion/guias/arca-guide-model'
import {
  GUIDE_STATUS_TEXT_CLASS,
  GuideStatusDot,
} from '@/components/administracion/guias/guide-status'
import { HeroPanel } from '@/components/administracion/kit/hero'
import { Panel, PanelSection } from '@/components/administracion/kit/panel'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Button } from '@/components/ui/button'
import type { ArcaConnectionView, ArcaGuideView, ArcaOverview } from '@/lib/arca/views'
import { formatDateTime } from '@/lib/dates'
import { formatCuit, padPv } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { ArcaCable } from './arca-cable'
import { ArcaChecksList } from './arca-checks'
import { ArcaDisconnectButton, ArcaEmissionSwitch } from './arca-connection-controls'
import { ArcaHomologacion } from './arca-homologacion'
import { ArcaClassesSelect } from './arca-step-actions'
import { ArcaTestAction } from './arca-test-action'
import { Callout } from './form-bits'

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

const TEXT_LINK =
  'inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0'

/** Ajustes › ARCA, sin empezar (A): el cable sin enchufar, qué gana el bar y UNA acción. */
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
  // Sin CUIT no se puede empezar: lo primero es cargarla (y la guía queda como link).
  const needsCuit = !sasCuit
  return (
    <HeroPanel tone="crema" className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-center lg:gap-10">
        <div className="min-w-0 space-y-2">
          <h2 className="font-serif text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
            Conectá ARCA y que la plataforma trabaje por vos
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground text-pretty">
            Con la conexión, la plataforma habla directo con ARCA (la agencia de impuestos, ex
            AFIP), sin que tengas que entrar al portal cada vez.
          </p>
        </div>
        <div>
          <ArcaCable state="not_started" />
          <p className="mt-2 text-center text-xs text-muted-foreground">Todavía sin conectar</p>
        </div>
      </div>

      <ul className="grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-3">
        {BENEFITS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3 sm:flex-col sm:gap-2">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-accent text-accent-foreground"
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm leading-snug font-medium text-pretty">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground text-pretty">{body}</p>
            </div>
          </li>
        ))}
      </ul>

      {disconnected ? (
        <Callout tone="info" title="ARCA está desconectado">
          La conexión anterior se borró. Para volver a usarlo, seguí la guía: los pasos que hiciste
          en ARCA siguen hechos, falta generar otro pedido y subir el certificado.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-4 border-t border-border/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          {needsCuit ? (
            <p className="text-sm font-medium text-pretty">
              La conexión con ARCA se hace a nombre de la SAS: necesitamos su CUIT.
            </p>
          ) : null}
          <p className="flex items-start gap-2 text-xs text-muted-foreground text-pretty">
            <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Lleva unos 40 minutos. Lo hace quien maneja la clave fiscal de la SAS (el administrador
            de relaciones). Te guiamos pantalla por pantalla.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
          {needsCuit && canWrite ? (
            <>
              <Link href={guideHref} className={cn(TEXT_LINK, 'justify-center')}>
                Ver la guía
              </Link>
              <Button asChild className="h-12 gap-2 px-5">
                <Link href={`${base}/ajustes?tab=sas`}>
                  Cargar la CUIT primero
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            </>
          ) : (
            <Button asChild variant={canWrite ? 'default' : 'outline'} className="h-12 gap-2 px-5">
              <Link href={guideHref}>
                {canWrite ? 'Conectar ARCA' : 'Ver la guía'}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </HeroPanel>
  )
}

/** En curso (B): el cable con el avance, lo que toca y «Seguir con la guía». */
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
  const next = nextStepLine(guide.summary, guide.steps)
  const steps = guide.steps.map((s) => {
    const def = guideStepById(s.id)
    return { ...s, title: def?.title ?? s.id, optional: def?.optional ?? false }
  })
  const progress = progressText(guide.summary)
  // «1 de 9 pasos listos» cuenta los obligatorios; la lista trae además los opcionales. El rótulo
  // de la lista dice los dos números, para que no parezcan dos cuentas distintas.
  const optionalCount = steps.filter((s) => s.optional).length
  const stepsLabel =
    optionalCount > 0 && guide.summary.total === steps.length - optionalCount
      ? `Ver los ${guide.summary.total} pasos y ${
          optionalCount === 1 ? 'el opcional' : `los ${optionalCount} opcionales`
        }`
      : guide.summary.total === steps.length
        ? `Ver los ${steps.length} pasos`
        : 'Ver todos los pasos'
  return (
    <HeroPanel tone="crema" className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-center lg:gap-10">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="info">A medio conectar</StatusPill>
            <span className="text-sm text-muted-foreground tabular-nums">{progress}</span>
          </div>
          <h2 className="font-serif text-2xl leading-tight font-semibold tracking-tight text-balance">
            {next
              ? `${next.prefix}: ${next.step.n}. ${next.step.title}`
              : 'Revisá los pasos que faltan.'}
          </h2>
          <Button asChild className="h-12 gap-2 px-5">
            <Link href={next ? `${guideHref}#paso-${next.step.n}` : guideHref}>
              Seguir con la guía
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
        <ArcaCable
          state="in_progress"
          done={guide.summary.done}
          total={guide.summary.total}
          progressText={progress}
        />
      </div>

      {connection?.status === 'cert_ready' ? (
        <Callout tone="info" title="Ya subiste el certificado">
          Falta probar la conexión (paso 9). Antes, fijate que estén hechos los pasos 7 y 8.
        </Callout>
      ) : null}

      {canWrite && connection?.status === 'cert_ready' ? (
        <ArcaTestAction
          slug={slug}
          environment="produccion"
          connection={connection}
          guideHref={guideHref}
        />
      ) : null}

      <details className="group/steps border-t border-border/60 pt-3">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-4 text-muted-foreground transition-transform group-open/steps:rotate-90 motion-reduce:transition-none"
          />
          {stepsLabel}
        </summary>
        <ol className="mt-2 grid gap-1 sm:grid-cols-2">
          {steps.map((s) => (
            <li key={s.id}>
              {/* El título entero, en dos renglones si hace falta (como en el riel de la guía). */}
              <Link
                href={`${guideHref}#paso-${s.n}`}
                className="flex min-h-11 items-start gap-2.5 rounded-lg px-2 py-2 text-sm outline-none transition-colors hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring"
              >
                <GuideStatusDot status={s.status} n={s.n} size="sm" className="mt-px" />
                <span className="min-w-0 flex-1 leading-snug text-pretty">{s.title}</span>
                <span className={cn('shrink-0 pt-0.5 text-xs', GUIDE_STATUS_TEXT_CLASS[s.status])}>
                  {guideStatusText(s.status, s.optional)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </details>
    </HeroPanel>
  )
}

function Datum({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/** Conectado (C) o con un problema (D): el cable, los cuatro datos, la prueba, la emisión y los botones. */
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
    <Panel>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-center lg:gap-10">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={ok ? 'ok' : 'late'}>{connection.statusLabel}</StatusPill>
            <StatusPill tone="muted">{connection.environmentLabel}</StatusPill>
          </div>
          <h2 className="font-serif text-2xl leading-tight font-semibold tracking-tight text-balance">
            {ok ? 'La plataforma ya habla con ARCA.' : 'La conexión con ARCA tiene un problema.'}
          </h2>
        </div>
        <ArcaCable state={ok ? 'connected' : 'error'} />
      </div>

      {!ok && problem ? (
        <Callout
          tone="error"
          title={problem.title}
          className="mt-5"
          action={
            <Button asChild variant="outline" className="h-11 gap-2">
              <Link href={problemStep ? `${guideHref}#paso-${problemStep.n}` : guideHref}>
                Cómo se arregla
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          }
        >
          {problem.body}
        </Callout>
      ) : null}

      <PanelSection>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Datum label="CUIT de la SAS">
            <span className="tabular-nums">
              {connection.representedCuit ? formatCuit(connection.representedCuit) : '—'}
            </span>
          </Datum>
          <Datum label="Punto de venta de la plataforma">
            {connection.pointOfSale ? (
              <span className="font-mono tabular-nums">{padPv(connection.pointOfSale, 4)}</span>
            ) : (
              <Link
                href={`${guideHref}#paso-2`}
                className="rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Sin cargar: paso 2
              </Link>
            )}
          </Datum>
          <Datum label="Certificado">
            <span
              className={cn(
                'text-pretty',
                cert?.tone === 'warning' && 'text-warning-text',
                cert?.tone === 'error' && 'text-destructive',
              )}
            >
              {cert ? cert.text : '—'}
            </span>
            {connection.alias ? (
              <span className="block text-xs text-muted-foreground">
                Alias <span className="font-mono">{connection.alias}</span>
              </span>
            ) : null}
          </Datum>
          <Datum label="Última prueba">
            {connection.lastTestAt ? formatDateTime(connection.lastTestAt) : 'Todavía no'}
          </Datum>
        </dl>
        {cert && cert.tone !== 'ok' && canWrite ? (
          <Callout
            tone={cert.tone === 'error' ? 'error' : 'warning'}
            title={cert.tone === 'error' ? 'Renová el certificado' : 'Renovalo antes de que venza'}
            className="mt-4"
            action={
              <Button asChild variant="outline" className="h-11 gap-2">
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
        ) : null}
      </PanelSection>

      <PanelSection title="Prueba de conexión">
        {canWrite ? (
          <ArcaTestAction
            slug={slug}
            environment="produccion"
            connection={connection}
            guideHref={guideHref}
            showProblem={ok || !problem}
          />
        ) : connection.lastTest ? (
          <ArcaChecksList test={connection.lastTest} guideHref={guideHref} />
        ) : (
          <p className="text-sm text-muted-foreground">Todavía no se probó la conexión.</p>
        )}
      </PanelSection>

      <PanelSection className="space-y-5">
        <ArcaEmissionSwitch slug={slug} connection={connection} readOnly={!canWrite} />
        <ArcaClassesSelect
          slug={slug}
          environment="produccion"
          connection={connection}
          readOnly={!canWrite}
        />
      </PanelSection>

      <PanelSection>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button asChild variant="outline" className="h-11 gap-2">
            <Link href={guideHref}>
              <BookOpen className="size-4" aria-hidden />
              Ver la guía
            </Link>
          </Button>
          {canWrite ? (
            <>
              <Button asChild variant="outline" className="h-11 gap-2">
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
        </div>
      </PanelSection>
    </Panel>
  )
}

/**
 * Ajustes › ARCA: el cable entre el bar y ARCA, en uno de cuatro estados (sin
 * empezar · en curso · conectado · con un problema), las facturas de ARCA que
 * piden atención y, plegadas al final, las pruebas en homologación. La
 * contadora ve todo sin botones de carga. Server component: las acciones son
 * islas de cliente, las mismas de siempre.
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
            <Button asChild variant="outline" className="h-11">
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
