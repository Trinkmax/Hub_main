'use client'

import { RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'

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
 *
 * «Reintentar» vuelve a montar el editor; si el error se repite, se vuelve a ver
 * la lista.
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

  private retry = (): void => {
    this.setState({ hasError: false })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col gap-4">
          <Callout
            tone="warning"
            announce="assertive"
            title="No pudimos abrir el editor del plano"
            action={
              <Button type="button" size="sm" variant="secondary" onClick={this.retry}>
                <RotateCcw aria-hidden />
                Reintentar
              </Button>
            }
          >
            Mientras tanto, te mostramos la lista de mesas: desde acá podés hacer lo mismo con cada
            mesa y su QR.
          </Callout>
          {this.props.fallback}
        </div>
      )
    }
    return this.props.children
  }
}
