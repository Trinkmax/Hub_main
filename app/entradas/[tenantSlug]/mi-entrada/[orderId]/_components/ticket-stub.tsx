'use client'

import { Maximize2 } from 'lucide-react'
import { useId, useMemo } from 'react'
import { formatShortCode } from '@/lib/ticketing/door'
import { guillocheFor, STAR_PATH, type TicketQr } from '@/lib/ticketing/ticket-art'
import { TicketQrArt } from './ticket-qr-art'

/** Hasta acá se dibuja una ✦ por persona; más gente no entra en el renglón. */
const MAX_PUNCHES = 12

/**
 * El talón de la entrada: la parte que se corta en la puerta. El QR va sobre una
 * chapa lisa, encima de una roseta que sale del id del pedido.
 */
export function TicketStub({
  orderId,
  shortCode,
  title,
  qr,
  inside,
  total,
  falling,
  clipPath,
  onEnlarge,
}: {
  orderId: string
  shortCode: string
  title: string
  qr: TicketQr
  inside: number
  total: number
  falling: boolean
  clipPath?: string
  onEnlarge: () => void
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const rosette = useMemo(() => guillocheFor(orderId, 230), [orderId])
  const partial = inside > 0 && inside < total

  return (
    <div
      className="ent-paper ent-notched ent-half ent-half-stub"
      data-falling={falling}
      style={clipPath ? { clipPath } : undefined}
    >
      <svg
        className="ent-guilloche"
        viewBox="-230 -230 460 460"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <path id={id} d={rosette.path} fill="none" stroke="currentColor" strokeWidth="0.6" />
        </defs>
        {Array.from({ length: rosette.copies }, (_, k) => k * rosette.step).map((angle) => (
          <use key={angle} href={`#${id}`} transform={`rotate(${angle})`} />
        ))}
      </svg>

      <div className="relative px-6 pt-8 pb-7">
        <button
          type="button"
          onClick={onEnlarge}
          className="ent-qr-plate"
          aria-label="Agrandar el QR para mostrarlo en la puerta"
          style={{ '--rows': qr.size } as React.CSSProperties}
        >
          <span className="ent-qr-print block">
            <TicketQrArt qr={qr} label={`Código QR de tu entrada para ${title}`} />
          </span>
          <span className="ent-qr-head" aria-hidden />
        </button>

        <p className="ent-serial mt-4 text-center text-sm">{formatShortCode(shortCode)}</p>

        {partial ? (
          <div className="mt-3 text-center">
            {total <= MAX_PUNCHES ? (
              <div className="flex flex-wrap justify-center gap-1.5" aria-hidden>
                {Array.from({ length: total }, (_, k) => k + 1).map((seat) => (
                  <svg
                    key={seat}
                    viewBox="-1 -1 2 2"
                    className="ent-punch size-4"
                    data-on={seat <= inside}
                    aria-hidden="true"
                  >
                    <path d={STAR_PATH} fill="currentColor" />
                  </svg>
                ))}
              </div>
            ) : null}
            <p className="mt-1.5 text-sm font-semibold text-(--ent-ink)">
              Entraron {inside} de {total}. El QR sigue sirviendo para los que faltan.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-center text-sm font-semibold text-(--ent-ink)">
            Mostrá este QR en la puerta.
          </p>
        )}

        <button
          type="button"
          onClick={onEnlarge}
          className="ent-press mx-auto mt-3 flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-(--ent-ink) underline-offset-4 hover:underline"
        >
          <Maximize2 className="size-4" aria-hidden />
          Agrandar
        </button>
      </div>
    </div>
  )
}
