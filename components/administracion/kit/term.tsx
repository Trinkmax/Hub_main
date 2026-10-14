import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Una palabra de contadora, con la idea primero. Se escribe lo que significa
 * para el socio y el nombre técnico queda a mano:
 *
 *   <Term name="IVA crédito fiscal">lo que recuperás de IVA</Term>
 *
 * - Con `inline`, el nombre va escrito al lado, en gris y entre paréntesis, y
 *   nada más: sin subrayado ni globito, porque ya está dicho. Usalo la PRIMERA
 *   vez que aparece el concepto en una pantalla.
 * - Sin `inline`, donde hay mouse la idea lleva un subrayado punteado y el
 *   nombre aparece al pasar por encima. Donde se toca (celular, tablet) no hay
 *   «pasar por encima»: ahí el nombre se escribe solo, entre paréntesis, y el
 *   subrayado no se dibuja. Nunca queda una pista que no se pueda abrir.
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
  if (inline) {
    return (
      <>
        <span className={className}>{children}</span>
        <span className="text-muted-foreground"> ({name})</span>
      </>
    )
  }
  return (
    <>
      <abbr
        title={name}
        className={cn(
          // El subrayado promete un globito: solo donde el globito existe (hay mouse).
          'no-underline [@media(hover:hover)]:cursor-help [@media(hover:hover)]:underline [@media(hover:hover)]:decoration-muted-foreground/60 [@media(hover:hover)]:decoration-dotted [@media(hover:hover)]:underline-offset-4',
          className,
        )}
      >
        {children}
      </abbr>
      <span className="text-muted-foreground [@media(hover:hover)]:hidden"> ({name})</span>
    </>
  )
}
