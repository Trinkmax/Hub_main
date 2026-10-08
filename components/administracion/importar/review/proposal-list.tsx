'use client'

import { ProposalRow } from './proposal-row'
import type { ProposalView } from './types'

/** La lista de propuestas de la página (tarjetas en todos los anchos: cada una tiene sus arreglos). */
export function ProposalList({ rows, label }: { rows: ProposalView[]; label: string }) {
  return (
    <ul
      aria-label={label}
      className="card-hairline divide-y divide-border/60 rounded-xl border bg-card"
    >
      {rows.map((p) => (
        <ProposalRow key={p.key} p={p} />
      ))}
    </ul>
  )
}
