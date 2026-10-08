'use client'

import type { ReactNode } from 'react'
import type { ArcaMockData } from '@/components/administracion/guias/arca-guide-model'
import { MockDataProvider } from '@/components/administracion/guias/arca-mock/mock-data'
import { GuideNavProvider } from '@/components/administracion/guias/guide-nav'
import {
  GuideMobileBar,
  GuideRail,
  type GuideRailItem,
} from '@/components/administracion/guias/guide-rail'

const LABEL = 'Pasos para conectar ARCA'

/**
 * El cuerpo de la guía «Conectar ARCA»: el riel a la izquierda en la compu (fijo mientras se
 * scrollea), la barra con lo que toca arriba en el celular, y los pasos. Comparte con todos
 * los pasos qué está abierto (`GuideNavProvider`) y los datos del bar para las maquetas
 * (`MockDataProvider`).
 */
export function ArcaGuideShell({
  items,
  summary,
  currentId,
  headline,
  initialOpen,
  mockData,
  children,
}: {
  items: readonly GuideRailItem[]
  summary: { readonly done: number; readonly total: number }
  currentId: string | null
  headline: string
  initialOpen: readonly string[]
  mockData: ArcaMockData
  children: ReactNode
}) {
  return (
    <MockDataProvider value={mockData}>
      <GuideNavProvider
        items={items.map((i) => ({ id: i.id, anchor: i.anchor }))}
        initialOpen={initialOpen}
      >
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
          <GuideRail label={LABEL} items={items} summary={summary} currentId={currentId} />
          <div className="min-w-0 space-y-4">
            <GuideMobileBar
              label={LABEL}
              items={items}
              summary={summary}
              currentId={currentId}
              headline={headline}
            />
            {children}
          </div>
        </div>
      </GuideNavProvider>
    </MockDataProvider>
  )
}
