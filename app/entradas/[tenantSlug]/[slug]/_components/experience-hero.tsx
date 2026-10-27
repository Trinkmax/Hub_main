import { Clock, MapPin, Ticket, UtensilsCrossed } from 'lucide-react'
import Image from 'next/image'
import { stepsSummary } from '@/lib/ticketing/catalog'
import { formatPesos } from '@/lib/ticketing/pricing'
import type { PublicExperience } from '@/lib/ticketing/types'
import { Dust } from '../../../_components/chrome'
import { Poster } from '../../../_components/poster'
import { SelectedChip } from './selected-chip'
import { TiltPoster } from './tilt-poster'

/**
 * Los créditos de apertura: la escena de la película de fondo (a oscuras,
 * con el color de la película), «HUB presenta», el título enorme y el afiche
 * flotando. El botón baja a la entrada; la fecha elegida queda al lado.
 */
export function ExperienceHero({
  experience,
  venueName,
  address,
}: {
  experience: PublicExperience
  venueName: string
  address: string | null
}) {
  const backdrop =
    experience.heroUrl ??
    experience.gallery.find((g) => g.kind === 'scene')?.url ??
    experience.posterUrl
  const steps = stepsSummary(experience.steps)
  const fromCents = experience.depositCents > 0 ? experience.depositCents : experience.priceCents

  const credits: Array<{ icon: typeof Clock; text: string }> = []
  if (experience.scheduleNote) credits.push({ icon: Clock, text: experience.scheduleNote })
  else if (experience.functions[0]) {
    credits.push({ icon: Clock, text: `${experience.functions[0].time} hs` })
  }
  if (steps) credits.push({ icon: UtensilsCrossed, text: steps })
  if (address) credits.push({ icon: MapPin, text: address })

  return (
    <header className="ent-hero -mt-[4.5rem] pt-24 pb-14 sm:pt-32 sm:pb-20">
      {backdrop ? (
        <div className="absolute inset-0 -z-10" aria-hidden>
          <Image
            src={backdrop}
            alt=""
            fill
            priority
            sizes="100vw"
            className="scale-110 object-cover opacity-45 blur-[3px] saturate-[1.15]"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to bottom, rgb(9 13 11 / 0.55), rgb(9 13 11 / 0.82) 55%, var(--ent-bg)), radial-gradient(80% 60% at 70% 40%, color-mix(in oklab, var(--accent) 35%, transparent), transparent 70%)',
            }}
          />
        </div>
      ) : null}
      <div className="ent-beam" aria-hidden />
      <Dust />

      <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div className="order-last lg:order-first">
          <p
            className="ent-mono ent-rise text-[0.66rem] text-(--ent-gold)"
            style={{ '--d': 0 } as React.CSSProperties}
          >
            {venueName} presenta
            {experience.series ? (
              <span className="text-(--ent-muted)"> · {experience.series}</span>
            ) : null}
          </p>
          <h1
            className="ent-display ent-rise mt-4 text-[clamp(3.6rem,16vw,8.5rem)] text-balance"
            style={{ '--d': 140 } as React.CSSProperties}
          >
            {experience.title}
            <span className="text-(--accent)">.</span>
          </h1>
          {experience.tagline ? (
            <p
              className="ent-rise mt-5 max-w-xl text-xl leading-snug text-(--ent-cream-2) sm:text-2xl"
              style={{ '--d': 280 } as React.CSSProperties}
            >
              {experience.tagline}
            </p>
          ) : null}

          {credits.length > 0 ? (
            <ul
              className="ent-rise mt-7 flex flex-col gap-2.5 text-sm text-(--ent-cream-2) sm:flex-row sm:flex-wrap sm:gap-x-6"
              style={{ '--d': 400 } as React.CSSProperties}
            >
              {credits.map(({ icon: Icon, text }) => (
                <li key={text} className="inline-flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-(--ent-gold)" aria-hidden />
                  {text}
                </li>
              ))}
            </ul>
          ) : null}

          <div
            className="ent-rise mt-9 flex flex-wrap items-center gap-3"
            style={{ '--d': 520 } as React.CSSProperties}
          >
            <a
              id="hero-cta"
              href="#entrada"
              className="ent-press inline-flex h-14 items-center gap-2.5 rounded-full bg-(--ent-cream) px-7 text-base font-semibold text-(--ent-ink) shadow-[0_18px_40px_-14px_rgb(243_236_218/0.5)]"
            >
              <Ticket className="size-4" aria-hidden />
              Reservá desde {formatPesos(fromCents)}
            </a>
            <SelectedChip />
          </div>
        </div>

        <TiltPoster className="ent-rise relative mx-auto w-[62%] max-w-[17rem] lg:w-full lg:max-w-[22rem]">
          <div className="ent-poster-glow" />
          <Poster
            title={experience.title}
            series={experience.series}
            url={experience.posterUrl}
            sizes="(min-width: 1024px) 352px, 62vw"
            priority
          />
        </TiltPoster>
      </div>
    </header>
  )
}
