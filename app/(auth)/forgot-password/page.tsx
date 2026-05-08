import { ForgotPasswordForm } from './forgot-password-form'

export const metadata = { title: 'Recuperar contraseña — HUB' }

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email } = await searchParams
  return <ForgotPasswordForm initialEmail={email ?? ''} />
}
