/* Las columnas de paneles del Resumen, escritas enteras (Tailwind las busca como texto).
   Las usan la página y su esqueleto, para que la pantalla no salte al llegar los datos. */

/** Una sola columna en angosto; desde 58rem de ancho real, una grilla de 12 con dos columnas. */
export const PANEL_GRID =
  'flex flex-col gap-6 @min-[58rem]:grid @min-[58rem]:grid-cols-12 @min-[58rem]:items-start'

/** La columna ancha (7 de 12). En angosto no tiene caja (`contents`): sus paneles se ordenan solos. */
export const WIDE_COLUMN =
  'contents @min-[58rem]:col-span-7 @min-[58rem]:flex @min-[58rem]:min-w-0 @min-[58rem]:flex-col @min-[58rem]:gap-6'

/** La columna angosta (5 de 12), con la misma regla. */
export const NARROW_COLUMN =
  'contents @min-[58rem]:col-span-5 @min-[58rem]:flex @min-[58rem]:min-w-0 @min-[58rem]:flex-col @min-[58rem]:gap-6'

/** En una sola columna: ventas, pagos, entró y salió, en qué se gastó. */
export const PANEL_ORDER = [
  'min-w-0 order-1',
  'min-w-0 order-2',
  'min-w-0 order-3',
  'min-w-0 order-4',
] as const
