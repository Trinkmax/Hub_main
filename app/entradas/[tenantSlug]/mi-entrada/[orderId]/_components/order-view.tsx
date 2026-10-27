'use client'

import { ArrowRight, CalendarPlus, MapPin, RotateCcw, Share2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { buildWaMeUrl } from '@/lib/phone'
import { refreshOrder } from '@/lib/ticketing/checkout-actions'
import { peopleLabel, rejectionReason } from '@/lib/ticketing/copy'
import { buildIcs, formatLongDate } from '@/lib/ticketing/dates'
import { formatPesos } from '@/lib/ticketing/pricing'
import type { OrderStatus, PublicOrder } from '@/lib/ticketing/types'
import { mapsUrl } from '../../../../_components/chrome'

/**
 * La entrada del cliente. Llega acá desde Mercado Pago (con ?payment_id=) o
 * desde el link guardado. Si el pago todavía no figura, la página pregunta
 * sola: primero con el pago que trajo la URL (camino rápido, no espera al
 * webhook) y después cada pocos segundos.
 */

type Live = {
  status: OrderStatus
  expired: boolean
  paidCents: number | null
  statusDetail: string | null
}

// Destellos ✦ del festejo: vectores fijos (nada de random en el render).
const BURST = [
  { x: -120, y: -90, r: 120, s: 16 },
  { x: -70, y: -140, r: -80, s: 12 },
  { x: 0, y: -160, r: 200, s: 18 },
  { x: 75, y: -135, r: -140, s: 13 },
  { x: 125, y: -85, r: 90, s: 15 },
  { x: 150, y: -10, r: -60, s: 11 },
  { x: -150, y: -5, r: 160, s: 12 },
  { x: -105, y: 60, r: -110, s: 10 },
  { x: 110, y: 55, r: 130, s: 10 },
  { x: -40, y: -110, r: 60, s: 9 },
  { x: 45, y: -105, r: -30, s: 9 },
  { x: 0, y: 80, r: 170, s: 8 },
]

const POLL_FAST_MS = 2500
const POLL_SLOW_MS = 10_000
const FAST_WINDOW_MS = 120_000
const GIVE_UP_MS = 15 * 60_000
// Un pago que empezó antes del vencimiento puede aprobarse después (3DS lento,
// la app de Mercado Pago): durante estos minutos se sigue preguntando.
const EXPIRED_GRACE_MS = 5 * 60_000

export function OrderView({
  order,
  tenantSlug,
  tenantName,
  address,
  whatsapp,
  paymentId,
}: {
  order: PublicOrder
  tenantSlug: string
  tenantName: string
  address: string | null
  whatsapp: string | null
  paymentId: string | null
}) {
  const [live, setLive] = useState<Live>({
    status: order.status,
    expired: order.expired,
    paidCents: order.paidCents,
    statusDetail: order.mpStatusDetail,
  })
  const [celebrate, setCelebrate] = useState(false)
  // Volvió de Mercado Pago con el número de pago: hasta confirmarlo se muestra
  // «confirmando», aunque el lugar ya figure vencido (pudo pagar al límite).
  const [confirming, setConfirming] = useState(
    Boolean(paymentId) && order.status !== 'approved' && order.status !== 'refunded',
  )
  const started = useRef(Date.now())
  const firstStatus = useRef(order.status)

  // Preguntar por el pago mientras no esté resuelto. Arranca una sola vez al
  // montar: el polling se reprograma solo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: arranca una vez; el estado inicial alcanza
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let usePaymentId = paymentId

    const holdEnds = new Date(order.holdExpiresAt).getTime()
    const settled = (s: Live) =>
      s.status === 'approved' ||
      s.status === 'refunded' ||
      (s.expired && Date.now() > holdEnds + EXPIRED_GRACE_MS)

    const tick = async () => {
      const result = await refreshOrder({ tenantSlug, orderId: order.id, paymentId: usePaymentId })
      usePaymentId = null
      if (cancelled) return
      setConfirming(false)
      if (result.ok) {
        const next: Live = {
          status: result.status,
          expired: result.expired,
          paidCents: result.paidCents,
          statusDetail: result.statusDetail,
        }
        setLive(next)
        if (next.status === 'approved' && firstStatus.current !== 'approved') setCelebrate(true)
        if (settled(next)) return
      }
      const elapsed = Date.now() - started.current
      if (elapsed > GIVE_UP_MS) return
      timer = setTimeout(tick, elapsed < FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS)
    }

    if (!settled({ ...live })) void tick()
    else setConfirming(false)

    // La URL de Mercado Pago trae varios parámetros: se limpia para que el
    // link que se guarde o comparta sea el de la entrada, nada más.
    const url = new URL(window.location.href)
    if (url.search) {
      url.search = ''
      window.history.replaceState(window.history.state, '', url)
    }

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  const filmUrl = order.experienceSlug
    ? `/entradas/${tenantSlug}/${order.experienceSlug}`
    : `/entradas/${tenantSlug}`
  const retryFilmUrl = order.experienceSlug ? `${filmUrl}?fecha=${order.date}` : filmUrl
  const balanceCents =
    order.option === 'deposit' ? (order.fullPriceCents - order.unitPriceCents) * order.partySize : 0

  const download = () => {
    const ics = buildIcs({
      uid: `${order.id}@entradas`,
      title: `${order.title} · ${tenantName}`,
      date: order.date,
      time: order.time,
      location: address,
      description: `Reserva a nombre de ${order.guestFirstName} · ${peopleLabel(order.partySize)} · Pedido #${order.shortCode}`,
      url: typeof window !== 'undefined' ? window.location.href : null,
    })
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${order.title.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.ics`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  const share = async () => {
    const url = `${window.location.origin}${filmUrl}`
    const text = `Voy a ${order.title} en ${tenantName} el ${formatLongDate(order.date)} 🎬`
    if (navigator.share) {
      try {
        await navigator.share({ title: order.title, text, url })
        return
      } catch {
        // Canceló el menú de compartir: no hace falta nada.
        return
      }
    }
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  const approved = live.status === 'approved'
  const refunded = live.status === 'refunded'
  const expired = live.expired && !confirming && !approved
  const rejected = live.status === 'rejected' && !live.expired && !confirming
  const waiting =
    !approved && !refunded && (confirming || (live.status === 'pending' && !live.expired))
  const retryUrl = order.retryUrl

  return (
    <div
      className="relative mx-auto w-full max-w-md"
      style={{ '--accent': order.accent } as React.CSSProperties}
    >
      {celebrate ? (
        <div className="ent-confetti" aria-hidden>
          {BURST.map((b, k) => (
            <span
              key={`${b.x}-${b.y}`}
              style={
                {
                  '--x': `${b.x}px`,
                  '--y': `${b.y}px`,
                  '--r': `${b.r}deg`,
                  '--s': `${b.s}px`,
                  '--k': k,
                } as React.CSSProperties
              }
            >
              ✦
            </span>
          ))}
        </div>
      ) : null}

      <article className="ent-paper overflow-hidden rounded-[26px] shadow-[0_50px_100px_-40px_rgb(0_0_0/0.9)] [--ent-hole:#090d0b]">
        {/* La cabecera: el afiche de la película, como el arte de la entrada. */}
        <div className="relative h-40 overflow-hidden bg-(--ent-ink)">
          {order.posterUrl ? (
            <Image
              src={order.posterUrl}
              alt=""
              fill
              sizes="448px"
              className="object-cover object-[50%_20%]"
            />
          ) : null}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to top, color-mix(in oklab, var(--accent) 75%, black) 5%, rgb(0 0 0 / 0.2) 70%)',
            }}
          />
          <div className="absolute right-5 bottom-4 left-5 flex items-end justify-between gap-3 text-(--ent-paper)">
            <div className="min-w-0">
              <p className="ent-mono text-[0.58rem] opacity-80">Tu entrada · #{order.shortCode}</p>
              <p className="ent-display mt-1 truncate text-3xl">{order.title}</p>
            </div>
            <span className="ent-mono shrink-0 rounded-md border border-current/40 px-2 py-1 text-[0.58rem]">
              Admite {order.partySize}
            </span>
          </div>
        </div>

        <div className="px-6 pt-6 pb-5">
          <StatusBlock
            approved={approved}
            waiting={waiting}
            rejected={rejected}
            expired={expired}
            refunded={refunded}
            firstName={order.guestFirstName}
            reason={rejectionReason(live.statusDetail)}
            holdUntil={order.holdExpiresAt}
          />

          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
            <Row label="Fecha" value={capitalizeFirst(formatLongDate(order.date))} />
            <Row label="Hora" value={`${order.time} hs`} />
            <Row label="Admite" value={peopleLabel(order.partySize)} />
            {approved ? (
              <>
                <Row
                  label="Pagaste"
                  value={`${formatPesos(live.paidCents ?? order.totalCents)} ${order.option === 'deposit' ? '(seña)' : '(total)'}`}
                />
                <Row
                  label="En el bar"
                  value={
                    balanceCents > 0
                      ? `${formatPesos(balanceCents)} en efectivo`
                      : 'Nada más: ya está pago'
                  }
                  strong={balanceCents > 0}
                />
              </>
            ) : (
              <Row
                label={order.option === 'deposit' ? 'Seña' : 'Total'}
                value={formatPesos(order.totalCents)}
              />
            )}
          </dl>
        </div>

        <div className="ent-ticket-cut px-6" aria-hidden>
          <hr className="ent-perforation" />
        </div>

        <div className="px-6 pt-5 pb-6">
          {approved ? (
            <>
              <p className="text-sm text-(--ent-ink-2)">
                Al llegar, decí que reservaste a nombre de{' '}
                <strong className="text-(--ent-ink)">{order.guestFirstName}</strong>. Guardá esta
                página: es tu entrada.
              </p>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <ActionButton onClick={download} icon={CalendarPlus} label="Agendar" />
                <ActionButton onClick={share} icon={Share2} label="Compartir" />
                {address ? (
                  <a
                    href={mapsUrl(address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ent-press flex h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-(--ent-paper-2) text-xs font-semibold text-(--ent-ink)"
                  >
                    <MapPin className="size-4" aria-hidden />
                    Cómo llegar
                  </a>
                ) : (
                  <Link
                    href={filmUrl}
                    className="ent-press flex h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-(--ent-paper-2) text-xs font-semibold text-(--ent-ink)"
                  >
                    <ArrowRight className="size-4" aria-hidden />
                    El menú
                  </Link>
                )}
              </div>
            </>
          ) : rejected ? (
            <div className="space-y-3">
              {retryUrl ? (
                <a
                  href={retryUrl}
                  className="ent-press ent-btn-pay flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold"
                >
                  <RotateCcw className="size-4" aria-hidden />
                  Probar de nuevo
                </a>
              ) : null}
              <Link
                href={retryFilmUrl}
                className="ent-press flex h-12 w-full items-center justify-center rounded-2xl border border-(--ent-ink)/20 text-sm font-semibold text-(--ent-ink)"
              >
                Empezar de nuevo
              </Link>
            </div>
          ) : expired && !approved ? (
            <Link
              href={retryFilmUrl}
              className="ent-press flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-(--ent-ink) text-base font-semibold text-(--ent-paper)"
            >
              Reservar de nuevo
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : waiting ? (
            <div className="space-y-3">
              <p className="text-center text-xs text-(--ent-ink-2)">
                ¿Cerraste Mercado Pago sin pagar? Tu lugar sigue guardado un ratito.
              </p>
              {retryUrl ? (
                <a
                  href={retryUrl}
                  className="ent-press flex h-12 w-full items-center justify-center rounded-2xl border border-(--ent-ink)/20 text-sm font-semibold text-(--ent-ink)"
                >
                  Volver a Mercado Pago
                </a>
              ) : null}
            </div>
          ) : refunded ? (
            <ContactLine whatsapp={whatsapp} tenantName={tenantName} code={order.shortCode} />
          ) : null}
        </div>
      </article>

      <div className="mt-8 text-center">
        <Link
          href={`/entradas/${tenantSlug}`}
          className="ent-press inline-flex h-11 items-center gap-2 text-sm font-semibold text-(--ent-cream-2) hover:text-(--ent-cream)"
        >
          Ver toda la cartelera
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  )
}

function StatusBlock({
  approved,
  waiting,
  rejected,
  expired,
  refunded,
  firstName,
  reason,
  holdUntil,
}: {
  approved: boolean
  waiting: boolean
  rejected: boolean
  expired: boolean
  refunded: boolean
  firstName: string
  reason: string
  holdUntil: string
}) {
  const until = new Date(holdUntil).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Cordoba',
  })
  if (approved) {
    return (
      <div aria-live="polite">
        <svg viewBox="0 0 52 52" className="ent-check size-14 text-(--accent)" aria-hidden="true">
          <circle
            cx="26"
            cy="26"
            r="24"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="3"
          />
          <path
            d="M15 27 l7 7 l15 -16"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h1 className="ent-display mt-4 text-[2.4rem] leading-[0.95]">¡Listo, {firstName}!</h1>
        <p className="mt-2 text-base text-(--ent-ink-2)">Tu lugar está reservado.</p>
      </div>
    )
  }
  if (waiting) {
    return (
      <div aria-live="polite">
        <FilmReel />
        <h1 className="ent-display mt-4 text-[2.1rem] leading-[0.95]">
          Estamos confirmando tu pago…
        </h1>
        <p className="mt-2 text-sm text-(--ent-ink-2)">
          Tarda unos segundos. Dejá esta página abierta: se actualiza sola.
        </p>
      </div>
    )
  }
  if (rejected) {
    return (
      <div aria-live="polite">
        <h1 className="ent-display text-[2.1rem] leading-[0.95]">El pago no se aprobó.</h1>
        <p className="mt-2 text-sm text-(--ent-ink-2)">{reason}</p>
        <p className="mt-2 text-sm font-semibold text-(--ent-ink)">
          Te guardamos el lugar hasta las {until} hs.
        </p>
      </div>
    )
  }
  if (refunded) {
    return (
      <div aria-live="polite">
        <h1 className="ent-display text-[2.1rem] leading-[0.95]">Este pago fue devuelto.</h1>
        <p className="mt-2 text-sm text-(--ent-ink-2)">
          La plata vuelve a tu medio de pago. Si fue un error, escribinos.
        </p>
      </div>
    )
  }
  if (expired) {
    return (
      <div aria-live="polite">
        <h1 className="ent-display text-[2.1rem] leading-[0.95]">
          Se venció el tiempo para pagar.
        </h1>
        <p className="mt-2 text-sm text-(--ent-ink-2)">
          Liberamos los lugares. Si todavía quedan, podés reservar de nuevo en un minuto.
        </p>
      </div>
    )
  }
  return null
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt className="ent-mono pt-0.5 text-[0.6rem] text-(--ent-ink-2)">{label}</dt>
      <dd className={strong ? 'font-semibold text-(--ent-ink)' : 'text-(--ent-ink)'}>{value}</dd>
    </>
  )
}

function ActionButton({
  onClick,
  icon: Icon,
  label,
}: {
  onClick: () => void
  icon: typeof CalendarPlus
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ent-press flex h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-(--ent-paper-2) text-xs font-semibold text-(--ent-ink)"
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  )
}

function ContactLine({
  whatsapp,
  tenantName,
  code,
}: {
  whatsapp: string | null
  tenantName: string
  code: string
}) {
  const wa = whatsapp
    ? buildWaMeUrl(whatsapp, `¡Hola ${tenantName}! Consulta por mi entrada #${code}.`)
    : null
  if (!wa) return null
  return (
    <a
      href={wa}
      target="_blank"
      rel="noopener noreferrer"
      className="ent-press flex h-12 w-full items-center justify-center rounded-2xl bg-(--ent-ink) text-sm font-semibold text-(--ent-paper)"
    >
      Escribinos por WhatsApp
    </a>
  )
}

/** Un rollo de película girando mientras esperamos a Mercado Pago. */
function FilmReel() {
  return (
    <svg viewBox="0 0 48 48" className="ent-reel-spin size-12 text-(--accent)" aria-hidden="true">
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="24" cy="24" r="4" fill="currentColor" />
      {[0, 72, 144, 216, 288].map((deg) => (
        <circle
          key={deg}
          cx={24 + 11 * Math.cos((deg * Math.PI) / 180)}
          cy={24 + 11 * Math.sin((deg * Math.PI) / 180)}
          r="4.5"
          fill="currentColor"
          opacity="0.85"
        />
      ))}
    </svg>
  )
}

/** «martes 1 de diciembre» → «Martes 1 de diciembre» (solo la primera). */
function capitalizeFirst(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text
}
