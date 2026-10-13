import { ChevronDown } from 'lucide-react'
import {
  ArcaGuideCard,
  DownloadGuides,
  OnboardingGuideCard,
} from '@/components/administracion/guias/onboarding/guides-index'
import {
  BigLinks,
  GuideGlossary,
  RecipeTiles,
  RoutinePanel,
} from '@/components/administracion/guias/uso/cover'
import { StationMap } from '@/components/administracion/guias/uso/station-map'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { GUIDE_PATHS, guideRoutine, stationStates } from '@/lib/accounting/guides'
import { settleQuery } from '@/lib/accounting/queries'
import { getOnboarding } from '@/lib/accounting/queries/onboarding'
import { getArcaOverview } from '@/lib/arca/queries'
import { RetryButton } from '../_resumen/retry-button'
import { requireGuideAccess } from './_lib/guide-access'

export const metadata = { title: 'Guía · Administración' }

/**
 * La portada de la guía: «Cómo se usa Administración». En este orden:
 *
 * 1. El MAPA: las cinco paradas (vendés → comprás y gastás → pagás → controlás la plata → fin de
 *    mes), qué mueve cada una en la plata y, con lo que ya hay cargado, cuál te toca.
 * 2. «¿Qué pasó?»: las doce recetas por situación, que abren su paso a paso en «El día a día».
 * 3. Los dos temas que más confunden (con y sin factura, cómo se vincula) y la rutina de cada
 *    día, cada semana y cada mes, con su estado real.
 * 4. La puesta en marcha: «Cómo arrancar» y «Conectar ARCA», como ya estaban, con su avance.
 * 5. Cómo bajar los tres archivos que se suben, y el glosario.
 *
 * Nada se abre solo ni se marca a mano: la guía se lee porque la persona quiere, y el avance
 * sale de `acc_report_onboarding`. Si esa lectura falla, la guía se ve entera, sin marcas (cada
 * lectura va por su lado con `settleQuery`). La contadora la ve igual, sin botones de carga.
 */
export default async function GuiasPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params
  const { access, base, canWrite } = await requireGuideAccess(tenantSlug, GUIDE_PATHS.home)
  const tenantId = access.tenant.id

  const [onboarding, arca] = await Promise.all([
    settleQuery(getOnboarding(tenantId)),
    settleQuery(getArcaOverview(tenantId)),
  ])
  const overview = onboarding.ok ? onboarding.data : null

  return (
    <AdmPage>
      <AdmHeader
        title="Cómo se usa Administración"
        badge={<ReadOnlyBadge />}
        description="Qué cargar, dónde y qué mueve cada cosa. Empezá por el mapa: después, cada situación tiene su paso a paso."
      />

      <StationMap base={base} states={stationStates(overview)} />

      <section aria-labelledby="guia-que-paso" className="space-y-4 pt-2">
        <header className="space-y-1">
          <h2
            id="guia-que-paso"
            className="font-serif text-2xl leading-tight font-semibold tracking-tight"
          >
            ¿Qué pasó?
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
            Elegí la situación y te mostramos cómo se carga: qué tocar, cómo saber que quedó bien y
            qué hacer si algo sale mal.
          </p>
        </header>
        <RecipeTiles base={base} />
      </section>

      <div className="grid gap-4 pt-2 xl:grid-cols-12">
        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-5 xl:grid-cols-1">
          <BigLinks base={base} />
        </div>
        <div className="min-w-0 xl:col-span-7">
          <RoutinePanel
            base={base}
            groups={guideRoutine(overview)}
            note={
              onboarding.ok ? null : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 text-pretty">
                    No pudimos ver cómo venís. La rutina es la misma: seguila igual.
                  </p>
                  <RetryButton />
                </div>
              )
            }
          />
        </div>
      </div>

      <section aria-labelledby="guia-puesta-en-marcha" className="space-y-4 pt-2">
        <header className="space-y-1">
          <h2
            id="guia-puesta-en-marcha"
            className="font-serif text-2xl leading-tight font-semibold tracking-tight"
          >
            Puesta en marcha
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
            Lo que se hace una sola vez, para que después el día a día sea corto.
          </p>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          <OnboardingGuideCard
            href={`${base}${GUIDE_PATHS.start}`}
            outcome={onboarding}
            canWrite={canWrite}
            retry={<RetryButton />}
          />
          <ArcaGuideCard
            href={`${base}${GUIDE_PATHS.arca}`}
            outcome={arca}
            canWrite={canWrite}
            retry={<RetryButton />}
          />
        </div>
        {/* Las mini guías de los tres archivos siguen acá (y en cada importador), plegadas: en
            las recetas de Mercado Pago y de ARCA van además al lado de cada paso. */}
        <details className="group card-hairline rounded-2xl border bg-card shadow-xs">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 outline-none hover:bg-cream-tint/60 focus-visible:ring-2 focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-pretty">
                ¿Cómo bajo los archivos de ARCA, Mercado Pago y el banco?
              </span>
              <span className="block text-sm text-muted-foreground text-pretty">
                Con esos tres archivos la plataforma arma sola casi todas las compras y los cobros.
              </span>
            </span>
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="border-t border-border/60 px-4 py-5 sm:px-5">
            <DownloadGuides base={base} canWrite={canWrite} />
          </div>
        </details>
      </section>

      <GuideGlossary />

      <QuickActionsBar />
    </AdmPage>
  )
}
