import { ChevronDown, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { Children, type ReactNode, useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * El renglón con margen de cuaderno: la libreta de proveedores, la plata por
 * cobrar, los movimientos de una caja día por día. Es UNA hoja con rayas
 * suaves entre renglones y una raya vertical que la recorre entera: el margen.
 *
 * A la izquierda de esa raya va el «desde cuándo o para cuándo» (`LedgerRail`):
 * una fecha, un atraso, un plazo. NUNCA un importe: la plata va a la derecha.
 *
 *   <LedgerList aria-label="Proveedores">
 *     <LedgerGroup title="Les debés" count={2} aside={formatCents(total)}>
 *       <LedgerRow
 *         rail={<LedgerRail label="vencido hace" value={12} unit="días" tone="late" />}
 *         title="Distribuidora de Bebidas"
 *         href={hojaDelProveedor}
 *         meta="Bebidas sin alcohol · última compra 03/10"
 *         amount={<Amount cents={deuda} />}
 *         action={<Button>Pagar</Button>}
 *       />
 *     </LedgerGroup>
 *   </LedgerList>
 *
 * En una misma lista, dale a todos los renglones la misma forma (todos con
 * acción o ninguno): así los importes quedan en columna.
 *
 * La hoja se acomoda a SU ancho, no al de la ventana (`@container/ledger`): en
 * una columna angosta de la compu se ve como en el celular. Por eso es un
 * bloque que ocupa el ancho de su columna: no la pongas como hijo de una fila
 * `flex` sin darle ancho (`flex-1`, `w-full`), porque se queda en cero.
 *
 * Cuándo NO: para los libros de la contadora (ahí la tabla densa es el
 * producto: `StatementTable`, `ChartTable`); para más de ~60 renglones sin
 * agrupar (usá `more` o paginá); adentro de un `Ticket`; ni para un paso a
 * paso (eso es `StepCard`).
 */

export type LedgerTone = 'late' | 'warn' | 'ok' | 'muted'

/**
 * El ancho del margen: 56 px, y 64 cuando la HOJA mide 28rem o más (no la
 * ventana: una lista en una columna angosta de la compu va como en el celular).
 * La raya va justo donde termina.
 */
const MARGIN = 'w-14 @[28rem]/ledger:w-16'
/** Dónde va la raya: el mismo corte que `MARGIN`. */
const MARGIN_LINE = 'left-14 @[28rem]/ledger:left-16'
/** Lo que se corre el texto que no va en un renglón (títulos y pies) para quedar a la derecha de la raya. */
const PAST_MARGIN = 'pr-3 pl-[4.25rem] @[28rem]/ledger:pr-4 @[28rem]/ledger:pl-20'
/** El link (o el botón) del título, estirado a todo el renglón, con el foco dibujado sobre el renglón entero. */
const STRETCHED =
  "rounded-sm outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"

/**
 * La hoja. Una sola superficie para todos los renglones (nada de una tarjeta
 * por renglón). Adentro van `LedgerRow` sueltos o `LedgerGroup`.
 *
 * `bare` la deja sin superficie propia, para ir DENTRO de un `Panel`: las
 * rayas y el margen siguen. `footer` es el pie de la hoja («Total: le debés
 * $ X · Mostrando 12 proveedores»).
 *
 * Sin renglones no dibuja una hoja vacía: no dibuja nada. El vacío lo
 * cuenta quien la usa, con `EmptyTeach` (qué va a aparecer y el paso que sigue).
 * Vale también para una lista armada solo con grupos que quedaron sin
 * renglones: la hoja se esconde sola (por CSS, `:has()`); igual conviene
 * decidir el vacío ANTES de montarla, para poder mostrar tu `EmptyTeach`.
 */
export function LedgerList({
  'aria-label': ariaLabel,
  children,
  footer,
  bare = false,
  className,
}: {
  /** Qué lista es, para lectores: «Proveedores», «Movimientos de Caja». */
  'aria-label': string
  children: ReactNode
  footer?: ReactNode
  bare?: boolean
  className?: string
}) {
  if (Children.toArray(children).length === 0 && !footer) return null
  return (
    <div
      className={cn(
        '@container/ledger',
        !bare && 'card-hairline overflow-hidden rounded-2xl border bg-card shadow-xs',
        // Solo grupos, y todos vacíos: el `<ul>` queda sin hijos y la hoja no se dibuja.
        !footer && 'has-[>div>ul:empty]:hidden',
        className,
      )}
    >
      <div className="relative">
        <ul aria-label={ariaLabel} className="divide-y divide-border/60">
          {children}
        </ul>
        {/* La raya del margen: una sola, de arriba abajo, por encima de los
            renglones y de los títulos de grupo. Cálida, como la de un cuaderno. */}
        <span
          aria-hidden
          className={cn('pointer-events-none absolute inset-y-0 w-px bg-adm-s5/35', MARGIN_LINE)}
        />
      </div>
      {footer ? (
        <div
          className={cn(
            'border-t border-border/60 py-3 text-sm text-muted-foreground',
            bare ? 'px-0 pb-0' : 'px-3 @[28rem]/ledger:px-4',
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Un grupo de renglones con su título: «Les debés», «Ya tendría que haber
 * llegado», un día («Martes 13/10 · hoy»).
 *
 * - `count`: cuántos son, adentro de su pastilla (nunca un número pelado al
 *   lado del título).
 * - `aside`: a la derecha del título, el subtotal del grupo o lo que entró y
 *   salió ese día. Ya formateado.
 * - `footer`: el pie del grupo («Al cierre del día quedó en $ X»).
 * - `more`: los renglones que no entran a la vista, detrás de «Ver los N que
 *   faltan» (un `<details>`: anda sin JavaScript).
 * - `id`: ancla para saltar al grupo (`dia-2026-10-10`).
 */
export function LedgerGroup({
  title,
  count,
  aside,
  footer,
  id,
  more,
  children,
}: {
  title: ReactNode
  count?: ReactNode
  aside?: ReactNode
  footer?: ReactNode
  id?: string
  more?: { label: string; children: ReactNode }
  children: ReactNode
}) {
  const headingId = useId()
  // Un título sin renglones debajo es ruido: el grupo vacío no se dibuja.
  if (Children.toArray(children).length === 0 && !more) return null
  return (
    <li id={id} className="scroll-mt-28">
      <div
        className={cn(
          'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 bg-secondary/40 py-2',
          PAST_MARGIN,
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <h3
            id={headingId}
            className="text-[11px] font-semibold uppercase leading-snug tracking-[0.12em] text-muted-foreground text-pretty"
          >
            {title}
          </h3>
          {count !== undefined && count !== null ? (
            <span className="shrink-0 rounded-full bg-secondary px-1.5 py-px font-mono text-[11px] tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
        </div>
        {aside ? (
          <div className="ml-auto text-right text-xs tabular-nums text-muted-foreground">
            {aside}
          </div>
        ) : null}
      </div>
      <ul
        aria-labelledby={headingId}
        className="divide-y divide-border/60 border-t border-border/60"
      >
        {children}
      </ul>
      {more ? (
        <details className="group/more border-t border-border/60">
          <summary
            className={cn(
              'flex min-h-11 cursor-pointer list-none items-center gap-1.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden',
              PAST_MARGIN,
            )}
          >
            {more.label}
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 transition-transform duration-(--duration-fast) ease-(--ease-out) group-open/more:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <ul
            aria-label={more.label}
            className="divide-y divide-border/60 border-t border-border/60"
          >
            {more.children}
          </ul>
        </details>
      ) : null}
      {footer ? (
        <div
          className={cn(
            'border-t border-border/60 py-2 text-xs text-muted-foreground',
            PAST_MARGIN,
          )}
        >
          {footer}
        </div>
      ) : null}
    </li>
  )
}

const ROW_TINT = {
  ok: 'bg-success/6',
  warn: 'bg-warning/8',
  late: 'bg-destructive/5',
} as const

/**
 * Un renglón: margen · quién y qué · importe · LA acción · menú.
 *
 * - `rail`: el margen (`LedgerRail`). Sin `rail` el margen queda vacío y la
 *   raya sigue.
 * - `title` + `meta` en gris; `bar` es un dibujo fino debajo (una barrita de
 *   deuda, puntitos de cuotas).
 * - `amount`: el importe, con `Amount` (puede llevar su rótulo arriba: «Le
 *   debés»). `amountNote`, la aclaración chica debajo («$ X vencido»).
 * - `action`: UNA, la del momento («Pagar»). `menu`: el ⋯ con lo demás.
 * - Con `href`, el título es un link estirado: todo el renglón lleva ahí, y
 *   `action`, `menu` y lo que se toque dentro de `meta` quedan por encima.
 *   `scroll={false}` para un link que solo cambia un parámetro de la URL (abrir
 *   el renglón en el lugar): la página no salta arriba.
 * - Con `onClick` (y sin `href`), el título es un botón estirado igual: el
 *   renglón se toca sin navegar (elegir a quién pagarle, tildar una compra).
 *   `pressed` lo anuncia como tildado o no. Una función solo se puede pasar
 *   desde un componente cliente; la pieza sigue sirviendo en el servidor.
 * - `expanded`: el renglón abre algo en el lugar; se anuncia en el link o el
 *   botón (`aria-expanded`).
 * - `children`: el cuerpo de un renglón abierto (su papel resumido y una
 *   acción). Va debajo, a la derecha de la raya, sin raya propia, y lo que
 *   tenga adentro se puede tocar.
 * - `dense`: renglón angosto de 44 px con el margen vacío (ignora `rail`):
 *   para los que no tienen nada pendiente.
 * - `tint`: un lavado suave del renglón por estado. Siempre con su palabra en
 *   el margen o en una píldora: el color solo no dice nada.
 * - `muted`: apagado (un proveedor inactivo, algo anulado).
 *
 * Si no entra todo en un renglón (un celular, una columna angosta, un importe
 * de nueve cifras), el importe baja a la derecha y la acción queda en la línea
 * de abajo. En una hoja de menos de 20rem TODOS los importes bajan, así no
 * queda una lista con unos al lado del nombre y otros debajo.
 */
export function LedgerRow({
  rail,
  title,
  href,
  scroll,
  onClick,
  pressed,
  expanded,
  meta,
  bar,
  amount,
  amountNote,
  action,
  menu,
  dense = false,
  muted = false,
  tint,
  id,
  className,
  children,
}: {
  rail?: ReactNode
  title: ReactNode
  href?: string
  /** Se le pasa al `<Link>`: `false` para no saltar arriba al cambiar la URL. */
  scroll?: boolean
  /** El renglón entero se toca sin navegar. Solo desde un componente cliente. */
  onClick?: () => void
  /** Con `onClick`: tildado o no (`aria-pressed`). */
  pressed?: boolean
  /** El renglón está abierto en el lugar (`aria-expanded`). */
  expanded?: boolean
  meta?: ReactNode
  bar?: ReactNode
  amount?: ReactNode
  amountNote?: ReactNode
  action?: ReactNode
  menu?: ReactNode
  dense?: boolean
  muted?: boolean
  tint?: 'ok' | 'warn' | 'late'
  id?: string
  className?: string
  /** El cuerpo de un renglón abierto: debajo, a la derecha de la raya. */
  children?: ReactNode
}) {
  const hasAmount = amount !== undefined && amount !== null
  const hasNote = amountNote !== undefined && amountNote !== null
  const hasControls = Boolean(action) || Boolean(menu)
  const hasBody = children !== undefined && children !== null && children !== false
  const tappable = Boolean(href) || Boolean(onClick)
  const titleClass = cn(
    'line-clamp-2 font-medium leading-snug text-pretty [overflow-wrap:anywhere]',
    dense && 'text-sm',
    muted && 'text-muted-foreground',
  )
  // El nombre entero al pasar el mouse, por si quedó cortado en dos renglones.
  const fullTitle = typeof title === 'string' ? title : undefined

  return (
    <li
      id={id}
      className={cn(
        'relative flex scroll-mt-28',
        tint && ROW_TINT[tint],
        tappable &&
          'transition-colors duration-(--duration-fast) hover:bg-cream-tint motion-reduce:transition-none',
        className,
      )}
    >
      <div className={cn('flex shrink-0', MARGIN)}>{dense ? null : rail}</div>
      <div
        className={cn(
          // `justify-end`: lo que baja de renglón (el importe, la acción) queda
          // contra el borde derecho, en columna con los de los otros renglones.
          'flex min-w-0 flex-1 flex-wrap items-start justify-end gap-x-3 gap-y-2 px-3 @[28rem]/ledger:px-4',
          dense ? 'min-h-11 items-center py-1.5' : 'py-3',
        )}
      >
        <div
          className={cn(
            'min-w-0 flex-1',
            // Lo mínimo que pide el nombre antes de mandar el importe abajo. Sin
            // botones al lado alcanza con menos: en una columna angosta el
            // importe entra en la misma línea.
            dense ? 'basis-24' : hasControls ? 'basis-36' : 'basis-28',
          )}
        >
          {href ? (
            <p className={titleClass} title={fullTitle}>
              <Link href={href} scroll={scroll} aria-expanded={expanded} className={STRETCHED}>
                {title}
              </Link>
            </p>
          ) : onClick ? (
            <p className={titleClass} title={fullTitle}>
              <button
                type="button"
                onClick={onClick}
                aria-pressed={pressed}
                aria-expanded={expanded}
                className={cn(STRETCHED, 'cursor-pointer text-left font-[inherit]')}
              >
                {title}
              </button>
            </p>
          ) : (
            <p className={titleClass} title={fullTitle}>
              {title}
            </p>
          )}
          {meta ? (
            <div className="mt-0.5 text-sm leading-snug text-muted-foreground text-pretty [&_a]:relative [&_a]:z-[1] [&_button]:relative [&_button]:z-[1]">
              {meta}
            </div>
          ) : null}
          {bar ? <div className="mt-2">{bar}</div> : null}
        </div>
        {hasAmount || hasNote ? (
          <div className="max-w-full shrink-0 text-right @max-[20rem]/ledger:basis-full">
            {hasAmount ? (
              <div
                className={cn('text-sm font-medium tabular-nums', muted && 'text-muted-foreground')}
              >
                {amount}
              </div>
            ) : null}
            {hasNote ? (
              <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{amountNote}</div>
            ) : null}
          </div>
        ) : null}
        {hasControls ? (
          // En una hoja angosta (el celular, una columna chica) el orden se da
          // vuelta (⋯ y después la acción): la acción queda contra el borde
          // derecho, bajo el pulgar y en columna con las de los otros
          // renglones. Y con importe, la acción va en su propio renglón: el
          // importe nunca queda apretado contra un botón.
          <div
            className={cn(
              'relative z-[1] flex shrink-0 items-center gap-1.5 self-center @max-[28rem]/ledger:flex-row-reverse',
              hasAmount && Boolean(action) && '@max-[28rem]/ledger:basis-full',
            )}
          >
            {action}
            {menu}
          </div>
        ) : null}
        {hasBody ? (
          // Por encima del link estirado: lo de adentro se toca.
          <div className="relative z-[1] min-w-0 basis-full">{children}</div>
        ) : null}
      </div>
    </li>
  )
}

const RAIL_TONE = {
  late: 'bg-destructive/8 text-destructive',
  warn: 'bg-warning/10 text-warning-text',
  ok: 'bg-success/8 text-success',
  muted: 'bg-secondary/50 text-foreground',
} as const

/**
 * La tinta de los dos textos de 10 px del margen (el rótulo y la unidad). El
 * rojo pelado sobre su propio lavado no llega a 4,5:1 a ese tamaño, y «vencido
 * hace … días» es justo lo que más importa leer: va mezclado con la tinta del
 * tema, la receta de `.adm-status` (`StatusPill`). El número grande sigue en
 * el tono puro.
 */
const RAIL_SMALL_INK = {
  late: 'text-[color-mix(in_oklch,var(--destructive)_75%,var(--foreground))]',
  warn: undefined,
  ok: undefined,
  muted: 'text-muted-foreground',
} as const

/**
 * El valor del margen tiene que entrar en 56 px: hasta tres caracteres va
 * grande («12», «hoy»); una fecha o una palabra corta baja un escalón
 * («30/10», «favor»); una palabra larga, dos («mañana»).
 */
function railValueSize(value: ReactNode): string {
  const length = typeof value === 'string' || typeof value === 'number' ? String(value).length : 0
  if (length >= 6) return 'text-xs tracking-tight'
  if (length >= 4) return 'text-base'
  return 'text-xl'
}

/**
 * El margen de un renglón. Dice DESDE CUÁNDO o PARA CUÁNDO, nunca un importe:
 *
 * - una fecha → `label` = el mes («oct»), `value` = el día («10»), `unit` = el
 *   día de la semana («sáb») o «hoy»;
 * - un atraso o un plazo → `label` = «vencido» / «vence» / «llega», `value` =
 *   el número, `unit` = «días» (o `value` = «hoy» / «mañana», sin unidad);
 * - un movimiento sin fecha propia (dentro de un grupo que ya es un día) →
 *   `icon`: un círculo con el ícono de lo que fue.
 *
 * El tono tiñe el fondo SUAVE (nunca una banda de color pleno) y va siempre
 * con su palabra o su número: `late` vencido · `warn` por vencer · `ok` al
 * día o a favor · `muted` un dato.
 *
 * `swatch` es un punto con el color de la cosa: una clase LITERAL. Para la
 * caja de un movimiento, `treasuryToneSwatch(tone)` de `charts/palette` (el
 * mismo color que su tarjeta y que el Resumen). El nombre va escrito en el
 * renglón.
 *
 * Sirve también suelto, fuera de un `LedgerRow` (el margen del día de la
 * planilla de gastos fijos): trae su propio ancho. Suelto mide 56 px siempre;
 * si tu lista quiere los 64 px desde 28rem, ponele `@container/ledger` a su
 * envoltorio.
 *
 * Cuándo NO: para un estado (eso es `StatusPill`) ni para mostrar plata.
 */
export function LedgerRail({
  label,
  value,
  unit,
  icon: Icon,
  tone = 'muted',
  swatch,
}: {
  label?: string
  value?: ReactNode
  unit?: string
  icon?: LucideIcon
  tone?: LedgerTone
  swatch?: string
}) {
  const hasValue = value !== undefined && value !== null
  const small = cn('block text-[10px] font-medium leading-tight text-balance', RAIL_SMALL_INK[tone])
  const dot = swatch ? (
    <span aria-hidden className={cn('size-2 shrink-0 rounded-full', swatch)} />
  ) : null

  return (
    <div
      data-tone={tone}
      className={cn(
        'flex shrink-0 flex-col items-center justify-center gap-0.5 self-stretch px-0.5 py-2 text-center',
        MARGIN,
        RAIL_TONE[tone],
      )}
    >
      {label ? <span className={small}>{label}</span> : null}{' '}
      {hasValue ? (
        <span
          className={cn(
            'block max-w-full font-serif font-semibold leading-none tabular-nums [overflow-wrap:anywhere]',
            railValueSize(value),
          )}
        >
          {value}
        </span>
      ) : Icon ? (
        <span className="relative flex size-9 items-center justify-center rounded-full border border-current/15 bg-card">
          <Icon aria-hidden className="size-4" />
          {dot ? (
            <span className="absolute -right-0.5 -bottom-0.5 flex rounded-full ring-2 ring-card">
              {dot}
            </span>
          ) : null}
        </span>
      ) : null}{' '}
      {unit ? <span className={small}>{unit}</span> : null}
      {dot && (hasValue || !Icon) ? <span className="mt-0.5 flex">{dot}</span> : null}
    </div>
  )
}
