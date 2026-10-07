import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** `aria-describedby` de un control con su ayuda y su error (los ids que arma `Field`). */
export function describedBy(
  id: string,
  parts: { hint?: unknown; error?: unknown },
): string | undefined {
  const ids = [parts.hint ? `${id}-hint` : null, parts.error ? `${id}-error` : null].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
}

/**
 * Un campo del formulario como los del panel (`clientes/nuevo`): etiqueta,
 * control, ayuda en `text-xs` y error con `role="alert"`. El control lleva el
 * `id` y `aria-describedby={describedBy(id, { hint, error })}`.
 */
export function Field({
  id,
  label,
  required = false,
  optional = false,
  hint,
  error,
  children,
  className,
}: {
  id: string
  label: ReactNode
  required?: boolean
  optional?: boolean
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
        {optional ? (
          <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
        ) : null}
      </Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Una etiqueta de grupo (radios, chips) que no apunta a un único control. */
export function GroupLabel({
  id,
  children,
  className,
}: {
  id: string
  children: ReactNode
  className?: string
}) {
  return (
    <p id={id} className={cn('text-sm font-medium leading-none', className)}>
      {children}
    </p>
  )
}
