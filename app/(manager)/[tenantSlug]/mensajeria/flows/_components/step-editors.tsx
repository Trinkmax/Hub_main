'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CONDITION_FIELDS,
  MAX_WAIT_MINUTES,
  minutesToParts,
  OP_LABEL,
  opsForFieldKind,
  WAIT_UNIT_FACTOR,
  WAIT_UNIT_LABEL,
  type WaitUnit,
} from './step-meta'

// Editores compartidos entre el editor de grafo y el builder legacy, para
// que "Esperar" y "Si se cumple…" se configuren igual en los dos lados.
// Solo cambian la UI: los datos que guardan son exactamente los de siempre
// (wait → { minutes }, condition → { field, op, value }).

// ─── Esperar ─────────────────────────────────────────────────────────────────

const clampMinutes = (m: number) => Math.min(MAX_WAIT_MINUTES, Math.max(1, Math.round(m)))

const UNIT_MAX: Record<WaitUnit, number> = { minutes: MAX_WAIT_MINUTES, hours: 720, days: 30 }

export function WaitEditor({
  minutes,
  onChange,
}: {
  minutes: number
  onChange: (minutes: number) => void
}) {
  const { amount, unit } = minutesToParts(minutes)

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">¿Cuánto esperar?</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={UNIT_MAX[unit]}
          value={amount}
          onChange={(e) => onChange(clampMinutes(Number(e.target.value) * WAIT_UNIT_FACTOR[unit]))}
          className="w-24"
          aria-label="Cantidad de tiempo"
        />
        <Select
          value={unit}
          onValueChange={(u) => onChange(clampMinutes(amount * WAIT_UNIT_FACTOR[u as WaitUnit]))}
        >
          <SelectTrigger className="w-32" aria-label="Unidad de tiempo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(WAIT_UNIT_LABEL) as WaitUnit[]).map((u) => (
              <SelectItem key={u} value={u}>
                {WAIT_UNIT_LABEL[u]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-[11px] text-muted-foreground">Como máximo, 30 días.</p>
    </div>
  )
}

// ─── Si se cumple… ───────────────────────────────────────────────────────────

const CUSTOM_FIELD = '__custom'

export function ConditionEditor({
  field,
  op,
  value,
  onPatch,
}: {
  field: string
  op: string
  value: unknown
  onPatch: (patch: { field?: string; op?: string; value?: unknown }) => void
}) {
  const known = CONDITION_FIELDS.find((f) => f.value === field)
  const fieldKind = known?.kind ?? 'custom'
  const selectValue = known ? field : CUSTOM_FIELD

  let ops = opsForFieldKind(fieldKind)
  if (!ops.includes(op)) ops = [op, ...ops]

  const booleanOp = op === 'is_true' || op === 'is_false'

  const handleFieldChange = (v: string) => {
    if (v === CUSTOM_FIELD) {
      onPatch({ field: '', op: 'is_true', value: undefined })
      return
    }
    const next = CONDITION_FIELDS.find((f) => f.value === v)
    const nextOps = opsForFieldKind(next?.kind ?? 'custom')
    onPatch({
      field: v,
      op: nextOps.includes(op) ? op : (nextOps[0] ?? 'is_true'),
      value: undefined,
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">¿Qué mirar del cliente?</Label>
        <Select value={selectValue} onValueChange={handleFieldChange}>
          <SelectTrigger aria-label="Qué mirar del cliente">
            <SelectValue placeholder="Elegí un dato" />
          </SelectTrigger>
          <SelectContent>
            {CONDITION_FIELDS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_FIELD}>Otro dato (avanzado)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!known && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Dato (avanzado)</Label>
          <Input
            value={field}
            onChange={(e) => onPatch({ field: e.target.value })}
            placeholder="customer.total_visits"
            className="font-mono text-xs"
            aria-label="Dato avanzado a evaluar"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Cómo comparar</Label>
        <Select value={op} onValueChange={(v) => onPatch({ op: v })}>
          <SelectTrigger aria-label="Cómo comparar">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ops.map((o) => (
              <SelectItem key={o} value={o}>
                {OP_LABEL[o] ?? o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!booleanOp && fieldKind === 'money' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Monto (en pesos)</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              min={0}
              step="any"
              value={(() => {
                const cents = Number(value)
                return Number.isFinite(cents) && value !== '' && value != null ? cents / 100 : ''
              })()}
              onChange={(e) =>
                onPatch({
                  value:
                    e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100),
                })
              }
              placeholder="1500"
              aria-label="Monto en pesos"
            />
          </div>
        </div>
      )}

      {!booleanOp && fieldKind === 'number' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Número</Label>
          <Input
            type="number"
            min={0}
            value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
            onChange={(e) =>
              onPatch({ value: e.target.value === '' ? undefined : Number(e.target.value) })
            }
            placeholder="3"
            aria-label="Número a comparar"
          />
        </div>
      )}

      {!booleanOp && fieldKind === 'custom' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Valor</Label>
          <Input
            value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
            onChange={(e) => onPatch({ value: e.target.value })}
            placeholder="valor"
            aria-label="Valor a comparar"
          />
        </div>
      )}
    </div>
  )
}
