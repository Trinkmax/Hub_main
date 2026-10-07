import { ArrowDownRight, ArrowUpRight, ChevronRight, type LucideIcon, Minus } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Amount, type AmountProps, amountText } from './amount'
import {
  KPI_CELL_PADDING,
  KPI_GRID_CLASS,
  KPI_GROUP_CLASS,
  KPI_GROUP_FRAME_CLASS,
  type KPIGroupColumns,
  kpiGroupColumns,
} from './kpi-grid'
import { Skeleton } from './skeleton'

export type { KPIGroupColumns } from './kpi-grid'

export type KPIDeltaDirection = 'up' | 'down' | 'flat'
export type KPITone = 'positive' | 'negative' | 'neutral'

export type KPIDelta = {
  /** Ya formateado y con signo: «+12 %», «−$ 3.200». */
  value: React.ReactNode
  direction: KPIDeltaDirection
  /** Positiva en verde, negativa en rojo, neutra apagada. Default `neutral`: subir no siempre es bueno. */
  tone?: KPITone
  /** «vs. mes anterior». */
  label?: string
}

type KPIOwnProps = {
  label: string
  /** Ya formateado (`formatCents`, `formatNumber`, `<Amount>`): no se anima. */
  value: React.ReactNode
  /** «personas», «por mesa». */
  unit?: string
  delta?: KPIDelta
  hint?: React.ReactNode
  /** Por ejemplo `<DueStatus>` debajo de «Vencido». */
  status?: React.ReactNode
  /** El KPI entero es un link (con `ChevronRight`). */
  href?: string
  icon?: LucideIcon
  /** `md` (default) Fraunces 28/32 · `lg` 28/32 → 32/36 desde `sm`. */
  size?: 'md' | 'lg'
  loading?: boolean
  /**
   * Lo pone `KPIGroup` en sus hijos directos: el KPI se dibuja como un par
   * `<dt>`/`<dd>` del `<dl>` del grupo en vez de abrir su propio `<dl>`.
   * Pasalo a mano solo si envolvés el KPI en otro componente adentro de un
   * `KPIGroup`.
   */
  grouped?: boolean
}

// Atributos de HTMLElement: la raíz es `<dl>` (suelto) o `<div>` (en un grupo).
export type KPIProps = KPIOwnProps & Omit<React.HTMLAttributes<HTMLElement>, 'children'>

const TONE_TEXT: Readonly<Record<KPITone, string>> = {
  positive: 'text-success-text',
  negative: 'text-destructive-text',
  neutral: 'text-muted-foreground',
}

const DIRECTION_ICON: Readonly<Record<KPIDeltaDirection, LucideIcon>> = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus,
}

/** Lo que oye un lector de pantalla antes del valor: «subió 12 % vs. mes anterior». */
const DIRECTION_WORD: Readonly<Record<KPIDeltaDirection, string>> = {
  up: 'subió',
  down: 'bajó',
  flat: 'sin cambios',
}

/**
 * Avance de cada carácter en Fraunces a peso 520 (en em), medido con fontTools
 * sobre el archivo que sirve next/font. Lo demás (letras) cuenta 0,62.
 */
const FRAUNCES_EM: Readonly<Record<string, number>> = {
  '0': 0.664,
  '1': 0.461,
  '2': 0.609,
  '3': 0.554,
  '4': 0.615,
  '5': 0.579,
  '6': 0.608,
  '7': 0.519,
  '8': 0.603,
  '9': 0.612,
  $: 0.599,
  '.': 0.259,
  ',': 0.27,
  ' ': 0.22,
  ' ': 0.22,
  '−': 0.558,
  '-': 0.412,
  '+': 0.558,
  '%': 0.764,
  '/': 0.495,
}

/**
 * Ancho de la cifra en em, con el tracking de `type-kpi` (−0,01 em) y un 4 %
 * de margen. `null` si el valor no es texto que se pueda medir.
 */
