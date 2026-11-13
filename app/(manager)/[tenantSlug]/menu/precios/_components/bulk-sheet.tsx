'use client'

import { ChevronRight, LoaderCircle, TrendingDown, TrendingUp } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Pill } from '@/components/administracion/kit/pill'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  type BulkLine,
  type BulkScope,
  bulkButtonLabel,
  bulkPoints,
  computeBulk,
  DEFAULT_ROUNDING,
  PERCENT_BP_MIN,
  PERCENT_PRESETS,
  parsePercentInput,
  percentText,
  ROUNDING_STEPS,
  SCOPE_ALL,
  scopeCounts,
  scopeMark,
  summarizeBulk,
  toggleScope,
} from '@/lib/menu/prices/bulk'
import {
  type CategoryTree,
  descendantsOf,
  NO_CATEGORY_ID,
  NO_CATEGORY_NAME,
} from '@/lib/menu/prices/tree'
import type { BranchOverride, PriceBranch, PriceItem, ViewId } from '@/lib/menu/prices/types'
import { formatCentsShort, NBSP } from '@/lib/money'
import { cn } from '@/lib/utils'
import { BranchDot } from './branch-switch'
import { SHEET_QUESTION, SideSheet, SideSheetBody, SideSheetFooter } from './side-sheet'

export type BulkRequest = {
  lines: BulkLine[]
  percentBp: number
  roundingCents: number
  scope: BulkScope
}
export type BulkOutcome = { ok: true } | { ok: false; message: string }

/** Las píldoras de una hoja: 44 px en el celular, lo de siempre en la compu. */
const TOUCH = 'h-11 px-4 text-sm sm:h-9 sm:px-3 sm:text-[13px]'
/** Cuántos nombres se listan antes de resumir el resto. */
const MAX_LISTED = 40

/** `null`: todavía no eligió cuánto (nada viene marcado: es LA decisión de esta hoja). */
type Choice = (typeof PERCENT_PRESETS)[number] | 'custom' | null

function ScopePicker({
  tree,
  items,
  scope,
  disabled,
  onChange,
}: {
  tree: CategoryTree
  items: ReadonlyArray<PriceItem>
  scope: BulkScope
  disabled: boolean
  onChange: (scope: BulkScope) => void
}) {
  const [open, setOpen] = useState(false)
  const counts = useMemo(() => scopeCounts(tree, scope, items), [tree, scope, items])
  const total = (id: string) => counts.get(id)?.total ?? 0

  const roots = (tree.children.get(null) ?? []).filter((id) => total(id) > 0)
  const below = (root: string) =>
    descendantsOf(tree, root)
      .slice(1)
      .filter((id) => total(id) > 0)
  const hasSubcategories = roots.some((root) => below(root).length > 0)
  const loose = total(NO_CATEGORY_ID) > 0

  const pill = (id: string, name: string) => {
    const count = counts.get(id) ?? { total: 0, picked: 0 }
    const mark = scope.kind === 'all' ? 'off' : scopeMark(count)
    return (
      <Pill
        key={id}
        active={mark === 'on'}
        aria-pressed={mark === 'partial' ? 'mixed' : mark === 'on'}
        count={mark === 'partial' ? `${count.picked} de ${count.total}` : count.total}
        className={cn(TOUCH, mark === 'partial' && 'border-foreground/60')}
        disabled={disabled}
        data-testid={`scope-${id}`}
        onClick={() => onChange(toggleScope(tree, scope, id, counts))}
      >
        {name}
      </Pill>
    )
  }
  const nameOf = (id: string) => tree.byId.get(id)?.name ?? NO_CATEGORY_NAME

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Pill
          active={scope.kind === 'all'}
          count={items.length}
          className={TOUCH}
          disabled={disabled}
          data-testid="scope-all"
          onClick={() => onChange(SCOPE_ALL)}
        >
          Toda la carta
        </Pill>
        {open ? null : roots.map((root) => pill(root, nameOf(root)))}
        {open || !loose ? null : pill(NO_CATEGORY_ID, NO_CATEGORY_NAME)}
      </div>

      {open ? (
        <div className="space-y-2.5">
          {roots.map((root) => (
            <div key={root} className="flex flex-wrap items-center gap-2">
              {pill(root, nameOf(root))}
              {below(root).length > 0 ? (
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              ) : null}
              {below(root).map((id) => pill(id, nameOf(id)))}
            </div>
          ))}
          {loose ? (
            <div className="flex flex-wrap gap-2">{pill(NO_CATEGORY_ID, NO_CATEGORY_NAME)}</div>
          ) : null}
        </div>
      ) : null}

      {hasSubcategories ? (
        <button
          type="button"
          aria-expanded={open}
          data-testid="scope-more"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-6 items-center rounded-sm text-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
        >
          {open ? 'Ver solo las categorías principales' : 'Elegir subcategorías'}
        </button>
      ) : null}
    </div>
  )
}

