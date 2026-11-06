'use client'

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
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
import { saveItem } from '@/lib/purchasing/catalog-actions'
import { dataIssues } from '@/lib/purchasing/checks'
import type { itemSchema } from '@/lib/purchasing/schemas'
import {
  FREQUENCIES,
  FREQUENCY_HINTS,
  FREQUENCY_LABELS,
  type Frequency,
  type PurItem,
  type PurSupplier,
  type PurZone,
} from '@/lib/purchasing/types'
import { formatAmount, packsText, parseQty, UNIT_OPTIONS, unitShort } from '@/lib/purchasing/units'
import { cn } from '@/lib/utils'
import {
  CatalogSheet,
  CatalogSheetBody,
  CatalogSheetFooter,
  SHEET_PRIMARY_BUTTON,
} from './catalog-sheet'
import {
  capitalize,
  describedBy,
  FIELD_INPUT,
  FIELD_SELECT,
  Field,
  Pill,
  qtyInputText,
} from './form-bits'

type ItemInput = z.input<typeof itemSchema>

/** Radix Select no acepta `''` como valor: «Sin zona» y «Sin proveedor» usan esto. */
const NONE = '__none__'

type ItemDraft = {
  name: string
  brand: string
  code: string
  zoneId: string | null
  unit: string
  frequency: Frequency
  target: string
  packLabel: string
  packSize: string
  supplierId: string | null
  notes: string
  active: boolean
}

type DraftErrors = Partial<Record<'name' | 'target' | 'packSize', string>>

function toDraft(item: PurItem | null): ItemDraft {
  if (!item) {
    return {
      name: '',
      brand: '',
      code: '',
      zoneId: null,
      unit: 'kg',
      frequency: 'frequent',
      target: '',
      packLabel: '',
      packSize: '',
      supplierId: null,
      notes: '',
      active: true,
    }
  }
  return {
    name: item.name,
    brand: item.brand ?? '',
    code: item.code ?? '',
    zoneId: item.zoneId,
    unit: item.unit,
    frequency: item.frequency,
    target: qtyInputText(item.targetQty),
    packLabel: item.packLabel ?? '',
    packSize: qtyInputText(item.packSize),
    supplierId: item.supplierId,
    notes: item.notes ?? '',
    active: item.active,
  }
}

/** Lo que se cuenta y lo que trae cada presentación: vacío = `null`; un 0 no trae nada. */
function positiveQty(text: string): number | null {
  const value = parseQty(text)
  return value && value > 0 ? value : null
}

function validate(draft: ItemDraft): DraftErrors {
  const errors: DraftErrors = {}
  if (!draft.name.trim()) errors.name = 'Poné el nombre del insumo.'
  if (draft.target.trim() && parseQty(draft.target) == null)
    errors.target = 'Escribí un número, por ejemplo 2,5.'
  if (draft.packSize.trim() && positiveQty(draft.packSize) == null)
    errors.packSize = 'Escribí cuánto trae, por ejemplo 150.'
  return errors
}

/** El aviso sin el nombre adelante (ya está en el título de la hoja): «Falta el proveedor.» */
function issueText(text: string, name: string): string {
  const prefix = `${name}: `
  return capitalize(text.startsWith(prefix) ? text.slice(prefix.length) : text)
}

/**
 * La ficha de un insumo, como la fila de la planilla: nombre, zona, unidad, frecuencia, objetivo,
 * cómo se compra y a quién. Sirve para editar (`item`) y para agregar uno nuevo (`item = null`).
 */
