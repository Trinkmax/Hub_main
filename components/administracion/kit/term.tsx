import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Una palabra de contadora, con la idea primero. Se escribe lo que significa
 * para el socio y el nombre técnico queda a mano:
 *
 *   <Term name="IVA crédito fiscal">lo que recuperás de IVA</Term>
 *
 * Se ve como texto normal con subrayado punteado; al pasar el mouse (o con un
 * lector de pantalla) aparece el nombre contable. Con `inline` el nombre va
 * además escrito al lado, en gris y entre paréntesis: usalo la PRIMERA vez que
 * aparece el concepto en una pantalla, porque en el celular no hay mouse.
 *
 * Cuándo NO: en los Libros ni en nada que lea la contadora (ahí va el nombre
 * técnico directo), ni para explicar algo largo (eso es `Explain` o la guía).
 */
export function Term({
  name,
  children,
  inline = false,
  className,
}: {
  /** El nombre contable: «IVA crédito fiscal», «Pasivo», «Devengado». */
  name: string
  /** La idea en castellano llano. */
  children: ReactNode
  inline?: boolean
  className?: string
}) {
  return (
    <>
      <abbr
        title={name}
        className={cn(
          'cursor-help underline decoration-muted-foreground/60 decoration-dotted underline-offset-4',
          className,
        )}
      >
        {children}
      </abbr>
      {inline ? <span className="text-muted-foreground"> ({name})</span> : null}
    </>
  )
}