function valueEm(value: React.ReactNode): number | null {
  let text: string | null = null
  if (typeof value === 'string') text = value
  else if (typeof value === 'number') text = String(value)
  else if (React.isValidElement<AmountProps>(value) && value.type === Amount) {
    text = amountText(value.props)
  }
  if (!text) return null
  let em = 0
  for (const ch of text) em += (FRAUNCES_EM[ch] ?? 0.62) - 0.01
  return Math.round(em * 1.04 * 1000) / 1000
}

/**
 * Cifra que nunca se corta: con plata de 8 cifras («$ 45.678.901») en una
 * celda angosta (dos KPIs por fila en el celular, cuatro en una laptop), el
 * número se achica lo justo para entrar en lugar de desbordar o recortarse.
 * `1em` es el tamaño de `type-kpi` del padre, así que un valor corto no cambia;
 * `100cqi` es el ancho de la celda (el KPI es un contenedor de consultas).
 */
const FIT_CLASS = '[font-size:min(1em,calc(100cqi/var(--kpi-em)))]'

function KPIValue({ value, size }: { value: React.ReactNode; size: 'md' | 'lg' }) {
  const em = valueEm(value)
  return (
    <span
      data-slot="kpi-value"
      className={cn(
        'min-w-0 type-kpi text-foreground',
        size === 'md' && 'sm:text-[1.75rem] sm:leading-8',
      )}
    >
      {em === null ? (
        value
      ) : (
        <span className={FIT_CLASS} style={{ '--kpi-em': String(em) } as React.CSSProperties}>
          {value}
        </span>
      )}
    </span>
  )
}

/** La variación: ícono de 14 px + valor con signo + etiqueta, en `type-caption`. */
function KPIDeltaLine({
  value,
  direction,
  tone = 'neutral',
  label,
}: {
  value: React.ReactNode
  direction?: KPIDeltaDirection
  tone?: KPITone
  label?: React.ReactNode
}) {
  const Icon = direction ? DIRECTION_ICON[direction] : null
  return (
    <div
      data-slot="kpi-delta"
      className={cn('flex flex-wrap items-center gap-x-1 type-caption', TONE_TEXT[tone])}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      {direction ? <span className="sr-only">{DIRECTION_WORD[direction]} </span> : null}
      <span className="inline-flex items-center gap-1 font-medium tabular-nums">{value}</span>
      {label ? <span className="text-muted-foreground">{label}</span> : null}
    </div>
  )
}

/**
 * Un número con su nombre (§3.5): etiqueta en `type-label`, valor en
 * `type-kpi` (Fraunces, cifras proporcionales), unidad, variación y ayuda.
 * Server-safe. Quieto: sin conteo, sin «float».
 *
 * Semántica de lista de definiciones: en un `KPIGroup` es un `<div>` con
 * `<dt>` (etiqueta) y `<dd>` (valor); suelto abre su propio `<dl>`. El lector
 * de pantalla lee pares etiqueta-valor en vez de números sueltos.
 *
 * Con `href`, el link va adentro del `<dd>` y se estira a todo el KPI;
 * presionar pinta `--active` (sin escala) y el foco se dibuja adentro.
 */
