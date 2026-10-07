import type * as React from 'react'

export type ReloadLinkProps = Omit<React.ComponentProps<'a'>, 'href'> & {
  href: string
  /**
   * En otra pestaña: `target="_blank"`, `rel="noopener noreferrer"` y «(se abre
   * en otra pestaña)» para el lector (salvo que el link ya traiga su
   * `aria-label`, que es lo que se lee).
   */
  newTab?: boolean
}

/**
 * Un link que sale del panel **con recarga completa** (kit §7.a.4, riesgo 19):
 * al salón (`/{slug}/salon/…`) o a una superficie pública (carta, wallet,
 * link de Instagram, landings, hojas para imprimir). Esos workspaces tienen su
 * propio `<html>` (tema, clases congeladas) y su propio Toaster: con la
 * navegación blanda de `<Link>` el layout raíz no se vuelve a dibujar y la
 * página llegaba con los del panel. Es un `<a>` común, así que tampoco precarga
 * una ruta de otro workspace.
 *
 * Adentro del panel, `<Link>` como siempre. Sirve suelto o con
 * `<Button asChild>`:
 *
 * ```tsx
 * <Button asChild variant="secondary" size="sm">
 *   <ReloadLink href={`/${slug}/salon/reservas-operativo`}>Ver en el salón</ReloadLink>
 * </Button>
 * <ReloadLink href={`/l/${slug}`} newTab>Ver página</ReloadLink>
 * ```
 *
 * Server-safe (sin hooks). El ⌘K decide lo mismo con `needsFullReload`
 * (`components/command-palette/command-config.ts`).
 */
function ReloadLink({ href, newTab = false, target, rel, children, ...props }: ReloadLinkProps) {
  const labelled = props['aria-label'] !== undefined || props['aria-labelledby'] !== undefined
  return (
    <a
      data-slot="reload-link"
      href={href}
      target={newTab ? '_blank' : target}
      rel={newTab ? (rel ?? 'noopener noreferrer') : rel}
      {...props}
    >
      {children}
      {newTab && !labelled ? <span className="sr-only"> (se abre en otra pestaña)</span> : null}
    </a>
  )
}

export { ReloadLink }
