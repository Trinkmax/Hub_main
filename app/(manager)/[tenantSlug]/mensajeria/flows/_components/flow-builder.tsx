'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Clock,
  GitBranch,
  GripVertical,
  MessageSquareText,
  Plus,
  Tag as TagIcon,
  X,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createFlow, type FlowActionState, updateFlow } from '@/lib/flows/actions'
import type { FlowStepConfig, FlowTriggerConfig } from '@/lib/flows/schemas'

type Channel = { id: string; display_name: string | null; type: 'whatsapp' | 'instagram' }
type Template = { id: string; name: string; language: string; channel_id: string }
type Tag = { id: string; name: string }

const initial: FlowActionState = { ok: true }

function defaultStep(channels: Channel[], templates: Template[]): FlowStepConfig {
  const ch = channels[0]
  const tpl = templates.find((t) => !ch || t.channel_id === ch.id) ?? templates[0]
  if (ch && tpl) {
    return {
      type: 'send_template',
      channel_id: ch.id,
      template_id: tpl.id,
      variables: [],
    }
  }
  return { type: 'wait', minutes: 60 }
}

const STEP_LABEL: Record<FlowStepConfig['type'], string> = {
  send_template: 'Enviar template',
  wait: 'Esperar',
  condition: 'Condición',
  add_tag: 'Agregar tag',
}

const STEP_ICON: Record<FlowStepConfig['type'], typeof MessageSquareText> = {
  send_template: MessageSquareText,
  wait: Clock,
  condition: GitBranch,
  add_tag: TagIcon,
}

type WithRowId = FlowStepConfig & { __id: string }

