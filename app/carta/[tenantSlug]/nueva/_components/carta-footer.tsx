import { cn } from '@/lib/utils'

/** El pie de cada pantalla de la carta. */
export function CartaFooter({
  tenantName,
  className,
  children,
}: {
  tenantName: string
  className?: string
  /** Lo que va arriba de la firma (los sellos de las marcas, en las páginas de rubro). */
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <footer className={cn('mx-auto w-full max-w-6xl px-4 pb-4 text-center sm:px-6', className)}>
      {children}
      <p className="font-serif text-[0.9375rem] text-(--carta-soft)">Carta de {tenantName}</p>
      <p className="mt-1 text-[0.75rem] text-(--carta-soft)">Hecho con HUB</p>
    </footer>
  )
}
