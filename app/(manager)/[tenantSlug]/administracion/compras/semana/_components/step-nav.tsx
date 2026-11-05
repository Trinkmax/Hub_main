import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

const STEP = 'size-10 text-muted-foreground hover:text-foreground md:pointer-fine:size-8'

/** ‹ «Semana del 02/11 al 08/11» › : ir para atrás y para adelante, sin mover la página. Server-safe. */
export function StepNav({
  label,
  prevHref,
  prevLabel,
  nextHref,
  nextLabel,
}: {
  label: string
  prevHref: string
  prevLabel: string
  nextHref: string
  nextLabel: string
}) {
  return (
    <div className="flex items-center gap-1">
      <Button asChild variant="ghost" size="icon" className={STEP}>
        <Link href={prevHref} scroll={false} aria-label={prevLabel}>
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
      </Button>
      <span className="text-[13px] font-medium whitespace-nowrap tabular-nums">{label}</span>
      <Button asChild variant="ghost" size="icon" className={STEP}>
        <Link href={nextHref} scroll={false} aria-label={nextLabel}>
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </Button>
    </div>
  )
}
