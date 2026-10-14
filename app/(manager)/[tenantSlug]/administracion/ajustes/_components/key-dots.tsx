import { cn } from '@/lib/utils'

/**
 * Las llaves: un punto por socio. Relleno verde = entra a Administración; con
 * aro dorado = además da accesos; hueco punteado = todavía no entra. Es un
 * gráfico de unidades, como las sillas del muro de mesas: «¿cuántos entran?»
 * se cuenta con el ojo.
 *
 * El dibujo nunca va solo: el número está en la oración de al lado y, en
 * tamaño `md`, en la leyenda con palabras de abajo. Por eso es decorativo
 * para lectores de pantalla.
 *
 * Cuándo NO: para decir QUIÉN entra (eso son las listas, con nombres), ni para
 * más de unas decenas de personas (después de `max` se resume en «+N»).
 */

type Dot = 'admin' | 'in' | 'out'

const DOT_SIZE = { sm: 'size-2', md: 'size-3' } as const

const DOT_LOOK: Readonly<Record<'sm' | 'md', Record<Dot, string>>> = {
  sm: {
    admin: 'bg-adm-in ring-[1.5px] ring-adm-s2',
    in: 'bg-adm-in',
    out: 'border border-dashed border-muted-foreground/70',
  },
  md: {
    admin: 'bg-adm-in ring-2 ring-adm-s2 ring-offset-1 ring-offset-card',
    in: 'bg-adm-in',
    out: 'border-[1.5px] border-dashed border-muted-foreground/70',
  },
}

export function KeyDots({
  inCount,
  adminCount,
  outCount,
  size = 'sm',
  max = 24,
  legend = false,
  className,
}: {
  /** Cuántos entran (incluye a los que dan accesos). */
  inCount: number
  /** De los que entran, cuántos dan accesos. */
  adminCount: number
  /** Cuántos todavía no entran. */
  outCount: number
  size?: 'sm' | 'md'
  /** Cuántos puntos se dibujan como mucho; el resto se dice en «+N». */
  max?: number
  /** La leyenda en palabras debajo (solo en la habitación, no en la portada). */
  legend?: boolean
  className?: string
}) {
  const admins = Math.max(0, Math.min(Math.trunc(adminCount), Math.trunc(inCount)))
  const members = Math.max(0, Math.trunc(inCount) - admins)
  const outside = Math.max(0, Math.trunc(outCount))
  const all: Dot[] = [
    ...Array<Dot>(admins).fill('admin'),
    ...Array<Dot>(members).fill('in'),
    ...Array<Dot>(outside).fill('out'),
  ]
  const shown = all.slice(0, Math.max(0, max))
  const rest = all.length - shown.length

  return (
    <div className={cn('min-w-0', className)}>
      <div
        aria-hidden
        className={cn('flex flex-wrap items-center', size === 'sm' ? 'gap-1' : 'gap-2')}
      >
        {shown.map((dot, index) => (
          <span
            // Los puntos no tienen identidad propia: la posición es la clave.
            // biome-ignore lint/suspicious/noArrayIndexKey: lista de unidades iguales, sin reordenar
            key={index}
            className={cn('shrink-0 rounded-full', DOT_SIZE[size], DOT_LOOK[size][dot])}
          />
        ))}
        {rest > 0 ? (
          <span
            className={cn(
              'font-mono text-muted-foreground tabular-nums',
              size === 'sm' ? 'text-[9px] leading-none' : 'text-xs',
            )}
          >
            +{rest}
          </span>
        ) : null}
        {all.length === 0 ? (
          <span className={cn('rounded-full border border-dashed border-border', DOT_SIZE[size])} />
        ) : null}
      </div>
      {legend ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2.5 rounded-full', DOT_LOOK.sm.in)} />
            Entran <b className="font-semibold text-foreground tabular-nums">{inCount}</b>
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2.5 rounded-full', DOT_LOOK.sm.admin)} />
            Dan accesos <b className="font-semibold text-foreground tabular-nums">{admins}</b>
          </li>
          {outside > 0 ? (
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn('size-2.5 rounded-full', DOT_LOOK.sm.out)} />
              Todavía no entran{' '}
              <b className="font-semibold text-foreground tabular-nums">{outside}</b>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
