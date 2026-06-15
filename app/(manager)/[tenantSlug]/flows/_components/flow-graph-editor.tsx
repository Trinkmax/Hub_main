'use client'

import {
  addEdge,
  Background,
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Clock, GitBranch, MessageSquareText, Tag as TagIcon, Trash2, X, Zap } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState, useTransition } from 'react'
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
import { saveFlowGraph } from '@/lib/flows/graph-actions'
import type { FlowEdge as DBFlowEdge, FlowNode as DBFlowNode } from '@/lib/flows/graph-queries'
import type { FlowGraphNode } from '@/lib/flows/graph-schemas'
import type { FlowTriggerConfig } from '@/lib/flows/schemas'

// ─── Types ───────────────────────────────────────────────────────────────────

type Channel = { id: string; display_name: string | null; type: 'whatsapp' | 'instagram' }
type Template = { id: string; name: string; language: string; channel_id: string }
type Tag = { id: string; name: string }

type NodeKind = 'trigger' | 'send_template' | 'wait' | 'condition' | 'add_tag'

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

// ─── Node kind labels/icons ───────────────────────────────────────────────────

const KIND_LABEL: Record<NodeKind, string> = {
  trigger: 'Trigger',
  send_template: 'Enviar template',
  wait: 'Esperar',
  condition: 'Condición',
  add_tag: 'Agregar tag',
}

const KIND_ICON: Record<NodeKind, React.ElementType> = {
  trigger: Zap,
  send_template: MessageSquareText,
  wait: Clock,
  condition: GitBranch,
  add_tag: TagIcon,
}

// ─── Custom node components ───────────────────────────────────────────────────

