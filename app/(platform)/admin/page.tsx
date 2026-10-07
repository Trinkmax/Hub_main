import { Building2 } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
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
    <>
      <PageHeader title="Bares" description="Elegí un bar para decidir qué paneles ve cada uno." />

      <DataTable
        caption="Bares de la plataforma"
        rows={tenants}
        getRowId={(t) => t.id}
        rowHref={(t) => `/admin/${t.id}`}
        rowLabel={(t) => t.name}
        empty={
          <EmptyState
            size="sm"
            icon={Building2}
            title="Todavía no hay bares"
            description="Cuando un dueño cree su bar, aparece acá para configurar sus paneles."
          />
        }
        columns={[
          {
            id: 'bar',
            header: 'Bar',
            cell: (t) => (
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{t.name}</span>
                <span className="truncate font-mono type-caption font-normal text-muted-foreground">
                  /{t.slug}
                </span>
              </span>
            ),
          },
          {
            id: 'paneles',
            header: 'Paneles prendidos',
            numeric: true,
            cell: (t) => {
              const features = getTenantFeatures(t)
              const on = FEATURE_KEYS.filter((k) => features[k]).length
              return `${on} de ${FEATURE_KEYS.length}`
            },
          },
        ]}
      />
    </>
  )
}
