import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * El papel: el ticket de cierre del día, el comprobante que te dieron, la
 * vista previa de lo que estás cargando. Tiene la forma del objeto que los
 * socios ya tienen en la mano: papel claro, borde de abajo dentado, renglones
 * con puntitos hasta el importe, importes en monoespaciada y un total grande.
 *
 * Es papel, así que es CLARO también en modo oscuro: por eso lleva
 * `force-light` y su propia tinta (`--adm-paper-ink`). Adentro usá las piezas
 * `Ticket*` o texto con `text-muted-foreground` (acá es la tinta gris del
 * papel); no metas tarjetas ni botones de colores.
 *
 *   <Ticket>
 *     <TicketHeader title="Cierre del día" subtitle="Sábado 11/10" />
 *     <TicketRule />
 *     <TicketRow label="Efectivo" value={formatCents(a)} />
 *     <TicketRow label="Tarjetas" hint="Entra en 2 días" value={formatCents(b)} />
 *     <TicketRule />
 *     <TicketTotal label="Total vendido" value={formatCents(total)} />
 *     <TicketNote>Queda registrado en los libros.</TicketNote>
 *   </Ticket>
 *
 * Cuándo NO: como tarjeta genérica (eso es `Panel`), para una lista larga de
 * movimientos (un ticket de cuarenta renglones es una tabla disfrazada), ni
 * más de uno a la vista: el ticket es EL resultado de lo que se está cargando.
 */
export function Ticket({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children: ReactNode
  /** Va al envoltorio (ancho, posición pegajosa). */
  className?: string
  'aria-label'?: string
}) {
  return (
    // La sombra vive en el envoltorio: la máscara del dentado recorta todo lo
    // que el papel dibuje por fuera de su caja.
    <div className={cn('adm-ticket-wrap', className)}>
      <article aria-label={ariaLabel} className="adm-ticket force-light px-5 pt-5 pb-8 text-sm">
        {children}
      </article>
    </div>
  )
}

/** El membrete: qué papel es y de cuándo. Centrado, como en un tique. */
export function TicketHeader({
  title,
  subtitle,
  children,
  className,
}: {
  title: ReactNode
  /** La fecha, el número, el proveedor: en monoespaciada chica. */
  subtitle?: ReactNode
  /** Lo que vaya debajo del membrete (un `TicketStamp`, por ejemplo). */
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('text-center', className)}>
      <p className="font-serif text-lg font-semibold leading-tight tracking-tight text-balance">
        {title}
      </p>
      {subtitle ? (
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {subtitle}
        </p>
      ) : null}
      {children ? <div className="mt-3 flex justify-center">{children}</div> : null}
    </div>
  )
}

/**
 * Un renglón: concepto a la izquierda, puntitos, importe a la derecha.
 * `value` llega ya formateado (`formatCents`) o como `Amount` / `MoneyTicker`.
 * `hint` es la aclaración chica debajo del concepto; `muted` apaga un renglón
 * que todavía no tiene dato; `strong` resalta un subtotal.
 */
export function TicketRow({
  label,
  value,
  hint,
  strong = false,
  muted = false,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-baseline gap-2 py-1',
        strong && 'font-semibold',
        muted && 'text-muted-foreground',
      )}
    >
      <span className="min-w-0 max-w-[68%]">
        <span className="block text-pretty">{label}</span>
        {hint ? (
          <span className="block text-xs font-normal text-muted-foreground text-pretty">
            {hint}
          </span>
        ) : null}
      </span>
      {/* Los puntitos que llevan el ojo del concepto al importe. */}
      <span
        aria-hidden
        className="min-w-3 flex-1 -translate-y-[0.2em] border-b border-dotted border-adm-paper-rule"
      />
      <span className="shrink-0 whitespace-nowrap text-right font-mono tabular-nums">{value}</span>
    </div>
  )
}

/**
 * La raya del ticket. Punteada (acá sí: es un ticket); `double` es la raya
 * doble que va justo antes del total.
 */
export function TicketRule({ double = false }: { double?: boolean }) {
  return (
    <hr
      className={cn(
        'my-3 border-0 border-adm-paper-rule',
        double ? 'border-t-[3px] border-double' : 'border-t border-dashed',
      )}
    />
  )
}

/** El total: la cifra más grande del papel. Uno por ticket. */
export function TicketTotal({
  label,
  value,
  hint,
}: {
  label: ReactNode
  value: ReactNode
  /** Debajo del total, a la derecha: «incluye $ 12.300 de IVA». */
  hint?: ReactNode
}) {
  return (
    <div>
      {/* Si el rótulo y la cifra no entran en un renglón, la cifra baja entera
          y queda a la derecha: el rótulo nunca se parte en dos. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.16em]">
          {label}
        </span>
        <span className="ml-auto whitespace-nowrap font-mono text-2xl font-semibold leading-none tabular-nums">
          {value}
        </span>
      </div>
      {hint ? (
        <p className="mt-1.5 text-right text-xs text-muted-foreground text-pretty">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * El sello: «CON FACTURA A», «SIN FACTURA». Inclinado y con borde doble, como
 * uno de goma. Los dos tonos son tintas de sello, NO estados: `factura` verde y
 * `sin` azul. Ninguno es una alarma, porque «sin factura» queda registrado
 * igual en los libros; por eso no hay un sello rojo.
 *
 * `animate` lo hace entrar como un sellazo: usalo cuando el sello aparece o
 * cambia por algo que hizo la persona, nunca en una pantalla que solo se mira.
 *
 * Cuándo NO: fuera de un `Ticket` (la tinta está pensada para ese papel), ni
 * para un estado de pago o de vencimiento (eso es `StatusPill`).
 */
export function TicketStamp({
  tone,
  children,
  icon: Icon,
  animate = false,
  className,
}: {
  tone: 'factura' | 'sin'
  children: ReactNode
  icon?: LucideIcon
  animate?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex -rotate-6 items-center gap-1.5 rounded-md border-[3px] border-double border-current px-2.5 py-1 text-[11px] font-bold uppercase leading-tight tracking-[0.14em] mix-blend-multiply',
        // La tinta es el tono mezclado con la del papel: da AA también sobre
        // el papel del modo oscuro, que es un escalón más gris.
        tone === 'factura'
          ? 'text-[color:color-mix(in_oklch,var(--adm-s1)_80%,var(--adm-paper-ink))]'
          : 'text-[color:color-mix(in_oklch,var(--adm-s4)_80%,var(--adm-paper-ink))]',
        animate && 'adm-stamp-in',
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} /> : null}
      {children}
    </span>
  )
}

/** La letra chica del pie: una aclaración centrada, en una o dos líneas. */
export function TicketNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'mt-4 text-center text-xs leading-relaxed text-muted-foreground text-pretty',
        className,
      )}
    >
      {children}
    </p>
  )
}
