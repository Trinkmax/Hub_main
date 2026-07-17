import { MessageSquareText, Plug } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import type { TemplateStatus } from '@/types/database'
import { CreateTemplateDialog } from './_create-template-dialog'
import { DeleteTemplateButton } from './_delete-template-button'
import { TemplateSyncButton } from './_sync-button'

export const metadata = { title: 'Plantillas' }
export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<TemplateStatus, string> = {
  draft: 'Borrador',
  pending: 'Esperando aprobación',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  disabled: 'Deshabilitada',
}

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidad',
  AUTHENTICATION: 'Autenticación',
}

const LANGUAGE_LABEL: Record<string, string> = {
  es_AR: 'Español',
  es: 'Español',
  en_US: 'Inglés',
  en: 'Inglés',
}

function statusVariant(s: TemplateStatus): 'default' | 'outline' | 'destructive' | 'secondary' {
  if (s === 'approved') return 'default'
  if (s === 'rejected' || s === 'disabled') return 'destructive'
  if (s === 'pending') return 'secondary'
  return 'outline'
}

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const supabase = await createClient()
  const { data: channel } = await supabase
    .from('channels')
    .select('id, status')
    .eq('tenant_id', access.tenant.id)
    .eq('type', 'whatsapp')
    .maybeSingle()

  const { data: templatesRaw } = await supabase
    .from('message_templates')
    .select('id, name, language, category, status, last_synced_at')
    .eq('tenant_id', access.tenant.id)
    .order('name', { ascending: true })

  const templates = (templatesRaw ?? []) as Array<{
    id: string
    name: string
    language: string
    category: string
    status: TemplateStatus
    last_synced_at: string | null
  }>

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuración"
        title="Plantillas de WhatsApp"
        description="Mensajes que WhatsApp aprueba una vez y después reusás en tus difusiones o para escribirle primero a un cliente. Creá una nueva o traé las que ya tengas aprobadas."
        actions={
          channel ? (
            <div className="flex flex-wrap items-center gap-2">
              <TemplateSyncButton channelId={channel.id} tenantSlug={tenantSlug} />
              <CreateTemplateDialog tenantSlug={tenantSlug} channelId={channel.id} />
            </div>
          ) : null
        }
      />

      {!channel ? (
        <EmptyState
          icon={Plug}
          title="Conectá WhatsApp primero"
          description="Primero conectá tu número de WhatsApp en Canales. Después vas a poder crear y usar plantillas."
          action={
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/mensajeria/canales`}>
                <Plug className="size-4" />
                Ir a Canales
              </Link>
            </Button>
          }
        />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title="Todavía no tenés plantillas"
          description="Tocá «Nueva plantilla» para crear una, o «Sincronizar» para traer las que ya tengas aprobadas en WhatsApp."
        />
      ) : (
        <DataTableShell>
          <DataTableScroll>
            <DataTableRoot>
              <DataTableHead>
                <tr>
                  <DataTableHeader>Nombre</DataTableHeader>
                  <DataTableHeader>Idioma</DataTableHeader>
                  <DataTableHeader>Categoría</DataTableHeader>
                  <DataTableHeader>Estado</DataTableHeader>
                  <DataTableHeader>Actualizada</DataTableHeader>
                  <DataTableHeader>
                    <span className="sr-only">Acciones</span>
                  </DataTableHeader>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {templates.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-secondary/40">
                    <DataTableCell className="font-medium font-mono text-xs">
                      {t.name}
                    </DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {LANGUAGE_LABEL[t.language] ?? t.language}
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {CATEGORY_LABEL[t.category.toUpperCase()] ?? t.category}
                    </DataTableCell>
                    <DataTableCell>
                      <Badge variant={statusVariant(t.status)}>{STATUS_LABEL[t.status]}</Badge>
                    </DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {t.last_synced_at ? new Date(t.last_synced_at).toLocaleString('es-AR') : '—'}
                    </DataTableCell>
                    <DataTableCell>
                      <DeleteTemplateButton
                        tenantSlug={tenantSlug}
                        channelId={channel.id}
                        templateName={t.name}
                      />
                    </DataTableCell>
                  </tr>
                ))}
              </DataTableBody>
            </DataTableRoot>
          </DataTableScroll>
        </DataTableShell>
      )}
    </div>
  )
}
