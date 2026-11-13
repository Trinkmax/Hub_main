import { cn } from '@/lib/utils'

/**
 * La barra de arriba de las pantallas del punto de venta. Reemplaza a la del salón (que en estas rutas no
 * se dibuja): una sola fila con lo que la pantalla necesita —dónde estás, los sectores, la mesa— y la
 * cuenta de quien está trabajando a la derecha. Así el contenido (el mapa, la comanda) se queda con el
 * resto de la pantalla.
 *
 * Mide lo mismo que la del salón (`--salon-topbar-h`) y respeta el borde seguro del teléfono.
 */
export function PosTopbar({
  children,
  account,
  className,
  style,
}: {
  children: React.ReactNode
  /** El botón de la cuenta (`<AccountSheet>`), armado en la página. */
  account?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <header className={cn('pos-topbar', className)} style={style}>
      <div className="pos-topbar-row">
        {children}
        {account ? <div className="pos-topbar-account">{account}</div> : null}
      </div>
    </header>
  )
}
