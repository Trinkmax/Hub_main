import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Spotlight } from '@/components/administracion/guias/arca-mock/spotlight'
import { cn } from '@/lib/utils'

/**
 * Las piezas para dibujar las pantallas PROPIAS de Administración dentro de la guía (las de
 * ARCA tienen las suyas en `arca-mock/primitives`, con la piel de ARCA). Acá todo usa los
 * tokens de la app, así el dibujo sigue el tema y se parece a la pantalla real.
 *
 * Son dibujos, no controles: van adentro de `ScaledMock` (que los describe con `aria-label`) y
 * el lienzo lleva `inert`, así nada de adentro se puede enfocar ni tocar aunque se use una
 * pieza de verdad del kit (un `Ticket`, un `StatusPill`).
 */

/**
 * El ancho del lienzo: angosto, como un celular. En una pantalla de 375 px el dibujo entra casi
 * a tamaño real (escala ≈ 0,9), sin «Ampliar». Con 380 quedaba justo debajo del corte.
 */
export const MOCK_WIDTH = 340

/** El mismo rojo de los anillos «Tocá acá» de la guía de ARCA (`arca-mock/spotlight`). */
const TAP_RED = '#e5262a'

export function MockCanvas({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      inert
      className={cn(
        'flex h-full w-full flex-col bg-background text-[13px] leading-snug text-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Una hoja de carga: título en Fraunces, el cuerpo y, abajo, el botón grande. */
export function MockSheet({
  title,
  description,
  footer,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <MockCanvas>
      <div className="border-b border-border/60 px-4 pt-4 pb-3">
        <p className="font-serif text-lg leading-tight font-semibold tracking-tight">{title}</p>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex-1 space-y-4 px-4 py-4">{children}</div>
      {footer ? (
        <div className="space-y-2.5 border-t border-border/60 bg-card px-4 py-3">{footer}</div>
      ) : null}
    </MockCanvas>
  )
}

/** Una pantalla de la sección: de dónde es (en gris), el título y, si hace falta, un pie. */
export function MockPage({
  crumb,
  title,
  aside,
  footer,
  children,
}: {
  crumb: string
  title: ReactNode
  aside?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <MockCanvas>
      <div className="flex items-end justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{crumb}</p>
          <p className="mt-0.5 font-serif text-xl leading-tight font-semibold tracking-tight">
            {title}
          </p>
        </div>
        {aside ? <div className="shrink-0 pb-0.5">{aside}</div> : null}
      </div>
      <div className="flex-1 space-y-4 px-4 pb-4">{children}</div>
      {footer ? (
        <div className="space-y-2.5 border-t border-border/60 bg-card px-4 py-3">{footer}</div>
      ) : null}
    </MockCanvas>
  )
}

/** Una pregunta con su respuesta: la etiqueta ES la pregunta, como en las hojas nuevas. */
export function MockField({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <p className="text-[13px] font-medium">{label}</p>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground text-pretty">{hint}</p> : null}
    </div>
  )
}

/** Un campo con lo que ya se escribió. */
export function MockInput({
  children,
  mono = false,
  className,
}: {
  children: ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'flex h-10 w-full items-center rounded-lg border border-border bg-card px-3 shadow-2xs',
        mono && 'font-mono tabular-nums',
        className,
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Un desplegable con lo elegido (la flechita lo distingue de un campo de texto). */
export function MockSelect({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 shadow-2xs">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </span>
  )
}

/** El importe grande de una carga: el «$» chico y los números en Fraunces. */
export function MockAmount({ children }: { children: string }) {
  return (
    <span className="flex h-14 w-full items-baseline gap-1.5 rounded-xl border border-border bg-card px-3.5 pt-3 shadow-2xs">
      <span className="text-sm font-medium text-muted-foreground">$</span>
      <span className="font-serif text-[26px] leading-none font-semibold tracking-tight">
        {children}
      </span>
    </span>
  )
}

/** Chips para elegir: la elegida va rellena, como las píldoras de la sección. */
export function MockChips({
  items,
}: {
  items: ReadonlyArray<{ label: string; active?: boolean }>
}) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item.label}
          className={cn(
            'inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium whitespace-nowrap',
            item.active
              ? 'border-foreground bg-foreground text-background'
              : 'border-border/70 bg-card text-foreground',
          )}
        >
          {item.active ? <Check aria-hidden className="size-3" strokeWidth={3} /> : null}
          {item.label}
        </span>
      ))}
    </span>
  )
}

/** El botón principal de la pantalla (48 px, como en un paso a paso). */
export function MockPrimary({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-xs',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Un botón secundario. */
export function MockSecondary({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'flex h-10 items-center justify-center rounded-lg border border-border bg-card px-3.5 text-[13px] font-medium whitespace-nowrap shadow-2xs',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Un renglón con casilla: la factura que se paga, la venta que se cobra. */
export function MockCheckRow({
  checked = false,
  title,
  meta,
  amount,
}: {
  checked?: boolean
  title: ReactNode
  /** Debajo del título: un `StatusPill` o una aclaración. */
  meta?: ReactNode
  amount: string
}) {
  return (
    <span className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card px-2.5 py-2 shadow-2xs">
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-md border-2',
          checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card text-transparent',
        )}
      >
        <Check aria-hidden className="size-3.5" strokeWidth={3.25} />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate font-medium">{title}</span>
        {meta ? <span className="flex items-center text-[11px]">{meta}</span> : null}
      </span>
      <span className="shrink-0 font-mono tabular-nums">{amount}</span>
    </span>
  )
}

/** El ícono en su círculo, como en las tarjetas del lanzador. */
export function MockIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground',
        className,
      )}
    >
      <Icon aria-hidden className="size-4" />
    </span>
  )
}

/**
 * «Tocá acá»: el anillo rojo de la guía de ARCA (`Spotlight`, que además late) con la indicación
 * en una etiqueta montada sobre el borde. En un lienzo de celular no hay lugar para el globito
 * con flecha: taparía el renglón de al lado.
 */
export function Tap({
  label = 'Tocá acá',
  align = 'right',
  rounded = 'rounded-[14px]',
  className,
  children,
}: {
  label?: string
  align?: 'left' | 'right'
  /** La forma del anillo (la del control que rodea). */
  rounded?: string
  className?: string
  children: ReactNode
}) {
  return (
    <Spotlight className={cn('flex w-full', className)} rounded={rounded} inset={4}>
      {children}
      <span
        data-spotlight-label=""
        className={cn(
          'pointer-events-none absolute -top-[15px] z-20 rounded-[7px] px-2 py-[3px] text-[12px] leading-tight font-bold whitespace-nowrap text-white shadow-[0_3px_8px_rgba(0,0,0,0.25)]',
          align === 'right' ? 'right-2' : 'left-2',
        )}
        style={{ backgroundColor: TAP_RED }}
      >
        {label}
      </span>
    </Spotlight>
  )
}
