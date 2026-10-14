'use client'

import { Check, ChevronDown, Sparkles } from 'lucide-react'
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useMemo,
  useState,
} from 'react'
import { cn } from '@/lib/utils'
import {
  type CategoryGroup,
  type CategoryOption,
  categoryGroups,
  categoryShortName,
  FIXED_ASSETS_GROUP_ID,
  FIXED_ASSETS_GROUP_NOTE,
} from './category'

/**
 * «¿En qué se gastó?» sin combo ni códigos: la categoría se elige tocando un
 * chip. Las filas van de lo más probable a lo menos:
 *
 *   Elegida           (solo si la elegida no es un chip: ver `outside`)
 *   Sugerida          (si hay; si es mercadería, se marca en su fila y no se repite)
 *   Mercadería        lo que un bar le compra a casi todos (`featured`)
 *   Las que más usás  (`pinned`)
 *   Otra cosa         los grupos del plan; al tocar uno se abren sus categorías
 *
 * La elegida va RELLENA y debajo, en gris, su nombre contable. Tocarla de
 * nuevo la saca (`onChange(null, null)`). Elegir NO sigue al foco: con el
 * teclado se recorre con Tab o con las flechas y se elige con Enter o Espacio
 * (hay pantallas donde elegir guarda y pasa al siguiente).
 *
 * `outside`: la cuenta elegida cuando NO está entre las opciones (la eligió en
 * «Ver el plan completo», o el proveedor ya tenía una cuenta que no es de las
 * rápidas, o una inactiva). Pasala siempre que tu formulario pueda tener una
 * cuenta así: la pieza la dibuja arriba como chip relleno, rotulada «Elegida»,
 * con su línea «En los libros va a…». Sin `outside`, un `value` que no es una
 * opción no marca nada y la pantalla parece «sin categoría».
 *
 * Con `invalid`, el grupo lleva `aria-invalid` y se deja enfocar desde afuera:
 * `querySelector('[aria-invalid="true"]')?.focus()` (lo que hacen los
 * formularios de la sección) cae en el chip elegido o en el primero.
 *
 * Las opciones se arman con `categoryOptions()` de `./category`; `featured`
 * con `featuredCategories()` y `pinned` con `topCategories()`. «Ver el plan
 * completo» llama a `onOpenFullPlan`: quien la usa muestra ahí su
 * `AccountCombobox`. La pregunta («¿En qué se gastó?», «¿En qué le comprás a
 * …?», «¿En qué se gasta?») la escribe la pantalla y se pasa por
 * `aria-labelledby`.
 *
 * Cuándo NO: para una contrapartida que no es un gasto (un aporte de un
 * socio, un impuesto desconocido, una cuenta del asiento manual): ahí sigue
 * `AccountCombobox`. Tampoco en las pantallas de la contadora.
 */

// El radio es la mitad de los 44 px: con un renglón es una píldora; si el nombre
// no entra en el ancho (un celular angosto), baja a dos renglones y queda como
// una tarjetita. Nunca se corta con «…»: un nombre a medias no dice qué es.
const CHIP_BASE =
  'inline-flex max-w-full items-center gap-1.5 rounded-[1.375rem] border text-left font-medium leading-tight transition-colors duration-(--duration-fast) outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none'
const CHIP_TEXT = 'min-w-0 text-pretty [overflow-wrap:anywhere]'

const CHIP_SIZE = {
  // 44 px en el celular, como todo lo que se toca; 36 con mouse.
  default: 'min-h-11 px-4 py-1.5 text-sm md:min-h-9 md:px-3.5 md:py-1 md:text-[13px]',
  // Para las cargas de una cosa por vez (clasificar proveedores).
  touch: 'min-h-11 px-4 py-1.5 text-sm',
} as const

const CHIP_ON = 'border-primary bg-primary text-primary-foreground shadow-xs'
const CHIP_OFF = 'border-border bg-card text-foreground hover:bg-cream-tint'
const ROW_LABEL =
  'mb-2 p-0 text-[11px] font-semibold uppercase leading-none tracking-[0.12em] text-muted-foreground'
