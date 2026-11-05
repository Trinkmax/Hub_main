'use client'

import { useSearchParams } from 'next/navigation'
import { AdmPage } from '@/components/administracion/kit/adm-page'
import { SimplePage } from '@/components/administracion/planilla'
import { HeaderSkeleton, PortadaSkeleton, RoomSkeleton } from './_components/room-skeleton'
import { roomOfTab } from './_lib/rooms'

/**
 * Ajustes mientras carga, con la forma de lo que viene: la portada (la puesta en
 * marcha y una fila por habitación) o, si la URL ya pide una habitación, el
 * esqueleto de ESA habitación. Es un componente de cliente solo para leer
 * `?tab=`: un `loading.tsx` no recibe los parámetros de búsqueda.
 */
export default function AjustesLoading() {
  const room = roomOfTab(useSearchParams().get('tab'))
  if (room === null) {
    return (
      <SimplePage width="narrow">
        <PortadaSkeleton />
      </SimplePage>
    )
  }
  return (
    <AdmPage width="comfortable">
      <HeaderSkeleton back />
      <RoomSkeleton room={room} />
    </AdmPage>
  )
}
