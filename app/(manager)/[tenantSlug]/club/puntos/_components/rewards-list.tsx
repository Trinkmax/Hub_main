'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { Camera, Gift, Lock, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { MenuImageUploader } from '@/components/media/image-uploader'
import { StorageImage } from '@/components/media/storage-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldRow } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/ui/status-badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { formatNumber } from '@/lib/format/number-kind'
import {
  deleteReward,
  type LoyaltyActionState,
  reorderRewards,
  updateReward,
} from '@/lib/points/actions'
import type { Reward } from '@/lib/points/queries'
import { REWARD_CATEGORIES } from '@/lib/points/schemas'
import type { LoyaltyTier } from '@/lib/points/tiers'
import { cn } from '@/lib/utils'
import { REWARD_FLAG } from '../../_components/club-status'
import { DRAGGING_ROW_CLASSES, DragHandle, sortableStyle } from '../../_components/club-ui'
import { DEFAULT_REWARD_ICON, REWARD_CATEGORY_ICON, REWARD_CATEGORY_LABELS } from './reward-options'
import { StockField } from './stock-field'

/** «Ninguna»: Radix Select no admite el valor vacío. */
const NONE = '__none__'

/** Orden de las secciones de la lista agrupada. */
const CATEGORY_ORDER = ['desayuno', 'almuerzo', 'cena', 'evento'] as const
const KNOWN_CATEGORIES = new Set<string>(CATEGORY_ORDER)

type RewardGroup = { key: string; label: string; items: Reward[] }

/** Agrupa las recompensas por categoría respetando el orden canónico + "Otras". */
function groupRewards(rewards: Reward[]): RewardGroup[] {
  const groups: RewardGroup[] = []
  for (const key of CATEGORY_ORDER) {
    const items = rewards.filter((r) => r.category === key)
    if (items.length > 0) groups.push({ key, label: REWARD_CATEGORY_LABELS[key] ?? key, items })
  }
  const otras = rewards.filter((r) => !r.category || !KNOWN_CATEGORIES.has(r.category))
  if (otras.length > 0) groups.push({ key: '__otras', label: 'Otras', items: otras })
  return groups
}

/**
 * La foto de la recompensa (o su dibujo por momento del día). Toda el área es
 * el botón que abre el editor: la foto se sube tocándola, igual que en la
 * carta. Con foto, un sello de cámara chico avisa que se puede tocar (con el
 * dedo no hay hover).
 */
function RewardMedia({ reward, onEdit }: { reward: Reward; onEdit: () => void }) {
  const Icon = (reward.category && REWARD_CATEGORY_ICON[reward.category]) || DEFAULT_REWARD_ICON
  const soldOut = reward.stock !== null && reward.stock <= 0
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={
        reward.image_url ? `Cambiar la foto de ${reward.name}` : `Subir una foto de ${reward.name}`
      }
      className="group/foto relative block aspect-[4/3] w-full overflow-hidden bg-secondary text-left -outline-offset-2 outline-(--ring) focus-visible:outline-2"
    >
      {reward.image_url ? (
        <>
          <StorageImage
            src={reward.image_url}
            alt=""
            sizes="(max-width: 640px) 50vw, 240px"
            className={cn(!reward.active && 'opacity-60 saturate-[0.6]')}
          />
          <span
            aria-hidden="true"
            className="absolute right-2 bottom-2 grid size-6 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground group-hover/foto:bg-primary-hover"
          >
            <Camera className="size-3.5" />
          </span>
        </>
      ) : (
        <span className="grid size-full place-items-center">
          <Icon className="size-8 text-subtle-foreground" aria-hidden="true" />
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 type-caption font-medium text-foreground group-hover/foto:border-border-strong">
            <Camera className="size-3" aria-hidden="true" />
            Subir foto
          </span>
        </span>
      )}
      {/* Costo: el sello dorado del club, legible sobre cualquier foto. */}
      <Badge tone="gold" appearance="solid" className="absolute top-2 left-2 type-amount">
        {formatNumber(reward.cost_points)} pts
      </Badge>
      {/* Estado (pausada, oculta, sin stock) — arriba a la derecha. */}
      <span className="absolute top-2 right-2 flex flex-col items-end gap-1">
        {!reward.active ? <StatusBadge status="paused" map={REWARD_FLAG} /> : null}
        {!reward.visible_in_catalog ? <StatusBadge status="hidden" map={REWARD_FLAG} /> : null}
        {soldOut ? <StatusBadge status="sold-out" map={REWARD_FLAG} /> : null}
      </span>
    </button>
  )
}

