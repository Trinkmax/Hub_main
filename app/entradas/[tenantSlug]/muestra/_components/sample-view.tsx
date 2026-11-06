'use client'

import { DoorOpen, RotateCcw, Scissors } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import '@/components/door/door.css'
import {
  DOOR_RETURN_MS,
  DoorProblemView,
  type DoorStage,
  DoorVerdictView,
} from '@/components/door/door-verdict-view'
import { rejectionReason } from '@/lib/ticketing/copy'
import { formatLongDate } from '@/lib/ticketing/dates'
import { type DoorTicket, doorVerdict } from '@/lib/ticketing/door'
import { formatPesos } from '@/lib/ticketing/pricing'
import { tornProfile } from '@/lib/ticketing/ticket-art'
import type { PublicOrder, TransferAccount } from '@/lib/ticketing/types'
import { LightsOff } from '../../mi-entrada/[orderId]/_components/lights-off'
import {
  ApprovedTicket,
  capitalizeFirst,
  RejectedTicket,
  Row,
  StatusBlock,
  TicketHeader,
} from '../../mi-entrada/[orderId]/_components/order-view'
import { centerOf, glideTo } from '../../mi-entrada/[orderId]/_components/ticket-show'
import {
  saveTicketImage,
  useTicketImage,
} from '../../mi-entrada/[orderId]/_components/use-ticket-image'

// Lo que dura «Estamos confirmando tu pago…» antes de aprobarse.
const CONFIRM_MS = 2200
const TEAR_MS = 1300
// Grabando no hay botones: la película sigue sola. Al terminar la función espera un
// momento, sube al talón, lo corta y vuelve arriba.
const VIDEO_HOLD_MS = 1800
const CAMERA_TO_STUB_MS = 1000

/**
 * La muestra usa las mismas piezas que la entrada de verdad, pero no le pregunta nada
 * al server: el pago se aprueba solo y el corte lo dispara un botón.
 */
export function SampleView({
  order,
  tenantName,
  address,
  door,
  rejected,
  holdOver = false,
  transfer,
  whatsapp,
  video,
}: {
  order: PublicOrder
  tenantName: string
  address: string | null
  door: boolean
  rejected: boolean
  /** El rechazo después de la hora del lugar guardado, con la función todavía con lugar. */
  holdOver?: boolean
  transfer: TransferAccount | null
  whatsapp: string | null
  video: boolean
}) {
  if (rejected) {
    return (
      <RejectedSample
        order={order}
        tenantName={tenantName}
        transfer={transfer}
        whatsapp={whatsapp}
        holdOver={holdOver}
      />
    )
  }
  return door ? (
    <DoorSample order={order} video={video} />
  ) : (
    <TicketSample order={order} tenantName={tenantName} address={address} video={video} />
  )
}

/** Lo que ve quien paga si Mercado Pago le rechaza el pago. */
function RejectedSample({
  order,
  tenantName,
  transfer,
  whatsapp,
  holdOver,
}: {
  order: PublicOrder
  tenantName: string
  transfer: TransferAccount | null
  whatsapp: string | null
  holdOver: boolean
}) {
  return (
    <main
      className="ent-hero -mt-[4.5rem] min-h-[100dvh] px-4 pt-28 pb-32"
      style={{ '--accent': order.accent } as React.CSSProperties}
    >
      <div className="ent-beam" aria-hidden />
      <div className="ent-screen-glow" aria-hidden />
      <div className="relative mx-auto w-full max-w-md">
        <RejectedTicket
          order={order}
          tenantName={tenantName}
          header={<TicketHeader order={order} />}
          reason={rejectionReason('rejected_high_risk')}
          retryUrl="#"
          restartUrl="#"
          transfer={transfer ?? { alias: 'alias.del.bar', holder: tenantName }}
          whatsapp={whatsapp}
          holdOver={holdOver}
        />
      </div>
      <SampleBar>
        <Link href="?" className="ent-press ent-ghost ent-sample-btn">
          Ver la entrada
        </Link>
      </SampleBar>
    </main>
  )
}

function TicketSample({
  order,
  tenantName,
  address,
  video,
}: {
  order: PublicOrder
  tenantName: string
  address: string | null
  video: boolean
}) {
  // Cambiar la vuelta remonta todo: las animaciones arrancan de cero.
  const [round, setRound] = useState(0)
  return (
    <main
      className="ent-hero -mt-[4.5rem] min-h-[100dvh] px-4 pt-28 pb-32"
      style={{ '--accent': order.accent } as React.CSSProperties}
    >
      <div className="ent-beam" aria-hidden />
      <div className="ent-screen-glow" aria-hidden />
      <TicketRound
        key={round}
        order={order}
        tenantName={tenantName}
        address={address}
        video={video}
        onReplay={() => setRound((r) => r + 1)}
      />
    </main>
  )
}

