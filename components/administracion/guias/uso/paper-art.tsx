import type { ReactNode } from 'react'
import type { PaperId } from '@/lib/accounting/guides'
import { cn } from '@/lib/utils'

/**
 * Los dibujos de la guía, hechos a mano en SVG (server-safe): los papeles de «Con factura y sin
 * factura» y la unión de «Cómo se vincula». Todos con el mismo trazo (2 px, puntas redondas) para
 * que se lean como una sola mano. Son decorativos: lo que enseñan está escrito al lado.
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
