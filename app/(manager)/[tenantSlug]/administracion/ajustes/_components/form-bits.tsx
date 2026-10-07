import { AlertTriangle, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Las piezas de formulario de Ajustes, la puesta en marcha y el plan de
 * cuentas: las mismas clases que `clientes/nuevo` (etiqueta, control, ayuda,
 * error con `role="alert"`), sin estilo propio. Server-safe.
 */

export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      *
    </span>
  )
}

export function OptionalMark() {
  return <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
}

/** Ids de ayuda y error de un campo, para `aria-describedby`. */
export function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  return (
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined
  )
}

export function Field({
  id,
  label,
  required = false,
  optional = false,
  hint,
  error,
  className,
  children,
}: {
  id: string
  label: ReactNode
  required?: boolean
  optional?: boolean
  hint?: ReactNode
  error?: string | null
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <RequiredMark /> : null}
        {optional ? <OptionalMark /> : null}
      </Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground text-pretty">
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

const CALLOUT_TONE = {
  warning: 'border-warning/40 bg-warning/10',
  info: 'border-info/30 bg-info/10',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
} as const

/**
 * El aviso en la página (admin-ui §1 «Banner en la página»): aviso, info o
 * error del servidor, con su acción si la hay.
 */
export function Callout({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: keyof typeof CALLOUT_TONE
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const Icon = tone === 'error' ? TriangleAlert : tone === 'warning' ? AlertTriangle : Info
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-center',
        CALLOUT_TONE[tone],
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon
          aria-hidden="true"
          className={cn(
            'mt-0.5 size-4 shrink-0',
            tone === 'warning' && 'text-warning',
            tone === 'info' && 'text-info',
          )}
        />
        <div className="min-w-0 space-y-1 text-pretty">
          {title ? (
            <p className={cn('font-medium', tone === 'warning' && 'text-warning-text')}>{title}</p>
          ) : null}
          {children ? (
            <div className={cn(tone !== 'error' && 'text-muted-foreground')}>{children}</div>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{action}</div> : null}
    </div>
  )
}

/** Un dato en modo lectura (contadora): etiqueta arriba, valor abajo. */
export function ReadOnlyItem({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground text-pretty">{children}</dd>
    </div>
  )
}
