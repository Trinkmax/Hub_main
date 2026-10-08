import {
  Banknote,
  CircleDollarSign,
  CreditCard,
  Download,
  HandCoins,
  Landmark,
  type LucideIcon,
  Percent,
  Truck,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Amount } from '@/components/administracion/amount'
import { balanceText } from '@/components/administracion/format'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/ui/stat-card'
import type { AccSummary, SummaryTreasury } from '@/lib/accounting/queries/summary'
import type { TreasuryKind } from '@/lib/accounting/types'
import { formatDayMonth, monthName } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { availableBreakdownParts, monthWord, treasuryNormalBalance } from './summary-copy'

/**
 * Los bloques del Resumen (H.4) con las piezas del panel: fila de
 * `StatCard`, tarjetas con título como las de Estadísticas. Server-safe.
 */

export function SummaryCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('card-hairline overflow-hidden rounded-xl border bg-card', className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-serif text-lg font-semibold tracking-tight">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', className)} />
}

function Status({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Dot className={dot} />
      {children}
    </span>
  )
}

/**
 * Tramos separados por « · » que cortan línea entre ellos («Caja $ 643.000 ·
 * Banco Nación $ 1.802.750»: nunca «Banco» arriba y «Nación $ …» abajo). Cada
 * tramo es inline-block: entero si entra en el renglón; si solo él ya no entra
 * («Tarjetas de crédito (Posnet) $ 2.536.151» en una tarjeta angosta), se parte
 * adentro en vez de salirse de la tarjeta, con el importe pegado a su nombre.
 */
function Joined({ parts }: { parts: readonly string[] }) {
  const seen = new Map<string, number>()
  return parts.map((part, index) => {
    const n = (seen.get(part) ?? 0) + 1
    seen.set(part, n)
    const last = index === parts.length - 1
    return (
      <span key={`${part}#${n}`}>
        {/* El «·» cierra el tramo (pegado con espacio duro) y el corte va después:
            ningún renglón empieza con el punto. */}
        <span className="inline-block">
          {part.replace(/ (?=\$)/g, ' ')}
          {last ? null : ' ·'}
        </span>
        {last ? null : ' '}
      </span>
    )
  })
}

