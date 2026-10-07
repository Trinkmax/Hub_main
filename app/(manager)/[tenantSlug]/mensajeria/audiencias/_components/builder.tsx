'use client'

import { Plus, Users, X } from 'lucide-react'
import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Card } from '@/components/ui/card'
import { Field, FormSection } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { MoneyField } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { SubmitButton } from '@/components/ui/submit-button'
import type { AudienceBuilderOptions } from '@/lib/audiences/queries'
import {
  type AudienceFilter,
  type ConditionField,
  type ConditionOp,
  EMPTY_FILTER,
} from '@/lib/audiences/schemas'
import { formatNumber } from '@/lib/format/number-kind'
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
  /** El verbo del botón: «Crear audiencia», «Guardar cambios». */
  submitLabel: string
  submitName?: string
  /** Adónde vuelve «Cancelar». */
  cancelHref: string
}

export function AudienceBuilder({
  tenantSlug,
  options,
  initialName = '',
  initialFilters = EMPTY_FILTER,
  hiddenIdField,
  submitLabel,
  submitName,
  cancelHref,
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
  const missingName = !name.trim()

  return (
    <>
      <input type="hidden" name="filters" value={filtersJson} />
      {hiddenIdField ? <input type="hidden" name="id" value={hiddenIdField} /> : null}

      {/* Nombre del grupo */}
      <Field
        label="¿Cómo querés llamar a este grupo?"
        hint={
          missingName
            ? 'Ponele un nombre para poder guardarlo. Si tocás un grupo listo, te sugerimos uno.'
            : 'Es solo para vos: tus clientes no lo ven.'
        }
      >
        <Input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Clientes frecuentes"
          maxLength={80}
          required
          className="sm:max-w-md"
        />
      </Field>

      <FormSection
        title="¿A quiénes querés llegar?"
        description="Tocá un grupo listo y, si querés, ajustalo abajo."
      >
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

        {/* Armado a medida */}
        <div className="flex items-center gap-3 pt-2">
          <div className="h-px flex-1 bg-border" />
          <span className="type-small text-muted-foreground">o armá el tuyo</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {conditions.length >= 2 ? (
          <div className="flex flex-wrap items-center gap-2 type-body">
            <span id="audience-op-label">Entran los clientes que cumplan</span>
            <Select
              value={root.op}
              onValueChange={(v) => setRoot({ ...root, op: v as 'AND' | 'OR' })}
            >
              <SelectTrigger size="sm" aria-labelledby="audience-op-label" className="font-medium">
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
          <Callout
            tone="neutral"
            title="Elegí un grupo de arriba, o agregá una condición a medida."
          >
            Sin condiciones, el grupo son todos tus clientes.
          </Callout>
        ) : (
          <ol className="flex flex-col gap-2" aria-label="Condiciones">
            {conditions.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: la condición no tiene id estable
              <Fragment key={i}>
                {i > 0 ? (
                  <li className="flex items-center ps-4" aria-hidden>
                    <span className="rounded-full border border-border bg-secondary px-2.5 py-0.5 type-caption font-medium text-muted-foreground">
                      {root.op === 'AND' ? 'y' : 'o'}
                    </span>
                  </li>
                ) : null}
                <li>
                  <ConditionRow
                    condition={c}
                    options={options}
                    onChange={(next) => updateCondition(i, next)}
                    onRemove={() => removeCondition(i)}
                  />
                </li>
              </Fragment>
            ))}
          </ol>
        )}

        <div>
          <Button type="button" variant="secondary" size="sm" onClick={addCondition}>
            <Plus aria-hidden />
            {conditions.length === 0 ? 'Agregar una condición' : 'Agregar otra condición'}
          </Button>
        </div>
      </FormSection>

      {/* Conteo en vivo: a quién le va a llegar. Cifra en Inter tabular (cambia
          mientras se arma: Fraunces no tiene cifras tabulares). */}
      <Card aria-live="polite" className="gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
            <Users className="size-5" aria-hidden />
          </span>
          {previewError ? (
            <div className="min-w-0">
              <p className="type-label text-destructive-text">
                No pudimos calcular cuántos clientes entran.
              </p>
              <p className="type-small text-muted-foreground">
                Revisá las condiciones o esperá un momento: se vuelve a calcular solo al cambiarlas.
              </p>
            </div>
          ) : (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-3xl font-semibold leading-none tabular-nums text-foreground">
                {total !== null ? formatNumber(total) : '—'}
              </span>
              <span className="type-body text-muted-foreground">
                {total === 1
                  ? 'cliente entra hoy en este grupo'
                  : 'clientes entran hoy en este grupo'}
              </span>
              {isPreviewing ? (
                <Spinner
                  size={16}
                  label="Calculando…"
                  className="self-center text-muted-foreground"
                />
              ) : null}
            </div>
          )}
        </div>

        {!previewError && preview && preview.sample.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="type-small text-muted-foreground">Por ejemplo:</span>
            {preview.sample.slice(0, 8).map((person, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: muestra de solo lectura; puede haber homónimos
                key={`${person}-${i}`}
                className="rounded-full bg-secondary px-2 py-0.5 type-caption text-foreground"
              >
                {person}
              </span>
            ))}
            {total !== null && total > preview.sample.length ? (
              <span className="type-caption text-muted-foreground">
                +{formatNumber(total - preview.sample.length)} más
              </span>
            ) : null}
          </div>
        ) : null}

        {!previewError && preview && total === 0 ? (
          <p className="type-small text-muted-foreground">
            {conditions.length > 0
              ? 'Ningún cliente cumple estas condiciones todavía. Probá con condiciones menos estrictas.'
              : 'Todavía no tenés clientes cargados en tu bar.'}
          </p>
        ) : null}
      </Card>

      {/* En el celular, barra fija arriba de las pestañas de Mensajería (el
          layout define --form-actions-offset). */}
      <FormActions>
        <Button asChild variant="secondary">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
        <SubmitButton
          name={submitName ?? undefined}
          pendingText="Guardando…"
          disabled={missingName}
        >
          {submitLabel}
        </SubmitButton>
      </FormActions>
    </>
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
      className="flex min-h-14 items-start gap-3 rounded-lg border border-border-strong bg-card p-3 text-left transition-colors outline-(--ring) outline-offset-2 hover:bg-muted focus-visible:outline-2"
    >
      <span className="text-xl leading-none" aria-hidden>
        {preset.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block type-label text-foreground">{preset.label}</span>
        {/* Sin truncar: en tres columnas la pista quedaba en «Sin visitas hace +30 …». */}
        <span className="block text-pretty type-small text-muted-foreground">{preset.hint}</span>
      </span>
      <span className="shrink-0 type-small font-medium tabular-nums text-muted-foreground">
        {count === undefined ? (
          <>
            <Spinner size={14} aria-hidden />
            <span className="sr-only">contando clientes</span>
          </>
        ) : count === null ? (
          '—'
        ) : (
          <>
            {formatNumber(count)}
            <span className="sr-only"> {count === 1 ? 'cliente' : 'clientes'}</span>
          </>
        )}
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2.5 type-body">
      {/* El "qué" — arranca la frase */}
      <Select
        value={condition.field}
        onValueChange={(v) => onChange(defaultForField(v as ConditionField, options))}
      >
        <SelectTrigger aria-label="Qué mirar del cliente" className="min-w-40 font-medium">
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
          <SelectTrigger aria-label="Cómo comparar" className="min-w-24">
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
        className="ml-auto"
        onClick={onRemove}
        aria-label="Quitar condición"
      >
        <X aria-hidden />
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
      return <span className="type-small text-muted-foreground">{emptyHint}</span>
    }
    return (
      <Select value={current} onValueChange={setValue}>
        <SelectTrigger aria-label={placeholder} className="min-w-36">
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
      return optionSelect(CHANNEL_OPTIONS, 'Elegí por dónde', '')
    case 'source':
      return optionSelect(SOURCE_OPTIONS, 'Elegí de dónde', '')
    case 'month':
      return optionSelect(
        MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
        'Elegí un mes',
        '',
      )
    case 'pesos': {
      // Plata con el campo del kit: se tipea en pesos («1.500»), viaja en centavos.
      const cents = Number(condition.value)
      return (
        <MoneyField
          aria-label="Monto"
          decimals="auto"
          align="start"
          className="w-40"
          cents={Number.isFinite(cents) && cents > 0 ? cents : null}
          onCentsChange={(next) => setValue(next ?? 0)}
          placeholder="Ej: 15.000"
        />
      )
    }
    default: {
      // Conteos (visitas, días, puntos): sin negativos, de a uno con las flechas.
      const numeric = current === '' ? null : Number(current)
      return (
        <NumberField
          aria-label="Cantidad"
          className="w-36"
          min={0}
          value={numeric !== null && Number.isFinite(numeric) ? numeric : null}
          onValueChange={(next) => setValue(next ?? '')}
          placeholder={config.placeholder ?? 'valor'}
        />
      )
    }
  }
}
