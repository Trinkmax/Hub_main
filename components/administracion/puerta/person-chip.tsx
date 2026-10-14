import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Una persona: sus iniciales en un círculo y su nombre al lado. Es como se ve
 * a un socio en Accesos, en el cartel de la puerta («Pedile acceso a…») y donde
 * haga falta nombrar a alguien de Administración.
 *
 * Solo nombres, nunca emails: el nombre es el que la persona tiene en
 * Administración (o el de su perfil).
 *
 * - `tone="filled"`: entra (círculo relleno suave). `tone="hollow"`: todavía no
 *   entra (círculo punteado, vacío). El tono nunca va solo: al lado va el
 *   renglón que lo dice («Sin acceso a Administración»).
 * - `badge`: al lado del nombre («Vos»). `sub`: el renglón gris de abajo.
 * - `framed`: la persona como una ficha con borde, para ir suelta en una frase
 *   («Pedile acceso a [Franco] [Nacho]»).
 *
 * Cuándo NO: para un proveedor o un cliente (eso es su nombre y su CUIT), ni
 * como botón (no se toca: la acción va al lado).
 */

/** «Franco Pérez» → «FP» · «nacho» → «N» · «franco.perez» → «FP» · vacío → «?». */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
  // La primera letra (o número) de cada palabra: «(demo)» da «D», no un paréntesis.
  const letters = words.slice(0, 2).map((w) => /[\p{L}\p{N}]/u.exec(w)?.[0] ?? '')
  return letters.join('').toLocaleUpperCase('es-AR') || '?'
}

const AVATAR_SIZE = {
  sm: 'size-7 text-[11px]',
  md: 'size-9 text-xs',
} as const

export function PersonChip({
  name,
  tone = 'filled',
  badge,
  sub,
  size = 'md',
  framed = false,
  className,
}: {
  name: string
  tone?: 'filled' | 'hollow'
  /** Al lado del nombre: «Vos». */
  badge?: ReactNode
  /** El renglón de abajo: desde cuándo entra, quién le dio el acceso. */
  sub?: ReactNode
  size?: 'sm' | 'md'
  /** Con borde, como una ficha suelta. */
  framed?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-2.5 text-left',
        framed && 'rounded-full border border-border/70 bg-card py-1 pr-3.5 pl-1 shadow-2xs',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide',
          AVATAR_SIZE[size],
          tone === 'filled'
            ? 'border border-primary/20 bg-primary/10 text-primary'
            : 'border border-dashed border-muted-foreground/50 text-muted-foreground',
        )}
      >
        {initialsOf(name)}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span
            title={name}
            className={cn(
              'truncate font-medium',
              size === 'sm' ? 'text-[13px]' : 'text-sm',
              tone === 'hollow' && 'text-muted-foreground',
            )}
          >
            {name}
          </span>
          {badge}
        </span>
        {sub ? (
          <span className="block text-xs leading-snug text-muted-foreground text-pretty">
            {sub}
          </span>
        ) : null}
      </span>
    </span>
  )
}