/**
 * Firma del CONTENIDO (no del orden): si cambia, la grilla se resincroniza con
 * el server; si sólo cambió el orden, respetamos el optimista del drag.
 */
function contentSignature(list: readonly Reward[]): string {
  return list
    .map(
      (r) =>
        `${r.id}:${r.name}:${r.active ? 1 : 0}:${r.image_url ?? ''}:${r.cost_points}:${r.category ?? ''}:${r.stock ?? ''}:${r.visible_in_catalog ? 1 : 0}:${r.min_tier_id ?? ''}`,
    )
    .sort()
    .join('|')
}

/** Tarjeta arrastrable del catálogo. El asa es el único activador del drag. */
function RewardCard({
  reward,
  lockedTier,
  pending,
  onEdit,
  onToggle,
  onDelete,
}: {
  reward: Reward
  lockedTier: string | null
  pending: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: reward.id,
  })

  return (
    <article
      ref={setNodeRef}
      style={sortableStyle(transform, transition, isDragging)}
      aria-label={reward.name}
      className={cn(
        'flex flex-col overflow-clip rounded-xl border border-border bg-card',
        isDragging && DRAGGING_ROW_CLASSES,
      )}
    >
      <RewardMedia reward={reward} onEdit={onEdit} />
      <div className="flex flex-1 flex-col gap-1 p-2">
        <p
          className={cn(
            'truncate type-body font-medium',
            !reward.active && 'text-muted-foreground',
          )}
          title={reward.name}
        >
          {reward.name}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 type-caption text-muted-foreground">
          {reward.stock === null ? (
            <span>Stock ilimitado</span>
          ) : reward.stock > 0 ? (
            <span className="type-amount">Quedan {formatNumber(reward.stock)}</span>
          ) : null}
          {lockedTier ? (
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3" aria-hidden="true" />
              Desde {lockedTier}
            </span>
          ) : null}
        </div>
        {/* Acciones — siempre visibles (el dueño usa tablet). */}
        <div className="mt-auto flex items-center justify-between gap-0.5 pt-1">
          <DragHandle
            label={`Reordenar ${reward.name}`}
            attributes={attributes}
            listeners={listeners}
          />
          <div className="flex items-center gap-0.5">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onEdit}
              aria-label={`Editar ${reward.name}`}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onToggle}
              disabled={pending}
              aria-label={reward.active ? `Pausar ${reward.name}` : `Reactivar ${reward.name}`}
            >
              {reward.active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </Button>
            <Button
              size="icon-sm"
              variant="danger-ghost"
              onClick={onDelete}
              aria-label={`Borrar ${reward.name}`}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}

