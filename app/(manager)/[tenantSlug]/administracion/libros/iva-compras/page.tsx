import { IvaBookScreen } from '../_components/iva-book'

export const metadata = { title: 'Libro IVA compras' }

export default async function IvaComprasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  return <IvaBookScreen tenantSlug={tenantSlug} book="purchases" sp={await searchParams} />
}
