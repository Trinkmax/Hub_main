import {
  ArrowLeftRight,
  ArrowRight,
  CircleEllipsis,
  FileUp,
  Landmark,
  type LucideIcon,
} from 'lucide-react'
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
import type { TreasuryTone } from '@/lib/accounting/home'
import { TREASURY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import type { TreasuryKind } from '@/lib/accounting/types'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { type CajaHeroView, type CountStatus, TREASURY_MOVES } from '../../_lib/wallet-view'

/** La píldora callada de «lo demás que se hace con esta caja»: 44 px en el celular. */
const QUIET =
  'inline-flex h-11 items-center gap-1.5 rounded-full border border-border/70 bg-card px-4 text-sm font-medium whitespace-nowrap text-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]'

function QuietLink({
  href,
  icon: Icon,
  children,
}: {
  href: string
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <Link href={href} className={QUIET}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {children}
    </Link>
  )
}

/**
 * «La tarjeta abierta»: la misma tarjeta de la billetera, en grande. A la
 * izquierda, cuánta plata hay y la oración del período, con su cuenta; a la
 * derecha, si coincide con lo que hay de verdad y EL botón de la pantalla
 * («Contar la caja», o «Ya me entró» en una billetera con plata en camino).
 * Debajo, calladas, las otras cosas que se hacen con esta caja.
 *
 * Quien solo lee ve el número, la cuenta y el estado del conteo; ningún botón
 * (`canWrite` apaga las píldoras y `ActionButton` no se dibuja en solo lectura).
 */
export function CajaHero({
  treasuryId,
  name,
  kind,
  tone,
  active,
  hero,
  fallback = null,
  count,
  pendingCents,
  opening = null,
  base,
  canWrite,
}: {
  treasuryId: string
  name: string
  kind: TreasuryKind
  /** El color de la caja (`walletTones`): el mismo que en la billetera y en el Resumen. */
  tone: TreasuryTone | null
  active: boolean
  /** `null`: no se pudieron leer los movimientos del período (lo dice el bloque de abajo). */
  hero: CajaHeroView | null
  /** Lo que hay hoy según los saldos, para cuando `hero` no está. */
  fallback?: { label: string; cents: number } | null
  /** `null` en una caja desactivada: ya no se cuenta. */
  count: CountStatus | null
  /** Billeteras: lo vendido con QR y transferencia que todavía no entró. */
  pendingCents: number
  /**
   * Faltan los saldos iniciales y la caja nunca se movió: el «$ 0» no es un dato. Se dice que
   * todavía no se sabe y EL botón es cargar lo que hay (contarla ahora anotaría como sobrante
   * toda la plata que hay). `href`: la puesta en marcha.
   */
  opening?: { href: string } | null
  /** `/<bar>/administracion`. */
  base: string
  canWrite: boolean
}) {
  const arriving = pendingCents > 0
  const card = kind === 'credit_card'
  const writes = canWrite && active

  return (
    <WalletCard
      size="lg"
      name={TREASURY_KIND_LABELS[kind] ?? 'Cuenta'}
      kind={kind}
      detail={active ? TREASURY_MOVES[kind] : 'Está desactivada: ya no suma a la plata disponible.'}
      tone={tone}
      muted={!active}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start lg:gap-8">
        <div className="min-w-0 space-y-3">
          {opening ? (
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {card ? 'Debés hoy' : 'Hay hoy'}
              </p>
              <p className="mt-2 font-serif text-3xl font-semibold leading-[1.08] tracking-tight text-balance sm:text-4xl">
                Todavía no sé cuánto hay
              </p>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
                {canWrite
                  ? `Contame cuánto hay hoy en ${name} y empiezo a llevar la cuenta. Es una sola vez.`
                  : 'Todavía no se cargó lo que había al arrancar: hasta entonces, el saldo no es un dato.'}
              </p>
            </div>
          ) : hero ? (
            <>
              <MoneyHero
                size="xl"
                animate
                label={hero.label}
                cents={hero.cents}
                sentence={hero.sentence}
              />
              <Explain note={hero.note} className="max-w-xl">
                {hero.math.map((row) => (
                  <MathRow key={row.key} op={row.op} label={row.label} value={row.value} />
                ))}
              </Explain>
            </>
          ) : (
            // No se pudieron leer los movimientos del período: queda lo que hay hoy, sin su cuenta.
            <MoneyHero
              size="xl"
              label={fallback?.label ?? (card ? 'Debés hoy' : 'Hay hoy')}
              cents={fallback?.cents ?? null}
            />
          )}
        </div>

        {opening && active && canWrite ? (
          <div className="space-y-3 rounded-xl bg-secondary/50 p-4">
            <p className="text-sm font-medium text-pretty">¿Cuánto había en {name} al arrancar?</p>
            <p className="text-xs text-muted-foreground text-pretty">
              Primero esto: si la contás antes, toda la plata queda anotada como sobrante.
            </p>
            <Button asChild className="h-12 w-full gap-2 rounded-full text-base font-semibold">
              <Link href={opening.href}>
                Cargar lo que había
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </Button>
          </div>
        ) : opening ? null : active && (count || arriving) ? (
          <div className="space-y-3 rounded-xl bg-secondary/50 p-4">
            <p className="text-sm font-medium text-pretty">
              {!canWrite
                ? 'El conteo de esta caja'
                : arriving
                  ? '¿Ya te entró lo que estaba en camino?'
                  : card
                    ? '¿Coincide con lo que dice el resumen?'
                    : '¿Coincide con lo que hay de verdad?'}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {arriving ? (
                <StatusPill tone="info">{formatCentsShort(pendingCents)} en camino</StatusPill>
              ) : null}
              {count ? <StatusPill tone={count.tone}>{count.text}</StatusPill> : null}
            </div>
            <ActionButton
              action="ajustar"
              params={{ caja: treasuryId }}
              aria-label={arriving ? `Ya me entró lo de ${name}` : `Contar ${name}`}
              className="h-12 w-full rounded-full text-base font-semibold"
            >
              {arriving ? 'Ya me entró' : 'Contar la caja'}
            </ActionButton>
          </div>
        ) : null}
      </div>

      {writes ? (
        <ul
          aria-label={`Otras cosas que se hacen con ${name}`}
          className="mt-5 flex flex-wrap gap-2 border-t border-border/60 pt-4"
        >
          <li>
            <ActionButton
              action="mover"
              params={{ caja: treasuryId }}
              variant="outline"
              className={cn(QUIET, 'shadow-none')}
            >
              <ArrowLeftRight aria-hidden className="size-4 shrink-0" />
              {card ? 'Pagar el resumen' : 'Mover plata'}
            </ActionButton>
          </li>
          {card ? null : (
            <li>
              <ActionButton
                action="movimiento"
                params={{ caja: treasuryId }}
                variant="outline"
                className={cn(QUIET, 'shadow-none')}
              >
                <CircleEllipsis aria-hidden className="size-4 shrink-0" />
                Otra entrada o salida
              </ActionButton>
            </li>
          )}
          {kind === 'cash' ? null : (
            <li>
              <QuietLink href={`${base}/cajas/gasto-bancario?caja=${treasuryId}`} icon={Landmark}>
                Gastos del banco
              </QuietLink>
            </li>
          )}
          {kind === 'wallet' ? (
            <li>
              <QuietLink href={`${base}/importar/mercado-pago`} icon={FileUp}>
                Subir el reporte de Mercado Pago
              </QuietLink>
            </li>
          ) : null}
          {kind === 'bank' ? (
            <li>
              <QuietLink href={`${base}/importar/banco`} icon={FileUp}>
                Subir los movimientos del banco
              </QuietLink>
            </li>
          ) : null}
        </ul>
      ) : null}
    </WalletCard>
  )
}