/** Los cuatro números (H.4): plata, le debés, te deben, IVA del mes. Sin animación. */
export function SummaryKpis({
  summary,
  today,
  vatRegistered,
}: {
  summary: AccSummary
  today: string
  /** La SAS es responsable inscripta (si no, no hay IVA del mes). */
  vatRegistered: boolean
}) {
  const { payables, receivables, ivaMonth } = summary
  const ivaMonthName = monthName(Number((ivaMonth?.month ?? today).slice(5, 7)))

  let payHint: ReactNode = 'Todavía no está disponible.'
  if (payables) {
    payHint =
      payables.overdueCents > 0 ? (
        <Status dot="bg-destructive">
          <span className="text-destructive">
            {formatCentsShort(payables.overdueCents)} vencido
          </span>
        </Status>
      ) : payables.totalCents > 0 ? (
        <Status dot="bg-success">Al día</Status>
      ) : (
        'Sin deudas con proveedores.'
      )
  }

  let receiveHint: ReactNode = 'Todavía no está disponible.'
  if (receivables) {
    const top = receivables.top.slice(0, 2).map((r) => `${r.name} ${formatCentsShort(r.openCents)}`)
    receiveHint =
      receivables.totalCents === 0 ? (
        'Nadie te debe nada.'
      ) : (
        <span className="block space-y-0.5">
          {top.length > 0 ? (
            <span className="block">
              <Joined parts={top} />
            </span>
          ) : null}
          {receivables.overdueCents > 0 ? (
            <Status dot="bg-warning">
              <span className="text-warning-text">
                {formatCentsShort(receivables.overdueCents)} atrasado
              </span>
            </Status>
          ) : null}
        </span>
      )
  }

  let ivaValue = '—'
  let ivaHint: ReactNode = vatRegistered
    ? 'Todavía no está disponible.'
    : 'La SAS no liquida IVA (no es responsable inscripta).'
  if (ivaMonth) {
    // «A pagar» / «A favor» van como primer renglón y no como pastilla: con el menú
    // abierto a 1280 px la tarjeta queda angosta y la pastilla se salía del borde.
    let side: ReactNode = null
    if (ivaMonth.toPayCents > 0) {
      ivaValue = formatCentsShort(ivaMonth.toPayCents)
      side = <span className="block font-medium text-foreground">A pagar</span>
    } else if (ivaMonth.inFavorCents > 0) {
      ivaValue = formatCentsShort(ivaMonth.inFavorCents)
      side = <span className="block font-medium text-success">A favor</span>
    } else {
      ivaValue = formatCentsShort(0)
    }
    ivaHint = (
      <span className="block space-y-0.5">
        {side}
        <span className="block">
          {ivaMonth.provisional ? 'Estimado: lo confirma la contadora.' : 'Mes cerrado.'}
        </span>
      </span>
    )
  }

  return (
    <section aria-label="Números clave" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={Wallet}
        iconClassName="text-success"
        label="Plata disponible"
        value={formatCentsShort(summary.availableCents)}
        hint={
          summary.treasuries.length > 0 ? (
            <Joined parts={availableBreakdownParts(summary)} />
          ) : (
            'Sin cajas cargadas.'
          )
        }
      />
      <StatCard
        icon={Truck}
        iconClassName="text-warning"
        label="Le debés a proveedores"
        value={payables ? formatCentsShort(payables.totalCents) : '—'}
        hint={payHint}
      />
      <StatCard
        icon={HandCoins}
        iconClassName="text-info"
        label="Te deben"
        value={receivables ? formatCentsShort(receivables.totalCents) : '—'}
        hint={receiveHint}
      />
      <StatCard
        icon={Percent}
        iconClassName="text-primary"
        label={ivaMonthName ? `IVA de ${ivaMonthName}` : 'IVA del mes'}
        value={ivaValue}
        hint={ivaHint}
      />
    </section>
  )
}