function NodeShell({
  id,
  kind,
  children,
}: {
  id: string
  kind: NodeKind
  children?: React.ReactNode
}) {
  const Icon = KIND_ICON[kind]
  const isTrigger = kind === 'trigger'

  const colorMap: Record<NodeKind, string> = {
    trigger: 'bg-primary/10 border-primary/40 text-primary',
    send_template: 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400',
    wait: 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
    condition: 'bg-violet-500/10 border-violet-500/30 text-violet-600 dark:text-violet-400',
    add_tag: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
  }

  return (
    <div className="relative w-56 rounded-xl border bg-card shadow-sm ring-1 ring-inset ring-border/60">
      {/* Target handle — all nodes except trigger accept incoming */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="!size-3 !rounded-full !border-2 !border-border !bg-background"
        />
      )}

      <div className="flex items-center gap-2 rounded-t-xl border-b border-border/60 px-3 py-2">
        <div
          className={`flex size-6 items-center justify-center rounded-md border ${colorMap[kind]}`}
        >
          <Icon className="size-3.5" />
        </div>
        <span className="flex-1 text-xs font-semibold">{KIND_LABEL[kind]}</span>
        {!isTrigger && (
          <button
            type="button"
            onClick={() => _onNodeDelete(id)}
            className="rounded p-0.5 text-muted-foreground/50 hover:text-destructive"
            aria-label="Eliminar nodo"
          >
            <X className="size-3" />
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
            className="!size-3 !rounded-full !border-2 !border-emerald-500 !bg-background"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            style={{ left: '70%' }}
            className="!size-3 !rounded-full !border-2 !border-rose-500 !bg-background"
          />
          <div className="flex justify-between px-3 pb-2 text-[10px]">
            <span className="text-emerald-600 dark:text-emerald-400">Sí</span>
            <span className="text-rose-600 dark:text-rose-400">No</span>
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

const TRIGGER_LABEL: Record<FlowTriggerConfig['type'], string> = {
  customer_inactive: 'Cliente inactivo',
  birthday: 'Cumpleaños',
  after_visit: 'Después de visita',
  event_starting: 'Evento próximo',
  tag_added: 'Tag agregado',
}

function TriggerNodeComponent({ id, data }: NodeProps<FlowNode>) {
  if (data.kind !== 'trigger') return null
  const cfg = data.config

  let summary = TRIGGER_LABEL[cfg.type]
  if (cfg.type === 'customer_inactive') summary += ` (${cfg.days}d)`
  if (cfg.type === 'birthday')
    summary +=
      cfg.offset_days === 0 ? '' : ` (${cfg.offset_days > 0 ? '+' : ''}${cfg.offset_days}d)`
  if (cfg.type === 'event_starting') summary += ` (${cfg.hours_before}h antes)`

  return (
    <NodeShell id={id} kind="trigger">
      <span className="text-muted-foreground">{summary}</span>
    </NodeShell>
  )
}

// ─── Send template node ───────────────────────────────────────────────────────

function SendTemplateNodeComponent({ id, data }: NodeProps<FlowNode>) {
  if (data.kind !== 'send_template') return null
  const { channel_id, template_id } = data.config
  const channel = _channels.find((c) => c.id === channel_id)
  const template = _templates.find((t) => t.id === template_id)

  return (
    <NodeShell id={id} kind="send_template">
      <div className="space-y-0.5 text-muted-foreground">
        <div className="truncate">{channel?.display_name ?? channel?.type ?? '—'}</div>
        <div className="truncate font-medium text-foreground">
          {template?.name ?? 'Sin template'}
        </div>
      </div>
    </NodeShell>
  )
}

// ─── Wait node ────────────────────────────────────────────────────────────────

function WaitNodeComponent({ id, data }: NodeProps<FlowNode>) {
  if (data.kind !== 'wait') return null
  const { minutes } = data.config
  const display =
    minutes >= 1440
      ? `${Math.round(minutes / 1440)}d`
      : minutes >= 60
        ? `${Math.round(minutes / 60)}h`
        : `${minutes}min`

  return (
    <NodeShell id={id} kind="wait">
      <span className="text-muted-foreground">{display}</span>
    </NodeShell>
  )
}

// ─── Condition node ───────────────────────────────────────────────────────────

const OP_LABEL: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  is_true: 'es true',
  is_false: 'es false',
}

function ConditionNodeComponent({ id, data }: NodeProps<FlowNode>) {
  if (data.kind !== 'condition') return null
  const { field, op, value } = data.config

  return (
    <NodeShell id={id} kind="condition">
      <span className="font-mono text-[10px] text-muted-foreground">
        {field} {OP_LABEL[op] ?? op}
        {value !== undefined ? ` ${String(value)}` : ''}
      </span>
    </NodeShell>
  )
}

// ─── Add tag node ─────────────────────────────────────────────────────────────

function AddTagNodeComponent({ id, data }: NodeProps<FlowNode>) {
  if (data.kind !== 'add_tag') return null
  const tag = _tags.find((t) => t.id === data.config.tag_id)

  return (
    <NodeShell id={id} kind="add_tag">
      <span className="text-muted-foreground">{tag?.name ?? 'Sin tag'}</span>
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
      <WaitConfig
        config={data.config}
        onChange={(cfg) => onChange({ kind: 'wait', config: cfg })}
      />
    )
  }

  if (kind === 'condition' && data.kind === 'condition') {
    return (
      <ConditionConfig
        config={data.config}
        onChange={(cfg) => onChange({ kind: 'condition', config: cfg })}
      />
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
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Tipo de trigger</Label>
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
            <SelectItem value="customer_inactive">Cliente inactivo</SelectItem>
            <SelectItem value="birthday">Cumpleaños</SelectItem>
            <SelectItem value="after_visit">Después de una visita</SelectItem>
            <SelectItem value="event_starting">Evento próximo</SelectItem>
            <SelectItem value="tag_added">Tag agregado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {config.type === 'birthday' && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Cuándo enviar</Label>
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
        </div>
      )}

      {config.type === 'customer_inactive' && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Días sin venir</Label>
          <Input
            type="number"
            min={1}
            max={365}
            value={config.days}
            onChange={(e) =>
              onChange({ type: 'customer_inactive', days: Math.max(1, Number(e.target.value)) })
            }
          />
        </div>
      )}

      {config.type === 'event_starting' && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Horas antes del evento</Label>
          <Input
            type="number"
            min={1}
            max={168}
            value={config.hours_before}
            onChange={(e) =>
              onChange({
                type: 'event_starting',
                hours_before: Math.max(1, Number(e.target.value)),
              })
            }
          />
        </div>
      )}

      {config.type === 'tag_added' && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Tag (vacío = cualquiera)</Label>
          <Select
            value={config.tag_id ?? '__any'}
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
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Canal</Label>
        <Select
          value={config.channel_id}
          onValueChange={(v) => onChange({ ...config, channel_id: v, template_id: '' })}
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
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Template aprobado</Label>
        <Select
          value={config.template_id}
          onValueChange={(v) => onChange({ ...config, template_id: v })}
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
    </div>
  )
}

