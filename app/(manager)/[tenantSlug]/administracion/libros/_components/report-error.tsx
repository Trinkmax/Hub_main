'use client'

import { RotateCcwIcon, TriangleAlertIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Un libro o un bloque que no se pudo leer, sin tirar la pantalla (H.2): el
 * encabezado y el selector de período siguen ahí para elegir otro período o
 * reintentar. El texto viene listo de la lectura (G.4), sin datos técnicos.
 */
export function ReportError({
  title = 'No pudimos cargar esto.',
  message,
  className,
}: {
  title?: string
  message: string
  className?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <EmptyState
      className={className}
      icon={TriangleAlertIcon}
      title={title}
      description={message}
      action={
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-2 md:h-9"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          <RotateCcwIcon className="size-4" aria-hidden />
          {pending ? 'Reintentando…' : 'Reintentar'}
        </Button>
      }
    />
  )
}

/** El período de la URL no se entiende: se dice por qué y se elige de nuevo arriba. */
export function PeriodError({
  message,
  hint = 'Elegí el período de nuevo con los botones de arriba.',
}: {
  message: string
  hint?: string | null
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="space-y-1 text-pretty">
        <p className="font-medium text-warning-text">{message}</p>
        {hint ? <p className="text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  )
}

/**
 * Una lectura que falló (`settleQuery`): si fue por lo que se pidió (un rango
 * que cruza ejercicios, un parámetro raro) se dice qué cambiar, sin
 * «Reintentar» (reintentar daría lo mismo); si fue la base o la red, se ofrece
 * reintentar.
 */
export function QueryErrorBlock({
  code,
  message,
  className,
}: {
  code: string
  message: string
  className?: string
}) {
  if (code === 'invalid') return <PeriodError message={message} />
  return <ReportError message={message} className={className} />
}
