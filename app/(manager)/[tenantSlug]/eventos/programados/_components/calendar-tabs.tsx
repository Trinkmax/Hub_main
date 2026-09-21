'use client'

import { CalendarPlus, Settings2 } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import type { DayOverview } from '@/lib/salon/segment-queries'
import type { MonthSegments } from '@/lib/salon/segments'
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
 *
 * El mes se muestra SIEMPRE, haya formatos o no (R10): el calendario es la
 * puerta de las reservas, y un bar sin formatos igual tiene almuerzos y cenas
 * que reservar. Antes, sin formatos ni eventos, el mes se cambiaba por un
 * "Creá tus formatos primero" y no había dónde cargar una reserva.
 */
export function CalendarTabs({
  tenantSlug,
  ym,
  events,
  templates,
  activeTemplates,
  monthSegments,
  today,
  defaultTab,
  role,
  initialOverview,
}: {
  tenantSlug: string
  ym: string
  events: ScheduledEventWithTemplate[]
  templates: ScheduledEventTemplateRow[]
  activeTemplates: ScheduledEventTemplateRow[]
  monthSegments: MonthSegments
  today: string
  defaultTab: Tab
  role: TenantRole
  /** El día de ?day precargado por la página (null si no hay día abierto). */
  initialOverview: DayOverview | null
}) {
  const canEditTemplates = TEMPLATE_EDIT_ROLES.includes(role)

  // Pedir un día (?day: ⌘K «Nueva reserva», un resultado del buscador, el
  // Adelante del navegador) vuelve al Calendario. La vista del día vive dentro
  // del mes, que Radix desmonta en la pestaña Formatos, y el pushState o
  // router.push que cambia solo la query no remonta esta página: sin esto la
  // URL decía ?day=… y no se abría nada. Se ajusta en el render (como la vista
  // del día) para que no haya un frame con la pestaña equivocada.
  const dayParam = useSearchParams().get('day')
  const [tab, setTab] = useState<Tab>(
    canEditTemplates && dayParam === null ? defaultTab : 'calendario',
  )
  const [seenDay, setSeenDay] = useState(dayParam)
  if (dayParam !== seenDay) {
    setSeenDay(dayParam)
    if (dayParam !== null) setTab('calendario')
  }

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
        {activeTemplates.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Settings2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {canEditTemplates ? 'Creá tus formatos' : 'Todavía no hay formatos'}
                </p>
                <p className="text-sm text-muted-foreground text-pretty">
                  {canEditTemplates
                    ? 'Sushi Libre, Pizza Libre, Ramen… definí tus formatos en la pestaña Formatos y arrastralos al calendario para programar eventos. Las reservas se cargan igual desde cada día.'
                    : 'El dueño todavía no cargó formatos de eventos (Sushi Libre, Pizza Libre…). Las reservas se cargan igual desde cada día.'}
                </p>
              </div>
            </div>
            {canEditTemplates ? (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2 self-start sm:self-center"
                onClick={() => setTab('eventos')}
              >
                <Settings2 className="size-4" aria-hidden />
                Ir a Formatos
              </Button>
            ) : null}
          </div>
        ) : null}
        <ScheduledEventsMonth
          tenantSlug={tenantSlug}
          ym={ym}
          events={events}
          templates={activeTemplates}
          monthSegments={monthSegments}
          today={today}
          role={role}
          initialOverview={initialOverview}
        />
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
