'use client'

import { Loader2, Plus, Sparkles, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import { cn } from '@/lib/utils'

type Group = Extract<AudienceFilter, { kind: 'group' }>
type Condition = Extract<AudienceFilter, { kind: 'condition' }>

const FIELD_LABELS: Record<ConditionField, string> = {
  opt_in_marketing: 'Opt-in WhatsApp',
  birth_month: 'Mes de cumpleaños',
  days_since_last_visit: 'Días desde última visita',
  visits_count: 'Cantidad de visitas',
  total_spent_cents: 'Gasto total (centavos)',
  points_balance: 'Saldo de puntos',
  lifetime_points: 'Puntos acumulados (vida)',
  current_tier_id: 'Nivel del club',
  created_days_ago: 'Días desde que se sumó',
  acquisition_channel: 'Cómo llegó',
  has_tag: 'Tiene tag',
  attended_event_id: 'Asistió a un evento',
  source: 'Origen del registro',
}

// Cómo se agrupan los campos en el dropdown — el dueño piensa por temas, no por
// columnas sueltas. El orden acá manda en el Select.
const FIELD_GROUPS: { label: string; fields: ConditionField[] }[] = [
  {
    label: 'Quién es',
    fields: ['acquisition_channel', 'source', 'has_tag', 'birth_month', 'created_days_ago'],
  },
  {
    label: 'Cuánto viene / gasta',
    fields: ['visits_count', 'days_since_last_visit', 'total_spent_cents', 'attended_event_id'],
  },
  {
    label: 'Club de beneficios',
    fields: ['current_tier_id', 'points_balance', 'lifetime_points'],
  },
  { label: 'Marketing', fields: ['opt_in_marketing'] },
]

const OP_LABELS: Record<ConditionOp, string> = {
  eq: 'es',
  neq: 'no es',
  gt: 'mayor a',
  gte: 'mayor o igual a',
  lt: 'menor a',
  lte: 'menor o igual a',
  in: 'en',
  not_in: 'no en',
  is_true: 'sí',
  is_false: 'no',
  is_null: 'sin asignar',
  is_not_null: 'asignado',
}

// Ops ofrecidos por campo en la UI — espejo (reducido a single-value) del
// allowlist del compilador. `in`/`not_in` (multi-valor) se omiten acá; el
// compilador igual los soporta para audiencias armadas por JSON.
const FIELD_OPS: Record<ConditionField, ConditionOp[]> = {
  opt_in_marketing: ['is_true', 'is_false'],
  birth_month: ['eq', 'neq'],
  days_since_last_visit: ['gte', 'gt', 'lte', 'lt', 'eq'],
  visits_count: ['gte', 'gt', 'lte', 'lt', 'eq'],
  total_spent_cents: ['gte', 'gt', 'lte', 'lt', 'eq'],
  points_balance: ['gte', 'gt', 'lte', 'lt', 'eq'],
  lifetime_points: ['gte', 'gt', 'lte', 'lt', 'eq'],
  current_tier_id: ['eq', 'neq', 'is_not_null', 'is_null'],
  created_days_ago: ['lte', 'lt', 'gte', 'gt', 'eq'],
  acquisition_channel: ['eq', 'neq'],
  has_tag: ['eq', 'neq'],
  attended_event_id: ['eq', 'neq'],
  source: ['eq', 'neq'],
}

const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'walkin', label: 'Walk-in (consumió en el local)' },
  { value: 'reservation', label: 'Reserva' },
  { value: 'import', label: 'Importado' },
]

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'qr', label: 'Escaneó el QR' },
  { value: 'manual', label: 'Carga manual del staff' },
  { value: 'import', label: 'Importado' },
]

// Op + value por defecto al elegir un campo, para no arrastrar un value inválido
// (p. ej. un número quedando como "nivel") entre campos de distinta naturaleza.
function defaultForField(
  field: ConditionField,
  options: AudienceBuilderOptions,
): { op: ConditionOp; value: unknown } {
  switch (field) {
    case 'opt_in_marketing':
      return { op: 'is_true', value: null }
    case 'birth_month':
      return { op: 'eq', value: 1 }
    case 'days_since_last_visit':
      return { op: 'gte', value: 30 }
    case 'visits_count':
      return { op: 'gte', value: 2 }
    case 'total_spent_cents':
      return { op: 'gte', value: 0 }
    case 'points_balance':
      return { op: 'gte', value: 0 }
    case 'lifetime_points':
      return { op: 'gte', value: 0 }
    case 'current_tier_id':
      return { op: 'eq', value: options.tiers[0]?.id ?? null }
    case 'created_days_ago':
      return { op: 'lte', value: 30 }
    case 'acquisition_channel':
      return { op: 'eq', value: 'walkin' }
    case 'has_tag':
      return { op: 'eq', value: options.tags[0]?.id ?? null }
    case 'attended_event_id':
      return { op: 'eq', value: options.events[0]?.id ?? null }
    case 'source':
      return { op: 'eq', value: 'qr' }
  }
}

