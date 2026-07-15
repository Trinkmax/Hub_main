'use client'

import {
  Beer,
  Coffee,
  EyeOff,
  Gift,
  Lock,
  Pause,
  Pencil,
  Play,
  Ticket,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react'
import Image from 'next/image'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { deleteReward, type LoyaltyActionState, updateReward } from '@/lib/points/actions'
import type { Reward } from '@/lib/points/queries'
import { REWARD_CATEGORIES } from '@/lib/points/schemas'
import type { LoyaltyTier } from '@/lib/points/tiers'
import { cn } from '@/lib/utils'
import { MenuImageUploader } from '../../../menu/_components/image-uploader'

const SELECT_CLASS =
  'border-input h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

/** Etiquetas legibles para las categorías canónicas del catálogo. */
const CATEGORY_LABELS: Record<string, string> = {
  desayuno: 'Desayuno y merienda',
  almuerzo: 'Almuerzo',
  cena: 'Cena',
  evento: 'Eventos',
}

/** Ícono + degradado del fallback "emplatado" para recompensas sin foto (por daypart). */
const CATEGORY_FALLBACK: Record<
  string,
  { icon: typeof Coffee; from: string; to: string; ink: string }
> = {
  desayuno: { icon: Coffee, from: '#f4ead6', to: '#e7d3ab', ink: '#7a6338' },
  almuerzo: { icon: UtensilsCrossed, from: '#eadfce', to: '#d8c39c', ink: '#6f5a34' },
  cena: { icon: Beer, from: '#e4dcc9', to: '#cdbf9a', ink: '#5f5330' },
  evento: { icon: Ticket, from: '#e9dcc6', to: '#d6bd93', ink: '#6b5423' },
}
const DEFAULT_FALLBACK = { icon: Gift, from: '#e9e2d2', to: '#d5cbb2', ink: '#6b6145' }

/** Orden de las secciones de la lista agrupada. */
const CATEGORY_ORDER = ['desayuno', 'almuerzo', 'cena', 'evento'] as const
const KNOWN_CATEGORIES = new Set<string>(CATEGORY_ORDER)

type RewardGroup = { key: string; label: string; items: Reward[] }

/** Agrupa las recompensas por categoría respetando el orden canónico + "Otras". */
function groupRewards(rewards: Reward[]): RewardGroup[] {
  const groups: RewardGroup[] = []
  for (const key of CATEGORY_ORDER) {
    const items = rewards.filter((r) => r.category === key)
    if (items.length > 0) groups.push({ key, label: CATEGORY_LABELS[key] ?? key, items })
  }
  const otras = rewards.filter((r) => !r.category || !KNOWN_CATEGORIES.has(r.category))
  if (otras.length > 0) groups.push({ key: '__otras', label: 'Otras', items: otras })
  return groups
}

/** Marco visual de la recompensa: foto real, o "emplatado" (degradado + glifo). */
function RewardMedia({ reward }: { reward: Reward }) {
  const fb = (reward.category && CATEGORY_FALLBACK[reward.category]) || DEFAULT_FALLBACK
  const Icon = fb.icon
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary">
      {reward.image_url ? (
        <Image
          src={reward.image_url}
          alt=""
          fill
          sizes="(max-width: 640px) 50vw, 240px"
          className={cn('object-cover', !reward.active && 'opacity-60 saturate-[0.6]')}
          unoptimized
        />
      ) : (
        <div
          className="grid size-full place-items-center"
          style={{ background: `linear-gradient(140deg, ${fb.from}, ${fb.to})` }}
        >
          <Icon className="size-8 opacity-45" style={{ color: fb.ink }} aria-hidden />
          <span
            className="pointer-events-none absolute bottom-1.5 left-2 text-[10px] font-medium"
            style={{ color: fb.ink }}
          >
            Sin foto
          </span>
        </div>
      )}
      {/* Costo — chip legible sobre cualquier imagen. */}
      <span className="absolute left-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-foreground shadow-sm backdrop-blur-sm">
        {reward.cost_points} pts
      </span>
      {/* Estado (pausada / oculta) — arriba a la derecha. */}
      <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
        {!reward.active ? (
          <Badge variant="outline" className="bg-background/85 backdrop-blur-sm">
            Pausada
          </Badge>
        ) : null}
        {!reward.visible_in_catalog ? (
          <Badge variant="muted" className="gap-1 bg-background/85 backdrop-blur-sm">
            <EyeOff className="size-3" aria-hidden />
            Oculta
          </Badge>
        ) : null}
      </div>
    </div>
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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [editing, setEditing] = useState<Reward | null>(null)

  const sortedTiers = tiers
    .slice()
    .sort((a, b) => a.min_category_points - b.min_category_points || a.sort - b.sort)
  const tierName = (id: string | null): string | null =>
    id ? (tiers.find((t) => t.id === id)?.name ?? 'Nivel eliminado') : null

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

  const onConfirmDelete = () => {
    if (!pendingDelete) return
    const id = pendingDelete
    start(async () => {
      const result = await deleteReward(tenantSlug, id)
      if (!result.ok) toast.error(result.message)
      setPendingDelete(null)
    })
  }

  if (rewards.length === 0) {
    return (
      <EmptyState
        icon={Gift}
        title="Sin recompensas"
        description="Creá una recompensa arriba para que tus clientes empiecen a canjear sus puntos."
      />
    )
  }

  const groups = groupRewards(rewards)

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.key} className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {group.items.map((r) => {
              const lockedTier = tierName(r.min_tier_id)
              return (
                <div
                  key={r.id}
                  className="card-hairline group flex flex-col overflow-hidden rounded-xl border bg-card"
                >
                  <RewardMedia reward={r} />
                  <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                    <p className="truncate text-sm font-medium leading-tight" title={r.name}>
                      {r.name}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span>stock: {r.stock === null ? '∞' : r.stock}</span>
                      {lockedTier ? (
                        <span className="inline-flex items-center gap-0.5 normal-case tracking-normal">
                          <Lock className="size-3" aria-hidden />
                          {lockedTier}
                        </span>
                      ) : null}
                    </div>
                    {/* Acciones — siempre visibles (el dueño usa tablet). */}
                    <div className="mt-auto flex items-center justify-end gap-0.5 pt-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        onClick={() => setEditing(r)}
                        aria-label={`Editar ${r.name}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        onClick={() => onToggle(r)}
                        disabled={pending}
                        aria-label={r.active ? 'Pausar' : 'Activar'}
                      >
                        {r.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(r.id)}
                        aria-label={`Borrar ${r.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Diálogo de edición de recompensa */}
      <EditRewardDialog
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        reward={editing}
        tiers={sortedTiers}
        selectClass={SELECT_CLASS}
        onClose={() => setEditing(null)}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar esta recompensa?</AlertDialogTitle>
            <AlertDialogDescription>
              Los clientes ya no podrán canjearla. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                onConfirmDelete()
              }}
              disabled={pending}
            >
              {pending ? 'Borrando…' : 'Borrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EditRewardDialog({
  tenantSlug,
  tenantId,
  reward,
  tiers,
  selectClass,
  onClose,
}: {
  tenantSlug: string
  tenantId: string
  reward: Reward | null
  tiers: LoyaltyTier[]
  selectClass: string
  onClose: () => void
}) {
  const [pending, start] = useTransition()
  const [minTierId, setMinTierId] = useState<string>('')
  const [category, setCategory] = useState<string>('')
  const [visible, setVisible] = useState(true)
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  // Sincronizamos los controlados cada vez que cambia la recompensa.
  useEffect(() => {
    setMinTierId(reward?.min_tier_id ?? '')
    setCategory(reward?.category ?? '')
    setVisible(reward?.visible_in_catalog ?? true)
    setImageUrl(reward?.image_url ?? null)
  }, [reward])

  const handleSubmit = (formData: FormData) => {
    if (!reward) return
    const name = String(formData.get('name') ?? '').trim()
    const description = String(formData.get('description') ?? '').trim()
    const costPoints = Number(formData.get('cost_points') ?? 0)
    const stockRaw = String(formData.get('stock') ?? '').trim()

    start(async () => {
      const result: LoyaltyActionState = await updateReward(tenantSlug, {
        id: reward.id,
        name,
        description: description.length > 0 ? description : null,
        cost_points: costPoints,
        stock: stockRaw.length > 0 ? Number(stockRaw) : null,
        active: reward.active,
        category: category.length > 0 ? category : null,
        visible_in_catalog: visible,
        min_tier_id: minTierId.length > 0 ? minTierId : null,
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Editar recompensa</DialogTitle>
          <DialogDescription>
            Cambiá la foto, el detalle, el costo en puntos o a qué nivel del club queda reservada.
          </DialogDescription>
        </DialogHeader>

        {reward ? (
          <form action={handleSubmit} className="space-y-3">
            <MenuImageUploader
              tenantId={tenantId}
              value={imageUrl}
              onChange={setImageUrl}
              label="Foto de la recompensa"
            />
            <div className="grid gap-1.5">
              <Label htmlFor="edit-rw-name" className="text-[11px] text-muted-foreground">
                Nombre
              </Label>
              <Input
                id="edit-rw-name"
                name="name"
                required
                maxLength={80}
                defaultValue={reward.name}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-rw-desc" className="text-[11px] text-muted-foreground">
                Descripción
              </Label>
              <Textarea
                id="edit-rw-desc"
                name="description"
                maxLength={300}
                rows={2}
                className="resize-none"
                defaultValue={reward.description ?? ''}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-rw-category" className="text-[11px] text-muted-foreground">
                Categoría
              </Label>
              <select
                id="edit-rw-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={selectClass}
              >
                <option value="">Sin categoría</option>
                {REWARD_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat] ?? cat}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="edit-rw-cost" className="text-[11px] text-muted-foreground">
                  Costo (puntos)
                </Label>
                <Input
                  id="edit-rw-cost"
                  name="cost_points"
                  type="number"
                  min={1}
                  required
                  defaultValue={reward.cost_points}
                  className="tabular-nums"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit-rw-stock" className="text-[11px] text-muted-foreground">
                  Stock
                </Label>
                <Input
                  id="edit-rw-stock"
                  name="stock"
                  type="number"
                  min={0}
                  placeholder="Ilimitado"
                  defaultValue={reward.stock ?? ''}
                  className="tabular-nums"
                />
              </div>
            </div>

            {tiers.length > 0 ? (
              <div className="grid gap-1.5">
                <Label htmlFor="edit-rw-tier" className="text-[11px] text-muted-foreground">
                  Disponibilidad por nivel
                </Label>
                <select
                  id="edit-rw-tier"
                  name="min_tier_id"
                  value={minTierId}
                  onChange={(e) => setMinTierId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Disponible para todos</option>
                  {tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      Desde {tier.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Si elegís un nivel, solo los clientes que lo hayan alcanzado podrán canjearla.
                </p>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
              <div className="grid gap-0.5">
                <Label htmlFor="edit-rw-visible" className="text-xs font-medium">
                  Mostrar en el catálogo de canje
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Si la ocultás, sigue vigente pero no aparece en la carta pública.
                </p>
              </div>
              <Switch id="edit-rw-visible" checked={visible} onCheckedChange={setVisible} />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending} className="min-w-[120px]">
                {pending ? 'Guardando…' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
