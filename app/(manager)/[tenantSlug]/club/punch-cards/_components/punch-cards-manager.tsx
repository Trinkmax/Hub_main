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
import { Check, Lock, Pencil, Plus, Stamp, Trash2 } from 'lucide-react'
import { startTransition, useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { MenuImageUploader } from '@/components/media/image-uploader'
import { PhotoButton } from '@/components/media/photo-button'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldRow, FormError, FormSection } from '@/components/ui/field'
import { ChipGroup, FilterChip } from '@/components/ui/filter-chip'
import { IconPicker } from '@/components/ui/icon-picker'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import { Section } from '@/components/ui/section'
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
import { TimeField } from '@/components/ui/time-field'
import { isStorageUrl } from '@/lib/menu/media-urls'
import { deleteMenuImageByUrl } from '@/lib/menu/upload-image'
import { type LoyaltyTier, sortedActiveTiers } from '@/lib/points/tiers'
import {
  createPunchCard,
  deletePunchCard,
  type PunchCardActionState,
  reorderPunchCards,
  togglePunchCard,
  updatePunchCard,
} from '@/lib/punch-cards/actions'
import type { PunchCardTemplateRow } from '@/lib/punch-cards/queries'
import { PUNCH_TRIGGER_TYPES, type PunchTriggerType } from '@/lib/punch-cards/schemas'
import { formatRequiredTiers } from '@/lib/punch-cards/tier-gate'
import { cn } from '@/lib/utils'
import { PUNCH_STATUS } from '../../_components/club-status'
import {
  DRAGGING_ROW_CLASSES,
  DragHandle,
  ROW_LIST_CLASSES,
  sortableStyle,
  TierToggleChips,
} from '../../_components/club-ui'

const initial: PunchCardActionState = { ok: false, message: '' }

type NamedOption = { id: string; name: string }

/**
 * Cada disparador explicado en una línea. `manual` es el default: el resto
 * depende de que esté prendido el módulo de mesas (el sello lo dispara el
 * consumo, no la caja).
 */
const TRIGGER_META: Record<PunchTriggerType, { label: string; hint: string }> = {
  manual: {
    label: 'A mano (el cajero sella)',
    hint: 'El cajero aprieta «+1» al cobrar, desde Acreditar. No depende de nada más.',
  },
  item: {
    label: 'Al consumir un ítem',
    hint: 'Se sella solo cuando el cliente consume ese ítem. Requiere el módulo de mesas prendido.',
  },
  category: {
    label: 'Al consumir una categoría',
    hint: 'Se sella solo con cualquier ítem de esa categoría. Requiere el módulo de mesas prendido.',
  },
  tag: {
    label: 'Al consumir una etiqueta',
    hint: 'Se sella solo con cualquier ítem que tenga esa etiqueta. Requiere el módulo de mesas prendido.',
  },
  visit_window: {
    label: 'Por visita en un horario',
    hint: 'Un sello por visita dentro de la franja horaria y los días que elijas (ej: almuerzo L-V).',
  },
}

const DAY_LABELS: Array<{ value: number; label: string; name: string }> = [
  { value: 1, label: 'L', name: 'Lunes' },
  { value: 2, label: 'M', name: 'Martes' },
  { value: 3, label: 'M', name: 'Miércoles' },
  { value: 4, label: 'J', name: 'Jueves' },
  { value: 5, label: 'V', name: 'Viernes' },
  { value: 6, label: 'S', name: 'Sábado' },
  { value: 7, label: 'D', name: 'Domingo' },
]

function timeFromConfig(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length >= 5 ? v.slice(0, 5) : fallback
}

function daysFromConfig(v: unknown): number[] {
  if (!Array.isArray(v)) return [1, 2, 3, 4, 5]
  const days = v
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort()
  return days.length > 0 ? days : [1, 2, 3, 4, 5]
}

