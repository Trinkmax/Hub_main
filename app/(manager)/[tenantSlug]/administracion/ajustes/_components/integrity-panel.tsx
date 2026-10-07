import { CircleAlert, CircleCheck, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { ClosedPeriodCheckRow, IntegrityCheckRow } from '@/lib/accounting/queries/periods'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import { cn } from '@/lib/utils'
import { RetryButton } from '../../_resumen/retry-button'
import { Callout } from './form-bits'

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

/**
 * Ajustes › Integridad (H.17, F.14): [Verificar] corre las revisiones de la
 * base y la de los meses cerrados. «Todo en orden» o la lista de lo que no
 * cierra. Server-safe.
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
      <section className="card-hairline space-y-4 rounded-xl border bg-card p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div className="space-y-1">
            <h3 className="font-serif text-lg font-semibold tracking-tight">
              Revisar que todo cierre
            </h3>
            <p className="text-sm text-muted-foreground text-pretty">
              Recorre los asientos, los comprobantes, los libros de IVA y los meses cerrados para
              confirmar que todo coincide. Tarda unos segundos.
            </p>
          </div>
        </div>
        <Button asChild className="h-11 md:h-9">
          <Link href={verifyHref} scroll={false}>
            Verificar
          </Link>
        </Button>
      </section>
    )
  }

  if (!checks.ok || !closed.ok) {
    return (
      <Callout tone="error" action={<RetryButton label="Verificar de nuevo" />}>
        {!checks.ok ? checks.message : !closed.ok ? closed.message : null}
      </Callout>
    )
  }

  const failing = checks.data.filter((c) => !c.ok)
  const changed = closed.data.filter((p) => !p.ok)
  const allGood = failing.length === 0 && changed.length === 0

  return (
    <div className="space-y-4">
      <section className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5" role="status">
            {allGood ? (
              <CircleCheck className="size-5 shrink-0 text-success" aria-hidden />
            ) : (
              <CircleAlert className="size-5 shrink-0 text-destructive" aria-hidden />
            )}
            <h3 className="font-serif text-lg font-semibold tracking-tight">
              {allGood ? 'Todo en orden.' : 'Hay cosas que no cierran.'}
            </h3>
          </div>
          <RetryButton label="Verificar de nuevo" />
        </header>
        <ul className="divide-y divide-border/60">
          {checks.data.map((c) => {
            const count = c.ok ? null : issueCount(c.detail)
            return (
              <li key={c.checkKey} className="flex items-start gap-2.5 px-5 py-3 text-sm">
                {c.ok ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                )}
                <span className={cn('min-w-0 text-pretty', !c.ok && 'text-destructive')}>
                  {checkLabel(c.checkKey)}
                  <span className="sr-only">{c.ok ? ' Bien.' : ' No cierra.'}</span>
                  {count !== null ? (
                    <span className="block text-xs text-muted-foreground">
                      {count} {count === 1 ? 'caso' : 'casos'} para revisar.
                    </span>
                  ) : null}
                </span>
              </li>
            )
          })}
          {closed.data.length > 0 ? (
            <li className="flex items-start gap-2.5 px-5 py-3 text-sm">
              {changed.length === 0 ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              )}
              <span className={cn('min-w-0 text-pretty', changed.length > 0 && 'text-destructive')}>
                {changed.length > 0
                  ? `Cambió después de cerrarse: ${changed.map((p) => p.label).join(', ')}.`
                  : closed.data.length === 1
                    ? 'El mes cerrado está igual que cuando se cerró.'
                    : `Los ${closed.data.length} meses cerrados están igual que cuando se cerraron.`}
              </span>
            </li>
          ) : null}
        </ul>
      </section>
      {allGood ? null : (
        <p className="text-xs text-muted-foreground text-pretty">
          Si algo no cierra, avisanos: no lo corrijas cargando comprobantes nuevos.
        </p>
      )}
    </div>
  )
}
