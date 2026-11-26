import { redirect } from 'next/navigation'
import { FIRST_PASSWORD_PATH, mustChangePassword } from '@/lib/auth/first-password'
import { safeNext } from '@/lib/auth/pin'
import { pinStatusAction } from '@/lib/auth/pin-actions'
import { createClient } from '@/lib/supabase/server'
import { PinSetup } from './pin-setup'

export const metadata = { title: 'Tu PIN — HUB' }

/** Elegir (o cambiar, o quitar) el PIN de ingreso en ESTE equipo. Ver `lib/auth/pin.ts`. */
export default async function PinPage({
  searchParams,
}: {
  searchParams: Promise<{ primera?: string; next?: string }>
}) {
  const { primera, next } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // Con la contraseña de arranque todavía puesta, primero se elige la propia.
  if (mustChangePassword(user.app_metadata)) redirect(FIRST_PASSWORD_PATH)

  const status = await pinStatusAction()

  return (
    <main className="bg-app-gradient relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-8 sm:py-10">
      <div className="relative w-full max-w-sm">
        <PinSetup
          first={primera === '1'}
          hasPin={status.exists}
          locked={status.locked}
          next={safeNext(next)}
        />
      </div>
    </main>
  )
}
