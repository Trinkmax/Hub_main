import { ArrowRight, Clock, MessageCircle, UtensilsCrossed } from 'lucide-react'
import Link from 'next/link'
import { buildWaMeUrl } from '@/lib/phone'
import { allSoldOut } from '@/lib/ticketing/availability'
import { stepsSummary } from '@/lib/ticketing/catalog'
import { formatPesos } from '@/lib/ticketing/pricing'
import type { PublicExperience } from '@/lib/ticketing/types'
import { FunctionStub } from '../../_components/function-stub'
import { Poster } from '../../_components/poster'

/**
 * Una película en la cartelera: afiche, de qué se trata y sus fechas como
 * talones. Tocar una fecha lleva a la película con esa fecha ya elegida.
 */
export function FilmCard({
  experience,
  index,
  tenantSlug,
  whatsapp,
  venueName,
  priority = false,
}: {
  experience: PublicExperience
  index: number
  tenantSlug: string
  whatsapp: string | null
  venueName: string
  priority?: boolean
}) {
  const href = `/entradas/${tenantSlug}/${experience.slug}`
  const fromCents = experience.depositCents > 0 ? experience.depositCents : experience.priceCents
  const soldOut = experience.functions.length > 0 && allSoldOut(experience.functions)
  const steps = stepsSummary(experience.steps)
  const firstTime = experience.functions[0]?.time ?? null
  const waitlist =
    soldOut && whatsapp
      ? buildWaMeUrl(
          whatsapp,
          `¡Hola ${venueName}! Quería ir a ${experience.title} pero está todo agotado. ¿Me avisan si se libera un lugar o si suman fechas?`,
        )
      : null

  return (
    <article
      className="ent-film relative"
      style={{ '--accent': experience.accent } as React.CSSProperties}
      aria-labelledby={`film-${experience.id}`}
    >
      <div className="flex gap-4 sm:gap-6">
        <Link
          href={href}
          className="ent-press relative w-[38%] max-w-[12.5rem] shrink-0 self-start"
          tabIndex={-1}
          aria-hidden
        >
          <div className="ent-poster-glow" />
          <Poster
            title={experience.title}
            series={experience.series}
            url={experience.posterUrl}
            sizes="(min-width: 1024px) 200px, 38vw"
            priority={priority}
          >
            <span className="ent-sweep" />
          </Poster>
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="ent-mono pt-1 text-[0.62rem] text-(--ent-gold)">
              {experience.series ?? 'Experiencia'}
              {experience.draft ? (
                <span className="ml-2 rounded border border-(--ent-gold)/50 px-1.5 py-0.5 text-[0.55rem] text-(--ent-cream)">
                  Sin publicar
                </span>
              ) : null}
            </p>
            <span aria-hidden className="ent-outline-num ent-num -mt-1 text-5xl sm:text-6xl">
              {String(index + 1).padStart(2, '0')}
            </span>
          </div>
          <h3
            id={`film-${experience.id}`}
            className="ent-display mt-1 text-[clamp(1.85rem,7.5vw,2.75rem)] text-balance"
          >
            <Link href={href} className="underline-offset-[6px] hover:underline">
              {experience.title}
            </Link>
          </h3>
          {experience.tagline ? (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-(--ent-cream-2)">
              {experience.tagline}
            </p>
          ) : null}
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-(--ent-muted)">
            {firstTime ? (
              <li className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" aria-hidden />
                {firstTime} hs
              </li>
            ) : null}
            {steps ? (
              <li className="inline-flex items-center gap-1.5">
                <UtensilsCrossed className="size-3.5" aria-hidden />
                {steps}
              </li>
            ) : null}
          </ul>
          <p className="mt-3 text-sm">
            <span className="text-(--ent-muted)">
              {experience.depositCents > 0 ? 'Reservás con ' : 'Entrada '}
            </span>
            <strong className="ent-num font-semibold text-(--ent-cream)">
              {formatPesos(fromCents)}
            </strong>
            <span className="text-(--ent-muted)"> por persona</span>
          </p>
        </div>
      </div>

      {experience.functions.length > 0 ? (
        <div className="mt-5">
          <p className="sr-only">Fechas de {experience.title}</p>
          <ul className="-mx-5 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-5 pt-1 pb-3 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            {experience.functions.map((fn) => (
              <li key={fn.eventId} className="snap-start">
                <FunctionStub fn={fn} href={`${href}?fecha=${fn.date}`} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-(--ent-line-strong) px-4 py-3 text-sm text-(--ent-cream-2)">
          Muy pronto, nuevas fechas.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {soldOut ? (
          <p className="text-sm text-(--ent-cream-2)">
            Se agotaron todas las fechas.
            {waitlist ? (
              <>
                {' '}
                <a
                  href={waitlist}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-(--ent-gold) underline-offset-4 hover:underline"
                >
                  <MessageCircle className="size-3.5" aria-hidden />
                  Avisame si se libera un lugar
                </a>
              </>
            ) : null}
          </p>
        ) : (
          <span />
        )}
        <Link
          href={href}
          className="ent-press group inline-flex h-11 items-center gap-2 text-sm font-semibold text-(--ent-cream)"
        >
          Ver la película y el menú
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </div>
    </article>
  )
}
