import { Sparkles } from 'lucide-react'
import { notFound } from 'next/navigation'
import { BrandMark, BrandWordmark } from '@/components/shell/brand-mark'
import { createClient } from '@/lib/supabase/server'
import { CaptureForm } from './capture-form'

export const metadata = { title: 'Cargá tus datos' }

export default async function CapturePage({ params }: { params: Promise<{ linkSlug: string }> }) {
  const { linkSlug } = await params

  const supabase = await createClient()
  const { data: link } = await supabase
    .from('customer_capture_links')
    .select('id, slug, label, tenant_id')
    .eq('slug', linkSlug)
    .eq('active', true)
    .maybeSingle()

  if (!link) notFound()

  const { createServiceClient } = await import('@/lib/supabase/service')
  const service = createServiceClient()
  const { data: tenant } = await service
    .from('tenants')
    .select('name')
    .eq('id', link.tenant_id)
    .maybeSingle()

  const tenantName = tenant?.name ?? 'el bar'

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-10" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Bienvenido
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-balance">
              {tenantName}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
              Cargá tus datos en 30 segundos y empezá a sumar puntos en tu próxima visita.
            </p>
          </div>
        </div>

        <div className="card-hairline relative overflow-hidden rounded-2xl border bg-card/90 p-6 shadow-xl backdrop-blur-xl">
          <CaptureForm linkSlug={link.slug} tenantName={tenantName} />
        </div>

        <div className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Sparkles className="size-3 text-primary" />
          <span>
            Tus datos quedan solo con <strong className="text-foreground">{tenantName}</strong>. No
            los compartimos.
          </span>
        </div>

        <p className="text-center text-[10px] text-muted-foreground/70">
          Powered by <BrandWordmark className="text-[10px]" />
        </p>
      </div>
    </main>
  )
}
