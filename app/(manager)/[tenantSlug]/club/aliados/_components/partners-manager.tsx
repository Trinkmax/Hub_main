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
  Camera,
  ChevronDown,
  ExternalLink,
  GripVertical,
  Handshake,
  Loader2,
  Pencil,
  Plus,
  Tag,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
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
import { isStorageUrl } from '@/lib/menu/media-urls'
import { deleteMenuImageByUrl } from '@/lib/menu/upload-image'
import {
  clearPartnerLegacyDiscount,
  createPartner,
  createPartnerBenefit,
  deletePartner,
  deletePartnerBenefit,
  type LoyaltyActionState,
  reorderPartnerBenefits,
  togglePartner,
  togglePartnerBenefit,
  updatePartner,
  updatePartnerBenefit,
} from '@/lib/points/actions'
import { type PartnerBenefit, tiersWithoutPartnerBenefit } from '@/lib/points/benefits'
import type { Partner } from '@/lib/points/queries'
import { type LoyaltyTier, sortedActiveTiers } from '@/lib/points/tiers'
import { cn } from '@/lib/utils'
import { MenuImageUploader } from '../../../menu/_components/image-uploader'

const initial: LoyaltyActionState = { ok: true }

/** Orden visual estable: `sort` asc, label como desempate. */
function sortBenefits(list: readonly PartnerBenefit[]): PartnerBenefit[] {
  return list.slice().sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, 'es'))
}

/**
 * Firma del CONTENIDO (no del orden): si cambia, la lista se resincroniza con el
 * server; si sólo cambió el orden, respetamos el optimista del drag.
 */
function contentSignature(list: readonly PartnerBenefit[]): string {
  return list
    .map(
      (b) =>
        `${b.id}:${b.label}:${b.active ? 1 : 0}:${b.discount_pct ?? ''}:${b.image_url ?? ''}:${b.description ?? ''}:${b.tier_ids.slice().sort().join(',')}`,
    )
    .sort()
    .join('|')
}

// ── Avatar del aliado ───────────────────────────────────────
function PartnerLogo({ partner }: { partner: Partner }) {
  if (partner.logo_url) {
    return (
      <span className="relative flex size-12 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-background">
        <StorageImage src={partner.logo_url} alt="" sizes="48px" />
      </span>
    )
  }
  return (
    <span className="flex size-12 items-center justify-center rounded-full bg-(--cream-tint) text-base font-semibold text-muted-foreground">
      {partner.name.charAt(0).toUpperCase()}
    </span>
  )
}

/** Chip con el color del nivel. Tocable: es el selector múltiple del beneficio. */
function TierChip({
  tier,
  selected,
  onToggle,
}: {
  tier: LoyaltyTier
  selected: boolean
  onToggle?: () => void
}) {
  const accent = tier.color ?? undefined
  const style = selected
    ? { backgroundColor: accent, borderColor: accent, color: accent ? '#fff' : undefined }
    : { borderColor: accent, color: accent }

  if (!onToggle) {
    return (
      <span
        style={style}
        className="inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-medium"
      >
        {tier.name}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      style={style}
      className={cn(
        'inline-flex h-11 items-center rounded-full border px-3.5 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        !selected && 'bg-background hover:bg-secondary/60',
      )}
    >
      {tier.name}
    </button>
  )
}

// ── Form de creación de marca ───────────────────────────────
function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} size="sm" className="h-10 gap-1.5">
      <Plus className="size-3.5" />
      {pending ? 'Agregando…' : 'Agregar marca'}
    </Button>
  )
}

