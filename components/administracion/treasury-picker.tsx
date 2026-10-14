'use client'

import { Sparkles } from 'lucide-react'
import { type FocusEvent, type KeyboardEvent, useRef } from 'react'
import { cn } from '@/lib/utils'
import { treasuryMoneyText } from './acciones/gasto-papel'
import { type TreasuryOption, TreasurySelect, type TreasurySelectProps } from './treasury-select'

/** Hasta cuántas cajas se muestran como píldoras (más: el desplegable). Lo normal en un bar son 2 a 4. */
const DEFAULT_MAX = 4

export type TreasuryPickerProps = TreasurySelectProps & {
  /** Con más cajas activas que esto, cae al desplegable. Por defecto 4. */
  max?: number
  /**
   * La caja que el sistema cree que es (la del banco de ese extracto, la que
   * se usó la última vez). Su píldora dice «Te sugiero»; NO se elige sola. En
   * el desplegable de más de `max` cajas no se muestra.
   */
  suggestedId?: string | null
}

/**
 * Elegir una caja o cuenta: las píldoras de «¿Con qué pagaste?» de «Nuevo
 * gasto», hechas pieza. Con hasta `max` cajas activas se ven todas, cada una
 * con su nombre y lo que tiene hoy («Caja $ 394.757», «Banco Descubierto
 * $ 12.000», «Visa Deuda $ 80.000»), y la elegida va rellena. El saldo va sin
 * centavos: es para ubicarse, no para controlar. Con más de `max`, cae al
 * `TreasurySelect` de siempre.
 *
 * Mismas props que `TreasurySelect`: cambiar uno por otro es cambiar el
 * nombre. Es un grupo de radios de verdad: una sola parada de Tab, flechas
 * para moverse. Pasale `aria-labelledby` con el `id` de su pregunta
 * (`SheetQuestion`); `id` y `aria-invalid` van en el grupo, así «ir al primer
 * campo con error» lo encuentra y el foco cae en la píldora elegida.
 *
 * `suggestedId` marca una píldora con «Te sugiero» (y lo dice a lectores:
 * «Banco Nación, $ 394.757, sugerida»). No la elige: una píldora rellena es
 * algo que la persona tocó.
 *
 * Si se dibujan píldoras o desplegable lo decide la cantidad de cajas del bar
 * (antes de `exclude`): en «Mover plata», elegir el origen no cambia la forma
 * del destino.
 *
 *   <SheetQuestion id={ids.cajaLabel} required>¿A dónde entró?</SheetQuestion>
 *   <TreasuryPicker aria-labelledby={ids.cajaLabel} value={treasuryId}
 *     onValueChange={setTreasuryId} treasuries={data.treasuries} excludeCards
 *     invalid={Boolean(errors.treasuryAccountId)} />
 *
 * Cuándo NO:
 * - para MOSTRAR una caja (su saldo, su estado): eso es `WalletCard`;
 * - cuando hace falta la opción «ninguna» («Lo elijo cada vez» de un gasto
 *   fijo): ahí van `ChoiceChips` a mano, con esa opción adelante;
 * - en una grilla o una tabla con una caja por renglón (el asiento manual, las
 *   reglas del banco): ahí sigue `TreasurySelect`, que ocupa un solo renglón.
 */
export function TreasuryPicker({
  max = DEFAULT_MAX,
  suggestedId = null,
  ...props
}: TreasuryPickerProps) {
  const {
    id,
    name,
    value,
    onValueChange,
    treasuries,
    exclude = [],
    excludeCards = false,
    disabled = false,
    invalid = false,
    className,
  } = props
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  // Las cajas del bar que valen para esta pregunta (misma regla que el desplegable).
  const candidates = treasuries.filter(
    (t) => (t.active !== false || t.id === value) && !(excludeCards && t.kind === 'credit_card'),
  )
  if (candidates.length > max) return <TreasurySelect {...props} />

  const options = candidates.filter((t) => !exclude.includes(t.id))
  if (options.length === 0) {
    return (
      <p id={id} className={cn('text-sm text-muted-foreground', className)}>
        {candidates.length === 0
          ? 'No hay cajas ni cuentas activas.'
          : 'No hay otra caja ni cuenta para elegir.'}
      </p>
    )
  }

  const checked = options.some((t) => t.id === value) ? value : null
  // La parada de Tab del grupo: la elegida o, si no hay, la primera.
  const tabStop = checked ?? options[0]?.id ?? null

  const pick = (treasury: TreasuryOption) => {
    if (!disabled) onValueChange(treasury.id, treasury)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (delta === 0) return
    event.preventDefault()
    const next = (index + delta + options.length) % options.length
    const option = options[next]
    if (!option) return
    pick(option)
    refs.current[next]?.focus()
  }

  // El foco puesto en el grupo desde afuera (el primer `[aria-invalid]`, un
  // `getElementById(id).focus()`) pasa a la píldora que corresponde.
  const onGroupFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const index = options.findIndex((t) => t.id === tabStop)
    refs.current[index]?.focus()
  }

  return (
    <div
      id={id}
      role="radiogroup"
      tabIndex={-1}
      aria-labelledby={props['aria-labelledby']}
      aria-label={props['aria-labelledby'] ? undefined : (props['aria-label'] ?? 'Caja o cuenta')}
      aria-describedby={props['aria-describedby']}
      aria-invalid={invalid ? true : undefined}
      aria-disabled={disabled ? true : undefined}
      onFocus={onGroupFocus}
      // `min-w-0`: dentro de un `grid` sin columnas, una caja de nombre largo no estira la
      // columna (y con ella toda la hoja); se corta el nombre, que para eso lleva `truncate`.
      className={cn('flex min-w-0 flex-wrap gap-2 outline-none', className)}
    >
      {name ? <input type="hidden" name={name} value={checked ?? ''} /> : null}
      {options.map((t, index) => {
        const active = t.id === checked
        const balance = treasuryMoneyText(t.kind, t.balanceCents)
        const overdrawn = t.kind !== 'credit_card' && t.balanceCents < 0
        const suggested = suggestedId !== null && t.id === suggestedId
        return (
          // biome-ignore lint/a11y/useSemanticElements: radiogroup de WAI-ARIA con botones (píldoras con flechas y una sola parada de Tab)
          <button
            key={t.id}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${t.name}, ${balance}${suggested ? ', sugerida' : ''}`}
            disabled={disabled}
            tabIndex={t.id === tabStop ? 0 : -1}
            onClick={() => pick(t)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'inline-flex h-11 max-w-full items-center gap-1.5 rounded-full border px-4 text-sm font-medium md:h-9',
              'transition-[color,background-color,border-color,scale] duration-(--duration-fast) ease-(--ease-out)',
              'active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-secondary',
              invalid && !active && 'border-destructive/60',
            )}
          >
            {suggested ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] opacity-80">
                <Sparkles aria-hidden className="size-3.5" />
                Te sugiero
              </span>
            ) : null}
            <span className="min-w-0 truncate">{t.name}</span>
            <span
              className={cn(
                'shrink-0 text-xs font-normal tabular-nums opacity-75',
                // Sobre la píldora rellena el rojo no se lee: ahí lo dice la palabra «Descubierto».
                overdrawn && !active && 'text-destructive opacity-100',
              )}
            >
              {balance}
            </span>
          </button>
        )
      })}
    </div>
  )
}
