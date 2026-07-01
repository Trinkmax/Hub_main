'use client'

import { EyeOff, Gift, Lock, Pause, Pencil, Play, Trash2 } from 'lucide-react'
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

const SELECT_CLASS =
  'border-input h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

/** Etiquetas legibles para las categorías canónicas del catálogo. */
const CATEGORY_LABELS: Record<string, string> = {
  desayuno: 'Desayuno y merienda',
  almuerzo: 'Almuerzo',
  cena: 'Cena',
  evento: 'Eventos',
}

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

export function RewardsList({
  tenantSlug,
  rewards,
  tiers,
}: {
  tenantSlug: string
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

  // Toggle activo/pausado. Importante: reenviamos min_tier_id, category y
  // visible_in_catalog existentes para NO perderlos al pausar/activar.
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
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.key} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h3>
          <div className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
            {group.items.map((r) => {
              const lockedTier = tierName(r.min_tier_id)
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                  {r.active ? (
                    <Badge className="gap-1 bg-success text-success-foreground hover:bg-success/90">
                      Activa
                    </Badge>
                  ) : (
                    <Badge variant="outline">Pausada</Badge>
                  )}
                  <span className="flex-1 truncate font-medium">{r.name}</span>
                  {!r.visible_in_catalog ? (
                    <Badge variant="muted" className="gap-1">
                      <EyeOff className="size-3" aria-hidden />
                      Oculta
                    </Badge>
                  ) : null}
                  {lockedTier ? (
                    <Badge variant="muted" className="gap-1">
                      <Lock className="size-3" aria-hidden />
                      {lockedTier}
                    </Badge>
                  ) : null}
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                    {r.cost_points} pts
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    stock: {r.stock === null ? '∞' : r.stock}
                  </span>
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
                    aria-label={r.active ? 'Pausar' : 'Activar'}
                  >
                    {r.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete(r.id)}
                    aria-label="Borrar"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Diálogo de edición de recompensa */}
      <EditRewardDialog
        tenantSlug={tenantSlug}
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
  reward,
  tiers,
  selectClass,
  onClose,
}: {
  tenantSlug: string
  reward: Reward | null
  tiers: LoyaltyTier[]
  selectClass: string
  onClose: () => void
}) {
  const [pending, start] = useTransition()
  const [minTierId, setMinTierId] = useState<string>('')
  const [category, setCategory] = useState<string>('')
  const [visible, setVisible] = useState(true)

  // Sincronizamos los selectores controlados cada vez que cambia la recompensa.
  useEffect(() => {
    setMinTierId(reward?.min_tier_id ?? '')
    setCategory(reward?.category ?? '')
    setVisible(reward?.visible_in_catalog ?? true)
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Editar recompensa</DialogTitle>
          <DialogDescription>
            Cambiá el detalle, el costo en puntos o a qué nivel del club queda reservada.
          </DialogDescription>
        </DialogHeader>

        {reward ? (
          <form action={handleSubmit} className="space-y-3">
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
