'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Gift,
  GripVertical,
  Handshake,
  Loader2,
  Pause,
  Pencil,
  Percent,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { type ComponentType, type ReactNode, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { StorageImage } from '@/components/media/storage-image'
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
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { IconPicker } from '@/components/ui/icon-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { isStorageUrl } from '@/lib/menu/media-urls'
import { deleteMenuImageByUrl } from '@/lib/menu/upload-image'
import {
  createTierBenefit,
  deleteTierBenefit,
  type LoyaltyActionState,
  reorderTierBenefits,
  toggleTierBenefit,
  updateTierBenefit,
} from '@/lib/points/actions'
import {
  BENEFIT_KIND_META,
  BENEFIT_KINDS,
  CADENCE_LABEL,
  type TierBenefit,
  type TierBenefitCadence,
  type TierBenefitKind,
} from '@/lib/points/benefits'
import { cn } from '@/lib/utils'
import { MenuImageUploader } from '../../menu/_components/image-uploader'

type IdName = { id: string; name: string }

/** Icono Lucide por tipo de beneficio (espejo de BENEFIT_KIND_META[k].icon). */
const KIND_ICON: Record<TierBenefitKind, ComponentType<{ className?: string }>> = {
  recurring_reward: Gift,
  discount: Percent,
  perk: Sparkles,
  partner: Handshake,
}

const CADENCE_OPTIONS: TierBenefitCadence[] = ['monthly', 'birthday']

type FormState = {
  editingId: string | null
  kind: TierBenefitKind
  label: string
  description: string
  icon: string
  imageUrl: string | null
  rewardId: string
  cadence: TierBenefitCadence
  quantity: string
  discountPct: string
  discountScope: string
  partnerId: string
  sort: number
  active: boolean
}

const EMPTY_FORM: FormState = {
  editingId: null,
  kind: 'recurring_reward',
  label: '',
  description: '',
  icon: '',
  imageUrl: null,
  rewardId: '',
  cadence: 'monthly',
  quantity: '1',
  discountPct: '',
  discountScope: '',
  partnerId: '',
  sort: 0,
  active: true,
}

function KindChip({ kind }: { kind: TierBenefitKind }) {
  const Icon = KIND_ICON[kind]
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-secondary/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="size-3" aria-hidden />
      {BENEFIT_KIND_META[kind].label}
    </span>
  )
}

/** Orden visual estable: `sort` asc y label como desempate. */
function sortBenefits(list: readonly TierBenefit[]): TierBenefit[] {
  return list.slice().sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, 'es'))
}

/**
 * Firma del CONTENIDO (no del orden): si cambia, la lista se resincroniza con
 * el server; si sólo cambió el orden, respetamos el optimista del drag.
 */
function contentSignature(list: readonly TierBenefit[]): string {
  return list
    .map(
      (b) =>
        `${b.id}:${b.label}:${b.active ? 1 : 0}:${b.icon ?? ''}:${b.image_url ?? ''}:${b.description ?? ''}`,
    )
    .sort()
    .join('|')
}