export function FlowBuilder({
  tenantSlug,
  flowId,
  initialName,
  initialTrigger,
  initialSteps,
  initialActive,
  channels,
  templates,
  tags,
}: {
  tenantSlug: string
  flowId?: string
  initialName?: string
  initialTrigger?: FlowTriggerConfig
  initialSteps?: FlowStepConfig[]
  initialActive?: boolean
  channels: Channel[]
  templates: Template[]
  tags: Tag[]
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName ?? '')
  const [active, setActive] = useState<boolean>(initialActive ?? false)
  const [trigger, setTrigger] = useState<FlowTriggerConfig>(
    initialTrigger ?? { type: 'after_visit' },
  )
  const [steps, setSteps] = useState<WithRowId[]>(
    (initialSteps && initialSteps.length > 0
      ? initialSteps
      : [defaultStep(channels, templates)]
    ).map((s, i) => ({ ...s, __id: `init-${i}-${Math.random().toString(36).slice(2, 6)}` })),
  )

  const action = flowId ? updateFlow.bind(null, tenantSlug) : createFlow.bind(null, tenantSlug)
  const [state, formAction, pending] = useActionState(action, initial)

  useEffect(() => {
    if (state.ok && state.id) {
      toast.success(flowId ? 'Flow actualizado.' : 'Flow creado.')
      router.push(`/${tenantSlug}/mensajeria/flows`)
      router.refresh()
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state, flowId, router, tenantSlug])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const stepsJson = useMemo(() => JSON.stringify(steps.map(({ __id, ...rest }) => rest)), [steps])
  const triggerJson = useMemo(() => JSON.stringify(trigger), [trigger])

  const onDragEnd = (event: DragEndEvent) => {
    const { active: a, over } = event
    if (!over || a.id === over.id) return
    setSteps((items) => {
      const oldIndex = items.findIndex((it) => it.__id === a.id)
      const newIndex = items.findIndex((it) => it.__id === over.id)
      return arrayMove(items, oldIndex, newIndex)
    })
  }

  return (
    <form action={formAction} className="space-y-6">
      {flowId ? <input type="hidden" name="id" value={flowId} /> : null}
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="trigger" value={triggerJson} />
      <input type="hidden" name="steps" value={stepsJson} />
      <input type="hidden" name="active" value={active ? 'true' : 'false'} />

      <div className="card-hairline rounded-xl border bg-card p-5 space-y-4">
        <div className="grid gap-1.5">
          <Label
            htmlFor="flow-name"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Nombre del flow
          </Label>
          <Input
            id="flow-name"
            placeholder="Ej: Recordatorio post-visita"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </div>

        <TriggerEditor value={trigger} onChange={setTrigger} tags={tags} />

        <Label className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
          <Checkbox
            checked={active}
            onCheckedChange={(v) => setActive(v === true)}
            id="flow-active"
          />
          <div className="space-y-0.5">
            <span className="text-sm font-medium leading-none">Flow activo</span>
            <span className="block text-xs text-muted-foreground">
              Si está pausado, no se ejecuta aunque coincida el trigger.
            </span>
          </div>
        </Label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold tracking-tight">Pasos</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {steps.length} {steps.length === 1 ? 'paso' : 'pasos'}
          </span>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={steps.map((s) => s.__id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {steps.map((step, idx) => (
                <SortableStep
                  key={step.__id}
                  id={step.__id}
                  index={idx}
                  step={step}
                  channels={channels}
                  templates={templates}
                  tags={tags}
                  onChange={(next) =>
                    setSteps((arr) =>
                      arr.map((s) => (s.__id === step.__id ? { ...next, __id: s.__id } : s)),
                    )
                  }
                  onRemove={() =>
                    setSteps((arr) =>
                      arr.length > 1 ? arr.filter((s) => s.__id !== step.__id) : arr,
                    )
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={() =>
            setSteps((arr) => [
              ...arr,
              { ...defaultStep(channels, templates), __id: `new-${Date.now()}` },
            ])
          }
        >
          <Plus className="size-4" />
          Agregar paso
        </Button>
        <Button type="submit" disabled={pending} className="ml-auto" size="lg">
          {pending ? 'Guardando…' : 'Guardar flow'}
        </Button>
      </div>
    </form>
  )
}

function TriggerEditor({
  value,
  onChange,
  tags,
}: {
  value: FlowTriggerConfig
  onChange: (next: FlowTriggerConfig) => void
  tags: Tag[]
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <Zap className="size-3" />
        Trigger
      </Label>
      <div className="rounded-lg border border-border/60 bg-background/40 p-3 space-y-3">
        <Select
          value={value.type}
          onValueChange={(v) => {
            const t = v as FlowTriggerConfig['type']
            if (t === 'customer_inactive') onChange({ type: t, days: 30 })
            else if (t === 'event_starting') onChange({ type: t, hours_before: 24 })
            else if (t === 'tag_added') onChange({ type: t })
            else if (t === 'birthday') onChange({ type: t, offset_days: 0 })
            else onChange({ type: t })
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="customer_inactive">Cliente inactivo</SelectItem>
            <SelectItem value="birthday">Cumpleaños</SelectItem>
            <SelectItem value="after_visit">Después de una visita</SelectItem>
            <SelectItem value="event_starting">Evento próximo</SelectItem>
            <SelectItem value="tag_added">Tag agregado</SelectItem>
          </SelectContent>
        </Select>
        {value.type === 'birthday' ? (
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Cuándo enviar</Label>
            <Select
              value={String(value.offset_days)}
              onValueChange={(v) =>
                onChange({ type: 'birthday', offset_days: Number.parseInt(v, 10) })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="-30">30 días antes</SelectItem>
                <SelectItem value="-15">15 días antes</SelectItem>
                <SelectItem value="-7">7 días antes</SelectItem>
                <SelectItem value="-1">1 día antes</SelectItem>
                <SelectItem value="0">El día del cumple</SelectItem>
                <SelectItem value="1">1 día después</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              El cron evalúa cada día; quienes cumplan en N días recibirán el mensaje hoy.
            </p>
          </div>
        ) : null}
        {value.type === 'customer_inactive' ? (
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Días sin venir</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={value.days}
              onChange={(e) =>
                onChange({ type: 'customer_inactive', days: Math.max(1, Number(e.target.value)) })
              }
            />
          </div>
        ) : null}
        {value.type === 'event_starting' ? (
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Horas antes</Label>
            <Input
              type="number"
              min={1}
              max={168}
              value={value.hours_before}
              onChange={(e) =>
                onChange({
                  type: 'event_starting',
                  hours_before: Math.max(1, Number(e.target.value)),
                })
              }
            />
          </div>
        ) : null}
        {value.type === 'tag_added' ? (
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Tag</Label>
            <Select
              value={value.tag_id ?? '__any'}
              onValueChange={(v) =>
                onChange({ type: 'tag_added', tag_id: v === '__any' ? undefined : v })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Cualquier tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any">Cualquier tag</SelectItem>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SortableStep({
  id,
  index,
  step,
  channels,
  templates,
  tags,
  onChange,
  onRemove,
}: {
  id: string
  index: number
  step: WithRowId
  channels: Channel[]
  templates: Template[]
  tags: Tag[]
  onChange: (next: FlowStepConfig) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const Icon = STEP_ICON[step.type]

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card-hairline rounded-xl border bg-card p-4 transition-shadow ${isDragging ? 'shadow-lg ring-1 ring-ring/40' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
            aria-label="Reordenar"
          >
            <GripVertical className="size-4" />
          </button>
          <Badge variant="outline" className="font-mono tabular-nums">
            #{index + 1}
          </Badge>
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Icon className="size-3.5" />
          </div>
          <Select
            value={step.type}
            onValueChange={(v) =>
              onChange(buildDefaultForType(v as FlowStepConfig['type'], channels, templates, tags))
            }
          >
            <SelectTrigger className="h-8 w-44 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="send_template">{STEP_LABEL.send_template}</SelectItem>
              <SelectItem value="wait">{STEP_LABEL.wait}</SelectItem>
              <SelectItem value="condition">{STEP_LABEL.condition}</SelectItem>
              <SelectItem value="add_tag">{STEP_LABEL.add_tag}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Quitar paso"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="mt-3">
        <StepDetail
          step={step}
          onChange={onChange}
          channels={channels}
          templates={templates}
          tags={tags}
        />
      </div>
    </div>
  )
}

function buildDefaultForType(
  type: FlowStepConfig['type'],
  channels: Channel[],
  templates: Template[],
  tags: Tag[],
): FlowStepConfig {
  if (type === 'send_template') {
    const ch = channels[0]
    const tpl = templates.find((t) => !ch || t.channel_id === ch.id) ?? templates[0]
    return {
      type: 'send_template',
      channel_id: ch?.id ?? '',
      template_id: tpl?.id ?? '',
      variables: [],
    }
  }
  if (type === 'wait') return { type: 'wait', minutes: 60 }
  if (type === 'condition') {
    return { type: 'condition', field: 'customer.opt_in_marketing', op: 'is_true', else_offset: 1 }
  }
  return { type: 'add_tag', tag_id: tags[0]?.id ?? '' }
}

function StepDetail({
  step,
  onChange,
  channels,
  templates,
  tags,
}: {
  step: FlowStepConfig
  onChange: (next: FlowStepConfig) => void
  channels: Channel[]
  templates: Template[]
  tags: Tag[]
}) {
  if (step.type === 'send_template') {
    const filtered = templates.filter((t) => t.channel_id === step.channel_id)
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value={step.channel_id}
          onValueChange={(v) => onChange({ ...step, channel_id: v, template_id: '' })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Canal" />
          </SelectTrigger>
          <SelectContent>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.display_name ?? c.type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={step.template_id}
          onValueChange={(v) => onChange({ ...step, template_id: v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Template" />
          </SelectTrigger>
          <SelectContent>
            {filtered.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} <span className="text-muted-foreground">({t.language})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }
  if (step.type === 'wait') {
    return (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={43200}
          value={step.minutes}
          onChange={(e) => onChange({ type: 'wait', minutes: Math.max(1, Number(e.target.value)) })}
          className="w-32"
        />
        <span className="text-sm text-muted-foreground">minutos</span>
      </div>
    )
  }
  if (step.type === 'condition') {
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          value={step.field}
          onChange={(e) => onChange({ ...step, field: e.target.value })}
          placeholder="customer.field"
          className="font-mono text-xs"
        />
        <Select
          value={step.op}
          onValueChange={(v) => onChange({ ...step, op: v as typeof step.op })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="eq">=</SelectItem>
            <SelectItem value="neq">≠</SelectItem>
            <SelectItem value="gt">&gt;</SelectItem>
            <SelectItem value="gte">≥</SelectItem>
            <SelectItem value="lt">&lt;</SelectItem>
            <SelectItem value="lte">≤</SelectItem>
            <SelectItem value="is_true">es true</SelectItem>
            <SelectItem value="is_false">es false</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={
            typeof step.value === 'string' || typeof step.value === 'number'
              ? String(step.value)
              : ''
          }
          onChange={(e) => onChange({ ...step, value: e.target.value })}
          placeholder="valor"
        />
      </div>
    )
  }
  return (
    <Select value={step.tag_id} onValueChange={(v) => onChange({ ...step, tag_id: v })}>
      <SelectTrigger>
        <SelectValue placeholder="Tag" />
      </SelectTrigger>
      <SelectContent>
        {tags.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
