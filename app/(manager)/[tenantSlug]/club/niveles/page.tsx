import { redirect } from 'next/navigation'

// Niveles se unificó en /menu (Club → "Puntos y niveles", sección Niveles).
export default async function NivelesRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/menu?world=club&tab=programa`)
}