function NewPartnerForm({ tenantSlug, tenantId }: { tenantSlug: string; tenantId: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [state, formAction] = useActionState(
    async (_prev: LoyaltyActionState, formData: FormData): Promise<LoyaltyActionState> =>
      // Sin `discount_label`: el descuento se carga como beneficio, que sí sabe
      // a qué niveles corresponde.
      createPartner(tenantSlug, {
        name: String(formData.get('name') ?? '').trim(),
        category: String(formData.get('category') ?? '').trim(),
        logo_url: String(formData.get('logo_url') ?? '').trim(),
        url: String(formData.get('url') ?? '').trim(),
        sort: Number(formData.get('sort') ?? 0),
      }),
    initial,
  )

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setLogoUrl(null)
    } else if (!state.ok) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      className="card-hairline rounded-xl border bg-card p-4 space-y-3"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Nueva marca aliada
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="pn-name" className="text-[11px] text-muted-foreground">
            Nombre
          </Label>
          <Input id="pn-name" name="name" required maxLength={80} placeholder="Guapa estética" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pn-category" className="text-[11px] text-muted-foreground">
            Rubro
          </Label>
          <Input id="pn-category" name="category" maxLength={40} placeholder="Estética" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pn-url" className="text-[11px] text-muted-foreground">
            Sitio o Instagram (opcional)
          </Label>
          <Input id="pn-url" name="url" type="url" maxLength={500} placeholder="https://…" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pn-sort" className="text-[11px] text-muted-foreground">
            Orden
          </Label>
          <Input id="pn-sort" name="sort" type="number" defaultValue={0} className="tabular-nums" />
        </div>
      </div>
      {/* El logo se sube como cualquier foto de la carta — nada de pegar URLs. */}
      <input type="hidden" name="logo_url" value={logoUrl ?? ''} />
      <MenuImageUploader
        tenantId={tenantId}
        value={logoUrl}
        onChange={setLogoUrl}
        label="Logo (opcional)"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground text-pretty">
          Se agrega oculta. Cargale los descuentos y activala cuando esté lista.
        </p>
        <SubmitBtn />
      </div>
    </form>
  )
}

