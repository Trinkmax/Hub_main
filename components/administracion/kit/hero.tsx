import type { ReactNode } from 'react'
import { formatCents, MINUS_SIGN } from '@/lib/money'
import { cn } from '@/lib/utils'
import { MoneyTicker } from './money-ticker'

/**
 * El número héroe de una pantalla: una etiqueta chica que dice qué es, la
 * plata en Fraunces con el «$» chico y gris delante, y UNA oración que lo
 * explica. Es el vocabulario de «Pulso de la noche» y «Cómo nos fue».
 *
 * Los dígitos van proporcionales y no tabulares: a 48–60 px las cifras
 * tabulares de Fraunces dejan aire de más alrededor del 1 y el número se ve
 * suelto. Por eso `MoneyTicker` reserva el ancho por su cuenta.
 *
 * `null` no es cero: se muestra «—». Sin centavos: es un tablero, no un libro.
 * La excepción es `decimals={2}`, para el total de algo que la persona está
 * cargando (el cierre del día): ahí el número grande tiene que ser el mismo,
 * al centavo, que el del ticket de al lado.
 *
 * Cuándo NO: más de uno del mismo tamaño por bloque (si todo es héroe, nada lo
 * es), en filas de una lista o celdas de una tabla (ahí va `Amount`), ni para
 * un número que no es plata.
 */

const NUMBER_SIZE = {
  xl: 'text-5xl sm:text-6xl',
  lg: 'text-4xl sm:text-5xl',
  md: 'text-3xl sm:text-4xl',
} as const

// Un importe de más de nueve cifras no entra en un celular al tamaño pedido:
// baja un escalón solo ahí. En compu queda igual.
const NUMBER_SIZE_LONG = {
  xl: 'text-4xl sm:text-6xl',
  lg: 'text-3xl sm:text-5xl',
  md: 'text-2xl sm:text-4xl',
} as const

export function MoneyHero({
  cents,
  label,
  sentence,
  size = 'xl',
  tone = 'default',
  animate = false,
  decimals = 0,
  className,
}: {
  /** Centavos. `null` = no hay dato (se muestra «—», nunca «$ 0»). */
  cents: number | null
  /** Qué es el número, en dos o tres palabras: «Plata disponible». */
  label: ReactNode
  /** La oración que lo explica. Una sola. */
  sentence?: ReactNode
  size?: keyof typeof NUMBER_SIZE
  /** `onHero` cuando va sobre el panel verde (`HeroPanel tone="bosque"`). */
  tone?: 'default' | 'onHero'
  /** El número cuenta al aparecer (`MoneyTicker`). Uno por pantalla alcanza. */
  animate?: boolean
  /** 0 (por defecto): sin centavos. 2 solo para el total de una carga en curso. */
  decimals?: 0 | 2
  className?: string
}) {
  const onHero = tone === 'onHero'
  const soft = onHero ? 'text-adm-hero-muted' : 'text-muted-foreground'
  const value = cents !== null && Number.isFinite(cents) ? cents : null
  // Solo los dígitos: el «$» y el signo se dibujan aparte, más chicos.
  const digits =
    value === null ? '' : formatCents(value, { currency: false, sign: 'never', decimals })
  // Lo que se muestra como cero no lleva signo: «−$ 0» no se lee.
  const negative = value !== null && value < 0 && digits !== '0' && digits !== '0,00'
  const sizeClass = (digits.length > 11 ? NUMBER_SIZE_LONG : NUMBER_SIZE)[size]

  return (
    <div className={cn('min-w-0', className)}>
      <p className={cn('text-[11px] font-medium uppercase tracking-[0.18em]', soft)}>{label}</p>
      <p
        className={cn(
          'mt-1.5 flex items-baseline whitespace-nowrap font-serif font-semibold leading-none tracking-tight',
          sizeClass,
          onHero ? 'text-adm-hero-fg' : 'text-foreground',
        )}
      >
        {value === null ? (
          <span className={soft}>
            <span aria-hidden>—</span>
            <span className="sr-only">Sin dato</span>
          </span>
        ) : (
          <>
            {negative ? <span className="mr-[0.08em]">{MINUS_SIGN}</span> : null}
            <span className={cn('mr-[0.16em] font-sans text-[0.42em] font-medium', soft)}>$</span>
            {animate ? (
              <MoneyTicker cents={Math.abs(value)} currency={false} decimals={decimals} />
            ) : (
              <span>{digits}</span>
            )}
          </>
        )}
      </p>
      {sentence ? (
        <p className={cn('mt-2.5 max-w-prose text-sm leading-relaxed text-pretty', soft)}>
          {sentence}
        </p>
      ) : null}
    </div>
  )
}

/**
 * El panel donde vive el número héroe.
 *
 * - `bosque`: el panel verde, como una pizarra. Uno por pantalla, arriba de
 *   todo. Adentro es una ISLA OSCURA: el contenido se dibuja con los tokens del
 *   modo oscuro (texto crema, primario dorado), así un botón, una píldora o un
 *   `Explain` se leen sobre el verde también en modo claro, sin clases
 *   especiales. Para el texto propio usá `text-adm-hero-fg` y
 *   `text-adm-hero-muted` (AA sobre los dos extremos del degradé).
 * - `crema`: la superficie estándar, para cuando el héroe no es lo único
 *   importante de la pantalla.
 *
 * Cuándo NO: dos paneles `bosque` en la misma pantalla, ni `bosque` como fondo
 * de un formulario o de una lista larga (cansa: es para el número y su acción).
 * Adentro no van tarjetas crema (`Panel`): se separa con aire o con un fondo
 * `bg-white/8`.
 */
export function HeroPanel({
  tone,
  children,
  className,
}: {
  tone: 'bosque' | 'crema'
  children: ReactNode
  className?: string
}) {
  if (tone === 'crema') {
    return (
      <section
        className={cn('card-hairline rounded-2xl border bg-card p-5 shadow-xs sm:p-6', className)}
      >
        {children}
      </section>
    )
  }
  return (
    <section className={cn('adm-hero rounded-3xl p-5 sm:p-7', className)}>
      {/* `contents`: la isla no arma caja, así el grid o el flex que le pongan
          al panel acomoda a los hijos de siempre. La clase `dark` va acá y no
          en el panel para que el verde del fondo siga siendo el del tema. */}
      <div className="dark adm-hero-ink contents">{children}</div>
    </section>
  )
}
