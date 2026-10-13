import { FileDown, FilePlus2, HandCoins, Plus } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ActionButton, QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { SectionNav } from '@/components/administracion/section-nav'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { todayInCordoba } from '@/lib/dates'
import { importSourceHref } from '@/lib/imports/ui/labels'
import { DocumentsTab } from './_components/documents-tab'
import { SuppliersTab } from './_components/suppliers-tab'
import {
  type ComprasTab,
  comprasHref,
  firstParam,
  isComprasTab,
  legacyComprasRedirect,
  newPurchaseHref,
} from './_lib/links'
import { requireComprasAccess } from './_lib/page-access'

export const metadata = { title: 'Compras y pagos' }

const TABS: ReadonlyArray<{ value: ComprasTab; label: string }> = [
  { value: 'proveedores', label: 'Proveedores' },
  { value: 'comprobantes', label: 'Comprobantes' },
  { value: 'pagos', label: 'Pagos' },
]

const DESCRIPTIONS: Readonly<Record<ComprasTab, string>> = {
  proveedores: 'Lo que le debés a cada proveedor, qué está vencido y qué vence esta semana.',
  comprobantes: 'Las facturas, notas y gastos que cargaste, con lo que falta pagar de cada uno.',
  pagos: 'Lo que les pagaste a proveedores y organismos.',
}

/** Para quien carga: dónde están la compra y el pago de cada proveedor (el menú de su fila). */
const PROVEEDORES_HINT = ' Con el ⋯ de cada uno le cargás una compra o un pago.'

/**
 * Compras y pagos (H.7; hasta el 12/10/2026, «Compras y proveedores»):
 * pestañas por URL (`?tab=`), las acciones de carga en el encabezado (en el
 * celular, en la barra de abajo) y nada de botones de carga para la contadora.
 * «Gastos fijos» ya no es una pestaña de acá: tiene la suya en Administración
 * (`/administracion/gastos-fijos`), y el link viejo redirige.
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

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title={
          <>
            Compras y pagos
            <ReadOnlyBadge />
          </>
        }
        description={
          tab === 'proveedores' && canWrite
            ? `${DESCRIPTIONS.proveedores}${PROVEEDORES_HINT}`
            : DESCRIPTIONS[tab]
        }
        actions={
          canWrite ? (
            <div className="hidden flex-wrap items-center gap-2 lg:flex">
              <Button asChild variant="outline" className="gap-2">
                <Link href={importSourceHref(tenantSlug, 'arca_recibidos')}>
                  <FileDown className="size-4" aria-hidden />
                  Importar de ARCA
                </Link>
              </Button>
              <Button asChild variant="outline" className="gap-2">
                <Link href={newPurchaseHref(tenantSlug)}>
                  <FilePlus2 className="size-4" aria-hidden />
                  Nueva factura
                </Link>
              </Button>
              <ActionButton action="pagar" variant="outline" className="gap-2">
                <HandCoins className="size-4" aria-hidden />
                Pagar
              </ActionButton>
              <ActionButton action="gasto" className="gap-2">
                <Plus className="size-4" aria-hidden />
                Nuevo gasto
              </ActionButton>
            </div>
          ) : null
        }
      />

      <SectionNav
        label="Secciones de Compras"
        active={tab}
        items={TABS.map((t) => ({
          value: t.value,
          label: t.label,
          href: comprasHref(tenantSlug, t.value),
        }))}
      />

      {tab === 'proveedores' ? (
        <SuppliersTab
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          sp={sp}
          today={today}
          canWrite={canWrite}
        />
      ) : (
        <DocumentsTab
          mode={tab}
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          sp={sp}
          today={today}
          canWrite={canWrite}
        />
      )}

      <QuickActionsBar />
    </PageShell>
  )
}
