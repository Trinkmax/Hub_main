'use client'

import { Loader2, Plus, Sparkles, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
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
  type AudienceFilter,
  CONDITION_FIELDS,
  CONDITION_OPS,
  type ConditionField,
  type ConditionOp,
  EMPTY_FILTER,
} from '@/lib/audiences/schemas'
import { cn } from '@/lib/utils'

type Group = Extract<AudienceFilter, { kind: 'group' }>
type Condition = Extract<AudienceFilter, { kind: 'condition' }>

const FIELD_LABELS: Record<ConditionField, string> = {
  opt_in_marketing: 'Opt-in marketing',
  birth_month: 'Mes de cumpleaños',
  days_since_last_visit: 'Días desde última visita',
  visits_count: 'Cantidad de visitas',
  total_spent_cents: 'Gasto total (cents)',
  points_balance: 'Saldo de puntos',
  created_days_ago: 'Días desde creación',
  has_tag: 'Tiene tag (uuid)',
  attended_event_id: 'Asistió a evento (uuid)',
  source: 'Origen (qr/manual/import)',
}

const OP_LABELS: Record<ConditionOp, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'en',
  not_in: 'no en',
  is_true: 'es verdadero',
  is_false: 'es falso',
  is_null: 'es nulo',
  is_not_null: 'no es nulo',
}

function defaultCondition(): Condition {
  return { kind: 'condition', field: 'visits_count', op: 'gte', value: 1 }
}

type BuilderProps = {
  tenantSlug: string
  initialName?: string
  initialFilters?: AudienceFilter
  hiddenIdField?: string
  submitLabel: string
  submitName?: string
}

export function AudienceBuilder({
  tenantSlug,
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
          <GroupEditor group={root} onChange={setRoot} />
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
                  <p className="mt-3 break-all text-[10px] font-mono leading-relaxed text-muted-foreground/70">
                    Muestra: {preview.sample.slice(0, 8).join(', ')}
                    {preview.sample.length > 8 ? '…' : ''}
                  </p>
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
              Para difusiones de marketing, agregá la condición “Opt-in marketing es verdadero”.
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
  level = 0,
}: {
  group: Group
  onChange: (next: Group) => void
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
  onChange,
  onRemove,
  level,
}: {
  node: AudienceFilter
  onChange: (next: AudienceFilter) => void
  onRemove: () => void
  level: number
}) {
  if (node.kind === 'group') {
    return (
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <GroupEditor group={node} onChange={onChange} level={level} />
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

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/40 p-2">
      <Select
        value={node.field}
        onValueChange={(v) => onChange({ ...node, field: v as ConditionField })}
      >
        <SelectTrigger className="h-9 w-full sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONDITION_FIELDS.map((f) => (
            <SelectItem key={f} value={f}>
              {FIELD_LABELS[f]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={node.op} onValueChange={(v) => onChange({ ...node, op: v as ConditionOp })}>
        <SelectTrigger className="h-9 w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONDITION_OPS.map((o) => (
            <SelectItem key={o} value={o}>
              {OP_LABELS[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needsValue(node.op) ? (
        <Input
          className="h-9 w-full sm:flex-1 sm:max-w-[200px]"
          value={node.value === null || node.value === undefined ? '' : String(node.value)}
          onChange={(e) => onChange({ ...node, value: e.target.value })}
          placeholder="valor"
        />
      ) : null}
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
