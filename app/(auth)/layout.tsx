import { AuthFrame } from './_components/auth-card'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>
}
