'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
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
import { Switch } from '@/components/ui/switch'
import { saveEventPlan } from '@/lib/purchasing/catalog-actions'
import { relativeDayLabel } from '@/lib/purchasing/dates'
import type { PlannedEvent } from '@/lib/purchasing/events'
import { cn } from '@/lib/utils'

function statusLine(e: PlannedEvent): { text: string; tone: 'ok' | 'muted' | 'warn' } {
  switch (e.status) {
    case 'sums':
      return {
        text: `Suma insumos · ${e.guests} ${e.guestsSource === 'recipe' ? 'personas (la receta)' : 'personas'}`,
        tone: 'ok',
      }
    case 'needs_variant':
      return { text: 'Elegí la variante', tone: 'warn' }
    case 'skipped':
      return { text: 'No suma (lo sacaste)', tone: 'muted' }
    case 'notice_only':
      return { text: e.notice ?? 'Aviso', tone: 'muted' }
    default:
      return { text: 'Sale con lo de siempre', tone: 'muted' }
  }
}

/** Los próximos 7 días del calendario y qué suma cada fecha. Tocando una se elige la variante y las personas. */
export function UpcomingEvents({
  slug,
  today,
  events,
}: {
  slug: string
  today: string
  events: PlannedEvent[]
}) {
  const [editing, setEditing] = useState<PlannedEvent | null>(null)
  if (!events.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay fechas en el calendario para los próximos 7 días.
      </p>
    )
  }
  return (
    <>
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {events.map((e) => {
          const s = statusLine(e)
          return (
            <li key={e.event.id}>
              <button
                type="button"
                onClick={() => setEditing(e)}
                className={cn(
                  'h-full w-full rounded-2xl border bg-card p-3.5 text-left shadow-xs transition-colors hover:border-foreground/20',
                  e.status === 'needs_variant' ? 'border-warning/60' : 'border-border/70',
                )}
              >
                <span className="block text-sm text-muted-foreground first-letter:uppercase">
                  {relativeDayLabel(e.event.date, today)}
                  {e.event.startsAt ? ` · ${e.event.startsAt}` : ''}
                </span>
                <span className="mt-0.5 block font-semibold leading-snug">
                  {e.event.name}
                  {e.recipe && e.variants.length > 1 ? ` · ${e.recipe.variant}` : ''}
                </span>
                <span
                  className={cn(
                    'mt-0.5 block text-sm',
                    s.tone === 'ok' && 'text-primary',
                    s.tone === 'warn' && 'font-semibold text-warning-text',
                    s.tone === 'muted' && 'text-muted-foreground',
                  )}
                >
                  {s.text}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {editing ? (
        <PlanDialog slug={slug} today={today} planned={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  )
}

function PlanDialog({
  slug,
  today,
  planned,
  onClose,
}: {
  slug: string
  today: string
  planned: PlannedEvent
  onClose: () => void
}) {
  const router = useRouter()
  const { event, variants } = planned
  const base = planned.recipe?.baseGuests ?? variants[0]?.baseGuests ?? 60
  const [recipeId, setRecipeId] = useState<string | null>(planned.recipe?.id ?? null)
  const [guests, setGuests] = useState(
    planned.guestsSource === 'plan' ? String(planned.guests) : '',
  )
  const [skip, setSkip] = useState(planned.status === 'skipped')
  const [pending, start] = useTransition()

  const save = () => {
    const n = guests.trim() ? Number.parseInt(guests, 10) : null
    if (n != null && (!Number.isFinite(n) || n < 1)) {
      toast.error('Las personas tienen que ser un número.')
      return
    }
    start(async () => {
      const res = await saveEventPlan({
        slug,
        scheduledEventId: event.id,
        recipeId: variants.length > 1 ? recipeId : null,
        guests: n,
        skip,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success('Guardado: el próximo conteo ya lo tiene en cuenta.')
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{event.name}</DialogTitle>
          <DialogDescription className="first-letter:uppercase">
            {relativeDayLabel(event.date, today)}
            {event.startsAt ? ` · ${event.startsAt}` : ''} · {event.reservedGuests}{' '}
            {event.reservedGuests === 1 ? 'reservada' : 'reservadas'}
            {event.capacity ? ` de ${event.capacity}` : ''}
          </DialogDescription>
        </DialogHeader>

        {!variants.length ? (
          <p className="text-sm text-muted-foreground">
            Este formato no tiene receta: sale con lo de siempre.{' '}
            <Link
              href={
                event.templateId
                  ? `/${slug}/compras/recetas?nuevo=1&formato=${event.templateId}`
                  : `/${slug}/compras/recetas`
              }
              className="font-semibold text-foreground underline underline-offset-4"
            >
              Cargar la receta
            </Link>
          </p>
        ) : (
          <div className="space-y-5">
            {variants.length > 1 ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">¿Qué variante va?</legend>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={recipeId === v.id}
                      onClick={() => setRecipeId(v.id)}
                      className={cn(
                        'min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors',
                        recipeId === v.id
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card hover:bg-muted',
                      )}
                    >
                      {v.variant}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="pur-guests">¿Para cuántas personas comprás?</Label>
              <Input
                id="pur-guests"
                inputMode="numeric"
                value={guests}
                onChange={(e) => setGuests(e.target.value.replace(/\D/g, ''))}
                placeholder={String(Math.max(event.reservedGuests, base))}
                className="h-11 w-32"
              />
              <p className="text-sm text-muted-foreground">
                Vacío: las reservadas, y nunca menos que las {base} de la receta.
              </p>
            </div>
            <Label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 p-3.5 font-normal">
              <span>
                <span className="block font-medium">Esta fecha no suma insumos</span>
                <span className="block text-sm text-muted-foreground">
                  Por si no se hace o sale con lo de siempre.
                </span>
              </span>
              <Switch checked={skip} onCheckedChange={setSkip} />
            </Label>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {variants.length ? 'Cancelar' : 'Cerrar'}
          </Button>
          {variants.length ? (
            <Button
              type="button"
              onClick={save}
              disabled={pending || (variants.length > 1 && !recipeId && !skip)}
            >
              Guardar
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