export function ItemEditorSheet({
  tenantSlug,
  open,
  item,
  zones,
  suppliers,
  hadIssues,
  usedIn,
  onClose,
  onSaved,
}: {
  tenantSlug: string
  open: boolean
  item: PurItem | null
  zones: readonly PurZone[]
  suppliers: readonly PurSupplier[]
  /** Si al abrir tenía datos para corregir (se muestran arriba y se van tachando en vivo). */
  hadIssues: boolean
  /** Las recetas que lo usan: «Noche de Ramen · Cerdo». */
  usedIn: readonly string[]
  onClose: () => void
  onSaved: () => void
}) {
  const uid = useId()
  const [draft, setDraft] = useState<ItemDraft>(() => toDraft(item))
  const [baseline, setBaseline] = useState(() => JSON.stringify(toDraft(item)))
  // Los errores se muestran después del primer «Guardar» y se recalculan en vivo.
  const [submitted, setSubmitted] = useState(false)
  const [pending, startTransition] = useTransition()

  // Cada vez que se abre arranca de lo guardado (también si se descartaron cambios del mismo insumo).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      const fresh = toDraft(item)
      setDraft(fresh)
      setBaseline(JSON.stringify(fresh))
      setSubmitted(false)
    }
  }

  const dirty = JSON.stringify(draft) !== baseline
  const errors: DraftErrors = submitted ? validate(draft) : {}
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const id = (field: string) => `${uid}-${field}`
  const unit = draft.unit
  const unitLabel = unitShort(unit)
  const targetQty = parseQty(draft.target)
  const packSize = positiveQty(draft.packSize)
  const packLabel = draft.packLabel.trim() || null

  // Los datos para corregir, en vivo con lo que se está escribiendo (las mismas reglas que el panel).
  const liveIssues = hadIssues
    ? dataIssues({
        items: [
          {
            id: item?.id ?? 'nuevo',
            code: draft.code.trim() || null,
            name: draft.name.trim(),
            brand: draft.brand.trim() || null,
            zoneId: draft.zoneId,
            unit,
            frequency: draft.frequency,
            targetQty,
            packLabel,
            packSize,
            supplierId: draft.supplierId,
            notes: null,
            active: true,
          },
        ],
        suppliers: [],
        recipes: [],
        upcoming: [],
      }).map((issue) => issueText(issue.text, draft.name.trim()))
    : []

  // La unidad que trae la planilla puede no estar en la lista («Kg», «pack»): se ofrece igual.
  const unitOptions: string[] = (UNIT_OPTIONS as readonly string[]).includes(item?.unit ?? 'kg')
    ? [...UNIT_OPTIONS]
    : [item?.unit ?? 'kg', ...UNIT_OPTIONS]

  const supplierOptions = [...suppliers]
    .filter((s) => s.active || s.id === item?.supplierId)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  const preview = packSize
    ? packsText({ packs: 2, packLabel, packSize, unit })
    : formatAmount(2, unit)
  const previewTotal = packSize && packSize !== 1 ? formatAmount(2 * packSize, unit) : null

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = validate(draft)
    setSubmitted(true)
    const first = (['name', 'target', 'packSize'] as const).find((key) => found[key])
    if (first) {
      document.getElementById(id(first))?.focus()
      return
    }
    const payload: ItemInput = {
      slug: tenantSlug,
      id: item?.id ?? null,
      code: draft.code.trim() || null,
      name: draft.name.trim(),
      brand: draft.brand.trim() || null,
      zoneId: draft.zoneId,
      unit,
      frequency: draft.frequency,
      targetQty,
      packLabel,
      packSize,
      supplierId: draft.supplierId,
      notes: draft.notes.trim() || null,
      active: draft.active,
    }
    startTransition(async () => {
      const result = await saveItem(payload)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(item ? 'Guardamos los cambios.' : `Agregamos «${payload.name}».`)
      onSaved()
    })
  }

  return (
    <CatalogSheet
      open={open}
      onClose={onClose}
      busy={pending}
      dirty={dirty}
      title={item ? item.name : 'Nuevo insumo'}
      description={
        item
          ? 'Lo que ve la cocina al contar y lo que va en el pedido.'
          : 'Como una fila de la planilla: qué es, dónde está, cuánto tiene que haber y a quién se le pide.'
      }
    >
      <form noValidate onSubmit={submit} className="contents">
        <CatalogSheetBody>
          {hadIssues ? <IssuesBox issues={liveIssues} /> : null}

          <Field id={id('name')} label="Nombre" error={errors.name}>
            <Input
              id={id('name')}
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="Ej.: Harina 000"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={describedBy(id('name'), false, errors.name)}
              className={FIELD_INPUT}
            />
          </Field>

          <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3 sm:grid-cols-[minmax(0,1fr)_9rem] sm:gap-4">
            <Field id={id('brand')} label="Marca" optional>
              <Input
                id={id('brand')}
                value={draft.brand}
                onChange={(e) => set('brand', e.target.value)}
                maxLength={60}
                autoComplete="off"
                className={FIELD_INPUT}
              />
            </Field>
            <Field id={id('code')} label="Código" hint="Opcional: el de la planilla.">
              <Input
                id={id('code')}
                value={draft.code}
                onChange={(e) => set('code', e.target.value)}
                maxLength={20}
                autoComplete="off"
                placeholder="INS-006"
                aria-describedby={describedBy(id('code'), true, null)}
                className={cn(FIELD_INPUT, 'font-mono uppercase placeholder:normal-case')}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={id('zone')}
              label="Zona del recorrido"
              hint={
                zones.length
                  ? 'Dónde lo encuentra la cocina cuando cuenta.'
                  : 'Todavía no hay zonas: armalas desde «Zonas del recorrido».'
              }
            >
              <Select
                value={draft.zoneId ?? NONE}
                onValueChange={(value) => set('zoneId', value === NONE ? null : value)}
              >
                <SelectTrigger
                  id={id('zone')}
                  aria-describedby={describedBy(id('zone'), true, null)}
                  className={FIELD_SELECT}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin zona</SelectItem>
                  {zones.map((zone) => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.area ? `${zone.name} · ${zone.area}` : zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id={id('unit')} label="Se cuenta en" hint="La unidad del conteo y del objetivo.">
              <Select value={unit} onValueChange={(value) => set('unit', value)}>
                <SelectTrigger
                  id={id('unit')}
                  aria-describedby={describedBy(id('unit'), true, null)}
                  className={FIELD_SELECT}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <fieldset className="min-w-0 space-y-2">
            <legend className="mb-2 text-sm font-medium">¿Cada cuánto se cuenta?</legend>
            <div className="grid grid-cols-3 gap-2">
              {FREQUENCIES.map((frequency) => (
                <Pill
                  key={frequency}
                  pressed={draft.frequency === frequency}
                  onClick={() => set('frequency', frequency)}
                  className="w-full px-2 md:px-2"
                >
                  {FREQUENCY_LABELS[frequency]}
                </Pill>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-pretty">
              {FREQUENCY_HINTS[draft.frequency]}
              {usedIn.length ? (
                <>
                  {' '}
                  {usedIn.length === 1 ? 'Lo pide la receta' : 'Lo piden las recetas'}{' '}
                  <span className="text-foreground">{usedIn.slice(0, 3).join(', ')}</span>
                  {usedIn.length > 3 ? ` y ${usedIn.length - 3} más` : ''}.
                </>
              ) : null}
            </p>
          </fieldset>

          <Field
            id={id('target')}
            label="Stock objetivo"
            error={errors.target}
            hint={
              draft.frequency === 'occasional'
                ? 'Un eventual puede no tenerlo: se pide lo que pida el evento.'
                : 'Cuánto tiene que haber. El pedido completa lo que falta para llegar.'
            }
          >
            <div className="relative max-w-56">
              <Input
                id={id('target')}
                value={draft.target}
                onChange={(e) => set('target', e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder="Sin objetivo"
                aria-invalid={Boolean(errors.target)}
                aria-describedby={describedBy(id('target'), true, errors.target)}
                className={cn(FIELD_INPUT, 'pr-16 tabular-nums')}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                {unitLabel}
              </span>
            </div>
          </Field>

          <section
            aria-labelledby={id('buy')}
            className="card-hairline space-y-4 rounded-xl border bg-card p-4 shadow-xs"
          >
            <div className="space-y-1">
              <h3 id={id('buy')} className="font-serif text-lg font-semibold tracking-tight">
                Cómo se compra
              </h3>
              <p className="text-xs text-muted-foreground text-pretty">
                Como lo vende el proveedor. El pedido se redondea hacia arriba a esto.
              </p>
            </div>
            <Field
              id={id('pack-label')}
              label="Presentación"
              hint="«Caja x 150 u», «Bolsa 25 kg», «Por kg»."
            >
              <Input
                id={id('pack-label')}
                value={draft.packLabel}
                onChange={(e) => set('packLabel', e.target.value)}
                maxLength={60}
                autoComplete="off"
                placeholder="Ej.: Caja x 150 u"
                aria-describedby={describedBy(id('pack-label'), true, null)}
                className={FIELD_INPUT}
              />
            </Field>
            <Field
              id={id('pack-size')}
              label="Cada una trae"
              error={errors.packSize}
              hint={`En ${unitLabel}, la unidad del conteo.`}
            >
              <div className="relative max-w-56">
                <Input
                  id={id('pack-size')}
                  value={draft.packSize}
                  onChange={(e) => set('packSize', e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Ej.: 150"
                  aria-invalid={Boolean(errors.packSize)}
                  aria-describedby={describedBy(id('pack-size'), true, errors.packSize)}
                  className={cn(FIELD_INPUT, 'pr-16 tabular-nums')}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  {unitLabel}
                </span>
              </div>
            </Field>
            <p className="rounded-lg bg-secondary/70 px-3 py-2.5 text-sm text-pretty">
              {packSize ? (
                <>
                  Se pide así: <strong className="font-semibold">{preview}</strong>
                  {previewTotal ? (
                    <span className="text-muted-foreground"> (son {previewTotal})</span>
                  ) : null}
                </>
              ) : (
                <>
                  Sin lo que trae, se pide en {unitLabel}:{' '}
                  <strong className="font-semibold">{preview}</strong>
                </>
              )}
            </p>
          </section>

          <Field
            id={id('supplier')}
            label="Proveedor"
            hint={
              draft.supplierId ? (
                'A quién se le manda el pedido.'
              ) : (
                <span className="text-warning-text">
                  Sin proveedor va a un pedido aparte, para decidir a quién se le pide.
                </span>
              )
            }
          >
            <Select
              value={draft.supplierId ?? NONE}
              onValueChange={(value) => set('supplierId', value === NONE ? null : value)}
            >
              <SelectTrigger
                id={id('supplier')}
                aria-describedby={describedBy(id('supplier'), true, null)}
                className={cn(FIELD_SELECT, !draft.supplierId && 'text-warning-text')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin proveedor</SelectItem>
                {supplierOptions.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.active ? supplier.name : `${supplier.name} (desactivado)`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field id={id('notes')} label="Notas" optional>
            <Textarea
              id={id('notes')}
              value={draft.notes}
              onChange={(e) => set('notes', e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Marca que preferimos, cómo pedirlo…"
            />
          </Field>

          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 p-4">
            <div className="space-y-1">
              <Label htmlFor={id('active')}>Activo</Label>
              <p className="text-xs text-muted-foreground text-pretty">
                {draft.active
                  ? 'Aparece en los conteos y en los pedidos.'
                  : 'No aparece en los conteos ni en los pedidos. Queda en «Desactivados».'}
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
            {item ? 'Guardar insumo' : 'Agregar insumo'}
          </Button>
        </CatalogSheetFooter>
      </form>
    </CatalogSheet>
  )
}

/** Lo que le falta al insumo: se va vaciando mientras se completa la ficha. */
function IssuesBox({ issues }: { issues: readonly string[] }) {
  if (!issues.length) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-foreground">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        Ya no le falta nada. Guardá para que quede así.
      </p>
    )
  }
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-warning-text">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        Para corregir
      </p>
      <ul className="mt-1.5 space-y-1 pl-6 text-sm text-warning-text">
        {issues.map((issue) => (
          <li key={issue} className="list-disc text-pretty">
            {issue}
          </li>
        ))}
      </ul>
    </div>
  )
}
