import { Building2, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { FEATURE_KEYS, getTenantFeatures } from '@/lib/platform/features'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type TenantRow = { id: string; name: string; slug: string; feature_flags: Record<string, boolean> }

export default async function PlatformAdminHome() {
  // El admin pasa la policy tenants_select_platform_admin → ve todos los bares.
  const supabase = await createClient()
  const { data } = await supabase
    .from('tenants')
    .select('id, name, slug, feature_flags')
    .order('name', { ascending: true })
  const tenants = (data ?? []) as TenantRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Bares</h1>
        <p className="text-sm text-muted-foreground">
          Elegí un bar para decidir qué paneles ve cada uno.
        </p>
      </div>

      {tenants.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No hay bares todavía.</Card>
      ) : (
        <div className="grid gap-3">
          {tenants.map((t) => {
            const features = getTenantFeatures(t)
            const on = FEATURE_KEYS.filter((k) => features[k]).length
            return (
              <Link key={t.id} href={`/admin/${t.id}`} className="group">
                <Card className="flex items-center justify-between gap-4 border-border/70 p-4 transition-colors group-hover:border-primary/40 group-hover:bg-card">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-[--cream-tint] text-primary">
                      <Building2 className="size-5" aria-hidden />
                    </div>
                    <div>
                      <p className="font-medium">{t.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">/{t.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="tabular-nums">
                      {on}/{FEATURE_KEYS.length} paneles ON
                    </span>
                    <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
