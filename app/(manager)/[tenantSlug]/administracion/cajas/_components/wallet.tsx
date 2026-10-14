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
import { Skeleton } from '@/components/ui/skeleton'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { WalletCardView, WalletView } from '../_lib/wallet-view'
import { CajasAcciones, CajasArchivos } from './cajas-acciones'

/**
 * El encabezado de la billetera. Hasta `xl`, una cosa debajo de la otra: el
 * total, el conteo, las acciones y los archivos. Desde `xl`, dos columnas: el
 * dato a la izquierda y lo que se hace con él a la derecha, así el total no
 * queda solo con media pantalla vacía al lado. Las dos filas están alineadas
 * (el total con las acciones, el conteo con los archivos) y «¿Cómo se
 * calcula?» se abre hacia abajo sin mover las acciones.
 */
const HEAD =
  'grid grid-cols-1 gap-4 xl:grid-cols-[minmax(22rem,1fr)_minmax(0,34rem)] xl:items-end xl:gap-x-10 xl:gap-y-3'

/**
 * La grilla de tarjetas se acomoda a SU ancho (no al de la ventana: con el menú
 * abierto hay 260 px menos) y a cuántas cajas hay, para que ninguna quede sola
 * en una fila con medio ancho vacío:
 * - dos cajas: siempre mitad y mitad;
 * - tres (o cinco, o más): de a dos con la última a lo ancho; de a tres cuando entran;
 * - cuatro: dos y dos; las cuatro en fila cuando entran.
 * Las clases van escritas enteras (Tailwind no ve una clase armada al vuelo).
 */
function gridOf(count: number): { list: string; item: string } {
  if (count <= 1) return { list: 'grid max-w-md grid-cols-1 gap-4', item: 'flex' }
  if (count === 2)
    return { list: 'grid grid-cols-1 gap-4 @[36rem]/cards:grid-cols-2', item: 'flex' }
  if (count === 4) {
    return {
      list: 'grid grid-cols-1 gap-4 @[36rem]/cards:grid-cols-2 @[68rem]/cards:grid-cols-4',
      item: 'flex',
    }
  }
  return {
    list: 'grid grid-cols-1 gap-4 @[36rem]/cards:grid-cols-2 @[51rem]/cards:grid-cols-3',
    item: 'flex @[36rem]/cards:@max-[51rem]/cards:last:odd:col-span-2',
  }
}

function CardGrid({ label, cards }: { label: string; cards: readonly WalletCardView[] }) {
  const grid = gridOf(cards.length)
  return (
    <div className="@container/cards">
      <ul aria-label={label} className={grid.list}>
        {cards.map((card) => (
          <li key={card.id} className={grid.item}>
            <TreasuryCard card={card} />
          </li>
        ))}
      </ul>
    </div>
  )
}

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

      <div className={HEAD}>
        <MoneyHero
          size="lg"
          animate
          label={view.label}
          cents={view.cents}
          sentence={view.sentence}
          className="xl:col-start-1 xl:row-start-1"
        />
        {/* El conteo y «¿Cómo se calcula?» en un renglón; abierta, la cuenta baja a lo ancho. */}
        <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 xl:col-start-1 xl:row-start-2 xl:mt-0 xl:self-start">
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
        <CajasAcciones
          base={base}
          hasNonCash={view.hasNonCash}
          className="xl:col-start-2 xl:row-start-1"
        />
        {/* En la compu, pegado a las acciones; en el celular va después de las tarjetas. */}
        <CajasArchivos
          base={base}
          hasWallet={view.hasWallet}
          hasBank={view.hasBank}
          className="max-sm:hidden xl:col-start-2 xl:row-start-2 xl:self-start xl:pt-1"
        />
      </div>

      <div className="space-y-3">
        <CardGrid label="Tus cajas" cards={view.cards} />
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
          <CardGrid label="Tarjetas de la empresa" cards={view.companyCards} />
        </div>
      ) : null}

      {view.inactive.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Desactivadas con saldo</span> · no suman a
            lo disponible
          </p>
          <CardGrid label="Cajas desactivadas con saldo" cards={view.inactive} />
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

const SKELETON_CARDS = ['a', 'b', 'c'] as const
const SKELETON_ACTIONS = ['a', 'b', 'c', 'd'] as const

/**
 * La billetera mientras carga, con su forma: el total, las cuatro acciones (en
 * el celular, círculos con su nombre; en la compu, a la derecha del total) y
 * tres tarjetas con su lomo. Lo usan `loading.tsx` y el cambio de vista.
 */
export function WalletSkeleton() {
  const grid = gridOf(SKELETON_CARDS.length)
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className={HEAD}>
        <div className="space-y-2.5 xl:col-start-1 xl:row-start-1">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-10 w-64 max-w-full sm:h-12" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
        <Skeleton className="-mt-2 h-6 w-64 max-w-full rounded-full xl:col-start-1 xl:row-start-2 xl:mt-0" />
        <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap xl:col-start-2 xl:row-start-1 xl:grid xl:grid-cols-2">
          {SKELETON_ACTIONS.map((key) => (
            <div key={key} className="flex flex-col items-center gap-1.5 sm:block">
              <Skeleton className="size-12 rounded-full sm:h-11 sm:w-40 xl:h-14 xl:w-full xl:rounded-2xl" />
              <Skeleton className="h-3 w-14 sm:hidden" />
            </div>
          ))}
        </div>
        <Skeleton className="h-3 w-80 max-w-full max-sm:hidden xl:col-start-2 xl:row-start-2" />
      </div>

      <div className="@container/cards">
        <div className={grid.list}>
          {SKELETON_CARDS.map((key) => (
            <div
              key={key}
              className={cn(
                grid.item,
                'card-hairline relative flex-col overflow-hidden rounded-2xl border bg-card p-4 pt-[1.375rem] shadow-xs',
              )}
            >
              <Skeleton className="absolute inset-x-0 top-0 h-1.5 rounded-none" />
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="mt-4 h-9 w-44" />
              <Skeleton className="mt-3 h-6 w-40 rounded-full" />
              <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                <Skeleton className="h-3 w-36" />
                <Skeleton className="h-11 w-20 rounded-full sm:h-9" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
