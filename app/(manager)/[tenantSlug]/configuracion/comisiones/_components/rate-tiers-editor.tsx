'use client'

import { Plus, Save, Trash2 } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { removeRateTier, upsertRateTier } from '@/lib/salon/actions'
import { type CommissionRateTierRow, MEAL_TYPE_LABELS, type MealType } from '@/lib/salon/types'

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

type Draft = Partial<CommissionRateTierRow> & { _isNew?: boolean }

function toARS(cents: number | undefined): string {
  if (!cents) return ''
  return String(Math.round(cents / 100))
}

export function RateTiersEditor({
  tenantSlug,
  initial,
}: {
  tenantSlug: string
  initial: CommissionRateTierRow[]
}) {
  const [tiers, setTiers] = useState<Draft[]>(initial)
  const [pending, startTransition] = useTransition()

  const byMeal = useMemo(() => {
    const out = new Map<MealType, Draft[]>()
    for (const m of MEAL_TYPES) out.set(m, [])
    for (const t of tiers) {
      if (t.meal_type) out.get(t.meal_type as MealType)?.push(t)
    }
    for (const list of out.values()) {
      list.sort((a, b) => (a.min_guests ?? 0) - (b.min_guests ?? 0))
    }
    return out
  }, [tiers])

  function addTier(meal: MealType) {
    setTiers((prev) => [
      ...prev,
      {
        _isNew: true,
        meal_type: meal,
        min_guests: 1,
        max_guests: null,
        rate_per_guest_cents: 0,
        active: true,
      } as Draft,
    ])
  }

  function patch(t: Draft, key: keyof Draft, value: unknown) {
    setTiers((prev) => prev.map((x) => (x === t ? { ...x, [key]: value } : x)))
  }

  function save(t: Draft) {
    startTransition(async () => {
      const r = await upsertRateTier(tenantSlug, {
        ...(t.id && !t._isNew ? { id: t.id } : {}),
        meal_type: t.meal_type,
        min_guests: t.min_guests,
        max_guests: t.max_guests,
        rate_per_guest_cents: t.rate_per_guest_cents,
        active: t.active ?? true,
      } as Record<string, unknown>)
      if (r.ok) {
        toast.success('Tier guardado.')
        if (t._isNew && r.data?.id) {
          setTiers((prev) =>
            prev.map((x) => (x === t ? { ...x, id: r.data?.id as string, _isNew: false } : x)),
          )
        }
      } else {
        toast.error(r.message)
      }
    })
  }

  function remove(t: Draft) {
    if (!t.id) {
      setTiers((prev) => prev.filter((x) => x !== t))
      return
    }
    if (!confirm('¿Borrar este tier?')) return
    startTransition(async () => {
      const r = await removeRateTier(tenantSlug, t.id ?? '')
      if (r.ok) {
        setTiers((prev) => prev.filter((x) => x !== t))
        toast.success('Tier eliminado.')
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <div className="space-y-6">
      {MEAL_TYPES.map((meal) => (
        <section key={meal} className="rounded-xl border bg-card/60 p-4">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold">{MEAL_TYPE_LABELS[meal]}</h2>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => addTier(meal)}>
              <Plus className="size-4" />
              Tier
            </Button>
          </header>
          <div className="space-y-2">
            {byMeal.get(meal)?.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin tiers configurados.</p>
            ) : null}
            {byMeal.get(meal)?.map((t) => (
              <div
                key={t.id ?? `new-${meal}-${Math.random()}`}
                className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto_auto]"
              >
                <div>
                  <Label className="text-[10px] uppercase tracking-wide">Desde</Label>
                  <Input
                    type="number"
                    min={1}
                    value={t.min_guests ?? 1}
                    onChange={(e) => patch(t, 'min_guests', Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wide">Hasta</Label>
                  <Input
                    type="number"
                    min={1}
                    value={t.max_guests ?? ''}
                    placeholder="∞"
                    onChange={(e) =>
                      patch(t, 'max_guests', e.target.value ? Number(e.target.value) : null)
                    }
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wide">$ por persona</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step={10}
                      value={toARS(t.rate_per_guest_cents)}
                      onChange={(e) =>
                        patch(t, 'rate_per_guest_cents', Math.max(0, Number(e.target.value) * 100))
                      }
                      className="pl-7 tabular-nums"
                    />
                  </div>
                </div>
                <Switch
                  checked={t.active ?? true}
                  onCheckedChange={(v) => patch(t, 'active', v)}
                  aria-label="Activo"
                />
                <Button size="sm" variant="ghost" onClick={() => save(t)} disabled={pending}>
                  <Save className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(t)} disabled={pending}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
