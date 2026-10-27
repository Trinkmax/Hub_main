'use client'

import { useId, useState } from 'react'
import type { AgendaMonth } from '@/lib/ticketing/catalog'
import type { PublicExperience } from '@/lib/ticketing/types'
import { cn } from '@/lib/utils'
import { Reveal } from '../../_components/reveal'
import { AgendaList } from './agenda-list'
import { FilmCard } from './film-card'

type View = 'films' | 'dates'

const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'films', label: 'Películas' },
  { value: 'dates', label: 'Por fecha' },
]

/**
 * La cartelera con dos lentes: por película (el afiche manda) o por fecha
 * (para el que ya sabe qué día puede). La elegida va rellena.
 */
export function CarteleraBoard({
  experiences,
  agenda,
  tenantSlug,
  today,
  whatsapp,
  venueName,
}: {
  experiences: PublicExperience[]
  agenda: AgendaMonth[]
  tenantSlug: string
  today: string
  whatsapp: string | null
  venueName: string
}) {
  const [view, setView] = useState<View>('films')
  const baseId = useId()

  return (
    <div>
      <div
        role="tablist"
        aria-label="Cómo ver la cartelera"
        className="inline-flex rounded-full border border-(--ent-line-strong) bg-(--ent-bg-2) p-1"
      >
        {VIEWS.map((v) => {
          const active = view === v.value
          return (
            <button
              key={v.value}
              type="button"
              role="tab"
              id={`${baseId}-tab-${v.value}`}
              aria-selected={active}
              aria-controls={`${baseId}-panel-${v.value}`}
              onClick={() => setView(v.value)}
              className={cn(
                'ent-press h-10 rounded-full px-5 text-sm font-semibold transition-colors duration-200',
                active
                  ? 'bg-(--ent-cream) text-(--ent-ink)'
                  : 'text-(--ent-cream-2) hover:text-(--ent-cream)',
              )}
            >
              {v.label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-films`}
        aria-labelledby={`${baseId}-tab-films`}
        hidden={view !== 'films'}
        className="mt-10"
      >
        <div className="grid gap-x-12 gap-y-14 lg:grid-cols-2">
          {experiences.map((experience, i) => (
            // min-w-0: sin esto, la película con más fechas (la fila de talones
            // no se parte en el celular) ensanchaba la columna y todo se salía.
            <Reveal key={experience.id} index={i % 2} className="min-w-0">
              <FilmCard
                experience={experience}
                index={i}
                tenantSlug={tenantSlug}
                whatsapp={whatsapp}
                venueName={venueName}
                priority={i < 2}
              />
            </Reveal>
          ))}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-dates`}
        aria-labelledby={`${baseId}-tab-dates`}
        hidden={view !== 'dates'}
        className="mt-10 max-w-3xl"
      >
        <AgendaList months={agenda} tenantSlug={tenantSlug} today={today} />
      </div>
    </div>
  )
}
