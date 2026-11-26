'use client'

import { ChevronRight, KeyRound, LayoutDashboard, LogOut } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { NoticeSettings } from '@/components/pos/notices/notice-settings'
import { disableNotices } from '@/components/pos/notices/notice-setup'
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
 * Es el único lugar del salón para cerrar sesión: un celular compartido entre
 * turnos no puede quedar con la cuenta del anterior.
 *
 * Va en el topbar y no en una tab: no es una tarea de la operativa, es chrome.
 *
 * Con el punto de venta, acá también se prenden los avisos de cocina de este equipo (`posNotices`). Y
 * al cerrar sesión el equipo deja de recibirlos: el teléfono pasa al del turno siguiente.
 */
export function AccountSheet({
  email,
  role,
  tenantName,
  tenantSlug,
  signOut,
  posNotices = false,
}: {
  email: string
  role: TenantRole
  tenantName: string
  tenantSlug: string
  /** Server action de logout, inyectada por el shell (server component). */
  signOut: () => Promise<void>
  /** Muestra «Avisos de cocina»: el bar usa el punto de venta y esta persona atiende mesas. */
  posNotices?: boolean
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

        {posNotices ? <NoticeSettings slug={tenantSlug} /> : null}

        {/* El PIN para entrar más rápido en este equipo (`lib/auth/pin.ts`). */}
        <div className="border-t border-border/60 px-4 py-3">
          <Link
            href={`/auth/pin?next=${encodeURIComponent(`/${tenantSlug}/salon`)}`}
            className="flex min-h-12 items-center gap-3 rounded-xl px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <KeyRound className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-sm">PIN de este equipo</span>
              <span className="block text-muted-foreground text-xs">
                Cuatro números para entrar sin la contraseña.
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </div>

        <div className="space-y-2 px-4 pb-4">
          {role === 'owner' ? (
            <Button asChild variant="outline" size="xl" className="w-full justify-start gap-3">
              <Link href={`/${tenantSlug}`} prefetch={false}>
                <LayoutDashboard className="size-5" aria-hidden />
                Volver al dashboard
              </Link>
            </Button>
          ) : null}

          <form
            action={async () => {
              // Este equipo deja de recibir los avisos de quien se va. Si no hay señal, no traba la
              // salida: la base lo da de baja sola cuando el próximo envío rebote.
              if (posNotices) {
                await Promise.race([
                  disableNotices(tenantSlug).catch(() => {}),
                  new Promise((done) => setTimeout(done, 2500)),
                ])
              }
              await signOut()
            }}
          >
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
