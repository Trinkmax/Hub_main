'use client'

import * as React from 'react'
import { Label } from '@/components/ui/label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { type CatalogView, useCatalog } from './catalog-provider'

const VIEW_ITEMS = [
  { value: 'both', label: 'Lado a lado' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
] as const satisfies ReadonlyArray<{ value: CatalogView; label: string }>

/**
 * Las acciones del encabezado (§6.2): qué temas se ven («Lado a lado · Claro
 * · Oscuro», se recuerda en este navegador) y la densidad de todo el
 * catálogo. Las dos son de la página: no cambian el tema del panel.
 */
export function CatalogControls() {
  const { view, setView, density, setDensity } = useCatalog()
  const densityId = React.useId()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <SegmentedControl
        aria-label="Temas a la vista"
        items={VIEW_ITEMS}
        value={view}
        onValueChange={setView}
      />
      <div className="flex items-center gap-2">
        <Switch
          id={densityId}
          checked={density === 'compact'}
          onCheckedChange={(checked) => setDensity(checked ? 'compact' : 'comfortable')}
        />
        <Label htmlFor={densityId}>Densidad compacta</Label>
      </div>
    </div>
  )
}
