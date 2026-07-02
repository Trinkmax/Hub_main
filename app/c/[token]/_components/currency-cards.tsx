import { ArrowRight, Cake, Clock3, Crown, TrendingDown } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { WalletData } from '@/lib/wallet/queries'
import { LucideByName } from './benefit-icon'
import { formatBirthday, formatDayMonth, formatPoints } from './wallet-format'

// El "carnet": identidad del socio + las DOS monedas explicadas (categoría vs
// canjeables). Concepto del dueño: que se entienda la dinámica de un vistazo.
// Server component. La tarjeta de categoría toma el color del nivel; la de
// canjeables, el acento de marca.

type Tier = WalletData['tier']
type Expiry = WalletData['expiry']

function accent(color: string | null): CSSProperties {
  const isHex = color !== null && /^#[0-9a-fA-F]{6}$/.test(color)
  return { '--acc': isHex ? color : 'var(--brand-accent, var(--primary))' } as CSSProperties
}

function CtaLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="group mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[--acc] transition-transform duration-[var(--duration-fast)] active:scale-[0.98]"
    >
      {children}
      <ArrowRight className="size-3.5 transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:translate-x-0.5" />
    </a>
  )
}

export function CurrencyCards({
  customer,
  tier,
  categoryPoints,
  pointsBalance,
  windowMonths,
  expiry,
}: {
  customer: WalletData['customer']
  tier: Tier
  categoryPoints: number
  pointsBalance: number
  windowMonths: number
  expiry: Expiry
}): React.JSX.Element {
  const fullName = `${customer.firstName} ${customer.lastName}`.trim()
  const birthday = customer.birthdate ? formatBirthday(customer.birthdate) : null
  const tierName = tier.current?.name ?? null

  return (
    <section aria-label="Tus puntos" className="space-y-3">
      {/* Identidad de socio */}
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="font-serif text-lg font-semibold tracking-tight">{fullName}</p>
        {birthday ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[--cream-tint] px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Cake className="size-3" aria-hidden="true" />
            Cumple {birthday}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3">
        {/* Puntos de categoría */}
        <article
          style={accent(tier.current?.color ?? null)}
          className="card-hairline animate-in fade-in slide-in-from-bottom-2 duration-[var(--duration-slow)] relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-60"
            style={{
              background:
                'radial-gradient(80% 100% at 100% 0%, color-mix(in oklch, var(--acc) 14%, transparent), transparent 70%)',
            }}
          />
          <div className="relative flex items-start justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Puntos de categoría
            </p>
            {tierName ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[--acc]/30 bg-[--acc]/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-foreground shadow-sm">
                <LucideByName
                  name={tier.current?.badgeIcon}
                  fallback={Crown}
                  className="size-3 text-[--acc]"
                />
                {tierName}
              </span>
            ) : null}
          </div>
          <p className="relative mt-1 max-w-[34ch] text-[11px] leading-snug text-muted-foreground">
            Se acumulan con tu consumo de los últimos {windowMonths} meses y definen tu categoría.
          </p>
          <p className="relative mt-3 font-display text-[2.75rem] font-semibold leading-none tracking-tight text-[--acc] tabular-nums">
            {formatPoints(categoryPoints)}
            <span className="ml-1.5 align-baseline text-sm font-medium text-muted-foreground">
              pts
            </span>
          </p>
          {expiry ? (
            <p className="relative mt-2 inline-flex items-center gap-1.5 text-[11px] leading-tight text-foreground">
              {expiry.wouldDrop ? (
                <TrendingDown className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
              ) : (
                <Clock3 className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
              )}
              <span>
                <span className="font-semibold tabular-nums">
                  {formatPoints(expiry.points)} pts
                </span>{' '}
                vencen el{' '}
                <span className="font-semibold tabular-nums">
                  {formatDayMonth(expiry.expiresAt)}
                </span>
              </span>
            </p>
          ) : null}
          <CtaLink href="#niveles">Ver mis beneficios y categorías</CtaLink>
        </article>

        {/* Puntos canjeables */}
        <article
          style={accent(null)}
          className="card-hairline animate-in fade-in slide-in-from-bottom-2 duration-[var(--duration-slow)] relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Puntos canjeables
          </p>
          <p className="mt-1 max-w-[34ch] text-[11px] leading-snug text-muted-foreground">
            Son los que podés gastar para canjear por comida, bebidas o experiencias en eventos.
          </p>
          <p className="mt-3 font-display text-[2.75rem] font-semibold leading-none tracking-tight text-[--acc] tabular-nums">
            {formatPoints(pointsBalance)}
            <span className="ml-1.5 align-baseline text-sm font-medium text-muted-foreground">
              pts
            </span>
          </p>
          <CtaLink href="#canjeables">Ver qué puedo canjear</CtaLink>
        </article>
      </div>
    </section>
  )
}
