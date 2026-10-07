import { IvaBookScreen } from '../_components/iva-book'

export const metadata = { title: 'Libro IVA ventas' }

export default async function IvaVentasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  return <IvaBookScreen tenantSlug={tenantSlug} book="sales" sp={await searchParams} />
}
