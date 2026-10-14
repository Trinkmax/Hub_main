import { ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { Panel } from '@/components/administracion/kit/panel'
import { PanelError } from '@/components/administracion/kit/panel-states'
import { RetryButton } from '@/components/administracion/kit/retry-button'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Button } from '@/components/ui/button'
import type { ClosedPeriodCheckRow, IntegrityCheckRow } from '@/lib/accounting/queries/periods'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'

/** Las ocho revisiones de A.6, dichas en palabras. */
const CHECK_LABELS: Readonly<Record<string, string>> = {
  entries_balanced: 'Cada asiento cuadra: el Debe es igual al Haber.',
  documents_match_entries: 'Cada comprobante coincide con su asiento.',
  allocations_valid: 'Ningún pago o cobro aplicado supera lo que se debía.',
  fiscal_vouchers_reconcile: 'Los libros de IVA coinciden con los comprobantes.',
  iva_books_match_ledger: 'El IVA de los libros coincide con el de las cuentas.',
  closed_periods_intact: 'Los meses cerrados están numerados y no cambiaron.',
  entries_within_dates: 'No hay asientos antes del inicio de los libros ni fuera de su mes.',
  entries_period_kind: 'Cada asiento está en el período que le corresponde.',
}

function checkLabel(key: string): string {
  return CHECK_LABELS[key] ?? `Revisión «${key}».`
}

/** Cuántos casos no cierran, si la base lo dice. */
function issueCount(detail: Readonly<Record<string, unknown>> | null): number | null {
  if (!detail) return null
  let total = 0
  let found = false
  for (const key of ['count', 'over_allocated_count', 'unnumbered_count', 'numbering_issues']) {
    const value = detail[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value
      found = true
    }
  }
  return found ? total : null
}

/** Un renglón de la revisión: qué se miró y, a la derecha, si cierra. */
function CheckRow({ ok, text, count }: { ok: boolean; text: string; count?: number | null }) {
  return (
    <li className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <span className="min-w-0 text-sm text-pretty">
        {text}
        {count !== null && count !== undefined ? (
          <span className="block text-xs text-muted-foreground">
            {count} {count === 1 ? 'caso' : 'casos'} para revisar.
          </span>
        ) : null}
      </span>
      <StatusPill tone={ok ? 'ok' : 'late'}>{ok ? 'Bien' : 'No cierra'}</StatusPill>
    </li>
  )
}

/**
 * Ajustes › Integridad (H.17, F.14): [Verificar] corre las revisiones de la
 * base y la de los meses cerrados. «Todo en orden» o la lista de lo que no
 * cierra. Es zona de la contadora y de soporte: los textos son los de siempre.
 * «Verificar» es una lectura, así que también lo ve quien solo lee.
 * Server-safe.
 */
export function IntegrityPanel({
  verifyHref,
  ran,
  checks,
  closed,
}: {
  verifyHref: string
  /** Se pidió la verificación (`?verificar=1`). */
  ran: boolean
  checks: QueryOutcome<IntegrityCheckRow[]> | null
  closed: QueryOutcome<ClosedPeriodCheckRow[]> | null
}) {
  if (!ran || !checks || !closed) {
    return (
      <Panel
        title="Revisar que todo cierre"
        description="Recorre los asientos, los comprobantes, los libros de IVA y los meses cerrados para confirmar que todo coincide. Tarda unos segundos."
      >
        <Button asChild className="h-11 gap-2 px-5">
          <Link href={verifyHref} scroll={false}>
            <ShieldCheck className="size-4" aria-hidden />
            Verificar
          </Link>
        </Button>
      </Panel>
    )
  }

  if (!checks.ok || !closed.ok) {
    return (
      <PanelError
        title="Revisar que todo cierre"
        message={!checks.ok ? checks.message : !closed.ok ? closed.message : ''}
        retryLabel="Verificar de nuevo"
      />
    )
  }

  const failing = checks.data.filter((c) => !c.ok)
  const changed = closed.data.filter((p) => !p.ok)
  const allGood = failing.length === 0 && changed.length === 0

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3" role="status">
        <p className="flex min-w-0 items-center gap-3 font-serif text-3xl leading-tight font-semibold tracking-tight text-balance">
          {allGood ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="size-8 shrink-0 text-success"
            >
              <circle cx="12" cy="12" r="10.25" stroke="currentColor" strokeWidth="1.5" />
              <path
                className="adm-tick adm-tick-draw"
                d="M7 12.5l3.5 3.5L17 8.5"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
          {allGood ? 'Todo en orden.' : 'Hay cosas que no cierran.'}
        </p>
        <RetryButton label="Verificar de nuevo" />
      </div>
      <ul className="mt-5 divide-y divide-border/60">
        {checks.data.map((c) => (
          <CheckRow
            key={c.checkKey}
            ok={c.ok}
            text={checkLabel(c.checkKey)}
            count={c.ok ? null : issueCount(c.detail)}
          />
        ))}
        {closed.data.length > 0 ? (
          <CheckRow
            ok={changed.length === 0}
            text={
              changed.length > 0
                ? `Cambió después de cerrarse: ${changed.map((p) => p.label).join(', ')}.`
                : closed.data.length === 1
                  ? 'El mes cerrado está igual que cuando se cerró.'
                  : `Los ${closed.data.length} meses cerrados están igual que cuando se cerraron.`
            }
          />
        ) : null}
      </ul>
      {allGood ? null : (
        <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground text-pretty">
          Si algo no cierra, avisanos: no lo corrijas cargando comprobantes nuevos.
        </p>
      )}
    </Panel>
  )
}