function TicketRound({
  order,
  tenantName,
  address,
  video,
  onReplay,
}: {
  order: PublicOrder
  tenantName: string
  address: string | null
  video: boolean
  onReplay: () => void
}) {
  const [approved, setApproved] = useState(false)
  const [falling, setFalling] = useState(false)
  const [torn, setTorn] = useState(false)
  // La hora del corte: se lee recién al cortar, ya en el navegador.
  const [tornAt, setTornAt] = useState<string | null>(null)
  const [lights, setLights] = useState(false)
  const profile = useMemo(() => tornProfile(order.id), [order.id])
  const balanceCents =
    order.option === 'deposit' ? (order.fullPriceCents - order.unitPriceCents) * order.partySize : 0
  const image = useTicketImage(
    approved ? { order, tenantName, address, paidCents: order.totalCents, balanceCents } : null,
  )

  useEffect(() => {
    // Cada vuelta arranca de arriba.
    window.scrollTo({ top: 0, behavior: 'instant' })
    const timer = setTimeout(() => setApproved(true), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [])

  const tear = useCallback(() => {
    setTornAt(
      new Date().toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Argentina/Cordoba',
      }),
    )
    setLights(false)
    setFalling(true)
    if (typeof navigator.vibrate === 'function') navigator.vibrate(24)
    setTimeout(() => {
      setFalling(false)
      setTorn(true)
    }, TEAR_MS)
  }, [])

  // Primero la cámara va al talón, para ver cómo se corta.
  const cutAtDoor = useCallback(
    (backToTop: boolean) => {
      const stub = document.querySelector('.ent-half-stub')
      if (stub) glideTo(centerOf(stub, 0.56), CAMERA_TO_STUB_MS)
      setTimeout(tear, CAMERA_TO_STUB_MS + 350)
      if (backToTop) setTimeout(() => glideTo(0, 1300), CAMERA_TO_STUB_MS + TEAR_MS + 1100)
    },
    [tear],
  )

  return (
    <div
      className={`relative mx-auto w-full ${approved ? 'max-w-md lg:max-w-[55rem]' : 'max-w-md'}`}
    >
      {approved ? (
        <ApprovedTicket
          order={order}
          tenantName={tenantName}
          address={address}
          filmUrl="#"
          header={<TicketHeader order={order} />}
          entry={
            torn ? { ...order.entry, inside: order.entry.total, atLabel: tornAt } : order.entry
          }
          falling={falling}
          torn={torn}
          past={false}
          profile={profile}
          paidCents={order.totalCents}
          balanceCents={balanceCents}
          deposit={order.option === 'deposit'}
          onEnlarge={() => setLights(true)}
          onAgendar={() => undefined}
          onShare={() => undefined}
          onSave={() => saveTicketImage(image, order)}
          saving={image.saving}
          saveFailed={image.failed}
          whatsappSelf={null}
          show
          onShowDone={video ? () => setTimeout(() => cutAtDoor(true), VIDEO_HOLD_MS) : undefined}
        />
      ) : (
        <article className="ent-paper overflow-hidden rounded-[26px] shadow-[0_50px_100px_-40px_rgb(0_0_0/0.9)] [--ent-hole:#090d0b]">
          <TicketHeader order={order} />
          <div className="px-6 pt-6 pb-7">
            <StatusBlock
              waiting
              rejected={false}
              expired={false}
              refunded={false}
              reason=""
              note={null}
            />
            <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
              <Row label="Fecha" value={capitalizeFirst(formatLongDate(order.date))} />
              <Row label="Hora" value={`${order.time} hs`} />
              <Row
                label={order.option === 'deposit' ? 'Seña' : 'Total'}
                value={formatPesos(order.totalCents)}
              />
            </dl>
          </div>
        </article>
      )}

      {order.qr ? (
        <LightsOff
          open={lights}
          onClose={() => setLights(false)}
          qr={order.qr}
          title={order.title}
          firstName={order.guestFirstName}
          partySize={order.partySize}
          shortCode={order.shortCode}
        />
      ) : null}

      {approved && !video ? (
        <SampleBar>
          <button type="button" className="ent-press ent-ghost ent-sample-btn" onClick={onReplay}>
            <RotateCcw className="size-4" aria-hidden />
            Volver a ver
          </button>
          {torn ? null : (
            <button
              type="button"
              className="ent-press ent-ghost ent-sample-btn"
              onClick={() => cutAtDoor(false)}
              disabled={falling}
            >
              <Scissors className="size-4" aria-hidden />
              Cortar en la puerta
            </button>
          )}
          <Link href="?ver=puerta" className="ent-press ent-ghost ent-sample-btn">
            <DoorOpen className="size-4" aria-hidden />
            Ver la puerta
          </Link>
        </SampleBar>
      ) : null}
    </div>
  )
}

function SampleBar({ children }: { children: React.ReactNode }) {
  return (
    <nav className="ent-sample-bar" aria-label="Controles de la muestra">
      {children}
    </nav>
  )
}

type DoorCase = 'pasan' | 'grupo' | 'usada' | 'otro-dia' | 'no-pasa' | 'no-figura'