/** «Este mes» (hasta hoy): lo vendido y lo gastado. Nunca «ganaste». */
export function ThisMonthCard({
  summary,
  today,
  base,
}: {
  summary: AccSummary
  today: string
  base: string
}) {
  const day = Number(today.slice(8, 10))
  const month = monthName(Number(today.slice(5, 7)))
  return (
    <SummaryCard title="Este mes" description={`Del 1 al ${day} de ${month}`}>
      {/* Al lado de «Necesita atención» la tarjeta queda angosta: ahí los dos importes
          van uno abajo del otro (en dos columnas se pisaban, «$ 8.008.970 $ 1.001.700»). */}
      <div className="@container">
        <dl className="grid grid-cols-1 gap-4 px-5 py-4 @[22rem]:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <dt className="text-xs text-muted-foreground">Vendiste</dt>
            <dd className="font-serif text-2xl font-semibold tracking-tight tabular-nums">
              {formatCentsShort(summary.monthToDate.soldCents)}
            </dd>
          </div>
          <div className="min-w-0 space-y-1">
            <dt className="text-xs text-muted-foreground">Compras y gastos</dt>
            <dd className="font-serif text-2xl font-semibold tracking-tight tabular-nums">
              {formatCentsShort(summary.monthToDate.purchasesAndExpensesCents)}
            </dd>
          </div>
        </dl>
      </div>
      <p className="border-t border-border/60 px-5 py-3 text-xs text-muted-foreground text-pretty">
        Lo vendido sale de los cierres del día: no es ganancia.{' '}
        <Link
          href={`${base}/ventas?tab=neto-por-medio`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Ver neto por medio de cobro
        </Link>
      </p>
    </SummaryCard>
  )
}

const KIND_ICON: Readonly<Record<TreasuryKind, LucideIcon>> = {
  cash: Banknote,
  bank: Landmark,
  wallet: Wallet,
  credit_card: CreditCard,
  other: CircleDollarSign,
}

const KIND_LABEL: Readonly<Record<TreasuryKind, string>> = {
  cash: 'Efectivo',
  bank: 'Banco',
  wallet: 'Billetera',
  credit_card: 'Tarjeta de la empresa',
  other: 'Otra',
}

/**
 * El saldo de una caja como se lee: «$ X», «Descubierto $ X» o, en la tarjeta,
 * «Deuda $ X». Sin centavos, como el resto de los números del Resumen.
 */
export function TreasuryBalance({ treasury }: { treasury: SummaryTreasury }) {
  if (treasury.kind === 'credit_card') {
    const debt = treasuryNormalBalance(treasury)
    return (
      <span className="whitespace-nowrap text-sm font-medium tabular-nums">
        {debt > 0
          ? `Deuda ${balanceText(debt, 'treasury', { decimals: 0 })}`
          : balanceText(-debt, 'treasury', { decimals: 0 })}
      </span>
    )
  }
  return (
    <Amount
      cents={treasury.balanceCents}
      balance="treasury"
      decimals={0}
      tone="auto"
      className="text-sm font-medium"
    />
  )
}

/** «Cajas y cuentas»: cada una con su saldo, el último movimiento y el último ajuste. */
export function TreasuriesCard({
  treasuries,
  base,
}: {
  treasuries: readonly SummaryTreasury[]
  base: string
}) {
  return (
    <SummaryCard
      title="Cajas y cuentas"
      description="Tocá una para ver sus movimientos."
      action={
        <Link
          href={`${base}/cajas`}
          className="inline-flex min-h-11 items-center text-xs font-medium text-muted-foreground hover:text-foreground md:min-h-0"
        >
          Ver todas
        </Link>
      }
    >
      {treasuries.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Todavía no hay cajas cargadas.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {treasuries.map((t) => {
            const Icon = KIND_ICON[t.kind]
            const details = [
              KIND_LABEL[t.kind],
              t.lastMovementDate
                ? `Último movimiento ${formatDayMonth(t.lastMovementDate)}`
                : 'Sin movimientos',
              t.lastCheckedOn ? `Ajustada el ${formatDayMonth(t.lastCheckedOn)}` : null,
            ].filter((part): part is string => Boolean(part))
            return (
              <li key={t.id}>
                <Link
                  href={`${base}/cajas/${t.id}`}
                  className="flex min-h-14 items-center gap-3 px-5 py-3 outline-none transition-colors hover:bg-cream-tint focus-visible:bg-cream-tint focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {t.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      <Joined parts={details} />
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <TreasuryBalance treasury={t} />
                    {t.pendingWalletCents > 0 ? (
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        + {formatCentsShort(t.pendingWalletCents)} por acreditar
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </SummaryCard>
  )
}

/** Para la contadora, en lugar de «Necesita atención» (H.4). */
export function BooksStatusCard({
  books,
  base,
  lastClosedText,
  openMonthText,
}: {
  books: AccSummary['books']
  base: string
  lastClosedText: string
  openMonthText: string | null
}) {
  const packageMonth = books.lastClosedMonth?.slice(0, 7) ?? null
  return (
    <SummaryCard title="Estado de los libros">
      <div className="space-y-3 px-5 py-4 text-sm">
        <p className="text-pretty">{lastClosedText}</p>
        {openMonthText ? (
          <p className="text-muted-foreground text-pretty">{openMonthText}</p>
        ) : null}
        {packageMonth && books.lastClosedMonth ? (
          <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
            <Link href={`${base}/libros?mes=${packageMonth}#paquete-del-mes`}>
              <Download className="size-4" aria-hidden />
              Descargar el paquete de {monthWord(books.lastClosedMonth).toLowerCase()}
            </Link>
          </Button>
        ) : null}
      </div>
    </SummaryCard>
  )
}
