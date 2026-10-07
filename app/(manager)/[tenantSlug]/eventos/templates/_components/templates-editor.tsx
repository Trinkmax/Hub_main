'use client'

import { Plus, Save, Settings2, Trash2 } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
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
import { upsertScheduledTemplate } from '@/lib/salon/actions'
import { TEMPLATE_PRIVATE_SWITCH } from '@/lib/salon/private-groups'
import { MEAL_TYPE_LABELS, type MealType, type ScheduledEventTemplateRow } from '@/lib/salon/types'

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

type Draft = Partial<ScheduledEventTemplateRow> & { _isNew?: boolean }

/**
 * El catálogo de formatos (pestaña «Formatos» del calendario): una tarjeta por
 * formato con sus campos a mano. En la compu cada formato es una fila; en el
 * celular, los campos se apilan.
 */
export function TemplatesEditor({
  tenantSlug,
  initial,
}: {
  tenantSlug: string
  initial: ScheduledEventTemplateRow[]
}) {
  const [drafts, setDrafts] = useState<Draft[]>(initial)
  const [pending, startTransition] = useTransition()

  function addNew() {
    setDrafts((prev) => [
      {
        _isNew: true,
        name: '',
        slug: '',
        color_hex: '#7c3aed',
        consume_special_reservations: true,
        default_meal_type: 'dinner',
        default_capacity: null,
        active: true,
        default_private_group: false,
      } as Draft,
      ...prev,
    ])
  }

  function patch(index: number, key: keyof Draft, value: unknown) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, [key]: value } : d)))
  }

  function save(index: number) {
    const d = drafts[index]
    if (!d) return
    if (!d.name || !d.slug) {
      toast.error('Poné un nombre y un slug para el formato.')
      return
    }
    startTransition(async () => {
      const r = await upsertScheduledTemplate(tenantSlug, {
        ...(d.id && !d._isNew ? { id: d.id } : {}),
        name: d.name,
        slug: d.slug,
        color_hex: d.color_hex ?? '#7c3aed',
        consume_special_reservations: d.consume_special_reservations ?? true,
        default_meal_type: d.default_meal_type ?? 'dinner',
        default_capacity: d.default_capacity,
        active: d.active ?? true,
        default_private_group: d.default_private_group ?? false,
      } as Record<string, unknown>)
      if (r.ok) {
        toast.success('Formato guardado.')
        if (d._isNew && r.data?.id) {
          setDrafts((prev) =>
            prev.map((x, i) =>
              i === index ? { ...x, id: r.data?.id as string, _isNew: false } : x,
            ),
          )
        }
      } else {
        toast.error(r.message)
      }
    })
  }

  function remove(index: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button onClick={addNew}>
          <Plus aria-hidden />
          Nuevo formato
        </Button>
      </div>
      {drafts.length === 0 ? (
        <EmptyState
          variant="dashed"
          icon={Settings2}
          title="Todavía no hay formatos"
          description="Un formato es lo que se repite: Sushi Libre, Pizza Libre, Ramen. Lo cargás una vez y lo programás en las fechas que quieras."
          action={
            <Button onClick={addNew}>
              <Plus aria-hidden />
              Crear el primero
            </Button>
          }
        />
      ) : null}
      {/* Las dos columnas de interruptores («Consume cupo» y «Grupos privados»)
          van `auto`, al ancho de su rótulo: con 120 px fijos cada una, entre
          768 y ~1080 px (la barra lateral abierta) Nombre y Slug quedaban en
          50 y 31 px y el «Guardar» se salía de la pantalla. */}
      {drafts.map((d, idx) => (
        <TemplateRow
          key={d.id ?? `new-${idx}`}
          draft={d}
          pending={pending}
          onPatch={(key, value) => patch(idx, key, value)}
          onSave={() => save(idx)}
          onDiscard={() => remove(idx)}
        />
      ))}
    </div>
  )
}

