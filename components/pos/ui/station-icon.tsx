import {
  Beef,
  Beer,
  CakeSlice,
  ChefHat,
  Coffee,
  CookingPot,
  Croissant,
  CupSoda,
  Fish,
  Flame,
  Hamburger,
  IceCreamCone,
  type LucideIcon,
  type LucideProps,
  Martini,
  Pizza,
  Salad,
  Sandwich,
  Soup,
  Utensils,
  Wine,
} from 'lucide-react'
import { type StationIconKey, stationIconKey } from '@/lib/pos/kitchen/station-kind'

/**
 * El ícono de una estación de cocina (catálogo en `lib/pos/kitchen/station-kind.ts`).
 *
 * Son los de Lucide, los mismos del resto de la app, dibujados «a dos tintas»: el trazo entero y un
 * relleno suave del mismo color. A 14 píxeles sobre la bandera de una mesa un contorno solo se pierde;
 * con el relleno se reconoce la forma (un gorro, una hamburguesa, una pizza, una copa) de un vistazo.
 */
const ICONS: Record<StationIconKey, LucideIcon> = {
  chef: ChefHat,
  burger: Hamburger,
  pizza: Pizza,
  cocktail: Martini,
  pot: CookingPot,
  flame: Flame,
  grill: Beef,
  pasta: Soup,
  salad: Salad,
  sandwich: Sandwich,
  fish: Fish,
  cake: CakeSlice,
  croissant: Croissant,
  icecream: IceCreamCone,
  coffee: Coffee,
  wine: Wine,
  beer: Beer,
  soda: CupSoda,
  plate: Utensils,
}

type Props = Omit<LucideProps, 'ref'> & {
  /** La clave del ícono, o lo que haya guardado la estación (vale también un emoji del primer día). */
  icon: string | null | undefined
  /** Sin el relleno suave: para tamaños grandes, donde el contorno solo ya se lee. */
  flat?: boolean
}

export function StationIcon({ icon, flat = false, strokeWidth = 2.2, ...props }: Props) {
  const Icon = ICONS[stationIconKey(icon) ?? 'plate']
  return (
    <Icon
      aria-hidden
      strokeWidth={strokeWidth}
      {...(flat ? {} : { fill: 'currentColor', fillOpacity: 0.2 })}
      {...props}
    />
  )
}
