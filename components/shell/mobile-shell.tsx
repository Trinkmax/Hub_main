'use client'

import { Menu, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import type { TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess, Tenant, TenantRole } from '@/lib/tenant/types'
import { NO_ACCOUNTING_ACCESS } from './accounting-gates'
import { MAIN_CONTENT_ID } from './shell-ids'
import { SidebarContent } from './sidebar-content'

/**
 * El menú en el celular (menos de `lg`): una hoja desde la izquierda con el
 * mismo `SidebarContent` que el escritorio, filas de 44 px y la fila de marca
 * con su «Cerrar». Entra en 220 ms con la curva de las hojas (la del kit).
 *
 * El foco al cerrar depende de cómo se cerró:
 * - **Navegando:** va al `<main id="contenido">`, así el lector de pantalla
 *   arranca en la página nueva y no en el botón del menú.
 * - **Sin navegar** (Esc, el velo o «Cerrar»): vuelve al botón (lo de Radix).
 */
export function MobileShell({
  tenant,
  role,
  features,
  isPlatformAdmin,
  accounting = NO_ACCOUNTING_ACCESS,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'logo_url'>
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  accounting?: AccountingAccess
}) {
  const [open, setOpen] = useState(false)
  // Ref y no estado: lo lee el cierre de la hoja, no cambia lo que se ve.
  const navigatedRef = useRef(false)

  const handleOpenChange = useCallback((next: boolean) => {
    if (next) navigatedRef.current = false
    setOpen(next)
  }, [])

  const handleNavigate = useCallback(() => {
    navigatedRef.current = true
    setOpen(false)
  }, [])

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Abrir menú">
          <Menu strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-[min(320px,85vw)] gap-0 bg-surface text-surface-foreground"
        onCloseAutoFocus={(event) => {
          if (!navigatedRef.current) return
          navigatedRef.current = false
          event.preventDefault()
          document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true })
        }}
      >
        <SheetTitle className="sr-only">Menú</SheetTitle>
        <SidebarContent
          tenant={tenant}
          role={role}
          features={features}
          isPlatformAdmin={isPlatformAdmin}
          accounting={accounting}
          onNavigate={handleNavigate}
          touch
          brandAction={
            <SheetClose asChild>
              <Button variant="ghost" size="icon" aria-label="Cerrar">
                <X strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </SheetClose>
          }
        />
      </SheetContent>
    </Sheet>
  )
}
