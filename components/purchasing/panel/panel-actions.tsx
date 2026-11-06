'use client'

import { RotateCw, Settings2 } from 'lucide-react'
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
import { WEEKDAY_NAMES_SHORT } from '@/lib/dates'
import { saveSettings } from '@/lib/purchasing/catalog-actions'
import { WEEKDAYS_MONDAY_FIRST } from '@/lib/purchasing/dates'
import type { PurSettings } from '@/lib/purchasing/types'
import { cn } from '@/lib/utils'

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
  const [guests, setGuests] = useState(String(settings.recipeBaseGuests))
  const [reviewer, setReviewer] = useState(settings.reviewerName ?? '')
  const [sender, setSender] = useState(settings.senderName ?? '')
  const [pending, start] = useTransition()

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
            <p className="text-sm text-muted-foreground">
              Sirve para sugerir hasta qué día cuentan los eventos de cada conteo.
            </p>
          </fieldset>
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
