import { ArrowRight } from 'lucide-react'
import { PanelLink, StatusPill } from '@/components/administracion/kit'
import type { PartyList } from '@/lib/accounting/queries/parties'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import type { TreasuryAccountRow } from '@/lib/accounting/queries/treasury'
import { incomingStrip, receivableTranches, walletBoxes } from '../_lib/incoming'
import { tabHref } from '../_lib/ventas-view'

/**
 * La franja «En camino» de «El mes»: en un renglón, si hay plata que ya
 * tendría que haber llegado o cuánto llega esta semana, con el link a «Plata
 * por cobrar». No es un panel con una lista: la lista vive en su vista.
 *
 * Sin nada por cobrar no se dibuja. Si la lectura falla, tampoco: no es un
 * error que merezca un cartel en una pantalla que ya mostró lo importante.
 */
export async function IncomingStrip({
  parties,
  treasuries,
  base,
}: {
  parties: Promise<QueryOutcome<PartyList>>
  treasuries: Promise<QueryOutcome<TreasuryAccountRow[]>>
  /** `/<bar>/administracion`. */
  base: string
}) {
  const [list, boxes] = await Promise.all([parties, treasuries])
  if (!list.ok) return null
  const wallets = walletBoxes(list.data.rows, boxes.ok ? boxes.data : [])
  const strip = incomingStrip(receivableTranches(list.data.rows, new Set(wallets.keys())))
  if (!strip) return null
  return (
    <section
      aria-label="En camino"
      className="card-hairline flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border bg-card px-4 py-3 shadow-xs sm:px-5"
    >
      <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-pretty">
        <StatusPill tone={strip.tone}>{strip.word}</StatusPill>
        <span>{strip.sentence}</span>
      </p>
      <PanelLink href={tabHref(base, 'clientes')}>
        Ver la plata por cobrar
        <ArrowRight aria-hidden className="size-3.5" />
      </PanelLink>
    </section>
  )
}
