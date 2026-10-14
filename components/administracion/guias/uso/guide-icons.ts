import {
  BanknoteArrowDown,
  CalendarCheck,
  CalendarClock,
  FileClock,
  HandCoins,
  Landmark,
  type LucideIcon,
  ReceiptText,
  Scale,
  ScrollText,
  ShoppingBasket,
  Undo2,
  Wallet,
} from 'lucide-react'
import type { RecipeId } from '@/lib/accounting/guides'

/**
 * El ícono de cada receta. Las que entran por el lanzador «¿Qué querés cargar?» llevan el MISMO
 * ícono que su tarjeta de allá: la persona lo reconoce cuando va a cargar.
 */
export const RECIPE_ICON: Readonly<Record<RecipeId, LucideIcon>> = {
  cierre: ReceiptText,
  gasto: ShoppingBasket,
  compra: FileClock,
  'sin-factura': ScrollText,
  'pagar-deuda': HandCoins,
  'gasto-fijo': CalendarClock,
  cobro: BanknoteArrowDown,
  'contar-caja': Scale,
  'mercado-pago': Wallet,
  arca: Landmark,
  corregir: Undo2,
  'fin-de-mes': CalendarCheck,
}
