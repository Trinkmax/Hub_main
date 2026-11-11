'use client'

import { RotateCw, Settings2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { NumberStepper } from '@/components/purchasing/catalog/form-bits'
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
import { capitalizeFirst, WEEKDAY_NAMES, WEEKDAY_NAMES_SHORT } from '@/lib/dates'
import { saveSettings } from '@/lib/purchasing/catalog-actions'
import { countWindowDays, WEEKDAYS_MONDAY_FIRST } from '@/lib/purchasing/dates'
import { MAX_ARRIVE_DAYS_BEFORE, type PurSettings } from '@/lib/purchasing/types'
import { cn } from '@/lib/utils'

/** Las opciones de «hasta el…» de un día de conteo: los 7 días que siguen (y el que ya tenga, si es más). */
function windowOptions(weekday: number, current: number): { days: number; label: string }[] {
  const options = [1, 2, 3, 4, 5, 6, 7]
  if (!options.includes(current)) options.push(current)
  return options
    .sort((a, b) => a - b)
    .map((days) => {
      const name = WEEKDAY_NAMES[(weekday + days) % 7] ?? ''
      return { days, label: days >= 7 ? `el ${name} siguiente` : `el ${name}` }
    })
}

function daysText(n: number): string {
  return n === 1 ? '1 día' : `${n} días`
}

/** «Actualizar» (otro socio pudo haber mandado algo) y los ajustes de Compras. */
export function PanelActions({
  slug,
  settings,
  tenantName,
}: {
  slug: string
  settings: PurSettings
  tenantName: string
}) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-10 rounded-xl"
        onClick={() => startRefresh(() => router.refresh())}
        disabled={refreshing}
      >
        <RotateCw className={cn('size-4', refreshing && 'animate-spin')} aria-hidden />
        Actualizar
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-10 rounded-xl"
        onClick={() => setOpen(true)}
      >
        <Settings2 className="size-4" aria-hidden />
        Ajustes
      </Button>
      {open ? (
        <SettingsDialog
          slug={slug}
          settings={settings}
          tenantName={tenantName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

function SettingsDialog({
  slug,
  settings,
  tenantName,
  onClose,
}: {
  slug: string
  settings: PurSettings
  tenantName: string
  onClose: () => void
}) {
  const router = useRouter()
  const [days, setDays] = useState<number[]>(settings.countWeekdays)
  const [arrive, setArrive] = useState(settings.arriveDaysBefore)
  // Lo que se eligió a mano para cada día; el resto sigue la cuenta (cambia con los días y los «días antes»).
  const [windows, setWindows] = useState<Record<number, number>>(settings.countWindows)
  const [guests, setGuests] = useState(String(settings.recipeBaseGuests))
  const [reviewer, setReviewer] = useState(settings.reviewerName ?? '')
  const [sender, setSender] = useState(settings.senderName ?? '')
  const [pending, start] = useTransition()

  const windowOf = (weekday: number) =>
    countWindowDays(weekday, {
      countWeekdays: days,
      countWindows: windows,
      arriveDaysBefore: arrive,
    })
  const countDays = WEEKDAYS_MONDAY_FIRST.filter((d) => days.includes(d))

  const save = () => {
    const n = Number.parseInt(guests, 10)
    if (!Number.isFinite(n) || n < 1) {
      toast.error('Las personas de las recetas tienen que ser un número.')
      return
    }
    start(async () => {
      const res = await saveSettings({
        slug,
        countWeekdays: days,
        countWindows: days.map((weekday) => ({ weekday, days: windowOf(weekday) })),
        arriveDaysBefore: arrive,
        recipeBaseGuests: n,
        reviewerName: reviewer.trim() || null,
        senderName: sender.trim() || null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success('Ajustes guardados.')
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustes de Compras</DialogTitle>
          <DialogDescription>
            Lo que antes estaba en la hoja CONFIG de la planilla.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Días en que la cocina cuenta</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS_MONDAY_FIRST.map((d) => {
                const on = days.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDays((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))
                    }
                    className={cn(
                      'h-11 w-12 rounded-xl border text-sm font-semibold capitalize transition-colors',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card hover:bg-muted',
                    )}
                  >
                    {WEEKDAY_NAMES_SHORT[d]}
                  </button>
                )
              })}
            </div>
          </fieldset>
          {countDays.length ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Cada conteo cubre los eventos hasta</legend>
              <ul className="space-y-2">
                {countDays.map((d) => {
                  const current = windowOf(d)
                  return (
                    <li key={d} className="flex items-center justify-between gap-3">
                      <Label htmlFor={`pur-window-${d}`} className="font-normal">
                        {capitalizeFirst(WEEKDAY_NAMES[d] ?? '')}
                      </Label>
                      <select
                        id={`pur-window-${d}`}
                        value={current}
                        onChange={(e) =>
                          setWindows((prev) => ({ ...prev, [d]: Number(e.target.value) }))
                        }
                        className="h-11 w-48 rounded-xl border border-input bg-background px-3 text-sm"
                      >
                        {windowOptions(d, current).map((o) => (
                          <option key={o.days} value={o.days}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  )
                })}
              </ul>
              <p className="text-sm text-muted-foreground">
                Es lo que la cocina ve al empezar el conteo; lo puede cambiar para ese conteo.
              </p>
            </fieldset>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="pur-arrive">La mercadería tiene que llegar</Label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <NumberStepper
                id="pur-arrive"
                value={arrive}
                min={0}
                max={MAX_ARRIVE_DAYS_BEFORE}
                onChange={setArrive}
                format={daysText}
                decreaseLabel="Un día menos"
                increaseLabel="Un día más"
                describedById="pur-arrive-hint"
              />
              <span className="text-sm">antes del evento</span>
            </div>
            <p id="pur-arrive-hint" className="text-sm text-muted-foreground">
              Con los días de entrega de cada proveedor, el panel dice hasta cuándo pedirle lo de
              cada evento y avisa si algo llega tarde.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pur-base">Para cuántas personas están las recetas</Label>
            <Input
              id="pur-base"
              inputMode="numeric"
              value={guests}
              onChange={(e) => setGuests(e.target.value.replace(/\D/g, ''))}
              className="h-11 w-28"
            />
            <p className="text-sm text-muted-foreground">
              Si una fecha tiene más reservas, se multiplica.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pur-reviewer">Quién revisa los pedidos</Label>
            <Input
              id="pur-reviewer"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              maxLength={40}
              placeholder="Ej.: Tomás"
              className="h-11"
            />
            <p className="text-sm text-muted-foreground">
              La cocina ve «Enviar a {reviewer.trim() || 'revisión'}».
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pur-sender">Cómo se presenta el WhatsApp</Label>
            <Input
              id="pur-sender"
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              maxLength={60}
              placeholder={tenantName}
              className="h-11"
            />
            <p className="text-sm text-muted-foreground">
              «¡Hola! Te escribo de {sender.trim() || tenantName}…»
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
