'use client'

import { Repeat, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { type CSSProperties, type KeyboardEvent, type ReactNode, useMemo, useRef } from 'react'
import { type ComboOption, EntityCombobox } from '@/components/administracion/entity-combobox'
import { type CategoryOption, categoryShortName } from '@/components/administracion/kit'
import { normalizeText, rankText } from '@/components/administracion/search'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { VoucherType } from '@/lib/accounting/types'
import { VOUCHER_CATALOG } from '@/lib/accounting/voucher-types'
import { formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { DueTerm, LetterBox, PaperPick } from '../../_lib/purchase-paper'

/**
 * Las piezas de la factura que solo dibujan: el campo con su rótulo chico, el recuadro de la letra, las
 * dos opciones de pago y la línea del plazo. El estado, las validaciones y el envío viven en
 * `purchase-form.tsx`: nada de acá guarda ni decide qué se manda.
 */

/** Un link callado adentro del papel («Tiene número», «Sin fecha»). 44 px en el celular. */
export const PAPER_LINK =
  'inline-flex min-h-11 items-center gap-1 justify-self-start rounded-sm text-xs font-medium text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:min-h-0'

/** Un campo del papel: el rótulo chico y gris de las facturas, su ayuda y su error en su lugar. */
export function PaperField({
  id,
  label,
  optional,
  required,
  hint,
  error,
  aside,
  className,
  children,
}: {
  id?: string
  label: ReactNode
  optional?: boolean
  required?: boolean
  hint?: ReactNode
  error?: string
  /** Algo chico a la derecha del rótulo. */
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    // `minmax(0, 1fr)`: con la columna automática de un `grid` pelado, un campo de fecha o un nombre
    // largo estiran la columna y se salen del papel.
    <div className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-0.5 text-destructive">
              *
            </span>
          ) : null}
          {optional ? <span className="ml-1 font-normal opacity-80">(opcional)</span> : null}
        </label>
        {aside}
      </div>
      {children}
      {hint ? (
        <p id={id ? `${id}-hint` : undefined} className="text-xs text-muted-foreground text-pretty">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={id ? `${id}-error` : undefined} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Un campo que se acaba de completar con el QR: se enciende un momento, uno atrás del otro. Solo
 * dibuja el destello. Sin `delay`, el campo queda tal cual.
 */
export function FlashCell({
  delay,
  className,
  children,
}: {
  /** En milisegundos. `null`: no se enciende. */
  delay: number | null
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn('rounded-md', delay !== null && 'adm-flash', className)}
      style={delay !== null ? ({ '--adm-flash-delay': `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  )
}

// ─── El recuadro de la letra ─────────────────────────────────────────────────

/** El recuadro colgando del borde de la factura: la letra en Fraunces y su código abajo. */
export function LetterStamp({ box }: { box: LetterBox }) {
  const reduceMotion = useReducedMotion() ?? false
  return (
    <div className="flex h-[58px] w-[62px] flex-col items-center justify-center border-x-[1.5px] border-b-[1.5px] border-foreground">
      <motion.span
        key={box.mark}
        initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.3, 1.25, 0.4, 1] }}
        className={cn(
          'block leading-none',
          box.word ? 'text-[15px] font-semibold' : 'font-serif text-[32px] font-semibold',
        )}
      >
        {box.mark}
      </motion.span>
      {box.code ? (
        <small className="mt-0.5 text-[8.5px] leading-none font-medium tracking-[0.04em] text-muted-foreground">
          {box.code}
        </small>
      ) : null}
    </div>
  )
}

/** A, B, C, Tique, Remito. Radio de WAI-ARIA: flechas para moverse, una sola parada de Tab. */
export function PaperPicks({
  picks,
  value,
  invalid,
  onPick,
}: {
  picks: readonly PaperPick[]
  value: VoucherType | null
  invalid?: boolean
  onPick: (type: VoucherType) => void
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const focusable = picks.some((pick) => pick.type === value) ? value : picks[0]?.type

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (delta === 0) return
    event.preventDefault()
    const next = (index + delta + picks.length) % picks.length
    const pick = picks[next]
    if (!pick) return
    onPick(pick.type)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tipo de comprobante"
      aria-invalid={invalid ? true : undefined}
      className="grid w-full grid-cols-3 gap-[3px] px-[7px] pt-0.5 pb-2.5"
    >
      {picks.map((pick, index) => {
        const on = pick.type === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: radiogroup de WAI-ARIA con botones (flechas y una sola parada de Tab)
          <button
            key={pick.type}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={VOUCHER_CATALOG[pick.type].label}
            tabIndex={pick.type === focusable ? 0 : -1}
            onClick={() => onPick(pick.type)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'min-h-11 rounded-md border text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:min-h-0 md:py-[3px]',
              pick.wide && 'col-span-3',
              on
                ? 'border-primary bg-primary font-semibold text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground',
              invalid && !on && 'border-destructive/60',
            )}
          >
            {pick.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── La debo / Ya la pagué ───────────────────────────────────────────────────

/** Una de las dos opciones: toda la tarjeta se toca, y adentro puede haber algo más para escribir. */
function PayOption({
  checked,
  title,
  onSelect,
  children,
}: {
  checked: boolean
  title: string
  onSelect: () => void
  children: ReactNode
}) {
  // Una sola parada de Tab en el grupo: con las flechas se pasa a la otra (`PayOptions`).
  return (
    <div
      className={cn(
        'relative grid min-h-11 content-start gap-0.5 rounded-lg border px-2.5 py-1.5 transition-colors motion-reduce:transition-none',
        checked
          ? 'border-primary bg-primary/[0.06] shadow-[inset_0_0_0_1px_var(--primary)]'
          : 'border-border hover:border-primary',
      )}
    >
      {/* El botón cubre la tarjeta. Lo que se escribe adentro va por encima (`z-10`). */}
      {/* biome-ignore lint/a11y/useSemanticElements: la tarjeta entera es la opción; un input radio no puede contener el campo del plazo */}
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        tabIndex={checked ? 0 : -1}
        onClick={onSelect}
        className="text-left text-sm font-semibold outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        {title}
      </button>
      {children}
    </div>
  )
}

/**
 * «La debo: a 21 días, como siempre» y «Ya la pagué». Son la misma pregunta que el segmento de arriba:
 * cualquiera de las dos cambia la otra.
 */
export function PayOptions({
  paying,
  onChange,
  debtLine,
  paidLine,
}: {
  paying: boolean
  onChange: (paying: boolean) => void
  /** Lo que va debajo de «La debo»: el plazo. */
  debtLine: ReactNode
  paidLine: ReactNode
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // El plazo también vive acá adentro: las flechas de ese campo son de ese campo.
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'radio') {
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    onChange(!paying)
    const radios = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')
    radios[paying ? 0 : 1]?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label="¿Cómo queda?"
      onKeyDown={onKeyDown}
      className="grid gap-[7px] @lg:grid-cols-2"
    >
      <PayOption checked={!paying} title="La debo" onSelect={() => onChange(false)}>
        {debtLine}
      </PayOption>
      <PayOption checked={paying} title="Ya la pagué" onSelect={() => onChange(true)}>
        {paidLine}
      </PayOption>
    </div>
  )
}

/** La línea de «La debo»: «A [21] días, como siempre». Solo con la opción elegida se puede escribir. */
export function DueTermLine({
  id,
  term,
  editable,
  value,
  onChange,
  onBlur,
  onNoDate,
  onSuggestion,
  onPutTerm,
  invalid,
}: {
  id: string
  term: DueTerm
  editable: boolean
  /** Lo que se está tipeando. */
  value: string
  onChange: (text: string) => void
  onBlur: () => void
  onNoDate: () => void
  onSuggestion: (days: number) => void
  /** Volver a un plazo, después de «Sin fecha». */
  onPutTerm: () => void
  invalid?: boolean
}) {
  if (term.days === null) {
    return (
      <span className="relative z-10 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        Sin fecha de pago
        {editable ? (
          <button type="button" className={cn(PAPER_LINK, 'ml-auto')} onClick={onPutTerm}>
            Poner plazo
          </button>
        ) : null}
      </span>
    )
  }
  const words = term.note ? `, ${term.note}` : ''
  if (!editable) {
    return (
      <span className="text-xs text-muted-foreground">
        {term.days > 0 ? `A ${term.days} días${words}` : 'Vence en el día'}
      </span>
    )
  }
  return (
    <span className="relative z-10 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        A
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={3}
          value={value}
          aria-label="Días de plazo"
          aria-invalid={invalid ? true : undefined}
          placeholder="0"
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
          onBlur={onBlur}
          className="h-9 w-11 rounded-md border border-input bg-background/60 text-center text-base text-foreground tabular-nums outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none md:h-6 md:w-9 md:text-xs"
        />
        días{words}
      </span>
      {term.suggestion !== null ? (
        <button
          type="button"
          className={PAPER_LINK}
          onClick={() => term.suggestion !== null && onSuggestion(term.suggestion)}
        >
          ¿A {term.suggestion}, como las últimas?
        </button>
      ) : null}
      <button type="button" className={cn(PAPER_LINK, 'ml-auto')} onClick={onNoDate}>
        Sin fecha
      </button>
    </span>
  )
}

// ─── La categoría ────────────────────────────────────────────────────────────

/**
 * «Va a…»: la cuenta de la compra, en un combo. Los mismos nombres y grupos del selector de chips
 * (`categoryOptions`), con lo que más se usa primero: acá no entran las filas de chips.
 */
export function CategoryCombobox({
  id,
  value,
  selectedName,
  options,
  featured,
  pinned,
  onChange,
  invalid,
  describedBy,
  ariaLabel,
}: {
  id: string
  value: string | null
  /** El nombre contable de lo elegido, aunque no sea una de las opciones. */
  selectedName: string | null
  options: readonly CategoryOption[]
  featured: readonly string[]
  pinned: readonly string[]
  onChange: (accountId: string) => void
  invalid?: boolean
  describedBy?: string
  ariaLabel?: string
}) {
  const ordered = useMemo(() => {
    const byId = new Map(options.map((option) => [option.id, option]))
    const pick = (ids: readonly string[]) =>
      ids.flatMap((optionId) => {
        const option = byId.get(optionId)
        return option ? [option] : []
      })
    const first = pick(pinned)
    const second = pick(featured).filter((option) => !pinned.includes(option.id))
    const taken = new Set([...first, ...second].map((option) => option.id))
    return { first, second, rest: options.filter((option) => !taken.has(option.id)) }
  }, [options, featured, pinned])

  const row = (option: CategoryOption, group: string | null): ComboOption => ({
    value: option.id,
    label: option.shortName,
    group,
  })

  const filter = (query: string): ComboOption[] => {
    const needle = normalizeText(query)
    if (!needle) {
      return [
        ...ordered.first.map((option) => row(option, 'Las que más usás')),
        ...ordered.second.map((option) => row(option, 'Mercadería')),
        ...ordered.rest.map((option) => row(option, option.groupName)),
      ]
    }
    return options
      .map((option) => ({
        option,
        rank: Math.min(
          ...[option.shortName, option.groupName, option.code]
            .map((text) => rankText(text, needle))
            .map((rank) => (rank < 0 ? 9 : rank)),
        ),
      }))
      .filter(({ rank }) => rank < 9)
      .sort((a, b) => a.rank - b.rank)
      .map(({ option }) => row(option, null))
  }

  return (
    <EntityCombobox
      id={id}
      value={value}
      selectedLabel={selectedName ? categoryShortName(selectedName) : undefined}
      filter={filter}
      onSelect={onChange}
      placeholder="Elegí en qué"
      searchPlaceholder="Buscar una categoría"
      invalid={invalid}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
    />
  )
}

// ─── El gasto fijo ───────────────────────────────────────────────────────────

/** «Es «Alquiler»: queda marcado como cargado este mes.» con su ✕ para desmarcarlo. */
export function RecurringLinked({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-success/30 bg-success/10 py-0.5 pr-0.5 pl-2.5 text-xs">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-pretty">
        <Repeat className="size-3.5 shrink-0 text-success" aria-hidden />
        Es «{name}»: queda cargado este mes.
      </span>
      <button
        type="button"
        aria-label={`No es «${name}»`}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:size-7"
        onClick={onClear}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

/** Los gastos fijos de este mes que son de ese proveedor: «Es «Alquiler» de octubre». */
export function RecurringOffers({
  options,
  onPick,
}: {
  options: ReadonlyArray<{ id: string; name: string; nextDueDate: string }>
  onPick: (id: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((recurring) => (
        <Button
          key={recurring.id}
          type="button"
          variant="outline"
          size="sm"
          className="h-11 max-w-full gap-1 text-xs md:h-7"
          onClick={() => onPick(recurring.id)}
        >
          <Repeat className="size-3 shrink-0" aria-hidden />
          <span className="truncate">
            Es «{recurring.name}» (vence el {formatIsoDay(recurring.nextDueDate)})
          </span>
        </Button>
      ))}
    </div>
  )
}

/**
 * «Compra y pago» sin proveedor: los gastos fijos de este mes, igual que «¿En qué?» de «Nuevo gasto».
 * Elegir uno trae su proveedor o su cuenta, el monto y la caja. En un desplegable: puede haber muchos.
 */
export function RecurringPicker({
  id,
  options,
  onPick,
}: {
  id: string
  options: ReadonlyArray<{ id: string; name: string; nextDueDate: string }>
  onPick: (id: string) => void
}) {
  if (options.length === 0) return null
  return (
    <PaperField id={id} label="¿Es un gasto fijo?" optional>
      {/* Siempre vacío: elegir uno lo marca arriba y este campo se va. */}
      <Select value="" onValueChange={onPick}>
        <SelectTrigger
          id={id}
          className="w-full data-[size=default]:h-11 md:data-[size=default]:h-9"
        >
          <SelectValue placeholder="Elegí uno de este mes" />
        </SelectTrigger>
        <SelectContent>
          {options.map((recurring) => (
            <SelectItem key={recurring.id} value={recurring.id} className="min-h-11 md:min-h-8">
              {recurring.name} · vence el {formatIsoDay(recurring.nextDueDate)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PaperField>
  )
}
