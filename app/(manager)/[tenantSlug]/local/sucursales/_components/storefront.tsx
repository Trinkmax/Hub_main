import { type CSSProperties, useId } from 'react'
import { inkOn } from '@/lib/floor-plan/branches'
import { LIGHT_INK } from '@/lib/pos/branches/palette'
import { cn } from '@/lib/utils'
import './sucursales.css'

/**
 * La vidriera de una sucursal: su cartel y su toldo llevan su color (el mismo que después se
 * ve arriba en el salón y en la tele) y la persiana está tan levantada como avanzada está su
 * lista de apertura. Abrir un local es levantar la persiana.
 *
 * Es un dibujo: lo que dice (cómo se llama, cuánto le falta) está escrito al lado, así que va
 * oculto para los lectores de pantalla.
 *
 * - `open`: de 0 (persiana baja) a 1 (levantada del todo): pasos hechos sobre pasos que cuentan.
 * - `size="mini"`: la misma vidriera, sin letras ni detalles, para la lista de sucursales.
 * - `muted`: una sucursal desactivada (persiana baja, candado y el frente sin color).
 */

const W = 220
const H = 176

/** El vano: lo que tapa la persiana. */
const BAY = { x: 40, y: 92, w: 140, h: 70 }
const GROUND = BAY.y + BAY.h

const STRIPES = 9
const AWNING = { top: 46, bottom: 76, topLeft: 14, topRight: 206, bottomLeft: 6, bottomRight: 214 }

const DARK_INK = '#16241e'

function stripes() {
  const topStep = (AWNING.topRight - AWNING.topLeft) / STRIPES
  const bottomStep = (AWNING.bottomRight - AWNING.bottomLeft) / STRIPES
  return Array.from({ length: STRIPES }, (_, index) => {
    const t0 = AWNING.topLeft + index * topStep
    const t1 = t0 + topStep
    const b0 = AWNING.bottomLeft + index * bottomStep
    const b1 = b0 + bottomStep
    return {
      index,
      tinted: index % 2 === 0,
      // El paño y, colgando, su onda del volado.
      cloth: `M${t0} ${AWNING.top}H${t1}L${b1} ${AWNING.bottom}H${b0}Z`,
      scallop: `M${b0} ${AWNING.bottom}H${b1}Q${(b0 + b1) / 2} ${AWNING.bottom + 13} ${b0} ${AWNING.bottom}Z`,
    }
  })
}

const STRIPE_SHAPES = stripes()

function slats(pitch: number): string {
  let d = ''
  for (let y = BAY.y + pitch; y < GROUND - 6; y += pitch) d += `M${BAY.x} ${y}H${BAY.x + BAY.w}`
  return d
}

/** El tamaño de la letra del cartel: lo más grande que entra con ese nombre. */
function signFontSize(label: string): number {
  const fit = 176 / (0.6 * Math.max(label.length, 1))
  return Math.round(Math.max(13, Math.min(22, fit)) * 10) / 10
}

