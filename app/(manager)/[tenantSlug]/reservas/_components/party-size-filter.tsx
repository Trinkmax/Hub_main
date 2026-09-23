'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { PartySizeChips } from '@/components/reservations/party-size-chips'
import type { PartySizeBucket, PartySizeTally } from '@/lib/salon/party-size'

/**
 * La fila "Personas por mesa" de la lista /reservas: los chips compartidos
 * (`components/reservations/party-size-chips`) enchufados a la URL.
 *
 * El filtro vive en `?mesa=` como el de servicio en `?servicio=`: la pantalla
 * entera (listado, paginado, total del encabezado y el link de Exportar) se
 * arma en el server a partir de la URL, así que el link se puede compartir por
 * WhatsApp con un socio y muestra exactamente lo mismo. Al cambiar de tamaño
 * se borra `page`: la página 3 del filtro anterior no existe en el nuevo.
 *
 * Anda igual en vista por día y por rango — los conteos los calcula la página.
 */
export function PartySizeFilter({
  tenantSlug,
  tally,
  active,
}: {
  tenantSlug: string
  tally: PartySizeTally
  active: PartySizeBucket | null
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  function push(bucket: PartySizeBucket | null) {
    const next = new URLSearchParams(sp?.toString() ?? '')
    if (bucket) next.set('mesa', bucket)
    else next.delete('mesa')
    next.delete('page')
    const qs = next.toString()
    startTransition(() => router.push(`/${tenantSlug}/reservas${qs ? `?${qs}` : ''}`))
  }

  return (
    <PartySizeChips
      tally={tally}
      active={active}
      onSelect={push}
      disabled={pending}
      data-tour="reservas-personas-por-mesa"
    />
  )
}
