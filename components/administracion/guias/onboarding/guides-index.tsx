import {
  ArrowRight,
  Landmark,
  ListChecks,
  type LucideIcon,
  PlugZap,
  Receipt,
  TriangleAlert,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  ONBOARDING_ITEMS,
  type OnboardingHowTo,
  type OnboardingItemId,
  type OnboardingState,
} from '@/lib/accounting/onboarding'
import { guideStep } from '@/lib/arca/guide'
import type { ArcaOverview } from '@/lib/arca/views'
import { formatDate } from '@/lib/dates'
import { HowToFor } from './how-to-slot'

/**
 * El índice de Guías (diseño §5.2.1): las dos guías paso a paso con su avance
 * y las mini guías para bajar los tres archivos que carga la plataforma.
 * Server-safe; las lecturas las hace la página y llegan ya resueltas.
 */

/** Una lectura que puede fallar (el `QueryOutcome` de `settleQuery`). */
type Outcome<T> = { ok: true; data: T } | { ok: false; message: string }

/** Botones a lo ancho en el celular (44 px) y a su medida desde `sm`. */
const BUTTON = 'h-11 w-full gap-2 sm:w-auto md:h-9'

function IconBox({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary shadow-2xs">
      <Icon className="size-5" aria-hidden="true" />
    </div>
  )
}

function GuideIndexCard({
  icon,
  titleId,
  title,
  description,
  badge,
  children,
  action,
}: {
  icon: LucideIcon
  titleId: string
  title: string
  description: string
  badge?: ReactNode
  children: ReactNode
  action: ReactNode
}) {
  return (
    <Card
      role="group"
      aria-labelledby={titleId}
      className="card-hairline relative h-full gap-4 border-border/70 bg-card/85 p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <IconBox icon={icon} />
        {badge}
      </div>
      <div className="space-y-1">
        <h2 id={titleId} className="font-serif text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
      <div className="mt-auto pt-1">{action}</div>
    </Card>
  )
}

function ProgressLine({ done, total, unit }: { done: number; total: number; unit: string }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <>
      <p className="flex items-baseline gap-1.5 text-sm">
        <span className="font-semibold tabular-nums text-foreground">
          {done} de {total}
        </span>
        <span className="text-muted-foreground">{unit}</span>
      </p>
      <Progress value={percent} aria-label={`${done} de ${total} ${unit}`} />
    </>
  )
}

const ITEM_TITLE: ReadonlyMap<OnboardingItemId, string> = new Map(
  ONBOARDING_ITEMS.map((item) => [item.id, item.title]),
)

/** «Cómo arrancar»: el avance de la guía y lo próximo. */
export function OnboardingGuideCard({
  href,
  outcome,
  canWrite,
  retry,
}: {
  href: string
  /** `data: null`: la base todavía no da el estado (la guía va sin marcas). */
  outcome: Outcome<{ state: OnboardingState } | null>
  /** Quien solo mira (la contadora) la abre para ver cómo van. */
  canWrite: boolean
  /** El botón «Reintentar» (lo pone la página) si la lectura falló. */
  retry?: ReactNode
}) {
  const state = outcome.ok ? (outcome.data?.state ?? null) : null
  const nextTitle = state?.next ? ITEM_TITLE.get(state.next) : null
  const allDone = state !== null && state.done === state.total
  return (
    <GuideIndexCard
      icon={ListChecks}
      titleId="guia-arranque"
      title="Cómo arrancar"
      description="Qué se carga una sola vez, qué todos los días y qué hace la plataforma sola: dónde, qué y cómo."
      badge={
        allDone ? (
          <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
            Todo al día
          </Badge>
        ) : null
      }
      action={
        <Button asChild className={BUTTON}>
          <Link href={href}>
            {!canWrite || allDone
              ? 'Ver la guía'
              : state && state.done > 0
                ? 'Seguir con la guía'
                : 'Abrir la guía'}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      }
    >
      {state ? (
        <>
          <ProgressLine done={state.done} total={state.total} unit="listos" />
          {nextTitle ? (
            <p className="text-sm text-pretty">
              <span className="text-muted-foreground">Lo próximo: </span>
              <span className="font-medium">{nextTitle}</span>
            </p>
          ) : null}
        </>
      ) : outcome.ok ? (
        <p className="text-sm text-muted-foreground text-pretty">
          Todavía no marca tu avance sola, pero ya podés usarla como lista.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground text-pretty">
            No pudimos ver tu avance. La guía se abre igual.
          </p>
          {retry}
        </>
      )}
    </GuideIndexCard>
  )
}