function TemplateRow({
  draft: d,
  pending,
  onPatch,
  onSave,
  onDiscard,
}: {
  draft: Draft
  pending: boolean
  onPatch: (key: keyof Draft, value: unknown) => void
  onSave: () => void
  onDiscard: () => void
}) {
  const colorId = useId()
  const name = d.name || 'formato nuevo'
  return (
    <Card
      padding="sm"
      className="grid items-end gap-3 sm:grid-cols-[2.5rem_1fr_1fr_8rem_10rem_auto_auto_auto]"
    >
      <div className="flex h-(--control-md) items-center justify-center sm:self-end">
        <label htmlFor={colorId} className="relative size-8 cursor-pointer">
          <span className="sr-only">Color de {name}</span>
          <span
            aria-hidden
            className="block size-8 rounded-full border border-border-strong"
            style={{ backgroundColor: d.color_hex ?? '#7c3aed' }}
          />
          <input
            id={colorId}
            type="color"
            value={d.color_hex ?? '#7c3aed'}
            onChange={(e) => onPatch('color_hex', e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
      <Field label="Nombre">
        <Input
          value={d.name ?? ''}
          onChange={(e) => onPatch('name', e.target.value)}
          placeholder="Pizza Libre"
        />
      </Field>
      <Field label="Slug">
        <Input
          value={d.slug ?? ''}
          onChange={(e) =>
            onPatch('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
          }
          placeholder="pizza-libre"
          pattern="[a-z0-9-]{2,40}"
        />
      </Field>
      <Field label="Cupo" optional>
        <NumberField
          value={d.default_capacity ?? null}
          min={1}
          steppers={false}
          placeholder="—"
          onValueChange={(n) => onPatch('default_capacity', n)}
        />
      </Field>
      <Field label="Servicio">
        <Select
          value={d.default_meal_type ?? 'dinner'}
          onValueChange={(v) => onPatch('default_meal_type', v as MealType)}
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
      <SwitchCell
        label="Consume cupo"
        sublabel="en cumples"
        title="Si se activa, una reserva «especial» que pide este formato consume del cupo del evento"
        checked={d.consume_special_reservations ?? true}
        onChange={(v) => onPatch('consume_special_reservations', v)}
        ariaLabel="Consume cupo en cumpleaños"
      />
      {/* «Se usa para grupos privados» (C1): solo decide cómo NACEN las
          fechas nuevas de este formato (Merienda Libre). */}
      <SwitchCell
        label={TEMPLATE_PRIVATE_SWITCH.stacked[0]}
        sublabel={TEMPLATE_PRIVATE_SWITCH.stacked[1]}
        title={TEMPLATE_PRIVATE_SWITCH.hint}
        checked={d.default_private_group ?? false}
        onChange={(v) => onPatch('default_private_group', v)}
        ariaLabel={TEMPLATE_PRIVATE_SWITCH.label}
      />
      <div className="flex h-(--control-md) items-center justify-end gap-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={onSave}
          disabled={pending}
          aria-label={`Guardar ${name}`}
          title="Guardar"
        >
          <Save aria-hidden />
        </Button>
        {d._isNew ? (
          <Button
            size="icon"
            variant="danger-ghost"
            onClick={onDiscard}
            aria-label={`Descartar ${name}`}
            title="Descartar"
          >
            <Trash2 aria-hidden />
          </Button>
        ) : null}
      </div>
    </Card>
  )
}

/** Un interruptor con su rótulo en dos renglones, centrado (columna angosta en la compu). */
function SwitchCell({
  label,
  sublabel,
  title,
  checked,
  onChange,
  ariaLabel,
}: {
  label: string
  sublabel: string
  title: string
  checked: boolean
  onChange: (v: boolean) => void
  ariaLabel: string
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 sm:flex-col sm:justify-center sm:gap-1 sm:text-center"
      title={title}
    >
      <span className="type-caption text-muted-foreground">
        {label} <span className="sm:block">{sublabel}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={ariaLabel} />
    </div>
  )
}
