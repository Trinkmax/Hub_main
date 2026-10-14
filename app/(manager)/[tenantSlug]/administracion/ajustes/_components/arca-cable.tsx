import { Check, Landmark, Store, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * El cable entre el bar y ARCA: dos puntas —«Tu bar» y «ARCA»— unidas por una
 * línea que muestra hasta dónde llegó la conexión.
 *
 * - `not_started`: la línea punteada y gris. Todavía no hay nada enchufado.
 * - `in_progress`: una cuenta por paso que cuenta; las hechas van rellenas y la
 *   que toca, resaltada. ES la barra de avance (`role="progressbar"`), con el
 *   texto «3 de 9 pasos listos».
 * - `connected`: la línea continua en dorado, con un tilde.
 * - `error`: la línea cortada.
 *
 * El dibujo nunca va solo: al lado van siempre el estado en palabras y la
 * oración. `size="sm"` es la miniatura de la portada y de la franja de Puntos
 * de venta (decorativa).
 *
 * Cuándo NO: para la vigencia del certificado (eso lo dice su frase) ni para
 * otra conexión que no sea la de producción con ARCA.
 */

export type ArcaCableState = 'not_started' | 'in_progress' | 'connected' | 'error'

function Node({
  icon: Icon,
  label,
  lit,
  small,
}: {
  icon: typeof Store
  label: string
  lit: boolean
  small: boolean
}) {
  return (
    <span className="flex shrink-0 flex-col items-center gap-1">
      <span
        className={cn(
          'flex items-center justify-center rounded-full border',
          small ? 'size-6' : 'size-11 shadow-2xs',
          lit
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-border bg-card text-muted-foreground',
        )}
      >
        <Icon className={small ? 'size-3' : 'size-5'} />
      </span>
      {small ? null : (
        <span className="text-[11px] leading-none font-medium text-muted-foreground">{label}</span>
      )}
    </span>
  )
}

export function ArcaCable({
  state,
  done = 0,
  total = 0,
  progressText,
  size = 'md',
  className,
}: {
  state: ArcaCableState
  /** Pasos hechos (solo en curso). */
  done?: number
  /** Pasos que cuentan (solo en curso). */
  total?: number
  /** «3 de 9 pasos listos»: lo que escucha un lector de pantalla en curso. */
  progressText?: string
  size?: 'md' | 'sm'
  className?: string
}) {
  const small = size === 'sm'
  const beads = Math.max(0, Math.min(12, Math.trunc(total)))
  const filled = Math.max(0, Math.min(beads, Math.trunc(done)))
  const progress = state === 'in_progress' && !small && beads > 0

  const line =
    state === 'connected' ? (
      <span className="relative flex flex-1 items-center">
        <span className={cn('w-full rounded-full bg-adm-s2', small ? 'h-0.5' : 'h-1')} />
        <span
          className={cn(
            'absolute left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full bg-success text-background',
            small ? 'size-3.5' : 'size-6',
          )}
        >
          <Check className={small ? 'size-2.5' : 'size-3.5'} strokeWidth={3} />
        </span>
      </span>
    ) : state === 'error' ? (
      <span className="relative flex flex-1 items-center">
        <span className={cn('flex-1 rounded-full bg-adm-neutral', small ? 'h-0.5' : 'h-1')} />
        <span
          className={cn(
            'mx-1 flex shrink-0 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10 text-destructive',
            small ? 'size-3.5' : 'size-6',
          )}
        >
          <X className={small ? 'size-2.5' : 'size-3.5'} strokeWidth={3} />
        </span>
        <span className={cn('flex-1 rounded-full bg-adm-neutral', small ? 'h-0.5' : 'h-1')} />
      </span>
    ) : state === 'in_progress' && beads > 0 && !small ? (
      <span className="relative flex flex-1 items-center justify-between">
        <span className="absolute inset-x-0 h-0.5 rounded-full bg-adm-track" />
        {Array.from({ length: beads }, (_, index) => (
          <span
            // Las cuentas son los pasos, en orden fijo.
            // biome-ignore lint/suspicious/noArrayIndexKey: lista fija, sin reordenar
            key={index}
            className={cn(
              'relative size-2.5 rounded-full border sm:size-3',
              index < filled
                ? 'border-adm-in bg-adm-in'
                : index === filled
                  ? 'border-primary bg-card ring-4 ring-primary/15'
                  : 'border-border bg-card',
            )}
          />
        ))}
      </span>
    ) : state === 'in_progress' ? (
      // La miniatura (o un avance sin pasos contados): la mitad enchufada.
      <span className="flex flex-1 items-center">
        <span className="h-0.5 flex-1 rounded-full bg-adm-in" />
        <span className="h-0 flex-1 border-t-2 border-dotted border-adm-neutral" />
      </span>
    ) : (
      <span
        className={cn(
          'flex-1 border-dashed border-adm-neutral',
          small ? 'border-t-2' : 'border-t-[3px]',
        )}
      />
    )

  return (
    <div
      {...(progress
        ? {
            role: 'progressbar',
            'aria-valuemin': 0,
            'aria-valuemax': beads,
            'aria-valuenow': filled,
            'aria-valuetext': progressText,
            'aria-label': 'Conectar ARCA',
          }
        : { 'aria-hidden': true })}
      className={cn(
        'flex w-full',
        small ? 'items-center gap-1' : 'items-start gap-2 sm:gap-3',
        className,
      )}
    >
      <Node icon={Store} label="Tu bar" lit={state !== 'not_started'} small={small} />
      <span className={cn('flex min-w-0 flex-1 items-center', small ? 'h-6' : 'h-11')}>{line}</span>
      <Node icon={Landmark} label="ARCA" lit={state === 'connected'} small={small} />
    </div>
  )
}
