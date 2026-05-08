import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'
import { NewCustomerForm } from './new-customer-form'

export const metadata = { title: 'Nuevo cliente' }

export default async function NuevoClientePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  try {
    await requireTenantAccess(tenantSlug)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/${tenantSlug}/clientes`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Volver a clientes
      </Link>
      <PageHeader
        eyebrow="Clientes"
        title="Nuevo cliente"
        description="Cargá los datos básicos. Vamos a normalizar el teléfono automáticamente."
      />
      <div className="card-hairline rounded-xl border bg-card p-6">
        <NewCustomerForm tenantSlug={tenantSlug} />
      </div>
    </div>
  )
}
