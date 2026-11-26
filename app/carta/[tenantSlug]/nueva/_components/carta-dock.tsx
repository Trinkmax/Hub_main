'use client'

import { BookOpen, Gift, Search, WalletCards } from 'lucide-react'
import { useMemo } from 'react'
import { type DockItem, LiquidDock } from '@/components/shell/dock/liquid-dock'

/**
 * La barra de abajo de la carta: la misma cápsula de vidrio del panel (`components/shell/dock`), con lo
 * que un cliente necesita tener siempre a un pulgar de distancia.
 *
 * - **Carta**: vuelve al inicio (o sube, si ya está ahí).
 * - **Club / Billetera**: abre el alta del club o la billetera de quien ya es socio.
 * - **El círculo**: buscar, en el lugar donde iOS pone su buscador.
 *
 * Reemplaza al «labio» verde fijo de antes, que solo abría el club y ocupaba todo el ancho.
 */
export function CartaDock({
  member,
  hidden,
  onCarta,
  onClub,
  onSearch,
}: {
  /** Este celular ya tiene una sesión del club. */
  member: boolean
  hidden: boolean
  onCarta: () => void
  onClub: () => void
  onSearch: () => void
}): React.JSX.Element {
  const items = useMemo<DockItem[]>(
    () => [
      {
        key: 'carta',
        label: 'Carta',
        title: 'Inicio de la carta',
        icon: BookOpen,
        onSelect: onCarta,
      },
      {
        key: 'club',
        label: member ? 'Billetera' : 'Club',
        title: member ? 'Mi billetera' : 'Club de beneficios',
        icon: member ? WalletCards : Gift,
        onSelect: onClub,
        opensDialog: true,
      },
    ],
    [member, onCarta, onClub],
  )

  return (
    <LiquidDock
      items={items}
      activeKey="carta"
      label="Carta"
      scope="carta"
      hidden={hidden}
      orb={{
        label: 'Buscar en la carta',
        content: <Search className="size-[1.4rem]" strokeWidth={2} aria-hidden />,
        onPress: onSearch,
      }}
    />
  )
}
