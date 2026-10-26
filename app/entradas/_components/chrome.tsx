import { ArrowLeft, MapPin, MessageCircle } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { buildWaMeUrl } from '@/lib/phone'
import { formatPesos } from '@/lib/ticketing/pricing'
import type { GalleryItem, PublicVenue } from '@/lib/ticketing/types'
import { BrandMark } from './brand'
import { Reveal } from './reveal'

/** Partes fijas de las páginas públicas: barra, cinta, polvo, cómo funciona, pie. */

export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

export function TopBar({
  venue,
  back,
}: {
  venue: PublicVenue
  /** En la película: volver a la cartelera. */
  back?: { href: string; label: string }
}) {
  const wa = venue.whatsapp
    ? buildWaMeUrl(
        venue.whatsapp,
        `¡Hola ${venue.tenantName}! Tengo una consulta por las funciones.`,
      )
    : null
  return (
    <div
      className="sticky top-0 z-30 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-6 sm:px-8"
      // Opaca donde está el logo (lo que pasa por debajo no se mezcla con él)
      // y se desvanece recién abajo.
      style={{
        background:
          'linear-gradient(to bottom, rgb(9 13 11 / 0.96) 0%, rgb(9 13 11 / 0.9) 68%, rgb(9 13 11 / 0))',
      }}
    >
      <nav
        aria-label="Navegación"
        className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          {back ? (
            <Link
              href={back.href}
              className="ent-press -ml-2 inline-flex size-11 items-center justify-center rounded-full text-(--ent-cream) hover:bg-white/5"
              aria-label={back.label}
            >
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
          ) : null}
          <BrandMark
            name={venue.tenantName}
            logoUrl={venue.logoUrl}
            href={`/entradas/${venue.tenantSlug}`}
          />
        </div>
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="ent-press inline-flex h-10 items-center gap-2 rounded-full border border-(--ent-line-strong) px-4 text-sm font-medium text-(--ent-cream) hover:bg-white/5"
          >
            <MessageCircle className="size-4" aria-hidden />
            Consultas
          </a>
        ) : null}
      </nav>
    </div>
  )
}

export function Ribbon({ items }: { items: string[] }) {
  // Dos copias seguidas: la animación corre hasta la mitad y vuelve sin salto.
  const loop = [...items, ...items, ...items, ...items]
  return (
    <div className="ent-ribbon" aria-hidden>
      <div className="ent-ribbon-track">
        {loop.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: copias idénticas de una cinta decorativa
          <span key={`${item}-${i}`}>{item}</span>
        ))}
      </div>
    </div>
  )
}

/** Partículas en el haz del proyector (posiciones fijas: nada de random en el server). */
const DUST = [
  { l: 46, t: 12, d: 0 },
  { l: 52, t: 30, d: 1.6 },
  { l: 49, t: 48, d: 3.1 },
  { l: 55, t: 18, d: 4.4 },
  { l: 44, t: 36, d: 5.7 },
  { l: 58, t: 42, d: 2.3 },
  { l: 41, t: 22, d: 6.8 },
  { l: 50, t: 60, d: 7.5 },
]

export function Dust() {
  return (
    <div className="ent-dust" aria-hidden>
      {DUST.map((p) => (
        <span
          key={`${p.l}-${p.t}`}
          style={{ left: `${p.l}%`, top: `${p.t}%`, animationDelay: `${p.d}s` }}
        />
      ))}
    </div>
  )
}

/** «Así se vive»: fotos reales de una función, en dos tiras que corren. */
export function VenueReel({ photos, venueName }: { photos: GalleryItem[]; venueName: string }) {
  if (photos.length < 3) return null
  const half = Math.ceil(photos.length / 2)
  const rows = [photos.slice(0, half), photos.slice(half).concat(photos.slice(0, 1))]
  return (
    <section aria-labelledby="asi-se-vive" className="pt-20 pb-4 sm:pt-28">
      <Reveal className="mx-auto max-w-6xl px-5 sm:px-8">
        <p className="ent-mono text-[0.7rem] text-(--ent-gold)">Así se vive en {venueName}</p>
        <h2 id="asi-se-vive" className="ent-display mt-3 max-w-2xl text-[clamp(2.3rem,7vw,4.2rem)]">
          La pantalla es solo el comienzo.
        </h2>
        <p className="mt-4 max-w-xl text-(--ent-cream-2)">
          La sala a oscuras, las mesas preparadas y cada plato llegando en el momento justo de la
          película.
        </p>
      </Reveal>
      <div className="mt-10 space-y-3 overflow-hidden" aria-hidden>
        {rows.map((row, r) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: dos filas fijas
            key={r}
            className="ent-reel"
            data-direction={r === 1 ? 'reverse' : undefined}
          >
            {[...row, ...row].map((photo, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: la tira repite las mismas fotos
                key={`${photo.url}-${i}`}
                className="relative h-40 w-60 shrink-0 overflow-hidden rounded-xl sm:h-52 sm:w-80"
              >
                <Image src={photo.url} alt="" fill sizes="320px" className="object-cover" />
              </div>
            ))}
          </div>
        ))}
      </div>
      <ul className="sr-only">
        {photos.map((p) => (
          <li key={p.url}>{p.caption ?? `Foto de una función en ${venueName}`}</li>
        ))}
      </ul>
    </section>
  )
}