function WaitConfig({
  config,
  onChange,
}: {
  config: WaitData['config']
  onChange: (c: WaitData['config']) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">Esperar (minutos)</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={43200}
          value={config.minutes}
          onChange={(e) => onChange({ minutes: Math.max(1, Number(e.target.value)) })}
          className="w-28"
        />
        <span className="text-xs text-muted-foreground">min</span>
      </div>
    </div>
  )
}

function ConditionConfig({
  config,
  onChange,
}: {
  config: ConditionData['config']
  onChange: (c: ConditionData['config']) => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Campo</Label>
        <Input
          value={config.field}
          onChange={(e) => onChange({ ...config, field: e.target.value })}
          placeholder="customer.opt_in_marketing"
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Operador</Label>
        <Select value={config.op} onValueChange={(v) => onChange({ ...config, op: v })}>
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
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Valor (opcional)</Label>
        <Input
          value={
            typeof config.value === 'string' || typeof config.value === 'number'
              ? String(config.value)
              : ''
          }
          onChange={(e) => onChange({ ...config, value: e.target.value })}
          placeholder="valor"
        />
      </div>
      <p className="text-[11px] text-muted-foreground">Handle verde = Sí · Handle rojo = No</p>
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
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">Tag a agregar</Label>
      <Select value={config.tag_id} onValueChange={(v) => onChange({ tag_id: v })}>
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
    </div>
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
    (params) => setEdges((eds) => addEdge({ ...params, id: crypto.randomUUID() }, eds)),
    [setEdges],
  )

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null

  // ── Add node from palette ──────────────────────────────────────────────────
  const addNode = (kind: NodeKind) => {
    // Only one trigger allowed
    if (kind === 'trigger' && nodes.some((n) => n.type === 'trigger')) {
      toast.error('El flow ya tiene un nodo Trigger.')
      return
    }
    const newNode: FlowNode = {
      id: crypto.randomUUID(),
      type: kind,
      position: { x: 100 + Math.random() * 200, y: 200 + nodes.length * 100 },
      data: defaultDataForKind(kind, channels, templates, tags),
    }
    setNodes((nds) => [...nds, newNode])
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = () => {
    setValidationError(null)

    // Find trigger node for the trigger config
    const triggerNode = nodes.find((n) => n.type === 'trigger')
    if (!triggerNode || triggerNode.data.kind !== 'trigger') {
      const msg = 'El flow debe tener exactamente un nodo Trigger.'
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
        toast.success(initial?.id ? 'Flow actualizado.' : 'Flow creado.')
        router.push(`/${tenantSlug}/flows`)
        router.refresh()
      } else {
        toast.error(result.message)
        setValidationError(result.message)
      }
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[600px] flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-card px-4 py-3">
        <Input
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          placeholder="Nombre del flow"
          className="h-8 max-w-64 text-sm"
          maxLength={80}
        />

        <Label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={active}
            onCheckedChange={(v) => setActive(v === true)}
            id="graph-flow-active"
          />
          Activo
        </Label>

        {validationError && (
          <Badge variant="destructive" className="text-xs">
            {validationError}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push(`/${tenantSlug}/flows`)}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>

      {/* Canvas + side panel */}
      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        <div className="flex w-40 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border/60 bg-card/60 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Agregar nodo
          </p>
          {(['trigger', 'send_template', 'wait', 'condition', 'add_tag'] as NodeKind[]).map(
            (kind) => {
              const Icon = KIND_ICON[kind]
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => addNode(kind)}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2 py-1.5 text-left text-xs font-medium hover:bg-secondary/60 hover:text-foreground transition-colors"
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  {KIND_LABEL[kind]}
                </button>
              )
            },
          )}
        </div>

        {/* React Flow canvas */}
        <div className="relative min-h-0 flex-1">
          <ReactFlow
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
            <Controls />
          </ReactFlow>
        </div>

        {/* Config panel */}
        {selectedNode && (
          <div className="flex w-64 shrink-0 flex-col border-l border-border/60 bg-card">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <span className="text-xs font-semibold">
                {KIND_LABEL[selectedNode.type as NodeKind]}
              </span>
              <div className="flex items-center gap-1">
                {selectedNode.type !== 'trigger' && (
                  <button
                    type="button"
                    onClick={() => _onNodeDelete(selectedNode.id)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    aria-label="Eliminar nodo"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(null)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Cerrar panel"
                >
                  <X className="size-3.5" />
                </button>
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
          </div>
        )}
      </div>
    </div>
  )
}
