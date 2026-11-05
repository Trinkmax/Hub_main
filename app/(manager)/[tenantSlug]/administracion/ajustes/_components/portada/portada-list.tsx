import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Planilla } from '@/components/administracion/planilla'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import type { PortadaRow } from '../../_lib/portada'

const ROW_LINK =
  'group flex items-center gap-3 outline-none transition-colors hover:bg-primary/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none'

/**
 * La portada de Ajustes: una lista con una fila por habitación y, arriba, cómo viene la puesta en
 * marcha («no la encuentran» fue un reclamo de la reunión del 29/10/2026). Cada fila dice en una
 * oración lo que hay y, si hace falta, su estado en una palabra (`portadaRows`).
 *
 * Son links: acá no se guarda nada, así que la contadora ve lo mismo. Las habitaciones de adentro
 * deciden qué controles recibe cada uno.
 */
export function PortadaList({
  rows,
  setup,
  guideHref,
}: {
  rows: readonly PortadaRow[]
  /** `null`: la guía no cargó, no se afirma un avance. */
  setup: { done: number; total: number } | null
  guideHref: string
}) {
  const percent =
    setup && setup.total > 0
      ? Math.min(100, Math.max(0, Math.round((setup.done * 100) / setup.total)))
      : null

  return (
    <div className="grid gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Link
          href={guideHref}
          className={`${ROW_LINK} min-h-11 min-w-0 flex-1 rounded-xl border border-border/70 bg-card px-3 py-2 shadow-xs`}
        >
          <span className="shrink-0 text-sm font-medium whitespace-nowrap">
            Puesta en marcha
            {setup && setup.total > 0 ? `: ${setup.done} de ${setup.total}` : ''}
          </span>
          {percent === null ? (
            <span className="flex-1" />
          ) : (
            <span
              role="img"
              aria-label={`${setup?.done ?? 0} de ${setup?.total ?? 0} pasos hechos`}
              className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-foreground/10"
            >
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${percent}%` }}
              />
            </span>
          )}
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </Link>
        <ReadOnlyBadge />
      </div>

      <Planilla>
        <ul aria-label="Ajustes">
          {rows.map((row) => (
            <li key={row.room} className="border-b border-border/60 last:border-b-0">
              <Link href={row.href} className={`${ROW_LINK} min-h-12 px-3 py-2.5 sm:min-h-0`}>
                <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
                  <span className="block shrink-0 text-sm font-medium sm:w-44">{row.title}</span>
                  <span
                    title={row.sentenceTitle ?? row.sentence}
                    className="mt-0.5 line-clamp-2 block min-w-0 text-[13px] text-muted-foreground text-pretty sm:mt-0 sm:flex-1 sm:truncate"
                  >
                    {row.sentence}
                  </span>
                  {row.pill ? (
                    <span className="mt-1.5 flex sm:hidden">
                      <StatusPill tone={row.pill.tone} className="max-w-full">
                        <span className="truncate">{row.pill.text}</span>
                      </StatusPill>
                    </span>
                  ) : null}
                </span>
                {row.pill ? (
                  <StatusPill tone={row.pill.tone} className="max-w-56 max-sm:hidden">
                    <span className="truncate">{row.pill.text}</span>
                  </StatusPill>
                ) : null}
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </li>
          ))}
        </ul>
      </Planilla>
    </div>
  )
}
