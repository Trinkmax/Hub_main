import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * El «Exportar» de UN cuadro de «Por evento» (C4, 02/10/2026): baja la planilla
 * con exactamente lo que el cuadro muestra. Va en la cabecera del cuadro, a la
 * derecha del título, con el texto siempre visible: son dos botones iguales a
 * la vista, y el nombre accesible (`ariaLabel`, de `cuadroExport`) dice cuál es
 * cuál y contiene la palabra que se ve.
 *
 * `<a download>` y no un `<Link>`: un `<Link>` prefetchearía el route handler.
 * Mide lo que el botón `sm` del kit (32 px con mouse, 44 de área con el dedo).
 */
export function CuadroExportButton({
  href,
  label,
  ariaLabel,
  title,
  className,
}: {
  href: string
  label: string
  ariaLabel: string
  title: string
  className?: string
}) {
  return (
    <Button asChild variant="secondary" size="sm" className={cn('shrink-0', className)}>
      <a href={href} download aria-label={ariaLabel} title={title}>
        <Download aria-hidden />
        {label}
      </a>
    </Button>
  )
}
