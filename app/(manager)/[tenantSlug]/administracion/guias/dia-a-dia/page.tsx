import { Recipes } from '@/components/administracion/guias/uso/recipes'
import { GuideSubHeader } from '@/components/administracion/guias/uso/sub-header'
import { SimplePage } from '@/components/administracion/planilla'
import { GUIDE_PATHS } from '@/lib/accounting/guides'
import { settleQuery } from '@/lib/accounting/queries'
import { getOnboarding } from '@/lib/accounting/queries/onboarding'
import { Callout } from '../../ajustes/_components/form-bits'
import { requireGuideAccess } from '../_lib/guide-access'

export const metadata = { title: 'El día a día · Guía · Administración' }

/**
 * «El día a día, paso a paso»: las recetas de la guía, una por situación. Cada una se abre con su
 * ancla (`#receta-cierre`, desde «¿Qué pasó?» o la rutina) y termina con su botón, que abre la
 * pantalla o la hoja real.
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
    <SimplePage>
      <GuideSubHeader base={base} title="El día a día, paso a paso" />

      {canWrite ? null : (
        <Callout tone="info" title="Las cargan los dueños">
          Podés leerlas para ver cómo llega cada cosa a los libros. Los botones de carga no aparecen
          en modo lectura.
        </Callout>
      )}

      <Recipes base={base} overview={onboarding.ok ? onboarding.data : null} />
    </SimplePage>
  )
}
