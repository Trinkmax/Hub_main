import { LoginForm } from './login-form'

export const metadata = { title: 'Ingresar — HUB' }

/**
 * Por qué se volvió al login. Llegan por la URL desde el flujo de mails
 * (`/auth/callback` → `callback`, `/auth/update-password` sin sesión →
 * `expired`): antes se ignoraban y la persona no sabía qué había pasado. Solo
 * se muestran textos fijos; un valor desconocido no muestra nada.
 */
const LOGIN_NOTICES: Readonly<Record<string, string>> = {
  expired:
    'El link venció o ya se usó. Ingresá con tu contraseña o pedí un link nuevo desde «¿Olvidaste tu contraseña?».',
  callback: 'No pudimos validar el link del mail. Probá de nuevo o pedí uno nuevo.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; redirectTo?: string; error?: string }>
}) {
  const { email, redirectTo, error } = await searchParams
  // `hasOwn`: un `?error=constructor` no tiene que leer lo heredado del objeto.
  const notice =
    error && Object.hasOwn(LOGIN_NOTICES, error) ? (LOGIN_NOTICES[error] ?? null) : null
  return <LoginForm initialEmail={email ?? ''} redirectTo={redirectTo ?? ''} notice={notice} />
}
