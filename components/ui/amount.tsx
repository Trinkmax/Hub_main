import type * as React from 'react'
import {
  type BalanceSide,
  type CentsValue,
  EMPTY_VALUE,
  formatCents,
  MINUS_SIGN,
  type MoneyCurrency,
  type MoneySign,
  NBSP,
} from '@/lib/money/format'
import { cn } from '@/lib/utils'

export type AmountTone = 'neutral' | 'muted' | 'positive' | 'negative' | 'auto'

// Atributos de HTMLElement (no de span): la raíz puede ser `<span>` o `<data>`.
export type AmountProps = Omit<React.HTMLAttributes<HTMLElement>, 'children'> & {
  /** Centavos enteros. `null`/`undefined` es «sin dato» (nunca `$ 0`). */
  cents: CentsValue
  /** 2 por defecto: lo contable no esconde centavos. 0 en KPIs y tableros. */
  decimals?: 0 | 2
  /** `auto` (default): solo el negativo lleva signo. Con `side` no se usa. */
  sign?: MoneySign
  /** Saldo: valor absoluto + «D» o «A». `auto`: ≥ 0 → D, negativo → A. */
  side?: BalanceSide | 'auto'
  /** `neutral` (default) hereda el color; `auto` pinta el negativo como `negative`. */
  tone?: AmountTone
  /** `ARS` (default) → `$` · `USD` → `US$` · `false` en columnas con el `$` en el encabezado. */
  currency?: MoneyCurrency | false
  /** Texto para el faltante. Default `—`, que se lee «sin dato». */
  emptyText?: string
  /** `data` agrega `value` con los centavos (máquina-legible). */
  as?: 'span' | 'data'
}

const SIDE_WORD: Readonly<Record<BalanceSide, string>> = { D: 'deudor', A: 'acreedor' }

const TONE_CLASS: Readonly<Record<Exclude<AmountTone, 'auto'>, string>> = {
  neutral: '',
  muted: 'text-muted-foreground',
  positive: 'text-success-text',
  negative: 'text-destructive-text',
}

/** Centavos con algo que mostrar: un número finito o un `bigint`. */
function hasValue(cents: CentsValue): cents is number | bigint {
  if (cents === null || cents === undefined) return false
  return typeof cents === 'bigint' || Number.isFinite(cents)
}

type AmountParts = {
  /** El importe tal cual se ve, sin el lado: `−$ 1.234,50` o, con lado, el absoluto. */
  body: string
  /** `D` o `A` cuando es un saldo. */
  side: BalanceSide | null
  /** Negativo a la vista: el cero redondeado no cuenta («−$ 0» no existe). */
  negative: boolean
}

/**
 * Las partes del importe con la misma regla que `formatCents` (lib/money):
 * Amount no formatea por su cuenta, así la pantalla y el CSV no se separan.
 * `null` si no hay dato.
 */
export function amountParts(
  props: Pick<AmountProps, 'cents' | 'decimals' | 'sign' | 'side' | 'currency'>,
): AmountParts | null {
  const { cents, decimals = 2, sign = 'auto', side, currency = 'ARS' } = props
  if (!hasValue(cents)) return null
  // El signo «a la vista» sale del propio formateador: si redondea a cero,
  // no lleva menos, y entonces tampoco se pinta de rojo ni pasa a «A».
  const negative = formatCents(cents, { decimals, currency }).startsWith(MINUS_SIGN)
  if (side !== undefined) {
    const resolved: BalanceSide = side === 'auto' ? (negative ? 'A' : 'D') : side
    return {
      body: formatCents(cents, { decimals, currency, sign: 'never' }),
      side: resolved,
      negative,
    }
  }
  return { body: formatCents(cents, { decimals, currency, sign }), side: null, negative }
}

/** El texto que se ve (con el lado, si hay): lo usa `KPI` para medir la cifra. */
export function amountText(
  props: Pick<AmountProps, 'cents' | 'decimals' | 'sign' | 'side' | 'currency' | 'emptyText'>,
): string {
  const parts = amountParts(props)
  if (!parts) return props.emptyText ?? EMPTY_VALUE
  return parts.side ? `${parts.body}${NBSP}${parts.side}` : parts.body
}

/**
 * Plata desde centavos, server-safe: `<span data-slot="amount">−$ 1.234,50</span>`.
 *
 * - Cifras tabulares y sin cortes (`type-amount`); menos tipográfico (U+2212)
 *   y espacio duro después del `$`, todo de `lib/money/format.ts`.
 * - **Saldo** (`side`): `1.240.000 A`. La letra es un `<abbr>` con `title` para
 *   el mouse y `aria-hidden`; al lado va «acreedor»/«deudor» solo para lectores
 *   de pantalla, porque el `title` de un `abbr` no se lee de forma confiable y
 *   una «A» suelta no dice nada.
 * - **Faltante:** `—` a la vista y «sin dato» para lectores de pantalla.
 * - El color acompaña y nunca es la única señal: el signo o la letra ya lo dicen.
 */
export function Amount({
  cents,
  decimals = 2,
  sign = 'auto',
  side,
  tone = 'neutral',
  currency = 'ARS',
  emptyText,
  as = 'span',
  className,
  ...props
}: AmountProps) {
  const parts = amountParts({ cents, decimals, sign, side, currency })

  if (!parts) {
    const text = emptyText ?? EMPTY_VALUE
    const toneClass = tone === 'auto' ? '' : TONE_CLASS[tone]
    return (
      <span
        data-slot="amount"
        data-empty=""
        className={cn('type-amount', toneClass, className)}
        {...props}
      >
        {text === EMPTY_VALUE ? (
          <>
            <span aria-hidden="true">{EMPTY_VALUE}</span>
            <span className="sr-only">sin dato</span>
          </>
        ) : (
          text
        )}
      </span>
    )
  }

  const toneClass = tone === 'auto' ? (parts.negative ? TONE_CLASS.negative : '') : TONE_CLASS[tone]
  const content = parts.side ? (
    <>
      {parts.body}
      {NBSP}
      {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: un <abbr> no es enfocable (no tiene tabindex); el title es para el mouse y el lector oye la palabra del sr-only de al lado */}
      <abbr title={`saldo ${SIDE_WORD[parts.side]}`} aria-hidden="true">
        {parts.side}
      </abbr>
      <span className="sr-only"> {SIDE_WORD[parts.side]}</span>
    </>
  ) : (
    parts.body
  )
  const rootProps = {
    ...props,
    'data-slot': 'amount',
    'data-negative': parts.negative ? '' : undefined,
    'data-side': parts.side ?? undefined,
    className: cn('type-amount', toneClass, className),
  }

  if (as === 'data') {
    // `cents` ya está acotado a número finito o bigint (amountParts no fue null).
    return (
      <data value={String(cents)} {...rootProps}>
        {content}
      </data>
    )
  }
  return <span {...rootProps}>{content}</span>
}
