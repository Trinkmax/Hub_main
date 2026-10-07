'use client'

import {
  addEdge,
  Background,
  ControlButton,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  type OnConnect,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Maximize, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useTheme } from '@/components/theme/theme-provider'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { saveFlowGraph } from '@/lib/flows/graph-actions'
import type { FlowEdge as DBFlowEdge, FlowNode as DBFlowNode } from '@/lib/flows/graph-queries'
import type { FlowGraphNode } from '@/lib/flows/graph-schemas'
import type { FlowTriggerConfig } from '@/lib/flows/schemas'
import { ConditionEditor, WaitEditor } from './step-editors'
import {
  CHANNEL_TYPE_LABEL,
  conditionSummary,
  KIND_CHIP_CLASS,
  KIND_HINT,
  KIND_ICON,
  KIND_LABEL,
  type StepKind,
  TRIGGER_TYPE_LABEL,
  triggerSummary,
  waitSummary,
} from './step-meta'

// ─── Types ───────────────────────────────────────────────────────────────────

type Channel = { id: string; display_name: string | null; type: 'whatsapp' | 'instagram' }
type Template = { id: string; name: string; language: string; channel_id: string }
type Tag = { id: string; name: string }

type NodeKind = StepKind

// Each custom node's data payload
type TriggerData = { kind: 'trigger'; config: FlowTriggerConfig }
type SendTemplateData = {
  kind: 'send_template'
  config: { channel_id: string; template_id: string; variables: string[] }
}
type WaitData = { kind: 'wait'; config: { minutes: number } }
type ConditionData = {
  kind: 'condition'
  config: { field: string; op: string; value?: unknown }
}
type AddTagData = { kind: 'add_tag'; config: { tag_id: string } }

type FlowNodeData = TriggerData | SendTemplateData | WaitData | ConditionData | AddTagData

type FlowNode = Node<FlowNodeData, NodeKind>

// ─── Shared props for node rendering context ──────────────────────────────────

// We thread through channels/templates/tags via a module-level ref because
// React Flow's nodeTypes must be defined outside the render function and
// cannot receive extra props. This is the idiomatic pattern for custom data.

let _channels: Channel[] = []
let _templates: Template[] = []
let _tags: Tag[] = []
let _onNodeDataChange: (id: string, data: FlowNodeData) => void = () => {}
let _onNodeDelete: (id: string) => void = () => {}

// ─── Custom node components ───────────────────────────────────────────────────

