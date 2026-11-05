import { TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { PRow, PTd } from '@/components/administracion/planilla'
import { Button } from '@/components/ui/button'
import {
  ONBOARDING_ITEMS,
  type OnboardingHowTo,
  type OnboardingItemId,
  type OnboardingState,
} from '@/lib/accounting/onboarding'
import { guideStep } from '@/lib/arca/guide'
import type { ArcaOverview } from '@/lib/arca/views'
import { formatDate } from '@/lib/dates'
import { IMPORT_SOURCE_COPY } from '@/lib/imports/ui/labels'
import { HowToFor } from './how-to-slot'

/**
 * Las filas de la portada de la guía para lo de una sola vez (la Puesta en marcha y Conectar ARCA),
 * con su avance, y las mini guías para bajar los tres archivos. Server-safe; las lecturas las hace
 * la página y llegan ya resueltas.
 */

/** Una lectura que puede fallar (el `QueryOutcome` de `settleQuery`). */
type Outcome<T> = { ok: true; data: T } | { ok: false; message: string }

function GuideRow({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action: ReactNode
}) {
  return (
    <PRow>
      <PTd className="font-medium whitespace-nowrap">{title}</PTd>
      <PTd className="text-pretty">{children}</PTd>
      <PTd align="right">{action}</PTd>
    </PRow>
  )
}

const ITEM_TITLE: ReadonlyMap<OnboardingItemId, string> = new Map(
  ONBOARDING_ITEMS.map((item) => [item.id, item.title]),
)

/** La Puesta en marcha: el avance y lo próximo. */
export function OnboardingGuideRow({
  href,
  outcome,
  retry,
}: {
  href: string
  /** `data: null`: la base todavía no da el estado (la guía va sin marcas). */
  outcome: Outcome<{ state: OnboardingState } | null>
  /** El botón «Reintentar» (lo pone la página) si la lectura falló. */
  retry?: ReactNode
}) {
  const state = outcome.ok ? (outcome.data?.state ?? null) : null
  const nextTitle = state?.next ? ITEM_TITLE.get(state.next) : null
  return (
    <GuideRow
      title="Puesta en marcha"
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={href}>Ir</Link>
        </Button>
      }
    >
      {state ? (
        <>
          {/* El número es el de lo de una sola vez: el mismo «N de M» de la franja del Resumen. */}
          <span className="tabular-nums">
            {state.sections.day1.done} de {state.sections.day1.total} listos
          </span>
          {nextTitle ? (
            <span className="block text-xs text-muted-foreground">Lo próximo: {nextTitle}</span>
          ) : null}
        </>
      ) : outcome.ok ? (
        <span className="text-muted-foreground">Todavía no marca tu avance sola.</span>
      ) : (
        <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
          No pudimos ver tu avance. Se abre igual.
          {retry}
        </span>
      )}
    </GuideRow>
  )
}

/** «Conectar ARCA»: cómo va la conexión de producción y el paso que toca. */
export function ArcaGuideRow({
  href,
  outcome,
  retry,
}: {
  href: string
  outcome: Outcome<ArcaOverview>
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
      <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
        No pudimos ver cómo va la conexión. Se abre igual.
        {retry}
      </span>
    )
  } else if (connected) {
    body = (
      <>
        Ya está conectado
        {connection?.pointOfSale ? ` con el punto de venta ${connection.pointOfSale}` : ''}.
        {certificate?.notAfter ? (
          <span
            className={
              certificate.renewSoon || certificate.expired
                ? 'flex items-start gap-1.5 text-xs text-warning-text'
                : 'block text-xs text-muted-foreground'
            }
          >
            {certificate.renewSoon || certificate.expired ? (
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            ) : null}
            {certificate.expired
              ? `El certificado venció el ${formatDate(certificate.notAfter)}: hay que renovarlo.`
              : certificate.renewSoon
                ? `El certificado vence el ${formatDate(certificate.notAfter)}: renovalo antes.`
                : `El certificado vence el ${formatDate(certificate.notAfter)}.`}
          </span>
        ) : null}
      </>
    )
  } else {
    body = (
      <>
        <span className="tabular-nums">
          {summary.done} de {summary.total} pasos hechos
        </span>
        {summary.next ? (
          <span className="block text-xs text-muted-foreground">
            Te toca: {guideStep(summary.next).title}
          </span>
        ) : null}
        {connection?.status === 'error' ? (
          <span className="flex items-start gap-1.5 text-xs text-warning-text">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {connection.lastError?.title ?? 'La última prueba de conexión dio error.'}
          </span>
        ) : null}
      </>
    )
  }

  return (
    <GuideRow
      title="Conectar ARCA"
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={href}>Ir</Link>
        </Button>
      }
    >
      {body}
    </GuideRow>
  )
}

const DOWNLOADS: ReadonlyArray<{
  source: OnboardingHowTo
  title: string
  subtitle: string
  when: string
  importLabel: string
  importPath: string
}> = [
  {
    source: 'mis_comprobantes',
    title: 'Compras de ARCA',
    subtitle: '«Mis Comprobantes» › Recibidos',
    when: 'Una vez por mes, del día 11 en adelante.',
    importLabel: IMPORT_SOURCE_COPY.arca_recibidos.cta,
    importPath: '/importar/arca',
  },
  {
    source: 'mercado_pago',
    title: 'Mercado Pago',
    subtitle: 'Reporte de «Liquidaciones»',
    when: 'Una vez por semana, desde la compu.',
    importLabel: IMPORT_SOURCE_COPY.mp_release.cta,
    importPath: '/importar/mercado-pago',
  },
  {
    source: 'banco',
    title: 'Banco',
    subtitle: 'Movimientos de la cuenta',
    when: 'Una vez por semana: muchos bancos guardan solo los últimos 3 meses.',
    importLabel: IMPORT_SOURCE_COPY.bank_statement.cta,
    importPath: '/importar/banco',
  },
]

/**
 * Los tres archivos que se suben: cuál es cada uno, cuándo se baja, adónde se sube y el «¿Cómo lo
 * bajo?» con los pasos. Va adentro de un plegable de la portada.
 */
export function DownloadGuides({ base, canWrite }: { base: string; canWrite: boolean }) {
  return (
    <ul className="divide-y divide-border/60">
      {DOWNLOADS.map((d) => (
        <li key={d.source} className="space-y-2 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="min-w-0">
              <h3 className="text-sm font-medium">{d.title}</h3>
              <p className="text-xs text-muted-foreground text-pretty">
                {d.subtitle} · {d.when}
              </p>
            </div>
            {canWrite ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`${base}${d.importPath}`}>{d.importLabel}</Link>
              </Button>
            ) : null}
          </div>
          <HowToFor source={d.source} className="border-transparent bg-secondary/50" />
        </li>
      ))}
    </ul>
  )
}
