import { ArrowDown } from 'lucide-react'
import Image from 'next/image'
import { type CatalogSummary, splitHeadline } from '@/lib/ticketing/catalog'
import { formatPesos } from '@/lib/ticketing/pricing'
import type { PublicExperience } from '@/lib/ticketing/types'
import { Dust } from '../../_components/chrome'

/**
 * La apertura: el bar «presenta», el haz del proyector baja sobre el título y
 * las luces de la sala se apagan. Detrás, los afiches abiertos en abanico.
 * Todo con CSS (entra antes de hidratar y no cuesta JS).
 */
export function CarteleraHero({
  venueName,
  headline,
  intro,
  summary,
  experiences,
}: {
  venueName: string
  headline: string
  intro: string
  summary: CatalogSummary
  experiences: PublicExperience[]
}) {
  const [line1, line2] = splitHeadline(headline)
  const fan = experiences.filter((e) => e.posterUrl).slice(0, 3)
  const accent = experiences[0]?.accent

  const stats: Array<{ value: string; label: string }> = []
  if (summary.films > 0) {
    stats.push({
      value: String(summary.films),
      label: summary.films === 1 ? 'película' : 'películas',
    })
  }
  if (summary.functions > 0) {
    stats.push({
      value: String(summary.functions),
      label: summary.functions === 1 ? 'función' : 'funciones',
    })
  }
  const from = summary.minDepositCents ?? summary.minPriceCents
  if (from) stats.push({ value: formatPesos(from), label: 'para reservar' })

  return (
    <header
      className="ent-hero -mt-[4.5rem] px-5 pt-28 pb-16 sm:px-8 sm:pt-36 sm:pb-24"
      style={accent ? ({ '--accent': accent } as React.CSSProperties) : undefined}
    >
      <div className="ent-beam" aria-hidden />
      <div className="ent-screen-glow" aria-hidden />
      <div className="ent-houselights" aria-hidden />
      <Dust />

      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        {fan.length > 0 ? (
          <div
            aria-hidden
            className="relative order-first mx-auto h-[15.5rem] w-full max-w-[22rem] sm:h-[19rem] lg:order-last lg:h-[34rem] lg:max-w-none"
          >
            {fan.map((e, i) => {
              const spread = fan.length === 1 ? [0] : fan.length === 2 ? [-1, 1] : [-1, 0, 1]
              const pos = spread[i] ?? 0
              // El abanico va en el contenedor y la entrada en el hijo: una
              // animación CSS pisa el transform inline del mismo elemento.
              return (
                <div
                  key={e.id}
                  className="absolute top-1/2 left-1/2 w-[38%] lg:w-[50%]"
                  style={
                    {
                      '--accent': e.accent,
                      zIndex: pos === 0 ? 3 : 2 - i,
                      transform: `translate(calc(-50% + ${pos * 62}%), -50%) rotate(${pos * 9}deg) translateY(${Math.abs(pos) * 6}%)`,
                    } as React.CSSProperties
                  }
                >
                  <div className="ent-rise" style={{ '--d': 350 + i * 120 } as React.CSSProperties}>
                    <div className="ent-poster-glow" />
                    <div className="ent-poster aspect-[2/3]">
                      <Image
                        src={e.posterUrl as string}
                        alt=""
                        fill
                        priority={i === 0}
                        sizes="(min-width: 1024px) 240px, 40vw"
                        className="object-cover"
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        <div>
          <p
            className="ent-mono ent-rise text-[0.68rem] text-(--ent-gold)"
            style={{ '--d': 0 } as React.CSSProperties}
          >
            {venueName} presenta
            {summary.monthsLabel ? (
              <span className="text-(--ent-muted)"> · Edición {summary.monthsLabel}</span>
            ) : null}
          </p>
          <h1 className="ent-display mt-5 text-[clamp(3.4rem,15vw,8.75rem)] text-balance">
            {line1 ? (
              <span className="ent-rise block" style={{ '--d': 120 } as React.CSSProperties}>
                {line1}
              </span>
            ) : null}
            <span
              className="ent-rise block text-(--ent-rust)"
              style={{ '--d': 260 } as React.CSSProperties}
            >
              {line2}
              <span className="text-(--ent-gold)">.</span>
            </span>
          </h1>
          <p
            className="ent-rise mt-6 max-w-xl text-lg leading-relaxed text-(--ent-cream-2) sm:text-xl"
            style={{ '--d': 420 } as React.CSSProperties}
          >
            {intro}
          </p>

          {stats.length > 0 ? (
            <dl
              className="ent-rise mt-8 flex flex-wrap gap-x-8 gap-y-4"
              style={{ '--d': 540 } as React.CSSProperties}
            >
              {stats.map((s) => (
                <div key={s.label} className="flex flex-col">
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="ent-display ent-num text-4xl text-(--ent-cream)">{s.value}</dd>
                  <dd className="ent-mono mt-1 text-[0.6rem] text-(--ent-muted)">{s.label}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {summary.films > 0 ? (
            <a
              href="#cartelera"
              className="ent-press ent-rise mt-10 inline-flex h-14 items-center gap-3 rounded-full bg-(--ent-cream) px-7 text-base font-semibold text-(--ent-ink) shadow-[0_18px_40px_-14px_rgb(243_236_218/0.5)]"
              style={{ '--d': 660 } as React.CSSProperties}
            >
              Elegí tu función
              <ArrowDown className="size-4" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </header>
  )
}
