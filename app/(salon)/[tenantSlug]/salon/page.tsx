import { redirect } from 'next/navigation'

export default async function SalonRootPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/salon/mesas`)
}
