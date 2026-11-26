import { ArrowLeft, ArrowUpRight, ClipboardList, Pencil, RotateCw } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { formatDateTime } from '@/lib/dates'
import {
  countedResultIds,
  type ExamSummary,
  formatAverage,
  formatExamDuration,
  parseExamResultsOrder,
  sortExamResults,
  summarizeExamResults,
} from '@/lib/landings/exam-results'
import { getLandingPage, listExamResults } from '@/lib/landings/queries'
import { getLandingsBase } from '@/lib/landings/urls'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { cn } from '@/lib/utils'
import { DeleteResultButton } from './_components/delete-result-button'

export const metadata = { title: 'Resultados del examen' }

// Cada vez que alguien termina, aparece una fila nueva: nada que guardar de antemano.
export const dynamic = 'force-dynamic'

/** Por debajo de esto (6 de cada 10) una estación o una nota se marca en rojo. */
const WEAK = 0.6

const percent = (ratio: number) => `${Math.round(ratio * 100)} %`

/** La oración del número grande: lo que Nacho necesita para decidir si pasan al difícil. */
function verdict(summary: ExamSummary): string {
  const { takers, good, goodFrom, total } = summary
  if (goodFrom === null || total === null) return ''
  if (takers === 1) {
    return good === 1
      ? `Le fue bien: sacó ${goodFrom} o más.`
      : `Todavía no llegó a ${goodFrom} de ${total}.`
  }
  if (good === takers) return `A todos les fue bien: sacaron ${goodFrom} o más.`
  if (good === 0) return `Nadie llegó a ${goodFrom} de ${total}.`
  return `A ${good} de ${takers} les fue bien (${goodFrom} o más).`
}

export default async function ResultadosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; pageId: string }>
  searchParams: Promise<{ orden?: string | string[] }>
}) {
  const { tenantSlug, pageId } = await params
  const { orden } = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const page = await getLandingPage(access.tenant.id, pageId)
  if (!page) notFound()

  const [results, landingsBase] = await Promise.all([
    listExamResults(access.tenant.id, page.id),
    getLandingsBase(),
  ])

  const base = `/${tenantSlug}/paginas/${page.id}/resultados`
  const publicUrl = `${landingsBase}/${page.slug}`
  const order = parseExamResultsOrder(orden)

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/paginas`}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Páginas · Resultados
          </Link>
        }
        title={page.title}
        description="Cada vez que alguien termina el examen, su nota aparece acá sola. Para el promedio cuenta el primer intento de cada persona."
        actions={
          // shrink-0: con un título largo, los dos botones se apilaban en vez de ir en fila.
          <div className="flex shrink-0 items-center gap-2">
            {page.published ? (
              <Button asChild variant="outline" size="sm">
                <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                  Ver el examen
                  <ArrowUpRight className="size-4" aria-hidden />
                </a>
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${tenantSlug}/paginas/${page.id}`}>
                <Pencil className="size-4" aria-hidden />
                Editar
              </Link>
            </Button>
          </div>
        }
      />

      {results === null ? (
        <div className="grid justify-items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">No pudimos traer los resultados.</p>
          <Button asChild variant="outline" size="sm">
            <Link href={base}>
              <RotateCw className="size-4" aria-hidden />
              Reintentar
            </Link>
          </Button>
        </div>
      ) : results.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Todavía nadie lo rindió"
          description="Cuando alguien termine el examen, su nota aparece acá sola. Pasales el link para que lo hagan desde el celular."
          action={
            page.published ? (
              <CopyButton value={publicUrl} label="Copiar el link" copiedLabel="¡Copiado!" />
            ) : null
          }
        />
      ) : (
        <Results
          tenantSlug={tenantSlug}
          pageId={page.id}
          base={base}
          order={order}
          results={results}
        />
      )}
    </PageShell>
  )
}

