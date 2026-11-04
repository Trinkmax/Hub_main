import Link from 'next/link'
import { cn } from '@/lib/utils'
import { monthTitle } from '../_lib/planilla-words'

/**
 * Los meses de una planilla: una tira de links, el elegido relleno. Va en la `PlanillaBar` de Gastos
 * fijos y de Sueldos. Server-safe. El mes vive en la URL (`?mes=`): un socio le puede pasar el link a
 * otro.
 */
export function MonthSeg({
  months,
  active,
  hrefOf,
  label,
}: {
  /** `yyyy-MM`. */
  months: readonly string[]
  active: string
  hrefOf: (month: string) => string
  /** Para lectores: «Mes de la planilla». */
  label: string
}) {
  return (
    <nav
      aria-label={label}
      className="inline-flex overflow-hidden rounded-lg border border-border bg-card shadow-xs"
    >
      {months.map((month) => (
        <Link
          key={month}
          href={hrefOf(month)}
          scroll={false}
          aria-current={month === active ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-8 items-center border-border/70 px-3 text-[13px] font-medium whitespace-nowrap outline-none transition-colors not-first:border-l focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none pointer-coarse:min-h-11',
            month === active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
        >
          {monthTitle(month)}
        </Link>
      ))}
    </nav>
  )
}
