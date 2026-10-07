import { Cake, ChevronRight, Clock3, Crown, TrendingDown } from 'lucide-react'
import Image from 'next/image'
import type { CSSProperties } from 'react'
import { NumberTicker } from '@/components/ui/number-ticker'
import type { WalletData } from '@/lib/wallet/queries'
import { LucideByName } from './benefit-icon'
import { cardInk, isHexColor } from './tier-accent'
import { formatBirthday, formatDayMonth, formatPoints } from './wallet-format'

// El "carnet": una TARJETA DE SOCIO de verdad, a todo color del nivel, con
// reflejo (gloss diagonal + barrido al montar + brillo de borde) y el logo del
// bar en foil monocromo. Debajo, las dos monedas en tarjetas claras (los saldos
// funcionales) y la FRANJA DE LA REGLA (ver <CategoryRule>).
// Server Component; los números animan con <NumberTicker>.
//
// Contraste: la tinta (texto + logo) se elige por nivel con el mejor contraste
// (crema sobre tiers oscuros, forest sobre tiers claros) → AA sobre cualquier hex.

type Tier = WalletData['tier']
type Expiry = WalletData['expiry']
type Tenant = WalletData['tenant']
type Customer = WalletData['customer']

function CurrencyHalf({
  onSelect,
  label,
  value,
  unitColorClass,
  sub,
  delayMs,
  washed = false,
}: {
  /** Cambia de vista dentro de la wallet; undefined = mitad no interactiva. */
  onSelect?: () => void
  label: string
  value: number
  unitColorClass: string
  sub: React.ReactNode
  delayMs: number
  washed?: boolean
}) {
  const base = `group flex min-w-0 flex-col gap-1 p-4 text-left ${washed ? 'bg-(--acc)/[0.045]' : ''}`
  const body = (
    <>
      <span className="text-[10px] font-semibold uppercase leading-tight tracking-[0.07em] text-muted-foreground">
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <NumberTicker
          value={value}
          formatKind="integer"
          durationMs={650}
          delayMs={delayMs}
          className={`font-display text-[clamp(1.8rem,7vw,2.3rem)] font-semibold leading-none tracking-tight ${unitColorClass}`}
        />
        <span className="text-xs font-medium text-muted-foreground">pts</span>
      </span>
      <span className="mt-0.5 flex items-center gap-0.5 text-[11px] leading-tight text-muted-foreground">
        {sub}
        {onSelect ? (
          <ChevronRight
            className="size-3 shrink-0 translate-x-0 text-(--acc) opacity-0 transition-all duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:translate-x-0.5 group-hover:opacity-100"
            aria-hidden="true"
          />
        ) : null}
      </span>
    </>
  )
  if (!onSelect) return <div className={base}>{body}</div>
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`${base} outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground active:bg-(--acc)/[0.05]`}
    >
      {body}
    </button>
  )
}

/**
 * La regla, SIEMPRE visible al pie del carnet. Es la única pieza que le cuenta al
 * socio que los puntos de categoría caducan — antes vivía sólo en el aviso de
 * vencimiento, que aparece recién a 30 días de perderlos (o sea: nunca, para el
 * 90% de los socios). Tres estados, siempre con la regla o su consecuencia:
 *   sin vencimiento próximo → "Tus puntos de categoría duran N meses"
 *   con vencimiento          → "X pts vencen el DD/MM" + la regla abajo
 *   con vencimiento que baja → idem, en tono de aviso, + "volvé para no bajar a Y"
 * Además es la puerta a "Cómo funciona" (si el contenedor pasa `onHelp`).
 */
