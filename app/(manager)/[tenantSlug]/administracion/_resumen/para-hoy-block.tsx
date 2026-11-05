import { RetryButton } from '@/components/administracion/kit/retry-button'
import { Planilla, PlanillaTitle, PRow, PTable, PTd } from '@/components/administracion/planilla'
import { heroState } from '@/lib/accounting/home'
import { cn } from '@/lib/utils'
import { HomeActionButton } from './home-action'
import type { HomeData } from './home-data'
import { paraHoyRows } from './para-hoy'

/**
 * «Para hoy»: lo que hay que hacer, en renglones con su botón. Máximo cinco, y solo lo que toca: el
 * cierre que falta, el Plan de la semana, lo vencido más urgente, lo de ARCA y la puesta en marcha.
 *
 * Un solo botón relleno en la pantalla: el del primer renglón, salvo que el panel de arriba ya ofrezca
 * el paso que lo destraba («Cargar lo que había»).
 */
export async function ParaHoyBlock({ data }: { data: HomeData }) {
  const [agenda, summary, settings, recurring, weekPlan, onboarding, integration] =
    await Promise.all([
      data.agenda,
      data.summary,
      data.settings,
      data.recurring,
      data.weekPlan,
      data.onboarding,
      data.integration,
    ])

  const settingsData = settings.ok ? settings.data : null
  const hero = summary.ok
    ? heroState(summary.data, settingsData, { canWrite: data.canWrite, base: data.base })
    : null
  const heroHasAction = hero?.kind === 'unknown' && hero.action !== null

  const rows = paraHoyRows({
    items: agenda.today,
    setup: agenda.setup,
    setupCountKnown: summary.ok || (onboarding.ok && onboarding.data !== null),
    summary: summary.ok ? summary.data : null,
    recurring: recurring.ok ? recurring.data : null,
    weekPlan: weekPlan.ok ? weekPlan.data : null,
    // Quien solo lee no recibe estos avisos (no los puede resolver); si fallaron, se dice.
    integration: integration === null ? [] : integration.ok ? integration.data : null,
    booksStartDate: settingsData?.booksStartDate ?? null,
    today: data.today,
    base: data.base,
  })
  const filled = heroHasAction ? null : (rows.find((row) => row.action !== null)?.key ?? null)

  return (
    <Planilla>
      <PlanillaTitle title="Para hoy" />
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          {summary.ok ? 'Está todo al día.' : 'Puede faltar algo: no cargó el resumen.'}
        </p>
      ) : (
        <PTable label="Para hoy" minWidth={0}>
          <tbody>
            {rows.map((row) => (
              <PRow key={row.key}>
                <PTd>
                  <span className="font-semibold">{row.title}</span>
                  {row.detail ? (
                    <span
                      className={cn(
                        'ml-1.5 max-sm:ml-0 max-sm:block',
                        row.late ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {row.detail}
                    </span>
                  ) : null}
                </PTd>
                <PTd align="right" className="w-px">
                  {row.action ? (
                    <HomeActionButton
                      action={row.action}
                      variant={row.key === filled ? 'default' : 'outline'}
                      className="min-h-10 px-3 py-1 whitespace-nowrap sm:min-h-8"
                    />
                  ) : row.retry ? (
                    <RetryButton />
                  ) : null}
                </PTd>
              </PRow>
            ))}
          </tbody>
        </PTable>
      )}
    </Planilla>
  )
}
