import { redirect } from 'next/navigation'
import { AuthFrame } from '@/app/(auth)/_components/auth-card'
import { getMembershipsForUser } from '@/lib/tenant'
import { OnboardingForm } from './onboarding-form'

export const metadata = {
  title: 'Crear tu bar',
}

export default async function OnboardingPage() {
  const memberships = await getMembershipsForUser()
  if (memberships.length > 0) {
    redirect(`/${memberships[0]?.tenant.slug}`)
  }

  return (
    <AuthFrame width="md">
      <OnboardingForm />
    </AuthFrame>
  )
}
