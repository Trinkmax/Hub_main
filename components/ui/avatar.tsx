import type * as React from 'react'
import { cn } from '@/lib/utils'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg'

/** 24 · 32 · 40 · 56 px (§3.5). `sm` (32) es el de siempre. */
const SIZE_CLASS: Readonly<Record<AvatarSize, string>> = {
  xs: 'size-6 type-caption',
  sm: 'size-8 type-caption',
  md: 'size-10 type-small',
  lg: 'size-14 type-subtitle',
}

type AvatarProps = React.ComponentProps<'span'> & { size?: AvatarSize }

/**
 * Círculo con iniciales (o foto). Server-safe: sin el primitivo de Radix,
 * que es de cliente y en el panel solo dibujaba iniciales. Mismos exports que
 * antes; el tamaño de `className` (`size-9`) sigue ganando.
 */
function Avatar({ size = 'sm', className, ...props }: AvatarProps) {
  return (
    <span
      data-slot="avatar"
      data-size={size}
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-full font-medium',
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  )
}

/**
 * La foto va encima de las iniciales: si carga, las tapa; si no, quedan las
 * iniciales (con `alt=""` el navegador no dibuja el ícono de imagen rota).
 * Para fotos de Storage usá `StorageImage` adentro del `Avatar`.
 */
function AvatarImage({ className, alt = '', ...props }: React.ComponentProps<'img'>) {
  return (
    // biome-ignore lint/performance/noImgElement: primitivo del kit; las fotos de Storage van con StorageImage (sin el optimizer de Vercel)
    <img
      data-slot="avatar-image"
      alt={alt}
      className={cn('absolute inset-0 size-full object-cover', className)}
      {...props}
    />
  )
}

/** Iniciales en `bg-secondary` y tinta apagada. */
function AvatarFallback({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full select-none items-center justify-center rounded-full bg-secondary text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export type { AvatarProps }
export { Avatar, AvatarFallback, AvatarImage }
