import { Recipes } from '@/components/administracion/guias/uso/recipes'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { GUIDE_PATHS, GUIDE_RECIPES } from '@/lib/accounting/guides'
import { settleQuery } from '@/lib/accounting/queries'
import { getOnboarding } from '@/lib/accounting/queries/onboarding'
import { Callout } from '../../ajustes/_components/form-bits'
import { requireGuideAccess } from '../_lib/guide-access'

export const metadata = { title: 'El día a día · Guía · Administración' }

/**
 * «El día a día, paso a paso»: las recetas de la guía, una por situación. Cada una se abre con su
 * ancla (`#receta-cierre`, desde el mapa, «¿Qué pasó?» o la rutina), muestra la pantalla simulada
 * al lado de los pasos y termina con «Hacerlo ahora», que abre la pantalla o la hoja real.
 *
 * Las que son rutina dicen solas si estás al día (`acc_report_onboarding`); si esa lectura falla
 * se ven igual, sin marcas. La contadora las lee sin botones de carga.
 */
export default async function GuiaDiaADiaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { access, base, canWrite } = await requireGuideAccess(tenantSlug, GUIDE_PATHS.daily)

  const onboarding = await settleQuery(getOnboarding(access.tenant.id))

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={{ href: `${base}${GUIDE_PATHS.home}`, label: 'Volver a la guía' }}
        title="El día a día, paso a paso"
        badge={<ReadOnlyBadge />}
        description={`${GUIDE_RECIPES.length} situaciones. En cada una: qué tocar, cómo saber que quedó bien y qué hacer si algo sale mal.`}
      />

      {canWrite ? null : (
        <Callout tone="info" title="Las cargan los dueños">
          Podés leerlas para ver cómo llega cada cosa a los libros. Los botones de carga no aparecen
          en modo lectura.
        </Callout>
      )}

      <Recipes base={base} overview={onboarding.ok ? onboarding.data : null} />

      <QuickActionsBar />
    </AdmPage>
  )
}
