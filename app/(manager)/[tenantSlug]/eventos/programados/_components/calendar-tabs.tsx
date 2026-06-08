'use client'

import { CalendarPlus, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { MonthCapacity } from '@/lib/salon/month-capacity'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import type { ScheduledEventTemplateRow } from '@/lib/salon/types'
import { TemplatesEditor } from '../../templates/_components/templates-editor'
import { ScheduledEventsMonth } from './scheduled-events-month'

type Tab = 'calendario' | 'eventos'

/**
 * Calendario mensual + el catálogo de "Eventos" (ex-Templates) como pestaña interna.
 * Antes "Templates" era un item de nav suelto; ahora vive acá adentro, que es el
 * mental model del dueño: definís el evento (Sushi Libre) y lo programás en el mes.
 */
export function CalendarTabs({
  tenantSlug,
  ym,
  events,
  templates,
  activeTemplates,
  monthCapacity,
  defaultTab,
}: {
  tenantSlug: string
  ym: string
  events: ScheduledEventWithTemplate[]
  templates: ScheduledEventTemplateRow[]
  activeTemplates: ScheduledEventTemplateRow[]
  monthCapacity: MonthCapacity
  defaultTab: Tab
}) {
  const [tab, setTab] = useState<Tab>(defaultTab)

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-5">
      <TabsList className="h-10">
        <TabsTrigger value="calendario" className="gap-1.5 px-3">
          <CalendarPlus className="size-4" />
          Calendario
        </TabsTrigger>
        <TabsTrigger value="eventos" className="gap-1.5 px-3">
          <Settings2 className="size-4" />
          Eventos
        </TabsTrigger>
      </TabsList>

      <TabsContent value="calendario" className="space-y-4">
        {activeTemplates.length === 0 ? (
          <EmptyState
            icon={Settings2}
            title="Creá tus eventos primero"
            description="Sushi Libre, Pizza Libre, Ramen… definí al menos un evento en la pestaña Eventos y después arrastralo al calendario."
            action={
              <Button className="gap-2" onClick={() => setTab('eventos')}>
                <Settings2 className="size-4" />
                Ir a Eventos
              </Button>
            }
          />
        ) : (
          <ScheduledEventsMonth
            tenantSlug={tenantSlug}
            ym={ym}
            events={events}
            templates={activeTemplates}
            monthCapacity={monthCapacity}
          />
        )}
      </TabsContent>

      <TabsContent value="eventos" className="space-y-4">
        <p className="text-sm text-muted-foreground text-pretty">
          El catálogo de formatos reutilizables — Sushi Libre, Pizza Libre, Ramen, etc. Cada uno se
          programa después en fechas concretas desde la pestaña Calendario.
        </p>
        <TemplatesEditor tenantSlug={tenantSlug} initial={templates} />
      </TabsContent>
    </Tabs>
  )
}
