'use client'

import { useSearchParams } from 'next/navigation'
import { AdmPage } from '@/components/administracion/kit/adm-page'
import { HeaderSkeleton, PortadaSkeleton, RoomSkeleton } from './_components/room-skeleton'
import { roomOfTab } from './_lib/rooms'

/**
 * Ajustes mientras carga, con la forma de lo que viene: la portada
 * (encabezado, el bloque de la puesta en marcha, los seis objetos y el cajón)
 * o, si la URL ya pide una habitación, el esqueleto de ESA habitación. Es un
 * componente de cliente solo para leer `?tab=`: un `loading.tsx` no recibe
 * los parámetros de búsqueda.
 */
export default function AjustesLoading() {
  const room = roomOfTab(useSearchParams().get('tab'))
  return (
    <AdmPage width="comfortable">
      <HeaderSkeleton back={room !== null} />
      {room ? <RoomSkeleton room={room} /> : <PortadaSkeleton />}
    </AdmPage>
  )
}