/** Un fieldset sin su marco ni su ancho mínimo de fábrica. */
const FIELDSET = 'm-0 min-w-0 border-0 p-0'

type Size = keyof typeof CHIP_SIZE

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Un grupo con una sola categoría que se llama igual no se abre: es esa categoría. */
function soleOption(group: CategoryGroup): CategoryOption | null {
  const only = group.options.length === 1 ? group.options[0] : undefined
  return only && sameName(only.shortName, group.name) ? only : null
}

function CategoryChip({
  option,
  chosen,
  size,
  invalid,
  icon,
  srPrefix,
  onToggle,
}: {
  option: CategoryOption
  chosen: boolean
  size: Size
  invalid: boolean
  icon?: ReactNode
  /** Lo que se le antepone para lectores: «Sugerida: ». */
  srPrefix?: string
  onToggle: (option: CategoryOption) => void
}) {
  return (
    <button
      type="button"
      data-category-chip=""
      aria-pressed={chosen}
      title={option.name}
      onClick={() => onToggle(option)}
      className={cn(
        CHIP_BASE,
        CHIP_SIZE[size],
        chosen ? CHIP_ON : CHIP_OFF,
        invalid && !chosen && 'border-destructive/60',
      )}
    >
      {chosen ? <Check aria-hidden className="size-3.5 shrink-0" strokeWidth={3} /> : icon}
      {srPrefix ? <span className="sr-only">{srPrefix}</span> : null}
      <span className={CHIP_TEXT}>{option.shortName}</span>
    </button>
  )
}

function ChipRow({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <fieldset className={FIELDSET}>
      <legend className={ROW_LABEL}>{label}</legend>
      {/* Los chips van en un div: un fieldset no siempre se deja armar con flex. */}
      <div className="flex flex-wrap gap-2">{children}</div>
      {hint}
    </fieldset>
  )
}

