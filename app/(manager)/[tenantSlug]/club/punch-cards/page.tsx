import { redirect } from 'next/navigation'

// Link viejo: las punch cards viven en /club, pestaña «Punch cards».
export default async function PunchCardsRedirect({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/club?tab=punch`)
}
