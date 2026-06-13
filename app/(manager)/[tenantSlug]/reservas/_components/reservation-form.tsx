'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import {
  Cake,
  Calendar,
  Clock,
  GlassWater,
  HandHeart,
  MessageCircle,
  Minus,
  Plus,
  Search,
  Sparkles,
  User as UserIcon,
  Users,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
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
import { calculateCommission, type RateTier } from '@/lib/commissions/calculate'
import { type CustomerSearchResult, searchCustomers } from '@/lib/customers/search'
import type { HubEventOption } from '@/lib/events/queries'
import { createSalonReservation, updateSalonReservation } from '@/lib/salon/actions'
import { fetchDayCapacity, fetchScheduledEventsForDate } from '@/lib/salon/client-actions'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import { type CreateSalonReservationInput, createSalonReservationSchema } from '@/lib/salon/schemas'
import { QuickTemplateDialog } from './quick-template-dialog'

type ReservationFormInput = CreateSalonReservationInput

import {
  type DayCapacityBucket,
  MEAL_TYPE_LABELS,
  type MealType,
  ORIGIN_LABELS,
  RESERVATION_KIND_LABELS,
  type ReservationKind,
  type ReservationManagerRow,
  type ReservationOrigin,
  type SalonZone,
  type ScheduledEventTemplateRow,
} from '@/lib/salon/types'
import { cn } from '@/lib/utils'

type Props = {
  mode: 'create' | 'edit'
  tenantSlug: string
  initialDate: string
  managers: ReservationManagerRow[]
  templates: ScheduledEventTemplateRow[]
  initialEventsForDate: ScheduledEventWithTemplate[]
  hubEvents: HubEventOption[]
  rateTiers: RateTier[]
  bonusPerGuestCents: number
  // Edit mode props
  reservationId?: string
  initialValues?: Partial<ReservationFormInput> & {
    actual_guests?: number | null
  }
}

// 'hub_event' (asociar a un evento de la tabla `events`) quedó retirado: los
// eventos viven ahora en el Calendario (scheduled_events) y la reserva se asocia
// vía zona "event_floating". El enum/esquema lo siguen aceptando por compatibilidad.
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner']
const ORIGINS: ReservationOrigin[] = [
  'whatsapp',
  'instagram',
  'messenger',
  'in_person',
  'partner_referral',
]
const ZONES: SalonZone[] = ['planta_alta', 'planta_baja', 'event_floating']
const KINDS: ReservationKind[] = ['normal', 'birthday', 'special']

function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

function quickChips(today: string): Array<{ label: string; date: string }> {
  const base = new Date(`${today}T12:00:00Z`)
  const out: Array<{ label: string; date: string }> = []
  const fmt = (d: Date) => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Cordoba',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  }
  out.push({ label: 'Hoy', date: today })
  const tomorrow = new Date(base.getTime() + 24 * 3600 * 1000)
  out.push({ label: 'Mañana', date: fmt(tomorrow) })
  // próximo viernes / sábado
  for (let i = 2; i <= 9; i++) {
    const d = new Date(base.getTime() + i * 24 * 3600 * 1000)
    const dow = d.getUTCDay() // 0=Sun ... 5=Fri 6=Sat
    if (dow === 5) {
      out.push({ label: 'Viernes', date: fmt(d) })
      break
    }
  }
  for (let i = 2; i <= 9; i++) {
    const d = new Date(base.getTime() + i * 24 * 3600 * 1000)
    const dow = d.getUTCDay()
    if (dow === 6) {
      out.push({ label: 'Sábado', date: fmt(d) })
      break
    }
  }
  return out
}

function eventLocalDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}
function eventLocalTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Cordoba',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}
function eventDateShort(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Cordoba',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso))
}

