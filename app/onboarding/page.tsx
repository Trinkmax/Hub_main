import { redirect } from 'next/navigation'
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
    <main className="bg-app-gradient relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-[480px] w-[680px] rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative w-full max-w-md">
        <OnboardingForm />
      </div>
    </main>
  )
}
