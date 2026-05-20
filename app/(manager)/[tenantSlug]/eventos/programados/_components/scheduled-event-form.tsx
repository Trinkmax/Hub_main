'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useEffect, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { deleteScheduledEvent, upsertScheduledEvent } from '@/lib/salon/actions'
import { type ScheduledEventInput, scheduledEventSchema } from '@/lib/salon/schemas'

type ScheduledEventFormInput = ScheduledEventInput

import { MEAL_TYPE_LABELS, type MealType, type ScheduledEventTemplateRow } from '@/lib/salon/types'

type Props = {
  tenantSlug: string
  mode: 'create' | 'edit'
  templates: ScheduledEventTemplateRow[]
  presetDate?: string
  initialValues?: Partial<ScheduledEventFormInput> & { id?: string }
}

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

export function ScheduledEventForm({
  tenantSlug,
  mode,
  templates,
  presetDate,
  initialValues,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const form = useForm<ScheduledEventFormInput>({
    resolver: zodResolver(scheduledEventSchema) as never,
    defaultValues: {
      template_id: templates[0]?.id ?? '',
      event_date: presetDate ?? new Date().toISOString().slice(0, 10),
      starts_at_local: '21:00',
      ends_at_local: undefined,
      capacity: templates[0]?.default_capacity ?? 40,
      meal_type: templates[0]?.default_meal_type ?? 'dinner',
      full_bonus_active: true,
      name_override: undefined,
      notes: undefined,
      ...initialValues,
    },
  })

  // Auto-pisar capacity / meal_type al cambiar template
  const watchedTemplate = form.watch('template_id')
  useEffect(() => {
    const tpl = templates.find((t) => t.id === watchedTemplate)
    if (!tpl) return
    if (mode === 'create') {
      if (tpl.default_capacity) form.setValue('capacity', tpl.default_capacity)
      if (tpl.default_meal_type) form.setValue('meal_type', tpl.default_meal_type)
    }
  }, [watchedTemplate, templates, mode, form])

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      const r = await upsertScheduledEvent(tenantSlug, {
        ...data,
        ...(mode === 'edit' && initialValues?.id ? { id: initialValues.id } : {}),
      } as Record<string, unknown>)
      if (r.ok) {
        toast.success(mode === 'create' ? 'Evento programado.' : 'Evento actualizado.')
        router.push(`/${tenantSlug}/eventos/programados`)
        router.refresh()
      } else {
        toast.error(r.message)
      }
    })
  })

  const onDelete = () => {
    if (!initialValues?.id) return
    if (!confirm('¿Borrar este evento programado?')) return
    startTransition(async () => {
      const r = await deleteScheduledEvent(tenantSlug, initialValues.id ?? '')
      if (r.ok) {
        toast.success('Evento eliminado.')
        router.push(`/${tenantSlug}/eventos/programados`)
        router.refresh()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-xl border bg-card/60 p-5">
      <div className="grid gap-1.5">
        <Label htmlFor="template_id">Template</Label>
        <Select
          value={form.watch('template_id')}
          onValueChange={(v) => form.setValue('template_id', v, { shouldValidate: true })}
        >
          <SelectTrigger className="h-11">
            <SelectValue placeholder="Elegí un template" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: t.color_hex }} />
                  {t.name}
                  {t.default_capacity ? (
                    <span className="text-[11px] text-muted-foreground">
                      · cap {t.default_capacity}
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="event_date">Fecha</Label>
          <Input id="event_date" type="date" {...form.register('event_date')} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="starts_at_local">Inicio</Label>
          <Input
            id="starts_at_local"
            type="time"
            step={900}
            {...form.register('starts_at_local')}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ends_at_local">Fin (opcional)</Label>
          <Input id="ends_at_local" type="time" step={900} {...form.register('ends_at_local')} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <div className="grid gap-1.5">
          <Label htmlFor="capacity">Cupo</Label>
          <Input
            id="capacity"
            type="number"
            min={1}
            max={999}
            {...form.register('capacity', { valueAsNumber: true })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Servicio</Label>
          <Select
            value={form.watch('meal_type')}
            onValueChange={(v) => form.setValue('meal_type', v as MealType)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEAL_TYPES.map((m) => (
                <SelectItem key={m} value={m}>
                  {MEAL_TYPE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="name_override">Nombre custom (opcional)</Label>
        <Input
          id="name_override"
          {...form.register('name_override')}
          placeholder="Ej: Sushi Libre San Valentín"
          maxLength={120}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="notes">Notas internas</Label>
        <Textarea id="notes" {...form.register('notes')} rows={2} maxLength={500} />
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
        <Switch
          id="full_bonus_active"
          checked={form.watch('full_bonus_active')}
          onCheckedChange={(v) => form.setValue('full_bonus_active', v)}
        />
        <label htmlFor="full_bonus_active" className="cursor-pointer">
          <div className="text-sm font-medium">Bonus por evento lleno</div>
          <p className="text-xs text-muted-foreground">
            Si llega al 100% del cupo, el gestor cobra el bonus extra por persona.
          </p>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {mode === 'edit' && initialValues?.id ? (
          <Button type="button" variant="ghost" onClick={onDelete} disabled={pending}>
            Borrar
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : mode === 'create' ? 'Programar' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}
