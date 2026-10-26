import { ArrowUpRight, MessageCircle, Ticket, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { type CarteleraSummary, carteleraSummaryParts } from '../_lib/overview'

/** El texto que arma WhatsApp al compartir (sin número: elige el contacto quien comparte). */
export function carteleraShareText(publicUrl: string): string {
  return `¡Hola! Acá podés ver todas las funciones y reservar tu lugar: ${publicUrl}`
}

/**
 * «Tu cartelera»: el link público con todas las películas, listo para copiar,
 * abrir o mandar por WhatsApp, y en una línea cómo está hoy.
 */
export function CarteleraCard({
  publicUrl,
  summary,
  canSell,
}: {
  publicUrl: string
  summary: CarteleraSummary
  /** Hay cuenta de Mercado Pago: se puede comprar. */
  canSell: boolean
}) {
  const parts = carteleraSummaryParts(summary)
  const bare = publicUrl.replace(/^https?:\/\//, '')
  const cut = bare.lastIndexOf('/') + 1
  const shareHref = `https://wa.me/?text=${encodeURIComponent(carteleraShareText(publicUrl))}`

  return (
    <section
      aria-labelledby="cartelera-title"
      className="card-hairline rounded-xl border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="min-w-0 space-y-2">
          <h2
            id="cartelera-title"
            className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
          >
            <Ticket className="size-3.5" aria-hidden />
            Tu cartelera
          </h2>
          <p className="break-all font-mono text-[15px] leading-snug sm:text-base">
            <span className="text-muted-foreground">{bare.slice(0, cut)}</span>
            <span className="font-semibold text-foreground">{bare.slice(cut)}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {parts.map((part, index) => (
              <span key={part.label}>
                {index > 0 ? ' · ' : null}
                <span className="font-semibold text-foreground tabular-nums">{part.value}</span>{' '}
                {part.label}
              </span>
            ))}
            {summary.published === 0 && summary.drafts > 0
              ? summary.drafts === 1
                ? '. Tenés una apagada: prendela abajo cuando esté lista.'
                : `. Tenés ${summary.drafts} apagadas: prendelas abajo cuando estén listas.`
              : null}
          </p>
        </div>

        <div className="grid gap-2 sm:flex sm:flex-wrap lg:shrink-0 lg:justify-end">
          <CopyButton
            value={publicUrl}
            label="Copiar link"
            copiedLabel="¡Copiado!"
            size="default"
            className="h-11 sm:h-9"
          />
          <Button asChild variant="outline" className="h-11 sm:h-9">
            <a href={publicUrl} target="_blank" rel="noopener noreferrer">
              Abrir
              <ArrowUpRight className="size-4" aria-hidden />
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          </Button>
          <Button asChild variant="outline" className="h-11 sm:h-9">
            <a href={shareHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" aria-hidden />
              Compartir por WhatsApp
            </a>
          </Button>
        </div>
      </div>

      {canSell ? null : (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-text">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          Todavía no conectaste Mercado Pago: la cartelera se ve, pero nadie puede comprar.
          Conectalo acá abajo.
        </p>
      )}
    </section>
  )
}
