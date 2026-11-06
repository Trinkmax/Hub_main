'use client'

import { CalendarClock, Loader2 } from 'lucide-react'
import { type FormEvent, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { saveSupplier } from '@/lib/purchasing/catalog-actions'
import { nextDeliveryDate, relativeDayLabel, weekdaysText } from '@/lib/purchasing/dates'
import type { supplierSchema } from '@/lib/purchasing/schemas'
import type { PurSupplier } from '@/lib/purchasing/types'
import { cn } from '@/lib/utils'
import {
  CatalogSheet,
  CatalogSheetBody,
  CatalogSheetFooter,
  SHEET_PRIMARY_BUTTON,
} from './catalog-sheet'
import { describedBy, FIELD_INPUT, Field, NumberStepper, WarningNote } from './form-bits'
import { WeekdayToggles } from './weekdays'

type SupplierInput = z.input<typeof supplierSchema>

/** Un proveedor como lo muestra la pantalla: con el WhatsApp ya formateado y sus insumos. */
export type SupplierView = PurSupplier & {
  /** «+54 9 351 123-4567» (lo arma el servidor desde los dígitos guardados). */
  whatsappDisplay: string | null
  /** Insumos activos que se le piden. */
  activeItems: number
  /** Los primeros, por nombre, para la ficha. */
  itemNames: string[]
}

type SupplierDraft = {
  name: string
  contact: string
  whatsapp: string
  days: number[]
  leadDays: number
  notes: string
  active: boolean
}

function toDraft(supplier: SupplierView | null): SupplierDraft {
  return {
    name: supplier?.name ?? '',
    contact: supplier?.contactName ?? '',
    whatsapp: supplier?.whatsappDisplay ?? '',
    days: [...(supplier?.deliveryWeekdays ?? [])].sort(),
    leadDays: supplier?.leadDays ?? 1,
    notes: supplier?.notes ?? '',
    active: supplier?.active ?? true,
  }
}

function signature(draft: SupplierDraft): string {
  return JSON.stringify({ ...draft, days: [...draft.days].sort() })
}

function daysLabel(n: number): string {
  return n === 1 ? '1 día' : `${n} días`
}

/** «Si pedís hoy, llega el jue 12/11.» Con los días y la anticipación que se están cargando. */
function deliveryPreview(today: string, days: readonly number[], leadDays: number): string {
  const date = nextDeliveryDate(today, days, leadDays)
  if (!date) return ''
  const label = relativeDayLabel(date, today)
  return label === 'hoy' || label === 'mañana'
    ? `Si pedís hoy, llega ${label}.`
    : `Si pedís hoy, llega el ${label}.`
}

/** La ficha del proveedor: a quién se le escribe, por dónde y qué días trae la mercadería. */
export function SupplierEditorSheet({
  tenantSlug,
  today,
  open,
  supplier,
  onClose,
  onSaved,
}: {
  tenantSlug: string
  /** Hoy en Córdoba (`yyyy-MM-dd`), para el «si pedís hoy, llega…». */
  today: string
  open: boolean
  supplier: SupplierView | null
  onClose: () => void
  onSaved: () => void
}) {
  const uid = useId()
  const [draft, setDraft] = useState<SupplierDraft>(() => toDraft(supplier))
  const [baseline, setBaseline] = useState(() => signature(toDraft(supplier)))
  const [submitted, setSubmitted] = useState(false)
  const [pending, startTransition] = useTransition()

  // Cada vez que se abre arranca de lo guardado.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      const fresh = toDraft(supplier)
      setDraft(fresh)
      setBaseline(signature(fresh))
      setSubmitted(false)
    }
  }

  const id = (field: string) => `${uid}-${field}`
  const set = <K extends keyof SupplierDraft>(key: K, value: SupplierDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))
  const dirty = signature(draft) !== baseline
  const nameError = submitted && !draft.name.trim() ? 'Poné el nombre del proveedor.' : null
  const preview = deliveryPreview(today, draft.days, draft.leadDays)
  const daysText = weekdaysText(draft.days)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    const name = draft.name.trim()
    if (!name) {
      document.getElementById(id('name'))?.focus()
      return
    }
    const payload: SupplierInput = {
      slug: tenantSlug,
      id: supplier?.id ?? null,
      name,
      contactName: draft.contact.trim() || null,
      whatsapp: draft.whatsapp.trim() || null,
      deliveryWeekdays: [...draft.days].sort(),
      leadDays: draft.leadDays,
      notes: draft.notes.trim() || null,
      active: draft.active,
    }
    startTransition(async () => {
      const result = await saveSupplier(payload)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(supplier ? 'Guardamos los cambios.' : `Agregamos a «${name}».`)
      onSaved()
    })
  }

  const items = supplier?.itemNames ?? []
  const itemCount = supplier?.activeItems ?? 0

  return (
    <CatalogSheet
      open={open}
      onClose={onClose}
      busy={pending}
      dirty={dirty}
      title={supplier ? supplier.name : 'Nuevo proveedor'}
      description={
        supplier
          ? 'Con el WhatsApp y los días de entrega, el pedido sale solo y se sabe cuándo llega.'
          : 'A quién le pedís, por dónde y qué días trae la mercadería.'
      }
    >
      <form noValidate onSubmit={submit} className="contents">
        <CatalogSheetBody>
          <Field id={id('name')} label="Nombre" error={nameError}>
            <Input
              id={id('name')}
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="Ej.: Distribuidora Norte"
              aria-invalid={Boolean(nameError)}
              aria-describedby={describedBy(id('name'), false, nameError)}
              className={FIELD_INPUT}
            />
          </Field>

          <Field id={id('contact')} label="Contacto" optional hint="Con quién se habla.">
            <Input
              id={id('contact')}
              value={draft.contact}
              onChange={(e) => set('contact', e.target.value)}
              maxLength={60}
              autoComplete="off"
              placeholder="Ej.: Juan"
              aria-describedby={describedBy(id('contact'), true, null)}
              className={FIELD_INPUT}
            />
          </Field>

          <div className="space-y-2">
            <Field
              id={id('whatsapp')}
              label="WhatsApp"
              hint="Con la característica, sin el 0 ni el 15. Si es de otro país, empezá con +."
            >
              <Input
                id={id('whatsapp')}
                type="tel"
                inputMode="tel"
                value={draft.whatsapp}
                onChange={(e) => set('whatsapp', e.target.value)}
                maxLength={30}
                autoComplete="off"
                placeholder="Ej.: 351 555 1234"
                aria-describedby={describedBy(id('whatsapp'), true, null)}
                className={cn(FIELD_INPUT, 'tabular-nums')}
              />
            </Field>
            {draft.whatsapp.trim() ? null : (
              <WarningNote>Sin WhatsApp no se abre el chat con el pedido.</WarningNote>
            )}
          </div>

          <div className="space-y-2">
            <WeekdayToggles
              legend="Días de entrega"
              value={draft.days}
              onChange={(days) => set('days', days)}
              describedById={id('days-hint')}
            />
            <p id={id('days-hint')} className="text-xs text-muted-foreground text-pretty">
              {daysText
                ? `Trae la mercadería ${daysText}.`
                : 'Tocá los días en que trae la mercadería.'}
            </p>
            {draft.days.length ? null : (
              <WarningNote>Sin días de entrega no se calcula cuándo llega.</WarningNote>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={id('lead')}>Hay que pedirle con</Label>
            <NumberStepper
              id={id('lead')}
              value={draft.leadDays}
              min={0}
              max={14}
              onChange={(value) => set('leadDays', value)}
              format={daysLabel}
              decreaseLabel="Un día menos de anticipación"
              increaseLabel="Un día más de anticipación"
              describedById={id('lead-hint')}
            />
            <p id={id('lead-hint')} className="text-xs text-muted-foreground text-pretty">
              1 = lo que pedís hoy llega desde mañana.
              {draft.leadDays === 0 ? ' 0 = puede llegar el mismo día.' : ''}
            </p>
            {preview ? (
              <p className="flex items-center gap-2 rounded-lg bg-secondary/70 px-3 py-2.5 text-sm">
                <CalendarClock className="size-4 shrink-0 text-primary" aria-hidden />
                {preview}
              </p>
            ) : null}
          </div>

          <Field id={id('notes')} label="Notas" optional>
            <Textarea
              id={id('notes')}
              value={draft.notes}
              onChange={(e) => set('notes', e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Pedido mínimo, horario para escribirle…"
            />
          </Field>

          {supplier ? (
            <section aria-labelledby={id('items')} className="space-y-1.5">
              <h3 id={id('items')} className="text-sm font-medium">
                {itemCount === 0
                  ? 'Todavía no le pedís nada'
                  : itemCount === 1
                    ? 'Le pedís 1 insumo'
                    : `Le pedís ${itemCount} insumos`}
              </h3>
              <p className="text-sm text-muted-foreground text-pretty">
                {itemCount === 0
                  ? 'Se lo asignás desde la ficha de cada insumo, en «Proveedor».'
                  : `${items.join(', ')}${itemCount > items.length ? ` y ${itemCount - items.length} más` : ''}.`}
              </p>
            </section>
          ) : null}

          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 p-4">
            <div className="space-y-1">
              <Label htmlFor={id('active')}>Activo</Label>
              <p className="text-xs text-muted-foreground text-pretty">
                {draft.active
                  ? 'Se le pueden mandar pedidos.'
                  : 'No se le mandan pedidos. Queda al final de la lista.'}
              </p>
            </div>
            <Switch
              id={id('active')}
              checked={draft.active}
              onCheckedChange={(checked) => set('active', checked)}
              className="mt-0.5"
            />
          </div>
        </CatalogSheetBody>

        <CatalogSheetFooter>
          <Button type="submit" disabled={pending} className={SHEET_PRIMARY_BUTTON}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {supplier ? 'Guardar proveedor' : 'Agregar proveedor'}
          </Button>
        </CatalogSheetFooter>
      </form>
    </CatalogSheet>
  )
}
