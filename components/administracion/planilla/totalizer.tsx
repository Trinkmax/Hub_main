import type { ReactNode } from 'react'
import { MoneyTicker } from '@/components/administracion/kit/money-ticker'
import { cn } from '@/lib/utils'

export type TotalizerTone = 'default' | 'ok' | 'warn' | 'bad'

export type TotalizerItem = {
  label: string
  /** Centavos: el número cuenta hasta el valor. `null`: sin dato. */
  cents?: number | null
  /** En vez de plata, un texto («21 días», «Debe = Haber»). */
  text?: ReactNode
  tone?: TotalizerTone
  /** Debajo del número, en gris. */
  hint?: ReactNode
}

const TONE: Readonly<Record<TotalizerTone, string>> = {
  default: 'text-foreground',
  ok: 'text-success',
  warn: 'text-warning-text',
  bad: 'text-destructive',
}

/** Un cero o un dato que falta no es ni bueno ni malo: el color queda para cuando hay plata. */
function toneOf(item: TotalizerItem): TotalizerTone {
  const empty = item.text === undefined && !item.cents
  return empty ? 'default' : (item.tone ?? 'default')
}

/**
 * El totalizador: lo primero que pidieron los socios en cada planilla. Hasta cinco números de un
 * vistazo, en una sola tira. El número va en la tipografía de los datos (no en Fraunces): cuando se
 * compara plata, los dígitos tienen que medir todos lo mismo.
 */
export function Totalizer({
  items,
  className,
}: {
  items: readonly TotalizerItem[]
  className?: string
}) {
  return (
    <section
      aria-label="Totales"
      className={cn(
        'grid grid-cols-2 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]',
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 border-border/70 px-4 py-2.5 not-first:border-l max-sm:nth-[2n+1]:border-l-0 max-sm:nth-[n+3]:border-t"
        >
          <div className="truncate text-xs text-muted-foreground">{item.label}</div>
          <div
            className={cn(
              'text-lg leading-tight font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-[1.375rem]',
              TONE[toneOf(item)],
            )}
          >
            {item.text !== undefined ? (
              item.text
            ) : item.cents === null || item.cents === undefined ? (
              '—'
            ) : (
              <MoneyTicker cents={item.cents} />
            )}
          </div>
          {item.hint ? (
            <div className="truncate text-xs text-muted-foreground">{item.hint}</div>
          ) : null}
        </div>
      ))}
    </section>
  )
}
