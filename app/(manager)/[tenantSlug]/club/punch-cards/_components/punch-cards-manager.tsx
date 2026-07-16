'use client'

import { Camera, Plus, Stamp, Trash2, UtensilsCrossed } from 'lucide-react'
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { StorageImage } from '@/components/media/storage-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
  updatePunchCard,
} from '@/lib/punch-cards/actions'
import type { PunchCardTemplateRow } from '@/lib/punch-cards/queries'
import { cn } from '@/lib/utils'
import { MenuImageUploader } from '../../../menu/_components/image-uploader'

const initial: PunchCardActionState = { ok: false, message: '' }

type TriggerType = 'item' | 'category' | 'tag' | 'visit_window'

type NamedOption = { id: string; name: string }

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

/**
 * Campos de config para trigger visit_window. Autocontenido: el estado vive
 * acá y viaja al server como JSON en el input hidden `config`.
 */
function VisitWindowConfigFields({ config }: { config?: Record<string, unknown> }) {
  const initialMaxPerDay = config?.max_per_day
  const initialPeriodDays = config?.period_days
  const [hoursFrom, setHoursFrom] = useState(() => timeFromConfig(config?.hours_from, '12:00'))
  const [hoursTo, setHoursTo] = useState(() => timeFromConfig(config?.hours_to, '15:30'))
  const [maxPerDay, setMaxPerDay] = useState(() =>
    typeof initialMaxPerDay === 'number' && initialMaxPerDay >= 1 ? initialMaxPerDay : 1,
  )
  const [periodDays, setPeriodDays] = useState<string>(() => {
    if (!config) return '30'
    return typeof initialPeriodDays === 'number' ? String(initialPeriodDays) : ''
  })
  const [days, setDays] = useState<number[]>(() => daysFromConfig(config?.days_of_week))

  const configJson = useMemo(
    () =>
      JSON.stringify({
        hours_from: hoursFrom,
        hours_to: hoursTo,
        days_of_week: days,
        max_per_day: maxPerDay,
        period_days: periodDays ? Number(periodDays) : null,
      }),
    [hoursFrom, hoursTo, days, maxPerDay, periodDays],
  )

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))
  }

  return (
    <div className="space-y-3 rounded-lg border bg-secondary/30 p-3">
      <input type="hidden" name="config" value={configJson} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="hours_from">Desde</Label>
          <Input
            id="hours_from"
            type="time"
            value={hoursFrom}
            onChange={(e) => setHoursFrom(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="hours_to">Hasta</Label>
          <Input
            id="hours_to"
            type="time"
            value={hoursTo}
            onChange={(e) => setHoursTo(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Días válidos</Label>
        <div className="mt-1 flex gap-1">
          {DAY_LABELS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => toggleDay(d.value)}
              className={cn(
                'size-9 rounded-md text-xs font-medium transition-colors',
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="max_per_day" className="text-xs">
            Máx. por día
          </Label>
          <Input
            id="max_per_day"
            type="number"
            min={1}
            max={5}
            value={maxPerDay}
            onChange={(e) => setMaxPerDay(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <div>
          <Label htmlFor="period_days" className="text-xs">
            Ventana (días)
          </Label>
          <Input
            id="period_days"
            type="number"
            min={1}
            max={365}
            value={periodDays}
            onChange={(e) => setPeriodDays(e.target.value)}
            placeholder="30"
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Campos comunes a crear y editar. Sin `template` arranca con defaults de
 * creación; con `template` precarga los valores actuales. La foto viaja por
 * el input hidden `image_url` (el estado vive en el dialog contenedor para
 * poder comparar y borrar la vieja al guardar).
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
}: {
  template?: PunchCardTemplateRow
  tenantId: string
  items: NamedOption[]
  categories: NamedOption[]
  tags: NamedOption[]
  rewards: NamedOption[]
  imageUrl: string | null
  onImageChange: (url: string | null) => void
}) {
  const [triggerType, setTriggerType] = useState<TriggerType>(
    template?.trigger_type ?? 'visit_window',
  )

  const triggerOptions =
    triggerType === 'item' ? items : triggerType === 'category' ? categories : tags

  return (
    <>
      <div>
        <Label htmlFor="name">Nombre</Label>
        <Input
          id="name"
          name="name"
          autoFocus
          required
          maxLength={80}
          defaultValue={template?.name}
          placeholder="5 almuerzos → 6to gratis"
        />
      </div>
      <div>
        <Label htmlFor="description">Descripción (opcional)</Label>
        <Textarea
          id="description"
          name="description"
          maxLength={400}
          defaultValue={template?.description ?? undefined}
        />
      </div>

      {/* Foto que ve el cliente en su tarjeta. Viaja por el input hidden. */}
      <input type="hidden" name="image_url" value={imageUrl ?? ''} />
      <MenuImageUploader
        tenantId={tenantId}
        value={imageUrl}
        onChange={onImageChange}
        label="Foto de la tarjeta (opcional)"
      />

      <div>
        <Label htmlFor="trigger_type">Avanza con</Label>
        <Select
          name="trigger_type"
          defaultValue={template?.trigger_type ?? 'visit_window'}
          onValueChange={(v) => setTriggerType(v as TriggerType)}
        >
          <SelectTrigger id="trigger_type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="visit_window">Visita en horario (almuerzo)</SelectItem>
            <SelectItem value="item">Ítem específico</SelectItem>
            <SelectItem value="category">Categoría</SelectItem>
            <SelectItem value="tag">Tag</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {triggerType === 'visit_window' ? (
        <VisitWindowConfigFields
          config={template?.trigger_type === 'visit_window' ? template.config : undefined}
        />
      ) : (
        <div>
          <Label htmlFor="trigger_ref_id">Cuál</Label>
          {/* key: al cambiar el tipo se remonta el Select para descartar una
              selección del tipo anterior (id de otro catálogo). */}
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
            <SelectTrigger id="trigger_ref_id">
              <SelectValue placeholder="Seleccionar…" />
            </SelectTrigger>
            <SelectContent>
              {triggerOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="threshold">Cantidad para completar</Label>
          <Input
            id="threshold"
            name="threshold"
            type="number"
            min={2}
            max={100}
            required
            defaultValue={template?.threshold ?? 5}
          />
        </div>
        <div>
          <Label htmlFor="expires_after_days">Vence en días (opcional)</Label>
          <Input
            id="expires_after_days"
            name="expires_after_days"
            type="number"
            min={1}
            max={365}
            defaultValue={template?.expires_after_days ?? ''}
            placeholder="ej: 90"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="reward_id">Reward al completar</Label>
        <Select name="reward_id" required defaultValue={template?.reward_id}>
          <SelectTrigger id="reward_id">
            <SelectValue placeholder="Seleccionar reward…" />
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
    </>
  )
}

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
        // dejar archivos huérfanos. Best-effort en el browser con el client
        // anon: un fallo de borrado no debe romper el guardado.
        if (
          template.image_url &&
          template.image_url !== imageUrl &&
          isStorageUrl(template.image_url)
        ) {
          try {
            await deleteMenuImageByUrl(template.image_url)
          } catch {
            // best-effort
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
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar punch card</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-3">
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
                Si la desactivás, los clientes no suman stamps nuevos.
              </p>
            </div>
            <Switch id="pc-active" checked={active} onCheckedChange={setActive} />
          </div>
          <input type="hidden" name="active" value={active ? 'on' : 'off'} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

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
  const [createImageUrl, setCreateImageUrl] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [state, action, formPending] = useActionState(
    (prev: PunchCardActionState, fd: FormData) => createPunchCard(tenantSlug, prev, fd),
    initial,
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

  const handleDelete = (id: string, name: string) => {
    startTransition(async () => {
      const r = await deletePunchCard(tenantSlug, id)
      if (r.ok) toast.success(`Card "${name}" eliminada`)
      else toast.error(r.message)
    })
  }

  if (rewards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Necesitás al menos un <strong>reward</strong> para crear punch cards. Andá a /puntos
          primero.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Tus punch cards</h2>
        <Dialog
          open={showCreate}
          onOpenChange={(open) => {
            setShowCreate(open)
            if (!open) setCreateImageUrl(null)
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1.5 size-4" />
              Nueva punch card
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nueva punch card</DialogTitle>
            </DialogHeader>
            <form action={action} className="space-y-3">
              <PunchCardFormFields
                tenantId={tenantId}
                items={items}
                categories={categories}
                tags={tags}
                rewards={rewards}
                imageUrl={createImageUrl}
                onImageChange={setCreateImageUrl}
              />
              {!state.ok && state.message && (
                <p className="text-sm text-destructive">{state.message}</p>
              )}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={formPending}>
                  {formPending ? 'Creando…' : 'Crear card'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {initialTemplates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No hay punch cards todavía. Creá la primera para que tus clientes empiecen a sumar
            stamps.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {initialTemplates.map((t) => (
            <div key={t.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    aria-label={`Editar foto y datos de ${t.name}`}
                    title="Foto de la tarjeta"
                    className="group/foto relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary/50 transition-shadow hover:ring-2 hover:ring-primary/50"
                  >
                    {t.image_url ? (
                      <StorageImage src={t.image_url} alt="" sizes="48px" />
                    ) : (
                      <Stamp className="size-5 text-muted-foreground/70" aria-hidden />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover/foto:opacity-100">
                      <Camera className="size-4 text-white" aria-hidden />
                    </span>
                  </button>
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-1.5 font-medium">
                      {t.trigger_type === 'visit_window' ? (
                        <UtensilsCrossed className="size-4 shrink-0 text-primary" aria-hidden />
                      ) : null}
                      <span className="truncate">{t.name}</span>
                    </h3>
                    {t.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                    )}
                  </div>
                </div>
                {!t.active && <Badge variant="secondary">Inactiva</Badge>}
              </div>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {t.trigger_type === 'visit_window' ? (
                  <p>
                    {t.threshold} visitas → {t.reward_name ?? '?'}
                    {t.config.hours_from && t.config.hours_to ? (
                      <>
                        {' · '}
                        {(t.config.hours_from as string).slice(0, 5)}–
                        {(t.config.hours_to as string).slice(0, 5)} hs
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p>
                    Cada {t.threshold} de tipo <strong>{t.trigger_type}</strong> →{' '}
                    {t.reward_name ?? '?'}
                  </p>
                )}
                {t.expires_after_days && (
                  <p>Vence en {t.expires_after_days} días desde el primer stamp.</p>
                )}
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => handleDelete(t.id, t.name)}
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
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
    </div>
  )
}
