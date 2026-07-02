import { Crown } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { WalletData } from '@/lib/wallet/queries'
import { LucideByName } from './benefit-icon'
import { isHexColor, tierAccent } from './tier-accent'
import { formatPoints } from './wallet-format'

// El recorrido de niveles: mapa horizontal (Classic → … → Signature) con el
// nivel actual resaltado ("estás acá") y un rail que se rellena hasta el
// próximo. Cada nodo muestra su umbral en puntos → clarísimo cuánto cuesta cada
// categoría. Server Component; deriva todo de `progression` + `tier`.

type Step = WalletData['progression'][number]

export function TierLadder({
  progression,
  tier,
  categoryPoints,
}: {
  progression: Step[]
  tier: WalletData['tier']
  categoryPoints: number
}): React.JSX.Element | null {
  // Un recorrido de 1 solo nivel no aporta nada (nodo suelto + rail a la nada).
  if (progression.length <= 1) return null

  const n = progression.length
  const hasCurrent = progression.some((s) => s.current)
  const currentIndex = Math.max(
    0,
    progression.findIndex((s) => s.current),
  )
  const accent = tierAccent(progression[currentIndex]?.color ?? null)

  // Relleno del rail: escalones recorridos + fracción hacia el próximo. Si el
  // socio está por DEBAJO del nivel más bajo (sin nivel actual), el progreso vive
  // antes del primer nodo y el rail no lo puede dibujar → 0 (no adelantar de más).
  const fraction = tier.next ? tier.progressPct / 100 : 1
  const fillPct = hasCurrent ? ((currentIndex + fraction) / (n - 1)) * 100 : 0

  return (
    <section aria-labelledby="ladder-heading" style={accent} className="space-y-4">
      <div className="space-y-1">
        <h2 id="ladder-heading" className="font-display text-lg font-semibold tracking-tight">
          Tu recorrido de niveles
        </h2>
        <p className="text-xs text-muted-foreground">
          Sumás puntos de categoría con tu consumo y vas subiendo de nivel.
        </p>
      </div>

      <div className="card-hairline rounded-2xl border border-border/70 bg-card px-3 pb-4 pt-5 shadow-sm">
        <div className="relative px-2">
          {/* Rail de fondo + relleno (entre el centro del primer y último nodo) */}
          <div
            aria-hidden="true"
            className="absolute left-[calc(0.5rem+1.75rem)] right-[calc(0.5rem+1.75rem)] top-[1.125rem] h-1 -translate-y-1/2 rounded-full bg-border/80"
          >
            <div
              className="rail-grow h-full rounded-full bg-(--acc)"
              style={{ width: `${Math.max(0, Math.min(100, fillPct))}%` }}
            />
          </div>

          <ol className="relative flex items-start justify-between">
            {progression.map((s) => {
              // --node = color del tier (o el acento de marca). El texto/glyph va
              // SIEMPRE en forest (--foreground); el color del tier vive en el
              // anillo y el tinte del disco → legible sobre cualquier hex (AA).
              const nodeStyle = {
                '--node': isHexColor(s.color) ? s.color : 'var(--acc)',
                backgroundColor: s.unlocked
                  ? `color-mix(in oklch, var(--node) ${s.current ? 26 : 16}%, var(--card))`
                  : undefined,
              } as CSSProperties
              return (
                <li key={s.id} className="flex w-[3.5rem] flex-col items-center gap-1.5">
                  <span
                    style={nodeStyle}
                    className={[
                      'relative grid size-9 place-items-center rounded-full',
                      s.current
                        ? 'tier-node-pulse scale-[1.16] text-foreground shadow-sm ring-2 ring-(--node) ring-offset-2 ring-offset-card'
                        : s.unlocked
                          ? 'text-foreground shadow-sm ring-1 ring-(--node)'
                          : 'border-2 border-dashed border-border bg-(--cream-tint) text-muted-foreground/45',
                    ].join(' ')}
                  >
                    <LucideByName name={s.badgeIcon} fallback={Crown} className="size-4" />
                  </span>
                  <span className="flex w-full flex-col items-center gap-0.5 text-center leading-none">
                    <span
                      title={s.name}
                      className={[
                        'max-w-full truncate',
                        s.current
                          ? 'text-[10px] font-semibold text-foreground'
                          : 'text-[10px] font-medium text-muted-foreground',
                      ].join(' ')}
                    >
                      {s.name}
                    </span>
                    <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                      {s.minCategoryPoints === 0 ? 'Base' : formatPoints(s.minCategoryPoints)}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>
        </div>

        <div className="mt-4 space-y-0.5 border-t border-border/60 pt-3 text-center">
          {tier.next && tier.pointsToNext !== null ? (
            <>
              <p className="text-xs text-muted-foreground text-balance">
                Te faltan{' '}
                <span className="font-semibold text-(--acc) tabular-nums">
                  {formatPoints(tier.pointsToNext)} pts
                </span>{' '}
                para <span className="font-semibold text-foreground">{tier.next.name}</span>
              </p>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {formatPoints(categoryPoints)} / {formatPoints(tier.next.thresholdPoints)} pts
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-foreground">Estás en el nivel máximo 🎉</p>
              {progression[currentIndex] && tier.current ? (
                <p className="text-[11px] text-muted-foreground text-balance">
                  Mantené{' '}
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatPoints(progression[currentIndex]?.minCategoryPoints ?? 0)} pts
                  </span>{' '}
                  para conservar {tier.current.name}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
