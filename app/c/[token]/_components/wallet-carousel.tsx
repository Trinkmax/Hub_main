import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Carrusel horizontal con scroll-snap nativo (swipe en mobile; drag/scroll en
// desktop). Sangra a los bordes de la columna (-mx-4 px-4) para invitar al swipe
// dejando ver el borde de la próxima card. Los hijos deben ser `shrink-0 snap-start`.

export function WalletCarousel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        '-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1',
        '[-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {children}
    </div>
  )
}
