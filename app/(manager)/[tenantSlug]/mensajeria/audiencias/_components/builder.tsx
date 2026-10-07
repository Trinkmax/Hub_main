'use client'

import { Loader2, Plus, Users, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AudienceBuilderOptions } from '@/lib/audiences/queries'
import {
  type AudienceFilter,
  type ConditionField,
  type ConditionOp,
  EMPTY_FILTER,
} from '@/lib/audiences/schemas'
import {
  CHANNEL_OPTIONS,
  FIELD_ORDER,
  FIELD_SENTENCE,
  type FieldConfig,
  MONTHS,
  SOURCE_OPTIONS,
} from './condition-copy'

type Group = Extract<AudienceFilter, { kind: 'group' }>
type Condition = Extract<AudienceFilter, { kind: 'condition' }>

function cond(field: ConditionField, op: ConditionOp, value: unknown): Condition {
  return { kind: 'condition', field, op, value }
}

function defaultForField(field: ConditionField, options: AudienceBuilderOptions): Condition {
  const cfg = FIELD_SENTENCE[field]
  const op = cfg.ops[0]?.op ?? 'eq'
  switch (cfg.value) {
    case 'number':
      return cond(field, op, Number(cfg.placeholder ?? 1))
    case 'pesos':
      return cond(field, op, 0)
    case 'month':
      return cond(field, 'eq', 1)
    case 'tier':
      return cond(field, 'eq', options.tiers[0]?.id ?? null)
    case 'tag':
      return cond(field, 'eq', options.tags[0]?.id ?? null)
    case 'event':
      return cond(field, 'eq', options.events[0]?.id ?? null)
    case 'channel':
      return cond(field, 'eq', 'walkin')
    case 'source':
      return cond(field, 'eq', 'qr')
    case 'boolean':
      return cond(field, 'is_true', null)
  }
}

// Grupos listos: la mayoría de los dueños quiere esto, no armar condiciones.
const PRESETS: {
  emoji: string
  label: string
  hint: string
  suggestedName: string
  filter: Group
}[] = [
  {
    emoji: '💬',
    label: 'Con WhatsApp',
    hint: 'Aceptan recibir promos',
    suggestedName: 'Aceptan promos por WhatsApp',
    filter: { kind: 'group', op: 'AND', nodes: [cond('opt_in_marketing', 'is_true', null)] },
  },
  {
    emoji: '🔥',
    label: 'Frecuentes',
    hint: 'Vinieron 2 veces o más',
    suggestedName: 'Clientes frecuentes',
    filter: { kind: 'group', op: 'AND', nodes: [cond('visits_count', 'gte', 2)] },
  },
  {
    emoji: '💤',
    label: 'No vienen',
    hint: 'Sin visitas hace +30 días',
    suggestedName: 'Clientes a reactivar',
    filter: { kind: 'group', op: 'AND', nodes: [cond('days_since_last_visit', 'gte', 30)] },
  },
  {
    emoji: '✨',
    label: 'Nuevos',
    hint: 'Se sumaron esta semana',
    suggestedName: 'Clientes nuevos',
    filter: { kind: 'group', op: 'AND', nodes: [cond('created_days_ago', 'lte', 7)] },
  },
  {
    emoji: '🎁',
    label: 'Con puntos',
    hint: 'Tienen puntos para canjear',
    suggestedName: 'Con puntos para canjear',
    filter: { kind: 'group', op: 'AND', nodes: [cond('points_balance', 'gt', 0)] },
  },
]

async function fetchCount(slug: string, filters: AudienceFilter): Promise<number | null> {
  try {
    const res = await fetch('/api/audiences/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, filters }),
    })
    const data = await res.json()
    return data?.ok ? (data.total as number) : null
  } catch {
    return null
  }
}

// Aplana a un grupo de condiciones (la UI no expone subgrupos anidados).
function toFlatGroup(f: AudienceFilter): Group {
  if (f.kind === 'condition') return { kind: 'group', op: 'AND', nodes: [f] }
  if (f.kind === 'group') {
    const nodes = f.nodes.flatMap((n) =>
      n.kind === 'condition'
        ? [n]
        : n.kind === 'group'
          ? n.nodes.filter((x) => x.kind === 'condition')
          : [],
    )
    return { kind: 'group', op: f.op, nodes }
  }
  return { kind: 'group', op: 'AND', nodes: [] }
}

