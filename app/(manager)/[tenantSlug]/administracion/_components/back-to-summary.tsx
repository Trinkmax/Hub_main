'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

/** «Volver al Resumen» desde el 404 de la sección (el not-found no recibe params). */
export function BackToSummary() {
  const params = useParams<{ tenantSlug?: string }>()
  const slug = typeof params.tenantSlug === 'string' ? params.tenantSlug : ''
  return (
    <Button asChild className="h-11 md:h-9">
      <Link href={slug ? `/${slug}/administracion` : '/'}>Volver al Resumen</Link>
    </Button>
  )
}
