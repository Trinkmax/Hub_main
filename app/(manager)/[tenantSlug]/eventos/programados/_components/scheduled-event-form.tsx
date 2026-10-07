'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import { Field, FieldRow, FormSection } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { TimeField } from '@/components/ui/time-field'
import { todayInCordoba } from '@/lib/dates/zone'
import { deleteScheduledEvent, upsertScheduledEvent } from '@/lib/salon/actions'
import { PRIVATE_GROUP_SWITCH } from '@/lib/salon/private-groups'
import { type ScheduledEventInput, scheduledEventSchema } from '@/lib/salon/schemas'
import { MEAL_TYPE_LABELS, type MealType, type ScheduledEventTemplateRow } from '@/lib/salon/types'

type ScheduledEventFormInput = ScheduledEventInput

type Props = {
  tenantSlug: string
  mode: 'create' | 'edit'
  templates: ScheduledEventTemplateRow[]
  presetDate?: string
  /** Formato pre-elegido. Es el camino de mobile: se toca el chip del rail. */
  presetTemplateId?: string
  initialValues?: Partial<ScheduledEventFormInput> & { id?: string }
}

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

/** Solo hex: el color viene de la DB y va a un `style`. */
function safeColor(colorHex: string | null | undefined): string {
  return colorHex && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(colorHex)
    ? colorHex
    : 'var(--muted-foreground)'
}

/**
 * Programar (o editar) una fecha de un formato: Sushi Libre el sábado 27.
 * React Hook Form + zod, con los controles del kit: fecha y horas tipeables
 * (`DatePicker`, `TimeField`), números con `NumberField` y las acciones en la
 * barra fija del celular.
 */
