import { redirect } from 'next/navigation'

// Punch cards se unificó en /menu (Club → "Punch cards").
export default async function PunchCardsRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/menu?world=club&tab=punch`)
}
