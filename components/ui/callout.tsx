import { CircleAlert, CircleCheck, Info, type LucideIcon, TriangleAlert, X } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Aviso que vive en la página (kit HUB §3.4): «Este período está cerrado»,
 * «Solo lectura», «Mostramos los primeros 1.000 movimientos», «Datos de
 * ejemplo». Fondo suave + ícono + texto, sin borde de color a la izquierda y
 * sin sombra.
 *
 * Server-safe mientras no lleve `onDismiss`: el botón de cerrar necesita un
 * handler, y una función no cruza de un Server Component a uno cliente. Con
 * `onDismiss`, usalo desde un componente cliente.
 *
 * Anuncio (`announce`): `assertive` es `role="alert"` (un error después de una
 * acción: `FormError`); `polite` es `role="status"` (algo que aparece por una
 * acción); sin anuncio para lo que está desde que carga la página.
 */

export type CalloutTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const TONE_CLASS: Readonly<Record<CalloutTone, { box: string; icon: string }>> = {
  neutral: { box: 'bg-secondary', icon: 'text-muted-foreground' },
  info: { box: 'bg-info-soft', icon: 'text-info-text' },
  success: { box: 'bg-success-soft', icon: 'text-success-text' },
  warning: { box: 'bg-warning-soft', icon: 'text-warning-text' },
  danger: { box: 'bg-destructive-soft', icon: 'text-destructive-text' },
}

/** El neutro no trae ícono: el «período cerrado» le pasa `Lock`. */
const TONE_ICON: Readonly<Record<CalloutTone, LucideIcon | null>> = {
  neutral: null,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
}

export type CalloutProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  /** Default `info`. */
  tone?: CalloutTone
  title?: React.ReactNode
  /** Default el del tono (Info, CircleCheck, TriangleAlert, CircleAlert; el neutro, ninguno). `false` lo saca. */
  icon?: LucideIcon | false
  /** Un `Button size="sm"` o un link. */
  action?: React.ReactNode
  /** Botón «Cerrar». Solo para avisos que no vuelven a ser ciertos. */
  onDismiss?: () => void
  /** Default `false`. */
  announce?: 'polite' | 'assertive' | false
}

function Callout({
  tone = 'info',
  title,
  icon,
  action,
  onDismiss,
  announce = false,
  className,
  children,
  ...props
}: CalloutProps) {
  const Icon = icon === false ? null : (icon ?? TONE_ICON[tone])
  const styles = TONE_CLASS[tone]
  const role = announce === 'assertive' ? 'alert' : announce === 'polite' ? 'status' : undefined

  return (
    <div
      data-slot="callout"
      data-tone={tone}
      role={role}
      className={cn('flex gap-3 rounded-lg p-3 sm:p-4', styles.box, className)}
      {...props}
    >
      {Icon ? (
        <Icon
          data-slot="callout-icon"
          aria-hidden="true"
          // 16 px centrado en la primera línea (18 px de interlínea).
          className={cn('mt-px size-4 shrink-0', styles.icon)}
        />
      ) : null}
      <div data-slot="callout-content" className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* div y no p: título y cuerpo aceptan cualquier nodo (un div adentro
            de un p es HTML inválido y rompe la hidratación). */}
        {title ? (
          <div data-slot="callout-title" className="type-label text-foreground">
            {title}
          </div>
        ) : null}
        {children ? (
          <div
            data-slot="callout-description"
            // Un link dentro de un texto va subrayado siempre (§2.7).
            className="type-small text-pretty text-muted-foreground [&_a]:underline [&_a]:underline-offset-2"
          >
            {children}
          </div>
        ) : null}
        {action ? (
          <div data-slot="callout-action" className="mt-2 flex flex-wrap items-center gap-2">
            {action}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          data-slot="callout-dismiss"
          aria-label="Cerrar"
          onClick={onDismiss}
          className={cn(
            'press relative -my-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-sm',
            'text-muted-foreground hover:bg-hover hover:text-foreground hit-area',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)',
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

export { Callout }