export function Storefront({
  label,
  color,
  open,
  size = 'hero',
  muted = false,
  principal = false,
  className,
}: {
  /** Lo que dice el cartel: el nombre corto de la sucursal. */
  label: string
  /** `#rrggbb`. */
  color: string
  open: number
  size?: 'hero' | 'mini'
  muted?: boolean
  principal?: boolean
  className?: string
}) {
  const clipId = useId()
  const glowId = useId()
  const mini = size === 'mini'
  const level = muted ? 0 : Math.min(1, Math.max(0, Number.isFinite(open) ? open : 0))
  const style = {
    '--sf-branch': color,
    '--sf-on': inkOn(color) === 'light' ? LIGHT_INK : DARK_INK,
    '--sf-open': level,
  } as CSSProperties
  const hairline = { vectorEffect: 'non-scaling-stroke' as const, strokeWidth: 1 }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      focusable="false"
      data-size={size}
      data-muted={muted ? '' : undefined}
      data-open={level}
      className={cn('sf', className)}
      style={style}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={BAY.x} y={BAY.y} width={BAY.w} height={BAY.h} />
        </clipPath>
        <linearGradient id={glowId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sf-glow)" />
          <stop offset="1" stopColor="var(--sf-glow-deep)" />
        </linearGradient>
      </defs>

      {/* La vereda. */}
      <rect x="2" y={GROUND} width={W - 4} height="9" rx="2" fill="var(--sf-ground)" />

      <g className="sf-front">
        {/* La pared. */}
        <rect
          x="18"
          y="42"
          width="184"
          height={GROUND - 42}
          fill="var(--sf-wall)"
          stroke="var(--sf-wall-edge)"
          {...hairline}
        />

        {/* Adentro: la luz prendida, la barra y dos lámparas. Lo tapa la persiana. */}
        <rect x={BAY.x} y={BAY.y} width={BAY.w} height={BAY.h} fill={`url(#${glowId})`} />
        {mini ? null : (
          <g clipPath={`url(#${clipId})`}>
            <g fill="var(--sf-lamp)" stroke="var(--sf-shape)" strokeWidth="0.75">
              <path d="M70 92V104" fill="none" />
              <path d="M62 111Q70 99 78 111Z" />
              <path d="M104 92V100" fill="none" />
              <path d="M96 107Q104 95 112 107Z" />
            </g>
            <g fill="var(--sf-shape)">
              {/* Estante con botellas. */}
              <rect x="50" y="127" width="62" height="1.5" />
              <rect x="56" y="118" width="4" height="9" rx="1" />
              <rect x="64" y="115" width="4" height="12" rx="1" />
              <rect x="72" y="120" width="4" height="7" rx="1" />
              <rect x="88" y="116" width="4" height="11" rx="1" />
              <rect x="96" y="119" width="4" height="8" rx="1" />
              {/* La barra y dos banquetas. */}
              <rect x="46" y="140" width="80" height="3.5" rx="1" />
              <rect x="50" y="143.5" width="72" height="18.5" opacity="0.55" />
              <path d="M60 150h12v2.5h-4.6V162h-2.8v-9.5H60z" />
              <path d="M96 150h12v2.5h-4.6V162h-2.8v-9.5H96z" />
            </g>
            {/* La puerta de vidrio. */}
            <path d="M136 92V162" stroke="var(--sf-line-strong)" {...hairline} />
            <rect x="141" y="124" width="2.5" height="11" rx="1.25" fill="var(--sf-shape)" />
          </g>
        )}

        {/* La persiana. */}
        <g clipPath={`url(#${clipId})`}>
          <g className="sf-shutter">
            <rect x={BAY.x} y={BAY.y} width={BAY.w} height={BAY.h} fill="var(--sf-metal)" />
            <path d={slats(mini ? 14 : 5)} stroke="var(--sf-metal-line)" {...hairline} />
            <rect x={BAY.x} y={GROUND - 6} width={BAY.w} height="6" fill="var(--sf-metal-dark)" />
            {muted && !mini ? (
              // El candado de una sucursal que no se usa.
              <g transform={`translate(${BAY.x + BAY.w / 2} ${GROUND - 21})`}>
                <path
                  d="M-4.5 0V-4a4.5 4.5 0 0 1 9 0V0"
                  fill="none"
                  stroke="var(--sf-metal-dark)"
                  strokeWidth="2.2"
                />
                <rect x="-7" y="0" width="14" height="11" rx="2.2" fill="var(--sf-metal-dark)" />
              </g>
            ) : null}
          </g>
        </g>
        {/* El marco del vano y el tambor donde se enrolla la persiana. */}
        <rect
          x={BAY.x}
          y={BAY.y}
          width={BAY.w}
          height={BAY.h}
          fill="none"
          stroke="var(--sf-line-strong)"
          {...hairline}
        />
        <rect
          x={BAY.x - 4}
          y={BAY.y - 7}
          width={BAY.w + 8}
          height="7"
          rx="2"
          fill="var(--sf-metal-dark)"
        />

        {/* El toldo: una franja del color de la sucursal, una crema. */}
        <rect x="18" y={AWNING.bottom} width="184" height="9" fill="var(--sf-line)" opacity="0.5" />
        {STRIPE_SHAPES.map((stripe) => (
          <g
            key={stripe.index}
            className={stripe.tinted ? 'sf-branch' : undefined}
            fill={stripe.tinted ? undefined : 'var(--sf-cream)'}
          >
            <path d={stripe.cloth} />
            <path d={stripe.scallop} />
          </g>
        ))}
        <path
          d={`M${AWNING.topLeft} ${AWNING.top}H${AWNING.topRight}L${AWNING.bottomRight} ${AWNING.bottom}H${AWNING.bottomLeft}Z`}
          fill="none"
          stroke="var(--sf-line)"
          {...hairline}
        />

        {/* El cartel. */}
        <rect
          className="sf-branch"
          x="10"
          y="5"
          width="200"
          height="38"
          rx="5"
          stroke="var(--sf-sign-edge)"
          {...hairline}
        />
        {mini ? null : (
          <>
            <rect
              className="sf-sign-rule"
              x="14"
              y="9"
              width="192"
              height="30"
              rx="3"
              {...hairline}
            />
            <text
              className="sf-sign-text"
              x={W / 2}
              y="24.5"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={signFontSize(label)}
            >
              {label}
            </text>
          </>
        )}

        {mini ? null : (
          <>
            {/* Una planta y la pizarra de la vereda. */}
            <g>
              <path
                d="M27 150c-5-6-5-13-1-17 3 4 4 10 1 17zm0 0c-1-8 2-14 7-16 1 6-1 12-7 16zm0 0c-6-2-9-7-9-12 5 1 8 5 9 12z"
                fill="var(--sf-leaf)"
              />
              <path d="M21 150h12l-1.6 12h-8.8z" fill="var(--sf-pot)" />
            </g>
            <g>
              <path d="M190 162l4-21h8l4 21z" fill="var(--sf-shape)" />
              <path
                d="M194.5 147h7M193.8 151.5h8.4M193 156h6"
                stroke="var(--sf-cream)"
                strokeWidth="1"
                opacity="0.8"
              />
            </g>
          </>
        )}
      </g>

      {principal && !mini ? (
        // La principal lleva su estrella en la punta del cartel.
        <g transform="translate(14 9)">
          <circle r="9.5" fill="var(--sf-lamp)" stroke="var(--sf-wall)" strokeWidth="2" />
          <path
            d="M0-5.4l1.6 3.3 3.6.5-2.6 2.5.6 3.6L0 2.8l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z"
            fill="oklch(0.27 0.045 165)"
          />
        </g>
      ) : null}
    </svg>
  )
}
