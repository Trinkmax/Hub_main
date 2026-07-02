import { Crown } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { WalletData } from '@/lib/wallet/queries'
import { LucideByName } from './benefit-icon'
import { formatPoints } from './wallet-format'

// Escalera de niveles: el recorrido completo (Classic → … → Signature) con el
// nivel actual resaltado y una barra de progreso hasta el siguiente. Server
// component. Deriva todo de `progression` + `tier`.

type Step = WalletData['progression'][number]

export function TierLadder({
  progression,
  tier,
}: {
  progression: Step[]
  tier: WalletData['tier']
}): React.JSX.Element | null {
  if (progression.length === 0) return null

  const n = progression.length
  const currentIndex = Math.max(
    0,
    progression.findIndex((s) => s.current),
  )
  const currentColor = progression[currentIndex]?.color ?? null
  const accent: CSSProperties = {
    '--acc':
      currentColor && /^#[0-9a-fA-F]{6}$/.test(currentColor)
        ? currentColor
        : 'var(--brand-accent, var(--primary))',
  } as CSSProperties

  // Un solo relleno de la vía: escalones recorridos + fracción hacia el próximo.
  const fraction = tier.next ? tier.progressPct / 100 : 1
  const fillPct =
    n <= 1 ? (progression[0]?.unlocked ? 100 : 0) : ((currentIndex + fraction) / (n - 1)) * 100

  return (
    <section aria-label="Tu recorrido de categorías" style={accent} className="space-y-3">
      <div className="relative px-3 pt-1">
        {/* Vía de fondo + relleno de progreso (entre el centro del primer y último nodo) */}
        <div
          aria-hidden="true"
          className="absolute left-[calc(0.75rem+1.125rem)] right-[calc(0.75rem+1.125rem)] top-[1.375rem] h-0.5 rounded-full bg-border"
        >
          <div
            className="h-full rounded-full bg-[--acc] transition-[width] duration-[var(--duration-slower)] ease-[var(--ease-out)]"
            style={{ width: `${Math.max(0, Math.min(100, fillPct))}%` }}
          />
        </div>

        <ol className="relative flex items-start justify-between">
          {progression.map((s) => {
            const isHex = s.color && /^#[0-9a-fA-F]{6}$/.test(s.color)
            const nodeStyle = isHex ? ({ '--node': s.color } as CSSProperties) : undefined
            return (
              <li key={s.id} className="flex w-[3.75rem] flex-col items-center gap-1.5">
                <span
                  style={nodeStyle}
                  className={[
                    'grid size-9 place-items-center rounded-full transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)]',
                    s.unlocked
                      ? 'bg-[--node,var(--acc)] text-[color:oklch(1_0_0)] shadow-sm'
                      : 'border border-border bg-[--cream-tint] text-muted-foreground/50',
                    s.current
                      ? 'scale-110 ring-2 ring-[--node,var(--acc)] ring-offset-2 ring-offset-background'
                      : '',
                  ].join(' ')}
                >
                  <LucideByName name={s.badgeIcon} fallback={Crown} className="size-4" />
                </span>
                <span
                  className={[
                    'text-center text-[10px] leading-tight',
                    s.current ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {s.name}
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      <p className="text-center text-xs text-muted-foreground text-balance">
        {tier.next && tier.pointsToNext !== null ? (
          <>
            Te faltan{' '}
            <span className="font-semibold text-[--acc] tabular-nums">
              {formatPoints(tier.pointsToNext)} pts
            </span>{' '}
            para <span className="font-medium text-foreground">{tier.next.name}</span>
          </>
        ) : (
          <span className="font-medium text-foreground">Llegaste al nivel máximo 🎉</span>
        )}
      </p>
    </section>
  )
}
