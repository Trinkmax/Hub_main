import { cn } from '@/lib/utils'
import './pos-brand.css'

export type PosBrandInfo = {
  /** El nombre del bar: lo que se lee si no cargó un logo. */
  name: string
  /** `tenants.logo_url` (Configuración › Apariencia). */
  logoUrl: string | null
}

/**
 * La marca del bar en las pantallas del punto de venta (pedido de los socios, 22/11/2026: «agregar
 * el logo en el margen inferior derecho»).
 *
 * Va como una marca de agua sobre el paño: no es un botón ni ocupa una franja. El logo se pinta con
 * máscara (el archivo pone la silueta y el color lo pone la pantalla), así el mismo PNG sale crema
 * sobre el verde del salón y sobre el negro de la cocina, sea del bar que sea. Sin logo cargado, el
 * nombre del bar en la letra del punto de venta.
 */
export function PosBrand({ brand, className }: { brand: PosBrandInfo; className?: string }) {
  const name = brand.name.trim()
  if (!brand.logoUrl) {
    if (!name) return null
    return <span className={cn('pos-brand is-name', className)}>{name}</span>
  }
  const url = `url("${brand.logoUrl.replace(/["\\\n\r]/g, '')}")`
  return (
    <span
      role="img"
      aria-label={name || 'Logo del bar'}
      className={cn('pos-brand is-logo', className)}
      style={{ WebkitMaskImage: url, maskImage: url }}
    />
  )
}
