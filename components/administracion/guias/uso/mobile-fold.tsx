'use client'

import { ChevronDown } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Algo que en el celular viene plegado y en la compu se ve siempre: el glosario, los detalles de
 * cada unión. En el celular la guía se lee de corrido y con el pulgar; lo que es de consulta no
 * tiene que ocupar pantallas enteras antes de lo que sigue.
 *
 * Es el mismo contenido en los dos tamaños (no se dibuja dos veces): desde `sm` el botón no está
 * y el contenido se muestra pase lo que pase, así la compu no depende de que haya cargado el
 * script. Desde `sm` ni el plegable ni su contenido arman caja (`contents`): lo de adentro se
 * acomoda en la grilla de quien lo usa.
 */
export function MobileFold({
  label,
  className,
  contentClassName,
  children,
}: {
  /** Lo que dice el botón: qué hay adentro («Ver las 22 palabras»). */
  label: ReactNode
  className?: string
  /** Cómo se acomoda lo de adentro en el celular, ya abierto (`max-sm:…`). */
  contentClassName?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={cn('sm:contents', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left text-sm font-medium text-foreground outline-none hover:underline hover:decoration-border hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
      >
        <span className="min-w-0 text-pretty">{label}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      <div id={id} className={cn(!open && 'hidden', 'sm:contents', contentClassName)}>
        {children}
      </div>
    </div>
  )
}
