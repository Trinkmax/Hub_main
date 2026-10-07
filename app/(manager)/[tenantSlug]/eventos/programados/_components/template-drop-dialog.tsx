'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { longDayLabel } from '@/components/reservations/day-labels'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { NumberField } from '@/components/ui/number-field'
import { Switch } from '@/components/ui/switch'
import { TimeField } from '@/components/ui/time-field'
import { upsertScheduledEvent } from '@/lib/salon/actions'
import { PRIVATE_GROUP_SWITCH } from '@/lib/salon/private-groups'
import { MEAL_TYPE_LABELS, type ScheduledEventTemplateRow } from '@/lib/salon/types'

const DEFAULT_TIMES: Record<string, string> = {
  breakfast: '09:00',
  lunch: '13:00',
  tea_time: '17:00',
  dinner: '21:00',
  hub_event: '21:00',
}

/** Solo hex: el color viene de la DB y va a un `style`. */
function safeColor(colorHex: string | null | undefined): string {
  return colorHex && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(colorHex)
    ? colorHex
    : 'var(--muted-foreground)'
}

/**
 * Al soltar un formato sobre un día del mes: hora, cupo y si es un grupo
 * privado, y listo. Lo demás sale del formato.
 */
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
  const initialTime = template ? (DEFAULT_TIMES[template.default_meal_type] ?? '21:00') : '21:00'
  const initialCap = template?.default_capacity ?? 40

  const [time, setTime] = useState<string | null>(initialTime)
  const [capacity, setCapacity] = useState<number | null>(initialCap)
  const [privateGroup, setPrivateGroup] = useState(template?.default_private_group ?? false)
  const [pending, startTransition] = useTransition()

  // Reset cuando abre con otro template/día
  useEffect(() => {
    if (open && template) {
      setTime(DEFAULT_TIMES[template.default_meal_type] ?? '21:00')
      setCapacity(template.default_capacity ?? 40)
      setPrivateGroup(template.default_private_group)
    }
  }, [open, template])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!template || !date || !time || capacity === null) return
    startTransition(async () => {
      const result = await upsertScheduledEvent(tenantSlug, {
        template_id: template.id,
        event_date: date,
        starts_at_local: time,
        capacity,
        meal_type: template.default_meal_type,
        full_bonus_active: true,
        private_group: privateGroup,
      })
      if (result.ok) {
        toast.success(`${template.name} programado para el ${longDayLabel(date)}`)
        onOpenChange(false)
        onCreated?.()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {template ? (
              <span
                aria-hidden
                className="inline-block size-3 shrink-0 rounded-full"
                style={{ backgroundColor: safeColor(template.color_hex) }}
              />
            ) : null}
            Programar {template?.name ?? 'evento'}
          </DialogTitle>
          <DialogDescription>
            {date ? <span className="first-letter:uppercase">{longDayLabel(date)}</span> : null}
            {template ? (
              <>
                {' · '}
                {MEAL_TYPE_LABELS[template.default_meal_type]}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <Field label="Hora de inicio">
            <TimeField value={time} onValueChange={setTime} step={5} required />
          </Field>

          <Field
            label="Cupo total"
            hint={
              template?.default_capacity == null
                ? 'Este formato no tiene cupo por defecto: completalo a mano.'
                : undefined
            }
          >
            <NumberField
              value={capacity}
              onValueChange={setCapacity}
              min={1}
              max={999}
              suffix="lugares"
              required
            />
          </Field>

          {/* «Grupo privado»: arranca como diga el formato. */}
          <Field
            layout="toggle"
            label={PRIVATE_GROUP_SWITCH.label}
            hint={PRIVATE_GROUP_SWITCH.hint}
          >
            <Switch checked={privateGroup} onCheckedChange={setPrivateGroup} />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={pending} loadingText="Programando…">
              Programar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
