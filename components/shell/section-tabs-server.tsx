import 'server-only'

import type { ReactNode } from 'react'
import { requireTenantAccess, TenantNotFoundError, UnauthenticatedError } from '@/lib/tenant'
import { SectionTabsBar } from './section-tabs-bar'
import {
  resolveSection,
  type SectionKey,
  type SectionViewer,
  sectionNeedsViewer,
  sectionViewer,
} from './section-tabs-config'

/**
 * Quién mira, para las pestañas de sección con permiso (Reseñas, Administración). Sale de
 * `requireTenantAccess`, cacheado por request: es la misma resolución que ya hacen el layout del
 * panel y la página, sin un viaje más a la base.
 *
 * Si no hay sesión o no es miembro del bar devuelve `null` (la barra queda sin las pestañas con
 * permiso) y decide la página, que pide lo mismo y lo maneja como siempre: login o 404. El resto
 * de los errores sigue de largo.
 */
export async function loadSectionViewer(tenantSlug: string): Promise<SectionViewer | null> {
  try {
    return sectionViewer(await requireTenantAccess(tenantSlug))
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof TenantNotFoundError) return null
    throw error
  }
}

/**
 * Lo que va en el `layout.tsx` de cada página de una sección: la barra de pestañas arriba y la
 * página abajo. Solo le pregunta a la base quién mira si la sección tiene pestañas con permiso;
 * si no, la barra sale al toque (sin esperar nada).
 */
export async function SectionTabsLayout({
  section,
  tenantSlug,
  children,
}: {
  section: SectionKey
  tenantSlug: string
  children: ReactNode
}) {
  const viewer = sectionNeedsViewer(section) ? await loadSectionViewer(tenantSlug) : null
  return (
    <>
      <SectionTabsBar {...resolveSection(section, tenantSlug, viewer)} />
      {children}
    </>
  )
}