function Results({
  tenantSlug,
  pageId,
  base,
  order,
  results,
}: {
  tenantSlug: string
  pageId: string
  base: string
  order: ReturnType<typeof parseExamResultsOrder>
  results: NonNullable<Awaited<ReturnType<typeof listExamResults>>>
}) {
  const summary = summarizeExamResults(results)
  const counted = countedResultIds(results)
  const rows = sortExamResults(results, order, counted)

  return (
    <div className="grid gap-10">
      {/* El número grande y la oración: cuántos lo rindieron y si les fue bien. */}
      <section aria-label="Resumen" className="grid gap-2">
        <p className="flex items-baseline gap-3">
          <span className="font-display text-6xl font-semibold leading-none tabular-nums">
            {summary.takers}
          </span>
          <span className="text-lg text-muted-foreground">
            {summary.takers === 1 ? 'persona lo rindió' : 'personas lo rindieron'}
          </span>
        </p>
        <p className="max-w-2xl text-lg text-pretty">
          {summary.average !== null && summary.total !== null ? (
            <>
              Promedio{' '}
              <strong className="font-semibold tabular-nums">
                {formatAverage(summary.average)} de {summary.total}
              </strong>
              . {verdict(summary)}
            </>
          ) : null}
        </p>
        {summary.repeats > 0 ? (
          <p className="text-sm text-muted-foreground">
            {summary.repeats === 1
              ? 'Un intento repetido no cuenta para el promedio.'
              : `${summary.repeats} intentos repetidos no cuentan para el promedio.`}
          </p>
        ) : null}
      </section>

      {summary.stations.length > 1 || summary.hardest.length > 0 ? (
        <div className="grid gap-10 lg:grid-cols-2">
          {summary.stations.length > 1 ? (
            <section aria-labelledby="por-estacion" className="grid content-start gap-4">
              <h2 id="por-estacion" className="font-serif text-xl font-semibold tracking-tight">
                Por estación
              </h2>
              <ul className="grid gap-3">
                {summary.stations.map((station) => {
                  const weak = station.ratio < WEAK
                  return (
                    <li key={station.name} className="grid gap-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium">{station.name}</span>
                        <span
                          className={cn('tabular-nums', weak && 'font-medium text-destructive')}
                        >
                          {percent(station.ratio)} bien
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            weak ? 'bg-destructive/80' : 'bg-primary',
                          )}
                          style={{ width: `${Math.round(station.ratio * 100)}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          {summary.hardest.length > 0 ? (
            <section aria-labelledby="mas-costo" className="grid content-start gap-4">
              <h2 id="mas-costo" className="font-serif text-xl font-semibold tracking-tight">
                Lo que más les costó
              </h2>
              <ol className="grid gap-4">
                {summary.hardest.map((question) => (
                  <li key={question.question} className="grid gap-1">
                    <p className="font-medium text-pretty">{question.question}</p>
                    <p className="text-sm text-muted-foreground text-pretty">
                      Se equivocaron {question.wrong} de {question.asked}
                      {question.station ? ` · ${question.station}` : ''}. Era:{' '}
                      <span className="text-foreground">{question.right}</span>
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="uno-por-uno" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="uno-por-uno" className="font-serif text-xl font-semibold tracking-tight">
            Uno por uno
          </h2>
          <nav aria-label="Ordenar" className="flex items-center gap-1 text-sm">
            <SortLink href={base} active={order === 'nota'}>
              Por nota
            </SortLink>
            <SortLink href={`${base}?orden=recientes`} active={order === 'recientes'}>
              Más recientes
            </SortLink>
          </nav>
        </div>

        <ul className="divide-y divide-border/70 border-y border-border/70">
          {rows.map((result) => {
            const repeated = !counted.has(result.id)
            const wrong = result.answers.filter((answer) => !answer.ok)
            const ratio = result.total > 0 ? result.score / result.total : 0
            return (
              <li key={result.id} className="grid gap-2 py-3.5">
                <div className="flex items-start gap-3">
                  <div className={cn('grid min-w-0 flex-1 gap-1', repeated && 'opacity-70')}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{result.name}</span>
                      {repeated ? (
                        <Badge variant="outline">Lo volvió a rendir · no cuenta</Badge>
                      ) : null}
                      {result.leftScreen > 0 ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 text-amber-700 dark:text-amber-400"
                        >
                          Salió de la pantalla{' '}
                          {result.leftScreen === 1 ? '1 vez' : `${result.leftScreen} veces`}
                        </Badge>
                      ) : null}
                    </div>
                    {result.stations.length > 1 ? (
                      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                        {result.stations.map((station) => (
                          <span
                            key={station.name}
                            className={cn(
                              'tabular-nums',
                              station.of > 0 &&
                                station.ok / station.of < WEAK &&
                                'text-destructive',
                            )}
                          >
                            {station.name} {station.ok}/{station.of}
                          </span>
                        ))}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(result.createdAt)} ·{' '}
                      {formatExamDuration(result.durationSeconds)}
                      {result.attempt > 1 ? ` · intento ${result.attempt} en ese celular` : ''}
                    </p>
                  </div>
                  <p
                    className={cn(
                      'shrink-0 text-right font-display text-2xl font-semibold leading-none tabular-nums',
                      ratio < WEAK && 'text-destructive',
                      repeated && 'opacity-70',
                    )}
                  >
                    {result.score}
                    <span className="text-sm font-normal text-muted-foreground">
                      {' '}
                      de {result.total}
                    </span>
                  </p>
                  <DeleteResultButton
                    tenantSlug={tenantSlug}
                    pageId={pageId}
                    resultId={result.id}
                    name={result.name}
                  />
                </div>

                {wrong.length > 0 ? (
                  <details className="text-sm">
                    <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">
                      Ver lo que tuvo mal ({wrong.length})
                    </summary>
                    <ul className="mt-2 grid gap-3 border-l-2 border-border pl-3">
                      {wrong.map((answer) => (
                        <li key={answer.question} className="grid gap-0.5">
                          <p className="font-medium text-pretty">{answer.question}</p>
                          <p className="text-destructive text-pretty">
                            {answer.picked === null
                              ? 'No respondió a tiempo.'
                              : `Puso: ${answer.picked}`}
                          </p>
                          <p className="text-pretty text-primary">Era: {answer.right}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function SortLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-full px-3 py-1.5 transition-colors',
        active
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </Link>
  )
}
