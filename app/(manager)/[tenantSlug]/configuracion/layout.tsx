import type { ReactNode } from 'react'
import { PageShell } from '@/components/ui/page-shell'
import { SettingsNav } from './_components/settings-nav'

/**
 * Configuración: el contenedor de la página (`PageShell`) y la subnavegación
 * de la sección viven acá, así persisten al pasar de una subpágina a otra.
 * Cada página aporta su `PageHeader` y sus secciones a la columna de
 * contenido, que ya trae los 32 px entre bloques.
 *
 * Desde `lg`, la subnavegación es una columna fija al costado (debajo del
 * topbar, con el mismo aire que el `PageShell`); en el celular, una fila de
 * pestañas arriba del contenido.
 */
export default async function ConfiguracionLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  return (
    <PageShell className="gap-6 lg:flex-row lg:items-start lg:gap-8">
      <SettingsNav
        tenantSlug={tenantSlug}
        className="lg:sticky lg:top-[calc(var(--topbar-h)+2rem)]"
      />
      <div data-slot="settings-content" className="flex min-w-0 flex-1 flex-col gap-8">
        {children}
      </div>
    </PageShell>
  )
}
