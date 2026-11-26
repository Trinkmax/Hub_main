import { deviceAccounts, readDevice } from '@/lib/auth/pin-server'
import { LoginForm } from './login-form'
import { PinLogin } from './pin-login'

export const metadata = { title: 'Ingresar — HUB' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; redirectTo?: string; error?: string; clave?: string }>
}) {
  const { email, redirectTo, clave } = await searchParams
  // En un equipo donde alguien ya eligió su PIN, se entra con el PIN (`lib/auth/pin.ts`). Sin la
  // cookie del equipo ni se pregunta a la base: es el ingreso de siempre.
  const accounts = await deviceAccounts(await readDevice())
  if (accounts.length > 0 && clave !== '1') {
    return <PinLogin accounts={accounts} redirectTo={redirectTo ?? ''} />
  }
  return (
    <LoginForm
      initialEmail={email ?? ''}
      redirectTo={redirectTo ?? ''}
      pinAvailable={accounts.length > 0}
    />
  )
}
