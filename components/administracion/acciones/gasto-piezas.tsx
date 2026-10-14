'use client'

import { AlertTriangle, ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { QuickVoucher } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import type { SheetTreasury } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'
import {
  ChoiceCard,
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from '@/components/administracion/kit'
import { cn } from '@/lib/utils'
import {
  PAPER_OPTIONS,
  type PaperOption,
  type PaperStamp,
  type TreasuryDirection,
  treasuryAfter,
  treasuryAfterShort,
  treasuryAfterWords,
} from './gasto-papel'

/**
 * Lo que se VE de «Nuevo gasto» (rediseño de oct 2026): los cuatro papeles
 * para elegir, cómo queda la caja y el ticket con sello. Nada de acá decide
 * qué se guarda: reciben el estado de la hoja y avisan lo que la persona tocó.
 * Los textos y las cuentas viven en `gasto-papel.ts` (puro, con tests).
 *
 * Dos de estas piezas son de toda la sección, para que el mismo concepto se
 * vea igual donde aparezca: `PaperChoices` (los cuatro papeles: también en la
 * compra y en la ficha de un gasto fijo) y `TreasuryAfterLine` (el «antes →
 * después» de una caja: también en «Pagar» y, con `direction="in"`, en
 * «Registrar un cobro»). El resto es de esta hoja.
 */

// ─── Los dibujos ─────────────────────────────────────────────────────────────

const FAINT = 'stroke-adm-paper-ink/30'
const INK = 'stroke-adm-paper-ink'
const LETTER = {
  textAnchor: 'middle',
  dominantBaseline: 'central',
  fontWeight: 700,
} as const

/**
 * El papel, dibujado: lo que la persona tiene en la mano cuando contesta. Cada
 * uno se reconoce por la forma antes de leer el título: la factura lleva su
 * letra en el recuadro del membrete (la A, además, el renglón del IVA aparte),
 * el tique es angosto y termina dentado, el remito es el papel sin valor
 * fiscal (contorno punteado y una firma). Es papel: claro también en oscuro.
 * Decorativo: el nombre lo dice el título de la tarjeta.
 */
export function PaperArt({ kind, className }: { kind: QuickVoucher; className?: string }) {
  const frame = cn('h-13 w-11 shrink-0', className)
  if (kind === 'a') {
    return (
      <svg viewBox="0 0 44 52" fill="none" aria-hidden="true" className={frame}>
        <rect
          x="5"
          y="2.5"
          width="34"
          height="47"
          rx="2.5"
          strokeWidth="1.25"
          className="fill-adm-paper stroke-adm-paper-rule"
        />
        <path
          d="M9 8.5h6M9 12h4.5M29 8.5h6M30.5 12h4.5"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={FAINT}
        />
        <rect x="17.5" y="5.5" width="9" height="9" rx="1" strokeWidth="1.25" className={INK} />
        <text x="22" y="10.2" fontSize="7" className="fill-adm-paper-ink" {...LETTER}>
          A
        </text>
        <path d="M5 18.5h34" strokeWidth="1" className="stroke-adm-paper-rule" />
        <path
          d="M9 23.5h16M9 28h12M30 23.5h5M31 28h4"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={FAINT}
        />
        {/* El IVA va en su propio renglón: es lo que se recupera. */}
        <rect x="7.5" y="32" width="29" height="7" rx="2" className="fill-adm-s1/15" />
        <path
          d="M10.5 35.5h8M28.5 35.5h5.5"
          strokeWidth="1.75"
          strokeLinecap="round"
          className="stroke-adm-s1"
        />
        <path d="M9 44.5h8M27 44.5h8" strokeWidth="1.75" strokeLinecap="round" className={INK} />
      </svg>
    )
  }
  if (kind === 'bc') {
    return (
      <svg viewBox="0 0 44 52" fill="none" aria-hidden="true" className={frame}>
        {/* Atrás asoma la C: puede ser cualquiera de las dos. */}
        <rect
          x="12"
          y="2.5"
          width="29"
          height="43"
          rx="2.5"
          strokeWidth="1.25"
          className="fill-adm-paper stroke-adm-paper-rule"
        />
        <rect
          x="32.5"
          y="5"
          width="6.5"
          height="6.5"
          rx="1"
          strokeWidth="1"
          className="stroke-adm-paper-ink/60"
        />
        <text x="35.75" y="8.4" fontSize="5" className="fill-adm-paper-ink/70" {...LETTER}>
          C
        </text>
        <rect
          x="3"
          y="7"
          width="29"
          height="43"
          rx="2.5"
          strokeWidth="1.25"
          className="fill-adm-paper stroke-adm-paper-rule"
        />
        <path
          d="M6.5 12.5h4.5M6.5 15.5h3.5M24 12.5h5M25 15.5h4"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={FAINT}
        />
        <rect x="13.5" y="10" width="8" height="8" rx="1" strokeWidth="1.25" className={INK} />
        <text x="17.5" y="14.2" fontSize="6.5" className="fill-adm-paper-ink" {...LETTER}>
          B
        </text>
        <path d="M3 21.5h29" strokeWidth="1" className="stroke-adm-paper-rule" />
        <path
          d="M6.5 26.5h13M6.5 31h10M6.5 35.5h12M24.5 26.5h4.5M25.5 31h3.5M24.5 35.5h4.5"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={FAINT}
        />
        <path
          d="M6.5 44h7.5M21.5 44h7.5"
          strokeWidth="1.75"
          strokeLinecap="round"
          className={INK}
        />
      </svg>
    )
  }
  if (kind === 'ticket') {
    return (
      <svg viewBox="0 0 44 52" fill="none" aria-hidden="true" className={frame}>
        <path
          d="M12 2.5h20v43.5l-2.5 3-2.5-3-2.5 3-2.5-3-2.5 3-2.5-3-2.5 3-2.5-3z"
          strokeWidth="1.25"
          strokeLinejoin="round"
          className="fill-adm-paper stroke-adm-paper-rule"
        />
        <path d="M17 8h10M19 11.5h6" strokeWidth="1.5" strokeLinecap="round" className={FAINT} />
        <path
          d="M15 16.5h14M15 35h14"
          strokeWidth="1"
          strokeDasharray="1.5 2"
          className="stroke-adm-paper-ink/45"
        />
        <path
          d="M15.5 21.5h7M15.5 26h5M15.5 30.5h8M25.5 21.5h3M25.5 26h3M25.5 30.5h3"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={FAINT}
        />
        <path d="M15.5 40h5M23.5 40h5" strokeWidth="1.75" strokeLinecap="round" className={INK} />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 44 52" fill="none" aria-hidden="true" className={frame}>
      <rect
        x="5"
        y="2.5"
        width="34"
        height="47"
        rx="2.5"
        strokeWidth="1.25"
        strokeDasharray="3 2.5"
        className="fill-adm-paper stroke-adm-paper-ink/45"
      />
      <path
        d="M9 8.5h6M9 12h4.5M29 8.5h6M30.5 12h4.5"
        strokeWidth="1.5"
        strokeLinecap="round"
        className={FAINT}
      />
      <rect
        x="17.5"
        y="5.5"
        width="9"
        height="9"
        rx="1"
        strokeWidth="1.25"
        strokeDasharray="2 1.5"
        className="stroke-adm-paper-ink/60"
      />
      <text x="22" y="10.2" fontSize="7" className="fill-adm-paper-ink/70" {...LETTER}>
        R
      </text>
      <path
        d="M9 22.5h18M9 27h12M9 31.5h15"
        strokeWidth="1.5"
        strokeLinecap="round"
        className={FAINT}
      />
      {/* La firma de quien entregó: lo único que suele traer un remito. */}
      <path
        d="M11 42.5c1.5-4.5 3-4.5 4-.5s2.5 3.5 4-.5 3-3 4 .5 3 2.5 6-1.5"
        strokeWidth="1.25"
        strokeLinecap="round"
        className="stroke-adm-paper-ink/70"
      />
      <path d="M9 46h26" strokeWidth="1" className="stroke-adm-paper-rule" />
    </svg>
  )
}

// ─── ¿Qué papel te dieron? ───────────────────────────────────────────────────

/**
 * Cuántos papeles entran por fila lo decide el ancho del GRUPO, no el de la
 * ventana: con 30rem o más van de a dos, con el dibujo arriba y más grande; con
 * menos, uno por renglón con el dibujo a la izquierda (así la línea de cada uno
 * se lee entera). En la hoja de «Nuevo gasto» (560 px) son dos columnas, igual
 * que siempre; en una página, depende de la columna donde caiga el grupo.
 *
 * Va por CSS (`@container`), sin `matchMedia`: lo que pinta el servidor ya es
 * lo que queda, y en una página no hay salto al hidratar.
 *
 * `ChoiceCard` es una pieza del kit con `layout` fijo: acá se la monta en
 * `row` y, desde 30rem del grupo, estas clases la llevan a la forma de `stack`
 * (mismo cuerpo en columna, mismo aire, la marca arriba a la derecha).
 */
const PAPER_CARD_STACKED = [
  '@[30rem]:[&>input+span]:flex-col',
  '@[30rem]:[&>input+span]:items-stretch',
  '@[30rem]:[&>input+span]:gap-3',
  '@[30rem]:[&>input+span]:pr-11',
  '@[30rem]:[&>.adm-choice-mark]:top-3.5',
  '@[30rem]:[&>.adm-choice-mark]:translate-y-0',
].join(' ')

/**
 * En oscuro la tarjeta elegida casi no se distinguía de las otras: el relleno
 * de la pieza (`bg-accent/50`) se mezcla con el fondo de la hoja y queda del
 * color de una tarjeta sin elegir. Acá va teñida con el primario (dorado), como
 * en claro va teñida de verde, y el círculo vacío de las otras gana borde.
 * Se resuelve desde afuera porque `ChoiceCard` es una pieza del kit.
 */
const PAPER_CARD_DARK =
  'dark:[&>input:checked+span]:bg-primary/15 dark:[&>input:not(:checked)~.adm-choice-mark]:border-foreground/35'

/**
 * Los cuatro papeles. Reemplaza a «¿Se factura? Sí / No» + los chips de
 * comprobante: cada tarjeta escribe uno de los cuatro valores de siempre.
 * Radios de verdad (flechas, Tab). `onPick` también corre al tocar la que ya
 * estaba elegida: es la persona confirmando lo que el sistema propuso, y
 * desde ahí ya no se lo pisa lo que se recuerde del proveedor.
 *
 * `value: null` = ninguna tarjeta marcada: todavía no se sabe qué papel es
 * («No sé o cambia» de un gasto fijo) o es uno que no está entre estos cuatro
 * («Es otro papel» de la compra). Nunca marques una «por las dudas»: una
 * tarjeta rellena es algo que la persona, o lo recordado del proveedor, dijo.
 *
 * Sirve igual en una hoja y en una página: se acomoda al ancho de donde la
 * pongas (dos columnas desde 30rem del grupo). Es un bloque: dale el ancho de
 * su columna.
 *
 * Cuándo NO: para un papel que ya se guardó (eso es el sello, `voucherStamp`),
 * ni para elegir entre más tipos que estos cuatro (notas de crédito, recibos…:
 * van por «Es otro papel», con el desplegable de quien la usa).
 */
export function PaperChoices({
  name,
  labelledBy,
  value,
  onPick,
  consequenceFor,
}: {
  /** El `name` del grupo de radios (único por hoja). */
  name: string
  labelledBy: string
  /** El papel marcado; `null`: ninguno. */
  value: QuickVoucher | null
  onPick: (voucher: QuickVoucher) => void
  consequenceFor: (option: PaperOption) => string
}) {
  return (
    // El grupo es el contenedor que se mide; la grilla va adentro (una consulta
    // de contenedor no alcanza al propio contenedor).
    <div role="radiogroup" aria-labelledby={labelledBy} className="@container">
      <div className="grid gap-2.5 @[30rem]:grid-cols-2">
        {PAPER_OPTIONS.map((option) => (
          <ChoiceCard
            key={option.value}
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onPick(option.value)}
            onClick={() => {
              if (value === option.value) onPick(option.value)
            }}
            className={cn(PAPER_CARD_DARK, PAPER_CARD_STACKED)}
            art={
              // En dos columnas el dibujo va arriba, más grande y alineado con
              // el texto (la pieza lo centra: por eso el envoltorio a todo el ancho).
              <span className="flex @[30rem]:w-full">
                <PaperArt kind={option.value} className="@[30rem]:h-16 @[30rem]:w-[3.375rem]" />
              </span>
            }
            title={option.title}
            consequence={consequenceFor(option)}
          />
        ))}
      </div>
    </div>
  )
}

// ─── La caja: antes → después ────────────────────────────────────────────────

/**
 * Lo que hace falta saber de una caja para decir cómo queda. Las cajas de
 * todas las hojas lo traen (la de «Nuevo gasto» y la de Cajas y Ventas, que
 * suma datos propios), así cualquiera pasa la suya sin armar otra.
 */
type AfterTreasury = Pick<SheetTreasury, 'name' | 'kind' | 'balanceCents' | 'allowNegative'>

/**
 * Debajo de «¿Con qué pagaste?»: cuánto hay hoy en la caja elegida y cuánto
 * queda con este gasto. Aparece recién con el importe (sin importe, el saldo
 * ya está en el chip). Si una caja que no admite negativo quedaría en rojo, lo
 * dice acá, antes del aviso que el servidor muestra al guardar; no bloquea.
 *
 * Es EL «antes → después» de una caja en toda la sección: una línea, cada
 * número con su rótulo. `direction="in"` es para plata que ENTRA (debajo de
 * «¿A dónde entró?»): «Banco Nación: hoy $ 41.863.428 → queda $ 43.651.428».
 * Lo que entra nunca dispara el aviso de «no alcanza».
 *
 * Cuándo NO: para un pase entre dos cajas (son dos saldos que cambian: va una
 * línea por caja o las dos tarjetas de «Mover»), ni fuera de una carga (el
 * saldo de una caja que solo se mira es su `WalletCard`).
 */
export function TreasuryAfterLine({
  treasury,
  amountCents,
  direction = 'out',
}: {
  treasury: AfterTreasury
  amountCents: number | null
  /** `out` (por defecto): la plata sale de la caja. `in`: entra. */
  direction?: TreasuryDirection
}) {
  const after = treasuryAfter(treasury, amountCents, direction)
  const words = treasuryAfterWords(treasury.kind, after)
  if (words === null) return null
  const short = after.state === 'short'
  return (
    <div className="rounded-xl bg-secondary/50 px-3.5 py-2.5 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="max-w-full truncate font-medium">{treasury.name}</span>
        <span className="text-muted-foreground">
          {words.before.label} <span className="tabular-nums">{words.before.amount}</span>
        </span>
        {/* La flecha va pegada a su número: si no entra todo en un renglón, baja con él
            («→ queda $ X») en vez de quedar colgada al final del de arriba. */}
        <span className="inline-flex items-center gap-x-2 whitespace-nowrap">
          <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn(short && 'text-warning-text')}>
            {words.after.label}{' '}
            <span className="font-semibold tabular-nums">{words.after.amount}</span>
          </span>
        </span>
      </p>
      {short ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning-text text-pretty">
          <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
          Con lo cargado hasta hoy no alcanza. ¿Falta cargar lo que había, algún ingreso o el cierre
          del día? Lo podés guardar igual.
        </p>
      ) : null}
    </div>
  )
}

