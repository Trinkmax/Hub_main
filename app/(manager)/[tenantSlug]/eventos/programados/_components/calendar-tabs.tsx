'use client'

import { CalendarPlus, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { MonthCapacity } from '@/lib/salon/month-capacity'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import type { ScheduledEventTemplateRow } from '@/lib/salon/types'
import { TEMPLATE_EDIT_ROLES } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { TemplatesEditor } from '../../templates/_components/templates-editor'
import { ScheduledEventsMonth } from './scheduled-events-month'

type Tab = 'calendario' | 'eventos'

/**
 * El calendario mensual del bar: programás cada evento a partir de un formato
 * reutilizable (Sushi Libre, Pizza Libre…) arrastrándolo a su fecha. La pestaña
 * "Formatos" (ex-Templates) es el catálogo de esos formatos.
 *
 * El EDITOR de formatos (pestaña "Formatos") lo ven owner y anfitrión
 * (`TEMPLATE_EDIT_ROLES`) — el mismo conjunto que enforcean la action
 * `upsertScheduledTemplate` y las policies RLS. Al cajero se le sigue ocultando:
 * mostrárselo era prometer un CRUD que siempre falla con "No tenés permiso"
 * (él da de alta formatos por el atajo del alta de reserva, no por acá).
 * El catálogo para ARRASTRAR formatos al calendario queda para todos los roles
 * con acceso.
 */
export function CalendarTabs({
  tenantSlug,
  ym,
  events,
  templates,
  activeTemplates,
  monthCapacity,
  today,
  defaultTab,
  role,
}: {
  tenantSlug: string
  ym: string
  events: ScheduledEventWithTemplate[]
  templates: ScheduledEventTemplateRow[]
  activeTemplates: ScheduledEventTemplateRow[]
  monthCapacity: MonthCapacity
  today: string
  defaultTab: Tab
  role: TenantRole
}) {
  const canEditTemplates = TEMPLATE_EDIT_ROLES.includes(role)
  const [tab, setTab] = useState<Tab>(canEditTemplates ? defaultTab : 'calendario')

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-5">
      <TabsList className="h-10" data-tour="eventos-tabs">
        <TabsTrigger value="calendario" className="gap-1.5 px-3">
          <CalendarPlus className="size-4" />
          Calendario
        </TabsTrigger>
        {canEditTemplates ? (
          <TabsTrigger value="eventos" className="gap-1.5 px-3">
            <Settings2 className="size-4" />
            Formatos
          </TabsTrigger>
        ) : null}
      </TabsList>

      <TabsContent value="calendario" className="space-y-4" data-tour="eventos-mes">
        {activeTemplates.length === 0 && events.length === 0 ? (
          <EmptyState
            icon={Settings2}
            title={canEditTemplates ? 'Creá tus formatos primero' : 'Todavía no hay formatos'}
            description={
              canEditTemplates
                ? 'Sushi Libre, Pizza Libre, Ramen… definí al menos un formato en la pestaña Formatos y después arrastralo al calendario.'
                : 'Sushi Libre, Pizza Libre, Ramen… el dueño tiene que cargar los formatos antes de poder programar eventos en el calendario.'
            }
            action={
              canEditTemplates ? (
                <Button className="gap-2" onClick={() => setTab('eventos')}>
                  <Settings2 className="size-4" />
                  Ir a Formatos
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ScheduledEventsMonth
            tenantSlug={tenantSlug}
            ym={ym}
            events={events}
            templates={activeTemplates}
            monthCapacity={monthCapacity}
            today={today}
          />
        )}
      </TabsContent>

      {canEditTemplates ? (
        <TabsContent value="eventos" className="space-y-4">
          <p className="text-sm text-muted-foreground text-pretty">
            El catálogo de formatos reutilizables — Sushi Libre, Pizza Libre, Ramen, etc. Cada uno
            se programa después en fechas concretas desde la pestaña Calendario.
          </p>
          <TemplatesEditor tenantSlug={tenantSlug} initial={templates} />
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