function numberFromConfig(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function isTriggerType(v: string): v is PunchTriggerType {
  return (PUNCH_TRIGGER_TYPES as readonly string[]).includes(v)
}

/** Triggers que apuntan a algo del catálogo. */
function needsRef(t: PunchTriggerType): boolean {
  return t === 'item' || t === 'category' || t === 'tag'
}

// ── Preview en vivo de la tarjeta del socio ─────────────────

/**
 * Cómo se ve la tarjeta en la billetera. El dueño no debería tener que abrir el
 * simulador para entender qué está configurando: los puntitos y el "te falta 1"
 * se mueven mientras escribe.
 */
function WalletPreview({
  name,
  threshold,
  rewardLabel,
  rewardName,
  imageUrl,
}: {
  name: string
  threshold: number
  rewardLabel: string
  rewardName: string | null
  imageUrl: string | null
}) {
  // Un ejemplo a mitad de camino: se entiende el "lleno" y el "vacío" de un vistazo.
  const filled = Math.max(1, Math.floor(threshold / 2))
  const remaining = Math.max(0, threshold - filled)
  const prize = rewardLabel.trim() || rewardName || 'tu premio'
  // Los sellos son posicionales (nunca se reordenan): la posición ES la identidad.
  const dots = Array.from({ length: threshold }, (_, i) => ({
    slot: i + 1,
    done: i < filled,
  }))

  return (
    <div className="grid gap-2">
      <p className="type-label text-foreground">Así la ve el socio</p>
      <div className="overflow-clip rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 p-3">
          <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary">
            {imageUrl ? (
              <StorageImage src={imageUrl} alt="" sizes="48px" />
            ) : (
              <Stamp className="size-5 text-subtle-foreground" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate type-body font-medium">{name.trim() || 'Tu tarjeta'}</p>
            <p className="truncate type-caption text-muted-foreground">
              {remaining === 0
                ? `¡Completa! Ganaste ${prize}`
                : `Te ${remaining === 1 ? 'falta' : 'faltan'} ${remaining} para ${prize}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 border-t border-border bg-muted px-3 py-3">
          {dots.map((dot) => (
            <span
              key={`slot-${dot.slot}`}
              className={cn(
                'grid size-7 place-items-center rounded-full border type-caption type-amount',
                dot.done
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-dashed border-border-strong text-subtle-foreground',
              )}
            >
              {dot.done ? <Check className="size-3.5" aria-hidden="true" /> : dot.slot}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Campos del editor ───────────────────────────────────────

type FormFieldsProps = {
  template?: PunchCardTemplateRow
  tenantId: string
  items: NamedOption[]
  categories: NamedOption[]
  tags: NamedOption[]
  rewards: NamedOption[]
  tiers: LoyaltyTier[]
  imageUrl: string | null
  onImageChange: (url: string | null) => void
}

/**
 * Todo el editor de una punch card. El estado de los campos que arman `config`
 * vive acá y viaja al server como JSON en un input hidden; el resto son campos
 * no controlados con `defaultValue` (el form es la fuente de verdad).
 */
function PunchCardFormFields({
  template,
  tenantId,
  items,
  categories,
  tags,
  rewards,
  tiers,
  imageUrl,
  onImageChange,
}: FormFieldsProps) {
  const [triggerType, setTriggerType] = useState<PunchTriggerType>(
    template?.trigger_type ?? 'manual',
  )
  const [tierIds, setTierIds] = useState<string[]>(template?.tier_ids ?? [])
  const [showWhenLocked, setShowWhenLocked] = useState(template?.show_when_locked !== false)
  const [name, setName] = useState(template?.name ?? '')
  const [threshold, setThreshold] = useState<number | null>(template?.threshold ?? 6)
  const [rewardId, setRewardId] = useState(template?.reward_id ?? '')
  const [rewardLabel, setRewardLabel] = useState(template?.reward_label ?? '')
  const [stampIcon, setStampIcon] = useState<string | null>(template?.stamp_icon ?? null)

  const cfg = template?.config
  const [hoursFrom, setHoursFrom] = useState(() => timeFromConfig(cfg?.hours_from, '12:00'))
  const [hoursTo, setHoursTo] = useState(() => timeFromConfig(cfg?.hours_to, '15:30'))
  const [days, setDays] = useState<number[]>(() => daysFromConfig(cfg?.days_of_week))
  const [maxPerDay, setMaxPerDay] = useState<number | null>(() =>
    numberFromConfig(cfg?.max_per_day),
  )
  const [periodDays, setPeriodDays] = useState<number | null>(() =>
    numberFromConfig(cfg?.period_days),
  )

  // `max_per_day` aplica a cualquier disparador (lo lee add_punch_stamp); el
  // horario y los días sólo tienen sentido para visit_window.
  const configJson = useMemo(() => {
    const base: Record<string, unknown> = {}
    if (maxPerDay !== null) base.max_per_day = maxPerDay
    if (triggerType === 'visit_window') {
      base.hours_from = hoursFrom
      base.hours_to = hoursTo
      base.days_of_week = days
      if (periodDays !== null) base.period_days = periodDays
    }
    return JSON.stringify(base)
  }, [maxPerDay, triggerType, hoursFrom, hoursTo, days, periodDays])

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))

  const triggerOptions =
    triggerType === 'item' ? items : triggerType === 'category' ? categories : tags
  const thresholdNum = Math.min(100, Math.max(2, threshold ?? 2))
  const rewardName = rewards.find((r) => r.id === rewardId)?.name ?? null

  const ladder = sortedActiveTiers(tiers)
  const toggleTier = (id: string) =>
    setTierIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  const chosenTierNames = ladder.filter((t) => tierIds.includes(t.id)).map((t) => t.name)

  return (
    <>
      <input type="hidden" name="config" value={configJson} />

      <FormSection>
        <Field label="Nombre de la tarjeta" name="name" required>
          <Input
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tarjeta del café"
          />
        </Field>

        <Field label="Descripción" name="description" optional>
          <Textarea
            maxLength={400}
            showCount
            rows={2}
            defaultValue={template?.description ?? undefined}
            placeholder="Cómo funciona, condiciones, vigencia."
          />
        </Field>

        {/* Foto que ve el socio en su tarjeta. Viaja por el input hidden. */}
        <input type="hidden" name="image_url" value={imageUrl ?? ''} />
        <MenuImageUploader
          tenantId={tenantId}
          value={imageUrl}
          onChange={onImageChange}
          label="Foto de la tarjeta (opcional)"
        />

        <Field
          label="Ícono del sello"
          optional
          hint="Es el dibujo de cada sello en la billetera. Si no elegís ninguno usamos un sello genérico."
        >
          <IconPicker value={stampIcon} onChange={setStampIcon} name="stamp_icon" />
        </Field>
      </FormSection>

      {/* ── La frase que arma el dueño: sellos → premio ── */}
      <FormSection title="Sellos y premio">
        <FieldRow>
          <Field
            label="Sellos para completarla"
            name="threshold"
            required
            hint={
              <>
                Para «6 cafés y el 7mo gratis», poné <strong>6</strong>: el premio es el 7mo.
              </>
            }
          >
            <NumberField min={2} max={100} value={threshold} onValueChange={setThreshold} />
          </Field>
          <Field label="Qué se gana" name="reward_id" required>
            <Combobox
              options={rewards.map((r) => ({ value: r.id, label: r.name }))}
              value={rewardId || null}
              onValueChange={(v) => setRewardId(typeof v === 'string' ? v : '')}
              placeholder="Elegí la recompensa…"
              searchPlaceholder="Buscar recompensa…"
            />
          </Field>
        </FieldRow>

        <Field label="Cómo se lo contás al socio" name="reward_label" optional>
          <Input
            maxLength={120}
            value={rewardLabel}
            onChange={(e) => setRewardLabel(e.target.value)}
            placeholder="El 7mo café va de regalo"
          />
        </Field>

        <p className="rounded-lg bg-secondary px-3 py-2 type-small text-pretty text-foreground">
          Junta <strong className="type-amount">{thresholdNum}</strong>{' '}
          {thresholdNum === 1 ? 'sello' : 'sellos'} → gana:{' '}
          <strong>{rewardLabel.trim() || rewardName || '(elegí la recompensa)'}</strong>
        </p>
      </FormSection>

      {/* ── Disparador ── */}
      <FormSection title="Cómo se sella">
        <Field label="Disparador" name="trigger_type" hint={TRIGGER_META[triggerType].hint}>
          <Select
            value={triggerType}
            onValueChange={(v) => {
              if (isTriggerType(v)) setTriggerType(v)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PUNCH_TRIGGER_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TRIGGER_META[t].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {needsRef(triggerType) ? (
          triggerOptions.length === 0 ? (
            <Callout tone="warning">
              No hay opciones cargadas para este disparador. Elegí «A mano» o cargá la carta
              primero.
            </Callout>
          ) : (
            <Field label="Cuál" name="trigger_ref_id" required>
              {/* key: al cambiar el tipo se remonta el Select para descartar una
                  selección del tipo anterior (id de otro catálogo). */}
              <Combobox
                key={triggerType}
                options={triggerOptions.map((opt) => ({ value: opt.id, label: opt.name }))}
                defaultValue={
                  template && template.trigger_type === triggerType
                    ? (template.trigger_ref_id ?? null)
                    : null
                }
                searchPlaceholder="Buscar…"
              />
            </Field>
          )
        ) : null}

        {triggerType === 'visit_window' ? (
          <>
            <FieldRow>
              <Field label="Desde">
                <TimeField value={hoursFrom} onValueChange={(t) => setHoursFrom(t ?? '')} />
              </Field>
              <Field label="Hasta">
                <TimeField value={hoursTo} onValueChange={(t) => setHoursTo(t ?? '')} />
              </Field>
            </FieldRow>
            <div className="grid gap-2">
              <p className="type-label text-foreground">Días válidos</p>
              <ChipGroup aria-label="Días válidos">
                {DAY_LABELS.map((d) => (
                  <FilterChip
                    key={d.value}
                    size="md"
                    pressed={days.includes(d.value)}
                    onPressedChange={() => toggleDay(d.value)}
                    aria-label={d.name}
                    className="min-w-11"
                  >
                    {d.label}
                  </FilterChip>
                ))}
              </ChipGroup>
            </div>
            <Field label="Ventana en días" optional>
              <NumberField
                min={1}
                max={365}
                steppers={false}
                placeholder="30"
                value={periodDays}
                onValueChange={setPeriodDays}
              />
            </Field>
          </>
        ) : null}
      </FormSection>

      {/* ── Límites ── */}
      <FormSection title="Límites">
        <FieldRow>
          <Field
            label="Tope diario"
            optional
            hint={
              maxPerDay === null
                ? 'Sin tope: puede juntar todos los sellos que quiera en un día.'
                : `Máximo ${maxPerDay} ${maxPerDay === 1 ? 'sello' : 'sellos'} por día.`
            }
          >
            <NumberField
              min={1}
              max={20}
              placeholder="sin tope"
              value={maxPerDay}
              onValueChange={setMaxPerDay}
            />
          </Field>
          <Field
            label="Vence en días"
            name="expires_after_days"
            optional
            hint="Se cuenta desde el primer sello de cada socio."
          >
            <NumberField
              min={1}
              max={365}
              steppers={false}
              placeholder="sin vencimiento"
              defaultValue={template?.expires_after_days ?? null}
            />
          </Field>
        </FieldRow>
      </FormSection>

      {/* ── Categorías habilitadas ─────────────────────────────
          Set arbitrario, no "de tal nivel para arriba": el dueño puede querer
          saltear un nivel. Vacío = para todos, que es como venían funcionando
          todas las tarjetas hasta ahora. */}
      <FormSection title="¿Quiénes la pueden sellar?">
        {tierIds.map((id) => (
          <input key={id} type="hidden" name="tier_ids" value={id} />
        ))}
        <input type="hidden" name="show_when_locked" value={showWhenLocked ? 'on' : 'off'} />

        {ladder.length === 0 ? (
          <p className="type-small text-muted-foreground">
            Todavía no hay niveles cargados: por ahora la sella cualquier socio. Creá los niveles en
            Puntos y niveles para hacerla exclusiva.
          </p>
        ) : (
          <>
            <TierToggleChips
              tiers={ladder}
              selected={tierIds}
              onToggle={toggleTier}
              aria-label="Niveles que la pueden sellar"
            />

            {tierIds.length === 0 ? (
              <p className="type-small text-muted-foreground">
                <strong className="font-medium text-foreground">Todos los socios.</strong> Elegí uno
                o más niveles para que sea exclusiva.
              </p>
            ) : (
              <p className="type-small text-muted-foreground">
                Exclusiva de{' '}
                <strong className="font-medium text-foreground">
                  {formatRequiredTiers(chosenTierNames)}
                </strong>
                . Al resto no se le puede sellar.
              </p>
            )}

            {tierIds.length > 0 ? (
              <Field
                label={showWhenLocked ? 'Se ve bloqueada' : 'No se ve'}
                layout="toggle"
                hint={
                  showWhenLocked
                    ? 'El que todavía no llegó la ve con candado y qué nivel necesita: le da un motivo para subir.'
                    : 'Es una sorpresa: aparece recién al llegar al nivel.'
                }
              >
                <Switch checked={showWhenLocked} onCheckedChange={setShowWhenLocked} />
              </Field>
            ) : null}
          </>
        )}
      </FormSection>

      <FormSection>
        <WalletPreview
          name={name}
          threshold={thresholdNum}
          rewardLabel={rewardLabel}
          rewardName={rewardName}
          imageUrl={imageUrl}
        />
      </FormSection>
    </>
  )
}

// ── Dialog de edición ───────────────────────────────────────
function PunchCardEditDialog({
  template,
  tenantSlug,
  tenantId,
  items,
  categories,
  tags,
  rewards,
  tiers,
  onClose,
}: {
  template: PunchCardTemplateRow
  tenantSlug: string
  tenantId: string
  items: NamedOption[]
  categories: NamedOption[]
  tags: NamedOption[]
  rewards: NamedOption[]
  tiers: LoyaltyTier[]
  onClose: () => void
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(template.image_url)
  const [active, setActive] = useState(template.active)
  const [pending, start] = useTransition()

  // onSubmit y no `action`: si el server rechaza, lo tipeado queda.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fd = new FormData(event.currentTarget)
    start(async () => {
      const r = await updatePunchCard(tenantSlug, initial, fd)
      if (r.ok) {
        // Si se reemplazó o quitó la foto, borrar la vieja del bucket para no
        // dejar archivos huérfanos. Best-effort: un fallo de borrado no debe
        // romper el guardado.
        if (
          template.image_url &&
          template.image_url !== imageUrl &&
          isStorageUrl(template.image_url)
        ) {
          try {
            await deleteMenuImageByUrl(template.image_url)
          } catch {
            // huérfano tolerable
          }
        }
        toast.success('Tarjeta actualizada.')
        onClose()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Editar punch card</DialogTitle>
          <DialogDescription>Todo lo que ve el socio y cómo se llena la tarjeta.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="flex flex-col">
            <input type="hidden" name="id" value={template.id} />
            <PunchCardFormFields
              template={template}
              tenantId={tenantId}
              items={items}
              categories={categories}
              tags={tags}
              rewards={rewards}
              tiers={tiers}
              imageUrl={imageUrl}
              onImageChange={setImageUrl}
            />
            <FormSection>
              <Field
                label="Tarjeta activa"
                layout="toggle"
                hint="Si la apagás, deja de aparecer y nadie suma sellos nuevos."
              >
                <Switch checked={active} onCheckedChange={setActive} />
              </Field>
              <input type="hidden" name="active" value={active ? 'on' : 'off'} />
            </FormSection>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} loadingText="Guardando…">
              Guardar cambios
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Fila arrastrable de la lista ────────────────────────────
function TemplateRow({
  template,
  tiers,
  pending,
  onEdit,
  onToggle,
  onDelete,
}: {
  template: PunchCardTemplateRow
  tiers: LoyaltyTier[]
  pending: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: template.id,
  })

  const prize = template.reward_label?.trim() || template.reward_name || 'el premio'
  const exclusiveOf = formatRequiredTiers(
    sortedActiveTiers(tiers)
      .filter((t) => template.tier_ids.includes(t.id))
      .map((t) => t.name),
  )

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
        label={`Reordenar ${template.name}`}
        attributes={attributes}
        listeners={listeners}
      />

      <PhotoButton
        src={template.image_url}
        sizes="48px"
        fallbackIcon={Stamp}
        label={`Cambiar la foto de ${template.name}`}
        onClick={onEdit}
      />

      <div className="ms-1 flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'truncate type-body font-medium',
              !template.active && 'text-muted-foreground',
            )}
          >
            {template.name}
          </span>
          {template.active ? null : <StatusBadge status="off" map={PUNCH_STATUS} />}
          {/* De un vistazo, cuál es exclusiva y de quién. */}
          {exclusiveOf ? <Badge icon={Lock}>{exclusiveOf}</Badge> : null}
        </div>
        <p className="truncate type-caption text-muted-foreground">
          <span className="type-amount">{template.threshold}</span> sellos → {prize} ·{' '}
          {TRIGGER_META[template.trigger_type].label.toLowerCase()}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Switch
          checked={template.active}
          onCheckedChange={onToggle}
          disabled={pending}
          aria-label={`${template.name} prendida`}
          className="mr-1"
        />
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onEdit}
          aria-label={`Editar ${template.name}`}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          size="icon-sm"
          variant="danger-ghost"
          onClick={onDelete}
          aria-label={`Borrar ${template.name}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}

/** Firma del CONTENIDO: si cambia, resincronizamos; si sólo cambió el orden, gana el drag. */
function contentSignature(list: readonly PunchCardTemplateRow[]): string {
  return list
    .map(
      (t) =>
        `${t.id}:${t.name}:${t.active ? 1 : 0}:${t.threshold}:${t.image_url ?? ''}:${t.reward_label ?? ''}:${t.trigger_type}`,
    )
    .sort()
    .join('|')
}

// ── Manager principal ───────────────────────────────────────
export function PunchCardsManager({
  tenantSlug,
  tenantId,
  initialTemplates,
  items,
  categories,
  tags,
  rewards,
  tiers,
  onGoToRewards,
}: {
  tenantSlug: string
  tenantId: string
  initialTemplates: PunchCardTemplateRow[]
  items: NamedOption[]
  categories: NamedOption[]
  tags: NamedOption[]
  rewards: NamedOption[]
  tiers: LoyaltyTier[]
  /** Lleva a la pestaña donde se crean las recompensas (estado vacío). */
  onGoToRewards?: () => void
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<PunchCardTemplateRow | null>(null)
  const [toDelete, setToDelete] = useState<PunchCardTemplateRow | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [createImageUrl, setCreateImageUrl] = useState<string | null>(null)
  const [pending, startRowTransition] = useTransition()
  const [state, dispatch, formPending] = useActionState(
    (prev: PunchCardActionState, fd: FormData) => createPunchCard(tenantSlug, prev, fd),
    initial,
  )

  // Orden optimista: el drag no espera al server. `initialTemplates` ya viene
  // ordenado por `sort` desde la query.
  const [order, setOrder] = useState<PunchCardTemplateRow[]>(initialTemplates)
  if (contentSignature(initialTemplates) !== contentSignature(order)) {
    setOrder(initialTemplates)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    if (state.ok) {
      setShowCreate(false)
      setCreateImageUrl(null)
      toast.success('Tarjeta creada.')
    } else if (state.message && state.message.length > 0) {
      toast.error(state.message)
    }
  }, [state])

  // onSubmit (no `action`): si el server rechaza, lo cargado en el diálogo queda.
  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fd = new FormData(event.currentTarget)
    startTransition(() => dispatch(fd))
  }

  const onToggle = (t: PunchCardTemplateRow) => {
    startRowTransition(async () => {
      const r = await togglePunchCard(tenantSlug, t.id, !t.active)
      if (!r.ok) toast.error(r.message)
    })
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = order.findIndex((t) => t.id === active.id)
    const newIndex = order.findIndex((t) => t.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const previous = order
    const next = arrayMove(order, oldIndex, newIndex)
    setOrder(next)
    startRowTransition(async () => {
      const r = await reorderPunchCards(
        tenantSlug,
        next.map((t) => t.id),
      )
      if (!r.ok) {
        toast.error(r.message)
        setOrder(previous)
      }
    })
  }

  // Sin recompensas no hay premio posible: cortamos con una salida clara.
  if (rewards.length === 0) {
    return (
      <EmptyState
        icon={Stamp}
        title="Primero cargá una recompensa"
        description="Una punch card entrega una recompensa al completarse. Creá la recompensa (ej: Café gratis) en Puntos y niveles y volvé acá."
        action={
          onGoToRewards ? <Button onClick={onGoToRewards}>Ir a Puntos y niveles</Button> : undefined
        }
      />
    )
  }

  return (
    <Section
      title="Tus punch cards"
      description="«Juntá N sellos y ganás algo». Por defecto las sella el cajero desde Acreditar; el orden de esta lista es el que ve el socio en su billetera."
      actions={
        <Dialog
          open={showCreate}
          onOpenChange={(open) => {
            setShowCreate(open)
            if (!open) setCreateImageUrl(null)
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus aria-hidden="true" />
              Nueva punch card
            </Button>
          </DialogTrigger>
          <DialogContent size="lg">
            <DialogHeader>
              <DialogTitle>Nueva punch card</DialogTitle>
              <DialogDescription>
                Configurala completa: foto, sellos, premio y cómo se sella.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="flex min-h-0 flex-1 flex-col gap-4">
              <DialogBody className="flex flex-col">
                <PunchCardFormFields
                  tenantId={tenantId}
                  items={items}
                  categories={categories}
                  tags={tags}
                  rewards={rewards}
                  tiers={tiers}
                  imageUrl={createImageUrl}
                  onImageChange={setCreateImageUrl}
                />
                <FormError
                  message={!state.ok && state.message ? state.message : null}
                  className="mt-4"
                />
              </DialogBody>
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowCreate(false)}
                  disabled={formPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" loading={formPending} loadingText="Creando…">
                  Crear tarjeta
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      {order.length === 0 ? (
        <EmptyState
          icon={Stamp}
          title="Todavía no hay punch cards"
          description="Creá la primera: «Juntá 6 cafés y el 7mo va de regalo». El cajero la sella con un toque al cobrar."
          action={
            <Button onClick={() => setShowCreate(true)}>
              <Plus aria-hidden="true" />
              Crear la primera
            </Button>
          }
        />
      ) : (
        <DndContext
          id="punch-cards-dnd"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={order.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <ul className={ROW_LIST_CLASSES} aria-label="Punch cards, en el orden de la billetera">
              {order.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  tiers={tiers}
                  pending={pending}
                  onEdit={() => setEditing(t)}
                  onToggle={() => onToggle(t)}
                  onDelete={() => {
                    setToDelete(t)
                    setDeleteOpen(true)
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {editing ? (
        <PunchCardEditDialog
          template={editing}
          tenantSlug={tenantSlug}
          tenantId={tenantId}
          items={items}
          categories={categories}
          tags={tags}
          rewards={rewards}
          tiers={tiers}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title={`¿Borrar «${toDelete?.name ?? ''}»?`}
        description="Si ya hay socios juntando sellos no se va a poder borrar: apagala con el interruptor para que deje de aparecer sin perder el historial."
        confirmLabel="Borrar tarjeta"
        pendingLabel="Borrando…"
        onConfirm={async () => {
          if (!toDelete) return
          const target = toDelete
          const r = await deletePunchCard(tenantSlug, target.id)
          if (!r.ok) return r
          toast.success(`Tarjeta «${target.name}» borrada.`)
        }}
      />
    </Section>
  )
}
