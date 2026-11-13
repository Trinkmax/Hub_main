/**
 * Símbolos del plano, dibujados como en un plano de verdad (vistos desde
 * arriba) y con un solo trazo. Se usan en la paleta y en el selector de forma:
 * lo que se toca se parece a lo que va a aparecer en el piso.
 */

type GlyphProps = { className?: string }

/** El marco común: 24 × 24, trazo redondeado, decorativo (el texto del botón dice qué es). */
function Glyph({
  className,
  strokeWidth = 1.75,
  children,
}: GlyphProps & { strokeWidth?: number; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

const soft = { fill: 'currentColor', fillOpacity: 0.14 } as const

/** Mesa cuadrada con una silla por lado. */
export function TableGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect x="7" y="7" width="10" height="10" rx="2" {...soft} />
      <path d="M9.75 3.6h4.5M9.75 20.4h4.5M3.6 9.75v4.5M20.4 9.75v4.5" />
    </Glyph>
  )
}

/** Mesa redonda. */
export function RoundTableGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <circle cx="12" cy="12" r="5.25" {...soft} />
      <path d="M9.75 3.4h4.5M9.75 20.6h4.5M3.4 9.75v4.5M20.6 9.75v4.5" />
    </Glyph>
  )
}

/** Mesa rectangular: dos sillas por lado largo. */
export function LongTableGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect x="3.5" y="8" width="17" height="8" rx="2" {...soft} />
      <path d="M6.5 4.6h3.5M14 4.6h3.5M6.5 19.4h3.5M14 19.4h3.5" />
    </Glyph>
  )
}

/** Banquette: respaldo contra la pared y sillas de un solo lado. */
export function BanquetteGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M3.5 5.5h17" strokeWidth={3} />
      <rect x="3.5" y="8.5" width="17" height="6.5" rx="1.75" {...soft} />
      <path d="M5.75 18.6h3M10.5 18.6h3M15.25 18.6h3" />
    </Glyph>
  )
}

/** Varias mesas en grilla. */
export function TablesGridGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" {...soft} />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" {...soft} />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" {...soft} />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" {...soft} />
    </Glyph>
  )
}

/** Barra con sus banquetas. */
export function BarGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect x="2.75" y="6" width="18.5" height="6.5" rx="2" {...soft} />
      <circle cx="6" cy="17" r="1.5" />
      <circle cx="10" cy="17" r="1.5" />
      <circle cx="14" cy="17" r="1.5" />
      <circle cx="18" cy="17" r="1.5" />
    </Glyph>
  )
}

/** Pared: un tramo macizo. */
export function WallGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect
        x="2.75"
        y="9.75"
        width="18.5"
        height="4.5"
        rx="1"
        fill="currentColor"
        fillOpacity={0.3}
      />
    </Glyph>
  )
}

/** Columna. */
export function PillarGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <circle cx="12" cy="12" r="5" fill="currentColor" fillOpacity={0.3} />
    </Glyph>
  )
}

/** Isla: un mueble suelto (mostrador, estación, cantero). */
export function IslandGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect x="4.5" y="6.5" width="15" height="11" rx="3" {...soft} />
    </Glyph>
  )
}

/** Puerta: la hoja y su barrido, como en un plano. */
export function DoorGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 19h3.5M17.75 19h3.5" strokeWidth={2.5} />
      <path d="M6.25 19V7.5" />
      <path d="M6.25 7.5A11.5 11.5 0 0 1 17.75 19" strokeDasharray="1.5 2.6" />
    </Glyph>
  )
}

/** Escenario: la tarima y su frente. */
export function StageGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect x="3.5" y="5.5" width="17" height="9.5" rx="1.75" {...soft} />
      <path d="M6 18.5h12" />
    </Glyph>
  )
}

/** Texto: un cartel sobre el piso. */
export function TextGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M4 18 8.25 6.5 12.5 18M5.6 14h5.3" />
      <path d="M19.75 18v-5.25a2.4 2.4 0 0 0-4.8 0v2.85a2.4 2.4 0 0 0 4.8 0" />
    </Glyph>
  )
}

/** La maqueta: una caja en tres cuartos (el mismo símbolo que usa el salón). */
export function ModelGlyph({ className }: GlyphProps) {
  return (
    <Glyph strokeWidth={2} className={className}>
      <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </Glyph>
  )
}

/** El plano: una hoja con la planta dibujada. */
export function PlanGlyph({ className }: GlyphProps) {
  return (
    <Glyph strokeWidth={2} className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <rect x="7" y="8" width="4" height="4" rx="1" />
      <path d="M14.5 8.5h2.5M14.5 12h2.5M7 15.5h10" />
    </Glyph>
  )
}

/** Plano y maqueta, lado a lado. */
export function SplitGlyph({ className }: GlyphProps) {
  return (
    <Glyph strokeWidth={2} className={className}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M12 4.5v15" />
      <path d="M14.75 13.5 17 12.25l2.25 1.25v2.5L17 17.25 14.75 16v-2.5Z" strokeWidth={1.5} />
      <rect x="5.5" y="9" width="3.5" height="3.5" rx="0.75" strokeWidth={1.5} />
    </Glyph>
  )
}

/** El primer sector: un piso todavía en punteado, con una mesa por ubicar. */
export function EmptyFloorArt({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 152 96" fill="none" aria-hidden="true" className={className}>
      <path
        d="M30 30 104 14a6 6 0 0 1 6.6 3.4L134 62a6 6 0 0 1-4.3 8.3L54 86a6 6 0 0 1-6.6-3.4L24.5 37.7A6 6 0 0 1 30 30Z"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeDasharray="5 6"
        strokeLinecap="round"
      />
      <path
        d="m62 44 22-4.6a3 3 0 0 1 3.4 1.8l6 13.4a3 3 0 0 1-2.2 4.1L69 63.5a3 3 0 0 1-3.4-1.8l-5.9-13.6A3 3 0 0 1 62 44Z"
        fill="currentColor"
        fillOpacity="0.92"
      />
      <path
        d="M69 63.5v6.5M91.2 58.7v6.3"
        stroke="currentColor"
        strokeOpacity="0.7"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="m66 37 9-1.9M92 64.5l-9 2M55.5 52l3.6 8.2M96.5 43.5l3.5 8"
        stroke="currentColor"
        strokeOpacity="0.6"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
