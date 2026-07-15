import { redirect } from 'next/navigation'

// Puntos y recompensas se unificó en /menu (Club → "Puntos y niveles").
export default async function PuntosRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/menu?world=club&tab=programa`)
}
