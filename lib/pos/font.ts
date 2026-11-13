import { Archivo } from 'next/font/google'

/**
 * La letra del punto de venta: Archivo, una grotesca argentina (Omnibus-Type) con eje de ancho.
 * Angosta y pesada para números de mesa, cantidades y rótulos que se leen de lejos; normal para el texto.
 * Se carga solo en las pantallas del punto de venta (no en el layout raíz), así el resto de la app no la baja.
 */
export const posFont = Archivo({
  subsets: ['latin'],
  variable: '--font-pos',
  axes: ['wdth'],
  display: 'swap',
})
