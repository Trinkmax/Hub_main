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
import {
  ChevronDown,
  ExternalLink,
  Handshake,
  Pencil,
  Plus,
  Tag,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { TierBadge } from '@/components/loyalty/tier-badge'
import { MenuImageUploader } from '@/components/media/image-uploader'
import { PhotoButton } from '@/components/media/photo-button'
import { StorageImage } from '@/components/media/storage-image'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
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
import { Field, FieldRow, useFocusFirstInvalid } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberField } from '@/components/ui/number-field'
import { StatusBadge } from '@/components/ui/status-badge'
import { SubmitButton } from '@/components/ui/submit-button'
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
import { PARTNER_STATUS } from '../../_components/club-status'
import {
  DRAGGING_ROW_CLASSES,
  DragHandle,
  ROW_LIST_CLASSES,
  sortableStyle,
  TierToggleChips,
} from '../../_components/club-ui'

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

/** Aviso chico en línea («no lo ve nadie»): ícono + texto de aviso legible. */
function InlineWarning({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-start gap-1.5 type-caption text-pretty text-warning-text">
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

// ── Form de creación de marca ───────────────────────────────
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
      aria-labelledby="partner-new-title"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <h3 id="partner-new-title" className="type-subtitle text-foreground">
        Nueva marca aliada
      </h3>
      <FieldRow>
        <Field label="Nombre" name="name" required>
          <Input maxLength={80} placeholder="Guapa estética" />
        </Field>
        <Field label="Rubro" name="category" optional>
          <Input maxLength={40} placeholder="Estética" />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Sitio o Instagram" name="url" optional>
          <Input type="url" maxLength={500} placeholder="https://…" />
        </Field>
        <Field label="Orden" name="sort" hint="Las de número más bajo se ven primero.">
          <NumberField min={0} defaultValue={0} />
        </Field>
      </FieldRow>
      {/* El logo se sube como cualquier foto de la carta — nada de pegar URLs. */}
      <input type="hidden" name="logo_url" value={logoUrl ?? ''} />
      <MenuImageUploader
        tenantId={tenantId}
        value={logoUrl}
        onChange={setLogoUrl}
        label="Logo (opcional)"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose type-caption text-pretty text-muted-foreground">
          Se agrega oculta: cargale los beneficios y prendela cuando esté lista.
        </p>
        <SubmitButton pendingText="Agregando…">
          <Plus aria-hidden="true" />
          Agregar marca
        </SubmitButton>
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

  // onSubmit y no `action`: si el server rechaza, lo tipeado queda.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!partner) return
    const formData = new FormData(event.currentTarget)
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
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Editar marca</DialogTitle>
          <DialogDescription>
            Los datos de la marca. Los descuentos se cargan en su lista de beneficios: cada uno
            elige a qué niveles llega.
          </DialogDescription>
        </DialogHeader>

        {partner ? (
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
            <DialogBody className="grid gap-4">
              <FieldRow>
                <Field label="Nombre" name="name" required error={error}>
                  <Input maxLength={80} defaultValue={partner.name} />
                </Field>
                <Field label="Rubro" name="category" optional>
                  <Input
                    maxLength={40}
                    defaultValue={partner.category ?? ''}
                    placeholder="Estética"
                  />
                </Field>
              </FieldRow>
              <FieldRow>
                <Field label="Sitio o Instagram" name="url" optional>
                  <Input
                    type="url"
                    maxLength={500}
                    defaultValue={partner.url ?? ''}
                    placeholder="https://…"
                  />
                </Field>
                <Field label="Orden" name="sort" hint="Las de número más bajo se ven primero.">
                  <NumberField min={0} defaultValue={partner.sort} />
                </Field>
              </FieldRow>

              <MenuImageUploader
                tenantId={tenantId}
                value={logoUrl}
                onChange={setLogoUrl}
                label="Logo"
              />
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
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

// ── Dialog de alta / edición de un beneficio de la marca ────
type BenefitDraft = {
  id: string | null
  label: string
  discountPct: number | null
  description: string
  imageUrl: string | null
  tierIds: string[]
}

function emptyDraft(): BenefitDraft {
  return { id: null, label: '', discountPct: null, description: '', imageUrl: null, tierIds: [] }
}

function draftFrom(b: PartnerBenefit): BenefitDraft {
  return {
    id: b.id,
    label: b.label,
    discountPct: b.discount_pct,
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
  const [labelError, setLabelError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstInvalid(formRef, labelError)

  // Un dialog por marca reutilizado para crear y editar: al cambiar el draft
  // (otro beneficio, o "nuevo") hay que resincronizar el form.
  const [prevKey, setPrevKey] = useState(draft?.id ?? '__new__')
  const key = draft?.id ?? '__new__'
  if (key !== prevKey) {
    setPrevKey(key)
    setForm(draft ?? emptyDraft())
    setLabelError(null)
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

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const label = form.label.trim()
    if (!label) {
      setLabelError('Poné el beneficio (ej: 10% off).')
      return
    }
    setLabelError(null)

    const input = {
      ...(form.id ? { id: form.id } : {}),
      partner_id: partner.id,
      label,
      description: form.description.trim() || null,
      discount_pct: form.discountPct,
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
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {form.id ? 'Editar beneficio' : 'Nuevo beneficio'} · {partner.name}
          </DialogTitle>
          <DialogDescription>
            El socio ve solo el beneficio de SU nivel. Si esta marca da 10% a Select y Gold y 30% a
            Black, cargá dos beneficios distintos.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="grid gap-4">
            <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <Field label="Beneficio" error={labelError}>
                <Input
                  value={form.label}
                  onChange={(e) => {
                    set('label', e.target.value)
                    if (labelError) setLabelError(null)
                  }}
                  maxLength={80}
                  placeholder="10% off"
                />
              </Field>
              <Field label="Descuento" optional>
                <NumberField
                  min={0}
                  max={100}
                  decimals={2}
                  suffix="%"
                  steppers={false}
                  placeholder="10"
                  value={form.discountPct}
                  onValueChange={(n) => set('discountPct', n)}
                />
              </Field>
            </div>

            <Field label="Detalle" optional>
              <Textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                maxLength={200}
                showCount
                rows={2}
                placeholder="Cómo se usa, qué incluye, restricciones."
              />
            </Field>

            {/* Selector múltiple de niveles — set arbitrario, no "de tal para arriba". */}
            <div className="grid gap-2">
              <p className="type-label text-foreground">¿Qué niveles lo reciben?</p>
              {tiers.length === 0 ? (
                <p className="type-caption text-muted-foreground">
                  Todavía no hay niveles cargados. Crealos en Puntos y niveles.
                </p>
              ) : (
                <>
                  <TierToggleChips
                    tiers={tiers}
                    selected={form.tierIds}
                    onToggle={toggleTier}
                    aria-label="Niveles que reciben el beneficio"
                  />
                  {noTiers ? (
                    <InlineWarning>
                      Sin niveles elegidos, este beneficio no lo ve nadie.
                    </InlineWarning>
                  ) : null}
                </>
              )}
            </div>

            <MenuImageUploader
              tenantId={tenantId}
              value={form.imageUrl}
              onChange={(url) => set('imageUrl', url)}
              label="Foto del beneficio (opcional)"
            />
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} loadingText="Guardando…">
              {form.id ? 'Guardar cambios' : 'Agregar beneficio'}
            </Button>
          </DialogFooter>
        </form>
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
      style={sortableStyle(transform, transition, isDragging)}
      className={cn('flex items-start gap-2 bg-card px-2 py-2', isDragging && DRAGGING_ROW_CLASSES)}
    >
      <DragHandle
        label={`Reordenar ${benefit.label}`}
        attributes={attributes}
        listeners={listeners}
        className="mt-1"
      />

      <span className="relative mt-0.5 flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
        {benefit.image_url ? (
          <StorageImage src={benefit.image_url} alt="" sizes="44px" />
        ) : (
          <Tag className="size-4 text-subtle-foreground" aria-hidden="true" />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <p
          className={cn(
            'truncate type-body font-medium',
            !benefit.active && 'text-muted-foreground',
          )}
        >
          {benefit.label}
        </p>
        {benefit.description ? (
          <p className="truncate type-caption text-muted-foreground">{benefit.description}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1">
          {linked.length === 0 ? (
            <InlineWarning>Sin niveles: no lo ve nadie</InlineWarning>
          ) : (
            linked.map((t) => <TierBadge key={t.id} tier={t} />)
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 pt-1">
        <Switch
          checked={benefit.active}
          onCheckedChange={onToggle}
          disabled={pending}
          aria-label={`${benefit.label} activo`}
          className="mr-1"
        />
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onEdit}
          aria-label={`Editar ${benefit.label}`}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          size="icon-sm"
          variant="danger-ghost"
          onClick={onDelete}
          aria-label={`Borrar ${benefit.label}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}

// ── Una marca con su lista de beneficios ────────────────────
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
  const switchId = useId()
  const [pending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState(false)
  const [benefitDraft, setBenefitDraft] = useState<BenefitDraft | null>(null)
  const [benefitOpen, setBenefitOpen] = useState(false)
  const [toDelete, setToDelete] = useState<PartnerBenefit | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

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
          next ? `«${partner.name}» ya se ve en la billetera.` : `«${partner.name}» quedó oculta.`,
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

  const onClearLegacy = () => {
    startTransition(async () => {
      const result = await clearPartnerLegacyDiscount(tenantSlug, partner.id)
      if (result.ok) toast.success(result.message ?? 'Descuento viejo quitado.')
      else toast.error(result.message)
    })
  }

  const activeCount = order.filter((b) => b.active).length
  const panelId = `partner-benefits-${partner.id}`

  return (
    <li
      className={cn(
        'overflow-clip rounded-xl border bg-card',
        partner.active ? 'border-border' : 'border-dashed border-border-strong',
      )}
    >
      <div className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap sm:p-4">
        <PhotoButton
          src={partner.logo_url}
          sizes="48px"
          shape="circle"
          fallbackIcon={Handshake}
          fallback={
            <span className="type-subtitle text-muted-foreground" aria-hidden="true">
              {partner.name.charAt(0).toUpperCase()}
            </span>
          }
          label={`Cambiar el logo de ${partner.name}`}
          onClick={onEditPartner}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate type-body font-medium text-foreground">{partner.name}</span>
            {partner.active ? null : <StatusBadge status="hidden" map={PARTNER_STATUS} />}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 type-small text-muted-foreground">
            {partner.category ? <span>{partner.category}</span> : null}
            {partner.category ? <span aria-hidden="true">·</span> : null}
            <span>
              {activeCount === 0
                ? 'Sin beneficios activos'
                : `${activeCount} ${activeCount === 1 ? 'beneficio' : 'beneficios'}`}
            </span>
            {partner.url ? (
              <>
                <span aria-hidden="true">·</span>
                <a
                  href={partner.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline decoration-1 underline-offset-[3px] hover:text-foreground hover:decoration-2"
                >
                  Ver sitio
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </>
            ) : null}
          </div>
        </div>

        {/* Visible/oculta: un toque, sin entrar a ningún dialog. */}
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            id={switchId}
            checked={partner.active}
            onCheckedChange={onTogglePartner}
            disabled={pending}
            aria-label={`${partner.name} visible en la billetera`}
          />
          {/* El texto dice el estado; el nombre del interruptor queda fijo (aria-label). */}
          <Label
            htmlFor={switchId}
            aria-hidden="true"
            className="min-w-12 cursor-pointer text-muted-foreground"
          >
            {partner.active ? 'Visible' : 'Oculta'}
          </Label>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onEditPartner}
            aria-label={`Editar ${partner.name}`}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            size="icon-sm"
            variant="danger-ghost"
            onClick={onDeletePartner}
            aria-label={`Borrar ${partner.name}`}
          >
            <Trash2 aria-hidden="true" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`Beneficios de ${partner.name}`}
          >
            <ChevronDown className={cn(expanded && 'rotate-180')} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {expanded ? (
        <div id={panelId} className="flex flex-col gap-3 border-t border-border p-3 sm:p-4">
          {/* Legacy: el texto viejo no sabía a qué nivel aplicaba. Solo lectura. */}
          {partner.discount_label ? (
            <Callout
              tone="neutral"
              title={`Descuento viejo: ${partner.discount_label}`}
              action={
                <Button size="sm" variant="secondary" onClick={onClearLegacy} disabled={pending}>
                  Quitar
                </Button>
              }
            >
              No sabía a qué nivel aplicaba. Ya lo pasamos a beneficio: quitalo cuando lo veas
              duplicado.
            </Callout>
          ) : null}

          {order.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center type-small text-pretty text-muted-foreground">
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
                <ul className={ROW_LIST_CLASSES} aria-label={`Beneficios de ${partner.name}`}>
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
                      onDelete={() => {
                        setToDelete(b)
                        setDeleteOpen(true)
                      }}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {uncovered.length > 0 && order.length > 0 ? (
            <InlineWarning>
              Los socios {uncovered.map((t) => t.name).join(', ')} no van a ver nada de esta marca.
            </InlineWarning>
          ) : null}

          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              setBenefitDraft(null)
              setBenefitOpen(true)
            }}
          >
            <Plus aria-hidden="true" />
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

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title={`¿Borrar «${toDelete?.label ?? ''}»?`}
        description="Los socios de los niveles asignados dejan de verlo. No se puede deshacer."
        confirmLabel="Borrar beneficio"
        pendingLabel="Borrando…"
        onConfirm={async () => {
          if (!toDelete) return
          const target = toDelete
          const result = await deletePartnerBenefit(tenantSlug, target.id)
          if (!result.ok) return { ok: false, error: result.message }
          if (target.image_url && isStorageUrl(target.image_url)) {
            try {
              await deleteMenuImageByUrl(target.image_url)
            } catch {
              // huérfano tolerable
            }
          }
          toast.success('Beneficio borrado.')
        }}
      />
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
  const [editing, setEditing] = useState<Partner | null>(null)
  const [toDelete, setToDelete] = useState<Partner | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

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

  return (
    <div className="flex flex-col gap-6">
      <NewPartnerForm tenantSlug={tenantSlug} tenantId={tenantId} />

      {partners.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="Todavía no hay marcas aliadas"
          description="Sumá comercios amigos que les den descuentos a tus socios. Cargá el primero con el formulario de arriba."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {/* El estado oculto es el motivo #1 de "no se ve nada en la billetera". */}
          {hiddenCount > 0 ? (
            <Callout
              tone="warning"
              title={`${hiddenCount} ${hiddenCount === 1 ? 'marca oculta' : 'marcas ocultas'} de ${partners.length}`}
            >
              {hiddenCount === partners.length
                ? 'La sección «Nuestros Aliados» no aparece en la billetera del socio.'
                : 'No se ven en la billetera del socio.'}{' '}
              Prendé el interruptor de cada una para publicarla.
            </Callout>
          ) : (
            <p className="type-small text-muted-foreground">
              {partners.length} {partners.length === 1 ? 'marca visible' : 'marcas visibles'} para
              tus socios.
            </p>
          )}

          <ul className="flex flex-col gap-3" aria-label="Marcas aliadas">
            {partners.map((partner) => (
              <PartnerCard
                key={partner.id}
                tenantSlug={tenantSlug}
                tenantId={tenantId}
                partner={partner}
                benefits={byPartner.get(partner.id) ?? []}
                tiers={ladder}
                onEditPartner={() => setEditing(partner)}
                onDeletePartner={() => {
                  setToDelete(partner)
                  setDeleteOpen(true)
                }}
              />
            ))}
          </ul>
        </div>
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

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title={`¿Borrar la marca «${toDelete?.name ?? ''}»?`}
        description="Se borran también sus beneficios. Si solo querés sacarla de la billetera, ocultala con el interruptor. No se puede deshacer."
        confirmLabel="Borrar marca"
        pendingLabel="Borrando…"
        onConfirm={async () => {
          if (!toDelete) return
          const target = toDelete
          const result = await deletePartner(tenantSlug, target.id)
          if (!result.ok) return { ok: false, error: result.message }
          toast.success(`Marca «${target.name}» borrada.`)
        }}
      />
    </div>
  )
}
