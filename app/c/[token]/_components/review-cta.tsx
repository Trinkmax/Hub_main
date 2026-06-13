import { ChevronRight, Star } from 'lucide-react'
import Link from 'next/link'

// CTA en la wallet del cliente para dejar una reseña. Server component — linkea
// a /r/[qrToken], la página pública que captura la calificación.

export function ReviewCta({ qrToken }: { qrToken: string }): React.JSX.Element {
  return (
    <section aria-labelledby="review-cta-heading" className="space-y-3">
      <h2 id="review-cta-heading" className="sr-only">
        Dejá tu opinión
      </h2>
      <Link
        href={`/r/${qrToken}`}
        className="card-hairline group flex items-center gap-4 rounded-2xl border bg-card px-4 py-4 shadow-md transition-colors hover:border-[--brand-accent,var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--brand-accent,var(--primary)] focus-visible:ring-offset-2"
      >
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-accent,var(--primary))]/12 text-[var(--brand-accent,var(--primary))]">
          <Star className="size-5 fill-current" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">Dejá tu opinión ⭐</p>
          <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
            Contanos cómo fue tu experiencia. Te toma 10 segundos.
          </p>
        </div>
        <ChevronRight
          className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </section>
  )
}
