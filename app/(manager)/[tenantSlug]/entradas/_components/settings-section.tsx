'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, Loader2, Settings2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
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
import { Textarea } from '@/components/ui/textarea'
import { saveTicketingSettings } from '@/lib/ticketing/actions'
import { type TicketingSettingsInput, ticketingSettingsSchema } from '@/lib/ticketing/schemas'
import type { TicketingSettingsView } from '@/lib/ticketing/types'
import { cn } from '@/lib/utils'
import { ONLINE_MANAGER_NAME } from '../_lib/overview'

export type ManagerOption = { id: string; name: string; commission: boolean }

/** Sin gestor elegido: la base crea «Venta online» (sin comisión) al guardar. */
const AUTO_MANAGER = '__venta-online__'

/** Cuánto se guarda el lugar mientras pagan. El rango de la base es 5–60. */
const HOLD_OPTIONS = [5, 10, 15, 20, 30, 45, 60] as const

type Fields = TicketingSettingsInput

/**
 * Configuración de la cartelera: los textos de arriba, la dirección, el
 * WhatsApp de consultas, cuánto se guarda el lugar y a nombre de quién quedan
 * las reservas que entran pagadas.
 *
 * Se arma una vez y casi no se toca: si ya tiene textos, arranca plegada con
 * un resumen; si está todo vacío, abierta.
 */
