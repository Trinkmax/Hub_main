import { BadgeCheck, Info, TriangleAlert } from 'lucide-react'
import type { PadronVerification } from '@/lib/arca/queries'
import { formatDate } from '@/lib/dates'

/**
 * «Verificado en ARCA el 08/10/2026» (diseño §3.1): la última consulta de la CUIT
 * en ARCA que quedó guardada en el bar (la hace «Completar con ARCA»). Prefiere la
 * de producción; la de homologación se aclara como de prueba. Sin consulta, nada.
 * Server-safe.
 */
export function ArcaVerification({ verification }: { verification: PadronVerification | null }) {
  if (!verification) return null
  const day = formatDate(verification.fetchedAt)
  if (!day) return null

  if (verification.environment === 'homologacion') {
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span className="text-pretty">
          Consultado en el ARCA de pruebas (homologación) el {day}: no vale como verificación.
        </span>
      </p>
    )
  }
  if (!verification.found || verification.active === false) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-warning-text">
        <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
        <span className="text-pretty">
          {verification.found
            ? `ARCA dice que esta CUIT está inactiva (consulta del ${day}).`
            : `ARCA no encontró esta CUIT (consulta del ${day}). Revisá los números.`}
        </span>
      </p>
    )
  }
  return (
    <p className="flex items-start gap-1.5 text-xs text-success">
      <BadgeCheck className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>Verificado en ARCA el {day}</span>
    </p>
  )
}
