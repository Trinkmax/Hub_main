import { redirect } from 'next/navigation'

export default async function MensajeriaIndex({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/mensajeria/inbox`)
}