const DOOR_CASES: ReadonlyArray<[DoorCase, string]> = [
  ['pasan', 'Pasan'],
  ['grupo', 'De a partes'],
  ['usada', 'Ya entraron'],
  ['otro-dia', 'Otro día'],
  ['no-pasa', 'No pasa'],
  ['no-figura', 'No figura'],
]

function doorTicket(order: PublicOrder, kind: DoorCase): DoorTicket {
  const party = kind === 'grupo' ? 4 : order.partySize
  const base: DoorTicket = {
    order_id: order.id,
    short_code: order.shortCode,
    status: 'approved',
    title: order.title,
    poster_url: order.posterUrl,
    accent_hex: order.accent,
    guest_name: order.guestFirstName,
    party_size: party,
    payment_option: order.option,
    unit_price_cents: order.unitPriceCents,
    full_price_cents: order.fullPriceCents,
    paid_cents: order.unitPriceCents * party,
    balance_cash_only: false,
    event_date: order.today,
    event_time: order.time,
    service_day: order.today,
    reservation: {
      id: 'muestra',
      status: 'pending',
      date: order.today,
      time: order.time,
      estimated_guests: party,
      actual_guests: null,
      arrived_at_label: null,
      arrived_by_name: null,
    },
    room: { inside: 18, expected: 46 },
  }
  const reservation = base.reservation as NonNullable<DoorTicket['reservation']>
  switch (kind) {
    case 'grupo':
      return {
        ...base,
        reservation: {
          ...reservation,
          status: 'arrived',
          actual_guests: 2,
          arrived_at_label: '20:58',
          arrived_by_name: 'Luz',
        },
      }
    case 'usada':
      return {
        ...base,
        reservation: {
          ...reservation,
          status: 'arrived',
          actual_guests: party,
          arrived_at_label: '21:04',
          arrived_by_name: 'Luz',
        },
      }
    case 'otro-dia':
      return {
        ...base,
        reservation: { ...reservation, date: order.date > order.today ? order.date : '2027-01-15' },
      }
    case 'no-pasa':
      return { ...base, status: 'refunded' }
    default:
      return base
  }
}

function DoorSample({ order, video }: { order: PublicOrder; video: boolean }) {
  const [kind, setKind] = useState<DoorCase>('pasan')
  const ticket = useMemo(() => doorTicket(order, kind), [order, kind])
  const verdict = doorVerdict(ticket)
  const [stage, setStage] = useState<DoorStage>('verdict')
  const [guests, setGuests] = useState(verdict.kind === 'admit' ? verdict.left : 1)
  const shown =
    stage === 'verdict' || stage === 'admitting'
      ? ticket
      : { ...ticket, room: { inside: 18 + guests, expected: 46 } }

  const choose = (next: DoorCase) => {
    const nextVerdict = doorVerdict(doorTicket(order, next))
    setKind(next)
    setStage('verdict')
    setGuests(nextVerdict.kind === 'admit' ? nextVerdict.left : 1)
  }

  const restart = useCallback(() => {
    setStage('verdict')
    setGuests(verdict.kind === 'admit' ? verdict.left : 1)
  }, [verdict])

  useEffect(() => {
    if (stage === 'admitting') {
      const timer = setTimeout(() => setStage('falling'), 450)
      return () => clearTimeout(timer)
    }
    if (stage === 'falling') {
      const timer = setTimeout(() => setStage('done'), 1150)
      return () => clearTimeout(timer)
    }
    if (stage === 'undoing') {
      const timer = setTimeout(() => setStage('verdict'), 500)
      return () => clearTimeout(timer)
    }
    if (stage === 'done') {
      const timer = setTimeout(restart, DOOR_RETURN_MS)
      return () => clearTimeout(timer)
    }
  }, [stage, restart])

  return (
    <div className="[--salon-tabbar-h:4.5rem] [--salon-topbar-h:0px]">
      <style>{':root{color-scheme:light}'}</style>
      <div className="px-4 pt-3">
        {kind === 'no-figura' ? (
          <DoorProblemView
            word="No figura"
            note="Este código no es de una entrada de este bar. Pedile a la persona que abra su entrada de nuevo, o buscala por nombre en Reservas."
            retryLabel="Escanear otra"
            onNext={() => choose('pasan')}
          />
        ) : (
          <DoorVerdictView
            ticket={shown}
            verdict={verdict}
            stage={stage}
            guests={guests}
            onGuests={setGuests}
            onAdmit={() => setStage('admitting')}
            onNext={() => choose('pasan')}
            onUndo={() => setStage('undoing')}
          />
        )}
      </div>
      {video ? null : (
        <SampleBar>
          {DOOR_CASES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="ent-press ent-ghost ent-sample-btn"
              aria-pressed={kind === value}
              onClick={() => choose(value)}
            >
              {label}
            </button>
          ))}
          <Link href="?" className="ent-press ent-ghost ent-sample-btn">
            Ver la entrada
          </Link>
        </SampleBar>
      )}
    </div>
  )
}
