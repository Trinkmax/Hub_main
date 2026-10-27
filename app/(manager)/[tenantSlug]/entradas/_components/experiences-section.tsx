'use client'

import { ArrowUpRight, CalendarPlus, Clapperboard, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useOptimistic, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Switch } from '@/components/ui/switch'
import { setExperiencePublished } from '@/lib/ticketing/actions'
import { formatPesos, hasDepositOption } from '@/lib/ticketing/pricing'
import type { AdminExperience } from '@/lib/ticketing/queries'
import { cn } from '@/lib/utils'
import { FunctionsStrip } from './function-chip'
import { NewExperienceButton, type TemplateOption } from './new-experience-dialog'
import { PanelSection } from './panel-section'
import { PosterThumb } from './poster-thumb'

type PublishChange = { id: string; published: boolean }

/**
 * Las películas a la venta: una tarjeta por formato del calendario con su
 * página. Prender y apagar es al toque (optimista): si la base dice que no,
 * vuelve sola a como estaba y avisa.
 */
export function ExperiencesSection({
  tenantSlug,
  experiences,
  availableTemplates,
  defaults,
}: {
  tenantSlug: string
  experiences: AdminExperience[]
  availableTemplates: TemplateOption[]
  defaults: { price: number; deposit: number } | null
}) {
  const [shown, applyChange] = useOptimistic(experiences, (state, change: PublishChange) =>
    state.map((experience) =>
      experience.id === change.id ? { ...experience, published: change.published } : experience,
    ),
  )
  const [, startTransition] = useTransition()

  function togglePublished(experience: AdminExperience, published: boolean) {
    startTransition(async () => {
      applyChange({ id: experience.id, published })
      const result = await setExperiencePublished(tenantSlug, experience.id, published)
      if (result.ok) {
        toast.success(
          result.message ?? (published ? 'Publicada en la cartelera.' : 'Sacada de la cartelera.'),
        )
      } else {
        toast.error(result.message)
      }
    })
  }

  const addButton = (
    <NewExperienceButton
      tenantSlug={tenantSlug}
      templates={availableTemplates}
      defaults={defaults}
    />
  )

  return (
    <PanelSection
      id="peliculas"
      icon={Clapperboard}
      title="Películas"
      description="Cada formato del calendario puede tener su página. Las fechas a la venta son las que tenga en el Calendario."
      actions={shown.length > 0 ? addButton : null}
    >
      {shown.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="Todavía no hay películas a la venta"
          description="Agregá una: elegís el formato del calendario (por ejemplo, Shrek), ponés el precio y la seña por persona, y después completás su página con textos, afiche y menú."
          action={addButton}
          className="py-10"
        />
      ) : (
        <ul className="grid gap-3">
          {shown.map((experience) => (
            <ExperienceRow
              key={experience.id}
              tenantSlug={tenantSlug}
              experience={experience}
              onToggle={(published) => togglePublished(experience, published)}
            />
          ))}
        </ul>
      )}
    </PanelSection>
  )
}

function ExperienceRow({
  tenantSlug,
  experience,
  onToggle,
}: {
  tenantSlug: string
  experience: AdminExperience
  onToggle: (published: boolean) => void
}) {
  const switchId = `publicada-${experience.id}`
  const editHref = `/${tenantSlug}/entradas/${experience.id}`
  const publicHref = `/entradas/${tenantSlug}/${experience.slug}`
  const withDeposit = hasDepositOption(experience.depositCents, experience.priceCents)

  return (
    <li
      className={cn(
        'rounded-xl border bg-background/50 p-3 transition-colors sm:p-4',
        experience.published ? 'border-border/70' : 'border-dashed border-border',
      )}
    >
      <div className="flex gap-3 sm:gap-4">
        <PosterThumb
          url={experience.posterUrl}
          color={experience.templateColor}
          sizes="(min-width: 640px) 80px, 64px"
          className="w-16 sm:w-20"
        />

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <h3 className="font-serif text-lg font-semibold leading-tight tracking-tight">
                <Link href={editHref} className="hover:underline">
                  {experience.title}
                </Link>
              </h3>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: experience.templateColor }}
                />
                <span className="truncate">
                  {experience.templateName}
                  {experience.series ? ` · ${experience.series}` : ''}
                </span>
              </p>
            </div>

            {/* La etiqueta entera es el área de toque: el switch solo mide 32 px. */}
            <label
              htmlFor={switchId}
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors',
                experience.published
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border bg-card text-muted-foreground',
              )}
            >
              <Switch
                id={switchId}
                checked={experience.published}
                onCheckedChange={onToggle}
                aria-label={`Publicar ${experience.title} en la cartelera`}
              />
              <span aria-hidden>{experience.published ? 'Publicada' : 'Apagada'}</span>
            </label>
          </div>

          <p className="text-sm">
            <span className="font-semibold tabular-nums">{formatPesos(experience.priceCents)}</span>{' '}
            <span className="text-muted-foreground">por persona</span>
            {withDeposit ? (
              <>
                <span className="text-muted-foreground"> · seña </span>
                <span className="font-semibold tabular-nums">
                  {formatPesos(experience.depositCents)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground"> · sin seña, solo pago total</span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <FunctionsStrip
          functions={experience.functions}
          color={experience.templateColor}
          limit={6}
          label={`Funciones de ${experience.title}`}
          empty={
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Sin fechas a la venta.
              <Link
                href={`/${tenantSlug}/eventos/programados`}
                className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
              >
                <CalendarPlus className="size-3.5" aria-hidden />
                Programalas en el Calendario
              </Link>
            </p>
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild variant="outline" className="h-11 sm:h-9">
          <Link href={editHref}>
            <Pencil className="size-4" aria-hidden />
            Editar
            <span className="sr-only">{experience.title}</span>
          </Link>
        </Button>
        <Button asChild variant="ghost" className="h-11 sm:h-9">
          <a href={publicHref} target="_blank" rel="noopener noreferrer">
            {experience.published ? 'Ver página' : 'Vista previa'}
            <ArrowUpRight className="size-4" aria-hidden />
            <span className="sr-only">de {experience.title} (se abre en otra pestaña)</span>
          </a>
        </Button>
      </div>
    </li>
  )
}