function NodeShell({
  id,
  kind,
  selected,
  children,
}: {
  id: string
  kind: NodeKind
  selected?: boolean
  children?: React.ReactNode
}) {
  const Icon = KIND_ICON[kind]
  const isTrigger = kind === 'trigger'

  return (
    // Elegida: borde y anillo verdes (vocabulario de selección del kit). Sin
    // sombra: las tarjetas del lienzo son quietas, el pelo alcanza.
    <div
      className={`relative w-56 rounded-xl border bg-card ${
        selected ? 'border-primary ring-1 ring-primary' : 'border-border-strong'
      }`}
    >
      {/* Target handle — all nodes except trigger accept incoming */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="!size-3 !rounded-full !border-2 !border-border !bg-background"
        />
      )}

      <div className="flex items-center gap-2 rounded-t-xl border-b border-border px-3 py-2">
        <div
          className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${KIND_CHIP_CLASS[kind]}`}
        >
          <Icon className="size-3.5" aria-hidden />
        </div>
        <span className="flex-1 truncate text-xs font-semibold">{KIND_LABEL[kind]}</span>
        {!isTrigger && (
          <button
            type="button"
            onClick={() => _onNodeDelete(id)}
            className="nodrag relative hit-area rounded-sm p-0.5 text-muted-foreground hover:text-destructive-text"
            aria-label={`Borrar el paso «${KIND_LABEL[kind]}»`}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className="px-3 py-2 text-xs">{children}</div>

      {/* Condition node: two named source handles ("Sí" / "No") */}
      {kind === 'condition' ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            style={{ left: '30%' }}
            className="!size-3 !rounded-full !border-2 !border-success !bg-background"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            style={{ left: '70%' }}
            className="!size-3 !rounded-full !border-2 !border-destructive !bg-background"
          />
          <div className="flex justify-between px-3 pb-2 text-xs font-medium">
            <span className="text-success-text">Sí</span>
            <span className="text-destructive-text">No</span>
          </div>
        </>
      ) : (
        /* All other nodes: one source handle */
        <Handle
          type="source"
          position={Position.Bottom}
          className="!size-3 !rounded-full !border-2 !border-border !bg-background"
        />
      )}
    </div>
  )
}

// ─── Trigger node ─────────────────────────────────────────────────────────────

function TriggerNodeComponent({ id, data, selected }: NodeProps<FlowNode>) {
  if (data.kind !== 'trigger') return null

  return (
    <NodeShell id={id} kind="trigger" selected={selected}>
      <span className="text-muted-foreground">{triggerSummary(data.config, _tags)}</span>
    </NodeShell>
  )
}

// ─── Send template node ───────────────────────────────────────────────────────

function SendTemplateNodeComponent({ id, data, selected }: NodeProps<FlowNode>) {
  if (data.kind !== 'send_template') return null
  const { channel_id, template_id } = data.config
  const channel = _channels.find((c) => c.id === channel_id)
  const template = _templates.find((t) => t.id === template_id)

  return (
    <NodeShell id={id} kind="send_template" selected={selected}>
      <div className="space-y-0.5">
        {channel ? (
          <div className="truncate text-muted-foreground">
            {channel.display_name ?? CHANNEL_TYPE_LABEL[channel.type]}
          </div>
        ) : (
          <div className="truncate font-medium text-warning-text">Falta elegir el canal</div>
        )}
        {template ? (
          <div className="truncate font-medium text-foreground">{template.name}</div>
        ) : channel ? (
          <div className="truncate font-medium text-warning-text">Falta elegir el mensaje</div>
        ) : null}
      </div>
    </NodeShell>
  )
}

// ─── Wait node ────────────────────────────────────────────────────────────────

function WaitNodeComponent({ id, data, selected }: NodeProps<FlowNode>) {
  if (data.kind !== 'wait') return null

  return (
    <NodeShell id={id} kind="wait" selected={selected}>
      <span className="text-muted-foreground">{waitSummary(data.config.minutes)}</span>
    </NodeShell>
  )
}

// ─── Condition node ───────────────────────────────────────────────────────────

function ConditionNodeComponent({ id, data, selected }: NodeProps<FlowNode>) {
  if (data.kind !== 'condition') return null
  const { field, op, value } = data.config

  return (
    <NodeShell id={id} kind="condition" selected={selected}>
      <span className="text-muted-foreground">{conditionSummary(field, op, value)}</span>
    </NodeShell>
  )
}

// ─── Add tag node ─────────────────────────────────────────────────────────────

function AddTagNodeComponent({ id, data, selected }: NodeProps<FlowNode>) {
  if (data.kind !== 'add_tag') return null
  const tag = _tags.find((t) => t.id === data.config.tag_id)

  return (
    <NodeShell id={id} kind="add_tag" selected={selected}>
      {tag ? (
        <span className="text-muted-foreground">“{tag.name}”</span>
      ) : (
        <span className="text-warning-text">Falta elegir la etiqueta</span>
      )}
    </NodeShell>
  )
}

// ─── nodeTypes map (must be OUTSIDE any component) ───────────────────────────

const nodeTypes = {
  trigger: TriggerNodeComponent,
  send_template: SendTemplateNodeComponent,
  wait: WaitNodeComponent,
  condition: ConditionNodeComponent,
  add_tag: AddTagNodeComponent,
}

// ─── Canvas controls with es-AR labels ───────────────────────────────────────

function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  return (
    <Controls
      showZoom={false}
      showFitView={false}
      showInteractive={false}
      aria-label="Controles del lienzo"
    >
      <ControlButton onClick={() => zoomIn()} aria-label="Acercar" title="Acercar">
        <ZoomIn />
      </ControlButton>
      <ControlButton onClick={() => zoomOut()} aria-label="Alejar" title="Alejar">
        <ZoomOut />
      </ControlButton>
      <ControlButton
        onClick={() => fitView({ padding: 0.2 })}
        aria-label="Ver todo"
        title="Ver todo"
      >
        <Maximize />
      </ControlButton>
    </Controls>
  )
}

// ─── Config panel for selected node ──────────────────────────────────────────

function NodeConfigPanel({
  node,
  channels,
  templates,
  tags,
  onChange,
}: {
  node: FlowNode
  channels: Channel[]
  templates: Template[]
  tags: Tag[]
  onChange: (data: FlowNodeData) => void
}) {
  const { type: kind, data } = node

  if (kind === 'trigger' && data.kind === 'trigger') {
    return (
      <TriggerConfig
        config={data.config}
        onChange={(cfg) => onChange({ kind: 'trigger', config: cfg })}
        tags={tags}
      />
    )
  }

  if (kind === 'send_template' && data.kind === 'send_template') {
    return (
      <SendTemplateConfig
        config={data.config}
        channels={channels}
        templates={templates}
        onChange={(cfg) => onChange({ kind: 'send_template', config: cfg })}
      />
    )
  }

  if (kind === 'wait' && data.kind === 'wait') {
    return (
      <WaitEditor
        minutes={data.config.minutes}
        onChange={(minutes) => onChange({ kind: 'wait', config: { minutes } })}
      />
    )
  }

  if (kind === 'condition' && data.kind === 'condition') {
    return (
      <div className="space-y-3">
        <ConditionEditor
          field={data.config.field}
          op={data.config.op}
          value={data.config.value}
          onPatch={(patch) => onChange({ kind: 'condition', config: { ...data.config, ...patch } })}
        />
        <p className="type-caption text-muted-foreground">
          Desde este paso salen dos caminos: el punto verde (Sí) sigue si se cumple; el rojo (No),
          si no.
        </p>
      </div>
    )
  }

  if (kind === 'add_tag' && data.kind === 'add_tag') {
    return (
      <AddTagConfig
        config={data.config}
        tags={tags}
        onChange={(cfg) => onChange({ kind: 'add_tag', config: cfg })}
      />
    )
  }

  return null
}

function TriggerConfig({
  config,
  onChange,
  tags,
}: {
  config: FlowTriggerConfig
  onChange: (c: FlowTriggerConfig) => void
  tags: Tag[]
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="¿Cuándo arranca?">
        <Select
          value={config.type}
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

      {config.type === 'birthday' && (
        <Field
          label="¿Qué día se manda?"
          hint="Se revisa una vez por día y se le manda a quien le toque."
        >
          <Select
            value={String(config.offset_days)}
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
      )}

      {config.type === 'customer_inactive' && (
        <Field label="¿Cuántos días sin venir?" hint="Entre 1 y 365.">
          <NumberField
            min={1}
            max={365}
            suffix="días"
            value={config.days}
            onValueChange={(n) => {
              if (n !== null) onChange({ type: 'customer_inactive', days: Math.max(1, n) })
            }}
          />
        </Field>
      )}

      {config.type === 'event_starting' && (
        <Field label="¿Cuántas horas antes?" hint="Entre 1 y 168 (una semana).">
          <NumberField
            min={1}
            max={168}
            suffix="horas"
            value={config.hours_before}
            onValueChange={(n) => {
              if (n !== null) onChange({ type: 'event_starting', hours_before: Math.max(1, n) })
            }}
          />
        </Field>
      )}

      {config.type === 'tag_added' && (
        <Field label="¿Qué etiqueta?">
          <Select
            value={config.tag_id ?? '__any'}
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
      )}
    </div>
  )
}

function SendTemplateConfig({
  config,
  channels,
  templates,
  onChange,
}: {
  config: SendTemplateData['config']
  channels: Channel[]
  templates: Template[]
  onChange: (c: SendTemplateData['config']) => void
}) {
  const filtered = templates.filter((t) => t.channel_id === config.channel_id)
  return (
    <div className="flex flex-col gap-4">
      <Field
        label="¿Por dónde sale?"
        hint={
          channels.length === 0
            ? 'No tenés ningún canal conectado. Conectá WhatsApp desde Canales.'
            : undefined
        }
      >
        <Select
          value={config.channel_id}
          onValueChange={(v) => onChange({ ...config, channel_id: v, template_id: '' })}
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
          config.channel_id !== '' && filtered.length === 0
            ? 'No hay mensajes aprobados para este canal. Crealos desde Plantillas.'
            : 'Solo se pueden mandar mensajes que WhatsApp ya aprobó.'
        }
      >
        <Select
          value={config.template_id}
          onValueChange={(v) => onChange({ ...config, template_id: v })}
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

function AddTagConfig({
  config,
  tags,
  onChange,
}: {
  config: AddTagData['config']
  tags: Tag[]
  onChange: (c: AddTagData['config']) => void
}) {
  return (
    <Field
      label="¿Qué etiqueta le ponemos?"
      hint={
        tags.length === 0
          ? 'Todavía no tenés etiquetas. Crealas desde Etiquetas y volvé acá.'
          : undefined
      }
    >
      <Select value={config.tag_id} onValueChange={(v) => onChange({ tag_id: v })}>
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

// ─── Default data for new nodes ───────────────────────────────────────────────

function defaultDataForKind(
  kind: NodeKind,
  channels: Channel[],
  templates: Template[],
  tags: Tag[],
): FlowNodeData {
  if (kind === 'trigger') return { kind: 'trigger', config: { type: 'after_visit' } }
  if (kind === 'send_template') {
    const ch = channels[0]
    const tpl = templates.find((t) => !ch || t.channel_id === ch.id) ?? templates[0]
    return {
      kind: 'send_template',
      config: { channel_id: ch?.id ?? '', template_id: tpl?.id ?? '', variables: [] },
    }
  }
  if (kind === 'wait') return { kind: 'wait', config: { minutes: 60 } }
  if (kind === 'condition')
    return { kind: 'condition', config: { field: 'customer.opt_in_marketing', op: 'is_true' } }
  return { kind: 'add_tag', config: { tag_id: tags[0]?.id ?? '' } }
}

// ─── Props ────────────────────────────────────────────────────────────────────

type InitialGraph = {
  id: string
  name: string
  active: boolean
  nodes: Array<DBFlowNode>
  edges: Array<DBFlowEdge>
  trigger: FlowTriggerConfig
}

interface FlowGraphEditorProps {
  tenantSlug: string
  initial?: InitialGraph
  channels: Channel[]
  templates: Template[]
  tags: Tag[]
}

// ─── Convert DB graph → ReactFlow nodes/edges ─────────────────────────────────

function dbNodesToRF(dbNodes: DBFlowNode[], trigger: FlowTriggerConfig): FlowNode[] {
  return dbNodes.map((n) => {
    let data: FlowNodeData

    if (n.kind === 'trigger') {
      data = { kind: 'trigger', config: trigger }
    } else if (n.kind === 'send_template') {
      const c = n.config as { channel_id?: string; template_id?: string; variables?: string[] }
      data = {
        kind: 'send_template',
        config: {
          channel_id: c.channel_id ?? '',
          template_id: c.template_id ?? '',
          variables: c.variables ?? [],
        },
      }
    } else if (n.kind === 'wait') {
      const c = n.config as { minutes?: number }
      data = { kind: 'wait', config: { minutes: c.minutes ?? 60 } }
    } else if (n.kind === 'condition') {
      const c = n.config as { field?: string; op?: string; value?: unknown }
      data = {
        kind: 'condition',
        config: { field: c.field ?? '', op: c.op ?? 'is_true', value: c.value },
      }
    } else {
      // add_tag
      const c = n.config as { tag_id?: string }
      data = { kind: 'add_tag', config: { tag_id: c.tag_id ?? '' } }
    }

    return {
      id: n.id,
      type: n.kind as NodeKind,
      position: n.position,
      data,
    } satisfies FlowNode
  })
}

function dbEdgesToRF(dbEdges: DBFlowEdge[]): Edge[] {
  return dbEdges.map((e) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    sourceHandle: e.source_handle ?? null,
    type: 'smoothstep',
  }))
}

// ─── Main editor component ────────────────────────────────────────────────────

export function FlowGraphEditor({
  tenantSlug,
  initial,
  channels,
  templates,
  tags,
}: FlowGraphEditorProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { resolved } = useTheme()

  // Thread through shared refs for custom node access
  _channels = channels
  _templates = templates
  _tags = tags

  // ── Initial nodes/edges from DB or brand-new graph ─────────────────────────
  const initialRFNodes: FlowNode[] = initial
    ? dbNodesToRF(initial.nodes, initial.trigger)
    : [
        {
          id: crypto.randomUUID(),
          type: 'trigger',
          position: { x: 200, y: 80 },
          data: { kind: 'trigger', config: { type: 'after_visit' } },
        },
      ]

  const initialRFEdges: Edge[] = initial ? dbEdgesToRF(initial.edges) : []

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initialRFNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialRFEdges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [flowName, setFlowName] = useState(initial?.name ?? '')
  const [active, setActive] = useState(initial?.active ?? false)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Wire up shared callbacks
  _onNodeDataChange = useCallback(
    (id: string, data: FlowNodeData) => {
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data } : n)))
    },
    [setNodes],
  )

  _onNodeDelete = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id))
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
      setSelectedNodeId((prev) => (prev === id ? null : prev))
    },
    [setNodes, setEdges],
  )

  const onConnect: OnConnect = useCallback(
    (params) =>
      setEdges((eds) => addEdge({ ...params, id: crypto.randomUUID(), type: 'smoothstep' }, eds)),
    [setEdges],
  )

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null
  const hasTrigger = nodes.some((n) => n.type === 'trigger')

  // ── Add node from palette ──────────────────────────────────────────────────
  const addNode = (kind: NodeKind) => {
    // Only one trigger allowed
    if (kind === 'trigger' && hasTrigger) {
      toast.error('Ya hay un disparador. Solo puede haber uno: es lo que arranca todo.')
      return
    }
    const newNode: FlowNode = {
      id: crypto.randomUUID(),
      type: kind,
      position: { x: 100 + Math.random() * 200, y: 200 + nodes.length * 100 },
      data: defaultDataForKind(kind, channels, templates, tags),
      selected: true,
    }
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), newNode])
    setSelectedNodeId(newNode.id)
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = () => {
    setValidationError(null)

    if (!flowName.trim()) {
      const msg = 'Ponele un nombre a la automatización antes de guardar.'
      setValidationError(msg)
      toast.error(msg)
      return
    }

    // Find trigger node for the trigger config
    const triggerNode = nodes.find((n) => n.type === 'trigger')
    if (!triggerNode || triggerNode.data.kind !== 'trigger') {
      const msg =
        'Falta el disparador: el paso que dice cuándo arranca. Agregalo desde el panel de la izquierda.'
      setValidationError(msg)
      toast.error(msg)
      return
    }

    const payload = {
      id: initial?.id,
      name: flowName,
      active,
      trigger: triggerNode.data.config,
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: (n.type ?? n.data.kind) as FlowGraphNode['kind'],
        position: n.position,
        config: n.data.kind === 'trigger' ? {} : (n.data.config as Record<string, unknown>),
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: (e.sourceHandle ?? null) as 'true' | 'false' | null,
      })),
    }

    startTransition(async () => {
      const result = await saveFlowGraph(tenantSlug, payload)
      if (result.ok) {
        toast.success(initial?.id ? 'Automatización guardada.' : 'Automatización creada.')
        router.push(`/${tenantSlug}/mensajeria/flows`)
        router.refresh()
      } else {
        toast.error(result.message)
        setValidationError(result.message)
      }
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-[28rem] flex-1 flex-col overflow-clip rounded-xl border border-border bg-card">
      {/* Barra de arriba: nombre, prendida/en pausa y guardar */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Input
          size="sm"
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          placeholder="Nombre, ej.: Gracias por venir"
          aria-label="Nombre de la automatización"
          className="max-w-64"
          maxLength={80}
        />

        <div
          className="flex items-center gap-2"
          title="Si está en pausa, no manda nada aunque se cumpla el disparador."
        >
          <Switch
            id="graph-flow-active"
            checked={active}
            onCheckedChange={(v) => setActive(v === true)}
            aria-describedby="graph-flow-active-hint"
          />
          <Label htmlFor="graph-flow-active">{active ? 'Activa' : 'En pausa'}</Label>
          <span id="graph-flow-active-hint" className="sr-only">
            Si está en pausa, no manda nada aunque se cumpla el disparador.
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/${tenantSlug}/mensajeria/flows`)}
          >
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} loading={isPending} loadingText="Guardando…">
            Guardar
          </Button>
        </div>
      </div>

      {/* El motivo entero, en la página: antes era una pastilla recortada. */}
      {validationError ? (
        <Callout tone="danger" announce="assertive" className="mx-4 mt-3 shrink-0">
          {validationError}
        </Callout>
      ) : null}

      {/* Canvas + side panel */}
      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        <div className="flex w-44 shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-border bg-card p-3">
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-2 type-caption font-medium text-muted-foreground">
              Agregar paso
            </legend>
            {(['trigger', 'send_template', 'wait', 'condition', 'add_tag'] as NodeKind[]).map(
              (kind) => {
                const Icon = KIND_ICON[kind]
                const disabled = kind === 'trigger' && hasTrigger
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => addNode(kind)}
                    disabled={disabled}
                    title={disabled ? 'Ya tenés un disparador' : KIND_HINT[kind]}
                    className="flex min-h-11 items-start gap-2 rounded-lg border border-border bg-background px-2 py-2 text-left transition-colors hover:border-border-strong hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${KIND_CHIP_CLASS[kind]}`}
                    >
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium leading-tight">
                        {KIND_LABEL[kind]}
                      </span>
                      <span className="block text-xs leading-tight text-muted-foreground">
                        {disabled ? 'Ya tenés uno' : KIND_HINT[kind]}
                      </span>
                    </span>
                  </button>
                )
              },
            )}
          </fieldset>
          <p className="mt-2 text-xs leading-snug text-muted-foreground">
            Uní los pasos arrastrando desde el puntito de abajo de cada tarjeta.
          </p>
        </div>

        {/* React Flow canvas */}
        <div className="relative min-h-0 flex-1">
          <ReactFlow
            colorMode={resolved}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            deleteKeyCode={null}
          >
            <Background gap={16} className="opacity-40" />
            <CanvasControls />
          </ReactFlow>
          {nodes.length === 1 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
              <p className="rounded-full border border-border bg-card px-3.5 py-1.5 text-center text-xs text-muted-foreground">
                Agregá un paso desde el panel de la izquierda y unilo al disparador arrastrando
                desde el puntito de abajo.
              </p>
            </div>
          )}
        </div>

        {/* Config panel */}
        {selectedNode && (
          <section
            aria-label="Ajustes del paso"
            className="flex w-72 shrink-0 flex-col border-l border-border bg-card"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                {(() => {
                  const kind = selectedNode.type as NodeKind
                  const Icon = KIND_ICON[kind]
                  return (
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${KIND_CHIP_CLASS[kind]}`}
                    >
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                  )
                })()}
                <div className="min-w-0">
                  <p className="type-caption text-muted-foreground">Ajustes del paso</p>
                  <h2 className="truncate text-sm font-semibold">
                    {KIND_LABEL[selectedNode.type as NodeKind]}
                  </h2>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {selectedNode.type !== 'trigger' && (
                  <Button
                    variant="danger-ghost"
                    size="icon-sm"
                    onClick={() => _onNodeDelete(selectedNode.id)}
                    aria-label="Borrar este paso"
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setSelectedNodeId(null)}
                  aria-label="Cerrar los ajustes del paso"
                >
                  <X aria-hidden />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <NodeConfigPanel
                node={selectedNode}
                channels={channels}
                templates={templates}
                tags={tags}
                onChange={(data) => _onNodeDataChange(selectedNode.id, data)}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
