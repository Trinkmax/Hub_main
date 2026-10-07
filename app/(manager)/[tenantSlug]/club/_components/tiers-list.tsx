'use client'

import {
  Gift,
  Handshake,
  type LucideIcon,
  Pencil,
  Percent,
  Plus,
  Sparkles,
  Trash2,
  Trophy,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ICON_LABELS, resolveIcon } from '@/components/icons/curated-lucide'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DialogTrigger } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatNumber } from '@/lib/format/number-kind'
import { deleteTier } from '@/lib/points/actions'
import {
  BENEFIT_KIND_META,
  groupBenefitsByKind,
  type TierBenefit,
  type TierBenefitKind,
} from '@/lib/points/benefits'
import type { LoyaltyTier } from '@/lib/points/tiers'
import { BenefitsEditor } from './benefits-editor'
import { TIER_STATUS } from './club-status'
import { ROW_LIST_CLASSES, readableTextOn } from './club-ui'
import { TierForm } from './tier-form'

const DEFAULT_COLOR = '#8a6d3b'

type IdName = { id: string; name: string }

/** Ícono por tipo de beneficio (espejo de BENEFIT_KIND_META[k].icon). */
const KIND_ICON: Record<TierBenefitKind, LucideIcon> = {
  recurring_reward: Gift,
  discount: Percent,
  perk: Sparkles,
  partner: Handshake,
}

// Niveles sugeridos para el arranque rápido (orden de menor a mayor umbral).
const STARTER_TIERS: Array<{ name: string; color: string; min: number }> = [
  { name: 'Bronce', color: '#a06a3f', min: 0 },
  { name: 'Plata', color: '#9aa3ad', min: 400 },
  { name: 'Oro', color: '#c79a2e', min: 1000 },
]

