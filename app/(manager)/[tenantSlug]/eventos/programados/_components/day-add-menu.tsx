import { CalendarDays, CalendarPlus, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRef } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * El '+' de cada día del mes. Antes iba directo a "Programar evento"; ahora
 * que el calendario es la puerta de las reservas, primero ofrece VER el día:
 * el dueño pidió mirar cómo viene el día antes de cargar (pedido 3), y desde
 * la vista del día se reserva con la hora del servicio ya puesta.
 *
 * Sin directiva: lo importan el mes (cliente) y recibe callbacks.
 */
export function DayAddMenu({
  tenantSlug,
  date,
  dayLabel,
  onOpenDay,
  variant,
}: {
  tenantSlug: string
  date: string
  /** 'jueves 10 de septiembre', para los aria-label. */
  dayLabel: string
  onOpenDay: () => void
  /** cell: la celda de la grilla (aparece con hover/foco/touch) · agenda: la fila del celu. */
  variant: 'cell' | 'agenda'
}) {
  // Al elegir "Ver el día" se abre un Dialog: si el menú devolviera el foco a
  // su botón al cerrarse, se lo robaría a la vista del día recién abierta.
  const openingDayRef = useRef(false)

  return (
    // No modal: un menú modal deja `pointer-events: none` en el body y, si en
    // el medio se abre el Dialog del día, la página puede quedar sin clicks
    // al cerrarlo (bug conocido de Radix con menú → diálogo).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Opciones del ${dayLabel}`}
          className={cn(
            'relative shrink-0 rounded text-muted-foreground outline-none transition-[color,background-color,opacity] hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-secondary data-[state=open]:opacity-100',
            variant === 'cell'
              ? // En la compu aparece al pasar el mouse; con teclado (foco) y en
                // pantallas táctiles (sin hover) se ve siempre. Antes era
                // opacity-0 fijo con group-hover: invisible con el dedo y con Tab.
                'p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100'
              : // El `after` le estira el área táctil a ~44 px sin mover el
                // layout ni engordar la fila del día vacío: es EL gesto de la
                // agenda en el celular, tiene que ser cómodo con el pulgar.
                "p-1 after:absolute after:-inset-2.5 after:content-['']",
          )}
        >
          <Plus className={variant === 'cell' ? 'size-3' : 'size-4'} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-52"
        onCloseAutoFocus={(e) => {
          if (openingDayRef.current) {
            e.preventDefault()
            openingDayRef.current = false
          }
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            openingDayRef.current = true
            onOpenDay()
          }}
        >
          <CalendarDays aria-hidden />
          Ver el día y reservar
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/${tenantSlug}/eventos/programados/nuevo?date=${date}`}>
            <CalendarPlus aria-hidden />
            Programar evento
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
