'use client'

import { AlertTriangle } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

type FloorPlanErrorBoundaryProps = {
  fallback: ReactNode
  children: ReactNode
}

type FloorPlanErrorBoundaryState = {
  hasError: boolean
}

/**
 * Si el editor visual de plano falla en render (p. ej. dnd-kit / geometría rara),
 * degradamos a la lista accesible en vez de romper toda la pantalla de mesas.
 * Sin react-error-boundary en el repo → class component con React.Component.
 */
export class FloorPlanErrorBoundary extends Component<
  FloorPlanErrorBoundaryProps,
  FloorPlanErrorBoundaryState
> {
  state: FloorPlanErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): FloorPlanErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Sin PII: el editor no maneja datos de cliente. Solo el mensaje + el component stack.
    console.error('[floor-plan.editor] render error', error.message, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="space-y-4">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p>
              No pudimos cargar el editor visual de plano. Te mostramos la lista de mesas, donde
              podés hacer todo igual. Probá recargar la página para volver al editor.
            </p>
          </div>
          {this.props.fallback}
        </div>
      )
    }
    return this.props.children
  }
}