function BenefitChips({ benefits }: { benefits: TierBenefit[] }) {
  const groups = groupBenefitsByKind(benefits)
  if (groups.length === 0) {
    return (
      <p className="type-caption text-subtle-foreground">
        Todavía no desbloquea nada: cargale beneficios.
      </p>
    )
  }
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Beneficios del nivel">
      {groups.map(({ kind, items }) => (
        <li key={kind}>
          <Badge icon={KIND_ICON[kind]}>
            {BENEFIT_KIND_META[kind].label}
            {items.length > 1 ? <span className="type-amount"> · {items.length}</span> : null}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

export function TiersList({
  tenantSlug,
  tenantId,
  tiers,
  benefitsByTier,
  rewards,
  partners,
}: {
  tenantSlug: string
  /** Necesario para subir fotos de beneficio al bucket del tenant. */
  tenantId: string
  tiers: LoyaltyTier[]
  /** Beneficios de cada nivel, agrupados por tier_id. */
  benefitsByTier: Record<string, TierBenefit[]>
  /** Recompensas activas (para el beneficio `recurring_reward`). */
  rewards: IdName[]
  /** Marcas aliadas (para el beneficio `partner`). */
  partners: IdName[]
}) {
  const [editing, setEditing] = useState<LoyaltyTier | null>(null)
  // El nivel a borrar queda guardado mientras el diálogo se cierra: así el
  // título no se vacía durante la animación de salida.
  const [toDelete, setToDelete] = useState<LoyaltyTier | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Orden visual: por umbral asc, desempate por sort asc.
  const ordered = tiers
    .slice()
    .sort((a, b) => a.min_category_points - b.min_category_points || a.sort - b.sort)

  // ── Vacío ─────────────────────────────────────────────────
  if (ordered.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={Trophy}
          title="Todavía no hay niveles"
          description="Los niveles convierten a tus clientes habituales en VIPs: cuantos más puntos de categoría suman (los ganados en los últimos 4 meses), más beneficios desbloquean. Creá el primero o usá el arranque rápido."
          action={
            <TierForm
              tenantSlug={tenantSlug}
              trigger={
                <DialogTrigger asChild>
                  <Button>
                    <Plus aria-hidden="true" />
                    Crear el primer nivel
                  </Button>
                </DialogTrigger>
              }
            />
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>Arranque rápido sugerido</CardTitle>
            <CardDescription>
              Un esquema clásico de tres niveles. Creá cada uno con su botón y después ajustá los
              puntos de categoría a tu medida.
            </CardDescription>
          </CardHeader>
          <ol className="divide-y divide-border">
            {STARTER_TIERS.map((s) => (
              <li key={s.name} className="flex min-h-12 items-center gap-3 py-2">
                <span
                  className="size-6 shrink-0 rounded-full border border-border-strong"
                  style={{ backgroundColor: s.color }}
                  aria-hidden="true"
                />
                <span className="flex-1 type-body font-medium">{s.name}</span>
                <span className="type-small type-amount text-muted-foreground">
                  desde {formatNumber(s.min)} pts
                </span>
                <TierForm
                  tenantSlug={tenantSlug}
                  seed={{
                    name: s.name,
                    color: s.color,
                    badge_icon: null,
                    min_category_points: s.min,
                    sort: 0,
                    perks: null,
                  }}
                  trigger={
                    <DialogTrigger asChild>
                      <Button size="sm" variant="secondary" aria-label={`Crear el nivel ${s.name}`}>
                        Crear
                      </Button>
                    </DialogTrigger>
                  }
                />
              </li>
            ))}
          </ol>
        </Card>
      </div>
    )
  }

  // ── La escalera de niveles ────────────────────────────────
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-small text-muted-foreground">
          {ordered.length} {ordered.length === 1 ? 'nivel configurado' : 'niveles configurados'}
        </p>
        <TierForm
          tenantSlug={tenantSlug}
          trigger={
            <DialogTrigger asChild>
              <Button variant="secondary">
                <Plus aria-hidden="true" />
                Nuevo nivel
              </Button>
            </DialogTrigger>
          }
        />
      </div>

      <ol className={ROW_LIST_CLASSES} aria-label="Niveles, de menor a mayor">
        {ordered.map((tier, index) => {
          const swatch = tier.color ?? DEFAULT_COLOR
          const tierBenefits = benefitsByTier[tier.id] ?? []
          const BadgeIcon = tier.badge_icon ? resolveIcon(tier.badge_icon, Sparkles) : null
          return (
            <li key={tier.id} className="flex flex-wrap items-start gap-3 p-4 sm:flex-nowrap">
              {/* Escalón: el color del nivel con su número en la escalera. */}
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border-strong type-label type-amount"
                style={{ backgroundColor: swatch, color: readableTextOn(swatch) }}
                aria-hidden="true"
              >
                {index + 1}
              </span>

              {/* En el celular el texto ocupa la fila entera y las acciones bajan
                  a la siguiente: al lado, los tres botones lo apretaban a una
                  columna de 70 px («Desde / 200 pts / de / categoría»). */}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 max-sm:basis-[calc(100%-3.25rem)]">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="type-subtitle text-foreground">
                    <span className="sr-only">Nivel {index + 1}: </span>
                    {tier.name}
                  </h3>
                  <StatusBadge status={tier.active ? 'active' : 'inactive'} map={TIER_STATUS} />
                  {BadgeIcon && tier.badge_icon ? (
                    <Badge icon={BadgeIcon}>
                      {ICON_LABELS[tier.badge_icon] ?? tier.badge_icon}
                    </Badge>
                  ) : null}
                </div>

                <p className="type-small text-muted-foreground">
                  Desde{' '}
                  <span className="type-amount font-semibold text-foreground">
                    {formatNumber(tier.min_category_points)}
                  </span>{' '}
                  pts de categoría
                </p>

                {tier.perks ? (
                  <p className="max-w-prose type-small text-pretty text-muted-foreground">
                    {tier.perks}
                  </p>
                ) : null}

                <BenefitChips benefits={tierBenefits} />
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1 max-sm:w-full max-sm:justify-end">
                <BenefitsEditor
                  tenantSlug={tenantSlug}
                  tenantId={tenantId}
                  tier={{ id: tier.id, name: tier.name }}
                  benefits={tierBenefits}
                  rewards={rewards}
                  partners={partners}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setEditing(tier)}
                  aria-label={`Editar el nivel ${tier.name}`}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="danger-ghost"
                  onClick={() => {
                    setToDelete(tier)
                    setDeleteOpen(true)
                  }}
                  aria-label={`Borrar el nivel ${tier.name}`}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>
          )
        })}
      </ol>

      {/* Form de edición controlado: una sola instancia para todas las filas */}
      <TierForm
        tenantSlug={tenantSlug}
        tier={editing ?? undefined}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title={`¿Borrar el nivel «${toDelete?.name ?? ''}»?`}
        description="Los clientes de este nivel pasan al de abajo según sus puntos de categoría y se borran también sus beneficios. No se puede deshacer."
        confirmLabel="Borrar nivel"
        pendingLabel="Borrando…"
        onConfirm={async () => {
          if (!toDelete) return
          const target = toDelete
          const result = await deleteTier(tenantSlug, target.id)
          if (!result.ok) return result
          toast.success(`Nivel «${target.name}» borrado.`)
        }}
      />
    </div>
  )
}
