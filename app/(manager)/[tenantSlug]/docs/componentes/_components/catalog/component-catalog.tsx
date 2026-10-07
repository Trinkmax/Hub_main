'use client'

import { Callout } from '@/components/ui/callout'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { CatalogControls } from './catalog-controls'
import { CatalogIndex } from './catalog-index'
import { CatalogProvider } from './catalog-provider'
import { AccountingFamily } from './family-accounting'
import { ActionsFamily } from './family-actions'
import { DataFamily } from './family-data'
import { FieldsFamily } from './family-fields'
import { FoundationsFamily } from './family-foundations'
import { NavigationFamily } from './family-navigation'
import { OverlaysFamily } from './family-overlays'
import { ShellFamily } from './family-shell'
import { StatusFamily } from './family-status'
import { StructureFamily } from './family-structure'
import { TemplatesFamily } from './family-templates'

/**
 * El catálogo interno del kit HUB (§6): cada componente y cada pieza contable
 * en claro y en oscuro, lado a lado, con sus estados, un fragmento de uso y
 * sus notas de accesibilidad, más la tabla de contraste medida en vivo.
 *
 * Es cliente entero: casi todo bloque es un ejemplo que se toca, y cada uno
 * se monta dos veces (un panel por tema, cada uno con su estado). Sin datos
 * reales ni consultas: todo sale de `sample-data.ts`.
 */
export function ComponentCatalog({
  tenantSlug,
  today,
  eager = false,
}: {
  tenantSlug: string
  today: string
  /** Todos los ejemplos montados de entrada (el test de render del catálogo). */
  eager?: boolean
}) {
  return (
    <CatalogProvider tenantSlug={tenantSlug} today={today} eager={eager}>
      <PageShell width="wide">
        <PageHeader
          title="Componentes"
          back={{ href: `/${tenantSlug}/docs`, label: 'Documentación' }}
          description="El kit HUB en claro y en oscuro, con estados y contrastes medidos en vivo."
          actions={<CatalogControls />}
        />
        <Callout tone="neutral" title="Datos de ejemplo">
          Todo lo que se ve acá es de mentira: nombres genéricos como «Distribuidora del Centro SA»
          o «Factura A 0003-00001234», nunca registros reales. Nada se guarda.
        </Callout>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <CatalogIndex />
          <div className="flex min-w-0 flex-1 flex-col gap-16">
            <FoundationsFamily />
            <ActionsFamily />
            <FieldsFamily />
            <NavigationFamily />
            <StatusFamily />
            <StructureFamily />
            <DataFamily />
            <OverlaysFamily />
            <AccountingFamily />
            <TemplatesFamily />
            <ShellFamily />
          </div>
        </div>
      </PageShell>
    </CatalogProvider>
  )
}
