'use client'

import { usePathname } from 'next/navigation'
import { PullToRefresh } from './pull-to-refresh'

/**
 * El cuerpo del salón. Las pantallas de siempre van en una columna angosta con «tirar para actualizar».
 * Las del punto de venta (mapa, mesa, caja) ocupan todo el ancho y manejan su propio alto: el mapa es una
 * maqueta, no una lista, y se actualiza sola en vivo.
 */
const FULL_BLEED = /^\/[^/]+\/salon\/(mapa|mesa|caja)(\/|$)/

export function SalonMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (FULL_BLEED.test(pathname)) {
    return <main className="flex-1 pb-[var(--salon-tabbar-h)]">{children}</main>
  }
  return (
    <main className="flex-1 pb-[calc(var(--salon-tabbar-h)+1rem)] pt-3">
      <PullToRefresh>
        <div className="mx-auto w-full max-w-screen-md px-4">{children}</div>
      </PullToRefresh>
    </main>
  )
}
