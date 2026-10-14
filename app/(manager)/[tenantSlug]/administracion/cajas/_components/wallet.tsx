import { ArrowRight, ChevronRight, Plus } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  Explain,
  MathRow,
  MoneyHero,
  StatusPill,
  WalletCard,
} from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import type { WalletCardView, WalletView } from '../_lib/wallet-view'
import { CajasAcciones, CajasArchivos } from './cajas-acciones'

const GRID = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'

/**
 * La billetera: lo primero que se ve en Cajas y bancos. Como la app del banco
 * o de Mercado Pago: cuánta plata hay en total, la fila de acciones, y una
 * tarjeta por caja con su color, lo que tiene y si ya la contaste.
 *
 * Reemplaza a las cuatro tarjetas de números y a la tabla de saldos (que queda
 * detrás de «Ver como tabla y exportar», en `table`). El total, la oración y
 * el color de cada caja son los mismos del Resumen (`walletView`).
 *
 * Cada tarjeta ofrece UNA acción y en toda la pantalla hay un solo botón
 * relleno. Quien solo lee no recibe ninguno: `walletView` ya no arma acciones
 * y `CajasAcciones` / `ActionButton` no se dibujan en solo lectura.
 */
export function Wallet({
  view,
  base,
  canWrite,
  table,
}: {
  view: Extract<WalletView, { kind: 'normal' }>
  /** `/<bar>/administracion`. */
  base: string
  canWrite: boolean
  /** La tabla de saldos con su «Exportar»: va plegada (abierta para la contadora). */
  table: ReactNode
}) {
  return (
    <section aria-label="La billetera" className="space-y-6">
      {view.openingMissing ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-info/25 bg-info/8 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <StatusPill tone="info">Falta decir con cuánto arrancaste</StatusPill>
            <p className="text-sm text-pretty">
              {view.openingMissing.since
                ? `Los números cuentan solo lo cargado desde el ${formatDayMonth(view.openingMissing.since)}.`
                : 'Los números cuentan solo lo que cargaste hasta ahora.'}
            </p>
          </div>
          {canWrite ? (
            <Button
              asChild
              variant="outline"
              className="h-11 shrink-0 gap-2 self-start sm:self-auto"
            >
              <Link href={view.openingMissing.href}>
                Cargar lo que había
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="space-y-2">
          <MoneyHero
            size="lg"
            animate
            label={view.label}
            cents={view.cents}
            sentence={view.sentence}
          />
          {/* El conteo y «¿Cómo se calcula?» en un renglón; abierta, la cuenta baja a lo ancho. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatusPill tone={view.countPill.tone}>{view.countPill.text}</StatusPill>
            <Explain
              note="Es lo que dice el sistema según lo que se cargó. Las tarjetas de la empresa no suman (son una deuda) y lo que está en camino tampoco, hasta que entra."
              className="open:basis-full [&>div]:max-w-xl"
            >
              {view.math.map((row) => (
                <MathRow key={row.key} op={row.op} label={row.label} value={row.value} />
              ))}
              <MathRow op="=" label={view.label} value={formatCentsShort(view.cents)} />
            </Explain>
          </div>
        </div>
        <CajasAcciones base={base} hasNonCash={view.hasNonCash} />
        {/* En la compu, pegado a las acciones; en el celular va después de las tarjetas. */}
        <CajasArchivos
          base={base}
          hasWallet={view.hasWallet}
          hasBank={view.hasBank}
          className="max-sm:hidden"
        />
      </div>

      <div className="space-y-3">
        <ul aria-label="Tus cajas" className={GRID}>
          {view.cards.map((card) => (
            <li key={card.id} className="flex">
              <TreasuryCard card={card} />
            </li>
          ))}
        </ul>
        {canWrite ? (
          <Link
            href={`${base}/ajustes?tab=cajas`}
            className="group flex min-h-11 items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-2 text-sm outline-none transition-colors duration-(--duration-fast) hover:border-primary/40 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            <Plus aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 text-pretty">
              <span className="font-medium">Agregar una caja o cuenta</span>
              <span className="text-muted-foreground max-sm:hidden">
                {' '}
                · un banco, otra billetera, la tarjeta de la empresa
              </span>
            </span>
          </Link>
        ) : null}
        <CajasArchivos
          base={base}
          hasWallet={view.hasWallet}
          hasBank={view.hasBank}
          className="sm:hidden"
        />
      </div>

      {view.companyCards.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Tarjetas de la empresa</span> · no suman:
            son deuda
          </p>
          <ul aria-label="Tarjetas de la empresa" className={GRID}>
            {view.companyCards.map((card) => (
              <li key={card.id} className="flex">
                <TreasuryCard card={card} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.inactive.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Desactivadas con saldo</span> · no suman a
            lo disponible
          </p>
          <ul aria-label="Cajas desactivadas con saldo" className={GRID}>
            {view.inactive.map((card) => (
              <li key={card.id} className="flex">
                <TreasuryCard card={card} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* La tabla, para quien la quiere. Un <details> nativo: anda sin JavaScript. */}
      <details open={!canWrite} className="group/table">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-4 transition-transform duration-(--duration-fast) ease-(--ease-out) group-open/table:rotate-90 motion-reduce:transition-none"
          />
          Ver como tabla y exportar
        </summary>
        <div className="mt-3">{table}</div>
      </details>
    </section>
  )
}

/** La tarjeta de una caja en la portada: lo que tiene, cómo viene el conteo y su única acción. */
function TreasuryCard({ card }: { card: WalletCardView }) {
  const { money } = card
  return (
    <WalletCard
      className="w-full"
      name={card.name}
      kind={card.kind}
      detail={card.detail}
      tone={card.tone}
      href={card.href}
      muted={card.muted}
      amountLabel={money.label ?? undefined}
      amount={
        money.amount ?? (
          // «Sin deuda» va en lugar del número: no es un importe.
          <span className="font-sans text-xl font-medium text-muted-foreground">{money.words}</span>
        )
      }
      status={
        card.pendingCents > 0 || card.status ? (
          <>
            {card.pendingCents > 0 ? (
              <StatusPill tone="info">{formatCentsShort(card.pendingCents)} en camino</StatusPill>
            ) : null}
            {card.status ? (
              <StatusPill tone={card.status.tone}>{card.status.text}</StatusPill>
            ) : null}
          </>
        ) : undefined
      }
      footer={card.footer}
      action={
        card.action ? (
          <ActionButton
            action={card.action.sheet}
            params={{ caja: card.id }}
            variant={card.action.filled ? 'default' : 'outline'}
            aria-label={card.action.ariaLabel}
            className="h-11 rounded-full px-4 sm:h-9"
          >
            {card.action.label}
          </ActionButton>
        ) : undefined
      }
    />
  )
}
