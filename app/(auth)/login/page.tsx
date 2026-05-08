import { LoginForm } from './login-form'

export const metadata = { title: 'Ingresar — HUB' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; redirectTo?: string; error?: string }>
}) {
  const { email, redirectTo } = await searchParams
  return <LoginForm initialEmail={email ?? ''} redirectTo={redirectTo ?? ''} />
}
