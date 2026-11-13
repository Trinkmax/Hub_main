'use client'

import { usePathname } from 'next/navigation'
import { PullToRefresh } from './pull-to-refresh'

/**
 * El cuerpo del salón. Las pantallas de siempre van en una columna angosta con «tirar para actualizar».
 * Las del punto de venta (mapa, mesa, caja) ocupan todo el ancho y manejan su propio alto: el mapa es una
 * maqueta, no una lista, y se actualiza sola en vivo.
 */
const FULL_BLEED = /^\/[^/]+\/salon\/(mapa|mesa|caja)(\/|$)/
/** El mapa y la mesa traen su propia barra de arriba (una sola, con la sucursal, los sectores o la mesa). */
export const OWN_TOPBAR = /^\/[^/]+\/salon\/(mapa|mesa)(\/|$)/
/** La tele de cocina no lleva nada alrededor: ni barra de arriba ni pestañas. */
export const BARE = /^\/[^/]+\/salon\/tele(\/|$)/
/**
 * La mesa es una pantalla de un solo trabajo: se llega desde el mapa y se vuelve con la flecha. Sin las
 * pestañas, la acción principal (enviar, servir, cobrar) queda al borde del pulgar y las tandas ganan lugar.
 */
export const NO_TABBAR = /^\/[^/]+\/salon\/mesa(\/|$)/

export function SalonMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (BARE.test(pathname)) return <main className="flex-1">{children}</main>
  // Sin pestañas, el alto de la barra vale cero para lo que haya adentro (la pantalla mide `100dvh`).
  if (NO_TABBAR.test(pathname))
    return <main className="flex-1 [--salon-tabbar-h:0px]">{children}</main>
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
