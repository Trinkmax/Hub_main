import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

/** El encabezado de una pantalla de tarea (la ficha, «Completar»): la vuelta, el título y, si hace falta, una línea. */
export function TaskHeader({
  back,
  title,
  note,
}: {
  back: { href: string; label: string }
  title: ReactNode
  note?: ReactNode
}) {
  return (
    <header className="grid gap-1">
      <Link
        href={back.href}
        className="-ml-1.5 inline-flex min-h-8 items-center gap-1 justify-self-start rounded-md px-1.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none pointer-coarse:min-h-11"
      >
        <ChevronLeft aria-hidden className="size-4" />
        {back.label}
      </Link>
      <h1 className="font-serif text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      {note ? <p className="text-sm text-muted-foreground text-pretty">{note}</p> : null}
    </header>
  )
}
