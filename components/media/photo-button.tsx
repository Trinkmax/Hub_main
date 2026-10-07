import { Camera, type LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { StorageImage } from '@/components/media/storage-image'
import { cn } from '@/lib/utils'

export type PhotoButtonProps = Omit<React.ComponentProps<'button'>, 'children' | 'aria-label'> & {
  /** URL de Storage. Sin foto se ve `fallback` o el ícono de respaldo. */
  src: string | null | undefined
  /** `sizes` de la imagen: el ancho que ocupa (`'48px'`). */
  sizes: string
  /** Ícono de respaldo cuando todavía no hay foto. */
  fallbackIcon: LucideIcon
  /** Respaldo propio (la inicial de una marca) en lugar del ícono. */
  fallback?: React.ReactNode
  /** Lo que hace el botón, para el lector: «Cambiar la foto de Café». */
  label: string
  /** `rounded` (fotos de ítems y tarjetas) · `circle` (logos). */
  shape?: 'rounded' | 'circle'
  /** `md` 44 px · `lg` 48 px (default). */
  size?: 'md' | 'lg'
}

/**
 * La «foto tocable» del panel: la miniatura de una fila ES el botón que abre su
 * editor (ahí se sube o se cambia la foto). Lleva un sello de cámara siempre a
 * la vista: con el dedo no hay hover que anuncie que se puede tocar, y es lo
 * que muestran los tours del club y de la carta.
 *
 * Usa `StorageImage` (compartido y congelado) tal cual: variantes pregeneradas
 * de Storage, sin el optimizador de Vercel.
 */
export function PhotoButton({
  src,
  sizes,
  fallbackIcon: Icon,
  fallback,
  label,
  shape = 'rounded',
  size = 'lg',
  className,
  type = 'button',
  ...props
}: PhotoButtonProps) {
  const radius = shape === 'circle' ? 'rounded-full' : 'rounded-lg'
  return (
    <button
      type={type}
      aria-label={label}
      data-slot="photo-button"
      className={cn(
        'group/foto relative flex shrink-0 items-center justify-center border border-border bg-secondary',
        'transition-colors duration-(--duration-quick) hover:border-border-strong',
        'outline-offset-2 outline-(--ring) focus-visible:outline-2',
        size === 'lg' ? 'size-12' : 'size-11',
        radius,
        className,
      )}
      {...props}
    >
      {src ? (
        <span className={cn('absolute inset-0 overflow-hidden', radius)}>
          <StorageImage src={src} alt="" sizes={sizes} />
        </span>
      ) : (
        (fallback ?? <Icon className="size-5 text-subtle-foreground" aria-hidden="true" />)
      )}
      <span
        aria-hidden="true"
        className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground transition-colors duration-(--duration-quick) group-hover/foto:bg-primary-hover"
      >
        <Camera className="size-3" />
      </span>
    </button>
  )
}
