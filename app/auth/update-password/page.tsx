import { redirect } from 'next/navigation'
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

  return (
    <main className="bg-app-gradient relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-[480px] w-[680px] rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <UpdatePasswordForm email={user.email ?? ''} requiresReauth={!fromRecovery} />
      </div>
    </main>
  )
}