export function SettingsSection({
  tenantSlug,
  settings,
  managers,
}: {
  tenantSlug: string
  settings: TicketingSettingsView
  managers: ManagerOption[]
}) {
  const configured = Boolean(
    settings.headline || settings.intro || settings.venue_address || settings.contact_whatsapp,
  )
  const [open, setOpen] = useState(!configured)

  const onlineManager = managers.find((m) => m.name === ONLINE_MANAGER_NAME) ?? null
  // «Venta online» primero: es lo que decidieron los socios.
  const ordered = onlineManager
    ? [onlineManager, ...managers.filter((m) => m.id !== onlineManager.id)]
    : managers
  const initialManager = settings.online_manager_id ?? onlineManager?.id ?? null
  const strayManager =
    initialManager && !managers.some((m) => m.id === initialManager) ? initialManager : null

  // También el `defaultValue` de cada input: el primer paint (SSR) ya muestra lo guardado.
  const [initial] = useState<Fields>(() => ({
    headline: settings.headline ?? '',
    intro: settings.intro ?? '',
    venue_address: settings.venue_address ?? '',
    contact_whatsapp: settings.contact_whatsapp ?? '',
    hold_minutes: settings.hold_minutes ?? 15,
    online_manager_id: initialManager,
  }))
  const form = useForm<Fields>({
    // raw: zod valida, pero a la acción va lo tipeado (ella vuelve a validar y normaliza).
    resolver: zodResolver(ticketingSettingsSchema, undefined, { raw: true }),
    defaultValues: initial,
  })
  const { errors, isDirty } = form.formState
  const [pending, startTransition] = useTransition()

  const holdMinutes = Number(useWatch({ control: form.control, name: 'hold_minutes' }))
  const managerId = useWatch({ control: form.control, name: 'online_manager_id' }) ?? null
  const intro = useWatch({ control: form.control, name: 'intro' }) ?? ''
  const selectedManager = managers.find((m) => m.id === (managerId ?? onlineManager?.id)) ?? null
  const holdChoices = HOLD_OPTIONS.some((n) => n === holdMinutes)
    ? [...HOLD_OPTIONS]
    : [...HOLD_OPTIONS, holdMinutes].filter(Number.isFinite).sort((a, b) => a - b)

  const onSubmit = form.handleSubmit(
    (values) => {
      startTransition(async () => {
        const result = await saveTicketingSettings(tenantSlug, values)
        if (result.ok) {
          form.reset(values, { keepValues: true })
          toast.success(result.message ?? 'Configuración guardada.')
          return
        }
        const field = result.field
        if (field && field in values) {
          form.setError(field as keyof Fields, { type: 'server', message: result.message })
        }
        toast.error(result.message)
      })
    },
    () => toast.error('Revisá lo marcado en rojo antes de guardar.'),
  )

  const summary = [
    settings.headline ? `«${settings.headline}»` : 'Sin título propio',
    `lugar guardado ${settings.hold_minutes} min`,
    `reservas a nombre de ${
      managers.find((m) => m.id === settings.online_manager_id)?.name ?? ONLINE_MANAGER_NAME
    }`,
  ].join(' · ')

  return (
    <section
      aria-label="Configuración de la cartelera"
      className="card-hairline overflow-hidden rounded-xl border bg-card"
    >
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="config-cartelera-body"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            'flex min-h-14 w-full items-center gap-3 px-4 py-3.5 text-left outline-none transition-colors hover:bg-cream-tint focus-visible:bg-cream-tint focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5',
            open && 'border-b border-border/60',
          )}
        >
          <Settings2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-serif text-lg font-semibold tracking-tight">
              Configuración de la cartelera
            </span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {open ? 'Lo que se lee arriba de la cartelera y cómo entran las ventas.' : summary}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-base)]',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </h2>

      {/* Montado siempre (oculto si está plegada): lo tipeado no se pierde al plegar. */}
      <form
        id="config-cartelera-body"
        hidden={!open}
        onSubmit={onSubmit}
        noValidate
        className="space-y-5 p-4 sm:p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="cfg-headline">Título de la cartelera</Label>
            <Input
              id="cfg-headline"
              maxLength={80}
              placeholder="Cine y degustación"
              className="h-11"
              aria-invalid={errors.headline ? true : undefined}
              defaultValue={initial.headline ?? ''}
              {...form.register('headline')}
            />
            <FieldMessage error={errors.headline?.message} hint="Lo primero que se lee." />
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="cfg-address">Dirección del bar</Label>
            <Input
              id="cfg-address"
              maxLength={160}
              placeholder="Mariano Fragueiro 2151, Alta Córdoba"
              className="h-11"
              autoComplete="street-address"
              aria-invalid={errors.venue_address ? true : undefined}
              defaultValue={initial.venue_address ?? ''}
              {...form.register('venue_address')}
            />
            <FieldMessage error={errors.venue_address?.message} hint="Para saber dónde es." />
          </div>
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="cfg-intro">Bajada</Label>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {intro.length}/500
            </span>
          </div>
          <Textarea
            id="cfg-intro"
            rows={3}
            maxLength={500}
            placeholder="Una película y un menú pensado escena por escena. Elegí la función y reservá tu lugar."
            aria-invalid={errors.intro ? true : undefined}
            defaultValue={initial.intro ?? ''}
            {...form.register('intro')}
          />
          <FieldMessage error={errors.intro?.message} />
        </div>

        <div className="grid gap-1.5 sm:max-w-sm">
          <Label htmlFor="cfg-whatsapp">WhatsApp para consultas</Label>
          <Controller
            control={form.control}
            name="contact_whatsapp"
            render={({ field }) => (
              <PhoneInput
                id="cfg-whatsapp"
                international
                defaultCountry="AR"
                countryCallingCodeEditable={false}
                placeholder="351 555 1234"
                className="hub-phone-input"
                value={field.value ? field.value : undefined}
                onChange={(value) => field.onChange(value ?? '')}
                onBlur={field.onBlur}
                aria-invalid={errors.contact_whatsapp ? true : undefined}
              />
            )}
          />
          <FieldMessage
            error={errors.contact_whatsapp?.message}
            hint="Aparece en la cartelera para consultas y para «avisame si se libera un lugar»."
          />
        </div>

        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-medium">Cuánto se guarda el lugar mientras pagan</legend>
          <Controller
            control={form.control}
            name="hold_minutes"
            render={({ field }) => (
              <div className="flex flex-wrap gap-2">
                {holdChoices.map((minutes) => (
                  <label key={minutes} className="cursor-pointer">
                    <input
                      type="radio"
                      name={field.name}
                      value={minutes}
                      checked={holdMinutes === minutes}
                      onChange={() => field.onChange(minutes)}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        'inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium tabular-nums transition-colors',
                        'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
                        'peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground',
                        'peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
                      )}
                    >
                      {minutes} min
                    </span>
                  </label>
                ))}
              </div>
            )}
          />
          <FieldMessage
            error={errors.hold_minutes?.message}
            hint="Mientras pagan en Mercado Pago nadie más puede tomar ese lugar. Si no terminan, se libera solo."
          />
        </fieldset>

        <div className="grid gap-1.5">
          <Label htmlFor="cfg-manager">¿A nombre de quién quedan las reservas online?</Label>
          <Controller
            control={form.control}
            name="online_manager_id"
            render={({ field }) => (
              <Select
                // Sin elegir (null) la base usa «Venta online»: si ya existe, se muestra esa.
                value={field.value ?? onlineManager?.id ?? AUTO_MANAGER}
                onValueChange={(value) => field.onChange(value === AUTO_MANAGER ? null : value)}
              >
                <SelectTrigger id="cfg-manager" className="h-11 w-full sm:w-96">
                  <SelectValue placeholder="Elegí un gestor" />
                </SelectTrigger>
                <SelectContent>
                  {onlineManager ? null : (
                    <SelectItem value={AUTO_MANAGER}>
                      <ManagerLabel
                        name={ONLINE_MANAGER_NAME}
                        commission={false}
                        note="se crea sola"
                      />
                    </SelectItem>
                  )}
                  {strayManager ? (
                    <SelectItem value={strayManager}>
                      <span className="text-muted-foreground">Un gestor dado de baja</span>
                    </SelectItem>
                  ) : null}
                  {ordered.map((manager) => (
                    <SelectItem key={manager.id} value={manager.id}>
                      <ManagerLabel name={manager.name} commission={manager.commission} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {selectedManager?.commission ? (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-text text-pretty">
              {selectedManager.name} cobra comisión ($$): cada venta online le va a sumar comisión.
              Los socios decidieron que las reservas online queden a nombre de «
              {ONLINE_MANAGER_NAME}», que no cobra.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground text-pretty">
              «{ONLINE_MANAGER_NAME}» no cobra comisión: así lo decidieron los socios. Los que
              tienen{' '}
              <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                $$
              </span>{' '}
              cobran comisión por cada reserva.
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-end">
          {isDirty ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 sm:h-9"
              disabled={pending}
              onClick={() => form.reset()}
            >
              Descartar cambios
            </Button>
          ) : null}
          <Button type="submit" className="h-11 sm:h-10" disabled={pending || !isDirty}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Guardando…' : isDirty ? 'Guardar configuración' : 'Sin cambios'}
          </Button>
        </div>
      </form>
    </section>
  )
}

function FieldMessage({ error, hint }: { error?: string; hint?: string }) {
  if (error) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {error}
      </p>
    )
  }
  return hint ? <p className="text-xs text-muted-foreground text-pretty">{hint}</p> : null
}

/** Un gestor en el combo: «$$» si cobra comisión (el mismo chip de Reservas). */
function ManagerLabel({
  name,
  commission,
  note,
}: {
  name: string
  commission: boolean
  note?: string
}) {
  return (
    <span className="flex items-center gap-2">
      {name}
      {commission ? (
        <span
          className="rounded-full bg-amber-100 px-1.5 py-0 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
          title="Cobra comisión"
        >
          $$
          <span className="sr-only"> (cobra comisión)</span>
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">sin comisión</span>
      )}
      {note ? <span className="text-[11px] text-muted-foreground">· {note}</span> : null}
    </span>
  )
}
