import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { GUIDE_PATHS } from '@/lib/accounting/guides'

/** Arriba de cada página de la guía: la vuelta y el título. */
export function GuideSubHeader({ base, title }: { base: string; title: string }) {
  return (
    <div className="grid gap-1">
      <Link
        href={`${base}${GUIDE_PATHS.home}`}
        className="inline-flex min-h-11 w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-8"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Guía
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">{title}</h1>
        <ReadOnlyBadge />
      </div>
    </div>
  )
}
