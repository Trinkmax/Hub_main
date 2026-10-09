'use client'

import { Plus, X } from 'lucide-react'
import { Amount } from '@/components/administracion/amount'
import { MoneyInput } from '@/components/administracion/money-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  BREAKDOWN_KIND_LABELS,
  breakdownTotals,
  RECURRING_BREAKDOWN_KINDS,
  type RecurringBreakdownKind,
} from '@/lib/accounting/party-profile'

export type BreakdownDraft = {
  /** Solo para React: los renglones se agregan y se quitan. */
  key: string
  label: string
  kind: RecurringBreakdownKind | null
  amountCents: number | null
}

const NO_KIND = '__sin_detallar__'
let draftSeq = 0

export function newBreakdownDraft(
  patch: Partial<Omit<BreakdownDraft, 'key'>> = {},
): BreakdownDraft {
  draftSeq += 1
  return { key: `l${draftSeq}`, label: '', kind: null, amountCents: null, ...patch }
}

/** Los renglones con algo escrito, listos para guardar (los vacíos se descartan). */
export function breakdownToSave(lines: readonly BreakdownDraft[]) {
  return lines
    .filter((l) => l.label.trim() !== '' || l.amountCents !== null)
    .map((l) => ({ label: l.label.trim(), kind: l.kind, amountCents: l.amountCents ?? 0 }))
}

/**
 * El detalle de un gasto fijo (pedido de los socios, 09/10/2026): por
 * ejemplo los sueldos, un renglón por empleado y concepto (aporte,
 * contribución, pago en blanco o en negro). El monto del gasto fijo es la suma.
 */
export function RecurringBreakdown({
  idPrefix,
  lines,
  onChange,
  error,
}: {
  idPrefix: string
  lines: readonly BreakdownDraft[]
  onChange: (next: BreakdownDraft[]) => void
  error?: string
}) {
  const update = (key: string, patch: Partial<BreakdownDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key))
  const add = () => {
    // Un empleado suele tener varios conceptos: el renglón nuevo repite el nombre del anterior.
    const last = lines[lines.length - 1]
    onChange([...lines, newBreakdownDraft({ label: last?.label ?? '' })])
  }
  const totals = breakdownTotals(
    lines
      .filter((l) => l.amountCents !== null && l.amountCents > 0)
      .map((l) => ({ label: l.label, kind: l.kind, amountCents: l.amountCents ?? 0 })),
  )

  return (
    <div className="grid gap-3">
      <ul className="grid gap-2">
        {lines.map((line, index) => {
          const n = index + 1
          return (
            <li
              key={line.key}
              className="grid gap-2 rounded-lg border border-border/70 p-2.5 sm:grid-cols-[minmax(0,1fr)_170px_150px_auto] sm:items-center sm:border-0 sm:p-0"
            >
              <Input
                id={`${idPrefix}-${line.key}-label`}
                aria-label={`A quién corresponde, renglón ${n}`}
                placeholder="Empleado o concepto"
                value={line.label}
                maxLength={60}
                autoComplete="off"
                onChange={(e) => update(line.key, { label: e.target.value })}
                className="h-11 text-base md:h-9 md:text-sm"
              />
              <Select
                value={line.kind ?? NO_KIND}
                onValueChange={(v) =>
                  update(line.key, { kind: v === NO_KIND ? null : (v as RecurringBreakdownKind) })
                }
              >
                <SelectTrigger
                  aria-label={`Concepto, renglón ${n}`}
                  className="w-full data-[size=default]:h-11 md:data-[size=default]:h-9"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_KIND} className="min-h-11 md:min-h-8">
                    Sin detallar
                  </SelectItem>
                  {RECURRING_BREAKDOWN_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind} className="min-h-11 md:min-h-8">
                      {BREAKDOWN_KIND_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <MoneyInput
                id={`${idPrefix}-${line.key}-amount`}
                aria-label={`Monto, renglón ${n}`}
                value={line.amountCents}
                onValueChange={(cents) => update(line.key, { amountCents: cents })}
                minCents={1}
                align="end"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 justify-self-end text-muted-foreground md:size-9"
                onClick={() => remove(line.key)}
                aria-label={`Quitar el renglón ${n}`}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          )
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 gap-1.5 justify-self-start md:h-8"
        onClick={add}
      >
        <Plus className="size-3.5" aria-hidden />
        Agregar renglón
      </Button>
      {totals.total > 0 ? (
        <dl className="grid gap-1 rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
          {totals.byKind.map((t) => (
            <div key={t.kind ?? 'sin'} className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">
                {t.kind ? BREAKDOWN_KIND_LABELS[t.kind] : 'Sin detallar'}
              </dt>
              <dd className="tabular-nums">
                <Amount cents={t.cents} />
              </dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-border/60 pt-1.5 font-medium">
            <dt>Total</dt>
            <dd className="tabular-nums">
              <Amount cents={totals.total} />
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  )
}
