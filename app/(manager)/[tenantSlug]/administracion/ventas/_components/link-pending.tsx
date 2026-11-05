'use client'

import { useLinkStatus } from 'next/link'
import { cn } from '@/lib/utils'

/**
 * La señal inmediata de un link que ya se tocó: va DENTRO del `<Link>` y se dibuja mientras la
 * navegación está en camino (`useLinkStatus`). «Ver cierre» se marca al instante, sin esperar al
 * servidor.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-primary ring-inset motion-safe:animate-pulse',
        className,
      )}
    />
  )
}
