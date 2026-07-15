import { redirect } from 'next/navigation'

// El Club se unificó en el editor de /menu (mundo "Club"). Esta ruta redirige
// para no dejar un editor duplicado ni links muertos. Ver menu-hub.tsx.
export default async function ClubRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/menu?world=club&tab=programa`)
}
