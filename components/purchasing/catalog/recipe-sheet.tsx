'use client'

import { Loader2 } from 'lucide-react'
import { type FormEvent, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { z } from 'zod'
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
import { Textarea } from '@/components/ui/textarea'
import { saveRecipe } from '@/lib/purchasing/catalog-actions'
import type { recipeSchema } from '@/lib/purchasing/schemas'
import type { PurRecipe } from '@/lib/purchasing/types'
import { cn } from '@/lib/utils'
import {
  CatalogSheet,
  CatalogSheetBody,
  CatalogSheetFooter,
  SHEET_PRIMARY_BUTTON,
} from './catalog-sheet'
import { describedBy, FIELD_INPUT, FIELD_SELECT, Field } from './form-bits'

type RecipeInput = z.input<typeof recipeSchema>

/** Un formato del calendario (`scheduled_event_templates`). */
export type FormatOption = { id: string; name: string; active: boolean }

/** Los datos de una receta sin sus insumos (lo que edita esta hoja). */
export type RecipeHeader = Pick<
  PurRecipe,
  'id' | 'templateId' | 'name' | 'variant' | 'baseGuests' | 'notes' | 'active'
>

/** Para avisar antes de guardar que el formato ya tiene esa variante. */
export type RecipeVariantRef = Pick<PurRecipe, 'id' | 'templateId' | 'variant'>

const NONE = '__none__'
const DEFAULT_VARIANT = 'Única'

type RecipeDraft = {
  templateId: string | null
  name: string
  variant: string
  guests: string
  notes: string
  active: boolean
}

function toDraft(
  recipe: RecipeHeader | null,
  defaults: { templateId: string | null; name: string; guests: number },
): RecipeDraft {
  return {
    templateId: recipe ? recipe.templateId : defaults.templateId,
    name: recipe ? recipe.name : defaults.name,
    variant: recipe ? recipe.variant : DEFAULT_VARIANT,
    guests: String(recipe ? recipe.baseGuests : defaults.guests),
    notes: recipe?.notes ?? '',
    active: recipe?.active ?? true,
  }
}

function parseGuests(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,4}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= 1000 ? n : null
}

function sameVariant(a: string, b: string) {
  return a.trim().toLocaleLowerCase('es-AR') === b.trim().toLocaleLowerCase('es-AR')
}

/**
 * Los datos de una receta: de qué formato del calendario es, su variante y para cuántas personas
 * están escritas las cantidades. Crea (`recipe = null`) o edita.
 */
