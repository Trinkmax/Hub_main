'use client'

import { CalendarCheck, MapPin } from 'lucide-react'
import { formatShortDate } from '@/lib/ticketing/dates'
import { useExperience } from './experience-context'

/** «Mar 01 dic · 21:00»: la noche que ya quedó elegida, al lado del botón (y dónde, si hay varias). */
export function SelectedChip() {
  const { selected, branchLabelOf } = useExperience()
  if (!selected) return null
  const where = branchLabelOf(selected)
  return (
    <span className="inline-flex h-11 items-center gap-2 rounded-full border border-(--ent-line-strong) bg-white/5 px-4 text-sm font-medium text-(--ent-cream)">
      <CalendarCheck className="size-4 text-(--ent-gold)" aria-hidden />
      {formatShortDate(selected.date)} · {selected.time} hs
      {where ? ` · ${where}` : null}
    </span>
  )
}

/**
 * La dirección en los créditos de la portada: la de la sucursal de la función elegida (cambia si
 * se elige una de otra sucursal). Sin función elegida, `fallback`: la de la sucursal de la película
 * si va en una sola, o la del bar.
 */
export function SelectedAddress({ fallback }: { fallback: string | null }) {
  const { selected, addressOf } = useExperience()
  const address = selected ? (addressOf(selected) ?? fallback) : fallback
  if (!address) return null
  return (
    <li className="inline-flex items-center gap-2">
      <MapPin className="size-4 shrink-0 text-(--ent-gold)" aria-hidden />
      {address}
    </li>
  )
}
