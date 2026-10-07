import { ArrowLeft, Monitor } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { cn } from '@/lib/utils'

/**
 * El marco de cada libro (H.12), igual que el resto del panel: «Volver» arriba
 * del encabezado (como `clientes/nuevo`), `PageHeader` con «Solo lectura» para
 * la contadora y las acciones (Exportar) a la derecha, el selector de período
 * debajo y después el libro. Server-safe.
 */
export function BookPage({
  backHref,
  backLabel = 'Volver a Libros',
  title,
  description,
  actions,
  toolbar,
  width = 'default',
  children,
}: {
  backHref: string
  backLabel?: string
  title: ReactNode
  description?: ReactNode
  /** Botones del encabezado (Exportar). */
  actions?: ReactNode
  /** El período y los filtros, debajo del encabezado. */
  toolbar?: ReactNode
  width?: 'default' | 'comfortable' | 'compact'
  children: ReactNode
}) {
  return (
    <PageShell width={width}>
      <BackLink href={backHref}>{backLabel}</BackLink>
      <PageHeader
        eyebrow="Administración"
        title={
          <>
            {title} <ReadOnlyBadge />
          </>
        }
        description={description}
        actions={actions}
      />
      {toolbar}
      {children}
    </PageShell>
  )
}

/** «‹ Volver a …» arriba del encabezado; en el celular deja 44 px para el dedo. */
export function BackLink({
  href,
  children,
  className,
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground md:min-h-0',
        className,
      )}
    >
      <ArrowLeft className="size-3" aria-hidden />
      {children}
    </Link>
  )
}

/** Los libros anchos en el celular (H.12): se pueden leer, pero se leen mejor en la compu. */
export function WideBookHint({ children }: { children?: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground sm:hidden">
      <Monitor className="size-3.5 shrink-0" aria-hidden />
      {children ?? 'Los libros se leen mejor en la compu. Deslizá la tabla para ver todo.'}
    </p>
  )
}
