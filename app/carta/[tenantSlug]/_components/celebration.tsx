'use client'

import { Sparkles } from 'lucide-react'
import { useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * Lo que se ve el día que abre una sucursal (docs/features/carta-por-sucursal.md): la cinta que se corta en el
 * selector, el sello que gira y la bienvenida arriba de su carta. Las animaciones viven en `carta.css`
 * (`carta-ribbon-*`, `carta-stamp-*`) y se apagan con «reducir movimiento».
 */

/** La cinta de la inauguración, de lado a lado, con su moño en el medio. `cut` la corta: cae cada mitad. */
export function OpeningRibbon({
  cut,
  className,
}: {
  cut: boolean
  className?: string
}): React.JSX.Element {
  const gradient = useId()
  return (
    <div aria-hidden data-cut={cut || undefined} className={cn('carta-ribbon', className)}>
      <span className="carta-ribbon-half carta-ribbon-left" />
      <span className="carta-ribbon-half carta-ribbon-right" />
      <svg className="carta-ribbon-bow" viewBox="0 0 120 84" role="presentation">
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#f8e3a3" />
            <stop offset="0.48" stopColor="#e2b04e" />
            <stop offset="0.56" stopColor="#c48a2c" />
            <stop offset="1" stopColor="#efcd78" />
          </linearGradient>
        </defs>
        {/* Las colas caen en diagonal desde el nudo. */}
        <path
          d="M56 40 L36 80 L44 77 L48 84 L60 46 Z M64 40 L84 80 L76 77 L72 84 L60 46 Z"
          fill={`url(#${gradient})`}
          stroke="#a8742a"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        {/* Las dos lazadas. */}
        <path
          d="M60 38 C44 18 14 14 10 30 C6 46 34 50 60 42 Z M60 38 C76 18 106 14 110 30 C114 46 86 50 60 42 Z"
          fill={`url(#${gradient})`}
          stroke="#a8742a"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        <path
          d="M58 37 C46 26 24 22 20 30 M62 37 C74 26 96 22 100 30"
          fill="none"
          stroke="#fff6d8"
          strokeOpacity="0.7"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        {/* El nudo. */}
        <rect
          x="51"
          y="31"
          width="18"
          height="17"
          rx="5"
          fill={`url(#${gradient})`}
          stroke="#a8742a"
          strokeWidth="0.8"
        />
      </svg>
    </div>
  )
}

/**
 * El sello redondo que gira despacio, con el texto alrededor como el «coffee & bar» del logo. El texto se
 * estira justo a la vuelta entera (`textLength`), así no queda un hueco ni se pisa, diga lo que diga.
 */
export function OpeningStamp({
  text,
  className,
}: {
  text: string
  className?: string
}): React.JSX.Element {
  const circle = useId()
  const radius = 37
  return (
    <div aria-hidden className={cn('carta-stamp', className)}>
      <svg viewBox="0 0 100 100" className="carta-stamp-ring size-full" role="presentation">
        <defs>
          <path
            id={circle}
            d={`M50 50 m-${radius} 0 a${radius} ${radius} 0 1 1 ${radius * 2} 0 a${radius} ${radius} 0 1 1 -${radius * 2} 0`}
          />
        </defs>
        <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeOpacity="0.35" />
        <circle
          cx="50"
          cy="50"
          r="27"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeDasharray="1.5 3"
        />
        <text
          fill="currentColor"
          fontSize="8.6"
          fontWeight="600"
          style={{ fontFamily: 'var(--font-sans, ui-sans-serif)' }}
        >
          <textPath href={`#${circle}`} textLength={2 * Math.PI * radius} lengthAdjust="spacing">
            {text}
          </textPath>
        </text>
      </svg>
      <Sparkles className="carta-stamp-core absolute left-1/2 top-1/2 size-[26%] -translate-x-1/2 -translate-y-1/2" />
    </div>
  )
}

/** El texto de un sello: las partes separadas por puntos, dos vueltas de lo mismo alrededor. */
export function stampText(...parts: string[]): string {
  const once = `${parts.map((part) => part.toUpperCase()).join(' · ')} · `
  return `${once}${once}`
}

/**
 * La bienvenida arriba de la carta de la sucursal que abre hoy. En el color de la sucursal, con su sello: sin
 * botones ni nada que tapar; se pasa de largo con el dedo y la carta sigue igual que siempre.
 */
export function OpeningBanner({
  branchName,
  color,
}: {
  branchName: string
  color: string
}): React.JSX.Element {
  return (
    <section
      aria-label={`Inauguración de ${branchName}`}
      className="carta-fiesta relative isolate overflow-hidden rounded-[26px] px-5 py-5 text-[#fbf7ef] shadow-[0_18px_36px_-22px_rgba(40,20,10,0.6)]"
      style={{ backgroundColor: color }}
    >
      <span aria-hidden className="carta-fiesta-light absolute inset-0 -z-10" />
      <div className="max-w-[66%]">
        <h2 className="font-serif text-[1.75rem] font-semibold leading-[1.02] tracking-[-0.025em] text-balance">
          ¡Hoy inauguramos!
        </h2>
        <p className="mt-2 text-[14px] leading-snug text-[#fbf7ef]/85">
          Bienvenidos. Gracias por ser parte del primer día.
        </p>
      </div>
      <OpeningStamp
        text={stampText(branchName, 'Primer día')}
        className="absolute right-4 top-1/2 size-[104px] -translate-y-1/2 text-[#fbf7ef]"
      />
    </section>
  )
}
