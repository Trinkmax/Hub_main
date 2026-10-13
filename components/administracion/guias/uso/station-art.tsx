import type { ReactNode } from 'react'
import type { PaperId, StationId } from '@/lib/accounting/guides'
import { cn } from '@/lib/utils'

/**
 * Los dibujos de la guía, hechos a mano en SVG (server-safe): las cinco estaciones del mapa y
 * los papeles de «Con factura y sin factura». Todos con el mismo trazo (2 px, puntas redondas)
 * para que se lean como una sola mano. Son decorativos: lo que enseñan está escrito al lado.
 */

function Sketch({
  viewBox,
  className,
  children,
}: {
  viewBox: string
  className?: string
  children: ReactNode
}) {
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

/*
 * Los del mapa van sobre el panel verde: tiza crema (`currentColor`) y un detalle dorado por
 * dibujo. Lo dorado que pisa otro trazo se rellena con el verde del panel para taparlo.
 */
const GOLD = 'stroke-adm-gold'
const GOLD_OVER = 'fill-adm-hero stroke-adm-gold'

const STATION_ART: Readonly<Record<StationId, ReactNode>> = {
  // Vendés: el ticket del cierre y la moneda que entra.
  vender: (
    <>
      <path d="M14 8h28v42l-4.7-3.2-4.6 3.2-4.7-3.2-4.7 3.2-4.6-3.2L14 50z" />
      <path d="M21 18h14M21 25h14M21 32h8" />
      <circle cx="46" cy="42" r="11" className={GOLD_OVER} />
      <path
        d="M46 35.5v13M49.6 39.2c-.8-1-2.1-1.6-3.6-1.6-2 0-3.5 1-3.5 2.4 0 3.2 7.1 1.6 7.1 4.8 0 1.4-1.5 2.4-3.6 2.4-1.5 0-2.8-.6-3.6-1.6"
        className={GOLD}
      />
    </>
  ),
  // Comprás y gastás: el cajón con las botellas que llegaron.
  comprar: (
    <>
      <path d="M18 34V24c0-2 2-3 2-5v-7h4v7c0 2 2 3 2 5v10" />
      <path d="M38 34v-8c0-2 2-3 2-5v-5h4v5c0 2 2 3 2 5v8" className={GOLD} />
      <path d="M9 34h46l-3 20H12z" />
      <path d="M10.4 43h43.2" />
    </>
  ),
  // Pagás: el billete y la plata que sale.
  pagar: (
    <>
      <rect x="7" y="27" width="40" height="25" rx="3" />
      <circle cx="27" cy="39.5" r="5.5" />
      <path d="M14.5 39.5h.01M39.5 39.5h.01" strokeWidth={3} />
      <path d="M41 22l14-11.5M45 10h11v11" className={GOLD} />
    </>
  ),
  // Controlás la plata: las monedas contadas, con su tilde.
  controlar: (
    <>
      <ellipse cx="25" cy="25" rx="15" ry="6" />
      <path d="M10 25v8.5c0 3.3 6.7 6 15 6s15-2.7 15-6V25" />
      <path d="M10 33.5V42c0 3.3 6.7 6 15 6s15-2.7 15-6v-8.5" />
      <path d="M10 42v8.5c0 3.3 6.7 6 15 6s15-2.7 15-6V42" />
      <circle cx="47" cy="17" r="10" className={GOLD_OVER} />
      <path d="M42.5 17.3l3.2 3.2 6-6.6" className={GOLD} />
    </>
  ),
  // Fin de mes: el almanaque y lo que sale para la contadora.
  'fin-de-mes': (
    <>
      <rect x="8" y="13" width="38" height="38" rx="4" />
      <path d="M8 24h38M18 8v9M36 8v9" />
      <path d="M16 32h4M25 32h4M34 32h4M16 41h4M25 41h4" />
      <path d="M34 49.5l23-9.5-9.5 21-3.8-8.3z" className={GOLD_OVER} />
      <path d="M43.7 52.7l5.5-5.9" className={GOLD} />
    </>
  ),
}

/** El dibujo de una estación del mapa. Pensado para ir sobre el panel verde. */
export function StationArt({ id, className }: { id: StationId; className?: string }) {
  return (
    <Sketch viewBox="0 0 64 64" className={cn('size-14 text-adm-hero-fg', className)}>
      {STATION_ART[id]}
    </Sketch>
  )
}

export type PaperArtId = PaperId | 'nota_credito'

/** La letra del recuadro de arriba, como en una factura de verdad. */
function PaperLetter({ children }: { children: string }) {
  return (
    <>
      <rect x="18" y="9" width="12" height="11" rx="1.5" />
      <text
        x="24"
        y="17.8"
        textAnchor="middle"
        fontSize={children.length > 1 ? 6.5 : 8.5}
        fontWeight={700}
        stroke="none"
        fill="currentColor"
      >
        {children}
      </text>
    </>
  )
}

const SHEET = 'M7 4h26l8 8v46H7z'
const FOLD = 'M33 4v8h8'

const PAPER_ART: Readonly<Record<PaperArtId, ReactNode>> = {
  // Factura A: el IVA va en su propio renglón (resaltado).
  factura_a: (
    <>
      <path d={SHEET} />
      <path d={FOLD} />
      <PaperLetter>A</PaperLetter>
      <path d="M13 28h22M13 34h14" />
      <rect x="11" y="39" width="26" height="7" rx="2" stroke="none" className="fill-adm-s2/45" />
      <path d="M14 42.5h7M29 42.5h5" />
      <path d="M13 51.5h8M27 51.5h8" strokeWidth={2.6} />
    </>
  ),
  // Factura B o C: un solo total, con el IVA adentro.
  factura_bc: (
    <>
      <path d={SHEET} />
      <path d={FOLD} />
      <PaperLetter>B</PaperLetter>
      <path d="M13 28h22M13 34h14M13 40h18" />
      <path d="M13 51.5h8M27 51.5h8" strokeWidth={2.6} />
    </>
  ),
  // Tique: la tira angosta, cortada con dientes.
  tique: (
    <>
      <path d="M13 4h22v52l-3.7-2.6-3.6 2.6-3.7-2.6-3.7 2.6-3.6-2.6L13 56z" />
      <path d="M18 13h12M18 20h12M18 27h7" />
      <path d="M18 40h4M26 40h4" strokeWidth={2.6} />
    </>
  ),
  // Remito o nada: un papel a mano, sin letra ni IVA.
  sin: (
    <>
      <path d={SHEET} strokeDasharray="3.5 4" />
      <path d="M13 17h12" />
      <path d="M13 29c2.2-2.6 3.8 2.6 6 0s3.8 2.6 6 0 3.8 2.6 6 0 2.6 1.4 4 0" />
      <path d="M13 39c2.2-2.6 3.8 2.6 6 0s3.8 2.6 6 0" />
      <path d="M27 51.5h8" strokeWidth={2.6} />
    </>
  ),
  // Nota de crédito: una factura que resta.
  nota_credito: (
    <>
      <path d={SHEET} />
      <path d={FOLD} />
      <PaperLetter>NC</PaperLetter>
      <path d="M13 28h22M13 34h14" />
      <circle cx="24" cy="47" r="7" className="stroke-adm-s3" />
      <path d="M20.5 47h7" className="stroke-adm-s3" />
    </>
  ),
}

/** El dibujo de un papel. Sobre una superficie crema (toma el color del texto). */
export function PaperArt({ id, className }: { id: PaperArtId; className?: string }) {
  return (
    <Sketch viewBox="0 0 48 62" className={cn('h-16 w-auto text-foreground/75', className)}>
      {PAPER_ART[id]}
    </Sketch>
  )
}

/** Dos cosas unidas por una línea: el dibujo de «Cómo se vincula cada cosa». */
export function LinkArt({ className }: { className?: string }) {
  return (
    <Sketch viewBox="0 0 112 44" className={cn('h-12 w-auto text-foreground/75', className)}>
      <rect x="2" y="8" width="36" height="28" rx="7" />
      <path d="M10 18h20M10 25h12" />
      <rect x="74" y="8" width="36" height="28" rx="7" />
      <path d="M82 18h20M82 25h12" />
      <path
        d="M38 22C44 22 44 14 50 14S56 30 62 30 68 22 74 22"
        className="stroke-adm-s1"
        strokeWidth={2.5}
      />
      <circle cx="56" cy="22" r="3.5" stroke="none" className="fill-adm-s2" />
    </Sketch>
  )
}
