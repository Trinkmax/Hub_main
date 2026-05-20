'use client'

import { Loader2 } from 'lucide-react'
import { useEffect, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { upsertScheduledEvent } from '@/lib/salon/actions'
import { MEAL_TYPE_LABELS, type ScheduledEventTemplateRow } from '@/lib/salon/types'

const DEFAULT_TIMES: Record<string, string> = {
  breakfast: '09:00',
  lunch: '13:00',
  tea_time: '17:00',
  dinner: '21:00',
  hub_event: '21:00',
}

function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dt)
}

export function TemplateDropDialog({
  open,
  onOpenChange,
  tenantSlug,
  template,
  date,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantSlug: string
  template: ScheduledEventTemplateRow | null
  date: string | null
  onCreated?: () => void
}) {
  const timeId = useId()
  const capId = useId()

  const initialTime = template ? (DEFAULT_TIMES[template.default_meal_type] ?? '21:00') : '21:00'
  const initialCap = template?.default_capacity ?? 40

  const [time, setTime] = useState(initialTime)
  const [capacity, setCapacity] = useState(initialCap)
  const [pending, startTransition] = useTransition()

  // Reset cuando abre con otro template/día
  useEffect(() => {
    if (open && template) {
      setTime(DEFAULT_TIMES[template.default_meal_type] ?? '21:00')
      setCapacity(template.default_capacity ?? 40)
    }
  }, [open, template])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!template || !date) return
    startTransition(async () => {
      const result = await upsertScheduledEvent(tenantSlug, {
        template_id: template.id,
        event_date: date,
        starts_at_local: time,
        capacity,
        meal_type: template.default_meal_type,
        full_bonus_active: true,
      })
      if (result.ok) {
        toast.success(`${template.name} programado para el ${formatDateLong(date)}`)
        onOpenChange(false)
        onCreated?.()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif">
            {template ? (
              <span
                aria-hidden
                className="inline-block size-3 rounded-full"
                style={{ backgroundColor: template.color_hex }}
              />
            ) : null}
            Programar {template?.name ?? 'evento'}
          </DialogTitle>
          <DialogDescription>
            {date ? <span className="capitalize">{formatDateLong(date)}</span> : null}
            {template ? (
              <>
                {' · '}
                {MEAL_TYPE_LABELS[template.default_meal_type]}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={timeId}>Hora de inicio</Label>
            <Input
              id={timeId}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
              step={300}
              className="font-mono tabular-nums"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={capId}>Cupo total</Label>
            <Input
              id={capId}
              type="number"
              min={1}
              max={999}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              required
              className="tabular-nums"
            />
            {template?.default_capacity == null ? (
              <p className="text-[11px] text-muted-foreground">
                Este template no tiene cupo por defecto — completalo manualmente.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="gap-1.5">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Programar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