// ─── El ticket ───────────────────────────────────────────────────────────────

export type GastoTicketRow = { key: string; label: ReactNode; value: ReactNode; hint?: ReactNode }

/**
 * El papel de lo que se está por guardar, en palabras: a quién, en qué, con
 * qué sello y cuánto sale de qué caja. Va justo antes del botón. No es el
 * asiento (ese queda plegado debajo, para la contadora): es lo que el dueño
 * controla de un vistazo. Con datos faltantes igual se dibuja, con «—» y lo
 * que falta en la letra chica: nunca un «$ 0».
 */
export function GastoTicket({
  title,
  subtitle,
  stamp,
  stampNonce,
  rows,
  totalLabel,
  total,
  totalHint,
  note,
  pending,
}: {
  title: ReactNode
  subtitle: ReactNode
  stamp: PaperStamp
  /** Sube cada vez que la persona elige un papel: el sello entra de nuevo. En 0, quieto. */
  stampNonce: number
  rows: readonly GastoTicketRow[]
  totalLabel: string
  /** Ya formateado, o «—» si todavía no hay importe. */
  total: string
  totalHint?: ReactNode
  note: ReactNode
  /** Falta algo: el papel se ve en borrador. */
  pending: boolean
}) {
  return (
    <Ticket aria-label="Lo que vas a cargar" className="mx-auto w-full max-w-[22rem]">
      <TicketHeader title={title} subtitle={subtitle} className={cn(pending && 'opacity-70')}>
        <TicketStamp key={stampNonce} tone={stamp.tone} animate={stampNonce > 0}>
          {stamp.text}
        </TicketStamp>
      </TicketHeader>
      <TicketRule />
      {rows.map((row) => (
        <TicketRow key={row.key} label={row.label} value={row.value} hint={row.hint} />
      ))}
      {rows.length > 0 ? <TicketRule double /> : null}
      <TicketTotal label={totalLabel} value={total} hint={totalHint} />
      {/* En borrador, la letra chica es lo que falta: va con la tinta del papel, no en gris. */}
      <TicketNote className={cn(pending && 'font-medium text-foreground')}>{note}</TicketNote>
    </Ticket>
  )
}

