import { Coins, Gift, type LucideIcon, QrCode, Sparkles, TrendingUp } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import type { WalletData } from '@/lib/wallet/queries'
import { tierAccent } from './tier-accent'
import { formatEarnRate } from './wallet-format'
import { WalletMoreButton } from './wallet-more-button'

// "Cómo funciona": la pantalla que faltaba. La regla que hace girar al club — el
// nivel se calcula sobre una VENTANA MÓVIL de N meses, así que puede bajar — no
// estaba dicha en ningún lado del lado del socio (sí en el panel del dueño). Un
// socio que baja de nivel sin haberla escuchado nunca no siente una regla:
// siente que le robaron los puntos. Acá se cuenta antes de que pase, con el
// modelo mental de las aerolíneas: millas de status que caducan vs. millas que
// gastás.
//
// La tasa de acumulación sale de la config REAL del tenant (nada hardcodeado);
// si no se puede enunciar sin mentir, cae a un texto genérico (ver earn-rate.ts).

type Earn = WalletData['earn']

function CoinCard({
  icon: Icon,
  title,
  pill,
  style,
  children,
}: {
  icon: LucideIcon
  title: string
  pill: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <article
      style={style}
      className="card-hairline rounded-2xl border border-border/70 bg-card p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-(--acc)/15 text-(--acc)">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <h3 className="truncate font-display text-base font-semibold tracking-tight text-foreground">
            {title}
          </h3>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full border border-(--acc)/35 bg-(--acc)/12 px-2.5 py-1 text-[11px] font-semibold text-foreground">
          {pill}
        </span>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{children}</p>
    </article>
  )
}

/** Un extremo de la línea de tiempo de la ventana móvil. */
function Step({
  tone,
  when,
  children,
}: {
  tone: 'now' | 'later'
  when: string
  children: ReactNode
}) {
  return (
    <div className="relative flex flex-col items-center gap-2 text-center">
      <span
        className={
          tone === 'now'
            ? 'size-3.5 rounded-full bg-(--acc) ring-4 ring-card'
            : 'size-3.5 rounded-full border-2 border-border bg-card ring-4 ring-card'
        }
        aria-hidden="true"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">
          {when}
        </span>
        <span className="text-[11px] leading-tight text-muted-foreground text-balance">
          {children}
        </span>
      </span>
    </div>
  )
}

function EarnRow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-(--brand-accent)/12 text-(--brand-accent)">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <p className="text-[13px] leading-snug text-muted-foreground">{children}</p>
    </li>
  )
}

export function HowItWorks({
  windowMonths,
  earn,
  tierColor,
  onNiveles,
  onCanjeables,
}: {
  windowMonths: number
  earn: Earn
  /** Color del nivel actual → tiñe la moneda de status (igual que el carnet). */
  tierColor: string | null
  onNiveles?: () => void
  onCanjeables?: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      {/* ── Las dos monedas ─────────────────────────────────────────── */}
      <section aria-labelledby="monedas-heading" className="space-y-3">
        <div className="space-y-1">
          <h2 id="monedas-heading" className="font-display text-lg font-semibold tracking-tight">
            Tenés dos tipos de puntos
          </h2>
          <p className="text-xs text-muted-foreground">
            Los dos suman con cada consumo, pero hacen cosas distintas.
          </p>
        </div>

        <CoinCard
          style={tierAccent(tierColor)}
          icon={TrendingUp}
          title="Puntos de categoría"
          pill={`Duran ${windowMonths} meses`}
        >
          Definen tu <span className="font-semibold text-foreground">nivel</span>. Para calcularlo
          contamos sólo los que ganaste en los últimos {windowMonths} meses: los más viejos van
          saliendo de la cuenta. Por eso el nivel sube si venís seguido y baja si dejás de venir. No
          se gastan al canjear.
        </CoinCard>

        <CoinCard style={tierAccent(null)} icon={Gift} title="Puntos canjeables" pill="No vencen">
          Son los que <span className="font-semibold text-foreground">gastás</span> en el catálogo.
          No vencen nunca y no cambian tu nivel: canjealos cuando quieras.
        </CoinCard>
      </section>

      {/* ── La ventana móvil, con un ejemplo ────────────────────────── */}
      <section
        aria-labelledby="ventana-heading"
        style={tierAccent(tierColor)}
        className="space-y-3"
      >
        <div className="space-y-1">
          <h2 id="ventana-heading" className="font-display text-lg font-semibold tracking-tight">
            La ventana de {windowMonths} meses
          </h2>
          <p className="text-xs text-muted-foreground">Un ejemplo para que quede claro.</p>
        </div>

        <div className="card-hairline space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
          <div className="relative grid grid-cols-2 gap-3">
            {/* Rail punteado entre los centros de los dos puntos (size-3.5 → 7px) */}
            <div
              aria-hidden="true"
              className="absolute inset-x-[25%] top-[7px] h-0.5 -translate-y-1/2"
              style={{
                background:
                  'repeating-linear-gradient(90deg, var(--border) 0 5px, transparent 5px 10px)',
              }}
            />
            <Step tone="now" when="Hoy">
              Sumás <span className="font-semibold text-foreground tabular-nums">400 pts</span> con
              tu consumo
            </Step>
            <Step tone="later" when={`En ${windowMonths} meses`}>
              Esos <span className="font-semibold text-foreground tabular-nums">400</span> dejan de
              contar para tu nivel
            </Step>
          </div>

          <p className="rounded-xl bg-(--cream-tint) px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">
              Tus puntos canjeables no se tocan.
            </span>{' '}
            La ventana sólo mueve tu nivel — lo que tenías para canjear sigue ahí, esperándote.
          </p>
        </div>
      </section>

      {/* ── Cómo sumás ──────────────────────────────────────────────── */}
      <section aria-labelledby="sumar-heading" className="space-y-3">
        <h2 id="sumar-heading" className="font-display text-lg font-semibold tracking-tight">
          Cómo sumás
        </h2>
        <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          <EarnRow icon={QrCode}>
            Mostrá tu QR en la caja cuando pagás. Los puntos entran solos.
          </EarnRow>
          <EarnRow icon={Coins}>
            {earn.rate ? (
              <>
                Sumás{' '}
                <span className="font-semibold text-foreground">{formatEarnRate(earn.rate)}</span>{' '}
                de consumo.
              </>
            ) : (
              <>Sumás puntos con cada consumo.</>
            )}
          </EarnRow>
          {earn.itemBonus ? (
            <EarnRow icon={Sparkles}>Además, algunos productos suman puntos extra.</EarnRow>
          ) : null}
        </ul>
      </section>

      {/* ── A dónde ir ahora ────────────────────────────────────────── */}
      {onNiveles || onCanjeables ? (
        <section className="space-y-2">
          {onNiveles ? (
            <WalletMoreButton onClick={onNiveles}>Ver niveles y beneficios</WalletMoreButton>
          ) : null}
          {onCanjeables ? (
            <WalletMoreButton onClick={onCanjeables}>Ver el catálogo de canje</WalletMoreButton>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
