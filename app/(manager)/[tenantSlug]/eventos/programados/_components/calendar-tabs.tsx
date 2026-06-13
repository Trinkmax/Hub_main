'use client'

import { CalendarPlus, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CalendarShow } from '@/lib/events/queries'
import type { MonthCapacity } from '@/lib/salon/month-capacity'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import type { ScheduledEventTemplateRow } from '@/lib/salon/types'
import { TemplatesEditor } from '../../templates/_components/templates-editor'
import { ScheduledEventsMonth } from './scheduled-events-month'

type Tab = 'calendario' | 'eventos'

/**
 * Un solo calendario del mes que muestra TODO lo que pasa en el bar: los
 * eventos programados a partir de formatos reutilizables (Sushi Libre, Pizza
 * Libre…) y los shows puntuales (fiestas, peñas) que se gestionan aparte. La
 * pestaña "Formatos" (ex-Templates) es el catálogo de esos formatos.
 */
export function CalendarTabs({
  tenantSlug,
  ym,
  events,
  shows,
  templates,
  activeTemplates,
  monthCapacity,
  defaultTab,
}: {
  tenantSlug: string
  ym: string
  events: ScheduledEventWithTemplate[]
  shows: CalendarShow[]
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
          Formatos
        </TabsTrigger>
      </TabsList>

      <TabsContent value="calendario" className="space-y-4">
        {activeTemplates.length === 0 && events.length === 0 && shows.length === 0 ? (
          <EmptyState
            icon={Settings2}
            title="Creá tus formatos primero"
            description="Sushi Libre, Pizza Libre, Ramen… definí al menos un formato en la pestaña Formatos y después arrastralo al calendario."
            action={
              <Button className="gap-2" onClick={() => setTab('eventos')}>
                <Settings2 className="size-4" />
                Ir a Formatos
              </Button>
            }
          />
        ) : (
          <ScheduledEventsMonth
            tenantSlug={tenantSlug}
            ym={ym}
            events={events}
            shows={shows}
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