type BuilderProps = {
  tenantSlug: string
  options: AudienceBuilderOptions
  initialName?: string
  initialFilters?: AudienceFilter
  hiddenIdField?: string
  submitLabel: string
  submitName?: string
}

export function AudienceBuilder({
  tenantSlug,
  options,
  initialName = '',
  initialFilters = EMPTY_FILTER,
  hiddenIdField,
  submitLabel,
  submitName,
}: BuilderProps) {
  const [name, setName] = useState(initialName)
  const [root, setRoot] = useState<Group>(toFlatGroup(initialFilters))
  const [preview, setPreview] = useState<{ total: number; sample: string[] } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [presetCounts, setPresetCounts] = useState<Record<string, number | null>>({})

  const conditions = root.nodes.filter((n): n is Condition => n.kind === 'condition')
  const filtersJson = useMemo(() => JSON.stringify(root), [root])

  const setConditions = useCallback((next: Condition[]) => {
    setRoot((r) => ({ ...r, nodes: next }))
  }, [])

  // Preview de la audiencia armada (debounce).
  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(async () => {
      setIsPreviewing(true)
      setPreviewError(null)
      try {
        const res = await fetch('/api/audiences/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: tenantSlug, filters: JSON.parse(filtersJson) }),
        })
        const data = await res.json()
        if (cancelled) return
        if (!data.ok) {
          setPreviewError(data.message ?? 'preview_failed')
          setPreview(null)
        } else {
          setPreview({ total: data.total, sample: data.sample })
        }
      } catch (e) {
        if (!cancelled) setPreviewError((e as Error).message)
      } finally {
        if (!cancelled) setIsPreviewing(false)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [filtersJson, tenantSlug])

  // Conteo en vivo de cada grupo listo (una vez, al montar).
  useEffect(() => {
    let cancelled = false
    Promise.all(PRESETS.map((p) => fetchCount(tenantSlug, p.filter))).then((counts) => {
      if (cancelled) return
      const map: Record<string, number | null> = {}
      PRESETS.forEach((p, i) => {
        map[p.label] = counts[i] ?? null
      })
      setPresetCounts(map)
    })
    return () => {
      cancelled = true
    }
  }, [tenantSlug])

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setRoot(preset.filter)
    if (!name.trim()) setName(preset.suggestedName)
  }

  function addCondition() {
    setConditions([...conditions, defaultForField('visits_count', options)])
  }

  function updateCondition(index: number, next: Condition) {
    setConditions(conditions.map((c, i) => (i === index ? next : c)))
  }

  function removeCondition(index: number) {
    setConditions(conditions.filter((_, i) => i !== index))
  }

  const total = preview?.total ?? null

  return (
    <div className="space-y-6">
      <input type="hidden" name="filters" value={filtersJson} />
      {hiddenIdField ? <input type="hidden" name="id" value={hiddenIdField} /> : null}

      {/* Nombre del grupo */}
      <div className="grid gap-1.5">
        <Label htmlFor="audience-name" className="text-sm font-medium">
          ¿Cómo querés llamar a este grupo?
        </Label>
        <Input
          id="audience-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Clientes frecuentes"
          maxLength={80}
          required
          className="sm:max-w-md"
        />
      </div>

      {/* Grupos listos */}
      <div className="space-y-2.5">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">¿A quiénes querés llegar?</h2>
          <p className="text-xs text-muted-foreground">
            Tocá un grupo listo y, si querés, ajustalo abajo.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((p) => (
            <PresetCard
              key={p.label}
              preset={p}
              count={presetCounts[p.label]}
              onClick={() => applyPreset(p)}
            />
          ))}
        </div>
      </div>

      {/* Armado a medida */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            o armá el tuyo
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {conditions.length >= 2 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Entran los clientes que cumplan</span>
            <Select
              value={root.op}
              onValueChange={(v) => setRoot({ ...root, op: v as 'AND' | 'OR' })}
            >
              <SelectTrigger className="h-8 w-auto gap-1 font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">todas las condiciones</SelectItem>
                <SelectItem value="OR">al menos una condición</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {conditions.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-secondary/20 px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Elegí un grupo de arriba, o agregá una condición a medida.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Sin condiciones, el grupo son todos tus clientes.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {conditions.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: la condición no tiene id estable
              <Fragment key={i}>
                {i > 0 ? (
                  <div className="flex items-center pl-4" aria-hidden>
                    <span className="rounded-full border bg-secondary px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {root.op === 'AND' ? 'y' : 'o'}
                    </span>
                  </div>
                ) : null}
                <ConditionRow
                  condition={c}
                  options={options}
                  onChange={(next) => updateCondition(i, next)}
                  onRemove={() => removeCondition(i)}
                />
              </Fragment>
            ))}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={addCondition}
        >
          <Plus className="size-3.5" aria-hidden />
          {conditions.length === 0 ? 'Agregar una condición' : 'Agregar otra condición'}
        </Button>
      </div>

      {/* Conteo en vivo — a quién le va a llegar */}
      <div
        className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users className="size-5" aria-hidden />
          </span>
          {previewError ? (
            <div className="min-w-0">
              <p className="text-sm font-medium text-destructive">
                No se pudo calcular cuántos clientes entran.
              </p>
              <p className="text-xs text-muted-foreground">
                Revisá las condiciones o esperá un momento y probá de nuevo.
              </p>
            </div>
          ) : (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-display text-3xl font-semibold leading-none tabular-nums">
                {total !== null ? total.toLocaleString('es-AR') : '—'}
              </span>
              <span className="text-sm text-muted-foreground">
                {total === 1
                  ? 'cliente entra hoy en este grupo'
                  : 'clientes entran hoy en este grupo'}
              </span>
              {isPreviewing ? (
                <Loader2
                  className="size-4 self-center animate-spin text-muted-foreground"
                  aria-hidden
                />
              ) : null}
            </div>
          )}
        </div>

        {!previewError && preview && preview.sample.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Por ejemplo:</span>
            {preview.sample.slice(0, 8).map((person, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: muestra de solo lectura; puede haber homónimos
                key={`${person}-${i}`}
                className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-foreground"
              >
                {person}
              </span>
            ))}
            {total !== null && total > preview.sample.length ? (
              <span className="text-[11px] text-muted-foreground">
                +{(total - preview.sample.length).toLocaleString('es-AR')} más
              </span>
            ) : null}
          </div>
        ) : null}

        {!previewError && preview && total === 0 ? (
          <p className="text-sm text-muted-foreground">
            {conditions.length > 0
              ? 'Ningún cliente cumple estas condiciones todavía. Probá con condiciones menos estrictas.'
              : 'Todavía no tenés clientes cargados en tu bar.'}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button
          type="submit"
          name={submitName ?? undefined}
          size="lg"
          className="w-full sm:w-auto"
          disabled={!name.trim()}
        >
          {submitLabel}
        </Button>
        {!name.trim() ? (
          <p className="text-xs text-muted-foreground">
            Ponele un nombre al grupo para poder guardarlo.
          </p>
        ) : null}
      </div>
    </div>
  )
}

function PresetCard({
  preset,
  count,
  onClick,
}: {
  preset: (typeof PRESETS)[number]
  count: number | null | undefined
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-secondary/30"
    >
      <span className="text-xl leading-none" aria-hidden>
        {preset.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{preset.label}</p>
        <p className="truncate text-xs text-muted-foreground">{preset.hint}</p>
      </div>
      <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
        {count === undefined ? '···' : count === null ? '—' : count.toLocaleString('es-AR')}
      </span>
    </button>
  )
}

function needsValue(op: ConditionOp): boolean {
  return !['is_true', 'is_false', 'is_null', 'is_not_null'].includes(op)
}

function ConditionRow({
  condition,
  options,
  onChange,
  onRemove,
}: {
  condition: Condition
  options: AudienceBuilderOptions
  onChange: (next: Condition) => void
  onRemove: () => void
}) {
  const cfg = FIELD_SENTENCE[condition.field]
  const showOp = cfg.ops.length > 1 || (cfg.ops[0]?.label ?? '') !== ''

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2.5 text-sm">
      {/* El "qué" — arranca la frase */}
      <Select
        value={condition.field}
        onValueChange={(v) => onChange(defaultForField(v as ConditionField, options))}
      >
        <SelectTrigger className="h-9 w-auto min-w-[10rem] font-medium">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_ORDER.map((grp) => (
            <SelectGroup key={grp.group}>
              <SelectLabel>{grp.group}</SelectLabel>
              {grp.fields.map((f) => (
                <SelectItem key={f} value={f}>
                  {FIELD_SENTENCE[f].verb}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      {/* El conector ("al menos", "más de", "sí"/"no") */}
      {showOp ? (
        <Select
          value={condition.op}
          onValueChange={(v) => onChange({ ...condition, op: v as ConditionOp })}
        >
          <SelectTrigger className="h-9 w-auto min-w-[6rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {cfg.ops.map((o) => (
              <SelectItem key={o.op} value={o.op}>
                {o.label || '—'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {/* El valor */}
      {needsValue(condition.op) ? (
        <ConditionValue condition={condition} config={cfg} options={options} onChange={onChange} />
      ) : null}

      {/* El cierre de la frase */}
      {cfg.suffix ? <span className="text-muted-foreground">{cfg.suffix}</span> : null}

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="ml-auto h-8 shrink-0 gap-1 px-2 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label="Quitar condición"
      >
        <X className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Quitar</span>
      </Button>
    </div>
  )
}

function ConditionValue({
  condition,
  config,
  options,
  onChange,
}: {
  condition: Condition
  config: FieldConfig
  options: AudienceBuilderOptions
  onChange: (next: Condition) => void
}) {
  const setValue = (value: unknown) => onChange({ ...condition, value })
  const current =
    condition.value === null || condition.value === undefined ? '' : String(condition.value)

  const optionSelect = (
    items: { value: string; label: string }[],
    placeholder: string,
    emptyHint: string,
  ) => {
    if (items.length === 0) {
      return <span className="text-xs text-muted-foreground">{emptyHint}</span>
    }
    return (
      <Select value={current} onValueChange={setValue}>
        <SelectTrigger className="h-9 w-auto min-w-[9rem]">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  switch (config.value) {
    case 'tier':
      return optionSelect(
        options.tiers.map((t) => ({ value: t.id, label: t.name })),
        'Elegí un nivel',
        'Todavía no creaste niveles en el Club.',
      )
    case 'tag':
      return optionSelect(
        options.tags.map((t) => ({ value: t.id, label: t.name })),
        'Elegí una etiqueta',
        'Todavía no creaste etiquetas.',
      )
    case 'event':
      return optionSelect(
        options.events.map((e) => ({ value: e.id, label: e.name })),
        'Elegí un evento',
        'Todavía no hay eventos en el calendario.',
      )
    case 'channel':
      return optionSelect(CHANNEL_OPTIONS, 'Elegí', '')
    case 'source':
      return optionSelect(SOURCE_OPTIONS, 'Elegí', '')
    case 'month':
      return optionSelect(
        MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
        'Elegí un mes',
        '',
      )
    case 'pesos': {
      const cents = Number(condition.value)
      const pesos = Number.isFinite(cents) && cents > 0 ? String(Math.round(cents / 100)) : ''
      return (
        <div className="relative w-32">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            $
          </span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            className="h-9 w-full pl-7"
            value={pesos}
            onChange={(e) => {
              const p = e.target.value
              setValue(p === '' ? 0 : Math.max(0, Math.round(Number(p) * 100)))
            }}
            placeholder="0"
          />
        </div>
      )
    }
    default:
      return (
        <Input
          type="number"
          inputMode="numeric"
          className="h-9 w-20"
          value={current}
          onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder={config.placeholder ?? 'valor'}
        />
      )
  }
}
