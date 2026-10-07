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
import { GripVertical, Plus, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FormError, FormSection } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SubmitButton } from '@/components/ui/submit-button'
import { Switch } from '@/components/ui/switch'
import { createFlow, type FlowActionState, updateFlow } from '@/lib/flows/actions'
import type { FlowStepConfig, FlowTriggerConfig } from '@/lib/flows/schemas'
import { ConditionEditor, WaitEditor } from './step-editors'
import {
  CHANNEL_TYPE_LABEL,
  KIND_CHIP_CLASS,
  KIND_ICON,
  KIND_LABEL,
  TRIGGER_TYPE_LABEL,
} from './step-meta'

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
  const [state, formAction] = useActionState(action, initial)

  useEffect(() => {
    if (state.ok && state.id) {
      toast.success(flowId ? 'Automatización guardada.' : 'Automatización creada.')
      router.push(`/${tenantSlug}/mensajeria/flows`)
      router.refresh()
    }
    // El error queda en la página (FormError), no en un aviso que se va.
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
    <form action={formAction} className="flex flex-col gap-8">
      {flowId ? <input type="hidden" name="id" value={flowId} /> : null}
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="trigger" value={triggerJson} />
      <input type="hidden" name="steps" value={stepsJson} />
      <input type="hidden" name="active" value={active ? 'true' : 'false'} />

      <FormError
        title="No se pudo guardar la automatización"
        message={state.ok ? null : state.message}
      />

      <Card>
        <Field label="Nombre de la automatización">
          <Input
            placeholder="Ej.: Gracias por venir"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </Field>

        <TriggerEditor value={trigger} onChange={setTrigger} tags={tags} />

        <Field
          layout="toggle"
          label="Automatización activa"
          hint="Si está en pausa, no manda nada aunque se cumpla el disparador."
        >
          <Switch checked={active} onCheckedChange={(v) => setActive(v === true)} />
        </Field>
      </Card>

      <FormSection
        title="Pasos"
        description="Se hacen en orden, de arriba para abajo. Arrastrá desde la manija para reordenar."
      >
        <p className="-mt-2 type-small tabular-nums text-muted-foreground">
          {steps.length} {steps.length === 1 ? 'paso' : 'pasos'}
        </p>
        <DndContext
          id="flow-builder"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={steps.map((s) => s.__id)} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col gap-2" aria-label="Pasos de la automatización">
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
                  onRemove={
                    steps.length > 1
                      ? () => setSteps((arr) => arr.filter((s) => s.__id !== step.__id))
                      : undefined
                  }
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setSteps((arr) => [
                ...arr,
                { ...defaultStep(channels, templates), __id: `new-${Date.now()}` },
              ])
            }
          >
            <Plus aria-hidden />
            Agregar paso
          </Button>
        </div>
      </FormSection>

      {/* Adentro del marco de WhatsApp las acciones van en línea: una barra fija
          abajo taparía las pestañas de Mensajería del celular. */}
      <FormActions sticky={false}>
        <Button asChild variant="secondary">
          <Link href={`/${tenantSlug}/mensajeria/flows`}>Cancelar</Link>
        </Button>
        <SubmitButton pendingText="Guardando…">Guardar automatización</SubmitButton>
      </FormActions>
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
    <div className="flex flex-col gap-4">
      <Field label="¿Cuándo se manda?">
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
            {(Object.keys(TRIGGER_TYPE_LABEL) as Array<FlowTriggerConfig['type']>).map((t) => (
              <SelectItem key={t} value={t}>
                {TRIGGER_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {value.type === 'birthday' ? (
        <Field
          label="¿Qué día se manda?"
          hint="Se revisa una vez por día y se le manda a quien le toque."
        >
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
        </Field>
      ) : null}
      {value.type === 'customer_inactive' ? (
        <Field label="¿Cuántos días sin venir?" hint="Entre 1 y 365.">
          <NumberField
            min={1}
            max={365}
            suffix="días"
            className="sm:max-w-56"
            value={value.days}
            onValueChange={(n) => {
              if (n !== null) onChange({ type: 'customer_inactive', days: Math.max(1, n) })
            }}
          />
        </Field>
      ) : null}
      {value.type === 'event_starting' ? (
        <Field label="¿Cuántas horas antes?" hint="Entre 1 y 168 (una semana).">
          <NumberField
            min={1}
            max={168}
            suffix="horas"
            className="sm:max-w-56"
            value={value.hours_before}
            onValueChange={(n) => {
              if (n !== null) onChange({ type: 'event_starting', hours_before: Math.max(1, n) })
            }}
          />
        </Field>
      ) : null}
      {value.type === 'tag_added' ? (
        <Field label="¿Qué etiqueta?">
          <Select
            value={value.tag_id ?? '__any'}
            onValueChange={(v) =>
              onChange({ type: 'tag_added', tag_id: v === '__any' ? undefined : v })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Cualquier etiqueta" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any">Cualquier etiqueta</SelectItem>
              {tags.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
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
  /** Sin `onRemove` (queda un solo paso) no hay botón de quitar. */
  onRemove?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const Icon = KIND_ICON[step.type]

  return (
    <li
      ref={setNodeRef}
      style={style}
      // Mientras se arrastra flota (sombra de lo que se mueve); quieta, solo el pelo.
      className={`rounded-xl border bg-card p-4 ${isDragging ? 'relative z-10 border-primary shadow-float' : 'border-border'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="relative hit-area cursor-grab rounded-sm p-1 text-muted-foreground hover:bg-hover hover:text-foreground active:cursor-grabbing"
            aria-label={`Reordenar el paso ${index + 1}`}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
          <Badge appearance="outline" className="font-mono tabular-nums">
            #{index + 1}
          </Badge>
          <span
            className={`flex size-7 items-center justify-center rounded-md border ${KIND_CHIP_CLASS[step.type]}`}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
          <Select
            value={step.type}
            onValueChange={(v) =>
              onChange(buildDefaultForType(v as FlowStepConfig['type'], channels, templates, tags))
            }
          >
            <SelectTrigger size="sm" className="w-44" aria-label={`Tipo del paso ${index + 1}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="send_template">{KIND_LABEL.send_template}</SelectItem>
              <SelectItem value="wait">{KIND_LABEL.wait}</SelectItem>
              <SelectItem value="condition">{KIND_LABEL.condition}</SelectItem>
              <SelectItem value="add_tag">{KIND_LABEL.add_tag}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {onRemove ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onRemove}
            aria-label={`Quitar el paso ${index + 1}`}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>

      <div className="mt-4">
        <StepDetail
          step={step}
          onChange={onChange}
          channels={channels}
          templates={templates}
          tags={tags}
        />
      </div>
    </li>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="¿Por dónde sale?"
          hint={
            channels.length === 0
              ? 'No tenés ningún canal conectado. Conectá WhatsApp desde Canales.'
              : undefined
          }
        >
          <Select
            value={step.channel_id}
            onValueChange={(v) => onChange({ ...step, channel_id: v, template_id: '' })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Elegí el canal" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.display_name ?? CHANNEL_TYPE_LABEL[c.type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="¿Qué mensaje se manda?"
          hint={
            step.channel_id !== '' && filtered.length === 0
              ? 'No hay mensajes aprobados para este canal. Crealos desde Plantillas.'
              : undefined
          }
        >
          <Select
            value={step.template_id}
            onValueChange={(v) => onChange({ ...step, template_id: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Elegí el mensaje" />
            </SelectTrigger>
            <SelectContent>
              {filtered.map((t) => (
                <SelectItem key={t.id} value={t.id} description={t.language}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    )
  }
  if (step.type === 'wait') {
    return (
      <WaitEditor
        minutes={step.minutes}
        onChange={(minutes) => onChange({ type: 'wait', minutes })}
      />
    )
  }
  if (step.type === 'condition') {
    return (
      <div className="flex flex-col gap-3">
        <ConditionEditor
          field={step.field}
          op={step.op}
          value={step.value}
          onPatch={(patch) =>
            onChange({
              ...step,
              ...('field' in patch && patch.field !== undefined ? { field: patch.field } : {}),
              ...('op' in patch && patch.op !== undefined
                ? { op: patch.op as typeof step.op }
                : {}),
              ...('value' in patch ? { value: patch.value } : {}),
            })
          }
        />
        <p className="type-caption text-muted-foreground">
          Antes de seguir, se revisa este dato del cliente.
        </p>
      </div>
    )
  }
  return (
    <Field
      label="¿Qué etiqueta le ponemos?"
      hint={
        tags.length === 0
          ? 'Todavía no tenés etiquetas. Crealas desde Etiquetas y volvé acá.'
          : undefined
      }
    >
      <Select value={step.tag_id} onValueChange={(v) => onChange({ ...step, tag_id: v })}>
        <SelectTrigger>
          <SelectValue placeholder="Elegí una etiqueta" />
        </SelectTrigger>
        <SelectContent>
          {tags.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
