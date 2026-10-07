import { TriangleAlert } from 'lucide-react'
import { SEGMENT_TONE_CLASSES, SegmentBar } from '@/components/reservations/segment-meter'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { SegmentProjection } from '@/lib/salon/segments'
import { overCapacityConfirmCopy, segmentHeadline, segmentTone } from '@/lib/salon/segments-copy'
import { cn } from '@/lib/utils'

/**
 * Confirmación antes de guardar una reserva que pasa el cupo del servicio (D3).
 *
 * No bloquea: el dueño decidió que pasarse se permite, pero que nadie lo haga
 * sin enterarse. Los números salen de la misma proyección que el medidor en
 * vivo del form (recalculada con datos frescos al apretar Guardar), así la
 * pregunta no sorprende. "Revisar" es el foco inicial (Radix enfoca Cancel):
 * un Enter distraído no carga la reserva.
 *
 * Presentacional: abierta mientras haya proyección; el form decide qué pasa al
 * confirmar o cancelar.
 */
export function OverCapacityConfirm({
  projection,
  mode,
  onConfirm,
  onCancel,
}: {
  projection: SegmentProjection | null
  mode: 'create' | 'edit'
  onConfirm: () => void
  onCancel: () => void
}) {
  const copy = projection ? overCapacityConfirmCopy(projection) : null
  const tone = projection ? SEGMENT_TONE_CLASSES[segmentTone(projection.after)] : null

  return (
    <AlertDialog
      open={projection !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      {projection && copy && tone ? (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert aria-hidden className="size-5 shrink-0 text-destructive" />
              {copy.title}
            </AlertDialogTitle>
            {/* asChild: el Description de Radix es un <p> y adentro van dos. */}
            <AlertDialogDescription asChild>
              <div className="space-y-1">
                <p>{copy.body}</p>
                {copy.eventLine ? <p>{copy.eventLine}</p> : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5 rounded-lg border border-border/60 bg-card/60 p-3">
            <p className={cn('font-mono text-sm font-medium tabular-nums', tone.text)}>
              {segmentHeadline(projection.after, 'long')}
            </p>
            <SegmentBar segment={projection.after} size="sm" />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Revisar</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={onConfirm}>
              {mode === 'edit' ? 'Guardar igual' : 'Cargar igual'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  )
}
