'use client'

import { Plus, Trash2, UtensilsCrossed } from 'lucide-react'
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
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
import { Textarea } from '@/components/ui/textarea'
import {
  createPunchCard,
  deletePunchCard,
  type PunchCardActionState,
} from '@/lib/punch-cards/actions'
import type { PunchCardTemplateRow } from '@/lib/punch-cards/queries'
import { cn } from '@/lib/utils'

const initial: PunchCardActionState = { ok: false, message: '' }

type TriggerType = 'item' | 'category' | 'tag' | 'visit_window'

const DAY_LABELS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'L' },
  { value: 2, label: 'M' },
  { value: 3, label: 'M' },
  { value: 4, label: 'J' },
  { value: 5, label: 'V' },
  { value: 6, label: 'S' },
  { value: 7, label: 'D' },
]

export function PunchCardsManager({
  tenantSlug,
  initialTemplates,
  items,
  categories,
  tags,
  rewards,
}: {
  tenantSlug: string
  initialTemplates: PunchCardTemplateRow[]
  items: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string }>
  tags: Array<{ id: string; name: string }>
  rewards: Array<{ id: string; name: string }>
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [triggerType, setTriggerType] = useState<TriggerType>('visit_window')
  const [pending, startTransition] = useTransition()
  const [state, action, formPending] = useActionState(
    (prev: PunchCardActionState, fd: FormData) => createPunchCard(tenantSlug, prev, fd),
    initial,
  )

  // Estado para los campos visit_window
  const [hoursFrom, setHoursFrom] = useState('12:00')
  const [hoursTo, setHoursTo] = useState('15:30')
  const [maxPerDay, setMaxPerDay] = useState(1)
  const [periodDays, setPeriodDays] = useState<string>('30')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])

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

  useEffect(() => {
    if (state.ok) {
      setShowCreate(false)
      toast.success('Tarjeta creada.')
    } else if (state.message && state.message.length > 0) {
      toast.error(state.message)
    }
  }, [state])

  const triggerOptions =
    triggerType === 'item' ? items : triggerType === 'category' ? categories : tags

  const handleDelete = (id: string, name: string) => {
    startTransition(async () => {
      const r = await deletePunchCard(tenantSlug, id)
      if (r.ok) toast.success(`Card "${name}" eliminada`)
      else toast.error(r.message)
    })
  }

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))
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
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
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
              <div>
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  name="name"
                  autoFocus
                  required
                  maxLength={80}
                  placeholder="5 almuerzos → 6to gratis"
                />
              </div>
              <div>
                <Label htmlFor="description">Descripción (opcional)</Label>
                <Textarea id="description" name="description" maxLength={400} />
              </div>

              <div>
                <Label htmlFor="trigger_type">Avanza con</Label>
                <Select
                  name="trigger_type"
                  defaultValue="visit_window"
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
              ) : (
                <div>
                  <Label htmlFor="trigger_ref_id">Cuál</Label>
                  <Select name="trigger_ref_id" required>
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
                    defaultValue={5}
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
                    placeholder="ej: 90"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="reward_id">Reward al completar</Label>
                <Select name="reward_id" required>
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
                <div className="flex items-start gap-2">
                  {t.trigger_type === 'visit_window' ? (
                    <UtensilsCrossed className="mt-0.5 size-4 text-primary" />
                  ) : null}
                  <div>
                    <h3 className="font-medium">{t.name}</h3>
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
    </div>
  )
}
