'use client'

import './floor-editor.css'
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
 * Si el editor visual del plano falla al dibujarse (una geometría rara, el
 * lienzo), queda en pie la lista de mesas en vez de romperse toda la pantalla.
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
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div role="alert" className="fpe-paper fpe-alert">
            <AlertTriangle aria-hidden />
            <p style={{ margin: 0 }}>
              No pude abrir el plano. Te dejo la lista de mesas, donde podés hacer lo mismo. Recargá
              la página para volver al plano.
            </p>
          </div>
          {this.props.fallback}
        </div>
      )
    }
    return this.props.children
  }
}
