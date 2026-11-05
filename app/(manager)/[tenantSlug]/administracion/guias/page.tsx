import Link from 'next/link'
import {
  ArcaGuideRow,
  DownloadGuides,
  OnboardingGuideRow,
} from '@/components/administracion/guias/onboarding/guides-index'
import {
  GuideFold,
  GuideGlossary,
  RecipeTable,
  RoutineTable,
  SectionsTable,
} from '@/components/administracion/guias/uso/cover'
import { OpenFoldFromHash } from '@/components/administracion/guias/uso/open-fold-from-hash'
import {
  Planilla,
  PlanillaTitle,
  PRow,
  PTable,
  PTd,
  PTh,
  SimplePage,
} from '@/components/administracion/planilla'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { GUIDE_PATHS, guideRoutine } from '@/lib/accounting/guides'
import { settleQuery } from '@/lib/accounting/queries'
import { getOnboarding } from '@/lib/accounting/queries/onboarding'
import { getArcaOverview } from '@/lib/arca/queries'
import { RetryButton } from '../_resumen/retry-button'
import { requireGuideAccess } from './_lib/guide-access'

export const metadata = { title: 'Guía · Administración' }

/**
 * La portada de la guía, corta: «¿Qué pasó?» (cada situación con dónde se carga y su paso a paso),
 * la rutina con su estado real, y una planilla con lo demás: los dos temas que más confunden y lo
 * de una sola vez. Plegado, lo de consulta: dónde está cada cosa, cómo bajar los archivos y el
 * glosario.
 *
 * Nada se abre solo ni se marca a mano: el avance sale de `acc_report_onboarding`. Si esa lectura
 * falla, la guía se ve entera, sin marcas (cada lectura va por su lado con `settleQuery`). La
 * contadora la ve igual, sin botones de carga.
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
    <SimplePage width="narrow">
      <h1 className="sr-only">Guía</h1>
      <ReadOnlyBadge className="w-fit" />

      {canWrite && overview && !overview.data.openingDone ? (
        // El bar recién arrancado (todavía sin saldos iniciales): lo primero es lo de una sola vez.
        <p className="text-sm text-pretty">
          <span className="font-medium">¿Recién arrancás?</span>{' '}
          <Link
            href={`${base}${GUIDE_PATHS.start}`}
            className="rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Empezá por la Puesta en marcha
          </Link>
        </p>
      ) : null}

      <RecipeTable base={base} />

      <RoutineTable
        base={base}
        groups={guideRoutine(overview)}
        note={
          onboarding.ok ? null : (
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
              <p className="min-w-0 text-pretty">
                No pudimos ver cómo venís. La rutina es la misma: seguila igual.
              </p>
              <RetryButton />
            </div>
          )
        }
      />

      <Planilla>
        <PlanillaTitle title="Lo demás" />
        <PTable label="Lo de una sola vez y los temas que más confunden" minWidth={480}>
          <thead>
            <tr>
              <PTh>Tema</PTh>
              <PTh>Qué tiene</PTh>
              <PTh>
                <span className="sr-only">Ir</span>
              </PTh>
            </tr>
          </thead>
          <tbody>
            <OnboardingGuideRow
              href={`${base}${GUIDE_PATHS.start}`}
              outcome={onboarding}
              retry={<RetryButton />}
            />
            <ArcaGuideRow
              href={`${base}${GUIDE_PATHS.arca}`}
              outcome={arca}
              retry={<RetryButton />}
            />
            <PRow>
              <PTd className="font-medium whitespace-nowrap">Con factura y sin factura</PTd>
              <PTd className="text-pretty">
                Los cuatro papeles y qué cambia con cada uno. Todo queda en el mismo libro.
              </PTd>
              <PTd align="right">
                <Button asChild size="sm" variant="outline">
                  <Link href={`${base}${GUIDE_PATHS.invoice}`}>Ir</Link>
                </Button>
              </PTd>
            </PRow>
            <PRow>
              <PTd className="font-medium whitespace-nowrap">Cómo se vincula cada cosa</PTd>
              <PTd className="text-pretty">
                La compra con su pago, el gasto con su gasto fijo, lo importado con lo que cargaste.
              </PTd>
              <PTd align="right">
                <Button asChild size="sm" variant="outline">
                  <Link href={`${base}${GUIDE_PATHS.links}`}>Ir</Link>
                </Button>
              </PTd>
            </PRow>
          </tbody>
        </PTable>
      </Planilla>

      <GuideFold id="donde" title="Dónde está cada cosa">
        <SectionsTable base={base} />
      </GuideFold>
      <GuideFold id="archivos" title="¿Cómo bajo los archivos de ARCA, Mercado Pago y el banco?">
        <DownloadGuides base={base} canWrite={canWrite} />
      </GuideFold>
      <GuideGlossary />
      <OpenFoldFromHash />
    </SimplePage>
  )
}