/**
 * «Caja: $ 394.757 → $ 382.257» para el pie del total. Dice lo mismo que la
 * línea de «¿Con qué pagaste?» y con las mismas palabras («faltan $ X», no
 * «Descubierto $ X»). La flecha va pegada a su número y, para lectores, dicha
 * en palabras. Con `direction="in"`, para el ticket de plata que entra.
 */
export function TreasuryAfterHint({
  treasury,
  amountCents,
  direction = 'out',
}: {
  treasury: AfterTreasury
  amountCents: number | null
  /** `out` (por defecto): la plata sale de la caja. `in`: entra. */
  direction?: TreasuryDirection
}) {
  const short = treasuryAfterShort(treasury.kind, treasuryAfter(treasury, amountCents, direction))
  if (short === null) return null
  return (
    <>
      {treasury.name}: {short.before}{' '}
      <span className="whitespace-nowrap">
        <span aria-hidden="true">→</span>
        <span className="sr-only">después:</span> {short.after}
      </span>
    </>
  )
}

// ─── El resumen del pie (celular) ────────────────────────────────────────────

/**
 * En el celular el ticket queda fuera de la vista casi todo el recorrido, y el
 * botón del pie está siempre a mano: sin esto se podía cargar un gasto «sin
 * factura» (lo que viene elegido) sin haber visto nunca qué papel llevaba. Un
 * renglón arriba del botón dice lo mismo que el ticket, en chico: a quién, con
 * qué papel y de dónde sale. Si todavía falta algo, dice qué.
 *
 * Desde `sm` no va: ahí los papeles y el ticket se ven al lado de lo que se toca.
 */
