'use client'

import { useActionState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type TenantConfigState, updateTenantConfig } from '@/lib/admin/tenant-config'

const initial: TenantConfigState = { ok: false, message: '' }

type Config = {
  guest_idle_hours_to_rescan: number
  session_auto_abandon_hours: number
  ticket_auto_accept_enabled: boolean
  ticket_auto_accept_max_cents: number | null
  ticket_auto_accept_max_items: number | null
}

export function AutoAcceptForm({
  tenantSlug,
  initialConfig,
}: {
  tenantSlug: string
  initialConfig: Config
}) {
  const [state, action, pending] = useActionState(
    (prev: TenantConfigState, fd: FormData) => updateTenantConfig(tenantSlug, prev, fd),
    initial,
  )

  if (state.ok && state.message) {
    toast.success(state.message)
  }

  return (
    <form action={action} className="max-w-2xl space-y-6">
      <div className="rounded-xl border bg-card p-5">
        <h2 className="font-display text-base font-semibold">Auto-aceptación de comandas</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Si está activa, las comandas del comensal van directo a cocina sin esperar al mozo. Podés
          agregar caps de monto y cantidad de ítems para que las comandas grandes igual requieran
          confirmación humana.
        </p>
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="ticket_auto_accept_enabled"
              name="ticket_auto_accept_enabled"
              defaultChecked={initialConfig.ticket_auto_accept_enabled}
            />
            <Label htmlFor="ticket_auto_accept_enabled">Habilitar auto-aceptación</Label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ticket_auto_accept_max_cents">Cap de monto (cents)</Label>
              <Input
                id="ticket_auto_accept_max_cents"
                name="ticket_auto_accept_max_cents"
                type="number"
                min={1}
                placeholder="Sin límite"
                defaultValue={initialConfig.ticket_auto_accept_max_cents ?? ''}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Comandas más caras requieren confirmación. Vacío = sin límite.
              </p>
            </div>
            <div>
              <Label htmlFor="ticket_auto_accept_max_items">Cap de ítems</Label>
              <Input
                id="ticket_auto_accept_max_items"
                name="ticket_auto_accept_max_items"
                type="number"
                min={1}
                max={100}
                placeholder="Sin límite"
                defaultValue={initialConfig.ticket_auto_accept_max_items ?? ''}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Comandas con más ítems requieren confirmación. Vacío = sin límite.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h2 className="font-display text-base font-semibold">Timeouts</h2>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="guest_idle_hours_to_rescan">Horas para re-scan del comensal</Label>
            <Input
              id="guest_idle_hours_to_rescan"
              name="guest_idle_hours_to_rescan"
              type="number"
              min={1}
              max={24}
              required
              defaultValue={initialConfig.guest_idle_hours_to_rescan}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Si un comensal estuvo inactivo más de N horas, debe volver a escanear el QR físico
              para enviar comandas.
            </p>
          </div>
          <div>
            <Label htmlFor="session_auto_abandon_hours">Horas para abandono automático</Label>
            <Input
              id="session_auto_abandon_hours"
              name="session_auto_abandon_hours"
              type="number"
              min={1}
              max={72}
              required
              defaultValue={initialConfig.session_auto_abandon_hours}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              El cron diario marca como `abandoned` sesiones sin actividad por más de N horas.
            </p>
          </div>
        </div>
      </div>

      {!state.ok && state.message && <p className="text-sm text-destructive">{state.message}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar configuración'}
        </Button>
      </div>
    </form>
  )
}