function defaultCondition(): Condition {
  return { kind: 'condition', field: 'visits_count', op: 'gte', value: 2 }
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
  const [root, setRoot] = useState<Group>(toGroup(initialFilters))
  const [preview, setPreview] = useState<{ total: number; sample: string[] } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)

  const filtersJson = useMemo(() => JSON.stringify(root), [root])

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

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <div className="card-hairline rounded-xl border bg-card p-5">
          <div className="space-y-1.5">
            <Label
              htmlFor="audience-name"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Nombre
            </Label>
            <Input
              id="audience-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Frecuentes alejados"
              maxLength={80}
              required
            />
          </div>
        </div>

        <input type="hidden" name="filters" value={filtersJson} />
        {hiddenIdField ? <input type="hidden" name="id" value={hiddenIdField} /> : null}

        <div className="space-y-2">
          <h2 className="font-display text-sm font-semibold tracking-tight">Condiciones</h2>
          <GroupEditor group={root} onChange={setRoot} options={options} />
        </div>

        <Button type="submit" name={submitName ?? undefined} size="lg" className="w-full sm:w-auto">
          {submitLabel}
        </Button>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 size-32 rounded-full bg-primary/15 blur-2xl"
          />
          <div className="relative">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary">
              <Users className="size-3.5" />
              Preview
            </div>
            {isPreviewing ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Calculando…
              </div>
            ) : previewError ? (
              <p className="mt-3 text-sm text-destructive">Error: {previewError}</p>
            ) : preview ? (
              <>
                <p className="mt-2 font-display text-4xl font-semibold tabular-nums">
                  {preview.total.toLocaleString('es-AR')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {preview.total === 1 ? 'cliente coincide' : 'clientes coinciden'}
                </p>
                {preview.sample.length > 0 ? (
                  <div className="mt-3 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Algunos
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {preview.sample.slice(0, 8).map((nameStr, i) => (
                        <span
                          // biome-ignore lint/suspicious/noArrayIndexKey: muestra de solo lectura; puede haber homónimos
                          key={`${nameStr}-${i}`}
                          className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-foreground"
                        >
                          {nameStr}
                        </span>
                      ))}
                      {preview.total > preview.sample.length ? (
                        <span className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground">
                          +{(preview.total - preview.sample.length).toLocaleString('es-AR')} más
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-border/40 bg-card/40 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-primary" />
            <p className="text-xs font-semibold">Tips</p>
          </div>
          <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
            <li>Combiná con Y para audiencias precisas, con O para alcance amplio.</li>
            <li>
              Separá tu base con <strong>Cómo llegó</strong>: walk-in (consumió en el local) vs
              reserva.
            </li>
            <li>
              Para difusiones por WhatsApp, sumá la condición <strong>Opt-in WhatsApp: sí</strong>.
            </li>
            <li>Las audiencias se recalculan automáticamente antes de cada envío.</li>
          </ul>
        </div>
      </aside>
    </div>
  )
}

function toGroup(f: AudienceFilter): Group {
  if (f.kind === 'group') return f
  return { kind: 'group', op: 'AND', nodes: [f] }
}

function GroupEditor({
  group,
  onChange,
  options,
  level = 0,
}: {
  group: Group
  onChange: (next: Group) => void
  options: AudienceBuilderOptions
  level?: number
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card/60 p-4 space-y-3',
        level === 0 ? 'border-border/60 card-hairline' : 'border-dashed border-border',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Combinar con
        </span>
        <Select
          value={group.op}
          onValueChange={(v) => onChange({ ...group, op: v as 'AND' | 'OR' })}
        >
          <SelectTrigger className="h-7 w-20 text-xs font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">Y</SelectItem>
            <SelectItem value="OR">O</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {group.nodes.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-secondary/20 px-3 py-3 text-xs text-muted-foreground">
            Agregá al menos una condición.
          </p>
        ) : null}
        {group.nodes.map((node, i) => (
          <NodeEditor
            // biome-ignore lint/suspicious/noArrayIndexKey: el nodo no tiene id estable
            key={`${level}-${i}`}
            node={node}
            options={options}
            onChange={(next) => {
              const copy = [...group.nodes]
              copy[i] = next
              onChange({ ...group, nodes: copy })
            }}
            onRemove={() => {
              const copy = group.nodes.filter((_, j) => j !== i)
              onChange({ ...group, nodes: copy })
            }}
            level={level + 1}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => onChange({ ...group, nodes: [...group.nodes, defaultCondition()] })}
        >
          <Plus className="size-3" />
          Condición
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1.5 text-muted-foreground"
          onClick={() =>
            onChange({
              ...group,
              nodes: [...group.nodes, { kind: 'group', op: 'AND', nodes: [defaultCondition()] }],
            })
          }
        >
          <Plus className="size-3" />
          Subgrupo
        </Button>
      </div>
    </div>
  )
}

function NodeEditor({
  node,
  options,
  onChange,
  onRemove,
  level,
}: {
  node: AudienceFilter
  options: AudienceBuilderOptions
  onChange: (next: AudienceFilter) => void
  onRemove: () => void
  level: number
}) {
  if (node.kind === 'group') {
    return (
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <GroupEditor group={node} onChange={onChange} options={options} level={level} />
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Quitar grupo"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    )
  }

  if (node.kind === 'static_list') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-warning/40 bg-warning/5 px-3 py-2.5 text-sm">
        <Users className="size-4 text-warning" />
        <span className="text-muted-foreground">
          Lista estática de <strong className="text-foreground">{node.customer_ids.length}</strong>{' '}
          clientes
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ml-auto size-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Quitar lista"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    )
  }

  const fieldOps = FIELD_OPS[node.field]

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/40 p-2">
      <Select
        value={node.field}
        onValueChange={(v) => {
          const field = v as ConditionField
          const def = defaultForField(field, options)
          onChange({ ...node, field, op: def.op, value: def.value })
        }}
      >
        <SelectTrigger className="h-9 w-full sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_GROUPS.map((grp) => (
            <SelectGroup key={grp.label}>
              <SelectLabel>{grp.label}</SelectLabel>
              {grp.fields.map((f) => (
                <SelectItem key={f} value={f}>
                  {FIELD_LABELS[f]}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <Select value={node.op} onValueChange={(v) => onChange({ ...node, op: v as ConditionOp })}>
        <SelectTrigger className="h-9 w-auto min-w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fieldOps.map((o) => (
            <SelectItem key={o} value={o}>
              {OP_LABELS[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ValueControl node={node} options={options} onChange={onChange} />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="ml-auto size-8 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label="Quitar condición"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

function needsValue(op: ConditionOp): boolean {
  return !['is_true', 'is_false', 'is_null', 'is_not_null'].includes(op)
}

/**
 * El control de valor cambia según el campo: dropdown para nivel/tag/evento y
 * enums (cómo llegó / origen); input numérico para el resto. Nunca un UUID crudo.
 */
function ValueControl({
  node,
  options,
  onChange,
}: {
  node: Condition
  options: AudienceBuilderOptions
  onChange: (next: AudienceFilter) => void
}) {
  if (!needsValue(node.op)) return null
  const setValue = (value: unknown) => onChange({ ...node, value })
  const current = node.value === null || node.value === undefined ? '' : String(node.value)

  const renderOptionSelect = (
    items: { id?: string; value?: string; name?: string; label?: string }[],
    placeholder: string,
    emptyHint: string,
  ) => {
    const opts = items.map((it) => ({
      value: it.id ?? it.value ?? '',
      label: it.name ?? it.label ?? '',
    }))
    if (opts.length === 0) {
      return (
        <span className="flex h-9 items-center px-2 text-xs text-muted-foreground">
          {emptyHint}
        </span>
      )
    }
    return (
      <Select value={current} onValueChange={setValue}>
        <SelectTrigger className="h-9 w-full sm:flex-1 sm:max-w-[220px]">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (node.field === 'current_tier_id') {
    return renderOptionSelect(options.tiers, 'Elegí un nivel', 'No hay niveles configurados.')
  }
  if (node.field === 'has_tag') {
    return renderOptionSelect(options.tags, 'Elegí un tag', 'No hay tags creados.')
  }
  if (node.field === 'attended_event_id') {
    return renderOptionSelect(options.events, 'Elegí un evento', 'No hay eventos.')
  }
  if (node.field === 'acquisition_channel') {
    return renderOptionSelect(CHANNEL_OPTIONS, 'Elegí', '')
  }
  if (node.field === 'source') {
    return renderOptionSelect(SOURCE_OPTIONS, 'Elegí', '')
  }

  // Numérico / texto libre.
  const numericFields: ConditionField[] = [
    'birth_month',
    'days_since_last_visit',
    'visits_count',
    'total_spent_cents',
    'points_balance',
    'lifetime_points',
    'created_days_ago',
  ]
  const isNumeric = numericFields.includes(node.field)
  return (
    <Input
      type={isNumeric ? 'number' : 'text'}
      inputMode={isNumeric ? 'numeric' : undefined}
      className="h-9 w-full sm:flex-1 sm:max-w-[200px]"
      value={current}
      onChange={(e) => setValue(e.target.value)}
      placeholder={node.field === 'birth_month' ? 'Mes (1-12)' : 'valor'}
    />
  )
}
