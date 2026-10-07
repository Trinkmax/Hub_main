import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Una tecla (§3.5): `h-5`, 12 px en Inter (antes 10 px en mono), pelo fuerte
 * y fondo apagado. Server-safe.
 *
 * Inter latin no tiene `⌘` ni `↵`: para esas teclas va un ícono de lucide de
 * 12 px adentro (ya queda a 12 px por el `[&_svg]`), o `KbdShortcut`
 * (`@/components/ui/kbd-shortcut`), que resuelve «⌘» o «Ctrl» según el equipo.
 */
export function Kbd({ className, children, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 select-none items-center justify-center gap-0.5 rounded-sm border border-border-strong bg-muted px-1 font-sans type-caption font-medium text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}
