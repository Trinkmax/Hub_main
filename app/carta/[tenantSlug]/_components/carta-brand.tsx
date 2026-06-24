import Image from 'next/image'
import { cn } from '@/lib/utils'

/**
 * Logo del bar en la carta (multi-tenant): si el tenant tiene `logo_url`, muestra
 * la imagen; si no, cae a un wordmark serif del nombre con el acento "!" de la
 * marca (mismo tratamiento que components/shell/brand-mark). Para HUB ⇒ "Hub!".
 */
export function CartaBrand({
  tenantName,
  logoUrl,
  className,
}: {
  tenantName: string
  logoUrl: string | null
  className?: string
}): React.JSX.Element {
  if (logoUrl) {
    return (
      <span
        className={cn(
          'relative block size-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-border/60',
          className,
        )}
      >
        <Image
          src={logoUrl}
          alt={tenantName}
          fill
          sizes="44px"
          className="object-cover"
          unoptimized
          priority
        />
      </span>
    )
  }
  return (
    <span
      className={cn(
        'font-serif text-2xl font-semibold leading-none tracking-[-0.03em] text-foreground',
        className,
      )}
    >
      {tenantName}
      <span className="text-[color:var(--brand-accent,var(--primary))]">!</span>
    </span>
  )
}
