import { useId } from 'react'
import { stampRing } from '@/lib/ticketing/ticket-art'

/**
 * El sello de la boletería sobre la entrada: «SEÑA PAGA» o «PAGADA», con la fecha
 * del pago y el nombre del bar girando alrededor.
 */
export function PaidStamp({
  tenantName,
  paidLabel,
  deposit,
  className,
}: {
  tenantName: string
  /** «03/11/2026». */
  paidLabel: string | null
  deposit: boolean
  className?: string
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const ring = stampRing(tenantName)
  return (
    <div className={`ent-seal ${className ?? ''}`} aria-hidden>
      <svg viewBox="0 0 120 120" className="block size-full" fill="currentColor" aria-hidden="true">
        <defs>
          <path id={id} d="M60 60m-47 0a47 47 0 1 1 94 0a47 47 0 1 1-94 0" />
        </defs>
        <circle cx="60" cy="60" r="57" fill="none" stroke="currentColor" strokeWidth="2.6" />
        <circle cx="60" cy="60" r="38.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <text
          fontFamily="ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace"
          fontSize="9.5"
          fontWeight="700"
        >
          <textPath href={`#${id}`} textLength="292" lengthAdjust="spacing">
            {ring}
          </textPath>
        </text>
        <g
          textAnchor="middle"
          fontFamily="ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace"
          fontWeight="800"
        >
          {deposit ? (
            <>
              <text x="60" y="53" fontSize="17" letterSpacing="1.2">
                SEÑA
              </text>
              <text x="60" y="71" fontSize="17" letterSpacing="1.2">
                PAGA
              </text>
            </>
          ) : (
            <text x="60" y="66" fontSize="15" letterSpacing="0.6">
              PAGADA
            </text>
          )}
          {paidLabel ? (
            <text x="60" y="84" fontSize="7" fontWeight="700" letterSpacing="0.6">
              {paidLabel}
            </text>
          ) : null}
        </g>
      </svg>
    </div>
  )
}

/**
 * El sello de goma de la boletería, de costado: baja, golpea y se va, y deja la
 * marca de `PaidStamp`. Solo aparece en la función (ver ticket-show.ts).
 */
export function RubberStamper() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <div className="ent-stamper" aria-hidden>
      <svg viewBox="0 0 128 160" className="block size-full" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}w`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#c08a55" />
            <stop offset="0.42" stopColor="#94622f" />
            <stop offset="1" stopColor="#573518" />
          </linearGradient>
          <linearGradient id={`${id}m`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#59605b" />
            <stop offset="0.4" stopColor="#262c28" />
            <stop offset="1" stopColor="#141815" />
          </linearGradient>
        </defs>
        <ellipse cx="64" cy="30" rx="27" ry="25" fill={`url(#${id}w)`} />
        <ellipse cx="55" cy="20" rx="10" ry="6.5" fill="#fff" opacity="0.24" />
        <path d="M49 50C52 66 50 78 41 92H87C78 78 76 66 79 50Z" fill={`url(#${id}w)`} />
        <rect x="31" y="90" width="66" height="13" rx="4" fill={`url(#${id}m)`} />
        <rect x="6" y="102" width="116" height="30" rx="7" fill={`url(#${id}w)`} />
        <rect x="6" y="102" width="116" height="7" rx="3.5" fill="#fff" opacity="0.14" />
        <rect x="10" y="132" width="108" height="11" rx="3" fill="#7a2d1c" />
      </svg>
    </div>
  )
}
