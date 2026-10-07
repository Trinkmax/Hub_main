'use client'

import { BookOpen, ChevronDown, KeyRound, LogOut, SunMoon } from 'lucide-react'
import Link from 'next/link'
import { useTransition } from 'react'
import { useTheme } from '@/components/theme/theme-provider'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ThemePreference } from '@/lib/theme/types'
import { signOutAction } from './sign-out-action'

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'auto', label: 'Automático' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
]

function isThemePreference(value: string): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.value === value)
}

/**
 * El menú de la cuenta, arriba a la derecha (§4.5). Se abre muchas veces por
 * día: lo justo y nada más.
 *
 * - El tema vive acá (submenú Automático · Claro · Oscuro): es un ajuste de
 *   pocas veces y así el topbar tiene un ícono menos.
 * - «Cerrar sesión» va sin rojo: no destruye nada, y el rojo queda para lo
 *   que sí (borrar, cancelar una reserva).
 * - El catálogo de componentes no va acá: se llega desde Documentación y ⌘K.
 */
export function UserMenu({
  email,
  roleLabel,
  tenantName,
  docsHref,
}: {
  email: string
  roleLabel: string
  tenantName: string
  /** Solo el dueño tiene Documentación. */
  docsHref?: string
}) {
  const [isPending, startTransition] = useTransition()
  const { preference, setPreference } = useTheme()
  const initial = email.charAt(0).toUpperCase() || '?'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menú de usuario"
          className="press relative flex shrink-0 items-center gap-1 rounded-full p-0.5 pr-1.5 text-muted-foreground outline-(--ring) outline-offset-2 hit-area hover:bg-hover hover:text-foreground focus-visible:outline-2 data-[state=open]:bg-hover data-[state=open]:text-foreground"
        >
          <Avatar size="sm">
            <AvatarFallback className="font-semibold">{initial}</AvatarFallback>
          </Avatar>
          <ChevronDown className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5 pt-2 pb-2">
          <span className="truncate type-label text-foreground">{email}</span>
          <span className="truncate">
            {roleLabel} · {tenantName}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SunMoon aria-hidden="true" />
            Tema
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={preference}
                onValueChange={(value) => {
                  if (isThemePreference(value)) void setPreference(value)
                }}
              >
                {THEME_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuItem asChild>
          <Link href="/auth/update-password">
            <KeyRound aria-hidden="true" />
            Cambiar contraseña
          </Link>
        </DropdownMenuItem>
        {docsHref ? (
          <DropdownMenuItem asChild>
            <Link href={docsHref}>
              <BookOpen aria-hidden="true" />
              Documentación
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            // El menú queda abierto mientras sale: el ítem muestra que está
            // trabajando y no se puede tocar dos veces.
            event.preventDefault()
            startTransition(() => signOutAction())
          }}
          disabled={isPending}
        >
          <LogOut aria-hidden="true" />
          {isPending ? 'Cerrando sesión…' : 'Cerrar sesión'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