function CategoryRule({
  windowMonths,
  expiry,
  onHelp,
}: {
  windowMonths: number
  expiry: Expiry
  onHelp?: () => void
}) {
  const drops = expiry?.wouldDrop === true
  const Icon = drops ? TrendingDown : Clock3
  const hint = expiry
    ? `Los puntos de categoría duran ${windowMonths} meses`
    : onHelp
      ? 'Mirá cómo funciona el club'
      : null

  const base = `flex w-full items-center gap-2.5 border-t border-border/60 px-4 py-2.5 text-left ${
    drops ? 'bg-warning/[0.08]' : 'bg-(--cream-tint)'
  }`
  const body = (
    <>
      <Icon
        className={`size-4 shrink-0 ${drops ? 'text-warning' : 'text-muted-foreground'}`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] leading-tight text-foreground">
          {expiry ? (
            <>
              <span className="font-semibold tabular-nums">{formatPoints(expiry.points)} pts</span>{' '}
              vencen el{' '}
              <span className="font-semibold tabular-nums">{formatDayMonth(expiry.expiresAt)}</span>
              {drops ? (
                <span className="text-muted-foreground">
                  {expiry.toTierName
                    ? ` · volvé para no bajar a ${expiry.toTierName}`
                    : ' · volvé para no bajar de nivel'}
                </span>
              ) : null}
            </>
          ) : (
            <>
              Tus puntos de categoría{' '}
              <span className="font-semibold">duran {windowMonths} meses</span>
            </>
          )}
        </span>
        {hint ? (
          <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
      {onHelp ? (
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      ) : null}
    </>
  )

  if (!onHelp) return <div className={base}>{body}</div>
  return (
    <button
      type="button"
      onClick={onHelp}
      className={`group ${base} outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground`}
    >
      {body}
    </button>
  )
}

export function Carnet({
  customer,
  tenant,
  tier,
  categoryPoints,
  pointsBalance,
  windowMonths,
  expiry,
  onNiveles,
  onCanjeables,
  onHelp,
}: {
  customer: Customer
  tenant: Tenant
  tier: Tier
  categoryPoints: number
  pointsBalance: number
  windowMonths: number
  expiry: Expiry
  /** Abre la vista de niveles; undefined = moneda no interactiva. */
  onNiveles?: () => void
  /** Abre la vista de canje; undefined = moneda no interactiva. */
  onCanjeables?: () => void
  /** Abre "Cómo funciona"; undefined = la franja de la regla es sólo informativa. */
  onHelp?: () => void
}): React.JSX.Element {
  const fullName = `${customer.firstName} ${customer.lastName}`.trim()
  const birthday = customer.birthdate ? formatBirthday(customer.birthdate) : null
  const tierName = tier.current?.name ?? null
  const color = tier.current?.color ?? null
  const acc = isHexColor(color) ? color : 'var(--primary)'
  const { ink, light, logoFilter } = cardInk(color)

  // Superficie de tarjeta: highlight radial arriba-izq + degradado del color del
  // nivel (más claro arriba, más profundo abajo). Los tiers claros (Gold) oscurecen
  // poco para no restar contraste al texto forest; los oscuros oscurecen más.
  const surface: CSSProperties = {
    color: ink,
    background: `radial-gradient(120% 82% at 14% -5%, color-mix(in oklab, white 22%, transparent), transparent 52%), linear-gradient(150deg, color-mix(in oklab, ${acc} 86%, white), ${acc} 46%, color-mix(in oklab, ${acc} ${light ? '74%' : '90%'}, #090b0a))`,
  }

  return (
    <section
      aria-label="Tu carnet de socio"
      style={{ '--acc': acc } as CSSProperties}
      className="space-y-3"
    >
      {/* ── La tarjeta de socio (a todo color) ─────────────────────── */}
      <article
        style={surface}
        className="carnet-sheen relative isolate flex min-h-[13.5rem] flex-col justify-between overflow-hidden rounded-[1.4rem] p-5 shadow-lg"
      >
        {/* Guilloché (textura de seguridad tipo tarjeta) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'repeating-radial-gradient(circle at 86% 16%, transparent 0 13px, color-mix(in srgb, currentColor 9%, transparent) 13px 14px)',
            maskImage: 'radial-gradient(circle at 86% 16%, black, transparent 62%)',
            WebkitMaskImage: 'radial-gradient(circle at 86% 16%, black, transparent 62%)',
          }}
        />
        {/* Reflejo: franja diagonal de luz (gloss) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(103deg, transparent 33%, rgba(255,255,255,0.10) 43%, rgba(255,255,255,0.34) 50%, rgba(255,255,255,0.08) 57%, transparent 67%)',
          }}
        />
        {/* Profundidad: brillo de borde superior + viñeta inferior (solo en tarjetas oscuras) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            boxShadow: light
              ? 'inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -55px 55px -30px rgba(0,0,0,0.5)'
              : 'inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -30px 45px -30px rgba(0,0,0,0.12)',
          }}
        />

        {/* Cabecera: logo (foil) + nivel */}
        <div className="relative z-[1] flex items-start justify-between gap-3">
          {tenant.logoUrl ? (
            <Image
              src={tenant.logoUrl}
              alt={tenant.name}
              width={200}
              height={85}
              unoptimized
              priority
              className="h-9 w-auto max-w-[8rem] shrink-0 object-contain object-left"
              style={{ filter: logoFilter }}
            />
          ) : (
            <p className="font-display text-xl font-semibold tracking-tight" style={{ color: ink }}>
              {tenant.name}
            </p>
          )}
          {tierName ? (
            <span className="inline-flex max-w-[55%] shrink-0 items-center gap-1.5">
              <LucideByName
                name={tier.current?.badgeIcon}
                fallback={Crown}
                className="size-4 shrink-0 opacity-90"
              />
              <span className="truncate text-sm font-semibold uppercase tracking-[0.14em]">
                {tierName}
              </span>
            </span>
          ) : null}
        </div>

        {/* Socio */}
        <div className="relative z-[1]">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] opacity-70">Socio</p>
          <h2 className="mt-0.5 font-display text-2xl font-semibold leading-tight tracking-tight">
            {fullName}
          </h2>
          {birthday ? (
            <span
              className="mt-2.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ backgroundColor: 'color-mix(in srgb, currentColor 15%, transparent)' }}
            >
              <Cake className="size-3" aria-hidden="true" />
              Cumple {birthday}
            </span>
          ) : null}
        </div>
      </article>

      {/* ── Las dos monedas (saldos, sobre superficie clara) ───────── */}
      <div className="card-hairline overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="grid grid-cols-2 divide-x divide-border/60">
          {/* STATUS: color de tier, define el nivel, puede bajar (la regla va abajo). */}
          <CurrencyHalf
            onSelect={onNiveles}
            label="Puntos de categoría"
            value={categoryPoints}
            unitColorClass="text-(--acc)"
            delayMs={220}
            washed
            sub={<span>Definen tu nivel</span>}
          />
          {/* GASTO: forest de marca, no vence, se descuenta al canjear. */}
          <CurrencyHalf
            onSelect={onCanjeables}
            label="Puntos canjeables"
            value={pointsBalance}
            unitColorClass="text-(--brand-accent)"
            delayMs={300}
            sub={<span>No vencen</span>}
          />
        </div>

        {/* La regla (full-width → mantiene simétricas las mitades). SIEMPRE visible:
            es el contrapunto del "No vencen" de la moneda de al lado. */}
        <CategoryRule windowMonths={windowMonths} expiry={expiry} onHelp={onHelp} />
      </div>
    </section>
  )
}
