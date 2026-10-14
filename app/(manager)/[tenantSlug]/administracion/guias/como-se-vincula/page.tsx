import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { LinksDetail, LinksMap } from '@/components/administracion/guias/uso/links'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { GUIDE_PATHS } from '@/lib/accounting/guides'
import { requireGuideAccess } from '../_lib/guide-access'

export const metadata = { title: 'Cómo se vincula cada cosa · Guía · Administración' }

/**
 * «Cómo se vincula cada cosa»: el dibujo de las nueve uniones (el proveedor con su categoría, la
 * compra con su pago, el gasto con su gasto fijo, lo importado con lo cargado a mano…) y, por cada
 * una, cuatro datos: qué es, dónde se hace, qué pasa si no y cómo se deshace. Dice también lo que
 * hoy no se puede.
 *
 * Contenido fijo, igual para todos los bares: no lee nada de la base.
 */
export default async function GuiaVinculosPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { base } = await requireGuideAccess(tenantSlug, GUIDE_PATHS.links)

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={{ href: `${base}${GUIDE_PATHS.home}`, label: 'Volver a la guía' }}
        title="Cómo se vincula cada cosa"
        badge={<ReadOnlyBadge />}
        description="Vincular es decirle a la plataforma que dos cosas van juntas: esta plata pagó esta factura, este gasto es el alquiler del mes."
      />

      <LinksMap />
      <LinksDetail base={base} />

      <p className="text-sm text-muted-foreground">
        ¿Y qué cambia si no te dieron factura?{' '}
        <Link
          href={`${base}${GUIDE_PATHS.invoice}`}
          className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Con factura y sin factura
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </p>
    </AdmPage>
  )
}
