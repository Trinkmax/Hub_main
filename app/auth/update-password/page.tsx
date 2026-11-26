import { redirect } from 'next/navigation'
import { canSkipCurrentPassword, mustChangePassword } from '@/lib/auth/first-password'
import { passwordAlreadyChosen } from '@/lib/auth/first-password-server'
import { isInRecoveryFlow } from '@/lib/auth/recovery-cookie'
import { createClient } from '@/lib/supabase/server'
import { UpdatePasswordForm } from './update-password-form'

export const metadata = { title: 'Cambiar contraseña — HUB' }

export default async function UpdatePasswordPage() {
  // Aceptamos sesión efímera de recovery o sesión normal.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login?error=expired')
  }

  const fromRecovery = await isInRecoveryFlow()
  // La primera vez: le pusieron una contraseña para arrancar y tiene que elegir la suya.
  const firstTime = mustChangePassword(user.app_metadata)
  const { data: claimsData } = await supabase.auth.getClaims()
  const justTypedIt = firstTime && canSkipCurrentPassword(user.app_metadata, claimsData?.claims)
  const pendingFinish = firstTime && (await passwordAlreadyChosen(user.id))

  return (
    // `min-h-dvh`: en un celular «100vh» mide más que lo que se ve. El manchón de fondo va solo en
    // pantallas grandes: en un teléfono modesto es lo más caro de dibujar de toda la pantalla.
    <main className="bg-app-gradient relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 mx-auto hidden h-[480px] w-[680px] rounded-full bg-primary/15 blur-3xl sm:block"
      />
      <div className="relative w-full max-w-sm">
        <UpdatePasswordForm
          email={user.email ?? ''}
          requiresReauth={!fromRecovery && !justTypedIt}
          firstTime={firstTime}
          pendingFinish={pendingFinish}
        />
      </div>
    </main>
  )
}
