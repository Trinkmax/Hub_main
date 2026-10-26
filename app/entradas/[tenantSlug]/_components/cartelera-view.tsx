import { buildAgenda, summarizeCatalog } from '@/lib/ticketing/catalog'
import type { PublicCatalog } from '@/lib/ticketing/queries'
import { Footer, HowItWorks, Ribbon, TopBar, VenueReel } from '../../_components/chrome'
import { Reveal } from '../../_components/reveal'
import { CarteleraBoard } from './cartelera-board'
import { CarteleraHero } from './cartelera-hero'

export const DEFAULT_INTRO =
  'Una película icónica en pantalla grande y, en cada escena clave, un plato inspirado en la historia que llega a tu mesa.'

/** La cartelera ya con sus datos (la página solo los busca). */
export function CarteleraView({ catalog }: { catalog: PublicCatalog }) {
  const { venue, experiences, today } = catalog
  const summary = summarizeCatalog(experiences)
  const headline = venue.headline ?? summary.series ?? 'Cartelera'
  const agenda = buildAgenda(experiences)

  const ribbon = [
    ...experiences.map((e) => e.title),
    'Pantalla grande',
    'Un plato en cada escena',
    'Elegí tu fecha',
  ]

  return (
    <>
      <TopBar venue={venue} />
      {catalog.preview ? (
        <div className="relative z-30 mx-auto -mt-2 mb-2 max-w-6xl px-5 sm:px-8">
          <p className="rounded-xl border border-(--ent-gold)/40 bg-(--ent-gold)/10 px-4 py-2.5 text-sm text-(--ent-gold)">
            Vista previa del dueño: ves también las películas sin publicar (marcadas). La gente ve
            solo las publicadas.
          </p>
        </div>
      ) : null}
      <main>
        <CarteleraHero
          venueName={venue.tenantName}
          headline={headline}
          intro={venue.intro ?? DEFAULT_INTRO}
          summary={summary}
          experiences={experiences}
        />

        {experiences.length > 0 ? <Ribbon items={ribbon} /> : null}

        <section
          id="cartelera"
          aria-labelledby="cartelera-titulo"
          className="mx-auto max-w-6xl scroll-mt-20 px-5 pt-20 pb-10 sm:px-8 sm:pt-28"
        >
          <Reveal className="mb-8 flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="ent-mono text-[0.7rem] text-(--ent-gold)">En cartelera</p>
              <h2
                id="cartelera-titulo"
                className="ent-display mt-3 text-[clamp(2.4rem,8vw,4.5rem)] text-balance"
              >
                {experiences.length > 0 ? 'Elegí tu película.' : 'Muy pronto, nueva cartelera.'}
              </h2>
            </div>
            {experiences.length > 0 ? (
              <p className="max-w-xs text-sm text-(--ent-cream-2)">
                Tocá una fecha para ver la película, el menú y reservar. Las que dicen «Agotado» ya
                no tienen lugar.
              </p>
            ) : null}
          </Reveal>

          {experiences.length > 0 ? (
            <CarteleraBoard
              experiences={experiences}
              agenda={agenda}
              tenantSlug={venue.tenantSlug}
              today={today}
              whatsapp={venue.whatsapp}
              venueName={venue.tenantName}
            />
          ) : (
            <p className="max-w-lg text-(--ent-cream-2)">
              Estamos armando las próximas funciones. Volvé en unos días o escribinos para enterarte
              primero.
            </p>
          )}
        </section>

        <VenueReel photos={summary.venuePhotos} venueName={venue.tenantName} />

        {experiences.length > 0 ? (
          <HowItWorks
            venue={venue}
            minDepositCents={summary.minDepositCents}
            minPriceCents={summary.minPriceCents}
          />
        ) : null}
      </main>
      <Footer venue={venue} />
    </>
  )
}
