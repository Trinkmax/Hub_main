'use client'

import {
  AlertTriangle,
  ChefHat,
  ChevronLeft,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type MouseEvent, useEffect, useId, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { z } from 'zod'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { deleteRecipe, saveRecipeLines } from '@/lib/purchasing/catalog-actions'
import type { recipeLinesSchema } from '@/lib/purchasing/schemas'
import type { PurItem, PurRecipe, PurRecipeLine } from '@/lib/purchasing/types'
import { convertQty, parseQty, UNIT_OPTIONS, unitShort } from '@/lib/purchasing/units'
import { cn } from '@/lib/utils'
import { FIELD_INPUT, Pill, qtyInputText } from './form-bits'
import { ItemPicker } from './item-picker'
import { type FormatOption, RecipeSheet, type RecipeVariantRef } from './recipe-sheet'

type LinesInput = z.input<typeof recipeLinesSchema>
type LineInput = LinesInput['lines'][number]

/** Un renglón mientras se edita (la cantidad como se escribe: «2,5»). */
type DraftLine = {
  key: string
  itemId: string | null
  name: string
  qty: string
  unit: string | null
  inHouse: boolean
  note: string | null
}

/** Otra variante del mismo formato, para saltar entre ellas. */
export type SiblingRecipe = { id: string; variant: string; active: boolean }

const DEFAULT_VARIANT = 'Única'

function toDraftLines(
  lines: readonly PurRecipeLine[],
  items: ReadonlyMap<string, PurItem>,
): DraftLine[] {
  return lines.map((line) => {
    const item = line.itemId ? items.get(line.itemId) : undefined
    return {
      key: line.id,
      itemId: line.itemId,
      name: line.name,
      qty: qtyInputText(line.quantity),
      // Sin unidad, la receta habla en la del insumo: se muestra (y se guarda) esa.
      unit: line.unit ?? item?.unit ?? null,
      inHouse: line.inHouse,
      note: line.note,
    }
  })
}

/**
 * Lo que se compara para saber si hay cambios: sin la clave (es solo para React) y sin los renglones
 * vacíos (un «Agregar insumo» que no se completó no es un cambio, y no se guarda).
 */
function signature(lines: readonly DraftLine[]): string {
  return JSON.stringify(
    lines
      .filter((line) => !isBlank(line))
      .map((line) => [
        line.itemId,
        line.name.trim(),
        line.qty.trim(),
        line.unit,
        line.inHouse,
        line.note,
      ]),
  )
}

function isBlank(line: DraftLine): boolean {
  return !line.itemId && !line.name.trim() && !line.qty.trim()
}

/** Lo que no deja guardar el renglón (un número mal escrito, un renglón sin qué). */
function blockingProblem(line: DraftLine): string | null {
  if (isBlank(line)) return null
  const qty = line.qty.trim()
  if (qty) {
    const value = parseQty(qty)
    if (value == null || value <= 0) return 'La cantidad tiene que ser un número mayor que 0.'
  }
  if (line.inHouse && !line.name.trim()) return 'Escribí qué se hace en el local.'
  if (!line.inHouse && !line.itemId && !line.name.trim()) return 'Elegí el insumo de la lista.'
  return null
}

/**
 * Lo que queda «para revisar» (se puede guardar igual). Son las mismas reglas, y la misma cuenta,
 * que «Datos para corregir» (`lib/purchasing/checks.ts`): así el número de la lista y el de la
 * ficha coinciden.
 */
function reviewProblems(line: DraftLine, item: PurItem | undefined): string[] {
  if (line.inHouse || isBlank(line)) return []
  if (!line.itemId || !item) {
    return [
      line.name.trim()
        ? `«${line.name.trim()}» no está en la lista de insumos: elegilo de la lista.`
        : 'Falta elegir el insumo.',
    ]
  }
  const out: string[] = []
  if (!item.active) out.push('Está desactivado en la lista de insumos: no se pide.')
  const qty = line.qty.trim() ? parseQty(line.qty) : null
  if (qty == null) out.push('Falta la cantidad.')
  else if (line.unit && convertQty(qty, line.unit, item.unit) == null) {
    out.push(`Está en ${unitShort(line.unit)} y el insumo se cuenta en ${unitShort(item.unit)}.`)
  }
  return out
}

/**
 * La ficha de una receta: sus datos arriba y los insumos para N personas abajo. Los renglones se
 * editan en la pantalla y se guardan todos juntos con «Guardar receta» (reemplaza los anteriores).
 */
export function RecipeEditor({
  tenantSlug,
  recipe,
  format,
  formats,
  items,
  variants,
  siblings,
  defaultGuests,
}: {
  tenantSlug: string
  recipe: PurRecipe
  format: FormatOption | null
  formats: readonly FormatOption[]
  /** Todos los insumos (los desactivados, para mostrar los renglones que los usan). */
  items: readonly PurItem[]
  /** Formato y variante de todas las recetas, para la hoja de datos. */
  variants: readonly RecipeVariantRef[]
  /** Las variantes del mismo formato, incluida esta. */
  siblings: readonly SiblingRecipe[]
  defaultGuests: number
}) {
  const router = useRouter()
  const uid = useId()
  const listHref = `/${tenantSlug}/compras/recetas`
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const options = items
    .filter((item) => item.active)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  const [lines, setLines] = useState<DraftLine[]>(() => toDraftLines(recipe.lines, itemsById))
  const [baseSig, setBaseSig] = useState(() => signature(toDraftLines(recipe.lines, itemsById)))
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)
  /** Adónde se iba cuando se preguntó «¿Salís sin guardar?». */
  const [confirmLeave, setConfirmLeave] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [saving, startSaving] = useTransition()
  const [deleting, startDeleting] = useTransition()
  const newKeys = useRef(0)

  const dirty = signature(lines) !== baseSig

  // Llegaron datos nuevos del servidor (se guardó, u otra pestaña cambió algo): si no hay cambios
  // sin guardar, se muestra lo de la base.
  const serverSig = signature(toDraftLines(recipe.lines, itemsById))
  const [knownServerSig, setKnownServerSig] = useState(serverSig)
  if (serverSig !== knownServerSig) {
    setKnownServerSig(serverSig)
    if (!dirty) {
      setLines(toDraftLines(recipe.lines, itemsById))
      setBaseSig(serverSig)
    }
  }

  // Cerrar la pestaña o recargar con cambios sin guardar: el navegador pregunta.
  useEffect(() => {
    if (!dirty || leaving) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, leaving])

  const reviews = lines.map((line) =>
    reviewProblems(line, line.itemId ? itemsById.get(line.itemId) : undefined),
  )
  const reviewCount = reviews.reduce((sum, problems) => sum + problems.length, 0)
  const buyCount = lines.filter((line) => !line.inHouse && !isBlank(line)).length
  const variant = recipe.variant !== DEFAULT_VARIANT ? recipe.variant : null
  const guests = recipe.baseGuests

  const update = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const addLine = () => {
    newKeys.current += 1
    const key = `nuevo-${newKeys.current}`
    setLines((prev) => [
      ...prev,
      { key, itemId: null, name: '', qty: '', unit: null, inHouse: false, note: null },
    ])
    // El renglón nuevo queda abajo de todo (detrás del pie fijo): primero se trae a la vista y
    // recién ahí se abre el buscador, así el desplegable aparece pegado al renglón.
    requestAnimationFrame(() => {
      document.getElementById(`${uid}-${key}-row`)?.scrollIntoView({ block: 'center' })
      setPickerFor(key)
    })
  }

  const removeLine = (key: string) => {
    const index = lines.findIndex((line) => line.key === key)
    const removed = lines[index]
    if (!removed) return
    setLines((prev) => prev.filter((line) => line.key !== key))
    const item = removed.itemId ? itemsById.get(removed.itemId) : undefined
    const name = removed.name.trim() || item?.name
    toast(name ? `Quitamos «${name}».` : 'Quitamos el renglón.', {
      description: 'Se borra de verdad cuando guardes la receta.',
      action: {
        label: 'Deshacer',
        onClick: () =>
          setLines((prev) => {
            if (prev.some((line) => line.key === key)) return prev
            const next = [...prev]
            next.splice(Math.min(index, next.length), 0, removed)
            return next
          }),
      },
    })
  }

  const pickItem = (key: string, item: PurItem) => {
    update(key, { itemId: item.id, name: item.name, unit: item.unit })
    // Lo que sigue es la cantidad.
    requestAnimationFrame(() => document.getElementById(`${uid}-${key}-qty`)?.focus())
  }

  const save = () => {
    setSubmitted(true)
    const payload: LineInput[] = []
    let firstBlocked: string | null = null
    for (const line of lines) {
      if (isBlank(line)) continue
      if (blockingProblem(line)) {
        firstBlocked ??= line.key
        continue
      }
      const item = line.itemId ? itemsById.get(line.itemId) : undefined
      const qty = line.qty.trim()
      payload.push({
        itemId: line.itemId,
        name: (line.name.trim() || item?.name || '').slice(0, 80),
        quantity: qty ? parseQty(qty) : null,
        unit: line.unit?.trim() || null,
        inHouse: line.inHouse,
        note: line.note?.trim() || null,
      })
    }
    if (firstBlocked) {
      toast.error('Hay renglones para arreglar antes de guardar.')
      document.getElementById(`${uid}-${firstBlocked}-row`)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      })
      return
    }
    const sent = signature(lines)
    startSaving(async () => {
      const result = await saveRecipeLines({
        slug: tenantSlug,
        recipeId: recipe.id,
        lines: payload,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setBaseSig(sent)
      setSubmitted(false)
      toast.success('Guardamos la receta.')
      router.refresh()
    })
  }

  /** Un link que sale de la ficha: con cambios sin guardar, primero pregunta. */
  const leaveTo = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!dirty) return
    event.preventDefault()
    setConfirmLeave(href)
  }

  const removeRecipe = () => {
    startDeleting(async () => {
      const result = await deleteRecipe({ slug: tenantSlug, id: recipe.id })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setLeaving(true)
      setConfirmDelete(false)
      toast.success('Borramos la receta.')
      router.replace(listHref)
    })
  }

  const unitOptionsFor = (line: DraftLine, item: PurItem | undefined) => {
    const out: string[] = [...UNIT_OPTIONS]
    for (const extra of [item?.unit, line.unit]) {
      if (extra && !out.includes(extra)) out.unshift(extra)
    }
    return out
  }

  return (
    <>
      <div className="space-y-3">
        <Link
          href={listHref}
          onClick={leaveTo(listHref)}
          className="-ml-1.5 inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-9"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Recetas
        </Link>
        <PageHeader
          eyebrow={
            format
              ? format.active
                ? format.name
                : `${format.name} · formato desactivado`
              : 'Sin formato del calendario'
          }
          title={
            <>
              {recipe.name}
              {variant ? <span className="text-muted-foreground"> · {variant}</span> : null}
            </>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                Para <strong className="font-semibold text-foreground">{guests} personas</strong>
                {' · '}
                {buyCount === 1 ? '1 insumo' : `${buyCount} insumos`}
              </span>
              {recipe.active ? null : (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                  Desactivada
                </span>
              )}
            </span>
          }
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDataOpen(true)}
                className="h-11 flex-1 sm:flex-none md:h-10"
              >
                <Pencil className="size-4" aria-hidden />
                Editar datos
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                className="h-11 text-destructive hover:text-destructive md:h-10"
              >
                <Trash2 className="size-4" aria-hidden />
                Borrar
              </Button>
            </>
          }
        />
      </div>

      {siblings.length > 1 ? (
        <nav aria-label="Variantes de este formato" className="space-y-2">
          <p className="px-1 text-sm text-muted-foreground">
            Cada fecha de «{format?.name ?? recipe.name}» elige cuál va:
          </p>
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
            <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
              {siblings.map((sibling) => {
                const current = sibling.id === recipe.id
                const href = `${listHref}/${sibling.id}`
                return (
                  <li key={sibling.id}>
                    <Link
                      href={href}
                      onClick={current ? (event) => event.preventDefault() : leaveTo(href)}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors md:h-9 md:px-3.5',
                        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
                        current
                          ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                          : 'border-border bg-card/70 hover:bg-secondary',
                        !sibling.active && !current && 'text-muted-foreground',
                      )}
                    >
                      {sibling.variant}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        </nav>
      ) : null}

      {recipe.notes ? (
        <aside className="card-hairline flex items-start gap-3 rounded-xl border bg-card p-4 shadow-xs">
          <Megaphone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Aviso para quien compra</p>
            <p className="text-sm text-muted-foreground text-pretty whitespace-pre-line">
              {recipe.notes}
            </p>
          </div>
        </aside>
      ) : null}

      <section aria-labelledby={`${uid}-lines`} className="space-y-3">
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-1">
          <div className="space-y-0.5">
            <h2 id={`${uid}-lines`} className="font-serif text-xl font-semibold tracking-tight">
              Insumos para {guests} personas
            </h2>
            <p className="text-sm text-muted-foreground text-pretty">
              Si una fecha tiene más reservas, las cantidades se multiplican.
            </p>
          </div>
          {reviewCount ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning-text">
              <AlertTriangle className="size-3.5" aria-hidden />
              {reviewCount === 1 ? '1 para revisar' : `${reviewCount} para revisar`}
            </span>
          ) : null}
        </header>

        {lines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-10 text-center">
            <p className="font-serif text-lg font-semibold">
              {recipe.notes ? 'Por ahora es solo un aviso' : 'Todavía no tiene insumos'}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground text-pretty">
              Agregá lo que lleva la noche y cuánto, para {guests} personas. Lo que se hace en el
              local (caldos, salsas) queda como recordatorio y no se pide.
            </p>
          </div>
        ) : (
          // En el celular cada renglón es una tarjeta; en la compu, una sola tarjeta con filas.
          <ol className="card-hairline space-y-3 max-md:before:hidden md:space-y-0 md:divide-y md:divide-border/60 md:rounded-xl md:border md:bg-card md:shadow-xs">
            <li
              aria-hidden
              className="hidden px-4 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:grid md:grid-cols-[minmax(0,1fr)_14rem_auto_2.75rem] md:gap-x-3"
            >
              <span>Insumo</span>
              <span>Cantidad para {guests}</span>
              <span />
              <span />
            </li>
            {lines.map((line, index) => {
              const item = line.itemId ? itemsById.get(line.itemId) : undefined
              const problems = reviews[index] ?? []
              const review = problems.length ? problems.join(' ') : null
              const blocked = submitted ? blockingProblem(line) : null
              const rowId = `${uid}-${line.key}`
              const label = line.name.trim() || item?.name || `renglón ${index + 1}`
              return (
                <li
                  key={line.key}
                  id={`${rowId}-row`}
                  // La tarjeta es solo del celular: en la compu son filas (con `divide-y`) de una tarjeta.
                  className={cn(
                    'card-hairline scroll-mt-28 max-md:rounded-xl max-md:border max-md:bg-card max-md:p-3 max-md:shadow-xs md:px-4 md:py-3 md:before:hidden',
                    (review || blocked) && 'max-md:border-warning/60',
                  )}
                >
                  {/* Celular: insumo y «Quitar» arriba, la cantidad abajo y después «Se hace en el
                      local». Compu: las cuatro en una fila (Quitar va al final con `order-last`). */}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-2 gap-y-3 md:grid-cols-[minmax(0,1fr)_14rem_auto_2.75rem] md:items-center md:gap-x-3">
                    <div className="min-w-0 space-y-1.5">
                      {/* Con el insumo elegido, el botón ya dice qué es; el texto libre lleva etiqueta. */}
                      <Label
                        htmlFor={`${rowId}-item`}
                        className={cn(
                          'text-xs text-muted-foreground',
                          line.inHouse ? 'md:sr-only' : 'sr-only',
                        )}
                      >
                        {line.inHouse ? 'Qué se hace en el local' : 'Insumo'}
                      </Label>
                      {line.inHouse ? (
                        <Input
                          id={`${rowId}-item`}
                          value={line.name}
                          onChange={(e) => update(line.key, { name: e.target.value })}
                          maxLength={80}
                          autoComplete="off"
                          placeholder="Ej.: Caldo de cerdo"
                          aria-invalid={Boolean(blocked) && !line.name.trim()}
                          className={FIELD_INPUT}
                        />
                      ) : (
                        <ItemPicker
                          id={`${rowId}-item`}
                          items={options}
                          selected={item ?? null}
                          fallbackName={line.itemId ? null : line.name.trim() || null}
                          open={pickerFor === line.key}
                          onOpenChange={(next) => setPickerFor(next ? line.key : null)}
                          onPick={(picked) => pickItem(line.key, picked)}
                          invalid={Boolean(review)}
                        />
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(line.key)}
                      aria-label={`Quitar ${label}`}
                      className="size-11 justify-self-end text-muted-foreground hover:text-destructive md:order-last md:size-10"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>

                    <div className="col-span-2 space-y-1.5 md:col-span-1">
                      <Label
                        htmlFor={`${rowId}-qty`}
                        className="text-xs text-muted-foreground md:sr-only"
                      >
                        Cantidad para {guests}
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id={`${rowId}-qty`}
                          value={line.qty}
                          onChange={(e) => update(line.key, { qty: e.target.value })}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="Sin cantidad"
                          aria-invalid={Boolean(blocked) && Boolean(line.qty.trim())}
                          className={cn(FIELD_INPUT, 'min-w-0 flex-1 tabular-nums')}
                        />
                        <Select
                          value={line.unit ?? ''}
                          onValueChange={(value) => update(line.key, { unit: value || null })}
                        >
                          <SelectTrigger
                            aria-label={`Unidad de ${label}`}
                            className="w-24 shrink-0 data-[size=default]:h-11 md:data-[size=default]:h-10"
                          >
                            <SelectValue placeholder="unidad" />
                          </SelectTrigger>
                          <SelectContent>
                            {unitOptionsFor(line, item).map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Pill
                      pressed={line.inHouse}
                      onClick={() =>
                        update(line.key, {
                          inHouse: !line.inHouse,
                          // El nombre del insumo queda escrito para lo que se hace en el local.
                          name: line.name.trim() || item?.name || '',
                        })
                      }
                      className="col-span-2 justify-self-start md:col-span-1"
                    >
                      <ChefHat className="size-4" aria-hidden />
                      Se hace en el local
                    </Pill>
                  </div>

                  {line.note || review || blocked || line.inHouse ? (
                    <div className="mt-2.5 space-y-1.5">
                      {blocked ? (
                        <p className="flex items-start gap-1.5 text-sm text-destructive">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                          {blocked}
                        </p>
                      ) : review ? (
                        <p className="flex items-start gap-1.5 text-sm text-warning-text">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                          <span className="text-pretty">
                            <span className="font-semibold">Para revisar:</span> {review}
                          </span>
                        </p>
                      ) : null}
                      {line.inHouse ? (
                        <p className="text-xs text-muted-foreground">
                          Queda como recordatorio en el pedido: no se le pide a ningún proveedor.
                        </p>
                      ) : null}
                      {line.note ? (
                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <StickyNote className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 text-pretty">{line.note}</span>
                          <button
                            type="button"
                            onClick={() => update(line.key, { note: null })}
                            aria-label="Quitar la nota (ya la revisé)"
                            className="-my-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:size-11"
                          >
                            <X className="size-3.5" aria-hidden />
                          </button>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={addLine}
          className="h-12 w-full md:h-10 md:w-auto"
        >
          <Plus className="size-4" aria-hidden />
          Agregar insumo
        </Button>
      </section>

      {/* El pie fijo: «Guardar receta» siempre a mano. */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-border/60 bg-background/90 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-md supports-[backdrop-filter]:bg-background/75 sm:-mx-6 sm:px-6 lg:-mx-8 lg:pr-36 lg:pl-8">
        <div className="flex items-center justify-between gap-3">
          <p
            aria-live="polite"
            className={cn(
              'text-sm text-pretty',
              dirty ? 'text-warning-text' : 'text-muted-foreground',
            )}
          >
            {dirty ? 'Tenés cambios sin guardar.' : 'Todo guardado.'}
          </p>
          <Button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="h-12 shrink-0 px-6 text-base font-semibold md:h-10 md:text-sm"
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Guardar receta
          </Button>
        </div>
      </div>

      <RecipeSheet
        tenantSlug={tenantSlug}
        open={dataOpen}
        recipe={recipe}
        formats={formats}
        variants={variants}
        defaultGuests={defaultGuests}
        onClose={() => setDataOpen(false)}
        onSaved={() => {
          setDataOpen(false)
          router.refresh()
        }}
      />

      <AlertDialog
        open={confirmLeave !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmLeave(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Salís sin guardar?</AlertDialogTitle>
            <AlertDialogDescription>
              Los cambios en los insumos de esta receta no se guardaron.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 sm:h-9">Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const href = confirmLeave ?? listHref
                setLeaving(true)
                router.push(href)
              }}
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:h-9"
            >
              Salir sin guardar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (!deleting) setConfirmDelete(next)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Borrás «{recipe.name}
              {variant ? ` · ${variant}` : ''}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Las fechas del calendario que la usaban dejan de sumar estos insumos al pedido. No se
              puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="h-11 sm:h-9">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                // Se cierra cuando la base confirma, no antes.
                event.preventDefault()
                removeRecipe()
              }}
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:h-9"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Borrar receta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