// ── Dialog de edición de la ficha de la marca ───────────────
function PartnerEditDialog({
  tenantSlug,
  tenantId,
  partner,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  tenantId: string
  partner: Partner | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(partner?.logo_url ?? null)

  // Una sola instancia del dialog para todas las filas: re-sincronizar el logo
  // al cambiar de marca (patrón prev-props en render).
  const [prevPartnerId, setPrevPartnerId] = useState(partner?.id ?? null)
  if ((partner?.id ?? null) !== prevPartnerId) {
    setPrevPartnerId(partner?.id ?? null)
    setLogoUrl(partner?.logo_url ?? null)
    setError(null)
  }

  const handleSubmit = (formData: FormData) => {
    if (!partner) return
    const name = String(formData.get('name') ?? '').trim()
    if (!name) {
      setError('Poné un nombre.')
      return
    }
    setError(null)

    const input = {
      id: partner.id,
      name,
      category: String(formData.get('category') ?? '').trim(),
      logo_url: logoUrl ?? '',
      url: String(formData.get('url') ?? '').trim(),
      sort: Number(formData.get('sort') ?? 0),
      // Preservamos el estado visible/oculta: se cambia con el switch, no acá.
      active: partner.active,
    }

    startTransition(async () => {
      const result = await updatePartner(tenantSlug, input)
      if (result.ok) {
        // Limpieza best-effort del logo anterior si era nuestro y cambió.
        if (partner.logo_url && partner.logo_url !== logoUrl && isStorageUrl(partner.logo_url)) {
          try {
            await deleteMenuImageByUrl(partner.logo_url)
          } catch {
            // huérfano tolerable; lo barre el script de prune
          }
        }
        toast.success('Marca actualizada.')
        onOpenChange(false)
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Editar marca</DialogTitle>
          <DialogDescription>
            Los datos de la marca. Los descuentos se cargan abajo, en su lista de beneficios: cada
            uno elige a qué niveles llega.
          </DialogDescription>
        </DialogHeader>

        {partner ? (
          <form action={handleSubmit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pn-edit-name" className="text-xs text-muted-foreground">
                  Nombre
                </Label>
                <Input
                  id="pn-edit-name"
                  name="name"
                  required
                  maxLength={80}
                  defaultValue={partner.name}
                  aria-invalid={error ? true : undefined}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pn-edit-category" className="text-xs text-muted-foreground">
                  Rubro
                </Label>
                <Input
                  id="pn-edit-category"
                  name="category"
                  maxLength={40}
                  defaultValue={partner.category ?? ''}
                  placeholder="Estética"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pn-edit-url" className="text-xs text-muted-foreground">
                  Sitio o Instagram (opcional)
                </Label>
                <Input
                  id="pn-edit-url"
                  name="url"
                  type="url"
                  maxLength={500}
                  defaultValue={partner.url ?? ''}
                  placeholder="https://…"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pn-edit-sort" className="text-xs text-muted-foreground">
                  Orden
                </Label>
                <Input
                  id="pn-edit-sort"
                  name="sort"
                  type="number"
                  defaultValue={partner.sort}
                  className="tabular-nums"
                />
              </div>
            </div>

            <MenuImageUploader
              tenantId={tenantId}
              value={logoUrl}
              onChange={setLogoUrl}
              label="Logo"
            />

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending} className="min-w-[140px]">
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  'Guardar cambios'
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ── Dialog de alta / edición de un beneficio de la marca ────
type BenefitDraft = {
  id: string | null
  label: string
  discountPct: string
  description: string
  imageUrl: string | null
  tierIds: string[]
}

function emptyDraft(): BenefitDraft {
  return { id: null, label: '', discountPct: '', description: '', imageUrl: null, tierIds: [] }
}

function draftFrom(b: PartnerBenefit): BenefitDraft {
  return {
    id: b.id,
    label: b.label,
    discountPct: b.discount_pct === null ? '' : String(b.discount_pct),
    description: b.description ?? '',
    imageUrl: b.image_url,
    tierIds: b.tier_ids,
  }
}

function BenefitDialog({
  tenantSlug,
  tenantId,
  partner,
  draft,
  tiers,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  tenantId: string
  partner: Partner
  draft: BenefitDraft | null
  tiers: LoyaltyTier[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState<BenefitDraft>(draft ?? emptyDraft())

  // Un dialog por marca reutilizado para crear y editar: al cambiar el draft
  // (otro beneficio, o "nuevo") hay que resincronizar el form.
  const [prevKey, setPrevKey] = useState(draft?.id ?? '__new__')
  const key = draft?.id ?? '__new__'
  if (key !== prevKey) {
    setPrevKey(key)
    setForm(draft ?? emptyDraft())
  }

  const set = <K extends keyof BenefitDraft>(k: K, v: BenefitDraft[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }))

  const toggleTier = (tierId: string) =>
    setForm((prev) => ({
      ...prev,
      tierIds: prev.tierIds.includes(tierId)
        ? prev.tierIds.filter((t) => t !== tierId)
        : [...prev.tierIds, tierId],
    }))

  const previousImage = draft?.imageUrl ?? null

  const handleSubmit = () => {
    const label = form.label.trim()
    if (!label) {
      toast.error('Poné el beneficio (ej: 10% off).')
      return
    }

    const input = {
      ...(form.id ? { id: form.id } : {}),
      partner_id: partner.id,
      label,
      description: form.description.trim() || null,
      discount_pct: form.discountPct.trim() === '' ? null : Number(form.discountPct),
      image_url: form.imageUrl,
      active: true,
      tier_ids: form.tierIds,
    }

    startTransition(async () => {
      const result = form.id
        ? await updatePartnerBenefit(tenantSlug, input)
        : await createPartnerBenefit(tenantSlug, input)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // Limpieza best-effort de la foto reemplazada. Si falla queda un huérfano
      // tolerable que barre el script de prune: nunca debe romper el guardado.
      if (previousImage && previousImage !== form.imageUrl && isStorageUrl(previousImage)) {
        try {
          await deleteMenuImageByUrl(previousImage)
        } catch {
          // huérfano tolerable
        }
      }
      toast.success(form.id ? 'Beneficio actualizado.' : 'Beneficio agregado.')
      onOpenChange(false)
    })
  }

  const noTiers = form.tierIds.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {form.id ? 'Editar beneficio' : 'Nuevo beneficio'} · {partner.name}
          </DialogTitle>
          <DialogDescription>
            El socio ve sólo el beneficio de SU nivel. Si esta marca da 10% a Select y Gold y 30% a
            Black, cargá dos beneficios distintos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <div className="grid gap-1.5">
              <Label htmlFor="pb-label" className="text-xs text-muted-foreground">
                Beneficio
              </Label>
              <Input
                id="pb-label"
                value={form.label}
                onChange={(e) => set('label', e.target.value)}
                maxLength={80}
                placeholder="10% off"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pb-pct" className="text-xs text-muted-foreground">
                % (opcional)
              </Label>
              <Input
                id="pb-pct"
                type="number"
                min={0}
                max={100}
                value={form.discountPct}
                onChange={(e) => set('discountPct', e.target.value)}
                className="tabular-nums"
                placeholder="10"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pb-desc" className="text-xs text-muted-foreground">
              Detalle (opcional)
            </Label>
            <Textarea
              id="pb-desc"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              maxLength={200}
              rows={2}
              className="resize-none"
              placeholder="Cómo se usa, qué incluye, restricciones."
            />
          </div>

          {/* Selector múltiple de niveles — set arbitrario, no "de tal para arriba". */}
          <fieldset className="grid gap-2 rounded-lg border border-border/60 bg-background/40 p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              ¿Qué niveles lo reciben?
            </legend>
            {tiers.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Todavía no hay niveles cargados. Creá los niveles en Puntos y niveles.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {tiers.map((t) => (
                    <TierChip
                      key={t.id}
                      tier={t}
                      selected={form.tierIds.includes(t.id)}
                      onToggle={() => toggleTier(t.id)}
                    />
                  ))}
                </div>
                {noTiers ? (
                  <p className="inline-flex items-start gap-1.5 text-[11px] text-warning">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                    Sin niveles elegidos este beneficio no lo ve nadie.
                  </p>
                ) : null}
              </>
            )}
          </fieldset>

          <MenuImageUploader
            tenantId={tenantId}
            value={form.imageUrl}
            onChange={(url) => set('imageUrl', url)}
            label="Foto del beneficio (opcional)"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={pending} className="min-w-[150px]">
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Guardando…
              </>
            ) : form.id ? (
              'Guardar cambios'
            ) : (
              'Agregar beneficio'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Fila arrastrable de un beneficio ────────────────────────
function BenefitRow({
  benefit,
  tiers,
  pending,
  onEdit,
  onToggle,
  onDelete,
}: {
  benefit: PartnerBenefit
  tiers: LoyaltyTier[]
  pending: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: benefit.id,
  })
  const linked = tiers.filter((t) => benefit.tier_ids.includes(t.id))

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className={cn(
        'flex items-start gap-2 bg-card px-2 py-2.5',
        !benefit.active && 'opacity-60',
        isDragging && 'relative z-10 shadow-md',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`Reordenar ${benefit.label}`}
        // touch-none: sin esto el gesto de arrastre en tablet scrollea la página.
        className="size-11 shrink-0 cursor-grab touch-none rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="mx-auto size-4" />
      </button>

      <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary/60">
        {benefit.image_url ? (
          <StorageImage src={benefit.image_url} alt="" sizes="44px" />
        ) : (
          <Tag className="size-4 text-muted-foreground/70" aria-hidden />
        )}
      </span>

      <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
        <p className="truncate text-sm font-medium">{benefit.label}</p>
        {benefit.description ? (
          <p className="truncate text-[11px] text-muted-foreground">{benefit.description}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1">
          {linked.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-warning">
              <TriangleAlert className="size-3" aria-hidden />
              Sin niveles: no lo ve nadie
            </span>
          ) : (
            linked.map((t) => <TierChip key={t.id} tier={t} selected />)
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="size-11 text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          aria-label={`Editar ${benefit.label}`}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label={`Borrar ${benefit.label}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="flex shrink-0 items-center pt-3">
        <Switch
          checked={benefit.active}
          onCheckedChange={onToggle}
          disabled={pending}
          aria-label={benefit.active ? `Pausar ${benefit.label}` : `Activar ${benefit.label}`}
        />
      </div>
    </li>
  )
}

// ── Card de una marca con su lista de beneficios ────────────
function PartnerCard({
  tenantSlug,
  tenantId,
  partner,
  benefits,
  tiers,
  onEditPartner,
  onDeletePartner,
}: {
  tenantSlug: string
  tenantId: string
  partner: Partner
  benefits: PartnerBenefit[]
  tiers: LoyaltyTier[]
  onEditPartner: () => void
  onDeletePartner: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState(false)
  const [benefitDraft, setBenefitDraft] = useState<BenefitDraft | null>(null)
  const [benefitOpen, setBenefitOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PartnerBenefit | null>(null)

  // Orden optimista de los beneficios (el drag no espera al server).
  const [order, setOrder] = useState<PartnerBenefit[]>(() => sortBenefits(benefits))
  if (contentSignature(benefits) !== contentSignature(order)) {
    setOrder(sortBenefits(benefits))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Niveles que no reciben NADA de esta marca: sus socios no la ven.
  const uncovered = tiersWithoutPartnerBenefit(tiers, order)

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
      const result = await reorderPartnerBenefits(
        tenantSlug,
        partner.id,
        next.map((b) => b.id),
      )
      if (!result.ok) {
        toast.error(result.message)
        setOrder(previous)
      }
    })
  }

  const onTogglePartner = (next: boolean) => {
    startTransition(async () => {
      const result = await togglePartner(tenantSlug, partner.id, next)
      if (result.ok) {
        toast.success(
          next ? `"${partner.name}" ya se ve en la billetera.` : `"${partner.name}" ocultada.`,
        )
      } else {
        toast.error(result.message)
      }
    })
  }

  const onToggleBenefit = (b: PartnerBenefit) => {
    startTransition(async () => {
      const result = await togglePartnerBenefit(tenantSlug, b.id, !b.active)
      if (!result.ok) toast.error(result.message)
    })
  }

  const onConfirmDeleteBenefit = () => {
    if (!pendingDelete) return
    const target = pendingDelete
    startTransition(async () => {
      const result = await deletePartnerBenefit(tenantSlug, target.id)
      if (result.ok) {
        if (target.image_url && isStorageUrl(target.image_url)) {
          try {
            await deleteMenuImageByUrl(target.image_url)
          } catch {
            // huérfano tolerable
          }
        }
        toast.success('Beneficio eliminado.')
      } else {
        toast.error(result.message)
      }
      setPendingDelete(null)
    })
  }

  const onClearLegacy = () => {
    startTransition(async () => {
      const result = await clearPartnerLegacyDiscount(tenantSlug, partner.id)
      if (result.ok) toast.success(result.message ?? 'Descuento viejo eliminado.')
      else toast.error(result.message)
    })
  }

  const activeCount = order.filter((b) => b.active).length
  const panelId = `partner-benefits-${partner.id}`

  return (
    <li
      className={cn(
        'card-hairline overflow-hidden rounded-xl border bg-card',
        !partner.active && 'border-dashed bg-card/60',
      )}
    >
      <div className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap">
        <button
          type="button"
          onClick={onEditPartner}
          aria-label={`Editar logo de ${partner.name}`}
          title="Logo del aliado"
          className="group/foto relative shrink-0 overflow-hidden rounded-full transition-shadow hover:ring-2 hover:ring-primary/50"
        >
          <PartnerLogo partner={partner} />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover/foto:opacity-100">
            <Camera className="size-4 text-white" aria-hidden />
          </span>
        </button>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-foreground">{partner.name}</span>
            {partner.active ? null : (
              <Badge variant="warning" className="gap-1">
                Oculta · sale como "Próximamente"
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {partner.category ? <span>{partner.category}</span> : null}
            <span>
              {activeCount === 0
                ? 'Sin beneficios activos'
                : `${activeCount} ${activeCount === 1 ? 'beneficio' : 'beneficios'}`}
            </span>
            {partner.url ? (
              <a
                href={partner.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <ExternalLink className="size-3" aria-hidden />
                Ver
              </a>
            ) : null}
          </div>
        </div>

        {/* Visible/oculta: un toque, sin entrar a ningún dialog. */}
        <div className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-2.5">
          <Switch
            id={`partner-active-${partner.id}`}
            checked={partner.active}
            onCheckedChange={onTogglePartner}
            disabled={pending}
            aria-label={partner.active ? `Ocultar ${partner.name}` : `Mostrar ${partner.name}`}
          />
          <Label
            htmlFor={`partner-active-${partner.id}`}
            className="cursor-pointer text-xs text-muted-foreground"
          >
            {partner.active ? 'Visible' : 'Oculta'}
          </Label>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-11 text-muted-foreground hover:text-foreground"
            onClick={onEditPartner}
            aria-label={`Editar ${partner.name}`}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-11 text-muted-foreground hover:text-destructive"
            onClick={onDeletePartner}
            aria-label={`Borrar ${partner.name}`}
          >
            <Trash2 className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-11 text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={
              expanded
                ? `Ocultar beneficios de ${partner.name}`
                : `Ver beneficios de ${partner.name}`
            }
          >
            <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
          </Button>
        </div>
      </div>

      {expanded ? (
        <div id={panelId} className="space-y-3 border-t border-border/60 bg-background/40 p-3">
          {/* Legacy: el texto viejo no sabía a qué nivel aplicaba. Solo lectura. */}
          {partner.discount_label ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2">
              <p className="text-[11px] text-muted-foreground text-pretty">
                Descuento viejo:{' '}
                <strong className="text-foreground">{partner.discount_label}</strong> — no sabía a
                qué nivel aplicaba. Ya lo pasamos a beneficio; borralo cuando lo veas duplicado.
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-10"
                onClick={onClearLegacy}
                disabled={pending}
              >
                Quitar
              </Button>
            </div>
          ) : null}

          {order.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground text-pretty">
              Esta marca todavía no tiene beneficios. Cargá el primero: podés dar 10% a Select y
              Gold, y 30% a Black.
            </p>
          ) : (
            <DndContext
              id={`partner-benefits-dnd-${partner.id}`}
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
                      tiers={tiers}
                      pending={pending}
                      onEdit={() => {
                        setBenefitDraft(draftFrom(b))
                        setBenefitOpen(true)
                      }}
                      onToggle={() => onToggleBenefit(b)}
                      onDelete={() => setPendingDelete(b)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {uncovered.length > 0 && order.length > 0 ? (
            <p className="inline-flex items-start gap-1.5 text-[11px] text-warning text-pretty">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
              Los socios {uncovered.map((t) => t.name).join(', ')} no van a ver nada de esta marca.
            </p>
          ) : null}

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full gap-1.5"
            onClick={() => {
              setBenefitDraft(null)
              setBenefitOpen(true)
            }}
          >
            <Plus className="size-4" />
            Agregar beneficio de {partner.name}
          </Button>
        </div>
      ) : null}

      <BenefitDialog
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        partner={partner}
        draft={benefitDraft}
        tiers={tiers}
        open={benefitOpen}
        onOpenChange={(next) => {
          setBenefitOpen(next)
          if (!next) setBenefitDraft(null)
        }}
      />

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
              Los socios de los niveles asignados dejan de verlo. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                onConfirmDeleteBenefit()
              }}
              disabled={pending}
            >
              {pending ? 'Borrando…' : 'Borrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

// ── Manager principal ───────────────────────────────────────
export function PartnersManager({
  tenantSlug,
  tenantId,
  partners,
  tiers,
  partnerBenefits,
}: {
  tenantSlug: string
  tenantId: string
  partners: Partner[]
  /** Niveles activos: alimentan los chips del selector múltiple. */
  tiers: LoyaltyTier[]
  partnerBenefits: PartnerBenefit[]
}) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<Partner | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Partner | null>(null)

  // Sólo niveles activos y en orden de escalera: un nivel apagado no tiene
  // socios, así que ni se ofrece como destino ni dispara el aviso de "no ven nada".
  const ladder = sortedActiveTiers(tiers)

  const byPartner = new Map<string, PartnerBenefit[]>()
  for (const b of partnerBenefits) {
    const bucket = byPartner.get(b.partner_id) ?? []
    bucket.push(b)
    byPartner.set(b.partner_id, bucket)
  }

  const hiddenCount = partners.filter((p) => !p.active).length

  const onConfirmDelete = () => {
    if (!pendingDelete) return
    const target = pendingDelete
    startTransition(async () => {
      const result = await deletePartner(tenantSlug, target.id)
      if (result.ok) toast.success(`Marca "${target.name}" eliminada.`)
      else toast.error(result.message)
      setPendingDelete(null)
    })
  }

  return (
    <div className="space-y-5">
      <NewPartnerForm tenantSlug={tenantSlug} tenantId={tenantId} />

      {partners.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="Todavía no hay marcas aliadas"
          description="Sumá comercios amigos que ofrezcan descuentos a tus socios. Cargá el primero con el formulario de arriba."
        />
      ) : (
        <>
          {/* El estado oculto es el motivo #1 de "no se ve nada en la billetera". */}
          {hiddenCount > 0 ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-pretty">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <p className="text-muted-foreground">
                <strong className="text-foreground">
                  {hiddenCount} {hiddenCount === 1 ? 'marca oculta' : 'marcas ocultas'}
                </strong>{' '}
                de {partners.length}. En la billetera del socio salen como "Próximamente". Prendé el
                switch de cada una para publicarlas.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {partners.length} {partners.length === 1 ? 'marca visible' : 'marcas visibles'} para
              tus socios.
            </p>
          )}

          <ul className="space-y-3">
            {partners.map((partner) => (
              <PartnerCard
                key={partner.id}
                tenantSlug={tenantSlug}
                tenantId={tenantId}
                partner={partner}
                benefits={byPartner.get(partner.id) ?? []}
                tiers={ladder}
                onEditPartner={() => setEditing(partner)}
                onDeletePartner={() => setPendingDelete(partner)}
              />
            ))}
          </ul>
        </>
      )}

      {/* Dialog de edición controlado: una sola instancia para todas las filas */}
      <PartnerEditDialog
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        partner={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />

      {/* Confirmación de borrado de la marca */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la marca "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran también sus beneficios. Si sólo querés sacarla de la billetera, ocultala con
              el switch. Esta acción no se puede deshacer.
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
