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
  Check,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Stamp,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  createPunchCard,
  deletePunchCard,
  type PunchCardActionState,
  reorderPunchCards,
  togglePunchCard,
  updatePunchCard,
} from '@/lib/punch-cards/actions'
import type { PunchCardTemplateRow } from '@/lib/punch-cards/queries'
import { PUNCH_TRIGGER_TYPES, type PunchTriggerType } from '@/lib/punch-cards/schemas'
import { cn } from '@/lib/utils'
import { MenuImageUploader } from '../../../menu/_components/image-uploader'

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
    hint: 'El cajero aprieta "+1" al cobrar, desde Acreditar. No depende de nada más.',
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

const DAY_LABELS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'L' },
  { value: 2, label: 'M' },
  { value: 3, label: 'M' },
  { value: 4, label: 'J' },
  { value: 5, label: 'V' },
  { value: 6, label: 'S' },
  { value: 7, label: 'D' },
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

function numberFromConfig(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
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
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Así la ve el socio
      </p>
      <div className="card-hairline overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-3 p-3">
          <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary/60">
            {imageUrl ? (
              <StorageImage src={imageUrl} alt="" sizes="48px" />
            ) : (
              <Stamp className="size-5 text-muted-foreground/70" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name.trim() || 'Tu tarjeta'}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {remaining === 0
                ? `¡Completa! Ganaste ${prize}`
                : `Te ${remaining === 1 ? 'falta' : 'faltan'} ${remaining} para ${prize}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 border-t border-border/60 bg-background/40 px-3 py-3">
          {dots.map((dot) => (
            <span
              key={`slot-${dot.slot}`}
              className={cn(
                'grid size-7 place-items-center rounded-full border text-[10px]',
                dot.done
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-dashed border-border text-muted-foreground/50',
              )}
            >
              {dot.done ? <Check className="size-3.5" aria-hidden /> : dot.slot}
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
  imageUrl,
  onImageChange,
}: FormFieldsProps) {
  const [triggerType, setTriggerType] = useState<PunchTriggerType>(
    template?.trigger_type ?? 'manual',
  )
  const [name, setName] = useState(template?.name ?? '')
  const [threshold, setThreshold] = useState(String(template?.threshold ?? 6))
  const [rewardId, setRewardId] = useState(template?.reward_id ?? '')
  const [rewardLabel, setRewardLabel] = useState(template?.reward_label ?? '')

  const cfg = template?.config
  const [hoursFrom, setHoursFrom] = useState(() => timeFromConfig(cfg?.hours_from, '12:00'))
  const [hoursTo, setHoursTo] = useState(() => timeFromConfig(cfg?.hours_to, '15:30'))
  const [days, setDays] = useState<number[]>(() => daysFromConfig(cfg?.days_of_week))
  const [maxPerDay, setMaxPerDay] = useState(() => numberFromConfig(cfg?.max_per_day))
  const [periodDays, setPeriodDays] = useState(() => numberFromConfig(cfg?.period_days))

  // `max_per_day` aplica a cualquier disparador (lo lee add_punch_stamp); el
  // horario y los días sólo tienen sentido para visit_window.
  const configJson = useMemo(() => {
    const base: Record<string, unknown> = {}
    if (maxPerDay.trim() !== '') base.max_per_day = Number(maxPerDay)
    if (triggerType === 'visit_window') {
      base.hours_from = hoursFrom
      base.hours_to = hoursTo
      base.days_of_week = days
      if (periodDays.trim() !== '') base.period_days = Number(periodDays)
    }
    return JSON.stringify(base)
  }, [maxPerDay, triggerType, hoursFrom, hoursTo, days, periodDays])

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))

  const triggerOptions =
    triggerType === 'item' ? items : triggerType === 'category' ? categories : tags
  const thresholdNum = Math.min(100, Math.max(2, Number(threshold) || 2))
  const rewardName = rewards.find((r) => r.id === rewardId)?.name ?? null

  return (
    <>
      <input type="hidden" name="config" value={configJson} />

      <div className="grid gap-1.5">
        <Label htmlFor="pc-name">Nombre de la tarjeta</Label>
        <Input
          id="pc-name"
          name="name"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tarjeta del café"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="pc-description">Descripción (opcional)</Label>
        <Textarea
          id="pc-description"
          name="description"
          maxLength={400}
          rows={2}
          className="resize-none"
          defaultValue={template?.description ?? undefined}
          placeholder="Cómo funciona, condiciones, vigencia."
        />
      </div>

      {/* Foto que ve el socio en su tarjeta. Viaja por el input hidden. */}
      <input type="hidden" name="image_url" value={imageUrl ?? ''} />
      <MenuImageUploader
        tenantId={tenantId}
        value={imageUrl}
        onChange={onImageChange}
        label="Foto de la tarjeta (opcional)"
      />

      <div className="grid gap-1.5">
        <Label htmlFor="pc-stamp-icon">Ícono del sello (opcional)</Label>
        <Input
          id="pc-stamp-icon"
          name="stamp_icon"
          maxLength={40}
          defaultValue={template?.stamp_icon ?? ''}
          placeholder="Nombre de un ícono de Lucide (ej: Coffee)"
        />
        <p className="text-[11px] text-muted-foreground">
          Es el dibujo de cada sello. Si lo dejás vacío usamos un sello genérico.
        </p>
      </div>

      {/* ── La frase que arma el dueño: sellos → premio ── */}
      <div className="grid gap-3 rounded-xl border border-border/60 bg-background/40 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="pc-threshold">Sellos para completarla</Label>
            <Input
              id="pc-threshold"
              name="threshold"
              type="number"
              min={2}
              max={100}
              required
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="tabular-nums"
            />
            <p className="text-[11px] text-muted-foreground text-pretty">
              Si querés "6 cafés y el 7mo gratis", poné <strong>6</strong>: el premio es el 7mo.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pc-reward">Qué se gana</Label>
            <Select name="reward_id" required value={rewardId} onValueChange={setRewardId}>
              <SelectTrigger id="pc-reward">
                <SelectValue placeholder="Elegí la recompensa…" />
              </SelectTrigger>
              <SelectContent>
                {rewards.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="pc-reward-label">Cómo se lo contás al socio (opcional)</Label>
          <Input
            id="pc-reward-label"
            name="reward_label"
            maxLength={120}
            value={rewardLabel}
            onChange={(e) => setRewardLabel(e.target.value)}
            placeholder="El 7mo café va de regalo"
          />
        </div>

        <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-foreground text-pretty">
          Junta <strong className="tabular-nums">{thresholdNum}</strong>{' '}
          {thresholdNum === 1 ? 'sello' : 'sellos'} → gana:{' '}
          <strong>{rewardLabel.trim() || rewardName || '(elegí la recompensa)'}</strong>
        </p>
      </div>

      {/* ── Disparador ── */}
      <div className="grid gap-1.5">
        <Label htmlFor="pc-trigger">Cómo se sella</Label>
        <Select
          name="trigger_type"
          value={triggerType}
          onValueChange={(v) => {
            if (isTriggerType(v)) setTriggerType(v)
          }}
        >
          <SelectTrigger id="pc-trigger">
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
        <p className="text-[11px] text-muted-foreground text-pretty">
          {TRIGGER_META[triggerType].hint}
        </p>
      </div>

      {needsRef(triggerType) ? (
        <div className="grid gap-1.5">
          <Label htmlFor="pc-trigger-ref">Cuál</Label>
          {triggerOptions.length === 0 ? (
            <p className="rounded-md border border-warning/40 bg-warning/15 px-2.5 py-2 text-[11px] text-warning">
              No hay opciones cargadas para este disparador. Elegí "A mano" o cargá la carta
              primero.
            </p>
          ) : (
            // key: al cambiar el tipo se remonta el Select para descartar una
            // selección del tipo anterior (id de otro catálogo).
            <Select
              key={triggerType}
              name="trigger_ref_id"
              required
              defaultValue={
                template && template.trigger_type === triggerType
                  ? (template.trigger_ref_id ?? undefined)
                  : undefined
              }
            >
              <SelectTrigger id="pc-trigger-ref">
                <SelectValue placeholder="Elegí…" />
              </SelectTrigger>
              <SelectContent>
                {triggerOptions.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ) : null}

      {triggerType === 'visit_window' ? (
        <div className="grid gap-3 rounded-xl border border-border/60 bg-background/40 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pc-hours-from">Desde</Label>
              <Input
                id="pc-hours-from"
                type="time"
                value={hoursFrom}
                onChange={(e) => setHoursFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pc-hours-to">Hasta</Label>
              <Input
                id="pc-hours-to"
                type="time"
                value={hoursTo}
                onChange={(e) => setHoursTo(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Días válidos</Label>
            <div className="flex flex-wrap gap-1">
              {DAY_LABELS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  aria-pressed={days.includes(d.value)}
                  className={cn(
                    'size-11 rounded-md text-xs font-medium transition-colors',
                    days.includes(d.value)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pc-period-days">Ventana en días (opcional)</Label>
            <Input
              id="pc-period-days"
              type="number"
              min={1}
              max={365}
              value={periodDays}
              onChange={(e) => setPeriodDays(e.target.value)}
              className="tabular-nums"
              placeholder="30"
            />
          </div>
        </div>
      ) : null}

      {/* ── Límites ── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="pc-max-per-day">Tope diario (opcional)</Label>
          <Input
            id="pc-max-per-day"
            type="number"
            min={1}
            max={20}
            value={maxPerDay}
            onChange={(e) => setMaxPerDay(e.target.value)}
            className="tabular-nums"
            placeholder="sin tope"
          />
          <p className="text-[11px] text-muted-foreground">
            {maxPerDay.trim() === ''
              ? 'Sin tope: puede juntar todos los sellos que quiera en un día.'
              : `Máximo ${maxPerDay} ${Number(maxPerDay) === 1 ? 'sello' : 'sellos'} por día.`}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pc-expires">Vence en días (opcional)</Label>
          <Input
            id="pc-expires"
            name="expires_after_days"
            type="number"
            min={1}
            max={365}
            defaultValue={template?.expires_after_days ?? ''}
            className="tabular-nums"
            placeholder="sin vencimiento"
          />
          <p className="text-[11px] text-muted-foreground">
            Se cuenta desde el primer sello de cada socio.
          </p>
        </div>
      </div>

      <WalletPreview
        name={name}
        threshold={thresholdNum}
        rewardLabel={rewardLabel}
        rewardName={rewardName}
        imageUrl={imageUrl}
      />
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
  onClose,
}: {
  template: PunchCardTemplateRow
  tenantSlug: string
  tenantId: string
  items: NamedOption[]
  categories: NamedOption[]
  tags: NamedOption[]
  rewards: NamedOption[]
  onClose: () => void
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(template.image_url)
  const [active, setActive] = useState(template.active)
  const [pending, start] = useTransition()

  const handleSubmit = (fd: FormData) => {
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
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Editar punch card</DialogTitle>
          <DialogDescription>Todo lo que ve el socio y cómo se llena la tarjeta.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <input type="hidden" name="id" value={template.id} />
          <PunchCardFormFields
            template={template}
            tenantId={tenantId}
            items={items}
            categories={categories}
            tags={tags}
            rewards={rewards}
            imageUrl={imageUrl}
            onImageChange={setImageUrl}
          />
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
            <div className="grid gap-0.5">
              <Label htmlFor="pc-active" className="text-xs font-medium">
                Tarjeta activa
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Si la apagás, deja de aparecer y nadie suma sellos nuevos.
              </p>
            </div>
            <Switch id="pc-active" checked={active} onCheckedChange={setActive} />
          </div>
          <input type="hidden" name="active" value={active ? 'on' : 'off'} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
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
      </DialogContent>
    </Dialog>
  )
}

// ── Fila arrastrable de la lista ────────────────────────────
function TemplateRow({
  template,
  pending,
  onEdit,
  onToggle,
  onDelete,
}: {
  template: PunchCardTemplateRow
  pending: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: template.id,
  })

  const prize = template.reward_label?.trim() || template.reward_name || 'el premio'

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
        !template.active && 'opacity-60',
        isDragging && 'relative z-10 shadow-md',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`Reordenar ${template.name}`}
        // touch-none: sin esto el gesto de arrastre en tablet scrollea la página.
        className="size-11 shrink-0 cursor-grab touch-none rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="mx-auto size-4" />
      </button>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Editar foto de ${template.name}`}
        title="Foto de la tarjeta"
        className="group/foto relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary/50 transition-shadow hover:ring-2 hover:ring-primary/50"
      >
        {template.image_url ? (
          <StorageImage src={template.image_url} alt="" sizes="48px" />
        ) : (
          <Stamp className="size-5 text-muted-foreground/70" aria-hidden />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover/foto:opacity-100">
          <Camera className="size-4 text-white" aria-hidden />
        </span>
      </button>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{template.name}</span>
          {template.active ? null : <Badge variant="warning">Apagada</Badge>}
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          <span className="tabular-nums">{template.threshold}</span> sellos → {prize} ·{' '}
          {TRIGGER_META[template.trigger_type].label.toLowerCase()}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="size-11 text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          aria-label={`Editar ${template.name}`}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label={`Borrar ${template.name}`}
        >
          <Trash2 className="size-4" />
        </Button>
        <span className="flex size-11 items-center justify-center">
          <Switch
            checked={template.active}
            onCheckedChange={onToggle}
            disabled={pending}
            aria-label={template.active ? `Apagar ${template.name}` : `Prender ${template.name}`}
          />
        </span>
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
}: {
  tenantSlug: string
  tenantId: string
  initialTemplates: PunchCardTemplateRow[]
  items: NamedOption[]
  categories: NamedOption[]
  tags: NamedOption[]
  rewards: NamedOption[]
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<PunchCardTemplateRow | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PunchCardTemplateRow | null>(null)
  const [createImageUrl, setCreateImageUrl] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [state, action, formPending] = useActionState(
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

  const onToggle = (t: PunchCardTemplateRow) => {
    startTransition(async () => {
      const r = await togglePunchCard(tenantSlug, t.id, !t.active)
      if (!r.ok) toast.error(r.message)
    })
  }

  const onConfirmDelete = () => {
    if (!pendingDelete) return
    const target = pendingDelete
    startTransition(async () => {
      const r = await deletePunchCard(tenantSlug, target.id)
      if (r.ok) toast.success(`Tarjeta "${target.name}" eliminada.`)
      else toast.error(r.message)
      setPendingDelete(null)
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
    startTransition(async () => {
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
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="font-display text-base font-semibold">Tus punch cards</h2>
          <p className="max-w-prose text-xs text-muted-foreground text-pretty">
            "Junta N sellos y ganás algo". Por defecto las sella el cajero desde Acreditar; el orden
            de esta lista es el que ve el socio en su billetera.
          </p>
        </div>
        <Dialog
          open={showCreate}
          onOpenChange={(open) => {
            setShowCreate(open)
            if (!open) setCreateImageUrl(null)
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" className="h-10">
              <Plus className="mr-1.5 size-4" />
              Nueva punch card
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-serif">Nueva punch card</DialogTitle>
              <DialogDescription>
                Configurala completa: foto, sellos, premio y cómo se sella.
              </DialogDescription>
            </DialogHeader>
            <form action={action} className="space-y-4">
              <PunchCardFormFields
                tenantId={tenantId}
                items={items}
                categories={categories}
                tags={tags}
                rewards={rewards}
                imageUrl={createImageUrl}
                onImageChange={setCreateImageUrl}
              />
              {!state.ok && state.message ? (
                <p className="inline-flex items-start gap-1.5 text-xs text-destructive">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                  {state.message}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowCreate(false)}
                  disabled={formPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={formPending} className="min-w-[140px]">
                  {formPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Creando…
                    </>
                  ) : (
                    'Crear tarjeta'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {order.length === 0 ? (
        <EmptyState
          icon={Stamp}
          title="Todavía no hay punch cards"
          description='Creá la primera: "Junta 6 cafés y el 7mo va de regalo". El cajero la sella con un toque al cobrar.'
          action={
            <Button onClick={() => setShowCreate(true)} className="h-11 gap-1.5">
              <Plus className="size-4" />
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
            <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border">
              {order.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  pending={pending}
                  onEdit={() => setEditing(t)}
                  onToggle={() => onToggle(t)}
                  onDelete={() => setPendingDelete(t)}
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
          onClose={() => setEditing(null)}
        />
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Si ya hay socios juntando sellos no vas a poder borrarla: apagala con el switch para
              que deje de aparecer sin perder el historial.
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
