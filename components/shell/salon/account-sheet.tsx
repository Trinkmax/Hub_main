'use client'

import { LayoutDashboard, LogOut } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { ROLE_LABELS } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { useViewAs, ViewAsDot, ViewAsSheetSection } from '../view-as'

/**
 * La cuenta del staff, colgada del topbar del salón.
 *
 * Existe porque hasta acá el mozo de HUB **no tenía forma de cerrar sesión**: el
 * único botón vivía en `/salon/mi-turno`, que está detrás del feature flag
 * `table_service` — apagado en HUB — así que la página devolvía notFound y con
 * ella se iba el logout. Un celular compartido entre turnos quedaba logueado con
 * la cuenta del anterior.
 *
 * Va en el topbar y no en una tab: no es una tarea de la operativa, es chrome.
 */
export function AccountSheet({
  email,
  role,
  tenantName,
  tenantSlug,
  signOut,
}: {
  email: string
  role: TenantRole
  tenantName: string
  tenantSlug: string
  /** Server action de logout, inyectada por el shell (server component). */
  signOut: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const viewAs = useViewAs()
  const initial = (email.charAt(0) || '?').toUpperCase()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Tu cuenta"
          className="relative grid size-9 shrink-0 place-items-center rounded-full bg-primary/12 font-serif text-sm font-semibold text-primary transition-transform active:scale-95"
        >
          {initial}
          <ViewAsDot />
        </button>
      </SheetTrigger>

      <SheetContent side="bottom" className="gap-0">
        <SheetHeader className="text-left">
          <SheetTitle className="truncate">{email || 'Tu cuenta'}</SheetTitle>
          <SheetDescription>
            {ROLE_LABELS[role] ?? role} · {tenantName}
          </SheetDescription>
        </SheetHeader>

        {/* «Ver como»: solo para un superadmin que es dueño del bar (lib/tenant/view-as.ts). */}
        {viewAs ? <ViewAsSheetSection onSettled={close} /> : null}

        <div className="space-y-2 px-4 pb-4">
          {role === 'owner' ? (
            <Button asChild variant="outline" size="xl" className="w-full justify-start gap-3">
              <Link href={`/${tenantSlug}`} prefetch={false}>
                <LayoutDashboard className="size-5" aria-hidden />
                Volver al dashboard
              </Link>
            </Button>
          ) : null}

          <form action={signOut}>
            <Button
              type="submit"
              variant="outline"
              size="xl"
              className="w-full justify-start gap-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="size-5" aria-hidden />
              Cerrar sesión
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  )
}
