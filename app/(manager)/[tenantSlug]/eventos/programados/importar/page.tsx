import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { todayInCordoba } from '@/lib/salon/date-presets'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TEMPLATE_EDIT_ROLES,
  TenantNotFoundError,
} from '@/lib/tenant'
import { CalendarImport } from './_components/calendar-import'

export const metadata = { title: 'Cargar fechas con Excel' }
export const dynamic = 'force-dynamic'

// biome-ignore lint/suspicious/noExplicitAny: tablas sin tipos generados (como lib/salon/queries)
type SBAny = any

/**
 * Cargar las fechas del mes con un Excel (pedido de Nacho Badra, 30/10/2026).
 * Owner y anfitrión, los que arman la agenda. La página solo trae los nombres
 * que se reconocen (para la ayuda y la plantilla); leer, comparar y guardar lo
 * hacen las acciones de `lib/salon/calendar-import-actions`.
 */
export default async function ImportarFechasPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, TEMPLATE_EDIT_ROLES)
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const supabase = (await createClient()) as SBAny
  const [{ data: templates }, { data: films }] = await Promise.all([
    supabase
      .from('scheduled_event_templates')
      .select('id, name')
      .eq('tenant_id', access.tenant.id)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('event_experiences')
      .select('template_id, title')
      .eq('tenant_id', access.tenant.id),
  ])
  const titleOf = new Map(
    ((films as Array<{ template_id: string; title: string }> | null) ?? []).map((f) => [
      f.template_id,
      f.title,
    ]),
  )
  // Las películas de Entradas primero (es para lo que más se usa), con su
  // nombre en el calendario si es otro.
  const names = ((templates as Array<{ id: string; name: string }> | null) ?? [])
    .map((t) => {
      const title = titleOf.get(t.id)
      return {
        label: title ?? t.name,
        calendarName: title && title.trim() !== t.name.trim() ? t.name : null,
        film: Boolean(title),
      }
    })
    .sort((a, b) => Number(b.film) - Number(a.film) || a.label.localeCompare(b.label, 'es'))

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/eventos/programados`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Volver al calendario
          </Link>
        }
        title="Cargar fechas con Excel"
        description="Subí el Excel con las fechas del mes: antes de guardar te mostramos qué se agrega, qué cambia y qué se quita."
      />
      <CalendarImport
        tenantSlug={tenantSlug}
        names={names.map(({ label, calendarName }) => ({ label, calendarName }))}
        today={todayInCordoba()}
      />
    </div>
  )
}
