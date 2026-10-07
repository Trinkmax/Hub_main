import { redirect } from 'next/navigation'
import { AuthFrame } from '@/app/(auth)/_components/auth-card'
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
    <AuthFrame>
      <UpdatePasswordForm email={user.email ?? ''} requiresReauth={!fromRecovery} />
    </AuthFrame>
  )
}
