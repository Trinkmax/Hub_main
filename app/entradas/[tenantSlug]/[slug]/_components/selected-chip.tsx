'use client'

import { CalendarCheck } from 'lucide-react'
import { formatShortDate } from '@/lib/ticketing/dates'
import { useExperience } from './experience-context'

/** «Mar 01 dic · 21:00»: la noche que ya quedó elegida, al lado del botón. */
export function SelectedChip() {
  const { selected } = useExperience()
  if (!selected) return null
  return (
    <span className="inline-flex h-11 items-center gap-2 rounded-full border border-(--ent-line-strong) bg-white/5 px-4 text-sm font-medium text-(--ent-cream)">
      <CalendarCheck className="size-4 text-(--ent-gold)" aria-hidden />
      {formatShortDate(selected.date)} · {selected.time} hs
    </span>
  )
}
