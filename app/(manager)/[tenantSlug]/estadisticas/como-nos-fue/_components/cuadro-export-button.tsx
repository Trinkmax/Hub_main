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
 * 40 px de alto mientras la tarjeta mide menos de 24rem (el celular), 32 px
 * desde ahí: mismo criterio que los botones de la pauta.
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
    <Button
      asChild
      variant="outline"
      size="sm"
      className={cn('h-10 shrink-0 gap-1.5 @sm:h-8', className)}
    >
      <a href={href} download aria-label={ariaLabel} title={title}>
        <Download aria-hidden className="size-4" />
        {label}
      </a>
    </Button>
  )
}
