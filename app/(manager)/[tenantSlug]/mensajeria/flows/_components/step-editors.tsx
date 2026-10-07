'use client'

import { useId } from 'react'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MoneyField } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
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
  const unitId = useId()

  return (
    <Field label="¿Cuánto esperar?" hint="Como máximo, 30 días.">
      <div className="flex items-start gap-2">
        {/* Un número fuera de rango muestra el error al salir; mientras tanto
            queda el último valor válido (nada se recorta en silencio). */}
        <NumberField
          className="w-36"
          min={1}
          max={UNIT_MAX[unit]}
          value={amount}
          onValueChange={(n) => {
            if (n !== null) onChange(clampMinutes(n * WAIT_UNIT_FACTOR[unit]))
          }}
        />
        <Select
          value={unit}
          onValueChange={(u) => onChange(clampMinutes(amount * WAIT_UNIT_FACTOR[u as WaitUnit]))}
        >
          <SelectTrigger id={unitId} className="w-32" aria-label="Unidad de tiempo">
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
    </Field>
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

  const cents = Number(value)
  const hasCents = value !== '' && value != null && Number.isFinite(cents)

  return (
    <div className="flex flex-col gap-4">
      <Field label="¿Qué mirar del cliente?">
        <Select value={selectValue} onValueChange={handleFieldChange}>
          <SelectTrigger>
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
      </Field>

      {!known && (
        <Field
          label="Dato (avanzado)"
          hint="El nombre técnico del dato, como lo guarda el sistema."
        >
          <Input
            size="sm"
            value={field}
            onChange={(e) => onPatch({ field: e.target.value })}
            placeholder="customer.total_visits"
            className="font-mono"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
      )}

      <Field label="Cómo comparar">
        <Select value={op} onValueChange={(v) => onPatch({ op: v })}>
          <SelectTrigger>
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
      </Field>

      {!booleanOp && fieldKind === 'money' && (
        <Field label="Monto" hint="En pesos. Se compara con lo que gastó en total.">
          <MoneyField
            decimals="auto"
            align="start"
            cents={hasCents ? cents : null}
            onCentsChange={(next) => onPatch({ value: next ?? undefined })}
            placeholder="Ej: 15.000"
          />
        </Field>
      )}

      {!booleanOp && fieldKind === 'number' && (
        <Field label="Número">
          <NumberField
            min={0}
            value={
              typeof value === 'number'
                ? value
                : typeof value === 'string' && value !== '' && Number.isFinite(Number(value))
                  ? Number(value)
                  : null
            }
            onValueChange={(n) => onPatch({ value: n ?? undefined })}
            placeholder="Ej: 3"
          />
        </Field>
      )}

      {!booleanOp && fieldKind === 'custom' && (
        <Field label="Valor">
          <Input
            value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
            onChange={(e) => onPatch({ value: e.target.value })}
            placeholder="valor"
          />
        </Field>
      )}
    </div>
  )
}
