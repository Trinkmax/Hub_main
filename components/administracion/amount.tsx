import { type CentsValue, formatCents, type MoneySign } from '@/lib/money'
import { cn } from '@/lib/utils'
import { type BalanceKind, describeBalance, describeSideBalance } from './format'

export type AmountProps = {
  /** Centavos (la base guarda `bigint`: llega como `number` o `bigint`). */
  cents: CentsValue
  /** 2 por defecto (lo contable no esconde centavos). 0 para los números grandes del Resumen. */
  decimals?: 0 | 2
  /**
   * Saldo con su sentido en palabras, nunca con un menos pelado:
   * `payable` → «Le debés $ X» / «A favor $ X» / «Sin deuda»;
   * `receivable` → «Te debe $ X» / «Le debemos $ X» / «Sin deuda»;
   * `treasury` → «$ X» / «Descubierto $ X».
   */
  balance?: BalanceKind
  /** Con `balance`: `contrary` deja palabras solo en el sentido contrario (columna «Saldo»). */
  words?: 'both' | 'contrary'
  /** Saldo como en el mayor: absoluto + «D»/«A» (Debe − Haber). Excluye `balance`. */
  side?: boolean
  /** Importe pelado: `auto` (default) solo el negativo lleva «−»; `always` también «+». */
  sign?: MoneySign
  /** `false` en columnas que ya dicen «$» en el encabezado. Default `true`. */
  currency?: boolean
  /** Bloque alineado a la derecha (para celdas y pilas de importes). */
  block?: boolean
  /** `muted` para cifras secundarias. `auto` pinta en rojo el saldo contrario de una caja. */
  tone?: 'default' | 'muted' | 'auto'
  className?: string
}

/**
 * Toda cifra de Administración: cifras tabulares, `$ 1.234,50`, «—» si falta.
 * Server-safe (sin hooks): sirve en páginas y en formularios.
 */
export function Amount({
  cents,
  decimals = 2,
  balance,
  words,
  side,
  sign,
  currency = true,
  block = false,
  tone = 'default',
  className,
}: AmountProps) {
  const base = cn(
    'tabular-nums whitespace-nowrap',
    block && 'block text-right',
    tone === 'muted' && 'text-muted-foreground',
    className,
  )

  if (balance) {
    const d = describeBalance(cents, balance, { decimals, words, currency })
    if (d.state === 'empty') return <Missing className={base} />
    const alarm = tone === 'auto' && balance === 'treasury' && d.state === 'negative'
    return (
      <span data-slot="amount" className={cn(base, alarm && 'text-destructive')}>
        {d.words ? (
          <span className={alarm ? undefined : 'text-muted-foreground'}>{d.words}</span>
        ) : null}
        {d.words && d.amount ? ' ' : null}
        {d.amount ? <span className="font-medium">{d.amount}</span> : null}
      </span>
    )
  }

  if (side) {
    const d = describeSideBalance(cents, { decimals, currency })
    if (!d) return <Missing className={base} />
    return (
      <span data-slot="amount" className={base}>
        {d.amount}
        <span aria-hidden="true" className="ml-1 text-muted-foreground">
          {d.side}
        </span>
        <span className="sr-only">{d.side === 'D' ? ' deudor' : ' acreedor'}</span>
      </span>
    )
  }

  const text = formatCents(cents, { decimals, sign, currency: currency ? 'ARS' : false })
  if (text === '—') return <Missing className={base} />
  return (
    <span data-slot="amount" className={base}>
      {text}
    </span>
  )
}

function Missing({ className }: { className?: string }) {
  return (
    <span data-slot="amount" className={cn(className, 'text-muted-foreground/70')}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">Sin dato</span>
    </span>
  )
}