export function ScheduledEventForm({
  tenantSlug,
  mode,
  templates,
  presetDate,
  presetTemplateId,
  initialValues,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const form = useForm<ScheduledEventFormInput>({
    resolver: zodResolver(scheduledEventSchema) as never,
    defaultValues: {
      template_id: templates[0]?.id ?? '',
      // Hoy en Córdoba (antes salía del reloj UTC: después de las 21 proponía mañana).
      event_date: presetDate ?? todayInCordoba(),
      ...(presetTemplateId ? { template_id: presetTemplateId } : {}),
      starts_at_local: '21:00',
      ends_at_local: undefined,
      capacity: templates[0]?.default_capacity ?? 40,
      meal_type: templates[0]?.default_meal_type ?? 'dinner',
      full_bonus_active: true,
      attendance_points: 0,
      name_override: undefined,
      notes: undefined,
      // Un alta nace como diga su formato («Se usa para grupos privados»).
      private_group:
        templates.find((t) => t.id === (presetTemplateId ?? templates[0]?.id))
          ?.default_private_group ?? false,
      ...initialValues,
    },
  })
  const errors = form.formState.errors

  // Auto-pisar capacity / meal_type al cambiar template
  const watchedTemplate = form.watch('template_id')
  useEffect(() => {
    const tpl = templates.find((t) => t.id === watchedTemplate)
    if (!tpl) return
    if (mode === 'create') {
      if (tpl.default_capacity) form.setValue('capacity', tpl.default_capacity)
      if (tpl.default_meal_type) form.setValue('meal_type', tpl.default_meal_type)
      // Como el cupo: cambiar de formato en un alta trae su default.
      form.setValue('private_group', tpl.default_private_group)
    }
  }, [watchedTemplate, templates, mode, form])

  /**
   * Segundo callback de `handleSubmit`. Sin esto, un error de validación es
   * SILENCIO ABSOLUTO: el socio tocaba "Guardar" desde el celular y no pasaba
   * nada. Además de marcar cada campo, el aviso dice cuáles faltan: desde
   * mobile este form es el único camino para programar un evento (el
   * drag-and-drop es solo >=sm).
   */
  const onInvalid = (invalid: Record<string, unknown>) => {
    const LABELS: Record<string, string> = {
      template_id: 'Formato',
      event_date: 'Fecha',
      starts_at_local: 'Hora de inicio',
      ends_at_local: 'Hora de fin',
      capacity: 'Cupo',
      meal_type: 'Servicio',
      attendance_points: 'Puntos por asistir',
      name_override: 'Nombre',
      notes: 'Notas',
      private_group: 'Grupo privado',
    }
    const fields = Object.keys(invalid).map((k) => LABELS[k] ?? k)
    toast.error(
      fields.length > 0
        ? `Falta completar o corregir: ${fields.slice(0, 3).join(', ')}${fields.length > 3 ? ` y ${fields.length - 3} más` : ''}.`
        : 'Revisá los campos antes de guardar.',
    )
  }

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
  }, onInvalid)

  async function onDelete() {
    if (!initialValues?.id) return
    const r = await deleteScheduledEvent(tenantSlug, initialValues.id)
    if (!r.ok) return { ok: false as const, error: r.message ?? 'No se pudo borrar el evento.' }
    toast.success('Evento borrado.')
    router.push(`/${tenantSlug}/eventos/programados`)
    router.refresh()
    return { ok: true as const }
  }

  const values = form.watch()

  return (
    <form onSubmit={onSubmit}>
      <FormSection title="Formato y fecha">
        <Field label="Formato" error={errors.template_id?.message}>
          <Select
            value={values.template_id}
            onValueChange={(v) => form.setValue('template_id', v, { shouldValidate: true })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Elegí un formato" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: safeColor(t.color_hex) }}
                    />
                    {t.name}
                    {t.default_capacity ? (
                      <span className="type-caption text-muted-foreground">
                        · cupo {t.default_capacity}
                      </span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Fecha" error={errors.event_date?.message}>
          <DatePicker
            value={values.event_date || null}
            required
            onValueChange={(iso) =>
              form.setValue('event_date', iso ?? '', { shouldValidate: iso !== null })
            }
          />
        </Field>

        <FieldRow>
          <Field label="Inicio" error={errors.starts_at_local?.message}>
            <TimeField
              value={values.starts_at_local || null}
              required
              onValueChange={(t) =>
                form.setValue('starts_at_local', t ?? '', { shouldValidate: t !== null })
              }
            />
          </Field>
          <Field label="Fin" optional error={errors.ends_at_local?.message}>
            <TimeField
              value={values.ends_at_local || null}
              crossesMidnight
              onValueChange={(t) =>
                form.setValue('ends_at_local', t ?? undefined, { shouldValidate: true })
              }
            />
          </Field>
        </FieldRow>
      </FormSection>

      <FormSection title="Cupo y servicio">
        <FieldRow>
          <Field label="Cupo" error={errors.capacity?.message}>
            <NumberField
              value={values.capacity ?? null}
              min={1}
              max={999}
              suffix="lugares"
              onValueChange={(n) => {
                if (n !== null) form.setValue('capacity', n, { shouldValidate: true })
              }}
            />
          </Field>
          <Field label="Servicio" error={errors.meal_type?.message}>
            <Select
              value={values.meal_type}
              onValueChange={(v) => form.setValue('meal_type', v as MealType)}
            >
              <SelectTrigger>
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
          </Field>
        </FieldRow>

        <Field
          label="Puntos por asistir"
          error={errors.attendance_points?.message}
          hint="Puntos de fidelización que suma el cliente cuando asiste (su reserva se marca sentada o cerrada). 0 = sin puntos."
          className="sm:max-w-60"
        >
          <NumberField
            value={values.attendance_points ?? 0}
            min={0}
            suffix="puntos"
            onValueChange={(n) => {
              if (n !== null) form.setValue('attendance_points', n, { shouldValidate: true })
            }}
          />
        </Field>
      </FormSection>

      <FormSection title="Extras">
        <Field label="Nombre propio" optional error={errors.name_override?.message}>
          <Input
            {...form.register('name_override')}
            placeholder="Sushi Libre San Valentín"
            maxLength={120}
          />
        </Field>

        <Field label="Notas internas" optional error={errors.notes?.message}>
          <Textarea {...form.register('notes')} rows={2} maxLength={500} />
        </Field>

        {/* «Grupo privado» (C1, 02/10): justo antes del bonus, con la misma forma.
            Deja la fecha fuera de «Cómo nos fue» y de sus pendientes de pauta;
            el cupo, el calendario y las comisiones no cambian. */}
        <Field layout="toggle" label={PRIVATE_GROUP_SWITCH.label} hint={PRIVATE_GROUP_SWITCH.hint}>
          <Switch
            checked={values.private_group ?? false}
            onCheckedChange={(v) => form.setValue('private_group', v, { shouldDirty: true })}
          />
        </Field>

        <Field
          layout="toggle"
          label="Bonus por evento lleno"
          hint="Si llega al 100 % del cupo, el gestor cobra el bonus extra por persona."
        >
          <Switch
            checked={values.full_bonus_active}
            onCheckedChange={(v) => form.setValue('full_bonus_active', v)}
          />
        </Field>
      </FormSection>

      {/* En la compu, aire y un pelo arriba (como entre secciones): sin eso los
          botones quedaban pegados al último interruptor, como parte de «Extras».
          En el celular la barra va fija abajo y trae su propio borde. */}
      <FormActions
        align={mode === 'edit' && initialValues?.id ? 'between' : 'end'}
        className="sm:mt-6 sm:border-t sm:border-border sm:pt-6"
      >
        {mode === 'edit' && initialValues?.id ? (
          <ConfirmDialog
            tone="danger"
            icon={Trash2}
            title="¿Borrar este evento programado?"
            description="Se borra de forma permanente y no se puede deshacer."
            confirmLabel="Borrar evento"
            pendingLabel="Borrando…"
            trigger={
              <Button type="button" variant="danger-ghost" disabled={pending}>
                <Trash2 aria-hidden />
                Borrar
              </Button>
            }
            onConfirm={onDelete}
          />
        ) : (
          <Button asChild variant="secondary" className="max-sm:hidden">
            <Link href={`/${tenantSlug}/eventos/programados`}>Cancelar</Link>
          </Button>
        )}
        <Button type="submit" loading={pending} loadingText="Guardando…">
          {mode === 'create' ? 'Programar' : 'Guardar cambios'}
        </Button>
      </FormActions>
    </form>
  )
}