/** Un renglón «Bacon   $ 12.500 → $ 13.800». */
function LineRow({ line, tag }: { line: BulkLine; tag?: string | null }) {
  return (
    <li className="flex items-baseline gap-2.5 py-2 text-sm">
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {line.name}
        {tag ? <span className="text-muted-foreground"> · {tag}</span> : null}
      </span>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {formatCentsShort(line.baseCents)}
      </span>
      <span aria-hidden className="shrink-0 text-muted-foreground">
        →
      </span>
      <span className="sr-only">pasa a</span>
      <span className="min-w-[4.75rem] shrink-0 text-right font-semibold tabular-nums">
        {formatCentsShort(line.toCents)}
      </span>
    </li>
  )
}

function BulkForm({
  tree,
  items,
  overrides,
  branches,
  view,
  onApply,
}: {
  tree: CategoryTree
  items: ReadonlyArray<PriceItem>
  overrides: ReadonlyArray<BranchOverride>
  branches: ReadonlyArray<PriceBranch>
  view: ViewId
  onApply: (request: BulkRequest) => Promise<BulkOutcome>
}) {
  const [scope, setScope] = useState<BulkScope>(SCOPE_ALL)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [choice, setChoice] = useState<Choice>(null)
  const [customText, setCustomText] = useState('')
  const [rounding, setRounding] = useState<number>(DEFAULT_ROUNDING)
  const [includeOwn, setIncludeOwn] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ownLabelId = useId()
  const ownSwitchId = useId()

  const branch = view === null ? null : (branches.find((entry) => entry.id === view) ?? null)
  const branchNames = useMemo(
    () => new Map(branches.map((entry) => [entry.id, entry.name])),
    [branches],
  )

  // El porcentaje, en puntos básicos y con su signo. `null` = todavía no hay uno que valga.
  const magnitude =
    choice === null ? null : choice === 'custom' ? parsePercentInput(customText) : choice * 100
  const tooLow = magnitude !== null && direction === -1 && -Math.abs(magnitude) < PERCENT_BP_MIN
  const percentBp = magnitude === null || tooLow ? null : Math.abs(magnitude) * direction
  const down = direction === -1

  const points = useMemo(
    () => bulkPoints({ tree, items, overrides, scope, view, includeOwnPrices: includeOwn }),
    [tree, items, overrides, scope, view, includeOwn],
  )
  // Los precios propios que hay entre los productos elegidos, se incluyan o no.
  const ownInScope = useMemo(
    () =>
      view === null
        ? bulkPoints({ tree, items, overrides, scope, view, includeOwnPrices: true }).filter(
            (point) => point.branchId !== null,
          ).length
        : 0,
    [tree, items, overrides, scope, view],
  )
  const result = useMemo(
    () => computeBulk(points, percentBp ?? 0, rounding),
    [points, percentBp, rounding],
  )
  const summary = useMemo(() => summarizeBulk(result), [result])

  const ready = percentBp !== null && summary.productCount > 0
  const one = summary.productCount === 1
  const verb = down ? (one ? 'baja' : 'bajan') : one ? 'sube' : 'suben'
  const more = down ? 'menos' : 'más'
  const delta = (line: BulkLine) => formatCentsShort(Math.abs(line.toCents - line.baseCents))
  const newOwn =
    view === null ? 0 : result.changed.filter((line) => line.currentCents === null).length
  const tagOf = (line: BulkLine) =>
    view === null && line.branchId !== null ? (branchNames.get(line.branchId) ?? null) : null

  const apply = async () => {
    if (!ready || percentBp === null || applying) return
    setApplying(true)
    setError(null)
    const outcome = await onApply({
      lines: result.changed,
      percentBp,
      roundingCents: rounding,
      scope,
    })
    // Si salió bien, la pantalla cierra la hoja; si no, queda abierta con lo que pasó.
    if (!outcome.ok) {
      setError(outcome.message)
      setApplying(false)
    }
  }

  const customInvalid = choice === 'custom' && customText.trim() !== '' && percentBp === null

  return (
    <>
      <SideSheetBody className="space-y-8">
        <section className="space-y-3">
          <h3 className={SHEET_QUESTION}>¿A qué productos?</h3>
          <ScopePicker
            tree={tree}
            items={items}
            scope={scope}
            disabled={applying}
            onChange={(next) => {
              setScope(next)
              setShowAll(false)
            }}
          />
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h3 className={SHEET_QUESTION}>¿Cuánto?</h3>
            {/* biome-ignore lint/a11y/useSemanticElements: dos botones que alternan, no un formulario. */}
            <div role="group" aria-label="Subir o bajar los precios" className="flex gap-1.5">
              <Pill
                active={!down}
                icon={TrendingUp}
                className={TOUCH}
                disabled={applying}
                data-testid="direction-up"
                onClick={() => setDirection(1)}
              >
                Subir
              </Pill>
              <Pill
                active={down}
                icon={TrendingDown}
                className={TOUCH}
                disabled={applying}
                data-testid="direction-down"
                onClick={() => setDirection(-1)}
              >
                Bajar
              </Pill>
            </div>
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: botones que alternan, no un formulario. */}
          <div role="group" aria-label="Porcentaje" className="flex flex-wrap gap-2">
            {PERCENT_PRESETS.map((preset) => (
              <Pill
                key={preset}
                active={choice === preset}
                className={TOUCH}
                disabled={applying}
                data-testid={`percent-${preset}`}
                onClick={() => setChoice(preset)}
              >
                {`${preset}${NBSP}%`}
              </Pill>
            ))}
            <Pill
              active={choice === 'custom'}
              className={TOUCH}
              disabled={applying}
              data-testid="percent-custom"
              onClick={() => setChoice('custom')}
            >
              Otro
            </Pill>
          </div>
          {choice === 'custom' ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="relative w-28">
                <input
                  // Eligió «Otro»: lo que sigue es tipear el número.
                  // biome-ignore lint/a11y/noAutofocus: el campo aparece porque la persona lo pidió.
                  autoFocus
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  data-testid="percent-input"
                  aria-label="Porcentaje"
                  aria-invalid={customInvalid ? true : undefined}
                  disabled={applying}
                  placeholder="7,5"
                  value={customText}
                  onChange={(event) => {
                    const next = event.target.value
                    // Un menos adelante es «bajar»: se pasa al botón y el campo queda con el número.
                    if (/^\s*[-−–]/.test(next)) setDirection(-1)
                    setCustomText(next.replace(/[-−–+]/g, ''))
                  }}
                  onKeyDown={(event) => {
                    // Enter acá no aplica nada: solo termina de escribir.
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                  className="h-11 w-full rounded-lg border border-input bg-background/60 pr-8 pl-3 text-right text-base tabular-nums shadow-2xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-destructive dark:bg-input/30"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                >
                  %
                </span>
              </div>
              {customInvalid ? (
                <p role="alert" className="text-xs text-destructive">
                  {tooLow
                    ? 'Para bajar, hasta 90 %.'
                    : 'Escribí un porcentaje entre 0,01 y 500, por ejemplo 7,5.'}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <h3 className={SHEET_QUESTION}>¿Cómo se redondea?</h3>
          {/* biome-ignore lint/a11y/useSemanticElements: botones que alternan, no un formulario. */}
          <div role="group" aria-label="Redondeo" className="flex flex-wrap gap-2">
            {ROUNDING_STEPS.map((step) => (
              <Pill
                key={step}
                active={rounding === step}
                className={TOUCH}
                disabled={applying}
                data-testid={`rounding-${step}`}
                onClick={() => setRounding(step)}
              >
                {step === 0 ? 'Sin redondear' : `A ${formatCentsShort(step)}`}
              </Pill>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-pretty">
            {rounding === 0
              ? 'Cada precio queda al peso, sin centavos.'
              : 'Cada precio va al múltiplo más cercano. Ninguno queda en $ 0.'}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className={SHEET_QUESTION}>Así quedan</h3>
          <div data-testid="bulk-preview" className="rounded-2xl bg-secondary/50 p-4 sm:p-5">
            {percentBp === null ? (
              <p aria-live="polite" className="text-sm text-muted-foreground text-pretty">
                {choice === 'custom'
                  ? 'Escribí el porcentaje para ver cómo quedan los precios.'
                  : 'Elegí cuánto para ver cómo quedan los precios, uno por uno, antes de cambiar nada.'}
              </p>
            ) : points.length === 0 ? (
              <p aria-live="polite" className="text-sm text-muted-foreground text-pretty">
                {scope.kind === 'categories'
                  ? 'Elegí al menos una categoría para ver cómo quedan los precios.'
                  : 'No hay productos para cambiar.'}
              </p>
            ) : summary.productCount === 0 ? (
              <p aria-live="polite" className="text-sm text-pretty">
                <span className="font-medium">Ningún precio cambia.</span>{' '}
                <span className="text-muted-foreground">
                  Con este porcentaje y este redondeo todos quedan igual: probá con un redondeo más
                  chico.
                </span>
              </p>
            ) : (
              <>
                <p aria-live="polite" className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span
                    data-testid="bulk-count"
                    className="font-serif text-5xl leading-none font-semibold tracking-tight"
                  >
                    {summary.productCount}
                  </span>
                  <span className="text-sm text-muted-foreground text-pretty">
                    {one ? 'producto' : 'productos'} {verb} un {percentText(percentBp)}
                    {rounding > 0
                      ? `, ${one ? 'redondeado' : 'redondeados'} a ${formatCentsShort(rounding)}`
                      : ''}
                    {branch ? ` en ${branch.name}` : ''}.
                  </span>
                </p>

                <ul
                  aria-label="Algunos ejemplos"
                  className="mt-4 divide-y divide-border/60 border-y border-border/60"
                >
                  {summary.examples.map((line) => (
                    <LineRow key={line.itemId} line={line} />
                  ))}
                </ul>

                {summary.smallest && summary.largest && summary.productCount > 1 ? (
                  delta(summary.smallest) === delta(summary.largest) ? (
                    <p className="mt-3 text-sm text-pretty">
                      Todos {verb} {delta(summary.smallest)}.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-1 text-sm text-pretty">
                      <p>
                        <span className="text-muted-foreground">
                          El que menos {down ? 'baja' : 'sube'}:
                        </span>{' '}
                        {summary.smallest.name}, {delta(summary.smallest)} {more}.
                      </p>
                      <p>
                        <span className="text-muted-foreground">
                          El que más {down ? 'baja' : 'sube'}:
                        </span>{' '}
                        {summary.largest.name}, {delta(summary.largest)} {more}.
                      </p>
                    </div>
                  )
                ) : null}

                {newOwn > 0 && branch ? (
                  <p className="mt-3 text-sm text-muted-foreground text-pretty">
                    {newOwn === 1
                      ? `1 pasa a tener precio propio en ${branch.name}.`
                      : `${newOwn} pasan a tener precio propio en ${branch.name}.`}
                  </p>
                ) : null}

                <button
                  type="button"
                  aria-expanded={showAll}
                  data-testid="bulk-show-all"
                  onClick={() => setShowAll((value) => !value)}
                  className="mt-3 inline-flex min-h-6 items-center rounded-sm text-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
                >
                  {showAll
                    ? 'Ocultar la lista'
                    : one
                      ? 'Ver el producto'
                      : `Ver los ${result.changed.length} precios que cambian`}
                </button>
                {showAll ? (
                  <ul
                    aria-label="Todos los precios que cambian"
                    className="mt-2 divide-y divide-border/60 border-y border-border/60"
                  >
                    {result.changed.map((line) => (
                      <LineRow
                        key={`${line.branchId ?? 'carta'}:${line.itemId}`}
                        line={line}
                        tag={tagOf(line)}
                      />
                    ))}
                  </ul>
                ) : null}
              </>
            )}

            {percentBp !== null && summary.unchangedCount > 0 && summary.productCount > 0 ? (
              <details className="group/same mt-3 text-sm">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden
                    className="size-3.5 transition-transform duration-(--duration-fast) group-open/same:rotate-90 motion-reduce:transition-none"
                  />
                  {summary.unchangedCount === 1
                    ? '1 producto queda igual'
                    : `${summary.unchangedCount} productos quedan igual`}
                </summary>
                <p className="mt-1.5 text-muted-foreground text-pretty">
                  {result.unchanged
                    .slice(0, MAX_LISTED)
                    .map((line) => line.name)
                    .join(', ')}
                  {result.unchanged.length > MAX_LISTED
                    ? ` y ${result.unchanged.length - MAX_LISTED} más`
                    : ''}
                  . Con este redondeo quedan en el mismo precio (o cuestan $ 0).
                </p>
              </details>
            ) : null}
          </div>

          {view === null && ownInScope > 0 ? (
            <label
              htmlFor={ownSwitchId}
              className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/70 bg-card p-3 sm:p-4"
            >
              <Switch
                id={ownSwitchId}
                checked={includeOwn}
                onCheckedChange={setIncludeOwn}
                disabled={applying}
                aria-labelledby={ownLabelId}
                data-testid="bulk-own-switch"
                className="mt-0.5"
              />
              <span id={ownLabelId} className="min-w-0 text-sm text-pretty">
                <span className="font-medium">
                  {ownInScope === 1
                    ? 'También el precio propio que tiene una sucursal'
                    : `También los ${ownInScope} precios propios de las sucursales`}
                </span>
                <span className="block text-muted-foreground">
                  {includeOwn
                    ? `${ownInScope === 1 ? 'Cambia' : 'Cambian'} en la misma proporción, para que no ${ownInScope === 1 ? 'quede atrasado' : 'queden atrasados'}.`
                    : `${ownInScope === 1 ? 'Queda' : 'Quedan'} como ${ownInScope === 1 ? 'está' : 'están'}: solo cambia el precio de la carta.`}
                </span>
              </span>
            </label>
          ) : null}
        </section>
      </SideSheetBody>

      <SideSheetFooter>
        {error ? (
          <p
            role="alert"
            data-testid="bulk-error"
            className="mb-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-pretty"
          >
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          data-testid="bulk-apply"
          disabled={!ready || applying}
          onClick={apply}
          // Apagado dice qué falta («Elegí cuánto»): tiene que poder leerse, así que no se
          // desvanece como un botón apagado común, se vuelve una franja quieta.
          className="h-auto min-h-12 w-full px-6 py-2 text-base leading-tight font-semibold whitespace-normal disabled:bg-secondary disabled:text-secondary-foreground disabled:opacity-100 disabled:shadow-none"
        >
          {applying ? (
            <>
              <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
              Cambiando {result.changed.length} precios…
            </>
          ) : ready && percentBp !== null ? (
            bulkButtonLabel({
              count: summary.productCount,
              percentBp,
              branchName: branch?.name ?? null,
            })
          ) : percentBp === null ? (
            choice === 'custom' ? (
              'Falta el porcentaje'
            ) : (
              'Elegí cuánto'
            )
          ) : (
            'No hay precios para cambiar'
          )}
        </Button>
      </SideSheetFooter>
    </>
  )
}

/**
 * «Aumentar precios»: tres preguntas (a qué productos, cuánto, cómo se redondea) y, antes de
 * aplicar, cómo quedan. El botón dice exactamente lo que va a pasar.
 */
export function BulkSheet({
  open,
  onOpenChange,
  tree,
  items,
  overrides,
  branches,
  view,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tree: CategoryTree
  /** Con el precio de la carta al día. */
  items: ReadonlyArray<PriceItem>
  overrides: ReadonlyArray<BranchOverride>
  branches: ReadonlyArray<PriceBranch>
  view: ViewId
  onApply: (request: BulkRequest) => Promise<BulkOutcome>
}) {
  const branch = view === null ? null : (branches.find((entry) => entry.id === view) ?? null)
  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      testId="bulk-sheet"
      title={
        branch ? (
          <span className="inline-flex flex-wrap items-center gap-x-2">
            Aumentar precios en
            <span className="inline-flex items-center gap-2">
              <BranchDot color={branch.color} className="size-3" />
              {branch.name}
            </span>
          </span>
        ) : (
          'Aumentar precios'
        )
      }
      description={
        branch
          ? `Solo cambia lo que se cobra en ${branch.name}. Antes de aplicar ves cómo quedan, y después lo podés deshacer.`
          : 'Elegí a qué productos y cuánto. Antes de aplicar ves cómo quedan, y después lo podés deshacer.'
      }
    >
      <BulkForm
        tree={tree}
        items={items}
        overrides={overrides}
        branches={branches}
        view={view}
        onApply={onApply}
      />
    </SideSheet>
  )
}
