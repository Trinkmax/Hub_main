import { Banknote, CreditCard, Landmark, type LucideIcon, PiggyBank, Wallet } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { treasuryToneSwatch } from '@/components/administracion/charts/palette'
import type { TreasuryTone, TreasuryToneKind } from '@/lib/accounting/home'
import type { TreasuryKind } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'

/**
 * La tarjeta de una caja: la caja de efectivo, la cuenta del banco, la
 * billetera, la tarjeta de la empresa. Se ve igual, y con su MISMO color,
 * donde aparezca: la portada de Cajas, su ficha, la hoja de «Mover» y Ajustes.
 *
 * Tiene la forma de una tarjeta de billetera: un lomo arriba con el color de
 * la caja, un lavado apenas de ese color, el ícono de lo que es, el nombre, y
 * la plata en grande.
 *
 * - `tone`: el color. Sale del TIPO de caja, como en el héroe del Resumen:
 *   `treasuryTones(cajas)[caja.id] ?? null` (`lib/accounting/home.ts`), con la
 *   MISMA lista que usa el Resumen (todas las cajas, en el orden de Ajustes;
 *   no la lista filtrada de la pantalla). Banco bosque, efectivo dorado,
 *   billetera celeste; `null` (la tarjeta de la empresa, un tipo «otra», la
 *   cuarta del mismo tipo) va en neutro. El color nunca va solo: el nombre
 *   está al lado. Para un punto o una barrita del mismo color fuera de la
 *   tarjeta: `treasuryToneSwatch(tone)` de `charts/palette`.
 * - `amount`: la plata YA formateada (`formatCentsShort`). Sin `amount` no se
 *   dibuja ningún número (nunca «$ 0» por un dato que falta). `amountLabel` va
 *   chico arriba: «Descubierto», «Debés», «A favor».
 * - `status`: un `StatusPill` («Contada hace 3 días»). `footer`: una línea
 *   callada («Último movimiento: ayer»). `action`: UNA.
 * - `href`: toda la tarjeta lleva ahí (link estirado sobre el nombre) y se
 *   levanta al pasar el mouse; la acción queda por encima.
 * - `empty`: un casillero punteado que pregunta «¿cuánto hay?»: la caja existe
 *   pero todavía no se cargó lo que tiene.
 * - `muted`: una caja que ya no se usa.
 * - `children`: un cuerpo propio (la ficha, en `lg`; el dorso, en Ajustes).
 *
 * Tamaños: `sm` (el pase de «Mover plata»), `md` (la portada), `lg` (la ficha).
 *
 * Cuándo NO: para ELEGIR una caja en un formulario (eso es `TreasuryPicker`);
 * para un proveedor o un medio de cobro; ni con dos acciones.
 */

/**
 * El ícono de cada tipo de caja. Vive en el kit (y no en la carpeta de Cajas)
 * para que la tarjeta no dependa de un archivo de un área: si algún día ese
 * archivo pasa a ser cliente, la tarjeta se seguiría dibujando en el servidor.
 * `cajas-ventas/treasury-display.tsx` tiene el mismo mapa (lo compara un test).
 */
export const WALLET_ICONS: Readonly<Record<TreasuryKind, LucideIcon>> = {
  cash: Banknote,
  bank: Landmark,
  wallet: Wallet,
  credit_card: CreditCard,
  other: PiggyBank,
}

// El lomo usa el mapa de `treasuryToneSwatch` (el del Resumen). El lavado es el
// mismo color al 6 % de promedio, un poco más arriba (donde nace el lomo) que
// abajo. Las clases van escritas enteras: Tailwind no ve un nombre armado al vuelo.
const WASH: Readonly<Record<TreasuryToneKind, readonly [string, string, string]>> = {
  bank: [
    'from-(--adm-k-bank-1)/10 to-(--adm-k-bank-1)/3',
    'from-(--adm-k-bank-2)/10 to-(--adm-k-bank-2)/3',
    'from-(--adm-k-bank-3)/10 to-(--adm-k-bank-3)/3',
  ],
  cash: [
    'from-(--adm-k-cash-1)/10 to-(--adm-k-cash-1)/3',
    'from-(--adm-k-cash-2)/10 to-(--adm-k-cash-2)/3',
    'from-(--adm-k-cash-3)/10 to-(--adm-k-cash-3)/3',
  ],
  wallet: [
    'from-(--adm-k-wallet-1)/10 to-(--adm-k-wallet-1)/3',
    'from-(--adm-k-wallet-2)/10 to-(--adm-k-wallet-2)/3',
    'from-(--adm-k-wallet-3)/10 to-(--adm-k-wallet-3)/3',
  ],
}
const WASH_NEUTRAL = 'from-adm-neutral/10 to-adm-neutral/3'

function toneWash(tone: TreasuryTone | null): string {
  return (tone ? WASH[tone.kind][tone.step - 1] : undefined) ?? WASH_NEUTRAL
}

const PADDING = {
  sm: 'p-3 pt-[1.125rem]',
  md: 'p-4 pt-[1.375rem]',
  lg: 'p-5 pt-[1.625rem] sm:p-6 sm:pt-[1.875rem]',
} as const

const NAME = {
  sm: 'text-sm font-medium',
  md: 'font-medium',
  lg: 'font-serif text-xl font-semibold tracking-tight',
} as const

const NUMBER = {
  sm: 'text-xl',
  md: 'text-3xl sm:text-4xl',
  lg: 'text-4xl sm:text-5xl',
} as const

// Un importe de nueve cifras con centavos no entra en una tarjeta angosta al
// tamaño de siempre: baja un escalón (lo mismo que hace `MoneyHero`).
const NUMBER_LONG = {
  sm: 'text-lg',
  md: 'text-2xl sm:text-3xl',
  lg: 'text-3xl sm:text-4xl',
} as const
const LONG_AMOUNT = 13

