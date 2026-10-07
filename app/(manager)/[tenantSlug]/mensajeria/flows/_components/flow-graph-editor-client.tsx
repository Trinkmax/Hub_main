'use client'

import { Loader2 } from 'lucide-react'
import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'

/**
 * React Flow no sobrevive bien al SSR: el paso disparador se crea con un id
 * aleatorio y el HTML del server nunca coincide con el del cliente (mismatch
 * de hidratación que deja el nodo invisible). Lo montamos solo en cliente.
 */
const FlowGraphEditorInner = dynamic(
  () => import('./flow-graph-editor').then((m) => m.FlowGraphEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[calc(100vh-8rem)] min-h-[600px] items-center justify-center rounded-xl border border-border/60 bg-card">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Preparando el lienzo…
        </p>
      </div>
    ),
  },
)

export function FlowGraphEditorClient(props: ComponentProps<typeof FlowGraphEditorInner>) {
  return <FlowGraphEditorInner {...props} />
}
