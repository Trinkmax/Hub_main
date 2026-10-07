'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { setTenantFeature } from '@/lib/platform/actions'
import type { FeatureDef, FeatureGroup, FeatureKey, TenantFeatures } from '@/lib/platform/features'

export function FeatureToggleGrid({
  tenantId,
  initialFeatures,
  groups,
}: {
  tenantId: string
  initialFeatures: TenantFeatures
  groups: Record<FeatureGroup, FeatureDef[]>
}) {
  const [features, setFeatures] = useState<TenantFeatures>(initialFeatures)
  const [pending, startTransition] = useTransition()

  function toggle(key: FeatureKey, next: boolean) {
    setFeatures((f) => ({ ...f, [key]: next })) // optimista
    startTransition(async () => {
      const res = await setTenantFeature({ tenantId, key, enabled: next })
      if (res.ok) {
        toast.success(next ? 'Panel habilitado' : 'Panel ocultado')
      } else {
        setFeatures((f) => ({ ...f, [key]: !next })) // revertir
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="space-y-6">
      {(Object.entries(groups) as [FeatureGroup, FeatureDef[]][]).map(([group, defs]) => (
        <div key={group} className="space-y-2">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {group}
          </h2>
          <Card className="divide-y divide-border/50 border-border/70 p-0">
            {defs.map((def) => (
              <div key={def.key} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-medium">{def.label}</p>
                  <p className="text-sm text-muted-foreground">{def.description}</p>
                </div>
                <Switch
                  checked={features[def.key]}
                  disabled={pending}
                  onCheckedChange={(v) => toggle(def.key, v)}
                  aria-label={def.label}
                />
              </div>
            ))}
          </Card>
        </div>
      ))}
    </div>
  )
}