export function RewardsList({
  tenantSlug,
  tenantId,
  rewards,
  tiers,
}: {
  tenantSlug: string
  tenantId: string
  rewards: Reward[]
  tiers: LoyaltyTier[]
}) {
  const [pending, start] = useTransition()
  const [toDelete, setToDelete] = useState<Reward | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editing, setEditing] = useState<Reward | null>(null)

  // Orden optimista: el drag no espera al server. `rewards` ya viene ordenado
  // por `sort` desde listRewards.
  const [order, setOrder] = useState<Reward[]>(rewards)
  if (contentSignature(rewards) !== contentSignature(order)) {
    setOrder(rewards)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const sortedTiers = tiers
    .slice()
    .sort((a, b) => a.min_category_points - b.min_category_points || a.sort - b.sort)
  const tierName = (id: string | null): string | null =>
    id ? (tiers.find((t) => t.id === id)?.name ?? 'un nivel borrado') : null

  // Toggle activo/pausado. Importante: reenviamos los campos existentes (incl. la
  // foto) para NO perderlos al pausar/activar.
  const onToggle = (r: Reward) => {
    start(async () => {
      const result = await updateReward(tenantSlug, {
        id: r.id,
        name: r.name,
        description: r.description,
        cost_points: r.cost_points,
        stock: r.stock,
        active: !r.active,
        category: r.category,
        visible_in_catalog: r.visible_in_catalog,
        min_tier_id: r.min_tier_id,
        image_url: r.image_url,
      })
      if (!result.ok) toast.error(result.message)
    })
  }

  if (rewards.length === 0) {
    return (
      <EmptyState
        icon={Gift}
        title="Todavía no hay recompensas"
        description="Creá una con el formulario de arriba: es lo que tus clientes canjean con sus puntos."
      />
    )
  }

  const groups = groupRewards(order)

  // Se arrastra DENTRO de cada categoría, pero el `sort` que guardamos es
  // global: mandamos la lista completa aplanada para que no queden empates.
  const onDragEnd = (groupKey: string) => (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const group = groups.find((g) => g.key === groupKey)
    if (!group) return
    const oldIndex = group.items.findIndex((r) => r.id === active.id)
    const newIndex = group.items.findIndex((r) => r.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const previous = order
    const movedItems = arrayMove(group.items, oldIndex, newIndex)
    const next = groups.flatMap((g) => (g.key === groupKey ? movedItems : g.items))
    setOrder(next)
    start(async () => {
      const result = await reorderRewards(
        tenantSlug,
        next.map((r) => r.id),
      )
      if (!result.ok) {
        toast.error(result.message)
        setOrder(previous)
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="type-small text-muted-foreground">
        Arrastrá desde el asa para cambiar el orden en que se ven en la carta. Tocá la foto para
        cambiarla.
      </p>
      {groups.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`rewards-group-${group.key}`}
          className="flex flex-col gap-3"
        >
          <h3 id={`rewards-group-${group.key}`} className="type-label text-muted-foreground">
            {group.label}
          </h3>
          <DndContext
            id={`rewards-${group.key}`}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd(group.key)}
          >
            <SortableContext items={group.items.map((r) => r.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-3 min-[25rem]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
                {group.items.map((r) => (
                  <RewardCard
                    key={r.id}
                    reward={r}
                    lockedTier={tierName(r.min_tier_id)}
                    pending={pending}
                    onEdit={() => setEditing(r)}
                    onToggle={() => onToggle(r)}
                    onDelete={() => {
                      setToDelete(r)
                      setDeleteOpen(true)
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>
      ))}

      {/* Diálogo de edición de recompensa */}
      <EditRewardDialog
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        reward={editing}
        tiers={sortedTiers}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title={`¿Borrar «${toDelete?.name ?? ''}»?`}
        description="Los clientes ya no van a poder canjearla. No se puede deshacer: si solo querés sacarla un tiempo, pausala."
        confirmLabel="Borrar recompensa"
        pendingLabel="Borrando…"
        onConfirm={async () => {
          if (!toDelete) return
          const result = await deleteReward(tenantSlug, toDelete.id)
          if (!result.ok) return { ok: false, error: result.message }
        }}
      />
    </div>
  )
}

function EditRewardDialog({
  tenantSlug,
  tenantId,
  reward,
  tiers,
  onClose,
}: {
  tenantSlug: string
  tenantId: string
  reward: Reward | null
  tiers: LoyaltyTier[]
  onClose: () => void
}) {
  const [pending, start] = useTransition()
  const [minTierId, setMinTierId] = useState<string>(NONE)
  const [category, setCategory] = useState<string>(NONE)
  const [visible, setVisible] = useState(true)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [unlimitedStock, setUnlimitedStock] = useState(true)
  const [stock, setStock] = useState<number | null>(null)

  // Sincronizamos los controlados cada vez que cambia la recompensa.
  useEffect(() => {
    setMinTierId(reward?.min_tier_id ?? NONE)
    setCategory(reward?.category ?? NONE)
    setVisible(reward?.visible_in_catalog ?? true)
    setImageUrl(reward?.image_url ?? null)
    const current = reward?.stock ?? null
    setUnlimitedStock(current === null)
    setStock(current)
  }, [reward])

  // onSubmit y no `action`: si el server rechaza, lo tipeado queda.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!reward) return
    const formData = new FormData(event.currentTarget)
    const name = String(formData.get('name') ?? '').trim()
    const description = String(formData.get('description') ?? '').trim()
    const costPoints = Number(formData.get('cost_points') ?? 0)

    start(async () => {
      const result: LoyaltyActionState = await updateReward(tenantSlug, {
        id: reward.id,
        name,
        description: description.length > 0 ? description : null,
        cost_points: costPoints,
        // El switch es la fuente de verdad del ilimitado; el campo solo existe
        // cuando está apagado (y es obligatorio, así que no llega vacío).
        stock: unlimitedStock ? null : (stock ?? 0),
        active: reward.active,
        category: category === NONE ? null : category,
        visible_in_catalog: visible,
        min_tier_id: minTierId === NONE ? null : minTierId,
        image_url: imageUrl,
      })
      if (result.ok) {
        toast.success('Recompensa actualizada.')
        onClose()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog
      open={reward !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Editar recompensa</DialogTitle>
          <DialogDescription>
            Cambiá la foto, el detalle, el costo en puntos o a qué nivel del club queda reservada.
          </DialogDescription>
        </DialogHeader>

        {reward ? (
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
            <DialogBody className="grid gap-4">
              <MenuImageUploader
                tenantId={tenantId}
                value={imageUrl}
                onChange={setImageUrl}
                label="Foto de la recompensa"
              />
              <Field label="Nombre" name="name" required>
                <Input maxLength={80} defaultValue={reward.name} />
              </Field>
              <Field label="Descripción" name="description" optional>
                <Textarea
                  maxLength={300}
                  showCount
                  rows={2}
                  defaultValue={reward.description ?? ''}
                />
              </Field>
              <FieldRow>
                <Field label="Costo" name="cost_points" required>
                  <NumberField min={1} step={10} suffix="pts" defaultValue={reward.cost_points} />
                </Field>
                <StockField
                  idPrefix="edit-rw"
                  unlimited={unlimitedStock}
                  onUnlimitedChange={setUnlimitedStock}
                  value={stock}
                  onValueChange={setStock}
                />
              </FieldRow>
              <FieldRow>
                <Field label="Categoría" optional>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin categoría</SelectItem>
                      {REWARD_CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {REWARD_CATEGORY_LABELS[cat] ?? cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {tiers.length > 0 ? (
                  <Field
                    label="Disponibilidad por nivel"
                    hint="Con un nivel elegido, solo la canjean los clientes que lo alcanzaron."
                  >
                    <Select value={minTierId} onValueChange={setMinTierId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Disponible para todos</SelectItem>
                        {tiers.map((tier) => (
                          <SelectItem key={tier.id} value={tier.id}>
                            Desde {tier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
              </FieldRow>

              <Field
                label="Mostrar en el catálogo de canje"
                layout="toggle"
                hint="Si la ocultás, sigue vigente pero no aparece en la carta pública."
              >
                <Switch checked={visible} onCheckedChange={setVisible} />
              </Field>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending} loadingText="Guardando…">
                Guardar cambios
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
