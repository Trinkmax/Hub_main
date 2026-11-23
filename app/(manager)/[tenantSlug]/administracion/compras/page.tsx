import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { SimplePage } from '@/components/administracion/planilla'
import { todayInCordoba } from '@/lib/dates'
import { ComprasCashTray } from './_components/cash-tray'
import { DocumentsTab } from './_components/documents-tab'
import {
  LibretaSkeleton,
  loadLibreta,
  SorterSkeleton,
  SupplierSorterBlock,
  SuppliersBody,
} from './_components/suppliers-tab'
import {
  type ComprasTab,
  comprasHref,
  firstParam,
  isComprasTab,
  isUuidLike,
  legacyComprasRedirect,
} from './_lib/links'
import { requireComprasAccess } from './_lib/page-access'

export const metadata = { title: 'Compras y pagos' }

/**
 * Compras y pagos: las planillas de lo que se le debe a cada uno.
 *
 * - **Proveedores** (por defecto): el totalizador y una fila por proveedor, cada una lleva a su
 *   cuenta corriente.
 * - **Comprobantes** (`?tab=comprobantes`): lo anotado, con un segmento Compras · Pagos adentro
 *   (`&ver=pagos`). `?tab=pagos` sigue valiendo: redirige ahí.
 * - `?filtro=sin-clasificar`, para quien carga: «Clasificar proveedores», un mazo de fichas (un toque
 *   por proveedor). Con `&vista=lista`, la lista común.
 *
 * Las solapas las dibuja `AdmNav`; las vistas van por URL (`?tab=`). La contadora ve lo mismo, sin
 * ningún botón de carga. «Gastos fijos» tiene su pantalla (`/administracion/gastos-fijos`); el link
 * viejo redirige.
 *
 * Con el nivel «solo compras y pagos» es la pantalla de entrada a Administración: ve lo mismo (la base
 * le devuelve solo proveedores y sus comprobantes), carga compras y pagos, y no tiene «Agregar de una
 * lista» ni los exportes.
 *
 * Por sucursal (entrega 1): los saldos de cada proveedor y los comprobantes son los de la sucursal que se
 * mira; en «Todas», todo, y cada comprobante dice de qué sucursal es. Los proveedores son del bar.
 *
 * Arriba, para quien carga y solo si hay: «De la caja del salón», los retiros que la caja anotó como
 * pago a un proveedor y todavía no tienen comprobante. `?caja=<retiro>` (el link que arma la caja del
 * salón) o `?retiro=<retiro>` lo marcan. Con una hoja abierta (`?accion=`), `caja` es la caja de la
 * hoja, como siempre.
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
  // `?tab=gastos-fijos` y `?tab=pagos` (links guardados, avisos de antes) se mudaron. El destino
  // vuelve a pedir el acceso, así que redirigir antes de la puerta no muestra nada.
  const moved = legacyComprasRedirect(tenantSlug, sp)
  if (moved) redirect(moved)
  const rawTab = firstParam(sp.tab)
  const tab: ComprasTab = isComprasTab(rawTab) ? rawTab : 'proveedores'
  // Una de las tres pantallas que también abre el nivel «solo compras y pagos».
  const { access, canWrite, branch, purchasesOnly } = await requireComprasAccess(
    tenantSlug,
    comprasHref(tenantSlug, tab),
    { level: 'purchases' },
  )
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  // «Clasificar proveedores»: la pantalla entera es el mazo.
  const sorting =
    tab === 'proveedores' &&
    canWrite &&
    firstParam(sp.filtro) === 'sin-clasificar' &&
    firstParam(sp.vista) !== 'lista'

  if (sorting) {
    return (
      <SimplePage width="narrow">
        <Link
          href={comprasHref(tenantSlug)}
          className="-ml-1.5 inline-flex min-h-9 items-center gap-1 justify-self-start rounded-md px-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none pointer-coarse:min-h-11"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Proveedores
        </Link>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Clasificar proveedores</h1>
        <Suspense fallback={<SorterSkeleton />}>
          <SupplierSorterBlock
            data={loadLibreta(tenantId, canWrite, branch.id)}
            tenantSlug={tenantSlug}
            sp={sp}
          />
        </Suspense>
      </SimplePage>
    )
  }

  const payments = firstParam(sp.ver) === 'pagos'
  const retiro = firstParam(sp.retiro) || (firstParam(sp.accion) === '' ? firstParam(sp.caja) : '')
  return (
    <SimplePage>
      <h1 className="sr-only">
        {tab === 'proveedores' ? 'Proveedores' : payments ? 'Pagos' : 'Comprobantes'}
      </h1>
      {canWrite ? (
        <Suspense fallback={null}>
          <ComprasCashTray
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            branchId={branch.id}
            highlightId={isUuidLike(retiro) ? retiro : null}
          />
        </Suspense>
      ) : null}
      {tab === 'proveedores' ? (
        <Suspense fallback={<LibretaSkeleton />}>
          <SuppliersBody
            data={loadLibreta(tenantId, canWrite, branch.id)}
            tenantSlug={tenantSlug}
            sp={sp}
            today={today}
            canWrite={canWrite}
            purchasesOnly={purchasesOnly}
          />
        </Suspense>
      ) : (
        <DocumentsTab
          mode={payments ? 'pagos' : 'comprobantes'}
          tenantId={tenantId}
          branch={branch.filter}
          tenantSlug={tenantSlug}
          sp={sp}
          today={today}
          canWrite={canWrite}
          purchasesOnly={purchasesOnly}
        />
      )}
    </SimplePage>
  )
}
