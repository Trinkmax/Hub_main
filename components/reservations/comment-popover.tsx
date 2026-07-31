'use client'

import { MessageSquareText } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * Ícono de nota al lado del nombre en la lista de reservas. El comentario
 * completo se muestra en un popover: los comentarios llegan a 2000 caracteres
 * ("son 12, vienen 3 vegetarianos, piden la mesa del fondo…") y en una celda
 * revientan el ancho de la tabla.
 *
 * El botón se ve chico (18px) para no competir con el nombre, pero el `after`
 * le estira el área táctil a 44px sin mover el layout de la fila.
 */
export function ReservationCommentPopover({ comment }: { comment: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ver comentario del cliente"
          className="relative inline-flex size-5 shrink-0 items-center justify-center rounded-full text-sky-600 transition-colors after:absolute after:-inset-3 after:content-[''] hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-sky-400"
        >
          <MessageSquareText className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Comentario del cliente
        </p>
        <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm">
          {comment}
        </p>
      </PopoverContent>
    </Popover>
  )
}