function BenefitRow({
  benefit,
  pending,
  onEdit,
  onToggle,
  onDelete,
}: {
  benefit: TierBenefit
  pending: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: benefit.id,
  })
  const Icon = KIND_ICON[benefit.kind]

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className={cn(
        'flex items-center gap-2 bg-card px-2 py-2.5',
        !benefit.active && 'opacity-60',
        isDragging && 'relative z-10 shadow-md',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`Reordenar ${benefit.label}`}
        // touch-none: sin esto el gesto de arrastre en tablet scrollea el diálogo.
        className="size-10 shrink-0 cursor-grab touch-none rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="mx-auto size-4" />
      </button>

      {/* Miniatura: la foto real si la cargó, si no el ícono del tipo. */}
      <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary/60">
        {benefit.image_url ? (
          <StorageImage src={benefit.image_url} alt="" sizes="40px" />
        ) : (
          <Icon className="size-4 text-muted-foreground/70" />
        )}
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{benefit.label}</span>
          <KindChip kind={benefit.kind} />
        </div>
        {benefit.description ? (
          <p className="truncate text-[11px] text-muted-foreground">{benefit.description}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="size-10 text-muted-foreground hover:text-foreground"
          onClick={onToggle}
          disabled={pending}
          aria-label={benefit.active ? `Pausar ${benefit.label}` : `Reactivar ${benefit.label}`}
        >
          {benefit.active ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-10 text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          aria-label={`Editar ${benefit.label}`}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-10 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label={`Borrar ${benefit.label}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  )
}

export function BenefitsEditor({
  tenantSlug,
  tenantId,
  tier,
  benefits,
  rewards,
  partners,
  trigger,
}: {
  tenantSlug: string
  tenantId: string
  tier: { id: string; name: string }
  benefits: TierBenefit[]
  /** Recompensas activas para el beneficio `recurring_reward`. */
  rewards: IdName[]
  /** Marcas aliadas para el beneficio `partner`. */
  partners: IdName[]
  /** Disparador (botón). Si se omite, se renderiza uno por defecto. */
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [pendingDelete, setPendingDelete] = useState<TierBenefit | null>(null)

  // Orden optimista de la lista (el drag no espera al server).
  const [order, setOrder] = useState<TierBenefit[]>(() => sortBenefits(benefits))
  if (contentSignature(benefits) !== contentSignature(order)) {
    setOrder(sortBenefits(benefits))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const resetForm = () => setForm(EMPTY_FORM)

  const startEdit = (b: TierBenefit) => {
    setForm({
      editingId: b.id,
      kind: b.kind,
      label: b.label,
      description: b.description ?? '',
      icon: b.icon ?? '',
      imageUrl: b.image_url,
      rewardId: b.reward_id ?? '',
      cadence: b.cadence === 'none' ? 'monthly' : b.cadence,
      quantity: String(b.quantity ?? 1),
      discountPct: b.discount_pct === null ? '' : String(b.discount_pct),
      discountScope: b.discount_scope ?? '',
      partnerId: b.partner_id ?? '',
      sort: b.sort,
      active: b.active,
    })
  }

  const isEditing = form.editingId !== null
  const editingOriginal = isEditing ? (order.find((b) => b.id === form.editingId) ?? null) : null

  /**
   * Limpieza best-effort de la foto anterior cuando se reemplaza o se quita.
   * Si falla, queda un huérfano tolerable que barre el script de prune — nunca
   * debe romper el guardado.
   */
  const pruneImage = async (previous: string | null, next: string | null) => {
    if (!previous || previous === next || !isStorageUrl(previous)) return
    try {
      await deleteMenuImageByUrl(previous)
    } catch {
      // huérfano tolerable
    }
  }

  const handleSubmit = () => {
    const label = form.label.trim()
    if (!label) {
      toast.error('Poné un nombre para el beneficio.')
      return
    }
    if (form.kind === 'recurring_reward' && !form.rewardId) {
      toast.error('Elegí la recompensa gratis.')
      return
    }
    if (form.kind === 'discount' && form.discountPct.trim() === '') {
      toast.error('Indicá el % de descuento.')
      return
    }
    if (form.kind === 'partner' && !form.partnerId) {
      toast.error('Elegí la marca aliada.')
      return
    }

    const input = {
      ...(form.editingId ? { id: form.editingId } : {}),
      tier_id: tier.id,
      kind: form.kind,
      label,
      description: form.description.trim() || null,
      icon: form.icon.trim() || null,
      image_url: form.imageUrl,
      reward_id: form.rewardId || null,
      cadence: form.cadence,
      quantity: Number(form.quantity) || 1,
      discount_pct: form.discountPct.trim() === '' ? null : Number(form.discountPct),
      discount_scope: form.discountScope.trim() || null,
      partner_id: form.partnerId || null,
      sort: form.sort,
      active: form.active,
    }

    const previousImage = editingOriginal?.image_url ?? null

    startTransition(async () => {
      const result: LoyaltyActionState = form.editingId
        ? await updateTierBenefit(tenantSlug, input)
        : await createTierBenefit(tenantSlug, input)
      if (result.ok) {
        await pruneImage(previousImage, form.imageUrl)
        toast.success(
          result.message ?? (form.editingId ? 'Beneficio actualizado.' : 'Beneficio agregado.'),
        )
        resetForm()
      } else {
        toast.error(result.message)
      }
    })
  }

  const onToggle = (b: TierBenefit) => {
    startTransition(async () => {
      const result = await toggleTierBenefit(tenantSlug, b.id, !b.active)
      if (!result.ok) toast.error(result.message)
    })
  }

  const onConfirmDelete = () => {
    if (!pendingDelete) return
    const target = pendingDelete
    startTransition(async () => {
      const result = await deleteTierBenefit(tenantSlug, target.id)
      if (result.ok) {
        await pruneImage(target.image_url, null)
        toast.success('Beneficio eliminado.')
        if (form.editingId === target.id) resetForm()
      } else {
        toast.error(result.message)
      }
      setPendingDelete(null)
    })
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = order.findIndex((b) => b.id === active.id)
    const newIndex = order.findIndex((b) => b.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const previous = order
    const next = arrayMove(order, oldIndex, newIndex)
    setOrder(next)
    startTransition(async () => {
      const result = await reorderTierBenefits(
        tenantSlug,
        tier.id,
        next.map((b) => b.id),
      )
      if (!result.ok) {
        toast.error(result.message)
        setOrder(previous)
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          resetForm()
          setPendingDelete(null)
        }
      }}
    >
      {trigger ?? (
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <Sparkles className="size-4" />
            Beneficios
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Beneficios de {tier.name}</DialogTitle>
          <DialogDescription>
            Definí qué desbloquea este nivel: ítems gratis recurrentes, descuentos, beneficios o
            marcas aliadas.
          </DialogDescription>
        </DialogHeader>

        {/* Lista de beneficios actuales — arrastrable */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Beneficios cargados
            </p>
            {order.length > 1 ? (
              <p className="text-[11px] text-muted-foreground">
                Arrastrá para cambiar el orden en que los ve el socio.
              </p>
            ) : null}
          </div>
          {order.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
              Todavía no hay beneficios en este nivel. Cargá el primero acá abajo.
            </p>
          ) : (
            <DndContext
              id={`tier-benefits-${tier.id}`}
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={order.map((b) => b.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border">
                  {order.map((b) => (
                    <BenefitRow
                      key={b.id}
                      benefit={b}
                      pending={pending}
                      onEdit={() => startEdit(b)}
                      onToggle={() => onToggle(b)}
                      onDelete={() => setPendingDelete(b)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Form: agregar / editar beneficio */}
        <div className="card-hairline space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {isEditing ? 'Editar beneficio' : 'Agregar beneficio'}
            </p>
            {isEditing ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 gap-1 px-2 text-muted-foreground"
                onClick={resetForm}
              >
                <X className="size-3.5" />
                Cancelar
              </Button>
            ) : null}
          </div>

          {/* Tipo */}
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Tipo de beneficio</Label>
            <Select
              value={form.kind}
              onValueChange={(v) => set('kind', v as TierBenefitKind)}
              disabled={isEditing}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BENEFIT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {BENEFIT_KIND_META[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Campos según kind */}
          {form.kind === 'recurring_reward' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Recompensa gratis</Label>
                {rewards.length === 0 ? (
                  <p className="rounded-md border border-warning/40 bg-warning/15 px-2.5 py-2 text-[11px] text-warning">
                    No hay recompensas activas. Creá una en Puntos y recompensas.
                  </p>
                ) : (
                  <Select value={form.rewardId} onValueChange={(v) => set('rewardId', v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegí…" />
                    </SelectTrigger>
                    <SelectContent>
                      {rewards.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Frecuencia</Label>
                <Select
                  value={form.cadence}
                  onValueChange={(v) => set('cadence', v as TierBenefitCadence)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CADENCE_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CADENCE_LABEL[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="benefit-qty" className="text-xs text-muted-foreground">
                  Cantidad
                </Label>
                <Input
                  id="benefit-qty"
                  type="number"
                  min={1}
                  max={20}
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="benefit-label-rr" className="text-xs text-muted-foreground">
                  Nombre
                </Label>
                <Input
                  id="benefit-label-rr"
                  value={form.label}
                  onChange={(e) => set('label', e.target.value)}
                  maxLength={80}
                  placeholder="Ej: 1 café gratis"
                />
              </div>
            </div>
          ) : null}

          {form.kind === 'discount' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="benefit-pct" className="text-xs text-muted-foreground">
                  % de descuento
                </Label>
                <Input
                  id="benefit-pct"
                  type="number"
                  min={0}
                  max={100}
                  value={form.discountPct}
                  onChange={(e) => set('discountPct', e.target.value)}
                  className="tabular-nums"
                  placeholder="10"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="benefit-scope" className="text-xs text-muted-foreground">
                  Aplica a
                </Label>
                <Input
                  id="benefit-scope"
                  value={form.discountScope}
                  onChange={(e) => set('discountScope', e.target.value)}
                  maxLength={60}
                  placeholder="Ej: Desayunos L-V"
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="benefit-label-disc" className="text-xs text-muted-foreground">
                  Nombre
                </Label>
                <Input
                  id="benefit-label-disc"
                  value={form.label}
                  onChange={(e) => set('label', e.target.value)}
                  maxLength={80}
                  placeholder="Ej: 10% off en desayunos"
                />
              </div>
            </div>
          ) : null}

          {form.kind === 'perk' ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="benefit-label-perk" className="text-xs text-muted-foreground">
                  Nombre
                </Label>
                <Input
                  id="benefit-label-perk"
                  value={form.label}
                  onChange={(e) => set('label', e.target.value)}
                  maxLength={80}
                  placeholder="Ej: Acceso a la barra VIP"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="benefit-desc" className="text-xs text-muted-foreground">
                  Descripción (opcional)
                </Label>
                <Textarea
                  id="benefit-desc"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  maxLength={200}
                  rows={2}
                  className="resize-none"
                  placeholder="Detalle de la ventaja."
                />
              </div>
            </div>
          ) : null}

          {form.kind === 'partner' ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Marca aliada</Label>
                {partners.length === 0 ? (
                  <p className="rounded-md border border-warning/40 bg-warning/15 px-2.5 py-2 text-[11px] text-warning">
                    No hay marcas aliadas. Creá una en Aliados.
                  </p>
                ) : (
                  <Select value={form.partnerId} onValueChange={(v) => set('partnerId', v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegí…" />
                    </SelectTrigger>
                    <SelectContent>
                      {partners.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[11px] text-muted-foreground">
                  El descuento por nivel se carga en la ficha de la marca, en Aliados.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="benefit-label-partner" className="text-xs text-muted-foreground">
                  Nombre
                </Label>
                <Input
                  id="benefit-label-partner"
                  value={form.label}
                  onChange={(e) => set('label', e.target.value)}
                  maxLength={80}
                  placeholder="Ej: 15% off en la librería aliada"
                />
              </div>
            </div>
          ) : null}

          {/* Cómo se ve: foto (billetera) + ícono (listados). Conviven a propósito. */}
          <div className="grid gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
            <p className="text-[11px] text-muted-foreground text-pretty">
              La foto se ve en la billetera del socio; el ícono, en los listados y chips.
            </p>
            <MenuImageUploader
              tenantId={tenantId}
              value={form.imageUrl}
              onChange={(url) => set('imageUrl', url)}
              label="Foto del beneficio (opcional)"
            />
            <IconPicker
              id="benefit-icon"
              value={form.icon || null}
              onChange={(name) => set('icon', name ?? '')}
              hint="Se usa en los listados compactos. En la tarjeta grande manda la foto."
            />
          </div>

          <Button type="button" onClick={handleSubmit} disabled={pending} className="h-11 w-full">
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Guardando…
              </>
            ) : isEditing ? (
              'Guardar cambios'
            ) : (
              <>
                <Plus className="size-4" />
                Agregar beneficio
              </>
            )}
          </Button>
        </div>
      </DialogContent>

      {/* Confirmación de borrado */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar "{pendingDelete?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              El beneficio deja de mostrarse a los clientes de este nivel. Esta acción no se puede
              deshacer.
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
    </Dialog>
  )
}
