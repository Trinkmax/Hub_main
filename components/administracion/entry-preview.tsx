'use client'

import { ChevronDown, CircleAlert, CircleCheck } from 'lucide-react'
import { useId, useState } from 'react'
import { balanceStatus, sumSides } from '@/lib/accounting/balance'
import { formatIsoDay } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'

/** Una línea del asiento. Compatible con `EntryPreviewLine` de `@/lib/accounting`. */
export type EntryPreviewLineData = {
  id: string
  accountCode: string
  accountName: string
  partyName?: string | null
  debitCents: number | null
  creditCents: number | null
  note?: string | null
}

/** Un asiento. Compatible con `EntryPreview` de `@/lib/accounting` (`toEntryPreview(bundle, ctx)`). */
export type EntryPreviewData = {
  /** Clave estable (`documentRef` del motor, o el id del asiento guardado). */
  documentRef: string
  description?: string | null
  /** `yyyy-MM-dd`. */
  date?: string | null
  lines: readonly EntryPreviewLineData[]
}

export type EntryPreviewProps = {
  /** Uno o más asientos (un bundle puede generar varios: compra + pago). */
  entries: readonly EntryPreviewData[]
  /** Texto del botón cuando está plegado. Default «Ver asiento». */
  label?: string
  /** Desplegado de entrada (compu, asiento manual). Default `false`: plata primero. */
  defaultOpen?: boolean
  /** Sin botón: siempre desplegado (detalle de un comprobante ya guardado). */
  alwaysOpen?: boolean
  /** Lo que se ve si todavía no hay importes. */
  emptyText?: string
  className?: string
}

const NUMBER = { currency: false } as const

/**
 * «Ver asiento»: Cuenta · Debe · Haber, con el sello «Cuadra» o «No cuadra ·
 * diferencia $ X» siempre a la vista. El sello vive en un `role="status"`
 * estable que solo cambia de texto al pasar de cuadra a no cuadra (no habla en
 * cada tecla); la diferencia va aparte, sin anunciar. Las sumas son en BigInt
 * (`sumSides`): lo que se ve es lo que la base va a aceptar.
 */
export function EntryPreview({
  entries,
  label = 'Ver asiento',
  defaultOpen = false,
  alwaysOpen = false,
  emptyText = 'Completá los importes para ver el asiento.',
  className,
}: EntryPreviewProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const expanded = alwaysOpen || open

  // Cada asiento tiene que cuadrar solo: dos descuadres opuestos no se compensan.
  const perEntry = entries.map((e) => ({
    diff: sumSides(e.lines).diff,
    status: balanceStatus(e.lines),
  }))
  const status = perEntry.some((p) => p.status === 'unbalanced')
    ? 'unbalanced'
    : perEntry.some((p) => p.status === 'balanced')
      ? 'balanced'
      : 'empty'
  const unbalanced = perEntry.reduce((acc, p) => acc + (p.diff < 0n ? -p.diff : p.diff), 0n)

  return (
    <section
      aria-label="Asiento contable"
      className={cn('card-hairline rounded-xl border border-border/70 bg-card', className)}
    >
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-2">
        {alwaysOpen ? (
          <h3 className="font-display text-sm font-semibold tracking-tight">Asiento</h3>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-[var(--duration-fast)]',
                !open && '-rotate-90',
              )}
            />
            {open ? 'Ocultar asiento' : label}
          </button>
        )}
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
            status === 'balanced' && 'border-success/30 bg-success/10 text-success',
            status === 'unbalanced' && 'border-destructive/30 bg-destructive/10 text-destructive',
            status === 'empty' && 'border-border bg-secondary/50 text-muted-foreground',
          )}
        >
          {status === 'balanced' ? (
            <CircleCheck aria-hidden="true" className="size-3.5" />
          ) : status === 'unbalanced' ? (
            <CircleAlert aria-hidden="true" className="size-3.5" />
          ) : null}
          {/* Región estable: su texto cambia solo cuando cambia el estado. */}
          <span role="status" aria-live="polite">
            {status === 'balanced'
              ? 'Cuadra'
              : status === 'unbalanced'
                ? 'No cuadra'
                : 'Sin importes'}
          </span>
          {status === 'unbalanced' ? (
            <span className="tabular-nums">· diferencia {formatCents(unbalanced)}</span>
          ) : null}
        </span>
      </div>

      <div id={panelId} hidden={!expanded} className="border-t border-border/60">
        {status === 'empty' ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          entries.map((entry) => (
            <EntryTable key={entry.documentRef} entry={entry} multiple={entries.length > 1} />
          ))
        )}
      </div>
    </section>
  )
}

function EntryTable({ entry, multiple }: { entry: EntryPreviewData; multiple: boolean }) {
  const sums = sumSides(entry.lines)
  // Como en el libro diario: primero el Debe, después el Haber (con sangría y «a»).
  const debits = entry.lines.filter((l) => (l.debitCents ?? 0) !== 0)
  const credits = entry.lines.filter((l) => (l.debitCents ?? 0) === 0 && (l.creditCents ?? 0) !== 0)
  const caption = [entry.description, entry.date ? formatIsoDay(entry.date) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={cn(multiple && 'border-b border-border/60 last:border-b-0')}>
      {multiple && caption ? (
        <p className="px-4 pt-3 text-xs font-medium text-muted-foreground">{caption}</p>
      ) : null}
      <table className="w-full text-sm">
        <caption className="sr-only">{caption || 'Asiento'}</caption>
        <thead className="text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 pt-3 pb-1.5 font-semibold">
              Cuenta
            </th>
            <th scope="col" className="w-24 px-2 pt-3 pb-1.5 text-right font-semibold sm:w-32">
              Debe
            </th>
            <th scope="col" className="w-24 px-4 pt-3 pb-1.5 text-right font-semibold sm:w-32">
              Haber
            </th>
          </tr>
        </thead>
        <tbody>
          {[...debits, ...credits].map((line) => {
            const isCredit = (line.debitCents ?? 0) === 0
            return (
              <tr key={line.id} className="align-top">
                <td className={cn('px-4 py-1.5', isCredit && 'pl-8')}>
                  <span className="flex flex-wrap items-baseline gap-x-1.5">
                    {isCredit ? <span className="text-muted-foreground">a</span> : null}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {line.accountCode}
                    </span>
                    <span>{line.accountName}</span>
                  </span>
                  {line.partyName || line.note ? (
                    <span className="block text-xs text-muted-foreground">
                      {[line.partyName, line.note].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                  {isCredit ? '' : formatCents(line.debitCents, NUMBER)}
                  {isCredit ? null : <span className="sr-only"> en el Debe</span>}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap">
                  {isCredit ? formatCents(line.creditCents, NUMBER) : ''}
                  {isCredit ? <span className="sr-only"> en el Haber</span> : null}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="font-semibold">
          <tr className="border-t border-border/80">
            <td className="px-4 py-2 text-xs text-muted-foreground">
              {sums.diff === 0n ? 'Debe = Haber' : 'Totales'}
            </td>
            <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
              {formatCents(sums.debit, NUMBER)}
            </td>
            <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
              {formatCents(sums.credit, NUMBER)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
