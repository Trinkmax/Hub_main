import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Las píldoras de Administración: filtros, pestañas chicas y leyendas que
 * además navegan. La elegida va RELLENA, nunca en contorno (el contorno fue lo
 * que hizo ilegible el rediseño del 07/10).
 *
 * Regla anti «2 6»: una píldora nunca lleva dos números pelados pegados. El
 * contador (`count`) va adentro de su propia pastilla; el monto de una leyenda
 * lleva su «$».
 *
 * Cuándo NO: para un estado que no se toca (eso es `StatusPill`), para la
 * acción principal de la vista (eso es un `Button`), ni para elegir entre
 * opciones con consecuencias (eso es `ChoiceCard`). Para un radio de pocas
 * opciones adentro de un formulario ya existe `ChoiceChips`.
 */

type PillLook = {
  /** La elegida: rellena. */
  active?: boolean
  /** `touch` = 44 px, para el celular y las cargas. */
  size?: 'default' | 'touch'
  /**
   * Con qué se rellena la elegida: `ink` (tinta, para filtros y leyendas) o
   * `brand` (verde, para la navegación de la sección).
   */
  activeTone?: 'ink' | 'brand'
  icon?: LucideIcon
  /** Un contador, adentro de su pastilla. */
  count?: ReactNode
  className?: string
  children: ReactNode
}

const BASE =
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

const SIZE = {
  default: 'h-9 px-3 text-[13px]',
  touch: 'h-11 px-4 text-sm',
} as const

const ACTIVE = {
  ink: 'border-foreground bg-foreground text-background',
  brand: 'border-primary bg-primary text-primary-foreground shadow-xs',
} as const

const IDLE = 'border-border/70 bg-card text-foreground hover:bg-cream-tint'

function pillClass({
  active = false,
  size = 'default',
  activeTone = 'ink',
  className,
}: Pick<PillLook, 'active' | 'size' | 'activeTone' | 'className'>) {
  return cn(BASE, SIZE[size], active ? ACTIVE[activeTone] : IDLE, className)
}

function PillBody({
  icon: Icon,
  count,
  active,
  children,
}: Pick<PillLook, 'icon' | 'count' | 'active' | 'children'>) {
  return (
    <>
      {Icon ? <Icon aria-hidden className="size-4 shrink-0" /> : null}
      <span>{children}</span>
      {count !== undefined && count !== null ? (
        <span
          className={cn(
            'rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums',
            active ? 'bg-background/20' : 'bg-secondary',
          )}
        >
          {count}
        </span>
      ) : null}
    </>
  )
}

/** Píldora que es un botón (filtra, alterna). Con `active` definido se anuncia como apretada o no. */
export function Pill({
  active,
  size,
  activeTone,
  icon,
  count,
  className,
  children,
  type = 'button',
  ...props
}: PillLook & Omit<ComponentProps<'button'>, 'children' | 'className'>) {
  return (
    <button
      type={type}
      aria-pressed={active === undefined ? undefined : active}
      {...props}
      className={pillClass({ active, size, activeTone, className })}
    >
      <PillBody icon={icon} count={count} active={active}>
        {children}
      </PillBody>
    </button>
  )
}

/** Píldora que es un link (la elección vive en la URL: `?tab=`, `?mes=`). */
export function PillLink({
  active,
  size,
  activeTone,
  icon,
  count,
  className,
  children,
  ...props
}: PillLook & Omit<ComponentProps<typeof Link>, 'children' | 'className'>) {
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      {...props}
      className={pillClass({ active, size, activeTone, className })}
    >
      <PillBody icon={icon} count={count} active={active}>
        {children}
      </PillBody>
    </Link>
  )
}

/**
 * La leyenda de un gráfico, que además ES la tabla: punto de color + etiqueta
 * + monto. Con `href` navega (o filtra por URL), con `onClick` filtra en el
 * lugar, y sin ninguno es una leyenda quieta. `share` es el porcentaje, que va
 * en su pastilla para no quedar pegado al monto.
 *
 * El color nunca va solo: la etiqueta dice qué es. El texto no lleva el color
 * de la serie; la identidad la da el punto.
 *
 * Cuándo NO: para más de seis series (una barra con siete colores no se lee:
 * la séptima va a «Otros»), ni como única explicación de un gráfico (cada uno
 * lleva su oración y su tabla).
 */
export function LegendPill({
  swatchClassName,
  label,
  value,
  share,
  href,
  onClick,
  active = false,
  size = 'default',
  className,
}: {
  /** La clase de fondo del punto: `bg-adm-s1`, `bg-adm-in`… */
  swatchClassName: string
  label: ReactNode
  /** El monto ya formateado (`formatCentsShort`) o un `Amount`. */
  value: ReactNode
  /** «34 %». Opcional. */
  share?: ReactNode
  href?: string
  onClick?: () => void
  active?: boolean
  size?: 'default' | 'touch'
  className?: string
}) {
  const classes = cn(
    BASE,
    size === 'touch' ? 'h-11 px-3.5 text-sm' : 'h-9 px-3 text-xs',
    active
      ? ACTIVE.ink
      : cn('border-border/70 bg-card text-foreground', (href || onClick) && 'hover:bg-cream-tint'),
    className,
  )
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'size-2.5 shrink-0 rounded-full',
          swatchClassName,
          active && 'ring-2 ring-background/70',
        )}
      />
      <span>{label}</span>
      <span className={cn('tabular-nums', active ? 'opacity-90' : 'text-muted-foreground')}>
        {value}
      </span>
      {share !== undefined && share !== null ? (
        <span
          className={cn(
            'rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums',
            active ? 'bg-background/20' : 'bg-secondary',
          )}
        >
          {share}
        </span>
      ) : null}
    </>
  )

  if (href) {
    return (
      <Link href={href} aria-current={active ? 'true' : undefined} className={classes}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" aria-pressed={active} onClick={onClick} className={classes}>
        {body}
      </button>
    )
  }
  return <span className={classes}>{body}</span>
}
