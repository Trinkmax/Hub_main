'use client'

import { Plus, X } from 'lucide-react'
import { Amount } from '@/components/administracion/amount'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { MoneyInput } from '@/components/administracion/money-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  BREAKDOWN_KIND_LABELS,
  breakdownTotals,
  RECURRING_BREAKDOWN_KINDS,
  type RecurringBreakdownKind,
} from '@/lib/accounting/party-profile'
import { type BreakdownDraft, newBreakdownDraft } from '../_lib/form-payload'

// El borrador del detalle y lo que se guarda viven con el resto del envío de la ficha.
export { type BreakdownDraft, breakdownToSave, newBreakdownDraft } from '../_lib/form-payload'

const NO_KIND = 'sin_detallar'
type KindChoice = RecurringBreakdownKind | typeof NO_KIND

/** Las opciones de concepto: «Sin detallar» y las cuatro de siempre (los rótulos salen de `party-profile`). */
const KIND_OPTIONS: ReadonlyArray<{ value: KindChoice; label: string }> = [
  { value: NO_KIND, label: 'Sin detallar' },
  ...RECURRING_BREAKDOWN_KINDS.map((kind) => ({ value: kind, label: BREAKDOWN_KIND_LABELS[kind] })),
]

/**
 * El detalle de un gasto fijo (pedido de los socios, 09/10/2026): por ejemplo
 * los sueldos, un renglón por persona y por concepto. El monto del gasto fijo
 * pasa a ser la suma. El concepto se elige con píldoras (antes, un desplegable
 * por renglón); guarda los mismos valores.
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
    // Una persona suele tener varios conceptos: el renglón nuevo repite el nombre del anterior.
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
      <ul className="grid gap-2.5">
        {lines.map((line, index) => {
          const n = index + 1
          return (
            <li key={line.key} className="grid gap-2.5 rounded-xl bg-secondary/50 p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
                <Input
                  id={`${idPrefix}-${line.key}-label`}
                  aria-label={`A quién corresponde, renglón ${n}`}
                  placeholder="Persona o concepto"
                  value={line.label}
                  maxLength={60}
                  autoComplete="off"
                  onChange={(e) => update(line.key, { label: e.target.value })}
                  className="h-11 bg-card text-base md:text-sm"
                />
                <MoneyInput
                  id={`${idPrefix}-${line.key}-amount`}
                  aria-label={`Monto, renglón ${n}`}
                  value={line.amountCents}
                  onValueChange={(cents) => update(line.key, { amountCents: cents })}
                  minCents={1}
                  align="end"
                  className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto [&_input]:bg-card [&_input]:md:h-11"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 justify-self-end text-muted-foreground"
                  onClick={() => remove(line.key)}
                  aria-label={`Quitar el renglón ${n}`}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
              <ChoiceChips<KindChoice>
                size="sm"
                label={`Concepto, renglón ${n}`}
                value={line.kind ?? NO_KIND}
                onChange={(value) => update(line.key, { kind: value === NO_KIND ? null : value })}
                options={KIND_OPTIONS}
              />
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
        className="h-11 gap-1.5 justify-self-start md:h-9"
        onClick={add}
      >
        <Plus className="size-3.5" aria-hidden />
        Agregar renglón
      </Button>
      {totals.total > 0 ? (
        <dl className="grid gap-1 rounded-xl bg-secondary/50 p-3 text-sm">
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
