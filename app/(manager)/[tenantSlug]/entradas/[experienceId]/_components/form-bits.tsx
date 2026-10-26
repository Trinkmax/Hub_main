import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** Los ids de la ayuda y del error de un campo, para el `aria-describedby` del input. */
export function describedBy(
  id: string,
  opts: { hint?: boolean; error?: boolean },
): string | undefined {
  const ids = [opts.hint ? `${id}-hint` : null, opts.error ? `${id}-error` : null].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
}

/**
 * Un campo del editor: etiqueta (con «*» u «(opcional)»), el control, la
 * ayuda y el error. El control lo arma quien llama, con `describedBy(id, …)`.
 */
export function Field({
  id,
  label,
  required,
  optional,
  hint,
  error,
  counter,
  className,
  children,
}: {
  id: string
  label: ReactNode
  required?: boolean
  optional?: boolean
  hint?: ReactNode
  error?: string
  /** «120/1500» arriba a la derecha. */
  counter?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="gap-1">
          {label}
          {required ? (
            <span aria-hidden className="text-destructive">
              *
            </span>
          ) : null}
          {optional ? <span className="font-normal text-muted-foreground">(opcional)</span> : null}
        </Label>
        {counter}
      </div>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-snug text-muted-foreground text-pretty">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs leading-snug text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** «120/1500»: se pone en ámbar cerca del tope. */
export function CharCount({ value, max }: { value: unknown; max: number }) {
  const length = typeof value === 'string' ? value.length : 0
  return (
    <span
      aria-hidden
      className={cn(
        'text-[11px] tabular-nums',
        length > max * 0.9 ? 'font-medium text-warning-text' : 'text-muted-foreground',
      )}
    >
      {length}/{max}
    </span>
  )
}
