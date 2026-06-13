'use client'

import { Cake, CalendarClock, Pencil, Plus, Trash2, Trophy } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DialogTrigger } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { deleteTier, type LoyaltyActionState } from '@/lib/points/actions'
import type { Reward } from '@/lib/points/queries'
import type { LoyaltyTier, TierBenefitCadence } from '@/lib/points/tiers'
import { cn } from '@/lib/utils'
import { TierForm } from './tier-form'

const DEFAULT_COLOR = '#8a6d3b'

const CADENCE_LABEL: Record<TierBenefitCadence, string> = {
  none: 'Ninguno',
  birthday: 'Cumpleaños',
  monthly: 'Mensual',
}

// Niveles sugeridos para el arranque rápido (orden de menor a mayor umbral).
const STARTER_TIERS: Array<{ name: string; color: string; min: number }> = [
  { name: 'Bronce', color: '#a06a3f', min: 0 },
  { name: 'Plata', color: '#9aa3ad', min: 500 },
  { name: 'Oro', color: '#c79a2e', min: 1500 },
]

function CadenceBadge({ cadence }: { cadence: TierBenefitCadence }) {
  if (cadence === 'none') return null
  const Icon = cadence === 'birthday' ? Cake : CalendarClock
  return (
    <Badge variant="muted" className="gap-1">
      <Icon className="size-3" aria-hidden />
      {CADENCE_LABEL[cadence]}
    </Badge>
  )
}

export function TiersList({
  tenantSlug,
  tiers,
  rewards,
}: {
  tenantSlug: string
  tiers: LoyaltyTier[]
  rewards: Reward[]
}) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<LoyaltyTier | null>(null)
  const [pendingDelete, setPendingDelete] = useState<LoyaltyTier | null>(null)

  // Map id → nombre de recompensa para mostrar el beneficio recurrente.
  const rewardName = (id: string | null): string | null => {
    if (!id) return null
    return rewards.find((r) => r.id === id)?.name ?? 'Recompensa eliminada'
  }

  // Orden visual: por umbral asc, desempate por sort asc.
  const ordered = tiers
    .slice()
    .sort((a, b) => a.min_lifetime_points - b.min_lifetime_points || a.sort - b.sort)

  const onConfirmDelete = () => {
    if (!pendingDelete) return
    const target = pendingDelete
    startTransition(async () => {
      const result: LoyaltyActionState = await deleteTier(tenantSlug, target.id)
      if (result.ok) {
        toast.success(`Nivel "${target.name}" eliminado.`)
      } else {
        toast.error(result.message)
      }
      setPendingDelete(null)
    })
  }

  // ── Empty state ───────────────────────────────────────────
  if (ordered.length === 0) {
    return (
      <div className="space-y-5">
        <EmptyState
          icon={Trophy}
          title="Todavía no hay niveles"
          description="Los niveles convierten a tus clientes habituales en VIPs: cuanto más acumulan, más beneficios desbloquean. Empezá creando el primero o usá el arranque rápido."
          action={
            <TierForm
              tenantSlug={tenantSlug}
              rewards={rewards}
              trigger={
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="size-4" />
                    Crear primer nivel
                  </Button>
                </DialogTrigger>
              }
            />
          }
        />

        {/* Sugerencia de 3 niveles starter */}
        <div className="card-hairline rounded-xl border border-border/70 bg-card/85 p-5">
          <h3 className="font-serif text-base font-semibold tracking-tight">
            Arranque rápido sugerido
          </h3>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Un esquema clásico de tres niveles. Creá cada uno con el botón y ajustá los umbrales a
            tu medida.
          </p>
          <ol className="mt-4 space-y-2">
            {STARTER_TIERS.map((s) => (
              <li
                key={s.name}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5"
              >
                <span
                  className="size-6 shrink-0 rounded-full border border-black/10 shadow-2xs"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="flex-1 font-medium">{s.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  desde {s.min.toLocaleString('es-AR')} pts
                </span>
                <TierForm
                  tenantSlug={tenantSlug}
                  rewards={rewards}
                  seed={{
                    name: s.name,
                    color: s.color,
                    badge_icon: null,
                    min_lifetime_points: s.min,
                    sort: 0,
                    perks: null,
                  }}
                  trigger={
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        Crear
                      </Button>
                    </DialogTrigger>
                  }
                />
              </li>
            ))}
          </ol>
        </div>
      </div>
    )
  }

  // ── Ladder de niveles ─────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {ordered.length} {ordered.length === 1 ? 'nivel configurado' : 'niveles configurados'}
        </p>
        <TierForm
          tenantSlug={tenantSlug}
          rewards={rewards}
          trigger={
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4" />
                Nuevo nivel
              </Button>
            </DialogTrigger>
          }
        />
      </div>

      <ol className="space-y-3">
        {ordered.map((tier, index) => {
          const benefit = rewardName(tier.benefit_reward_id)
          const swatch = tier.color ?? DEFAULT_COLOR
          return (
            <li
              key={tier.id}
              className={cn(
                'card-hairline relative rounded-xl border border-border/70 bg-card/85 p-4 transition-shadow hover:shadow-sm',
                !tier.active && 'opacity-70',
              )}
            >
              {/* Banda de color a la izquierda */}
              <span
                className="absolute inset-y-3 left-0 w-1 rounded-full"
                style={{ backgroundColor: swatch }}
                aria-hidden
              />
              <div className="flex flex-wrap items-start gap-3 pl-2">
                {/* Swatch + escalón */}
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <span
                    className="flex size-10 items-center justify-center rounded-full border border-black/10 text-xs font-semibold tabular-nums text-white shadow-2xs"
                    style={{ backgroundColor: swatch }}
                  >
                    {index + 1}
                  </span>
                </div>

                {/* Info principal */}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-serif text-lg font-semibold tracking-tight leading-none">
                      {tier.name}
                    </h3>
                    {tier.active ? (
                      <Badge variant="success">Activo</Badge>
                    ) : (
                      <Badge variant="outline">Inactivo</Badge>
                    )}
                    <CadenceBadge cadence={tier.benefit_cadence} />
                    {tier.badge_icon ? (
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {tier.badge_icon}
                      </span>
                    ) : null}
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Desde{' '}
                    <span className="font-semibold tabular-nums text-foreground">
                      {tier.min_lifetime_points.toLocaleString('es-AR')}
                    </span>{' '}
                    pts acumulados
                  </p>

                  {tier.benefit_cadence !== 'none' && benefit ? (
                    <p className="text-xs text-muted-foreground">
                      Beneficio {CADENCE_LABEL[tier.benefit_cadence].toLowerCase()}:{' '}
                      <span className="font-medium text-foreground">{benefit}</span>
                    </p>
                  ) : null}

                  {tier.perks ? (
                    <p className="text-xs text-muted-foreground text-pretty">{tier.perks}</p>
                  ) : null}
                </div>

                {/* Acciones */}
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditing(tier)}
                    aria-label={`Editar nivel ${tier.name}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete(tier)}
                    aria-label={`Borrar nivel ${tier.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {/* Form de edición controlado: una sola instancia para todas las filas */}
      <TierForm
        tenantSlug={tenantSlug}
        rewards={rewards}
        tier={editing ?? undefined}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />

      {/* Confirmación de borrado */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar el nivel "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Los clientes que estaban en este nivel pasarán al nivel inferior según sus puntos.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                onConfirmDelete()
              }}
              disabled={pending}
            >
              {pending ? 'Borrando…' : 'Borrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
