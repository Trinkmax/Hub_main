'use client'

import { Plus, Save, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
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
import { Switch } from '@/components/ui/switch'
import { upsertScheduledTemplate } from '@/lib/salon/actions'
import { MEAL_TYPE_LABELS, type MealType, type ScheduledEventTemplateRow } from '@/lib/salon/types'

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

type Draft = Partial<ScheduledEventTemplateRow> & { _isNew?: boolean }

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
      toast.error('Nombre y slug requeridos.')
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
      } as Record<string, unknown>)
      if (r.ok) {
        toast.success('Template guardado.')
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
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={addNew} className="gap-2">
          <Plus className="size-4" />
          Nuevo template
        </Button>
      </div>
      {drafts.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card/30 p-8 text-center text-sm text-muted-foreground">
          Sin templates todavía. Creá el primero.
        </p>
      ) : null}
      {drafts.map((d, idx) => (
        <div
          key={d.id ?? `new-${idx}`}
          className="grid gap-3 rounded-xl border bg-card/60 p-4 sm:grid-cols-[40px_1fr_1fr_120px_140px_120px_auto]"
        >
          <div className="flex items-center justify-center">
            <label className="relative size-8 cursor-pointer">
              <span
                className="block size-8 rounded-full border-2 border-white shadow-sm"
                style={{ backgroundColor: d.color_hex ?? '#7c3aed' }}
              />
              <input
                type="color"
                value={d.color_hex ?? '#7c3aed'}
                onChange={(e) => patch(idx, 'color_hex', e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-wide">Nombre</Label>
            <Input
              value={d.name ?? ''}
              onChange={(e) => patch(idx, 'name', e.target.value)}
              placeholder="Pizza Libre"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-wide">Slug</Label>
            <Input
              value={d.slug ?? ''}
              onChange={(e) =>
                patch(idx, 'slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
              }
              placeholder="pizza-libre"
              pattern="[a-z0-9-]{2,40}"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-wide">Cap default</Label>
            <Input
              type="number"
              min={1}
              value={d.default_capacity ?? ''}
              onChange={(e) =>
                patch(idx, 'default_capacity', e.target.value ? Number(e.target.value) : null)
              }
              placeholder="—"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-wide">Servicio</Label>
            <Select
              value={d.default_meal_type ?? 'dinner'}
              onValueChange={(v) => patch(idx, 'default_meal_type', v as MealType)}
            >
              <SelectTrigger className="h-9">
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
          </div>
          <div className="flex items-center justify-center">
            <div
              className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground"
              title="Si se activa, una reserva 'especial' que pide este template consume del cupo del evento"
            >
              <span>Consume cupo</span>
              <Switch
                checked={d.consume_special_reservations ?? true}
                onCheckedChange={(v) => patch(idx, 'consume_special_reservations', v)}
                aria-label="Consume cupo en cumpleaños"
              />
              <span className="text-[9px]">en cumples</span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => save(idx)}
              disabled={pending}
              aria-label="Guardar"
            >
              <Save className="size-4" />
            </Button>
            {d._isNew ? (
              <Button size="sm" variant="ghost" onClick={() => remove(idx)} aria-label="Descartar">
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