const ICON_BOX = {
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-11',
} as const

/** `$ 394.757` → el «$» chico y gris, y los dígitos grandes. Lo que no es así va tal cual. */
function AmountText({ amount }: { amount: ReactNode }) {
  if (typeof amount !== 'string') return <>{amount}</>
  const match = /^([−+-]?)((?:US)?\$)[\s ]*(.+)$/.exec(amount)
  if (!match) return <>{amount}</>
  const [, sign, symbol, digits] = match
  return (
    <>
      {sign ? <span className="mr-[0.08em]">{sign}</span> : null}
      <span className="mr-[0.16em] font-sans text-[0.45em] font-medium text-muted-foreground">
        {symbol}
      </span>
      <span>{digits}</span>
    </>
  )
}

export function WalletCard({
  name,
  kind,
  detail,
  tone,
  amount,
  amountLabel,
  status,
  footer,
  action,
  href,
  size = 'md',
  empty = false,
  muted = false,
  className,
  children,
}: {
  name: ReactNode
  kind: TreasuryKind
  /** «Efectivo», «Billetera · alias hub.bar». */
  detail?: ReactNode
  /** `treasuryTones(cajas)[id] ?? null`: el color por tipo de caja, el del Resumen. */
  tone: TreasuryTone | null
  amount?: ReactNode
  amountLabel?: ReactNode
  status?: ReactNode
  footer?: ReactNode
  action?: ReactNode
  href?: string
  size?: 'sm' | 'md' | 'lg'
  empty?: boolean
  muted?: boolean
  className?: string
  children?: ReactNode
}) {
  const Icon = WALLET_ICONS[kind]
  const quiet = empty || muted
  const hasAmount = !empty && amount !== undefined && amount !== null
  const hasFoot = Boolean(footer) || Boolean(action)
  const numberSize = (
    typeof amount === 'string' && amount.length > LONG_AMOUNT ? NUMBER_LONG : NUMBER
  )[size]
  const nameClass = cn(
    'line-clamp-2 leading-snug text-pretty [overflow-wrap:anywhere]',
    NAME[size],
    muted && 'text-muted-foreground',
  )

  return (
    <article
      className={cn(
        'relative isolate flex flex-col overflow-hidden rounded-2xl border',
        empty
          ? 'border-dashed border-border bg-card/50'
          : muted
            ? 'bg-card/60'
            : 'card-hairline bg-card shadow-xs',
        href && 'press-lift focus-within:border-primary/40 hover:border-primary/30 hover:shadow-md',
        PADDING[size],
        className,
      )}
    >
      {/* El lavado y el lomo: el color de la caja. Decorativos. */}
      {quiet ? null : (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 -z-10 bg-linear-to-b',
            toneWash(tone),
          )}
        />
      )}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-1.5',
          treasuryToneSwatch(muted ? null : tone),
          empty && 'opacity-45',
        )}
      />

      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full border border-border/70 bg-card',
            ICON_BOX[size],
            quiet ? 'text-muted-foreground' : 'text-foreground shadow-2xs',
          )}
        >
          <Icon className={size === 'sm' ? 'size-4' : 'size-5'} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={nameClass} title={typeof name === 'string' ? name : undefined}>
            {href ? (
              <Link
                href={href}
                className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
              >
                {name}
              </Link>
            ) : (
              name
            )}
          </h3>
          {detail ? (
            <div className="mt-0.5 text-xs leading-snug text-muted-foreground text-pretty [overflow-wrap:anywhere]">
              {detail}
            </div>
          ) : null}
        </div>
      </div>

      {empty ? (
        // No hay número que mostrar: cero no es «todavía no lo cargué».
        <p
          className={cn(
            'rounded-xl border border-dashed border-border px-3 text-center text-sm text-muted-foreground',
            size === 'sm' ? 'mt-2.5 py-2' : 'mt-4 py-3.5',
          )}
        >
          ¿cuánto hay?
        </p>
      ) : hasAmount ? (
        <div className={size === 'sm' ? 'mt-2.5' : 'mt-4'}>
          {amountLabel ? (
            <p className="mb-1 text-[11px] font-medium uppercase leading-none tracking-[0.14em] text-muted-foreground">
              {amountLabel}
            </p>
          ) : null}
          <p
            className={cn(
              'flex items-baseline whitespace-nowrap font-serif font-semibold leading-none tracking-tight',
              numberSize,
              muted && 'text-muted-foreground',
            )}
          >
            <AmountText amount={amount} />
          </p>
        </div>
      ) : null}

      {status ? (
        <div className={cn('flex flex-wrap items-center gap-1.5', size === 'sm' ? 'mt-2' : 'mt-3')}>
          {status}
        </div>
      ) : null}

      {children !== undefined && children !== null ? (
        <div className={cn('relative z-[1]', size === 'sm' ? 'mt-2.5' : 'mt-4')}>{children}</div>
      ) : null}

      {hasFoot ? (
        // `mt-auto`: en una grilla, los pies de todas las tarjetas quedan a la misma altura.
        <div className={cn('mt-auto', size === 'sm' ? 'pt-2.5' : 'pt-4')}>
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border/60',
              size === 'sm' ? 'pt-2.5' : 'pt-3',
            )}
          >
            {footer ? (
              <div className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground text-pretty [&_a]:relative [&_a]:z-[1] [&_button]:relative [&_button]:z-[1]">
                {footer}
              </div>
            ) : null}
            {action ? <div className="relative z-[1] ml-auto shrink-0">{action}</div> : null}
          </div>
        </div>
      ) : null}
    </article>
  )
}
