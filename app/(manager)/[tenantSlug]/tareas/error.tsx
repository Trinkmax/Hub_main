'use client'

import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Si el tablero no se pudo leer (o algo se rompió adentro), esto en vez de la pantalla de
 * error de Next: qué pasó y un botón para probar de nuevo, sin perder el menú.
 */
export default function TareasError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-3 px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-serif text-2xl font-semibold tracking-tight">Tareas</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        No pudimos mostrar el tablero. Puede ser la conexión: probá de nuevo en un momento.
      </p>
      <Button onClick={reset}>
        <RotateCcw className="size-4" aria-hidden />
        Reintentar
      </Button>
    </div>
  )
}
