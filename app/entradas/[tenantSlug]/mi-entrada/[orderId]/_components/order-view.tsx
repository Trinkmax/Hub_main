'use client'

import {
  ArrowRight,
  CalendarPlus,
  Download,
  Loader2,
  MapPin,
  MessageCircle,
  QrCode,
  RotateCcw,
  Share2,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildWaMeUrl } from '@/lib/phone'
import { refreshOrder } from '@/lib/ticketing/checkout-actions'
import { daysUntilLabel, peopleLabel, rejectionReason } from '@/lib/ticketing/copy'
import { buildIcs, formatLongDate } from '@/lib/ticketing/dates'
import { formatPesos } from '@/lib/ticketing/pricing'
import { tornClipBottom, tornClipTop, tornProfile } from '@/lib/ticketing/ticket-art'
import type { OrderEntry, OrderStatus, PublicOrder } from '@/lib/ticketing/types'
import { mapsUrl } from '../../../../_components/chrome'
import { LightsOff } from './lights-off'
import { PaidStamp } from './paid-stamp'
import { Receipt } from './receipt'
import { TicketStub } from './ticket-stub'
import { saveTicketImage, useTicketImage } from './use-ticket-image'

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
  entry: OrderEntry
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
// La noche de la función, la entrada mira si ya la validaron en la puerta.
const DOOR_POLL_MS = 5000
// Lo que tarda el talón en cortarse y caer (.ent-half-stub[data-falling]).
const TEAR_MS = 1300
// Un rato más después de entrar, por si quien recibe lo deshace.
const DOOR_GRACE_MS = 90_000
// Tope de una pestaña abierta preguntando.
const DOOR_WATCH_MS = 6 * 60 * 60_000

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
    entry: order.entry,
  })
  const router = useRouter()
  const [celebrate, setCelebrate] = useState(false)
  // Se cortó el talón mientras la persona miraba (dura lo que tarda en caer).
  const [falling, setFalling] = useState(false)
  const [lights, setLights] = useState(false)
  // Solo se puede armar en el navegador: si se armara en el render, el server y el
  // cliente dibujarían distinto.
  const [whatsappSelf, setWhatsappSelf] = useState<string | null>(null)
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

    let failures = 0
    const tick = async () => {
      try {
        const result = await refreshOrder({
          tenantSlug,
          orderId: order.id,
          paymentId: usePaymentId,
        })
        usePaymentId = null
        if (cancelled) return
        failures = 0
        setConfirming(false)
        if (result.ok) {
          const next: Live = {
            status: result.status,
            expired: result.expired,
            paidCents: result.paidCents,
            statusDetail: result.statusDetail,
            entry: result.entry ?? order.entry,
          }
          setLive(next)
          if (next.status === 'approved' && firstStatus.current !== 'approved') {
            setCelebrate(true)
            // Recién pagada: el QR y los datos del comprobante vienen del server.
            router.refresh()
          }
          if (settled(next)) return
        }
      } catch {
        // Sin señal (volvió de la app de Mercado Pago con la red despertando) o una
        // versión nueva de la página: se sigue preguntando. Si no es por falta de
        // señal, recargar trae la versión nueva y el estado real del pago.
        if (cancelled) return
        failures += 1
        if (failures >= 3 && navigator.onLine) {
          window.location.reload()
          return
        }
      }
      const elapsed = Date.now() - started.current
      if (elapsed > GIVE_UP_MS) {
        setConfirming(false)
        return
      }
      timer = setTimeout(tick, elapsed < FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS)
    }

    if (!settled({ ...live })) void tick()
    else setConfirming(false)

    // La URL de Mercado Pago trae varios parámetros: se limpia para que el
    // link que se guarde o comparta sea el de la entrada, nada más.
    const url = new URL(window.location.href)
    if (url.search) {
      url.search = ''
      // Con el estado en null Next se entera: si no, el refresh reescribe la URL vieja.
      window.history.replaceState(null, '', url)
    }

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  // La noche de la función, cada pocos segundos: si en la puerta validan la
  // entrada, el talón se corta acá también, con la persona mirando. Solo con la
  // página a la vista. Después de que entraron todos sigue preguntando un rato, por
  // si quien recibe lo deshace: el QR vuelve solo.
  const allIn = live.entry.inside >= live.entry.total
  const isToday = order.date === order.today
  const [doorGrace, setDoorGrace] = useState(false)
  const watchDoor =
    live.status === 'approved' && isToday && !live.entry.cancelled && (!allIn || doorGrace)
  const wasAllIn = useRef(allIn)
  const tear = useCallback(() => {
    setFalling(true)
    setLights(false)
    setDoorGrace(true)
    if (typeof navigator.vibrate === 'function') navigator.vibrate(24)
  }, [])
  useEffect(() => {
    if (!doorGrace) return
    const timer = setTimeout(() => setDoorGrace(false), DOOR_GRACE_MS)
    return () => clearTimeout(timer)
  }, [doorGrace])
  useEffect(() => {
    if (!watchDoor) return
    let cancelled = false
    let busy = false
    const since = Date.now()
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible' || busy) return
      // Una pestaña que quedó abierta no pregunta toda la noche.
      if (Date.now() - since > DOOR_WATCH_MS) {
        clearInterval(timer)
        return
      }
      busy = true
      try {
        const result = await refreshOrder({ tenantSlug, orderId: order.id })
        if (cancelled || !result.ok) return
        // También lo que no es la llegada: si la devolvieron, la entrada lo dice.
        setLive((current) => ({
          ...current,
          status: result.status,
          expired: result.expired,
          paidCents: result.paidCents,
          statusDetail: result.statusDetail,
          entry: result.entry ?? current.entry,
        }))
        const entry = result.entry
        if (entry) {
          const nowAllIn = entry.inside >= entry.total
          if (nowAllIn && !wasAllIn.current) tear()
          wasAllIn.current = nowAllIn
        }
      } catch {
        // Sin señal: se vuelve a preguntar en un rato.
      } finally {
        busy = false
      }
    }, DOOR_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [watchDoor, tenantSlug, order.id, tear])
  useEffect(() => {
    if (!falling) return
    const timer = setTimeout(() => setFalling(false), TEAR_MS)
    return () => clearTimeout(timer)
  }, [falling])

  useEffect(() => {
    const link = `${window.location.origin}${window.location.pathname}`
    setWhatsappSelf(
      `https://wa.me/?text=${encodeURIComponent(`Mi entrada para ${order.title}: ${link}`)}`,
    )
  }, [order.title])

  // Recién aprobada: si el QR no llegó con el primer refresco, se insiste un poco.
  const missingQr =
    live.status === 'approved' &&
    !order.qr &&
    !live.entry.cancelled &&
    live.entry.inside < live.entry.total &&
    order.date >= order.today
  useEffect(() => {
    if (!missingQr) return
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      router.refresh()
      if (tries >= 4) clearInterval(timer)
    }, 2500)
    return () => clearInterval(timer)
  }, [missingQr, router])

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

  const qr = order.qr
  const profile = useMemo(() => tornProfile(order.id), [order.id])
  const torn = approved && allIn && !falling
  const past = order.date < order.today
  const paidCents = live.paidCents ?? order.totalCents
  const deposit = order.option === 'deposit'
  const image = useTicketImage(
    approved && qr ? { order, tenantName, address, paidCents, balanceCents } : null,
  )

  const header = <TicketHeader order={order} />

  return (
    <div
      className={`relative mx-auto w-full ${approved ? 'max-w-md lg:max-w-[55rem]' : 'max-w-md'}`}
      data-celebrate={celebrate}
      style={{ '--accent': order.accent } as React.CSSProperties}
    >
      {celebrate ? <Confetti /> : null}

      {approved ? (
        <ApprovedTicket
          order={order}
          tenantName={tenantName}
          address={address}
          filmUrl={filmUrl}
          header={header}
          entry={live.entry}
          falling={falling}
          torn={torn}
          past={past}
          profile={profile}
          paidCents={paidCents}
          balanceCents={balanceCents}
          deposit={deposit}
          onEnlarge={() => setLights(true)}
          onAgendar={download}
          onShare={share}
          onSave={() => saveTicketImage(image, order)}
          saving={image.saving}
          saveFailed={image.failed}
          whatsappSelf={whatsappSelf}
          contact={
            <div className="mt-6">
              <ContactLine whatsapp={whatsapp} tenantName={tenantName} code={order.shortCode} />
            </div>
          }
        />
      ) : (
        <article className="ent-paper overflow-hidden rounded-[26px] shadow-[0_50px_100px_-40px_rgb(0_0_0/0.9)] [--ent-hole:#090d0b]">
          {header}

          <div className="px-6 pt-6 pb-5">
            <StatusBlock
              waiting={waiting}
              rejected={rejected}
              expired={expired}
              refunded={refunded}
              reason={rejectionReason(live.statusDetail)}
              holdUntil={order.holdExpiresAt}
            />

            <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
              <Row label="Fecha" value={capitalizeFirst(formatLongDate(order.date))} />
              <Row label="Hora" value={`${order.time} hs`} />
              <Row label="Admite" value={peopleLabel(order.partySize)} />
              <Row
                label={order.option === 'deposit' ? 'Seña' : 'Total'}
                value={formatPesos(order.totalCents)}
              />
            </dl>
          </div>

          <div className="ent-ticket-cut px-6" aria-hidden>
            <hr className="ent-perforation" />
          </div>

          <div className="px-6 pt-5 pb-6">
            {rejected ? (
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
            ) : expired ? (
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
      )}

      {approved && qr ? (
        <LightsOff
          open={lights}
          onClose={() => setLights(false)}
          qr={qr}
          title={order.title}
          firstName={order.guestFirstName}
          partySize={live.entry.total - live.entry.inside}
          shortCode={order.shortCode}
        />
      ) : null}

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

/** El festejo: destellos ✦ al aprobarse el pago. */
export function Confetti() {
  return (
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
  )
}

/** La cabecera: el afiche de la película, como el arte de la entrada. */
export function TicketHeader({ order }: { order: PublicOrder }) {
  return (
    <div className="relative h-44 overflow-hidden bg-(--ent-ink)">
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
      <p className="ent-mono absolute top-4 right-3 text-[0.58rem] text-(--ent-paper)/85 [writing-mode:vertical-rl]">
        Nº {order.shortCode}
      </p>
      <div className="absolute right-5 bottom-4 left-5 flex items-end justify-between gap-3 text-(--ent-paper)">
        <p className="ent-display min-w-0 text-[2.15rem] text-balance">{order.title}</p>
        <span className="ent-mono shrink-0 rounded-md border border-current/40 px-2 py-1 text-[0.58rem]">
          Admite {order.partySize}
        </span>
      </div>
    </div>
  )
}

/**
 * La entrada paga: dos mitades de papel unidas por el troquel, y el comprobante
 * que sale de atrás. En la puerta el talón se corta (`falling`) y queda la mitad
 * de arriba con el borde rasgado (`torn`).
 */
export function ApprovedTicket({
  order,
  tenantName,
  address,
  filmUrl,
  header,
  entry,
  falling,
  torn,
  past,
  profile,
  paidCents,
  balanceCents,
  deposit,
  onEnlarge,
  onAgendar,
  onShare,
  onSave,
  saving,
  saveFailed,
  whatsappSelf,
  contact,
}: {
  order: PublicOrder
  tenantName: string
  address: string | null
  filmUrl: string
  header: React.ReactNode
  entry: OrderEntry
  falling: boolean
  torn: boolean
  past: boolean
  profile: number[]
  paidCents: number
  balanceCents: number
  deposit: boolean
  onEnlarge: () => void
  onAgendar: () => void
  onShare: () => void
  onSave: () => void
  saving: boolean
  saveFailed: boolean
  whatsappSelf: string | null
  /** Cómo escribir al bar, para cuando la entrada ya no sirve. */
  contact?: React.ReactNode
}) {
  const qr = order.qr
  const countdown = daysUntilLabel(order.date, order.today)
  const doorNight = order.date === order.today && !entry.cancelled
  const showStub = (falling || (!torn && !entry.cancelled && !past)) && qr
  const heading = torn
    ? `¡Que la disfruten, ${order.guestFirstName}!`
    : entry.cancelled
      ? 'Esta reserva se canceló'
      : past
        ? 'Esta función ya pasó'
        : `¡Listo, ${order.guestFirstName}!`
  // Cancelada o de otro día, ya no hay nada que hacer con la entrada: queda el comprobante.
  const closed = !torn && (entry.cancelled || past)

  return (
    <div className="ent-counter">
      <div className="ent-admit [--ent-hole:#090d0b]" data-falling={falling}>
        <article
          className="ent-paper ent-notched ent-half ent-half-top"
          data-torn={torn || falling}
          style={torn || falling ? { clipPath: tornClipTop(profile) } : undefined}
        >
          {header}
          <div className={`relative px-6 pt-6 ${torn ? 'pb-9' : 'pb-7'}`}>
            <PaidStamp
              tenantName={tenantName}
              paidLabel={order.paidAtLabel?.slice(0, 10) ?? null}
              deposit={deposit}
              className="-top-5 right-3 size-[6.4rem]"
            />
            <div aria-live="polite" className="pr-24">
              <h1 className="ent-display text-[2.3rem] text-balance">{heading}</h1>
              <p className="mt-2 text-base text-(--ent-ink-2)">
                {torn
                  ? entry.atLabel
                    ? `Entraron a las ${entry.atLabel}.`
                    : 'Ya entraron.'
                  : entry.cancelled
                    ? 'Si fue un error, escribinos.'
                    : past
                      ? 'Acá queda tu comprobante.'
                      : 'Tu lugar está reservado.'}
              </p>
            </div>

            <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
              <Row label="Fecha" value={capitalizeFirst(formatLongDate(order.date))} />
              <Row
                label="Hora"
                value={countdown && !torn ? `${order.time} hs · ${countdown}` : `${order.time} hs`}
              />
              <Row label="Admite" value={peopleLabel(entry.total)} />
              <Row
                label="Pagaste"
                value={`${formatPesos(paidCents)} ${deposit ? '(seña)' : '(total)'}`}
              />
              {closed ? null : (
                <>
                  {/* El resto, «en efectivo» solo si se compró así (precio en
                  efectivo); si no, se paga como quiera en el local. Sin resto,
                  nunca «nada más»: lo que no incluye el precio se paga en el bar. */}
                  <Row
                    label={
                      balanceCents > 0 && !order.balanceCashOnly ? 'El día del evento' : 'En el bar'
                    }
                    value={
                      balanceCents <= 0
                        ? 'La entrada ya está paga'
                        : order.balanceCashOnly
                          ? `${formatPesos(balanceCents)} en efectivo`
                          : `${formatPesos(balanceCents)}, en el local`
                    }
                    strong={balanceCents > 0}
                  />
                </>
              )}
            </dl>
            {order.priceNote ? (
              <p className="mt-3 text-xs text-(--ent-ink-2)">{order.priceNote}</p>
            ) : null}
          </div>
        </article>

        {showStub ? (
          <div className="ent-stub-slot" data-gone={falling}>
            <div>
              <TicketStub
                orderId={order.id}
                shortCode={order.shortCode}
                title={order.title}
                qr={qr}
                inside={entry.inside}
                total={entry.total}
                falling={falling}
                clipPath={falling ? tornClipBottom(profile) : undefined}
                onEnlarge={onEnlarge}
              />
            </div>
          </div>
        ) : !torn && !entry.cancelled && !past ? (
          // Recién aprobada: el QR llega del server en un momento.
          <div className="ent-paper ent-notched ent-half ent-half-stub flex h-72 items-center justify-center">
            <p className="text-sm font-semibold text-(--ent-ink-2)">Imprimiendo tu entrada…</p>
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        {order.mpPaymentId || order.paidAtLabel ? (
          <Receipt
            order={order}
            tenantName={tenantName}
            paidCents={paidCents}
            balanceCents={balanceCents}
          />
        ) : null}

        {qr && !torn && !closed ? (
          <div className="mt-7">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="ent-press ent-save flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold"
            >
              {saving ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <Download className="size-5" aria-hidden />
              )}
              Guardar entrada y comprobante
            </button>
            <p className="mt-2 text-center text-sm text-(--ent-cream-2)">
              Se guarda como imagen en tu celular: sirve aunque no tengas señal.
            </p>
            {saveFailed ? (
              <p role="alert" className="mt-2 text-center text-sm font-semibold text-(--ent-gold)">
                No pudimos armar la imagen. Probá de nuevo o sacale una captura a la entrada.
              </p>
            ) : null}
            {whatsappSelf ? (
              <a
                href={whatsappSelf}
                target="_blank"
                rel="noopener noreferrer"
                className="ent-press mx-auto mt-1 flex h-11 w-fit items-center gap-2 text-sm font-semibold text-(--ent-cream) underline-offset-4 hover:underline"
              >
                <MessageCircle className="size-4" aria-hidden />
                Mandarme el link por WhatsApp
              </a>
            ) : null}
          </div>
        ) : null}

        {closed ? (
          contact
        ) : (
          <div className="mt-5 grid grid-cols-3 gap-2">
            <ActionButton onClick={onAgendar} icon={CalendarPlus} label="Agendar" />
            <ActionButton onClick={onShare} icon={Share2} label="Compartir" />
            {address ? (
              <a
                href={mapsUrl(address)}
                target="_blank"
                rel="noopener noreferrer"
                className="ent-press ent-ghost flex h-16 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-semibold"
              >
                <MapPin className="size-4" aria-hidden />
                Cómo llegar
              </a>
            ) : (
              <Link
                href={filmUrl}
                className="ent-press ent-ghost flex h-16 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-semibold"
              >
                <ArrowRight className="size-4" aria-hidden />
                El menú
              </Link>
            )}
          </div>
        )}

        {!torn && !closed ? (
          <p className="mt-4 text-center text-xs text-(--ent-muted)">
            ¿Sin el celular a mano? En la puerta decí que reservaste a nombre de{' '}
            {order.guestFirstName}.
          </p>
        ) : null}
      </div>

      {doorNight && qr && !torn && !falling && !closed ? (
        <div className="ent-door-bar lg:hidden">
          <button
            type="button"
            onClick={onEnlarge}
            className="ent-press ent-btn-pay mx-auto flex h-14 w-full max-w-md items-center justify-center gap-2 rounded-2xl text-base font-semibold"
          >
            <QrCode className="size-5" aria-hidden />
            Mostrar el QR para entrar
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function StatusBlock({
  waiting,
  rejected,
  expired,
  refunded,
  reason,
  holdUntil,
}: {
  waiting: boolean
  rejected: boolean
  expired: boolean
  refunded: boolean
  reason: string
  holdUntil: string
}) {
  const until = new Date(holdUntil).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Cordoba',
  })
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

export function Row({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
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
      className="ent-press ent-ghost flex h-16 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-semibold"
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
export function capitalizeFirst(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text
}
