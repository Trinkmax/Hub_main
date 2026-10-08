'use client'

import { CalendarClock, MessageCircleQuestion } from 'lucide-react'
import { HowToNote, HowToShell, HowToStep } from './how-to-shell'

/**
 * «¿Cómo lo bajo?» del extracto del banco (diseño §5.1.4; `banco.md` §1.2). Solo texto: cada
 * banco exporta distinto y todavía no tenemos muestras reales de todos, así que pide un archivo
 * de ejemplo cuando no se reconoce. El de Banco Nación (Nación Empresa 24) va como ejemplo.
 * Contrato C1.
 */
export function HowToBanco({
  defaultOpen = false,
  className,
}: {
  defaultOpen?: boolean
  className?: string
}) {
  return (
    <HowToShell
      subtitle="Los movimientos de la cuenta del banco, para cargar gastos bancarios y transferencias."
      defaultOpen={defaultOpen}
      className={className}
    >
      <HowToNote icon={<CalendarClock className="size-4" />} title="Cuándo">
        Una vez por semana. Muchos bancos guardan solo los últimos 3 meses: no lo dejes pasar.
      </HowToNote>
      <ol className="space-y-4">
        <HowToStep n={1}>
          Entrá al home banking de <b>empresas</b> de la cuenta de la SAS (desde la compu es más
          fácil).
        </HowToStep>
        <HowToStep n={2}>
          Buscá <b>«Movimientos»</b> (suele estar en «Consultas» o en la cuenta) y elegí la cuenta.
        </HowToStep>
        <HowToStep n={3}>
          Elegí el <b>rango de fechas</b>: desde el día siguiente al último que subiste hasta ayer.
          Usá los movimientos ya confirmados, no los «del día» ni los «pendientes».
        </HowToStep>
        <HowToStep n={4}>
          Exportá en <b>CSV, Excel (XLS) o TXT</b>, el que te deje el banco. El PDF del resumen no
          sirve para importar.
        </HowToStep>
        <HowToStep n={5}>
          Arrastrá el archivo a la pantalla de importar. La primera vez quizás te preguntemos qué es
          cada columna (fecha, detalle, importe): después lo reconocemos solo.
        </HowToStep>
      </ol>
      <div className="rounded-lg border border-border bg-background/60 p-3 text-xs text-muted-foreground text-pretty">
        <p className="font-medium text-foreground">Ejemplo: Banco Nación</p>
        <p className="mt-1">
          En <b>Nación Empresa 24</b>: Consultas › Movimientos › elegí la cuenta y el rango ›
          exportá en CSV, TXT o XLS. Guarda 3 meses. Si usás BNA+ Empresas, probá con «Movimientos»
          de la cuenta y avisanos qué formato te deja bajar.
        </p>
      </div>
      <HowToNote
        icon={<MessageCircleQuestion className="size-4" />}
        title="¿No lo reconoce?"
        tone="warning"
      >
        Avisanos y mandanos ese archivo de ejemplo: lo sumamos para que la próxima vez entre solo.
      </HowToNote>
    </HowToShell>
  )
}
