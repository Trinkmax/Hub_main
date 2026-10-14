import { ArrowRight, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * Una acción grande para tocar: el ícono en un círculo, QUÉ querés hacer dicho
 * como lo diría un socio («Pagué algo recién») y, en gris, un ejemplo que lo
 * ancla («El hielo, la verdulería, un flete»). Es la tarjeta de las recetas de
 * la guía («¿Qué pasó?»). El lanzador «¿Qué querés cargar?» ya no la usa: tiene
 * sus propias puertas (dos grandes y seis renglones, `nav/launcher.tsx`), con
 * los mismos textos.
 *
 * Con `href` es un link; con `onClick`, un botón (abre una hoja). Se levanta
 * al pasar el mouse y se hunde al tocarla (`press-lift`).
 *
 * Cuándo NO: para la acción principal de una pantalla que ya tiene su botón
 * (un solo primario por vista), para elegir una opción dentro de un formulario
 * (eso es `ChoiceCard`), ni con el nombre contable como título («Asiento
 * manual»): se entra por la situación.
 */

const TILE =
  'group card-hairline press-lift flex min-h-[4.5rem] w-full items-center gap-3.5 rounded-2xl border bg-card p-3.5 text-left shadow-xs hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4'

export function ActionTile({
  icon: Icon,
  title,
  hint,
  href,
  onClick,
  className,
}: {
  icon: LucideIcon
  title: string
  /** El ejemplo en gris. */
  hint?: string
  href?: string
  onClick?: () => void
  className?: string
}) {
  const body = (
    <>
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-snug text-pretty">{title}</span>
        {hint ? (
          <span className="mt-0.5 block text-sm leading-snug text-muted-foreground text-pretty">
            {hint}
          </span>
        ) : null}
      </span>
      <ArrowRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground transition-[translate,color] duration-(--duration-fast) ease-(--ease-out) group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
      />
    </>
  )

  if (href) {
    // `onClick` también en el link: el lanzador lo usa para cerrarse al navegar.
    return (
      <Link href={href} onClick={onClick} className={cn(TILE, className)}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cn(TILE, className)}>
      {body}
    </button>
  )
}
