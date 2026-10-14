import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AdmHeader, AdmPage, type ViewPillItem, ViewPills } from '@/components/administracion/kit'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { todayInCordoba } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { ComprasDoor } from './_components/compras-door'
import { DocumentsTab } from './_components/documents-tab'
import {
  HeroSkeleton,
  LibretaSkeleton,
  loadLibreta,
  SorterSkeleton,
  SupplierSorterBlock,
  SuppliersBody,
  SuppliersHeroBlock,
} from './_components/suppliers-tab'
import {
  type ComprasTab,
  comprasHref,
  firstParam,
  isComprasTab,
  legacyComprasRedirect,
} from './_lib/links'
import { requireComprasAccess } from './_lib/page-access'

export const metadata = { title: 'Compras y pagos' }

const TABS: ReadonlyArray<{ value: ComprasTab; label: string }> = [
  { value: 'proveedores', label: 'Proveedores' },
  { value: 'comprobantes', label: 'Comprobantes' },
  { value: 'pagos', label: 'Pagos' },
]

const DESCRIPTIONS: Readonly<Record<ComprasTab, string>> = {
  proveedores: 'Tu libreta de proveedores: a quién le debés, cuánto y desde cuándo.',
  comprobantes: 'Todo lo que compraste y gastaste, con su papel y lo que falta pagar de cada cosa.',
  pagos: 'Lo que les pagaste a proveedores y organismos, y con qué.',
}

/**
 * Compras y pagos: la libreta de cuenta corriente con los proveedores.
 *
 * - **Proveedores** (por defecto): el índice de la libreta. Arriba, «Le debés a
 *   proveedores» y la puerta de carga («¿Qué querés cargar?», tres situaciones);
 *   abajo, un renglón por proveedor con el «desde cuándo» en el margen.
 * - **Comprobantes** y **Pagos**: el diario de lo anotado.
 * - `?filtro=sin-clasificar`, para quien carga: «Clasificar proveedores», un
 *   mazo de fichas (un toque por proveedor). Con `&vista=lista`, la lista común.
 *
 * Las vistas van por URL (`?tab=`); las acciones de carga ya no están en el
 * encabezado (en el celular ni se veían): están en la puerta y en cada renglón.
 * La contadora no ve ninguna. «Gastos fijos» tiene su pantalla
 * (`/administracion/gastos-fijos`); el link viejo redirige.
 */
export default async function ComprasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  // `?tab=gastos-fijos` (links guardados, avisos de antes): la lista se mudó. Esa página vuelve a
  // pedir el acceso, así que redirigir antes de la puerta no muestra nada.
  const moved = legacyComprasRedirect(tenantSlug, sp)
  if (moved) redirect(moved)
  const rawTab = firstParam(sp.tab)
  const tab: ComprasTab = isComprasTab(rawTab) ? rawTab : 'proveedores'
  const { access, canWrite } = await requireComprasAccess(tenantSlug, comprasHref(tenantSlug, tab))
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  // «Clasificar proveedores»: la pantalla entera es el mazo (sin héroe, puerta ni franja).
  const sorting =
    tab === 'proveedores' &&
    canWrite &&
    firstParam(sp.filtro) === 'sin-clasificar' &&
    firstParam(sp.vista) !== 'lista'

  if (sorting) {
    const libreta = loadLibreta(tenantId, canWrite)
    return (
      <AdmPage>
        <AdmHeader
          title="Clasificar proveedores"
          description="Decí una sola vez en qué le comprás a cada uno. Es un toque por proveedor."
          back={{ href: comprasHref(tenantSlug), label: 'Compras y pagos' }}
        />
        <Suspense fallback={<SorterSkeleton />}>
          <SupplierSorterBlock data={libreta} tenantSlug={tenantSlug} sp={sp} />
        </Suspense>
      </AdmPage>
    )
  }

  const views: ViewPillItem[] = TABS.map((t) => ({
    key: t.value,
    label: t.label,
    href: comprasHref(tenantSlug, t.value),
    active: t.value === tab,
  }))
  const libreta = tab === 'proveedores' ? loadLibreta(tenantId, canWrite) : null

  return (
    <AdmPage>
      <AdmHeader
        title="Compras y pagos"
        description={DESCRIPTIONS[tab]}
        badge={<ReadOnlyBadge />}
      />
      <ViewPills label="Vistas de Compras y pagos" items={views} />

      {libreta ? (
        <>
          {/* El número y la puerta. La puerta no espera a nadie: pinta con el encabezado. */}
          <div className="grid gap-5 lg:grid-cols-12 lg:items-start">
            <Suspense fallback={<HeroSkeleton className={heroSpan(canWrite)} />}>
              <SuppliersHeroBlock
                data={libreta}
                tenantSlug={tenantSlug}
                className={heroSpan(canWrite)}
              />
            </Suspense>
            <ComprasDoor tenantSlug={tenantSlug} className="lg:col-span-5" />
          </div>
          <Suspense fallback={<LibretaSkeleton />}>
            <SuppliersBody
              data={libreta}
              tenantSlug={tenantSlug}
              sp={sp}
              today={today}
              canWrite={canWrite}
            />
          </Suspense>
        </>
      ) : (
        <DocumentsTab
          mode={tab === 'pagos' ? 'pagos' : 'comprobantes'}
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          sp={sp}
          today={today}
          canWrite={canWrite}
        />
      )}

      <QuickActionsBar />
    </AdmPage>
  )
}

/** Sin la puerta (la contadora), el número ocupa todo el ancho. */
function heroSpan(canWrite: boolean): string {
  return cn(canWrite ? 'lg:col-span-7' : 'lg:col-span-12')
}
