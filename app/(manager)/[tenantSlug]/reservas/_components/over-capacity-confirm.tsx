'use client'

import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { SEGMENT_TONE_CLASSES, SegmentBar } from '@/components/reservations/segment-meter'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { SegmentProjection } from '@/lib/salon/segments'
import { overCapacityConfirmCopy, segmentHeadline, segmentTone } from '@/lib/salon/segments-copy'
import { cn } from '@/lib/utils'

/**
 * Confirmación antes de guardar una reserva que pasa el cupo del servicio (D3).
 *
 * No bloquea: el dueño decidió que pasarse se permite, pero que nadie lo haga
 * sin enterarse. Los números salen de la misma proyección que el medidor en
 * vivo del form (recalculada con datos frescos al apretar Guardar), así la
 * pregunta no sorprende. "Revisar" es el foco inicial (el `ConfirmDialog` del
 * kit enfoca lo menos destructivo): un Enter distraído no carga la reserva.
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
  // La última proyección se queda mientras el diálogo se cierra: sin esto el
  // texto se vaciaba en plena animación de salida.
  const [shown, setShown] = useState(projection)
  if (projection !== null && projection !== shown) setShown(projection)

  const current = projection ?? shown
  const copy = current ? overCapacityConfirmCopy(current) : null
  const tone = current ? SEGMENT_TONE_CLASSES[segmentTone(current.after)] : null

  return (
    <ConfirmDialog
      open={projection !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      icon={TriangleAlert}
      title={copy?.title ?? 'Te pasás del cupo'}
      description={
        copy ? (
          <span className="grid gap-1">
            <span>{copy.body}</span>
            {copy.eventLine ? <span>{copy.eventLine}</span> : null}
          </span>
        ) : undefined
      }
      confirmLabel={mode === 'edit' ? 'Guardar igual' : 'Cargar igual'}
      cancelLabel="Revisar"
      onConfirm={onConfirm}
    >
      {current && tone ? (
        <div className="grid gap-1.5 rounded-lg bg-secondary p-3">
          <p className={cn('type-label tabular-nums', tone.text)}>
            {segmentHeadline(current.after, 'long')}
          </p>
          <SegmentBar segment={current.after} size="sm" />
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
