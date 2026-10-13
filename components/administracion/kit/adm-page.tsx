import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * El marco de toda pantalla de Administración: ancho, aire a los costados y
 * separación entre bloques. Mismas medidas que `PageShell` del panel (no lo
 * reemplaza fuera de la sección), para que al entrar a Administración nada
 * salte de lugar.
 *
 * Cuándo NO: fuera de `/administracion` (ahí va `PageShell`), ni adentro de
 * una hoja o un diálogo (ya traen su propio aire).
 */

const WIDTH = {
  compact: 'max-w-3xl',
  comfortable: 'max-w-6xl',
  default: 'max-w-7xl',
} as const

export function AdmPage({
  width = 'default',
  className,
  children,
}: {
  /** `compact` 3xl (una carga, un paso a paso) · `comfortable` 6xl · `default` 7xl. */
  width?: keyof typeof WIDTH
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8',
        WIDTH[width],
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * El encabezado de la pantalla: el título en Fraunces y, si hace falta, una
 * oración que dice para qué sirve. SIN eyebrow en mayúsculas: la barra de la
 * sección ya dice dónde estás. `back` es el «volver» chico de arriba; `badge`
 * va pegado al título (un estado, «Solo lectura»); `actions` a la derecha en
 * compu y debajo en el celular.
 *
 * Cuándo NO: como título de un bloque (eso es `Panel`). Hay un solo
 * `AdmHeader` por pantalla: dibuja el `h1`.
 */
export function AdmHeader({
  title,
  description,
  actions,
  back,
  badge,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: { href: string; label: string }
  badge?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {back ? (
        <Link
          href={back.href}
          className="-ml-1.5 inline-flex min-h-9 items-center gap-1 self-start rounded-md px-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="font-serif text-3xl font-semibold leading-tight tracking-[-0.015em] text-balance sm:text-[34px]">
              {title}
            </h1>
            {badge}
          </div>
          {description ? (
            // div y no <p>: la descripción puede traer un esqueleto o un link
            // con bloque adentro, y un div dentro de un p rompe la hidratación.
            <div className="max-w-2xl text-sm text-muted-foreground text-pretty">{description}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  )
}
