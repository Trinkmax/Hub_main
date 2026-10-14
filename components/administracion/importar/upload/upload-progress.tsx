import { Check, Loader2 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import type { UiImportSource } from '@/lib/imports/ui/labels'
import { formatCount, progressPercent } from '@/lib/imports/ui/progress'
import { cn } from '@/lib/utils'

/** Los tres momentos de una subida (`job.step` del cargador). */
export type UploadStep = 'batch' | 'rows' | 'build'

const ORDER: readonly UploadStep[] = ['batch', 'rows', 'build']

/**
 * Mientras sube: los tres momentos, cada uno con su estado (hecho, en curso,
 * falta), la barra y el aviso de no cerrar la pestaña. Antes era una sola frase
 * que cambiaba; así se ve cuánto falta y que todavía no se cargó nada.
 * Server-safe (el estado lo lleva `ImportUploader`).
 */
export function UploadProgress({
  source,
  step,
  done,
  total,
}: {
  source: UiImportSource
  step: UploadStep
  done: number
  total: number
}) {
  const at = ORDER.indexOf(step)
  const labels: Readonly<Record<UploadStep, string>> = {
    batch: 'Abro la carpeta de este archivo',
    rows: `Guardo los renglones (${formatCount(Math.min(done, total))} de ${formatCount(total)})`,
    build:
      source === 'arca_recibidos'
        ? 'Armo los comprobantes con tus proveedores'
        : 'Armo los movimientos con tus cuentas',
  }
  return (
    <section aria-label="Subiendo el archivo" className="space-y-4 rounded-xl bg-secondary/50 p-4">
      <ol className="space-y-2.5">
        {ORDER.map((key, index) => {
          const state = index < at ? 'done' : index === at ? 'current' : 'todo'
          return (
            <li key={key} className="flex items-center gap-3 text-sm">
              <span
                aria-hidden
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border',
                  state === 'done' && 'border-success/40 bg-success/12 text-success',
                  state === 'current' && 'border-primary bg-primary text-primary-foreground',
                  state === 'todo' && 'border-border bg-card text-muted-foreground',
                )}
              >
                {state === 'done' ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : state === 'current' ? (
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <span className="text-[11px] font-semibold tabular-nums">{index + 1}</span>
                )}
              </span>
              <span
                className={cn(
                  state === 'current' && 'font-medium',
                  state === 'todo' && 'text-muted-foreground',
                )}
              >
                {labels[key]}
                <span className="sr-only">
                  {state === 'done' ? ' (hecho)' : state === 'current' ? ' (en curso)' : ' (falta)'}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
      <Progress
        value={step === 'batch' ? 2 : step === 'build' ? 100 : progressPercent(done, total)}
        aria-label="Progreso de la subida"
      />
      <p className="text-xs text-muted-foreground">
        No cierres esta pestaña. Todavía no se carga nada.
      </p>
    </section>
  )
}
