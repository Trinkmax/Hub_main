'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Section } from '@/components/ui/section'
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
  // Cuál se está guardando: ese muestra el spinner; todos esperan, como antes.
  const [savingKey, setSavingKey] = useState<FeatureKey | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(key: FeatureKey, next: boolean) {
    setFeatures((f) => ({ ...f, [key]: next })) // optimista
    setSavingKey(key)
    startTransition(async () => {
      const res = await setTenantFeature({ tenantId, key, enabled: next })
      if (res.ok) {
        toast.success(next ? 'Panel habilitado' : 'Panel ocultado')
      } else {
        setFeatures((f) => ({ ...f, [key]: !next })) // revertir
        toast.error(res.error)
      }
      setSavingKey(null)
    })
  }

  return (
    <div className="flex flex-col gap-8">
      {(Object.entries(groups) as [FeatureGroup, FeatureDef[]][]).map(([group, defs]) => (
        <Section key={group} title={group} headingLevel={2}>
          <Card padding="none" className="gap-0 divide-y divide-border">
            {defs.map((def) => (
              <Field
                key={def.key}
                layout="toggle"
                label={def.label}
                hint={def.description}
                className="px-4 py-3 sm:px-6"
              >
                <Switch
                  checked={features[def.key]}
                  disabled={pending}
                  pending={pending && savingKey === def.key}
                  onCheckedChange={(v) => toggle(def.key, v)}
                />
              </Field>
            ))}
          </Card>
        </Section>
      ))}
    </div>
  )
}
