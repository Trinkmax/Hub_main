import type { Viewport } from 'next'
import '../entradas.css'

/**
 * La sala: todas las páginas públicas de entradas van a oscuras, siempre (no
 * siguen el tema del panel). La barra del celular también: sin esto, en un
 * iPhone en modo claro quedaba una franja crema arriba de la pantalla negra.
 */
export const viewport: Viewport = {
  themeColor: '#090d0b',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function EntradasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ent">
      <div className="ent-grain" aria-hidden />
      {children}
    </div>
  )
}