export function RecipeSheet({
  tenantSlug,
  open,
  recipe,
  formats,
  variants,
  defaultGuests,
  presetTemplateId = null,
  onClose,
  onSaved,
}: {
  tenantSlug: string
  open: boolean
  recipe: RecipeHeader | null
  formats: readonly FormatOption[]
  /** Todas las recetas del bar (formato y variante), para no repetir una variante. */
  variants: readonly RecipeVariantRef[]
  /** Para cuántas personas se escriben las recetas en este bar (ajustes de Compras). */
  defaultGuests: number
  /** Una receta nueva para este formato («Cargar receta» de un formato sin receta). */
  presetTemplateId?: string | null
  onClose: () => void
  onSaved: (id: string, created: boolean) => void | Promise<void>
}) {
  const uid = useId()
  const formatById = new Map(formats.map((format) => [format.id, format]))
  const presetFormat = presetTemplateId ? formatById.get(presetTemplateId) : undefined
  const defaults = {
    templateId: presetFormat?.id ?? null,
    name: presetFormat?.name ?? '',
    guests: defaultGuests,
  }
  const [draft, setDraft] = useState<RecipeDraft>(() => toDraft(recipe, defaults))
  const [baseline, setBaseline] = useState(() => JSON.stringify(toDraft(recipe, defaults)))
  const [submitted, setSubmitted] = useState(false)
  const [pending, startTransition] = useTransition()
  // Creada y yendo a su ficha: no se puede volver a tocar «Crear» mientras carga la otra pantalla.
  const [leaving, setLeaving] = useState(false)
  const busy = pending || leaving

  // Cada vez que se abre arranca de lo guardado (o del formato elegido).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      const fresh = toDraft(recipe, defaults)
      setDraft(fresh)
      setBaseline(JSON.stringify(fresh))
      setSubmitted(false)
      setLeaving(false)
    }
  }

  const id = (field: string) => `${uid}-${field}`
  const dirty = JSON.stringify(draft) !== baseline
  const guests = parseGuests(draft.guests)
  const taken =
    draft.templateId !== null &&
    variants.some(
      (other) =>
        other.id !== recipe?.id &&
        other.templateId === draft.templateId &&
        sameVariant(other.variant, draft.variant),
    )

  const errors = {
    name: submitted && !draft.name.trim() ? 'Poné el nombre de la receta.' : null,
    variant: taken
      ? `Este formato ya tiene la variante «${draft.variant.trim()}». Poné otro nombre (Cerdo, Langostino…).`
      : submitted && !draft.variant.trim()
        ? 'Poné un nombre de variante (si hay una sola, «Única»).'
        : null,
    guests: submitted && guests == null ? 'Escribí cuántas personas, de 1 a 1000.' : null,
  }

  // El formato que no está activo solo aparece si ya era el de la receta.
  const formatOptions = formats.filter(
    (format) => format.active || format.id === recipe?.templateId,
  )

  const changeFormat = (value: string) => {
    const next = value === NONE ? null : value
    setDraft((prev) => {
      // Si el nombre era el del formato (o estaba vacío), sigue al formato nuevo.
      const previousName = prev.templateId ? (formatById.get(prev.templateId)?.name ?? '') : ''
      const followName = !prev.name.trim() || prev.name.trim() === previousName
      const nextName = next ? (formatById.get(next)?.name ?? prev.name) : prev.name
      return { ...prev, templateId: next, name: followName ? nextName : prev.name }
    })
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    const name = draft.name.trim()
    const variant = draft.variant.trim()
    const first = !name ? 'name' : !variant || taken ? 'variant' : guests == null ? 'guests' : null
    if (first || guests == null) {
      document.getElementById(id(first ?? 'guests'))?.focus()
      return
    }
    const payload: RecipeInput = {
      slug: tenantSlug,
      id: recipe?.id ?? null,
      templateId: draft.templateId,
      name,
      variant,
      baseGuests: guests,
      notes: draft.notes.trim() || null,
      active: draft.active,
    }
    startTransition(async () => {
      const result = await saveRecipe(payload)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(recipe ? 'Guardamos la receta.' : 'Receta creada. Ahora cargale los insumos.')
      if (!recipe) setLeaving(true)
      await onSaved(result.id, recipe === null)
    })
  }

  return (
    <CatalogSheet
      open={open}
      onClose={onClose}
      busy={busy}
      dirty={dirty && !leaving}
      title={recipe ? 'Datos de la receta' : 'Nueva receta'}
      description="Lo que lleva un formato del calendario, para una cantidad de personas. Si la fecha tiene más reservas, se multiplica."
    >
      <form noValidate onSubmit={submit} className="contents">
        <CatalogSheetBody>
          <Field
            id={id('format')}
            label="Formato del calendario"
            hint="Las fechas de este formato suman los insumos de la receta."
          >
            <Select value={draft.templateId ?? NONE} onValueChange={changeFormat}>
              <SelectTrigger
                id={id('format')}
                aria-describedby={describedBy(id('format'), true, null)}
                className={FIELD_SELECT}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin formato (solo para tener la lista)</SelectItem>
                {formatOptions.map((format) => (
                  <SelectItem key={format.id} value={format.id}>
                    {format.active ? format.name : `${format.name} (desactivado)`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field id={id('name')} label="Nombre" error={errors.name}>
            <Input
              id={id('name')}
              value={draft.name}
              onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              maxLength={80}
              autoComplete="off"
              placeholder="Ej.: Noche de Ramen"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={describedBy(id('name'), false, errors.name)}
              className={FIELD_INPUT}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field
              id={id('variant')}
              label="Variante"
              error={errors.variant}
              hint="Si el formato tiene varias (Cerdo, Langostino…), cada una es una receta."
            >
              <Input
                id={id('variant')}
                value={draft.variant}
                onChange={(e) => setDraft((prev) => ({ ...prev, variant: e.target.value }))}
                maxLength={40}
                autoComplete="off"
                placeholder={DEFAULT_VARIANT}
                aria-invalid={Boolean(errors.variant)}
                aria-describedby={describedBy(id('variant'), true, errors.variant)}
                className={FIELD_INPUT}
              />
            </Field>
            <Field
              id={id('guests')}
              label="Para cuántas personas"
              error={errors.guests}
              hint={recipe ? 'Cambiarlo no cambia las cantidades.' : undefined}
            >
              <div className="relative">
                <Input
                  id={id('guests')}
                  value={draft.guests}
                  onChange={(e) => setDraft((prev) => ({ ...prev, guests: e.target.value }))}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={Boolean(errors.guests)}
                  aria-describedby={describedBy(id('guests'), Boolean(recipe), errors.guests)}
                  className={cn(FIELD_INPUT, 'pr-20 tabular-nums')}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  personas
                </span>
              </div>
            </Field>
          </div>

          <Field
            id={id('notes')}
            label="Aviso para quien compra"
            optional
            hint="Se lee al revisar los pedidos. Una receta sin insumos es solo este aviso."
          >
            <Textarea
              id={id('notes')}
              value={draft.notes}
              onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
              maxLength={500}
              rows={3}
              placeholder="Ej.: Promo de martes, revisar pan y carne."
              aria-describedby={describedBy(id('notes'), true, null)}
            />
          </Field>

          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 p-4">
            <div className="space-y-1">
              <Label htmlFor={id('active')}>Activa</Label>
              <p className="text-xs text-muted-foreground text-pretty">
                {draft.active
                  ? 'Las fechas del formato la usan.'
                  : 'Las fechas del formato no la usan (queda guardada).'}
              </p>
            </div>
            <Switch
              id={id('active')}
              checked={draft.active}
              onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, active: checked }))}
              className="mt-0.5"
            />
          </div>
        </CatalogSheetBody>

        <CatalogSheetFooter>
          <Button type="submit" disabled={busy} className={SHEET_PRIMARY_BUTTON}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {recipe ? 'Guardar datos' : 'Crear y cargar insumos'}
          </Button>
        </CatalogSheetFooter>
      </form>
    </CatalogSheet>
  )
}
