import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * El logo del bar en crema sobre la sala a oscuras.
 *
 * Se pinta con máscara (el PNG del logo es la silueta y el color lo pone el
 * CSS): así el logo verde de HUB sale crema sin tener otro archivo, y lo
 * mismo con el de cualquier bar. Sin logo, el nombre en la serif de la marca.
 */
export function BrandMark({
  name,
  logoUrl,
  href,
  className,
}: {
  name: string
  logoUrl: string | null
  href?: string
  className?: string
}) {
  const mark = logoUrl ? (
    <span
      role="img"
      aria-label={name}
      className={cn('block h-9 w-[6.5rem] bg-(--ent-cream)', className)}
      style={{
        WebkitMaskImage: `url(${logoUrl})`,
        maskImage: `url(${logoUrl})`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'left center',
        maskPosition: 'left center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  ) : (
    <span className={cn('ent-display text-2xl', className)}>{name}</span>
  )

  if (!href) return mark
  return (
    <Link
      href={href}
      className="ent-press inline-flex rounded-md"
      aria-label={`${name}: cartelera`}
    >
      {mark}
    </Link>
  )
}
