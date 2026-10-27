import Image from 'next/image'
import { cn } from '@/lib/utils'

/**
 * El afiche de una película. Sin imagen cargada, un afiche tipográfico con el
 * color de la película: la cartelera nunca muestra un hueco gris.
 */
export function Poster({
  title,
  series,
  url,
  sizes,
  priority = false,
  className,
  children,
}: {
  title: string
  series?: string | null
  url: string | null
  sizes: string
  priority?: boolean
  className?: string
  /** Capas encima del afiche (el barrido de luz), recortadas a su borde. */
  children?: React.ReactNode
}) {
  return (
    <div className={cn('ent-poster aspect-[2/3]', className)}>
      {url ? (
        <Image
          src={url}
          alt={`Afiche de ${title}`}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <div
          className="absolute inset-0 flex flex-col justify-between p-5"
          style={{
            background:
              'radial-gradient(120% 80% at 30% 10%, color-mix(in oklab, var(--accent) 70%, white 10%), color-mix(in oklab, var(--accent) 35%, #050806) 70%)',
          }}
        >
          <span className="ent-mono text-[0.6rem] text-(--ent-cream-2)">
            {series ?? 'Experiencia'}
          </span>
          <span className="ent-display text-[2.4rem] text-balance text-(--ent-cream)">{title}</span>
          <span aria-hidden className="text-2xl text-(--ent-gold)">
            ✦
          </span>
        </div>
      )}
      {children}
    </div>
  )
}
