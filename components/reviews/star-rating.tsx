import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

// Display puro de una calificación con estrellas (no interactivo). Server-safe.

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
            value <= rating
              ? 'fill-amber-400 text-amber-400'
              : 'fill-transparent text-muted-foreground/30',
          )}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
