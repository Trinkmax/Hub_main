'use client'

import { Eye, KeyRound, Loader2, LogOut } from 'lucide-react'
import Link from 'next/link'
import { useTransition } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ROLE_LABELS } from '@/lib/tenant/roles'
import { isTenantRole } from '@/lib/tenant/types'
import { VIEW_AS_CHOICES } from '@/lib/tenant/view-as'
import { signOutAction } from './sign-out-action'
import { useSwitchViewAs, useViewAs, ViewAsDot } from './view-as'

export function UserMenu({ email, role }: { email: string; role: string }) {
  const [isPending, startTransition] = useTransition()
  const viewAs = useViewAs()
  const { pending: switching, switchTo } = useSwitchViewAs(viewAs?.slug ?? '')
  const current = viewAs?.viewAs ?? 'owner'

  const initial = email.charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 rounded-full pr-3 pl-1.5"
          aria-label="Menú de usuario"
        >
          <span className="relative">
            <Avatar className="size-7">
              <AvatarFallback className="bg-secondary text-xs font-semibold">
                {switching ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : initial}
              </AvatarFallback>
            </Avatar>
            <ViewAsDot />
          </span>
          <span className="hidden text-sm font-medium sm:inline-block">{email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-0.5">
            <span className="truncate text-sm font-medium">{email}</span>
            <span className="text-xs capitalize text-muted-foreground">{role}</span>
          </div>
        </DropdownMenuLabel>
        {viewAs ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Eye className="size-3.5" aria-hidden />
              Ver el panel como
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={current}
              onValueChange={(value) => {
                if (isTenantRole(value) && value !== current) switchTo(value)
              }}
            >
              {VIEW_AS_CHOICES.map((choice) => (
                <DropdownMenuRadioItem
                  key={choice.role}
                  value={choice.role}
                  disabled={switching}
                  className="justify-between gap-3"
                >
                  <span>{choice.role === 'owner' ? 'Dueño (vos)' : ROLE_LABELS[choice.role]}</span>
                  <span className="text-xs text-muted-foreground">{choice.lands}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/auth/update-password">
            <KeyRound className="size-4" />
            Cambiar contraseña
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            startTransition(() => signOutAction())
          }}
          disabled={isPending}
          className="gap-2 text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