/** «Conectar ARCA»: cómo va la conexión de producción y el paso que toca. */
export function ArcaGuideCard({
  href,
  outcome,
  canWrite,
  retry,
}: {
  href: string
  outcome: Outcome<ArcaOverview>
  /** Quien solo mira ve la guía; conectar es de los dueños con acceso de carga. */
  canWrite: boolean
  /** El botón «Reintentar» (lo pone la página) si la lectura falló. */
  retry?: ReactNode
}) {
  const connection = outcome.ok ? outcome.data.connections.produccion : null
  const summary = outcome.ok ? outcome.data.guide.produccion.summary : null
  const connected = connection?.status === 'connected'
  const certificate = connection?.certificate ?? null

  let body: ReactNode
  if (!outcome.ok || !summary) {
    body = (
      <>
        <p className="text-sm text-muted-foreground text-pretty">
          No pudimos ver cómo va la conexión. La guía se abre igual.
        </p>
        {retry}
      </>
    )
  } else if (connected) {
    body = (
      <>
        <p className="text-sm text-pretty">
          ARCA ya está conectado
          {connection?.pointOfSale ? ` con el punto de venta ${connection.pointOfSale}` : ''}.
        </p>
        {certificate?.notAfter ? (
          <p
            className={
              certificate.renewSoon || certificate.expired
                ? 'flex items-start gap-1.5 text-sm text-warning-text'
                : 'text-sm text-muted-foreground'
            }
          >
            {certificate.renewSoon || certificate.expired ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : null}
            {certificate.expired
              ? `El certificado venció el ${formatDate(certificate.notAfter)}: hay que renovarlo.`
              : certificate.renewSoon
                ? `El certificado vence el ${formatDate(certificate.notAfter)}: renovalo antes.`
                : `El certificado vence el ${formatDate(certificate.notAfter)}.`}
          </p>
        ) : null}
      </>
    )
  } else {
    body = (
      <>
        <ProgressLine done={summary.done} total={summary.total} unit="pasos hechos" />
        {summary.next ? (
          <p className="text-sm text-pretty">
            <span className="text-muted-foreground">Te toca: </span>
            <span className="font-medium">{guideStep(summary.next).title}</span>
          </p>
        ) : null}
        {connection?.status === 'error' ? (
          <p className="flex items-start gap-1.5 text-sm text-warning-text text-pretty">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {connection.lastError?.title ?? 'La última prueba de conexión dio error.'}
          </p>
        ) : null}
      </>
    )
  }

  const started = Boolean(summary && summary.done > 0)
  return (
    <GuideIndexCard
      icon={PlugZap}
      titleId="guia-arca"
      title="Conectar ARCA"
      description="ARCA es la ex AFIP. Conectarla sirve para completar proveedores y clientes con solo la CUIT y para facturar desde acá. Unos 40 minutos, una sola vez."
      badge={
        connected ? (
          <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
            Conectado
          </Badge>
        ) : null
      }
      action={
        <Button asChild variant={connected || !canWrite ? 'outline' : 'default'} className={BUTTON}>
          <Link href={href}>
            {connected || !canWrite
              ? 'Ver la guía'
              : started
                ? 'Seguir conectando'
                : 'Empezar a conectar'}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      }
    >
      {body}
    </GuideIndexCard>
  )
}

const DOWNLOADS: ReadonlyArray<{
  source: OnboardingHowTo
  icon: LucideIcon
  title: string
  subtitle: string
  what: string
  when: string
  importLabel: string
  importPath: string
}> = [
  {
    source: 'mis_comprobantes',
    icon: Receipt,
    title: 'Compras de ARCA',
    subtitle: '«Mis Comprobantes» › Recibidos',
    what: 'Todas las facturas que te hicieron a la CUIT de la SAS. Con ellas se arman las compras y los proveedores.',
    when: 'Una vez por mes, del día 11 en adelante.',
    importLabel: 'Importar de ARCA',
    importPath: '/importar/arca',
  },
  {
    source: 'mercado_pago',
    icon: Wallet,
    title: 'Mercado Pago',
    subtitle: 'Reporte de «Liquidaciones»',
    what: 'Cada cobro con su comisión, sus impuestos y lo que te acreditaron.',
    when: 'Una vez por semana, desde la compu.',
    importLabel: 'Importar Mercado Pago',
    importPath: '/importar/mercado-pago',
  },
  {
    source: 'banco',
    icon: Landmark,
    title: 'Banco',
    subtitle: 'Movimientos de la cuenta',
    what: 'Los gastos bancarios, las transferencias y los pagos.',
    when: 'Una vez por semana: muchos bancos guardan solo los últimos 3 meses.',
    importLabel: 'Importar del banco',
    importPath: '/importar/banco',
  },
]

/** «Bajá los archivos»: qué es cada uno, cuándo, el «¿Cómo lo bajo?» y adónde se sube. */
export function DownloadGuides({ base, canWrite }: { base: string; canWrite: boolean }) {
  return (
    <section aria-labelledby="guias-archivos" className="space-y-4">
      <header className="space-y-1">
        <h2 id="guias-archivos" className="font-serif text-xl font-semibold tracking-tight">
          Bajá los archivos
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
          Con tres archivos la plataforma arma sola las compras, los cobros y los gastos del banco.
          Vos los bajás y los subís; ella hace el resto.
        </p>
      </header>
      <ul className="space-y-6">
        {DOWNLOADS.map((d) => (
          <li
            key={d.source}
            className="grid gap-4 border-t border-border/60 pt-6 first:border-t-0 first:pt-0 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-6"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <IconBox icon={d.icon} />
                <div className="min-w-0">
                  <h3 className="font-serif text-lg font-semibold leading-tight tracking-tight">
                    {d.title}
                  </h3>
                  <p className="text-xs text-muted-foreground">{d.subtitle}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground text-pretty">{d.what}</p>
              <p className="text-sm text-pretty">
                <span className="font-medium">Cuándo: </span>
                <span className="text-muted-foreground">{d.when}</span>
              </p>
              {canWrite ? (
                <Button asChild variant="outline" className={BUTTON}>
                  <Link href={`${base}${d.importPath}`}>
                    {d.importLabel}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              ) : null}
            </div>
            <div className="min-w-0">
              <HowToFor source={d.source} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
