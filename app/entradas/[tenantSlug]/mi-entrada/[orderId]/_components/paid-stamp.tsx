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
