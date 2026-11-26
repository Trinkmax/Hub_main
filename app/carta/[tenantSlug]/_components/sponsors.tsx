'use client'

import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { type CartaSponsor, sponsorBox } from '@/lib/menu/sponsors'
import { cn } from '@/lib/utils'

/**
 * Las marcas que acompañan al bar (`lib/menu/sponsors.ts`). Cada logo es un sello de una tinta que la
 * carta pinta con el color del texto de donde esté: crema sobre la barra verde, verde sobre el papel.
 *
 * Las usan las dos cartas (la clásica y la nueva): por eso cada pieza trae sus colores puestos
 * (`carta-tones`, en `carta.css`) y no depende de estar adentro de `.carta`.
 */

/** Un sello, al tamaño que le toca para pesar como los demás. `size`: el lado de uno cuadrado. */
export function SponsorSeal({
  sponsor,
  size,
  className,
}: {
  sponsor: CartaSponsor
  size: number
  className?: string
}): React.JSX.Element {
  const box = sponsorBox(sponsor, size)
  return (
    <span
      role="img"
      aria-label={sponsor.name}
      className={cn('carta-seal', className)}
      style={
        {
          width: box.width,
          height: box.height,
          // La URL ya pasó por `safeLogoUrl`: no trae comillas ni paréntesis.
          '--seal': `url("${sponsor.logoUrl}")`,
        } as CSSProperties
      }
    />
  )
}

/** Desde cuántas marcas la franja se mueve (con menos, entran quietas en un celular). */
const MARQUEE_FROM = 4

/**
 * La franja de la barra: los sellos en crema sobre verde. En el celular pasan despacio, de derecha a
 * izquierda, solo mientras están a la vista; en una pantalla ancha entran todos y se quedan quietos.
 */
export function SponsorsBand({
  sponsors,
  className,
}: {
  sponsors: CartaSponsor[]
  className?: string
}): React.JSX.Element | null {
  const trackRef = useRef<HTMLUListElement>(null)
  const [running, setRunning] = useState(false)
  const moves = sponsors.length >= MARQUEE_FROM

  useEffect(() => {
    const track = trackRef.current
    if (!track || !moves) return
    const observer = new IntersectionObserver(
      ([entry]) => setRunning(Boolean(entry?.isIntersecting)),
      {
        rootMargin: '80px 0px',
      },
    )
    observer.observe(track)
    return () => observer.disconnect()
  }, [moves])

  if (sponsors.length === 0) return null

  const seals = (copy: boolean) =>
    sponsors.map((sponsor) => (
      <li
        key={`${copy ? 'copia' : 'marca'}-${sponsor.name}`}
        data-copy={copy ? '' : undefined}
        aria-hidden={copy || undefined}
        // La copia solo existe para que la tira dé la vuelta sin corte: quieta, sobra.
        className={cn('flex h-16 items-center px-6 lg:px-8', copy && 'motion-reduce:hidden')}
      >
        <SponsorSeal sponsor={sponsor} size={46} />
      </li>
    ))

  return (
    <section
      aria-label="Marcas que nos acompañan"
      className={cn(
        'carta-tones overflow-hidden bg-(--carta-night) py-9 text-(--carta-on-night)',
        className,
      )}
    >
      <p className="mb-5 text-center text-[0.8125rem] text-(--carta-on-night-soft)">
        Nos acompañan
      </p>
      {moves ? (
        <div className="carta-marquee-mask overflow-hidden lg:[-webkit-mask-image:none] lg:[mask-image:none]">
          <ul
            ref={trackRef}
            data-run={running ? '' : undefined}
            style={{ '--marquee-s': `${Math.max(18, sponsors.length * 4.6)}s` } as CSSProperties}
            className="carta-marquee lg:mx-auto lg:w-auto lg:max-w-5xl lg:flex-wrap lg:justify-center lg:animate-none lg:[&>[data-copy]]:hidden"
          >
            {seals(false)}
            {seals(true)}
          </ul>
        </div>
      ) : (
        <ul className="flex flex-wrap items-center justify-center">{seals(false)}</ul>
      )}
    </section>
  )
}

/** Los mismos sellos, chicos y quietos, en la tinta del papel: para el pie de cada pantalla. */
export function SponsorsLine({
  sponsors,
  className,
}: {
  sponsors: CartaSponsor[]
  className?: string
}): React.JSX.Element | null {
  if (sponsors.length === 0) return null
  return (
    <ul
      aria-label="Marcas que nos acompañan"
      className={cn(
        'carta-tones flex flex-wrap items-center justify-center gap-x-7 gap-y-4 text-(--carta-green)/75',
        className,
      )}
    >
      {sponsors.map((sponsor) => (
        <li key={sponsor.name} className="flex h-8 items-center">
          <SponsorSeal sponsor={sponsor} size={27} />
        </li>
      ))}
    </ul>
  )
}
