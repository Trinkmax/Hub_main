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
  Gift,
  Handshake,
  type LucideIcon,
  Pencil,
  Percent,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { type ReactNode, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { MenuImageUploader } from '@/components/media/image-uploader'
import { StorageImage } from '@/components/media/storage-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Combobox } from '@/components/ui/combobox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldRow, useFocusFirstInvalid } from '@/components/ui/field'
import { IconPicker } from '@/components/ui/icon-picker'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
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
import { DRAGGING_ROW_CLASSES, DragHandle, ROW_LIST_CLASSES, sortableStyle } from './club-ui'

type IdName = { id: string; name: string }

/** Ícono por tipo de beneficio (espejo de BENEFIT_KIND_META[k].icon). */
const KIND_ICON: Record<TierBenefitKind, LucideIcon> = {
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
  quantity: number | null
  discountPct: number | null
  discountScope: string
  partnerId: string
  sort: number
  active: boolean
}

type FormErrors = Partial<Record<'label' | 'rewardId' | 'discountPct' | 'partnerId', string>>

const EMPTY_FORM: FormState = {
  editingId: null,
  kind: 'recurring_reward',
  label: '',
  description: '',
  icon: '',
  imageUrl: null,
  rewardId: '',
  cadence: 'monthly',
  quantity: 1,
  discountPct: null,
  discountScope: '',
  partnerId: '',
  sort: 0,
  active: true,
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
      style={sortableStyle(transform, transition, isDragging)}
      className={cn(
        'flex items-center gap-2 bg-card px-2 py-2',
        isDragging && DRAGGING_ROW_CLASSES,
      )}
    >
      <DragHandle
        label={`Reordenar ${benefit.label}`}
        attributes={attributes}
        listeners={listeners}
      />

      {/* Miniatura: la foto real si la cargó, si no el ícono del tipo. */}
      <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
        {benefit.image_url ? (
          <StorageImage src={benefit.image_url} alt="" sizes="40px" />
        ) : (
          <Icon className="size-4 text-subtle-foreground" aria-hidden="true" />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'truncate type-body font-medium',
              !benefit.active && 'text-muted-foreground',
            )}
          >
            {benefit.label}
          </span>
          <Badge icon={Icon}>{BENEFIT_KIND_META[benefit.kind].label}</Badge>
        </div>
        {benefit.description ? (
          <p className="truncate type-caption text-muted-foreground">{benefit.description}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
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
  const [saving, startSaving] = useTransition()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<FormErrors>({})
  const formRef = useRef<HTMLFormElement>(null)
  // Cada envío que no pasa la validación lleva el foco al primer campo a
  // corregir (solo al enviar: mientras se escribe, el foco no salta).
  const [failedSubmits, setFailedSubmits] = useState(0)
  useFocusFirstInvalid(formRef, failedSubmits === 0 ? null : failedSubmits)
  const [toDelete, setToDelete] = useState<TierBenefit | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Orden optimista de la lista (el drag no espera al server).
  const [order, setOrder] = useState<TierBenefit[]>(() => sortBenefits(benefits))
  if (contentSignature(benefits) !== contentSignature(order)) {
    setOrder(sortBenefits(benefits))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    // Lo que se corrige deja de marcarse como error.
    setErrors((prev) =>
      prev[key as keyof FormErrors] !== undefined ? { ...prev, [key]: undefined } : prev,
    )
  }

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setErrors({})
  }

  const startEdit = (b: TierBenefit) => {
    setErrors({})
    setForm({
      editingId: b.id,
      kind: b.kind,
      label: b.label,
      description: b.description ?? '',
      icon: b.icon ?? '',
      imageUrl: b.image_url,
      rewardId: b.reward_id ?? '',
      cadence: b.cadence === 'none' ? 'monthly' : b.cadence,
      quantity: b.quantity ?? 1,
      discountPct: b.discount_pct,
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

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const label = form.label.trim()
    const nextErrors: FormErrors = {}
    if (!label) nextErrors.label = 'Poné un nombre para el beneficio.'
    if (form.kind === 'recurring_reward' && !form.rewardId) {
      nextErrors.rewardId = 'Elegí la recompensa gratis.'
    }
    if (form.kind === 'discount' && form.discountPct === null) {
      nextErrors.discountPct = 'Indicá el % de descuento.'
    }
    if (form.kind === 'partner' && !form.partnerId) {
      nextErrors.partnerId = 'Elegí la marca aliada.'
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      setFailedSubmits((n) => n + 1)
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
      quantity: form.quantity ?? 1,
      discount_pct: form.discountPct,
      discount_scope: form.discountScope.trim() || null,
      partner_id: form.partnerId || null,
      sort: form.sort,
      active: form.active,
    }

    const previousImage = editingOriginal?.image_url ?? null

    startSaving(async () => {
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

  const nameField = (placeholder: string, className?: string) => (
    <Field label="Nombre" error={errors.label} className={className}>
      <Input
        value={form.label}
        onChange={(e) => set('label', e.target.value)}
        maxLength={80}
        placeholder={placeholder}
      />
    </Field>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          resetForm()
          setDeleteOpen(false)
        }
      }}
    >
      {trigger ?? (
        <DialogTrigger asChild>
          <Button size="sm" variant="secondary">
            <Sparkles aria-hidden="true" />
            Beneficios
          </Button>
        </DialogTrigger>
      )}

      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Beneficios de {tier.name}</DialogTitle>
          <DialogDescription>
            Qué desbloquea este nivel: ítems gratis que se repiten, descuentos, beneficios o marcas
            aliadas.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-6">
          {/* Lista de beneficios actuales — arrastrable */}
          <section aria-labelledby={`tier-benefits-${tier.id}-title`} className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id={`tier-benefits-${tier.id}-title`} className="type-label text-foreground">
                Beneficios cargados
              </h3>
              {order.length > 1 ? (
                <p className="type-caption text-muted-foreground">
                  Arrastrá desde el asa para cambiar el orden en que los ve el socio.
                </p>
              ) : null}
            </div>
            {order.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center type-small text-muted-foreground">
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
                  <ul className={ROW_LIST_CLASSES}>
                    {order.map((b) => (
                      <BenefitRow
                        key={b.id}
                        benefit={b}
                        pending={pending}
                        onEdit={() => startEdit(b)}
                        onToggle={() => onToggle(b)}
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
          </section>

          {/* Form: agregar / editar beneficio */}
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            aria-labelledby={`tier-benefit-form-${tier.id}`}
            className="grid gap-4 border-t border-border pt-6"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 id={`tier-benefit-form-${tier.id}`} className="type-subtitle text-foreground">
                {isEditing ? 'Editar beneficio' : 'Agregar beneficio'}
              </h3>
              {isEditing ? (
                <Button type="button" size="sm" variant="ghost" onClick={resetForm}>
                  <X aria-hidden="true" />
                  Cancelar la edición
                </Button>
              ) : null}
            </div>

            <Field
              label="Tipo de beneficio"
              hint={
                isEditing ? 'El tipo no se cambia: para otro tipo, cargá uno nuevo.' : undefined
              }
            >
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
            </Field>

            {/* Campos según el tipo */}
            {form.kind === 'recurring_reward' ? (
              <>
                <FieldRow>
                  <Field label="Recompensa gratis" error={errors.rewardId}>
                    {rewards.length === 0 ? (
                      <Callout tone="warning">
                        No hay recompensas activas. Creá una en «Cómo canjean sus puntos».
                      </Callout>
                    ) : (
                      <Combobox
                        options={rewards.map((r) => ({ value: r.id, label: r.name }))}
                        value={form.rewardId || null}
                        onValueChange={(v) => set('rewardId', typeof v === 'string' ? v : '')}
                        placeholder="Elegí la recompensa…"
                        searchPlaceholder="Buscar recompensa…"
                      />
                    )}
                  </Field>
                  <Field label="Frecuencia">
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
                  </Field>
                </FieldRow>
                <FieldRow>
                  <Field label="Cantidad">
                    <NumberField
                      min={1}
                      max={20}
                      value={form.quantity}
                      onValueChange={(n) => set('quantity', n)}
                    />
                  </Field>
                  {nameField('Ej: 1 café gratis')}
                </FieldRow>
              </>
            ) : null}

            {form.kind === 'discount' ? (
              <>
                <FieldRow>
                  <Field label="Descuento" error={errors.discountPct}>
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
                  <Field label="Aplica a" optional>
                    <Input
                      value={form.discountScope}
                      onChange={(e) => set('discountScope', e.target.value)}
                      maxLength={60}
                      placeholder="Ej: Desayunos L-V"
                    />
                  </Field>
                </FieldRow>
                {nameField('Ej: 10% off en desayunos')}
              </>
            ) : null}

            {form.kind === 'perk' ? (
              <>
                {nameField('Ej: Acceso a la barra VIP')}
                <Field label="Descripción" optional>
                  <Textarea
                    value={form.description}
                    onChange={(e) => set('description', e.target.value)}
                    maxLength={200}
                    showCount
                    rows={2}
                    placeholder="El detalle de la ventaja."
                  />
                </Field>
              </>
            ) : null}

            {form.kind === 'partner' ? (
              <>
                <Field
                  label="Marca aliada"
                  error={errors.partnerId}
                  hint="El descuento de cada nivel se carga en la ficha de la marca, en Aliados."
                >
                  {partners.length === 0 ? (
                    <Callout tone="warning">No hay marcas aliadas. Creá una en Aliados.</Callout>
                  ) : (
                    <Combobox
                      options={partners.map((p) => ({ value: p.id, label: p.name }))}
                      value={form.partnerId || null}
                      onValueChange={(v) => set('partnerId', typeof v === 'string' ? v : '')}
                      placeholder="Elegí la marca…"
                      searchPlaceholder="Buscar marca…"
                    />
                  )}
                </Field>
                {nameField('Ej: 15% off en la librería aliada')}
              </>
            ) : null}

            {/* Cómo se ve: foto (billetera) + ícono (listados). Conviven a propósito. */}
            <MenuImageUploader
              tenantId={tenantId}
              value={form.imageUrl}
              onChange={(url) => set('imageUrl', url)}
              label="Foto del beneficio (opcional)"
            />
            <Field
              label="Ícono"
              optional
              hint="La foto se ve en la billetera del socio; el ícono, en los listados y chips."
            >
              <IconPicker value={form.icon || null} onChange={(name) => set('icon', name ?? '')} />
            </Field>

            <Button type="submit" loading={saving} loadingText="Guardando…" className="w-full">
              {isEditing ? null : <Plus aria-hidden="true" />}
              {isEditing ? 'Guardar cambios' : 'Agregar beneficio'}
            </Button>
          </form>
        </DialogBody>
      </DialogContent>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title={`¿Borrar «${toDelete?.label ?? ''}»?`}
        description="El beneficio deja de mostrarse a los clientes de este nivel. No se puede deshacer."
        confirmLabel="Borrar beneficio"
        pendingLabel="Borrando…"
        onConfirm={async () => {
          if (!toDelete) return
          const target = toDelete
          const result = await deleteTierBenefit(tenantSlug, target.id)
          if (!result.ok) return { ok: false, error: result.message }
          await pruneImage(target.image_url, null)
          toast.success('Beneficio borrado.')
          if (form.editingId === target.id) resetForm()
        }}
      />
    </Dialog>
  )
}