export function FooterSummary({
  who,
  paper,
  from,
  missing,
}: {
  /** El proveedor o la categoría. */
  who: string
  /** «Con factura A», «Sin factura» (el texto del sello). */
  paper: string
  /** «sale de Caja», «con Visa». */
  from: string
  /** Lo que falta para poder cargarlo; `null` si no falta nada. */
  missing: string | null
}) {
  if (missing !== null) {
    return <p className="truncate text-xs text-muted-foreground sm:hidden">{missing}</p>
  }
  return (
    <p className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground sm:hidden">
      <span className="min-w-0 truncate">{who}</span>
      <span aria-hidden="true">·</span>
      <span className="shrink-0 font-semibold text-foreground">{paper}</span>
      <span aria-hidden="true">·</span>
      <span className="max-w-[40%] shrink-0 truncate">{from}</span>
    </p>
  )
}

// ─── Recién cargado ──────────────────────────────────────────────────────────

/**
 * Con «Cargar otro después» la hoja se vacía y sigue abierta: arriba queda lo
 * último que se cargó, con el tilde que se dibuja. El toast con «Deshacer»
 * sigue saliendo igual; esto es para no perder el hilo cuando se cargan varios.
 */
export function SavedNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2.5 rounded-xl bg-secondary/50 px-3.5 py-2.5 text-sm"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-3.5">
          <path
            className="adm-tick adm-tick-draw"
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="3.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="min-w-0 text-pretty">{children}</span>
    </p>
  )
}
