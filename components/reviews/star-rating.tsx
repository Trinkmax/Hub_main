import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

// Display puro de una calificación con estrellas (no interactivo). Server-safe.
//
// Las llenas van en el ámbar del kit (`--warning`: es un relleno, 3,5:1 sobre
// cartulina) y las vacías con el pelo fuerte. El número exacto lo dice la
// etiqueta accesible («4 de 5 estrellas»): el color nunca es la única señal.

export function StarRating({
  rating,
  size = 'sm',
  className,
}: {
  rating: number
  size?: 'sm' | 'md'
  className?: string
}): React.JSX.Element {
  const starClass = size === 'md' ? 'size-5' : 'size-4'
  return (
    <div
      className={cn('flex items-center gap-0.5', className)}
      role="img"
      aria-label={`${rating} de 5 estrellas`}
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          className={cn(
            starClass,
            value <= rating ? 'fill-warning text-warning' : 'fill-transparent text-border-strong',
          )}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
