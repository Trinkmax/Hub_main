'use client'

import { ChevronRight, KeyRound, Loader2, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import Link from 'next/link'
import { useTransition } from 'react'
import { useTheme } from '@/components/theme/theme-provider'
import type { ThemePreference } from '@/lib/theme/types'
import { cn } from '@/lib/utils'
import { signOutAction } from '../sign-out-action'
import { useViewAs, ViewAsDot, ViewAsSheetSection } from '../view-as'

/** La inicial del mail, en el círculo del avatar. */
export function initialOf(email: string): string {
  return (email.trim().charAt(0) || '?').toUpperCase()
}

/** El avatar redondo con la inicial (y el punto de «Ver como» si se está mirando otro rol). */
export function AccountAvatar({ email, className }: { email: string; className?: string }) {
  return (
    <span className={cn('app-avatar', className)}>
      {initialOf(email)}
      <ViewAsDot />
    </span>
  )
}

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'auto', label: 'Automático', icon: Monitor },
]

/** Claro, oscuro o el del teléfono: un control segmentado de vidrio, como los de iOS. */
function ThemeSegmented() {
  const { preference, setPreference } = useTheme()
  const index = Math.max(
    THEMES.findIndex((theme) => theme.value === preference),
    0,
  )
  return (
    <div
      role="radiogroup"
      aria-label="Apariencia"
      className="app-segmented"
      style={{ '--seg-i': index, '--seg-n': THEMES.length } as React.CSSProperties}
    >
      <span aria-hidden className="app-segmented-thumb" />
      {THEMES.map(({ value, label, icon: Icon }) => (
        // biome-ignore lint/a11y/useSemanticElements: un control segmentado (role=radio) se dibuja con botones; un <input type="radio"> no se puede estilar así
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          className="app-segmented-option"
          onClick={() => {
            void setPreference(value)
          }}
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * Tu cuenta, en el celular: quién sos, la apariencia, «Ver como» (si te toca), la contraseña y salir. Una
 * lista agrupada como los Ajustes del iPhone. La usan la hoja del avatar y el pie de «Más».
 */
export function AccountPanel({
  email,
  roleLabel,
  tenantName,
  onDone,
}: {
  email: string
  roleLabel: string
  tenantName: string
  /** Cierra la hoja (después de cambiar de rol con «Ver como»). */
  onDone?: () => void
}) {
  const viewAs = useViewAs()
  const [signingOut, startSignOut] = useTransition()

  return (
    <div className="app-account">
      <div className="app-group app-account-head">
        <AccountAvatar email={email} className="app-avatar-lg" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{email || 'Tu cuenta'}</p>
          <p className="truncate text-[13px] text-muted-foreground">
            {roleLabel} · {tenantName}
          </p>
        </div>
      </div>

      <p className="app-group-label">Apariencia</p>
      <ThemeSegmented />

      {viewAs ? (
        <div className="app-group app-group-flush">
          <div className="pt-3">
            <ViewAsSheetSection onSettled={onDone} />
          </div>
        </div>
      ) : null}

      <div className="app-group app-group-list">
        <Link href="/auth/update-password" className="app-row" onClick={onDone}>
          <span className="app-row-icon" data-tone="slate">
            <KeyRound aria-hidden />
          </span>
          <span className="flex-1">Cambiar contraseña</span>
          <ChevronRight aria-hidden className="app-row-chevron" />
        </Link>
        <button
          type="button"
          className="app-row app-row-danger"
          disabled={signingOut}
          onClick={() => startSignOut(() => signOutAction())}
        >
          <span className="app-row-icon" data-tone="terracotta">
            {signingOut ? <Loader2 aria-hidden className="animate-spin" /> : <LogOut aria-hidden />}
          </span>
          <span className="flex-1 text-left">Cerrar sesión</span>
        </button>
      </div>
    </div>
  )
}