export function ReservationForm({
  mode,
  tenantSlug,
  initialDate,
  managers,
  templates: templatesProp,
  initialEventsForDate,
  hubEvents,
  rateTiers,
  bonusPerGuestCents,
  reservationId,
  initialValues,
}: Props) {
  const router = useRouter()
  const [templates, setTemplates] = useState<ScheduledEventTemplateRow[]>(templatesProp)
  const [submitting, startSubmit] = useTransition()
  const [, startCapacity] = useTransition()
  const [, startEvents] = useTransition()

  // localStorage default: último gestor usado
  const lastManagerKey = `salon:last-manager:${tenantSlug}`

  const defaultPrimary = (() => {
    if (initialValues?.primary_manager_id) return initialValues.primary_manager_id
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(lastManagerKey)
      if (saved && managers.some((m) => m.id === saved)) return saved
    }
    return managers[0]?.id ?? ''
  })()

  const form = useForm<ReservationFormInput>({
    resolver: zodResolver(createSalonReservationSchema) as never,
    defaultValues: {
      guest_name: '',
      guest_phone: undefined,
      guest_email: undefined,
      customer_id: undefined,
      kind: 'normal',
      meal_type: 'dinner',
      reservation_date: initialDate,
      reservation_time_local: '21:30',
      zone: 'planta_alta',
      scheduled_event_id: undefined,
      hub_event_id: initialValues?.hub_event_id ?? undefined,
      requested_template_id: undefined,
      estimated_guests: 2,
      cake_count: 0,
      champagne_count: 0,
      deposit_cents: 0,
      origin: 'whatsapp',
      primary_manager_id: defaultPrimary,
      assistant_manager_id: undefined,
      comments: undefined,
      ...initialValues,
    },
  })

  const values = form.watch()
  const [eventsForDate, setEventsForDate] =
    useState<ScheduledEventWithTemplate[]>(initialEventsForDate)
  const [capacity, setCapacity] = useState<DayCapacityBucket[]>([])

  // Refetch eventos cuando cambia la fecha
  useEffect(() => {
    if (values.reservation_date === initialDate) {
      setEventsForDate(initialEventsForDate)
      return
    }
    startEvents(async () => {
      const r = await fetchScheduledEventsForDate(tenantSlug, values.reservation_date)
      if (r.ok) setEventsForDate(r.events)
    })
  }, [values.reservation_date, initialDate, initialEventsForDate, tenantSlug])

  // Refetch capacidad cuando cambia fecha (debounced trivial)
  const lastFetchedDate = useRef('')
  useEffect(() => {
    if (!values.reservation_date) return
    if (lastFetchedDate.current === values.reservation_date) return
    lastFetchedDate.current = values.reservation_date
    startCapacity(async () => {
      const r = await fetchDayCapacity(tenantSlug, values.reservation_date)
      if (r.ok) setCapacity(r.buckets)
    })
  }, [values.reservation_date, tenantSlug])

  // Auto-clear scheduled_event_id si zona no es event_floating
  useEffect(() => {
    if (values.zone !== 'event_floating' && values.scheduled_event_id) {
      form.setValue('scheduled_event_id', undefined)
    }
  }, [values.zone, values.scheduled_event_id, form])

  // Auto-clear requested_template_id si kind=normal
  useEffect(() => {
    if (values.kind === 'normal' && values.requested_template_id) {
      form.setValue('requested_template_id', undefined)
    }
  }, [values.kind, values.requested_template_id, form])

  // Bucket activo según los datos del form
  const activeBucket = useMemo<DayCapacityBucket | null>(() => {
    // Sujeta a evento → bucket del evento elegido
    if (values.zone === 'event_floating' && values.scheduled_event_id) {
      return capacity.find((b) => b.bucket === `event:${values.scheduled_event_id}`) ?? null
    }
    // Reserva especial con formato pedido → si existe instance del template ese día,
    // mostrar bucket de esa instance. Si va a crear ad-hoc, no hay bucket aún.
    if (values.requested_template_id) {
      const existing = eventsForDate.find((e) => e.template?.id === values.requested_template_id)
      if (existing) {
        return capacity.find((b) => b.bucket === `event:${existing.id}`) ?? null
      }
      return null
    }
    if (values.zone === 'planta_alta' || values.zone === 'planta_baja') {
      return capacity.find((b) => b.bucket === `zone:${values.zone}`) ?? null
    }
    return null
  }, [
    values.zone,
    values.scheduled_event_id,
    values.requested_template_id,
    capacity,
    eventsForDate,
  ])

  // Preview de comisión client-side
  const commissionPreviewCents = useMemo(() => {
    const primary = managers.find((m) => m.id === values.primary_manager_id)
    const assistant = values.assistant_manager_id
      ? (managers.find((m) => m.id === values.assistant_manager_id) ?? null)
      : null
    const event = values.scheduled_event_id
      ? (eventsForDate.find((e) => e.id === values.scheduled_event_id) ?? null)
      : null
    const eventInfo = event
      ? {
          capacity: event.capacity,
          // total_used vs capacity para activar bonus
          total_used: (() => {
            const b = capacity.find((x) => x.bucket === `event:${event.id}`)
            // Sumamos la reserva propia al used si ya estaba activa
            const used = (b?.used ?? 0) + (mode === 'create' ? values.estimated_guests : 0)
            return used
          })(),
          full_bonus_active: event.full_bonus_active,
        }
      : null
    const entries = calculateCommission(
      {
        guests: values.estimated_guests,
        meal_type: values.meal_type,
        primary: { id: values.primary_manager_id || 'x', eligible: !!primary?.commission_eligible },
        assistant: assistant
          ? { id: assistant.id, eligible: !!assistant.commission_eligible }
          : null,
        scheduledEvent: eventInfo,
        status: 'closed',
      },
      rateTiers,
      bonusPerGuestCents,
    )
    return entries.reduce((acc, e) => acc + e.payable_cents, 0)
  }, [
    values.primary_manager_id,
    values.assistant_manager_id,
    values.scheduled_event_id,
    values.estimated_guests,
    values.meal_type,
    managers,
    eventsForDate,
    capacity,
    rateTiers,
    bonusPerGuestCents,
    mode,
  ])

  // Submit
  const onSubmit = form.handleSubmit(
    (data) => {
      if (typeof window !== 'undefined' && data.primary_manager_id) {
        window.localStorage.setItem(lastManagerKey, data.primary_manager_id)
      }
      startSubmit(async () => {
        const action =
          mode === 'create'
            ? createSalonReservation(tenantSlug, data as Record<string, unknown>)
            : updateSalonReservation(tenantSlug, {
                ...data,
                id: reservationId,
              } as Record<string, unknown>)
        const result = await action
        if (result.ok) {
          toast.success(
            result.message ?? (mode === 'create' ? 'Reserva creada.' : 'Reserva actualizada.'),
          )
          if (mode === 'create' && result.data?.id) {
            router.push(`/${tenantSlug}/reservas/${result.data.id}`)
          } else {
            router.push(`/${tenantSlug}/reservas`)
            router.refresh()
          }
        } else {
          toast.error(result.message)
          if (result.field) {
            form.setError(result.field as keyof ReservationFormInput, { message: result.message })
          }
        }
      })
    },
    (errors) => {
      // Nombrar los campos que fallaron (antes el toast era genérico y no se
      // sabía cuál corregir — típicamente Cliente o Gestor sin completar).
      const LABELS: Record<string, string> = {
        guest_name: 'Cliente / nombre',
        guest_phone: 'Teléfono',
        guest_email: 'Email',
        meal_type: 'Servicio',
        reservation_date: 'Fecha',
        reservation_time_local: 'Horario',
        zone: 'Zona',
        scheduled_event_id: 'Evento programado',
        requested_template_id: 'Formato pedido',
        estimated_guests: 'Comensales',
        cake_count: 'Tortas',
        champagne_count: 'Champagne',
        deposit_cents: 'Seña',
        primary_manager_id: 'Gestor',
        assistant_manager_id: 'Asistente',
        comments: 'Comentarios',
      }
      const fields = Object.keys(errors).map((k) => LABELS[k] ?? k)
      const shown = fields.slice(0, 3).join(', ')
      const extra = fields.length > 3 ? ` y ${fields.length - 3} más` : ''
      toast.error(
        fields.length > 0
          ? `Falta completar o corregir: ${shown}${extra}.`
          : 'Revisá los campos marcados en rojo antes de guardar.',
      )
    },
  )

  // Cmd+Enter submit
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onSubmit()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSubmit])

  const chips = quickChips(initialDate)

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Cliente */}
      <FieldGroup title="Cliente" icon={UserIcon}>
        <CustomerCombobox
          tenantSlug={tenantSlug}
          value={{
            customer_id: values.customer_id,
            guest_name: values.guest_name,
            guest_phone: values.guest_phone ?? null,
            guest_email: values.guest_email ?? null,
          }}
          onChange={(v) => {
            form.setValue('customer_id', v.customer_id, { shouldValidate: true })
            form.setValue('guest_name', v.guest_name, { shouldValidate: true })
            form.setValue('guest_phone', v.guest_phone ?? undefined, { shouldValidate: true })
            form.setValue('guest_email', v.guest_email ?? undefined)
          }}
          error={form.formState.errors.guest_name?.message}
        />
      </FieldGroup>

      {/* Fecha + horario */}
      <FieldGroup title="Cuándo" icon={Calendar}>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-2">
            <Label
              htmlFor="reservation_date"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Fecha
            </Label>
            <Input
              id="reservation_date"
              type="date"
              aria-invalid={!!form.formState.errors.reservation_date}
              {...form.register('reservation_date')}
              className="h-11 text-base"
            />
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <button
                  type="button"
                  key={c.label}
                  onClick={() =>
                    form.setValue('reservation_date', c.date, { shouldValidate: true })
                  }
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    values.reservation_date === c.date
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:bg-secondary',
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="reservation_time_local"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Horario
            </Label>
            <div className="relative">
              <Clock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="reservation_time_local"
                type="time"
                step={900}
                aria-invalid={!!form.formState.errors.reservation_time_local}
                {...form.register('reservation_time_local')}
                className="h-11 pl-9 text-base tabular-nums"
              />
            </div>
          </div>
        </div>
      </FieldGroup>

      {/* Tipo de comida */}
      <FieldGroup title="Tipo de servicio" icon={Sparkles}>
        <Segmented
          options={MEAL_TYPES.map((m) => ({ value: m, label: MEAL_TYPE_LABELS[m] }))}
          value={values.meal_type}
          onChange={(v) => form.setValue('meal_type', v as MealType, { shouldValidate: true })}
        />
      </FieldGroup>

      {/* Zona */}
      <FieldGroup title="Dónde se sienta" icon={Users}>
        <div className="grid gap-2 sm:grid-cols-3">
          {ZONES.map((z) => {
            const isActive = values.zone === z
            const label =
              z === 'planta_alta'
                ? 'Planta Alta'
                : z === 'planta_baja'
                  ? 'Planta Baja'
                  : 'Sujeta a evento'
            return (
              <button
                type="button"
                key={z}
                onClick={() => form.setValue('zone', z, { shouldValidate: true })}
                className={cn(
                  'flex h-16 flex-col items-center justify-center rounded-xl border text-sm font-medium transition-all',
                  isActive
                    ? 'border-primary bg-primary/10 text-foreground shadow-inner'
                    : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
                )}
              >
                {label}
                {z === 'event_floating' ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Capacidad del evento
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        {form.formState.errors.zone?.message ? (
          <p className="text-sm text-destructive">{form.formState.errors.zone.message}</p>
        ) : null}
      </FieldGroup>

      {/* Tipo de reserva */}
      <FieldGroup title="Naturaleza" icon={HandHeart}>
        <Segmented
          options={KINDS.map((k) => ({ value: k, label: RESERVATION_KIND_LABELS[k] }))}
          value={values.kind}
          onChange={(v) => form.setValue('kind', v as ReservationKind, { shouldValidate: true })}
        />
      </FieldGroup>

      {/* CALENDARIZADO: evento programado del día (zone=event_floating) */}
      <AnimatePresence initial={false}>
        {values.zone === 'event_floating' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <FieldGroup title="Evento programado del día" icon={Sparkles}>
              <p className="text-xs text-muted-foreground">
                Elegí a qué evento ya programado del día se suma esta reserva.
              </p>
              <Select
                value={values.scheduled_event_id ?? ''}
                onValueChange={(v) =>
                  form.setValue('scheduled_event_id', v || undefined, { shouldValidate: true })
                }
              >
                <SelectTrigger
                  className="h-11 text-base"
                  aria-invalid={!!form.formState.errors.scheduled_event_id}
                >
                  <SelectValue placeholder="Elegí un evento del día…" />
                </SelectTrigger>
                <SelectContent>
                  {eventsForDate.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No hay eventos programados para esta fecha.{' '}
                      <a
                        href={`/${tenantSlug}/eventos/programados`}
                        target="_blank"
                        rel="noopener"
                        className="text-primary underline"
                      >
                        Programar uno
                      </a>
                    </div>
                  ) : (
                    eventsForDate.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        <span className="flex items-center gap-2">
                          {e.template?.color_hex ? (
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: e.template.color_hex }}
                              aria-hidden
                            />
                          ) : null}
                          {e.name_override ?? e.template?.name ?? 'Evento'}{' '}
                          <span className="text-xs text-muted-foreground">
                            · {e.starts_at_local.slice(0, 5)} · cap {e.capacity}
                          </span>
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {form.formState.errors.scheduled_event_id?.message ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.scheduled_event_id.message}
                </p>
              ) : null}
            </FieldGroup>
          </motion.div>
        )}
      </AnimatePresence>

      {/* EVENTO HUB: asociar a un evento publicado del calendario */}
      <AnimatePresence initial={false}>
        {values.meal_type === 'hub_event' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <FieldGroup title="Evento del calendario" icon={Sparkles}>
              <p className="text-xs text-muted-foreground">
                Asociá esta reserva a un evento publicado. Las personas cuentan contra el cupo del
                evento; si está lleno entra a lista de espera.
              </p>
              <Select
                value={values.hub_event_id ?? ''}
                onValueChange={(v) => {
                  form.setValue('hub_event_id', v || undefined, { shouldValidate: true })
                  const ev = hubEvents.find((e) => e.id === v)
                  if (ev) {
                    form.setValue('reservation_date', eventLocalDate(ev.starts_at), {
                      shouldValidate: true,
                    })
                    form.setValue('reservation_time_local', eventLocalTime(ev.starts_at), {
                      shouldValidate: true,
                    })
                  }
                }}
              >
                <SelectTrigger className="h-11 text-base">
                  <SelectValue placeholder="Elegí un evento…" />
                </SelectTrigger>
                <SelectContent>
                  {hubEvents.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No hay eventos publicados próximos.{' '}
                      <a
                        href={`/${tenantSlug}/eventos/programados`}
                        target="_blank"
                        rel="noopener"
                        className="text-primary underline"
                      >
                        Ir al calendario
                      </a>
                    </div>
                  ) : (
                    hubEvents.map((e) => {
                      const remaining =
                        e.capacity == null ? null : Math.max(0, e.capacity - e.confirmed_seats)
                      const full = remaining !== null && remaining <= 0
                      return (
                        <SelectItem key={e.id} value={e.id} disabled={full && !e.waitlist_enabled}>
                          <span className="flex items-center gap-2">
                            {e.name}
                            <span className="text-xs text-muted-foreground">
                              · {eventDateShort(e.starts_at)} {eventLocalTime(e.starts_at)}
                              {remaining === null
                                ? ''
                                : full
                                  ? e.waitlist_enabled
                                    ? ' · lleno (lista de espera)'
                                    : ' · lleno'
                                  : ` · ${remaining} lugares`}
                            </span>
                          </span>
                        </SelectItem>
                      )
                    })
                  )}
                </SelectContent>
              </Select>
              {form.formState.errors.hub_event_id?.message ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.hub_event_id.message}
                </p>
              ) : null}
            </FieldGroup>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ESPECIAL: formato pedido (cumple/recibida que pide Sushi/Pizza/Ramen) */}
      <AnimatePresence initial={false}>
        {(values.kind === 'birthday' || values.kind === 'special') && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <FieldGroup title="¿Piden formato calendarizado?" icon={Sparkles}>
              <p className="text-xs text-muted-foreground">
                Si el cumple / recibida pide Sushi Libre, Pizza Libre, Ramen u otro formato del
                catálogo. Si ya hay ese evento programado ese día, se suma; si no, se crea
                automáticamente un evento ad-hoc para ese cliente.
              </p>
              <Select
                value={values.requested_template_id ?? '__none__'}
                onValueChange={(v) =>
                  form.setValue('requested_template_id', v === '__none__' ? undefined : v, {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger className="h-11 text-base">
                  <SelectValue placeholder="Sin formato (cena normal)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin formato — cena normal</SelectItem>
                  {templates.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No hay templates configurados.{' '}
                      <a
                        href={`/${tenantSlug}/eventos/templates`}
                        target="_blank"
                        rel="noopener"
                        className="text-primary underline"
                      >
                        Crear uno
                      </a>
                    </div>
                  ) : (
                    templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: t.color_hex }}
                            aria-hidden
                          />
                          {t.name}
                          {t.default_capacity ? (
                            <span className="text-xs text-muted-foreground">
                              · cap {t.default_capacity}
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <div className="flex justify-end">
                <QuickTemplateDialog
                  tenantSlug={tenantSlug}
                  defaultMealType={values.meal_type}
                  onCreated={(tpl) => {
                    setTemplates((prev) =>
                      [...prev, tpl].sort((a, b) => a.name.localeCompare(b.name)),
                    )
                    form.setValue('requested_template_id', tpl.id, { shouldValidate: true })
                  }}
                />
              </div>
              {values.requested_template_id ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  ✓ {(() => {
                    const tpl = templates.find((t) => t.id === values.requested_template_id)
                    const existing = eventsForDate.find(
                      (e) => e.template?.id === values.requested_template_id,
                    )
                    if (existing) {
                      return `Se suma al ${tpl?.name} ya programado (${existing.starts_at_local.slice(0, 5)} · cap ${existing.capacity}).`
                    }
                    return `${tpl?.name} no está programado ese día — se crea ad-hoc al guardar.`
                  })()}
                </p>
              ) : null}
              {form.formState.errors.requested_template_id?.message ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.requested_template_id.message}
                </p>
              ) : null}
            </FieldGroup>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cantidad + capacidad */}
      <FieldGroup title="Cantidad de personas" icon={Users}>
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <GuestStepper
            value={values.estimated_guests}
            onChange={(v) => form.setValue('estimated_guests', v, { shouldValidate: true })}
          />
          <CapacityMeter
            bucket={activeBucket}
            guestsToAdd={mode === 'create' ? values.estimated_guests : 0}
          />
        </div>
      </FieldGroup>

      {/* Cumpleaños extras (condicional) */}
      <AnimatePresence initial={false}>
        {values.kind === 'birthday' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <FieldGroup title="Cumpleaños" icon={Cake}>
              <div className="grid gap-3 sm:grid-cols-2">
                <BringsItemControl
                  icon={Cake}
                  label="¿Traen torta?"
                  value={values.cake_count}
                  onChange={(v) => form.setValue('cake_count', v)}
                />
                <BringsItemControl
                  icon={GlassWater}
                  label="¿Traen champagne?"
                  value={values.champagne_count}
                  onChange={(v) => form.setValue('champagne_count', v)}
                />
              </div>
            </FieldGroup>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gestor + asistente */}
      <FieldGroup title="Quién gestionó" icon={UserIcon}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Gestor principal
            </Label>
            <Select
              value={values.primary_manager_id}
              onValueChange={(v) =>
                form.setValue('primary_manager_id', v, { shouldValidate: true })
              }
            >
              <SelectTrigger
                className="h-11"
                aria-invalid={!!form.formState.errors.primary_manager_id}
              >
                <SelectValue placeholder="Elegí un gestor" />
              </SelectTrigger>
              <SelectContent>
                {managers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="flex items-center gap-2">
                      {m.display_name}
                      {m.commission_eligible ? (
                        <span
                          className="rounded-full bg-amber-100 px-1.5 py-0 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                          title="Cobra comisión"
                        >
                          $$
                        </span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.primary_manager_id?.message ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.primary_manager_id.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Asistente (opcional)
            </Label>
            <Select
              value={values.assistant_manager_id ?? '__none__'}
              onValueChange={(v) =>
                form.setValue('assistant_manager_id', v === '__none__' ? undefined : v, {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Nadie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Nadie</SelectItem>
                {managers
                  .filter((m) => m.id !== values.primary_manager_id)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.display_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Si suman dos comisionables, se splittea 50/50.
            </p>
          </div>
        </div>
      </FieldGroup>

      {/* Origen */}
      <FieldGroup title="Cómo llegó la reserva" icon={MessageCircle}>
        <Segmented
          options={ORIGINS.map((o) => ({ value: o, label: ORIGIN_LABELS[o] }))}
          value={values.origin}
          onChange={(v) =>
            form.setValue('origin', v as ReservationOrigin, { shouldValidate: true })
          }
        />
      </FieldGroup>

      {/* Seña + comentarios */}
      <FieldGroup title="Extras" icon={Sparkles}>
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <div className="space-y-1.5">
            <Label
              htmlFor="deposit_cents"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Seña (ARS)
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="deposit_cents"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                placeholder="0"
                value={values.deposit_cents > 0 ? Math.round(values.deposit_cents / 100) : ''}
                onChange={(e) =>
                  form.setValue('deposit_cents', Math.max(0, Number(e.target.value) * 100), {
                    shouldValidate: true,
                  })
                }
                className="h-11 pl-7 text-base tabular-nums"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="comments"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Comentarios
            </Label>
            <Textarea
              id="comments"
              {...form.register('comments')}
              placeholder="Vegetarianos, alergias, promos ofrecidas, etc."
              rows={3}
            />
          </div>
        </div>
      </FieldGroup>

      {/* Footer: comisión + submit */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/90 px-4 py-3 shadow-lg backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm dark:bg-amber-950/40">
            <span className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Comisión estimada
            </span>
            <div className="font-mono text-base font-semibold text-amber-900 dark:text-amber-100 tabular-nums">
              {commissionPreviewCents > 0 ? ARSFormat(commissionPreviewCents) : '—'}
            </div>
          </div>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Atajo: ⌘/Ctrl + Enter para confirmar
          </p>
        </div>
        <Button type="submit" disabled={submitting} className="min-w-[160px] h-11 text-base">
          {submitting ? 'Guardando…' : mode === 'create' ? 'Crear reserva' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}

// ──────────────────────────────────────────────────────────
// Subcomponentes
// ──────────────────────────────────────────────────────────

function FieldGroup({
  title,
  icon: Icon,
  children,
}: {
  title: string
  // biome-ignore lint/suspicious/noExplicitAny: lucide icon type
  icon: any
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4 sm:p-5">
      <header className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="font-serif text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isActive = value === opt.value
        return (
          <button
            type="button"
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
              isActive
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function GuestStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex h-14 items-center rounded-xl border border-border bg-card/60">
      <button
        type="button"
        aria-label="Quitar"
        onClick={() => onChange(Math.max(1, value - 1))}
        className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary/60 active:bg-secondary"
      >
        <Minus className="size-4" />
      </button>
      <div className="flex flex-1 flex-col items-center font-mono">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">personas</span>
      </div>
      <button
        type="button"
        aria-label="Agregar"
        onClick={() => onChange(Math.min(99, value + 1))}
        className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary/60 active:bg-secondary"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}

function BringsItemControl({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: lucide icon type
  icon: any
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const brings = value > 0
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(0)}
          className={cn(
            'h-10 rounded-lg border px-4 text-sm font-medium transition-all',
            !brings
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
          )}
        >
          No
        </button>
        <button
          type="button"
          onClick={() => onChange(value > 0 ? value : 1)}
          className={cn(
            'flex h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition-all',
            brings
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
          )}
        >
          <Icon className="size-4" />
          Sí
        </button>
      </div>
      <AnimatePresence initial={false}>
        {brings ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex items-center gap-3 pt-1">
              <span className="text-xs text-muted-foreground">Cantidad</span>
              <div className="flex h-10 items-center rounded-lg border border-border bg-card/60">
                <button
                  type="button"
                  aria-label="Quitar"
                  onClick={() => onChange(Math.max(1, value - 1))}
                  className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary/60"
                >
                  <Minus className="size-3.5" />
                </button>
                <span className="w-8 text-center font-mono text-base font-semibold tabular-nums">
                  {value}
                </span>
                <button
                  type="button"
                  aria-label="Agregar"
                  onClick={() => onChange(Math.min(2, value + 1))}
                  className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary/60"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <span className="text-[11px] text-muted-foreground">máx 2</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function CapacityMeter({
  bucket,
  guestsToAdd,
}: {
  bucket: DayCapacityBucket | null
  guestsToAdd: number
}) {
  if (!bucket) {
    return (
      <div className="flex h-14 items-center justify-center rounded-xl border border-dashed border-border/70 bg-card/40 px-4 text-xs text-muted-foreground">
        Elegí zona o evento para ver capacidad
      </div>
    )
  }
  const projected = bucket.used + guestsToAdd
  const pct = bucket.capacity > 0 ? Math.min(100, (projected / bucket.capacity) * 100) : 0
  const isOver = projected > bucket.capacity
  return (
    <div className="space-y-1.5 rounded-xl border border-border/60 bg-card/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Capacidad</span>
        <span
          className={cn(
            'font-mono text-sm tabular-nums',
            isOver ? 'text-rose-600 dark:text-rose-400' : 'text-foreground',
          )}
        >
          {projected} / {bucket.capacity}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <motion.div
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className={cn(
            'h-full rounded-full',
            isOver
              ? 'bg-rose-500'
              : projected >= bucket.capacity * 0.9
                ? 'bg-amber-500'
                : 'bg-emerald-500',
          )}
        />
      </div>
      {isOver ? (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">
          Vas a hacer overbooking de {projected - bucket.capacity} personas (se permite).
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {bucket.capacity - projected} {bucket.capacity - projected === 1 ? 'lugar' : 'lugares'}{' '}
          libres tras esta reserva.
        </p>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// CustomerCombobox: autocomplete contra el CRM
// ──────────────────────────────────────────────────────────

function CustomerCombobox({
  tenantSlug,
  value,
  onChange,
  error,
}: {
  tenantSlug: string
  value: {
    customer_id?: string
    guest_name: string
    guest_phone: string | null
    guest_email: string | null
  }
  onChange: (v: {
    customer_id?: string
    guest_name: string
    guest_phone: string | null
    guest_email: string | null
  }) => void
  error?: string
}) {
  const [results, setResults] = useState<CustomerSearchResult[]>([])
  const [, startSearch] = useTransition()
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (q.trim().length < 2) {
        setResults([])
        return
      }
      debounceRef.current = setTimeout(() => {
        startSearch(async () => {
          const r = await searchCustomers(tenantSlug, q)
          setResults(r)
          setOpen(true)
        })
      }, 200)
    },
    [tenantSlug],
  )

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="space-y-1.5">
          <Label
            htmlFor="guest_name"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Nombre del cliente
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="guest_name"
              autoComplete="off"
              aria-invalid={!!error}
              value={value.guest_name}
              onChange={(e) => {
                onChange({ ...value, guest_name: e.target.value, customer_id: undefined })
                search(e.target.value)
              }}
              onFocus={() => results.length > 0 && setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder="Buscar o escribir nombre…"
              className="h-11 pl-9 text-base"
            />
            {open && results.length > 0 ? (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
                {results.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => {
                      onChange({
                        customer_id: c.id,
                        guest_name: `${c.first_name} ${c.last_name}`.trim(),
                        guest_phone: c.phone,
                        guest_email: null,
                      })
                      setOpen(false)
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary"
                  >
                    <span className="truncate">
                      {c.first_name} {c.last_name}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">{c.phone}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {value.customer_id ? (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
              ✓ Cliente vinculado al CRM
            </p>
          ) : value.guest_name ? (
            <p className="text-[11px] text-muted-foreground">
              Reserva libre — no se vincula a cliente del CRM.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor="guest_phone"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Teléfono (opcional)
          </Label>
          <PhoneInput
            id="guest_phone"
            international
            defaultCountry="AR"
            placeholder="351 555 1234"
            value={value.guest_phone ?? undefined}
            onChange={(v) =>
              onChange({
                ...value,
                guest_phone: v ?? null,
                customer_id: undefined,
              })
            }
            className="hub-phone-input"
          />
          <p className="text-[11px] text-muted-foreground">
            Tocá la bandera si el cliente es de otro país.
          </p>
        </div>
      </div>
    </div>
  )
}
