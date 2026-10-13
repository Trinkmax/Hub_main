import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * El estado de algo, en una palabra: «Al día», «Vence el viernes», «Vencido»,
 * «Sin factura». Fondo teñido suave + punto (o ícono) + la palabra. El color
 * NUNCA va solo: sin la palabra no hay píldora.
 *
 * Los tonos son de ESTADO y están reservados a eso:
 * `ok` al día / hecho · `warn` por vencer / falta · `late` vencido ·
 * `info` un aviso · `muted` neutro (un dato, no una alarma).
 *
 * Cuándo NO: para algo que se toca (eso es `Pill`), para pintar una serie de
 * un gráfico (una porción no es un estado: van los `adm-s*`), ni `late` para
 * algo que no es cierto que esté vencido (nunca un rojo que asuste de más).
 * «Sin factura» va en `muted`: no es un problema, queda registrado igual.
 */
export function StatusPill({
  tone,
  children,
  icon: Icon,
  className,
}: {
  tone: 'ok' | 'warn' | 'late' | 'info' | 'muted'
  children: ReactNode
  /** Reemplaza al punto. */
  icon?: LucideIcon
  className?: string
}) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'adm-status inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-medium leading-none',
        className,
      )}
    >
      {Icon ? (
        <Icon aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-(--adm-tone)" />
      )}
      {children}
    </span>
  )
}
