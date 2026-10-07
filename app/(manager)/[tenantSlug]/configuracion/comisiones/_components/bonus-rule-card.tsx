'use client'

import { Sparkles } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { upsertBonusRule } from '@/lib/salon/actions'
import type { CommissionBonusRuleRow } from '@/lib/salon/types'

export function BonusRuleCard({
  tenantSlug,
  initial,
}: {
  tenantSlug: string
  initial: CommissionBonusRuleRow | null
}) {
  const [bonus, setBonus] = useState(initial?.bonus_per_guest_cents ?? 20000)
  const [active, setActive] = useState(initial?.active ?? true)
  const [pending, startTransition] = useTransition()

  function save() {
    startTransition(async () => {
      const r = await upsertBonusRule(tenantSlug, {
        scope: 'scheduled_event_full',
        bonus_per_guest_cents: bonus,
        active,
      } as Record<string, unknown>)
      if (r.ok) toast.success('Bonus guardado.')
      else toast.error(r.message)
    })
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card/60 p-5">
      <header className="flex items-center gap-2">
        <Sparkles className="size-5 text-amber-500" />
        <div>
          <h2 className="font-serif text-base font-semibold">Bonus por evento lleno</h2>
          <p className="text-xs text-muted-foreground">
            Cuando un evento programado llega al 100% del cupo, cada gestor cobra este extra por
            persona reservada.
          </p>
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-[180px_auto_1fr]">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide">$ por persona</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <Input
              type="number"
              min={0}
              step={10}
              value={Math.round(bonus / 100)}
              onChange={(e) => setBonus(Math.max(0, Number(e.target.value) * 100))}
              className="pl-7 tabular-nums"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 self-end pb-2">
          <Switch id="bonus-active" checked={active} onCheckedChange={setActive} />
          <label htmlFor="bonus-active" className="text-sm cursor-pointer">
            Activo
          </label>
        </div>
        <div className="flex items-end justify-end">
          <Button onClick={save} disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
