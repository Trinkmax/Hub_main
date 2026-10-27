import { allSoldOut } from '@/lib/ticketing/availability'
import type { PublicExperiencePage } from '@/lib/ticketing/queries'
import { Footer, TopBar } from '../../../_components/chrome'
import { Reveal } from '../../../_components/reveal'
import { ExperienceProvider } from './experience-context'
import { ExperienceHero } from './experience-hero'
import { FunctionPicker } from './function-picker'
import { MenuReel } from './menu-reel'
import { SceneGallery } from './scene-gallery'
import { StickyCta } from './sticky-cta'
import { ActHeading, OtherFilms, VenuePolaroids } from './story-sections'
import { TicketCheckout } from './ticket-checkout'

/** La película ya con sus datos (la página solo los busca y valida ?fecha). */
export function ExperienceView({
  page,
  fecha,
}: {
  page: PublicExperiencePage
  fecha: string | null
}) {
  const { experience, venue, others, preview } = page
  const scenes = experience.gallery.filter((g) => g.kind === 'scene')
  const venuePhotos = experience.gallery.filter((g) => g.kind === 'venue')
  const soldOut = experience.functions.length > 0 && allSoldOut(experience.functions)
  const fromCents = experience.depositCents > 0 ? experience.depositCents : experience.priceCents

  let act = 0
  const nextAct = () => ['I', 'II', 'III', 'IV', 'V'][act++] ?? String(act)

  return (
    <ExperienceProvider functions={experience.functions} initialDate={fecha}>
      <div style={{ '--accent': experience.accent } as React.CSSProperties}>
        <TopBar
          venue={venue}
          back={{ href: `/entradas/${venue.tenantSlug}`, label: 'Volver a la cartelera' }}
        />

        {preview ? (
          <div className="relative z-30 mx-auto -mt-2 mb-2 max-w-6xl px-5 sm:px-8">
            <p className="rounded-xl border border-(--ent-gold)/40 bg-(--ent-gold)/10 px-4 py-2.5 text-sm text-(--ent-gold)">
              Vista previa: esta película no está publicada. Solo la ven los dueños del bar.
            </p>
          </div>
        ) : null}

        <main>
          <ExperienceHero
            experience={experience}
            venueName={venue.tenantName}
            address={venue.address}
          />

          <div className="mx-auto max-w-6xl px-5 sm:px-8 lg:grid lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-14">
            <div className="min-w-0">
              {experience.functions.length > 0 ? (
                <section aria-labelledby="funciones" className="pt-10 pb-16">
                  <ActHeading
                    id="funciones"
                    act={nextAct()}
                    kicker="La función"
                    title="Elegí tu noche."
                  />
                  <Reveal>
                    <FunctionPicker />
                  </Reveal>
                </section>
              ) : null}

              <section aria-labelledby="menu-titulo" className="scroll-mt-24 pb-16" id="menu">
                <ActHeading
                  id="menu-titulo"
                  act={nextAct()}
                  kicker="El menú"
                  title="Una película que también se come."
                />
                {experience.synopsis ? (
                  <Reveal>
                    <p className="ent-display mb-10 max-w-2xl text-[clamp(1.35rem,4.6vw,1.9rem)] leading-[1.25] font-normal tracking-[-0.015em] text-(--ent-cream-2)">
                      {experience.synopsis}
                    </p>
                  </Reveal>
                ) : null}
                {experience.steps.length > 0 ? (
                  <MenuReel steps={experience.steps} />
                ) : (
                  <Reveal className="rounded-2xl border border-dashed border-(--ent-line-strong) p-6">
                    <p className="ent-display text-2xl">El menú se está cocinando.</p>
                    <p className="mt-2 max-w-lg text-sm text-(--ent-cream-2)">
                      {experience.stepsNote ??
                        'Estamos terminando los pasos y bocados inspirados en la historia. Podés reservar desde ahora: el menú lo contamos muy pronto.'}
                    </p>
                  </Reveal>
                )}
              </section>

              {scenes.length > 0 ? (
                <section aria-labelledby="escenas" className="pb-16">
                  <ActHeading
                    id="escenas"
                    act={nextAct()}
                    kicker="La película"
                    title={`Escenas de ${experience.title}.`}
                  />
                  <SceneGallery items={scenes} title={experience.title} />
                </section>
              ) : null}

              {venuePhotos.length > 0 ? (
                <section aria-labelledby="asi-se-vive" className="pb-16">
                  <ActHeading
                    id="asi-se-vive"
                    act={nextAct()}
                    kicker={`Así se vive en ${venue.tenantName}`}
                    title="La pantalla es solo el comienzo."
                  />
                  <VenuePolaroids photos={venuePhotos} venueName={venue.tenantName} />
                </section>
              ) : null}
            </div>

            <aside
              id="entrada"
              aria-label="Tu entrada"
              // Fija al costado solo si la pantalla da: ver .ent-ticket-col.
              className="ent-ticket-col scroll-mt-24 pb-16 lg:self-start lg:pt-10"
            >
              <TicketCheckout
                preview={preview}
                experience={{
                  slug: experience.slug,
                  title: experience.title,
                  priceCents: experience.priceCents,
                  depositCents: experience.depositCents,
                  maxPartySize: experience.maxPartySize,
                  terms: experience.terms,
                }}
                venue={{
                  tenantSlug: venue.tenantSlug,
                  tenantName: venue.tenantName,
                  canSell: venue.canSell,
                  holdMinutes: venue.holdMinutes,
                  whatsapp: venue.whatsapp,
                }}
              />
            </aside>
          </div>

          <OtherFilms others={others} tenantSlug={venue.tenantSlug} />
        </main>
        <Footer venue={venue} />
        <StickyCta fromCents={fromCents} soldOut={soldOut} />
      </div>
    </ExperienceProvider>
  )
}
