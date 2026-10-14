'use client'

import { ArrowLeftRight, HandCoins, Landmark, type LucideIcon, Scale } from 'lucide-react'
import Link from 'next/link'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { cn } from '@/lib/utils'

/**
 * La fila de acciones de la billetera, pegada al total: lo que se hace con las
 * cajas, a un toque. En el celular son círculos con su nombre debajo (como en
 * la app del banco); en una compu angosta, píldoras con ícono; y desde `xl`,
 * cuatro botones grandes, de a dos, a la derecha del total (la grilla de dos
 * columnas la arma `Wallet`).
 *
 * Reemplaza a los botones del encabezado y al menú «Más», que en el celular
 * dejaban afuera casi todo. No repite «＋ Cargar»: son las cosas de ESTA
 * pantalla. `CajasArchivos` es la línea callada que la acompaña: subir el
 * archivo de Mercado Pago o del banco en vez de cargar a mano.
 *
 * La contadora no ve nada de esto (`readOnly`).
 */

type Item = {
  key: string
  icon: LucideIcon
  /** Compu, y lo que escucha un lector. */
  label: string
  /** Celular (hasta dos renglones bajo el círculo) y compu angosta (las píldoras en una fila). */
  short: string
} & ({ href: string } | { action: 'mover' | 'ajustar' | 'movimiento' })

const SHELL = cn(
  'group flex w-full flex-col items-center gap-1.5 rounded-2xl text-center outline-none',
  'focus-visible:ring-2 focus-visible:ring-ring',
  'sm:h-11 sm:w-auto sm:flex-row sm:gap-2 sm:rounded-full sm:border sm:border-border/70 sm:bg-card sm:px-4 sm:shadow-xs',
  'sm:transition-colors sm:duration-(--duration-fast) sm:hover:bg-cream-tint motion-reduce:transition-none',
  // Al lado del total: un botón grande por acción, con su ícono en un círculo.
  'xl:h-14 xl:w-full xl:gap-3 xl:rounded-2xl xl:px-3 xl:text-left',
)

function Body({ item }: { item: Item }) {
  const Icon = item.icon
  return (
    <>
      {/* En el celular el círculo ES el botón: va como una ficha (fondo de tarjeta, borde y
          sombra), no como un relleno crema que se pierde contra el fondo de la página. */}
      <span
        aria-hidden
        className={cn(
          'flex size-12 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-xs',
          'transition-[background-color,scale] duration-(--duration-fast) group-hover:bg-accent group-active:scale-95 motion-reduce:transition-none',
          'sm:size-auto sm:border-0 sm:bg-transparent sm:shadow-none sm:group-hover:bg-transparent sm:group-active:scale-100',
          'xl:size-9 xl:shrink-0 xl:bg-secondary xl:group-hover:bg-secondary',
        )}
      >
        <Icon className="size-5 sm:size-4" />
      </span>
      <span aria-hidden className="text-xs leading-tight font-medium text-balance sm:hidden">
        {item.short}
      </span>
      {/* En una compu angosta o una tablet las cuatro píldoras van en una fila: con el nombre
          largo, «Gastos del banco» quedaba sola en un segundo renglón. */}
      <span aria-hidden className="text-sm font-medium whitespace-nowrap max-sm:hidden xl:hidden">
        {item.short}
      </span>
      <span aria-hidden className="hidden min-w-0 text-sm leading-tight font-medium xl:inline">
        {item.label}
      </span>
    </>
  )
}

/**
 * Un link adentro de una oración. En el celular el relleno vertical agranda el
 * área de toque sin separar los renglones (el relleno de un elemento en línea
 * no cambia el alto del renglón).
 */
const FILE_LINK =
  'rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:py-3'

/** Las columnas de la grilla del celular, escritas enteras (Tailwind no ve una clase armada al vuelo). */
const COLUMNS: Readonly<Record<number, string>> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
}

export function CajasAcciones({
  base,
  hasNonCash,
  className,
}: {
  /** `/<bar>/administracion`. */
  base: string
  /** Hay alguna caja que no es efectivo: se pueden cargar gastos del banco. */
  hasNonCash: boolean
  className?: string
}) {
  const { readOnly, openAction } = useAccounting()
  if (readOnly) return null

  const items: Item[] = [
    {
      key: 'mover',
      icon: ArrowLeftRight,
      label: 'Mover plata',
      short: 'Mover plata',
      action: 'mover',
    },
    {
      key: 'contar',
      icon: Scale,
      label: 'Contar la caja',
      short: 'Contar la caja',
      action: 'ajustar',
    },
    {
      key: 'socio',
      icon: HandCoins,
      label: 'Un socio puso o sacó plata',
      short: 'Socio puso o sacó',
      action: 'movimiento',
    },
    ...(hasNonCash
      ? [
          {
            key: 'banco',
            icon: Landmark,
            label: 'Gastos del banco',
            short: 'Gastos del banco',
            href: `${base}/cajas/gasto-bancario`,
          } satisfies Item,
        ]
      : []),
  ]

  return (
    <ul
      aria-label="Acciones de las cajas"
      className={cn(
        'grid gap-2 sm:flex sm:flex-wrap xl:grid xl:grid-cols-2',
        COLUMNS[items.length] ?? 'grid-cols-4',
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.key} className="min-w-0">
          {'href' in item ? (
            <Link href={item.href} aria-label={item.label} className={SHELL}>
              <Body item={item} />
            </Link>
          ) : (
            <button
              type="button"
              aria-label={item.label}
              onClick={() => openAction(item.action)}
              className={cn(SHELL, 'cursor-pointer')}
            >
              <Body item={item} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * «¿Tenés el archivo?»: el otro camino para no cargar a mano. Lleva a subir el
 * reporte de Mercado Pago (si el bar tiene una billetera) o los movimientos del
 * banco (si tiene un banco). Sin ninguno de los dos, no se dibuja. La
 * contadora no lo ve.
 */
export function CajasArchivos({
  base,
  hasWallet,
  hasBank,
  className,
}: {
  /** `/<bar>/administracion`. */
  base: string
  hasWallet: boolean
  hasBank: boolean
  className?: string
}) {
  const { readOnly } = useAccounting()
  if (readOnly || (!hasWallet && !hasBank)) return null
  return (
    <p className={cn('text-xs leading-relaxed text-muted-foreground text-pretty', className)}>
      ¿Tenés el archivo? Se carga solo:{' '}
      {hasWallet ? (
        <Link href={`${base}/importar/mercado-pago`} className={FILE_LINK}>
          subí el reporte de Mercado Pago
        </Link>
      ) : null}
      {hasWallet && hasBank ? ' o ' : null}
      {hasBank ? (
        <Link href={`${base}/importar/banco`} className={FILE_LINK}>
          subí los movimientos del banco
        </Link>
      ) : null}
      .
    </p>
  )
}
