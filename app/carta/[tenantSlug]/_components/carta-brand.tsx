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
    // Logo tal cual (recorte ajustado, sin marco): es la identidad. Altura
    // contenida para el header; el ancho fluye con la proporción real (~2.35:1).
    return (
      <Image
        src={logoUrl}
        alt={tenantName}
        width={220}
        height={94}
        className={cn('h-9 w-auto max-w-[160px] shrink-0 object-contain', className)}
        unoptimized
        priority
      />
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
