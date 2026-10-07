'use client'

import { MessageSquareText } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

/**
 * Ícono de nota al lado del nombre en la lista de reservas. El comentario
 * completo se muestra en un popover: los comentarios llegan a 2000 caracteres
 * ("son 12, vienen 3 vegetarianos, piden la mesa del fondo…") y en una celda
 * revientan el ancho de la tabla.
 *
 * El botón se ve chico (20 px) para no competir con el nombre; `hit-area` le
 * estira el objetivo a 24 px con mouse y a 44 con el dedo sin mover la fila.
 */
export function ReservationCommentPopover({ comment }: { comment: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ver comentario del cliente"
          className="relative hit-area inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-info-text outline-offset-2 outline-(--ring) hover:bg-hover focus-visible:outline-2"
        >
          <MessageSquareText className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid gap-2">
        <PopoverHeader>
          <PopoverTitle>Comentario del cliente</PopoverTitle>
        </PopoverHeader>
        <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words type-body">
          {comment}
        </p>
      </PopoverContent>
    </Popover>
  )
}
