import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import {
  OneBook,
  PaperCases,
  PapersCompare,
  SalesInvoicing,
} from '@/components/administracion/guias/uso/papers'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { GUIDE_PATHS } from '@/lib/accounting/guides'
import { requireGuideAccess } from '../_lib/guide-access'

export const metadata = { title: 'Con factura y sin factura · Guía · Administración' }

/**
 * «Con factura y sin factura», explicado con dibujos: los cuatro papeles lado a lado y qué cambia
 * con cada uno, los casos de todos los días con «dónde lo cargo», y el lado de las ventas (lo
 * facturado se carga por rango en el cierre; el resto queda como venta sin factura).
 *
 * Es contenido fijo, igual para todos los bares: no lee nada de la base. Todo describe lo que el
 * sistema hace; lo único que no cambia nunca es que todo queda en el mismo libro.
 */
export default async function GuiaFacturaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { base } = await requireGuideAccess(tenantSlug, GUIDE_PATHS.invoice)

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={{ href: `${base}${GUIDE_PATHS.home}`, label: 'Volver a la guía' }}
        title="Con factura y sin factura"
        badge={<ReadOnlyBadge />}
        description="Qué cambia según el papel que te dieron, dónde se carga cada caso y cómo se cuenta en las ventas."
      />

      <PapersCompare />
      <OneBook base={base} />
      <PaperCases base={base} />
      <SalesInvoicing base={base} />

      <p className="text-sm text-muted-foreground">
        ¿Y cómo se une una compra con su pago?{' '}
        <Link
          href={`${base}${GUIDE_PATHS.links}`}
          className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Cómo se vincula cada cosa
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </p>
    </AdmPage>
  )
}
