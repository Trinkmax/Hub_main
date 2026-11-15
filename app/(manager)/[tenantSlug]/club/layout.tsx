import type { ReactNode } from 'react'
import { SectionTabsLayout } from '@/components/shell/section-tabs-server'

/**
 * Clientes › Club: el editor del programa (puntos y niveles, aliados, bienvenida, tarjetas de sellos)
 * y el simulador de la billetera, con las pestañas de Clientes arriba. El Club era su propia entrada del
 * menú hasta el 15/11/2026; ahora es parte de Clientes (todo lo de fidelización junto).
 */
export default async function ClubLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  return (
    <SectionTabsLayout section="clientes" tenantSlug={tenantSlug}>
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
    </SectionTabsLayout>
  )
}
