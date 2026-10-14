import type { ReactNode } from 'react'
import { EmptyTeach, LedgerRail } from '@/components/administracion/kit'
import { formatCentsShort } from '@/lib/money'
import { InstallmentDots } from './installment-dots'
import { TickBox, type TickState } from './tick-box'

/**
 * La planilla cuando todavía no hay ningún gasto fijo: en vez de una hoja
 * vacía, tres renglones de ejemplo dibujados con las piezas de verdad (el
 * margen del día, el casillero, los puntitos de cuotas), qué va a aparecer acá
 * y el botón del paso siguiente.
 *
 * A quien solo mira no se le da ningún botón: se le dice que todavía no hay
 * nada cargado.
 */

function ExampleRow({
  tick,
  name,
  note,
  cents,
  dots,
}: {
  tick: TickState
  name: string
  note: string
  cents: number
  dots?: ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-border/60 px-2.5 py-2 last:border-b-0">
      <TickBox state={tick} label="" className="mt-0.5 size-5" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
          {dots}
          <span className="whitespace-nowrap">{note}</span>
        </p>
      </div>
      <p className="text-xs font-medium tabular-nums">{formatCentsShort(cents)}</p>
    </div>
  )
}

/** Tres renglones de la planilla, de muestra. */
function SheetSample() {
  return (
    // El aire de arriba es para el rótulo «Ejemplo», que va en esa esquina.
    <div className="mt-6 overflow-hidden rounded-lg border border-border/70 bg-card text-left">
      <div className="flex border-b border-border/60">
        <LedgerRail label="oct" value="10" unit="sáb" tone="ok" />
        <div className="min-w-0 flex-1 border-l border-adm-s5/35">
          <ExampleRow tick="done" name="Alquiler" note="Pagado el 08/10" cents={85000000} />
        </div>
      </div>
      <div className="flex">
        <LedgerRail label="oct" value="15" unit="jue" />
        <div className="min-w-0 flex-1 border-l border-adm-s5/35">
          <ExampleRow tick="empty" name="Internet" note="Vence el jueves" cents={3500000} />
          <ExampleRow
            tick="empty"
            name="Heladera"
            note="cuota 2 de 6"
            cents={12000000}
            dots={<InstallmentDots current={2} total={6} remaining={5} />}
          />
        </div>
      </div>
    </div>
  )
}

export function SheetEmpty({
  canWrite,
  pasteList,
  addOne,
}: {
  canWrite: boolean
  /** «Pegar una lista», como botón principal. */
  pasteList: ReactNode
  /** «Cargar uno». */
  addOne: ReactNode
}) {
  if (!canWrite) {
    return (
      <EmptyTeach
        title="Todavía no hay gastos fijos cargados."
        illustration={<SheetSample />}
        example
      >
        Cuando los carguen vas a ver acá qué vence cada mes, qué se pagó y cuánto falta.
      </EmptyTeach>
    )
  }
  return (
    <EmptyTeach
      title="Armá tu planilla de gastos fijos"
      illustration={<SheetSample />}
      example
      action={pasteList}
      secondary={addOne}
    >
      El alquiler, la luz, los sueldos, los impuestos: los cargás una vez y cada mes ves qué vence,
      qué pagaste y cuánto te falta.
    </EmptyTeach>
  )
}
