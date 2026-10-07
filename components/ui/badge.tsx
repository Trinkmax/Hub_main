import { Slot, Slottable } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Etiqueta de estado (kit HUB §3.4).
 *
 * Suave por defecto: fondo `-soft` del tono y texto `-text`, así informa sin
 * gritar. Los rellenos sólidos de antes (verde, rojo, ámbar a pleno) quedan
 * solo para el sello dorado del club y la cuenta de sin leer.
 *
 * Nunca solo color: el texto va siempre. El punto (`dot`) acompaña, lleva
 * `aria-hidden` y va en el sólido del tono. Si una celda angosta muestra solo
 * el punto, el texto va en `sr-only` (lo pone quien la usa).
 */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'gold'
export type BadgeAppearance = 'soft' | 'solid' | 'outline'
export type BadgeSize = 'sm' | 'md'

/** El sólido de cada tono: el punto de la etiqueta y el de `DueStatus`. */
export const BADGE_DOT_CLASS: Readonly<Record<BadgeTone, string>> = {
  // Sobre `secondary` el apoyo da 4,33:1: el punto (decorativo) igual pasa 3:1.
  neutral: 'bg-subtle-foreground',
  brand: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
  gold: 'bg-gold',
}

const badgeStyles = cva(
  [
    // `relative` para el área táctil del modo link. Sin `overflow-hidden`: le
    // recortaría el ::after de `hit-area`; para cortar un texto largo va un
    // `<span className="truncate">` adentro (el flex lo deja encoger).
    'relative inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap',
    'rounded-sm border border-transparent px-2 type-caption font-medium',
    '[&>svg]:pointer-events-none [&>svg]:size-3 [&>svg]:shrink-0',
    // Como link (`asChild` con un <a>): pelo al pasar, foco afuera y 24 px de
    // objetivo aunque dibuje 20 (WCAG 2.5.8; 44 con el dedo).
    '[a&]:transition-colors [a&]:hover:border-border-strong [a&]:hit-area',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)',
  ].join(' '),
  {
    variants: {
      tone: {
        neutral: '',
        brand: '',
        success: '',
        warning: '',
        danger: '',
        info: '',
        gold: '',
      },
      appearance: {
        soft: '',
        solid: '',
        outline: 'border-border-strong [a&]:hover:border-input',
      },
      size: {
        sm: 'h-5',
        md: 'h-6',
      },
    },
    compoundVariants: [
      // Suave: el aspecto por defecto.
      { appearance: 'soft', tone: 'neutral', class: 'bg-secondary text-muted-foreground' },
      { appearance: 'soft', tone: 'brand', class: 'bg-brand-soft text-brand-text' },
      { appearance: 'soft', tone: 'success', class: 'bg-success-soft text-success-text' },
      { appearance: 'soft', tone: 'warning', class: 'bg-warning-soft text-warning-text' },
      { appearance: 'soft', tone: 'danger', class: 'bg-destructive-soft text-destructive-text' },
      { appearance: 'soft', tone: 'info', class: 'bg-info-soft text-info-text' },
      { appearance: 'soft', tone: 'gold', class: 'bg-gold-soft text-gold-text' },
      // Sólida: el sello dorado (tinta sobre dorado, 8,87:1) y la cuenta de sin
      // leer (`brand`). Los demás tonos existen para no romper, no para usarse.
      { appearance: 'solid', tone: 'neutral', class: 'bg-foreground text-background' },
      { appearance: 'solid', tone: 'brand', class: 'bg-primary text-primary-foreground' },
      { appearance: 'solid', tone: 'success', class: 'bg-success text-success-foreground' },
      { appearance: 'solid', tone: 'warning', class: 'bg-warning text-warning-foreground' },
      { appearance: 'solid', tone: 'danger', class: 'bg-destructive text-destructive-foreground' },
      { appearance: 'solid', tone: 'info', class: 'bg-info text-info-foreground' },
      { appearance: 'solid', tone: 'gold', class: 'bg-gold text-gold-foreground' },
      // Contorno: pelo fuerte y el texto del tono (el neutro, en texto 2).
      { appearance: 'outline', tone: 'neutral', class: 'text-muted-foreground' },
      { appearance: 'outline', tone: 'brand', class: 'text-brand-text' },
      { appearance: 'outline', tone: 'success', class: 'text-success-text' },
      { appearance: 'outline', tone: 'warning', class: 'text-warning-text' },
      { appearance: 'outline', tone: 'danger', class: 'text-destructive-text' },
      { appearance: 'outline', tone: 'info', class: 'text-info-text' },
      { appearance: 'outline', tone: 'gold', class: 'text-gold-text' },
    ],
    defaultVariants: {
      tone: 'neutral',
      appearance: 'soft',
      size: 'sm',
    },
  },
)

/**
 * Las clases de la etiqueta, para dibujarla sobre otro elemento (el disparador
 * de un menú con aspecto de etiqueta): neutra y suave si no se dice otra cosa.
 */
function badgeVariants(
  options: {
    tone?: BadgeTone | null
    appearance?: BadgeAppearance | null
    size?: BadgeSize | null
    className?: string
  } = {},
): string {
  return cn(
    badgeStyles({
      tone: options.tone ?? 'neutral',
      appearance: options.appearance ?? 'soft',
      size: options.size,
    }),
    options.className,
  )
}

export type BadgeProps = React.ComponentProps<'span'> & {
  /** Default `neutral`. */
  tone?: BadgeTone
  /** Default `soft`. `solid` solo para el sello dorado y la cuenta de sin leer. */
  appearance?: BadgeAppearance
  /** Punto de 6 px en el sólido del tono, con `aria-hidden`: el texto siempre está. */
  dot?: boolean
  icon?: LucideIcon
  /** `sm` 20 px (default) · `md` 24 px. Como link, `md` (o queda el área táctil de 24 px). */
  size?: BadgeSize
  /** Dibuja la etiqueta sobre el hijo (por ejemplo un `<Link>`). El punto y el ícono van adentro. */
  asChild?: boolean
}

function Badge({
  className,
  tone = 'neutral',
  appearance = 'soft',
  dot = false,
  icon: Icon,
  size = 'sm',
  asChild = false,
  children,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      data-slot="badge"
      data-tone={tone}
      data-appearance={appearance}
      className={cn(badgeStyles({ tone, appearance, size }), className)}
      {...props}
    >
      {dot ? (
        <span
          data-slot="badge-dot"
          aria-hidden="true"
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            // Sobre el relleno sólido el punto del tono no se vería.
            appearance === 'solid' ? 'bg-current' : BADGE_DOT_CLASS[tone],
          )}
        />
      ) : null}
      {Icon ? <Icon aria-hidden="true" /> : null}
      {/* Con `asChild`, el hijo es el elemento y sus hijos van acá, después del punto. */}
      <Slottable>{children}</Slottable>
    </Comp>
  )
}

export { Badge, badgeVariants }
