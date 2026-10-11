import type { VariantProps } from 'class-variance-authority'
import { AtSign } from 'lucide-react'
import { Button, type buttonVariants } from '@/components/ui/button'
import { formatInstagramHandle, instagramProfileUrl } from '@/lib/salon/instagram'
import { cn } from '@/lib/utils'

/**
 * El Instagram de la reserva como texto ("@juan.perez"): abre el perfil en otra
 * pestaña para escribirle desde ahí.
 */
export function InstagramLink({ handle, className }: { handle: string; className?: string }) {
  return (
    <a
      href={instagramProfileUrl(handle)}
      target="_blank"
      rel="noopener noreferrer"
      title="Abrir su Instagram"
      className={cn(
        'rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {formatInstagramHandle(handle)}
    </a>
  )
}

/**
 * El mismo enlace como botón, al lado de «Contactar». `size="icon"` deja solo
 * el ícono (en las listas el texto no entra); el nombre queda en el
 * `aria-label`.
 */
export function InstagramButton({
  handle,
  variant = 'outline',
  size = 'sm',
}: { handle: string } & VariantProps<typeof buttonVariants>) {
  const iconOnly = size === 'icon'
  const label = `Abrir el Instagram de ${formatInstagramHandle(handle)}`
  return (
    <Button asChild variant={variant} size={size}>
      <a
        href={instagramProfileUrl(handle)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
      >
        <AtSign className="size-4" aria-hidden />
        {iconOnly ? null : 'Instagram'}
      </a>
    </Button>
  )
}