export function CategoryPicker({
  options,
  value,
  onChange,
  featured,
  pinned,
  suggestedId = null,
  size = 'default',
  onOpenFullPlan,
  invalid = false,
  outside = null,
  id,
  'aria-labelledby': ariaLabelledBy,
}: {
  /** De `categoryOptions()`. */
  options: readonly CategoryOption[]
  value: string | null
  /** `null` cuando se saca la elegida. */
  onChange: (id: string | null, option: CategoryOption | null) => void
  /** Ids de la fila «Mercadería» (`featuredCategories()`), en el orden en que se muestran. */
  featured?: readonly string[]
  /** Ids de «Las que más usás» (`topCategories()`). */
  pinned?: readonly string[]
  /**
   * La que el sistema cree que es. Va primera, rotulada «Sugerida»; si es
   * mercadería, se marca en esa fila (no sale dos veces). No se elige sola.
   */
  suggestedId?: string | null
  size?: Size
  /** «Ver el plan completo»: sin esto, el link no se dibuja. */
  onOpenFullPlan?: () => void
  invalid?: boolean
  /**
   * La cuenta elegida cuando no es una de las `options` (plan completo, cuenta
   * inactiva o no «rápida»). Solo se dibuja si `value === outside.id`.
   */
  outside?: { id: string; name: string } | null
  id?: string
  /** El id de la pregunta visible. */
  'aria-labelledby'?: string
}) {
  const trayId = useId()
  const view = useMemo(() => {
    const byId = new Map(options.map((o) => [o.id, o]))
    const pick = (ids: readonly string[] | undefined, skip: ReadonlySet<string>) => {
      const seen = new Set<string>()
      const out: CategoryOption[] = []
      for (const optionId of ids ?? []) {
        const option = byId.get(optionId)
        if (!option || skip.has(optionId) || seen.has(optionId)) continue
        seen.add(optionId)
        out.push(option)
      }
      return out
    }
    const suggested = suggestedId ? (byId.get(suggestedId) ?? null) : null
    const featuredRow = pick(featured, new Set())
    const featuredIds = new Set(featuredRow.map((o) => o.id))
    // Un mismo chip nunca sale dos veces a la vista: si la sugerida es
    // mercadería (lo normal en los proveedores de un bar), se marca en su fila
    // y no se dibuja la fila «Sugerida».
    const suggestedAlone = suggested !== null && !featuredIds.has(suggested.id) ? suggested : null
    // «Las que más usás» no repite lo que ya está a la vista arriba.
    const pinnedRow = pick(pinned, new Set([...featuredIds, ...(suggested ? [suggested.id] : [])]))
    const shownAbove = new Set([
      ...featuredIds,
      ...pinnedRow.map((o) => o.id),
      ...(suggested ? [suggested.id] : []),
    ])
    // «Otra cosa»: todo el plan menos la mercadería, que ya tiene su fila, y
    // menos los chips directos que ya están arriba (un grupo que se abre sí
    // muestra todas las suyas: ahí la persona fue a buscar).
    const groups = categoryGroups(options.filter((o) => !featuredIds.has(o.id))).filter((group) => {
      const sole = soleOption(group)
      return !(sole && shownAbove.has(sole.id))
    })
    return { byId, suggested, suggestedAlone, featuredRow, pinnedRow, groups, shownAbove }
  }, [options, featured, pinned, suggestedId])

  const chosen = value === null ? null : (view.byId.get(value) ?? null)
  // La elegida que no es un chip: se dibuja aparte, arriba.
  const chosenOutside =
    chosen === null && value !== null && outside && outside.id === value ? outside : null
  const hasChosen = chosen !== null || chosenOutside !== null
  // `undefined` = nadie tocó un grupo todavía: se abre solo el de la elegida,
  // si no está a la vista en las filas de arriba.
  const [opened, setOpened] = useState<string | null | undefined>(undefined)
  const chosenGroupId =
    chosen && !view.shownAbove.has(chosen.id)
      ? (view.groups.find((g) => g.options.some((o) => o.id === chosen.id))?.id ?? null)
      : null
  const openId = opened === undefined ? chosenGroupId : opened
  const openGroup = view.groups.find((g) => g.id === openId && soleOption(g) === null) ?? null

  const toggle = (option: CategoryOption) => {
    if (option.id === value) onChange(null, null)
    else onChange(option.id, option)
  }

  // Las flechas mueven el foco entre los chips (no eligen). Tab también anda.
  const onKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0 || !(event.target instanceof HTMLElement)) return
    const chips = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[data-category-chip]'),
    ].filter((chip) => !chip.hasAttribute('disabled'))
    const from = chips.indexOf(event.target)
    if (from === -1) return
    event.preventDefault()
    chips[(from + step + chips.length) % chips.length]?.focus()
  }

  // El foco puesto en el grupo desde afuera (el primer `[aria-invalid="true"]`
  // de un formulario, un `getElementById(id).focus()`) pasa al chip elegido o,
  // si no hay, al primero. Misma receta que `TreasuryPicker`.
  const onGroupFocus = (event: FocusEvent<HTMLFieldSetElement>) => {
    if (event.target !== event.currentTarget) return
    const group = event.currentTarget
    const target =
      group.querySelector<HTMLElement>('[data-category-chip][aria-pressed="true"]') ??
      group.querySelector<HTMLElement>('[data-category-chip]')
    target?.focus()
  }

  const sparkle = <Sparkles aria-hidden className="size-3.5 shrink-0 opacity-70" />
  // `row`: la sugerida en su propia fila (el rótulo ya lo dice). `inline`: la
  // sugerida marcada dentro de otra fila; ahí lo dice el chip, para lectores.
  const chip = (option: CategoryOption, suggested?: 'row' | 'inline') => (
    <CategoryChip
      key={option.id}
      option={option}
      chosen={option.id === value}
      size={size}
      invalid={invalid}
      icon={suggested ? sparkle : undefined}
      srPrefix={suggested === 'inline' ? 'Sugerida: ' : undefined}
      onToggle={toggle}
    />
  )

  return (
    // La pregunta visible es de quien la usa: llega por `aria-labelledby`.
    <fieldset
      id={id}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabelledBy ? undefined : 'Categoría'}
      aria-invalid={invalid || undefined}
      // Enfocable solo por código: no suma una parada de Tab.
      tabIndex={-1}
      onFocus={onGroupFocus}
      onKeyDown={onKeyDown}
      className={cn(FIELDSET, 'outline-none')}
    >
      <div className="flex flex-col gap-4">
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground text-pretty">
            Todavía no hay categorías para elegir.
          </p>
        ) : null}

        {chosenOutside ? (
          <ChipRow label="Elegida">
            <button
              type="button"
              data-category-chip=""
              aria-pressed
              title={chosenOutside.name}
              onClick={() => onChange(null, null)}
              className={cn(CHIP_BASE, CHIP_SIZE[size], CHIP_ON)}
            >
              <Check aria-hidden className="size-3.5 shrink-0" strokeWidth={3} />
              <span className={CHIP_TEXT}>{categoryShortName(chosenOutside.name)}</span>
            </button>
          </ChipRow>
        ) : null}

        {view.suggestedAlone ? (
          <ChipRow label="Sugerida">{chip(view.suggestedAlone, 'row')}</ChipRow>
        ) : null}

        {view.featuredRow.length > 0 ? (
          <ChipRow label="Mercadería">
            {view.featuredRow.map((option) =>
              chip(option, option.id === view.suggested?.id ? 'inline' : undefined),
            )}
          </ChipRow>
        ) : null}

        {view.pinnedRow.length > 0 ? (
          <ChipRow label="Las que más usás">{view.pinnedRow.map((option) => chip(option))}</ChipRow>
        ) : null}

        {view.groups.length > 0 ? (
          <ChipRow
            // Sin filas arriba no hay «otra» cosa: son todas.
            label={
              view.suggestedAlone || view.featuredRow.length > 0 || view.pinnedRow.length > 0
                ? 'Otra cosa'
                : 'Categorías'
            }
            hint={
              openGroup ? (
                <fieldset
                  id={trayId}
                  aria-label={openGroup.name}
                  className="m-0 mt-2 min-w-0 space-y-2 rounded-xl border-0 bg-secondary/50 p-2.5"
                >
                  <div className="flex flex-wrap gap-2">
                    {openGroup.options.map((option) => chip(option))}
                  </div>
                  {openGroup.id === FIXED_ASSETS_GROUP_ID ? (
                    <p className="px-1 text-xs text-muted-foreground text-pretty">
                      {FIXED_ASSETS_GROUP_NOTE}
                    </p>
                  ) : null}
                </fieldset>
              ) : null
            }
          >
            {view.groups.map((group) => {
              const sole = soleOption(group)
              if (sole) return chip(sole)
              const open = openGroup?.id === group.id
              const holdsChosen = chosen !== null && group.options.some((o) => o.id === chosen.id)
              return (
                <button
                  key={group.id}
                  type="button"
                  data-category-chip=""
                  aria-expanded={open}
                  aria-controls={open ? trayId : undefined}
                  onClick={() => setOpened(open ? null : group.id)}
                  className={cn(
                    CHIP_BASE,
                    CHIP_SIZE[size],
                    // Un grupo no es una elección: abierto se marca con fondo, nunca relleno.
                    open
                      ? 'border-foreground/25 bg-secondary text-foreground'
                      : 'border-border bg-secondary/40 text-foreground hover:bg-secondary',
                    invalid && !hasChosen && !open && 'border-destructive/60',
                  )}
                >
                  {holdsChosen && !open ? (
                    <>
                      <Check
                        aria-hidden
                        className="size-3.5 shrink-0 text-primary"
                        strokeWidth={3}
                      />
                      <span className="sr-only">Tiene la elegida: </span>
                    </>
                  ) : null}
                  <span className={CHIP_TEXT}>{group.name}</span>
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      'size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
                      open && 'rotate-180',
                    )}
                  />
                </button>
              )
            })}
          </ChipRow>
        ) : null}

        {hasChosen || onOpenFullPlan ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {hasChosen ? (
              <p className="min-w-0 text-xs text-muted-foreground text-pretty">
                En los libros va a «{chosen?.name ?? chosenOutside?.name}».
              </p>
            ) : null}
            {onOpenFullPlan ? (
              <button
                type="button"
                onClick={onOpenFullPlan}
                className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
              >
                Ver el plan completo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </fieldset>
  )
}
