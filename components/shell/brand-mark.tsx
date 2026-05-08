import { cn } from '@/lib/utils'

type BrandMarkProps = {
  className?: string
  size?: number
}

/**
 * Brand mark fiel al logo HUB! — wordmark serif heavy con exclamación distintiva.
 * Usa `currentColor` para heredar el color del contexto (forest en cream, cream en forest).
 */
export function BrandMark({ className, size = 36 }: BrandMarkProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md font-serif font-semibold leading-none text-foreground',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }}
      aria-hidden
    >
      <svg
        role="img"
        viewBox="0 0 64 40"
        width={size}
        height={Math.round(size * 0.625)}
        aria-label="HUB!"
        fill="currentColor"
      >
        <title>HUB!</title>
        <text
          x="0"
          y="32"
          fontFamily="var(--font-fraunces, ui-serif, Georgia, serif)"
          fontSize="38"
          fontWeight="700"
          letterSpacing="-1.6"
        >
          HUB!
        </text>
      </svg>
    </span>
  )
}

/**
 * Wordmark "HUB!" en serif heavy. Usado en topbar / login / emails.
 * `tracking-[-0.04em]` y exclamación marcada como en el logo original.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'font-serif text-[15px] font-semibold leading-none tracking-[-0.04em]',
        className,
      )}
    >
      HUB
      <span className="text-primary">!</span>
    </span>
  )
}

/**
 * Wordmark grande con tagline COFFEE&BAR — uso en login hero / standalone PWA.
 */
export function BrandWordmarkLarge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-3', className)}>
      <span className="font-serif text-5xl font-semibold leading-none tracking-[-0.045em]">
        HUB
        <span className="text-primary">!</span>
      </span>
      <span className="hidden text-[10px] font-medium uppercase tracking-[0.32em] text-muted-foreground sm:inline">
        Coffee & Bar
      </span>
    </span>
  )
}