export function KPI({
  label,
  value,
  unit,
  delta,
  hint,
  status,
  href,
  icon: Icon,
  size = 'md',
  loading = false,
  grouped = false,
  className,
  ...props
}: KPIProps) {
  const labelId = React.useId()
  const valueId = `${labelId}valor`
  const linked = Boolean(href) && !loading

  const shownValue = loading ? (
    <>
      <Skeleton aria-hidden="true" className="h-8 w-24 rounded-md" />
      <span className="sr-only">Cargando…</span>
    </>
  ) : (
    <KPIValue value={value} size={size} />
  )

  const body = (
    <>
      <dt id={labelId} className="flex min-w-0 items-center gap-2 type-label text-muted-foreground">
        {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
        <span className="min-w-0 text-pretty">{label}</span>
        {linked ? (
          <ChevronRight
            aria-hidden="true"
            className="ml-auto size-4 shrink-0 text-muted-foreground"
          />
        ) : null}
      </dt>
      <dd className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          {linked && href ? (
            <Link
              href={href}
              id={valueId}
              aria-labelledby={`${labelId} ${valueId}`}
              className="min-w-0 rounded-sm after:absolute after:inset-0 focus-visible:outline-none"
            >
              {shownValue}
            </Link>
          ) : (
            shownValue
          )}
          {unit && !loading ? (
            <span data-slot="kpi-unit" className="type-small text-muted-foreground">
              {unit}
            </span>
          ) : null}
        </div>
        {!loading && delta ? (
          <KPIDeltaLine
            value={delta.value}
            direction={delta.direction}
            tone={delta.tone}
            label={delta.label}
          />
        ) : null}
        {!loading && status ? <div data-slot="kpi-status">{status}</div> : null}
        {hint ? (
          <div data-slot="kpi-hint" className="text-pretty type-caption text-muted-foreground">
            {hint}
          </div>
        ) : null}
      </dd>
    </>
  )

  const rootClass = cn(
    // El KPI es contenedor de consultas: la cifra se mide contra su ancho (FIT_CLASS).
    'relative @container flex min-w-0 flex-col gap-1',
    grouped && KPI_CELL_PADDING,
    linked && [
      'transition-colors duration-(--duration-quick) ease-(--ease-ui) motion-reduce:transition-none',
      'hover:bg-hover has-[a:active]:bg-active',
      // Foco «adentro»: el link se estira a todo el KPI, así que el contorno es del KPI.
      'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-ring',
      // Suelto (sin celda): el fondo del hover respira hacia afuera sin mover el contenido.
      !grouped && '-m-2 rounded-lg p-2',
    ],
    className,
  )

  if (grouped) {
    return (
      <div data-slot="kpi" aria-busy={loading || undefined} className={rootClass} {...props}>
        {body}
      </div>
    )
  }
  return (
    <dl data-slot="kpi" aria-busy={loading || undefined} className={rootClass} {...props}>
      <div className="flex min-w-0 flex-col gap-1">{body}</div>
    </dl>
  )
}

export type KPIGroupProps = React.ComponentProps<'dl'> & {
  /** Columnas en escritorio. Sin el dato, salen de la cantidad de KPIs. */
  columns?: KPIGroupColumns
  /** Una sola tarjeta con divisores (default). `false`: solo la grilla con pelos. */
  framed?: boolean
}

/**
 * Marca como `grouped` a los KPIs hijos (también los que vienen dentro de un
 * fragmento o de un `.map`) y cuenta los ítems. Sin contexto de React: los
 * Server Components no lo tienen, y el grupo tiene que poder ser server.
 */
function groupChildren(children: React.ReactNode): { nodes: React.ReactNode; count: number } {
  let count = 0
  const visit = (node: React.ReactNode): React.ReactNode =>
    React.Children.map(node, (child) => {
      if (!React.isValidElement(child)) return child
      if (child.type === React.Fragment) {
        return visit((child.props as { children?: React.ReactNode }).children)
      }
      count += 1
      if (child.type === KPI) {
        return React.cloneElement(child as React.ReactElement<KPIProps>, { grouped: true })
      }
      return child
    })
  const nodes = visit(children)
  return { nodes, count }
}

/**
 * La fila de KPIs (§3.5): **una sola tarjeta** con divisores, no cuatro cajas
 * que flotan. Es un `<dl>` (el `data-tour` llega acá) y cada KPI es un par
 * etiqueta-valor; cada celda con `p-4 sm:p-6`.
 */
export function KPIGroup({ columns, framed = true, className, children, ...props }: KPIGroupProps) {
  const { nodes, count } = groupChildren(children)
  const cols = columns ?? kpiGroupColumns(count)
  return (
    <dl
      data-slot="kpi-group"
      data-columns={cols}
      className={cn(
        KPI_GROUP_CLASS,
        KPI_GRID_CLASS[cols],
        framed && KPI_GROUP_FRAME_CLASS,
        className,
      )}
      {...props}
    >
      {nodes}
    </dl>
  )
}