export function HowItWorks({
  venue,
  minDepositCents,
  minPriceCents,
}: {
  venue: PublicVenue
  minDepositCents: number | null
  minPriceCents: number | null
}) {
  const payCopy = venue.canSell
    ? minDepositCents
      ? `Seña desde ${formatPesos(minDepositCents)} por persona (el resto en efectivo en el bar) o el total${minPriceCents ? ` desde ${formatPesos(minPriceCents)}` : ''}. Con Mercado Pago: tarjeta, débito o dinero en cuenta.`
      : `El total${minPriceCents ? ` desde ${formatPesos(minPriceCents)} por persona` : ''}, con Mercado Pago: tarjeta, débito o dinero en cuenta.`
    : 'Escribinos por WhatsApp con la película, la fecha y cuántos son.'
  const steps = [
    {
      title: 'Elegí película y fecha',
      text: 'Las fechas con «Agotado» ya no tienen lugar. Las que dicen «Últimos» se están por llenar.',
    },
    { title: venue.canSell ? 'Señá o pagá todo' : 'Reservá', text: payCopy },
    {
      title: 'Tu lugar queda reservado',
      text: venue.canSell
        ? `Al instante y a tu nombre. Mientras pagás te guardamos el lugar ${venue.holdMinutes} minutos.`
        : 'Te confirmamos por WhatsApp.',
    },
  ]
  return (
    <section aria-labelledby="como-funciona" className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
      <Reveal>
        <p className="ent-mono text-[0.7rem] text-(--ent-gold)">Cómo funciona</p>
        <h2 id="como-funciona" className="ent-display mt-3 text-[clamp(2.1rem,6vw,3.6rem)]">
          Tres pasos y tenés tu lugar.
        </h2>
      </Reveal>
      <ol className="mt-10 grid gap-4 md:grid-cols-3">
        {steps.map((step, i) => (
          <Reveal
            as="li"
            key={step.title}
            index={i}
            className="ent-paper ent-notched relative overflow-hidden rounded-2xl p-6 [--notch-y:5.25rem]"
          >
            <span className="ent-display ent-num block text-6xl text-(--ent-rust)">{i + 1}</span>
            <hr className="ent-perforation my-5" />
            <h3 className="text-lg font-semibold">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-(--ent-ink-2)">{step.text}</p>
          </Reveal>
        ))}
      </ol>
    </section>
  )
}

export function Footer({ venue }: { venue: PublicVenue }) {
  const wa = venue.whatsapp
    ? buildWaMeUrl(
        venue.whatsapp,
        `¡Hola ${venue.tenantName}! Tengo una consulta por las funciones.`,
      )
    : null
  return (
    <footer className="border-t border-(--ent-line) px-5 pt-12 pb-[max(env(safe-area-inset-bottom),2.5rem)] sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <BrandMark name={venue.tenantName} logoUrl={venue.logoUrl} />
          {venue.address ? (
            <a
              href={mapsUrl(venue.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-(--ent-cream-2) underline-offset-4 hover:underline"
            >
              <MapPin className="size-4" aria-hidden />
              {venue.address}
            </a>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 text-sm text-(--ent-muted) sm:items-end">
          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-(--ent-cream-2) underline-offset-4 hover:underline"
            >
              <MessageCircle className="size-4" aria-hidden />
              ¿Dudas? Escribinos
            </a>
          ) : null}
          {venue.canSell ? <span>Pagos seguros con Mercado Pago.</span> : null}
        </div>
      </div>
    </footer>
  )
}
