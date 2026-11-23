'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useAccountingOptional } from '@/components/administracion/accounting-provider'
import { Button } from '@/components/ui/button'

/**
 * «Volver al Resumen» desde el 404 de la sección (el not-found no recibe params). Quien tiene el nivel
 * «solo compras y pagos» no tiene Resumen: vuelve a Compras, que es su pantalla de entrada.
 */
export function BackToSummary() {
  const params = useParams<{ tenantSlug?: string }>()
  const slug = typeof params.tenantSlug === 'string' ? params.tenantSlug : ''
  const buyer = useAccountingOptional()?.purchasesOnly === true
  const base = slug ? `/${slug}/administracion` : '/'
  return (
    <Button asChild className="h-11 md:h-9">
      <Link href={buyer && slug ? `${base}/compras` : base}>
        {buyer ? 'Volver a Compras' : 'Volver al Resumen'}
      </Link>
    </Button>
  )
}
