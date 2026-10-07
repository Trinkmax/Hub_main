'use client'

import { ChefHat, Timer, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { type TenantConfigState, updateTenantConfig } from '@/lib/admin/tenant-config'

const initial: TenantConfigState = { ok: false, message: '' }

type Config = {
  guest_idle_hours_to_rescan: number
  session_auto_abandon_hours: number
  ticket_auto_accept_enabled: boolean
  ticket_auto_accept_max_cents: number | null
  ticket_auto_accept_max_items: number | null
  kitchen_flow_enabled: boolean
}

function SettingCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description: ReactNode
  children?: ReactNode
}) {
  return (
    <Card className="card-hairline border-border/70 bg-card/85">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-[--cream-tint] text-primary">
            {icon}
          </span>
          <div className="space-y-1">
            <CardTitle className="font-display text-base">{title}</CardTitle>
            <p className="text-sm text-muted-foreground text-pretty">{description}</p>
          </div>
        </div>
      </CardHeader>
      {children ? <CardContent className="space-y-4">{children}</CardContent> : null}
    </Card>
  )
}

function ToggleRow({
  id,
  name,
  label,
  description,
  checked,
  defaultChecked,
  onCheckedChange,
}: {
  id: string
  name: string
  label: string
  description: string
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (v: boolean) => void
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border/60 bg-background/40 p-3.5 transition-colors hover:bg-[--cream-tint]"
    >
      <div className="space-y-0.5">
        <span className="text-sm font-medium">{label}</span>
        <p className="text-xs text-muted-foreground text-pretty">{description}</p>
      </div>
      <Switch
        id={id}
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        className="mt-0.5"
      />
    </label>
  )
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
  const [enabled, setEnabled] = useState(initialConfig.ticket_auto_accept_enabled)
  // El tope se guarda en centavos, pero el owner lo piensa en PESOS: campo
  // visible en pesos + hidden mirror en centavos (vacío = sin límite).
  const [maxPesos, setMaxPesos] = useState(
    initialConfig.ticket_auto_accept_max_cents != null
      ? String(Math.round(initialConfig.ticket_auto_accept_max_cents / 100))
      : '',
  )
  // Vacío o ≤0 → sin límite (evita chocar con el `min 1` del schema en centavos).
  const maxCents =
    maxPesos.trim() === '' || Number(maxPesos) <= 0
      ? ''
      : String(Math.round(Number(maxPesos) * 100))

  // Toast como efecto, no durante el render (evita disparos en cada re-render).
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message)
  }, [state])

  return (
    <form action={action} className="space-y-5">
      <SettingCard
        icon={<Zap className="size-5" aria-hidden />}
        title="Auto-aceptación de comandas"
        description="Si está activa, las comandas del comensal van directo a cocina sin esperar al mozo. Podés poner topes para que las comandas grandes igual requieran confirmación humana."
      >
        <ToggleRow
          id="ticket_auto_accept_enabled"
          name="ticket_auto_accept_enabled"
          label="Habilitar auto-aceptación"
          description="Las comandas se aceptan solas hasta los topes de abajo."
          checked={enabled}
          onCheckedChange={setEnabled}
        />

        {enabled ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ticket_auto_accept_max_pesos">Tope de monto</Label>
              {/* Hidden en centavos (unidad de guardado); el visible es en pesos. */}
              <input type="hidden" name="ticket_auto_accept_max_cents" value={maxCents} />
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="ticket_auto_accept_max_pesos"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder="Sin límite"
                  value={maxPesos}
                  onChange={(e) => setMaxPesos(e.target.value)}
                  className="pl-7 tabular-nums"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Comandas más caras requieren confirmación. Vacío = sin límite.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket_auto_accept_max_items">Tope de ítems</Label>
              <Input
                id="ticket_auto_accept_max_items"
                name="ticket_auto_accept_max_items"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                placeholder="Sin límite"
                defaultValue={initialConfig.ticket_auto_accept_max_items ?? ''}
              />
              <p className="text-xs text-muted-foreground">
                Comandas con más ítems requieren confirmación. Vacío = sin límite.
              </p>
            </div>
          </div>
        ) : null}
      </SettingCard>

      <SettingCard
        icon={<ChefHat className="size-5" aria-hidden />}
        title="Flujo de cocina"
        description="Si está activo, solo la cocina (y el dueño) mueven las comandas por preparación (En preparación → Listo) y el mozo solo confirma y entrega. Si está apagado, el mozo maneja todo el flujo."
      >
        <ToggleRow
          id="kitchen_flow_enabled"
          name="kitchen_flow_enabled"
          label="El bar usa cocina (KDS)"
          description="Activa la pantalla de cocina y separa el flujo mozo/cocina."
          defaultChecked={initialConfig.kitchen_flow_enabled}
        />
      </SettingCard>

      <SettingCard
        icon={<Timer className="size-5" aria-hidden />}
        title="Timeouts"
        description="Cuándo pedir un re-scan al comensal y cuándo abandonar sesiones inactivas."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="guest_idle_hours_to_rescan">Horas para re-scan del comensal</Label>
            <Input
              id="guest_idle_hours_to_rescan"
              name="guest_idle_hours_to_rescan"
              type="number"
              inputMode="numeric"
              min={1}
              max={24}
              required
              defaultValue={initialConfig.guest_idle_hours_to_rescan}
            />
            <p className="text-xs text-muted-foreground">
              Si un comensal estuvo inactivo más de N horas, debe volver a escanear el QR físico
              para enviar comandas.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="session_auto_abandon_hours">Horas para abandono automático</Label>
            <Input
              id="session_auto_abandon_hours"
              name="session_auto_abandon_hours"
              type="number"
              inputMode="numeric"
              min={1}
              max={72}
              required
              defaultValue={initialConfig.session_auto_abandon_hours}
            />
            <p className="text-xs text-muted-foreground">
              El cron diario marca como `abandoned` sesiones sin actividad por más de N horas.
            </p>
          </div>
        </div>
      </SettingCard>

      <div className="flex items-center justify-end gap-3">
        {!state.ok && state.message ? (
          <p className="text-sm text-destructive" role="alert">
            {state.message}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar configuración'}
        </Button>
      </div>
    </form>
  )
}
