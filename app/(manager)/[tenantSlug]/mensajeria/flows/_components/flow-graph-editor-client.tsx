'use client'

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import { Spinner } from '@/components/ui/spinner'

/**
 * React Flow no sobrevive bien al SSR: el paso disparador se crea con un id
 * aleatorio y el HTML del server nunca coincide con el del cliente (mismatch
 * de hidratación que deja el nodo invisible). Lo montamos solo en cliente.
 *
 * Mientras carga ocupa el mismo lugar que el lienzo (el resto del alto de la
 * página), así nada salta cuando aparece.
 */
const FlowGraphEditorInner = dynamic(
  () => import('./flow-graph-editor').then((m) => m.FlowGraphEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[28rem] flex-1 items-center justify-center rounded-xl border border-border bg-card">
        <p role="status" className="flex items-center gap-2 type-body text-muted-foreground">
          <Spinner size={16} aria-hidden />
          Preparando el lienzo…
        </p>
      </div>
    ),
  },
)

export function FlowGraphEditorClient(props: ComponentProps<typeof FlowGraphEditorInner>) {
  return <FlowGraphEditorInner {...props} />
}
