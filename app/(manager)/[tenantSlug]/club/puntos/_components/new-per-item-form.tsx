'use client'

import { Plus } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Field } from '@/components/ui/field'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { categoryPathLabel } from '@/lib/menu/tree'
import { createPerItemRule } from '@/lib/points/actions'

type Mode = 'item' | 'category'

export function NewPerItemForm({
  tenantSlug,
  items,
  categories,
}: {
  tenantSlug: string
  items: MenuItem[]
  categories: MenuCategory[]
}) {
  const [mode, setMode] = useState<Mode>('category')
  const [targetId, setTargetId] = useState('')
  const [targetError, setTargetError] = useState<string | null>(null)
  const [points, setPoints] = useState<number | null>(5)
  const [priority, setPriority] = useState<number | null>(0)
  const [pending, start] = useTransition()

  // Solo categorías con ítems DIRECTOS: una regla por categoría solo puntúa esos
  // ítems (el motor no hereda a subcategorías), así que ofrecer un contenedor sin
  // ítems propios crearía una regla que nunca dispara.
  const leafCategories = categories.filter((c) => items.some((i) => i.category_id === c.id))
  const options =
    mode === 'category'
      ? leafCategories.map((c) => ({ value: c.id, label: categoryPathLabel(categories, c.id) }))
      : items.map((i) => ({ value: i.id, label: i.name }))

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!targetId) {
      setTargetError(mode === 'category' ? 'Elegí la categoría.' : 'Elegí el ítem.')
      return
    }
    if (points === null || points < 1) return
    start(async () => {
      const r = await createPerItemRule(tenantSlug, {
        mode,
        targetId,
        points,
        priority: priority ?? 0,
      })
      if (r.ok) {
        toast.success(r.message ?? 'Regla creada.')
        setTargetId('')
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4"
      aria-label="Regla por ítem o categoría"
    >
      <div className="grid items-start gap-4 sm:grid-cols-[9rem_minmax(0,1fr)_8rem_8rem]">
        <Field label="Tipo">
          <Select
            value={mode}
            onValueChange={(v) => {
              setMode(v as Mode)
              // Un id de categoría no sirve como ítem (ni al revés).
              setTargetId('')
              setTargetError(null)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="category">Categoría</SelectItem>
              <SelectItem value="item">Ítem</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={mode === 'category' ? 'Categoría' : 'Ítem'} required error={targetError}>
          <Combobox
            key={mode}
            options={options}
            value={targetId || null}
            onValueChange={(v) => {
              setTargetId(typeof v === 'string' ? v : '')
              setTargetError(null)
            }}
            placeholder="Elegí…"
            searchPlaceholder={mode === 'category' ? 'Buscar categoría…' : 'Buscar ítem…'}
            emptyText={
              mode === 'category'
                ? 'No hay categorías con ítems propios todavía.'
                : 'No hay ítems en la carta todavía.'
            }
          />
        </Field>
        <Field label="Puntos" required>
          <NumberField min={1} value={points} onValueChange={setPoints} />
        </Field>
        <Field label="Prioridad">
          <NumberField min={0} steppers={false} value={priority} onValueChange={setPriority} />
        </Field>
      </div>

      {mode === 'category' ? (
        <p className="max-w-prose type-caption text-pretty text-muted-foreground">
          La regla suma puntos solo por los ítems asignados <strong>directamente</strong> a esa
          categoría, no por los de sus subcategorías. Para puntuar una subcategoría, elegila a ella.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" variant="secondary" loading={pending} loadingText="Creando…">
          <Plus aria-hidden="true" />
          Crear regla
        </Button>
      </div>
    </form>
  )
}
