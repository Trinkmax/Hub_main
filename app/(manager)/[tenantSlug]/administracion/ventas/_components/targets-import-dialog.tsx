'use client'

import { ListPlus } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { saveSalesTargets } from '@/lib/accounting/actions/projection'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { useMasterAction } from '../../ajustes/_components/use-master-action'
import { parseTargetsList, type TargetsImportResult } from '../_lib/targets-import'

/**
 * «Cargar una lista» de los objetivos del mes (pedido de los socios,
 * 12/10/2026): se pega la columna «Objetivo» de la planilla, un monto por
 * renglón desde el día 1, y queda cargado el mes entero. Las notas de cada día
 * no se tocan.
 *
 * `variant` cambia solo el botón que lo abre: `primary` cuando es EL paso
 * siguiente (el mes todavía no tiene objetivo) y `quiet` cuando acompaña a otra
 * cosa. El diálogo y lo que se guarda son los mismos.
 */
export function TargetsImportDialog({
  month,
  monthLabel,
  variant = 'quiet',
}: {
  /** `yyyy-MM`. */
  month: string
  /** «Octubre 2026». */
  monthLabel: string
  variant?: 'quiet' | 'primary'
}) {
  const uid = useId()
  const { tenantSlug } = useAccounting()
  const { pending, run } = useMasterAction()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const parsed = useMemo(() => parseTargetsList(text, month), [text, month])
  const count = parsed.items.length

  const submit = () => {
    setError(null)
    if (count === 0) {
      setError('Pegá al menos un renglón con un monto.')
      return
    }
    run(() => saveSalesTargets(tenantSlug, { items: parsed.items }), {
      onSuccess: () => {
        setOpen(false)
        setText('')
      },
      onFailure: (state) => setError(state.message),
    })
  }

  return (
    <>
      <Button
        type="button"
        variant={variant === 'primary' ? 'default' : 'outline'}
        className={variant === 'primary' ? 'h-11 gap-2 px-5' : 'h-11 gap-2 md:pointer-fine:h-9'}
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        <ListPlus className="size-4" aria-hidden />
        Cargar una lista
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cargar los objetivos de {monthLabel}</DialogTitle>
            <DialogDescription>
              Copiá de tu planilla la columna del objetivo y pegala acá: un monto por renglón, y el
              primer renglón es el día 1. Un renglón vacío deja ese día sin objetivo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-list`}>Objetivo de cada día</Label>
            <Textarea
              id={`${uid}-list`}
              value={text}
              rows={12}
              placeholder={'1.200.000\n1.200.000\n1.800.000\n2.500.000'}
              aria-describedby={`${uid}-summary`}
              onChange={(e) => {
                setText(e.target.value)
                setError(null)
              }}
              className="font-mono text-base md:text-sm"
            />
            <p id={`${uid}-summary`} aria-live="polite" className="text-xs text-muted-foreground">
              {summary(parsed)}
            </p>
            {notes(parsed).map((note) => (
              <p key={note} className="text-xs text-warning-text">
                {note}
              </p>
            ))}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-11 min-w-[160px] md:h-9"
              disabled={pending || count === 0}
              onClick={submit}
            >
              {pending ? 'Cargando…' : count === 1 ? 'Cargar 1 día' : `Cargar ${count} días`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function summary(parsed: TargetsImportResult): string {
  if (parsed.items.length === 0) return 'Un renglón por día, empezando por el día 1.'
  const last = parsed.items.at(-1)
  const until = last ? ` (hasta el ${formatDayMonth(last.day)})` : ''
  const withTarget =
    parsed.withTarget === 1
      ? `1 día con objetivo por ${formatCentsShort(parsed.totalCents)}`
      : `${parsed.withTarget} días con objetivo por ${formatCentsShort(parsed.totalCents)}`
  const cleared =
    parsed.cleared === 0
      ? ''
      : parsed.cleared === 1
        ? ' y 1 queda sin objetivo'
        : ` y ${parsed.cleared} quedan sin objetivo`
  return `${withTarget}${cleared}${until}.`
}

/** Lo que no se carga, dicho en una línea por motivo. */
function notes(parsed: TargetsImportResult): string[] {
  const out: string[] = []
  if (parsed.invalid.length > 0) {
    const where = parsed.invalid
      .slice(0, 6)
      .map((i) => `renglón ${i.line} («${i.text}»)`)
      .join(', ')
    const more = parsed.invalid.length > 6 ? ` y ${parsed.invalid.length - 6} más` : ''
    out.push(`No se entiende el monto y ese día queda como estaba: ${where}${more}.`)
  }
  if (parsed.overflow > 0) {
    out.push(
      parsed.overflow === 1
        ? 'Sobra 1 renglón: el mes no tiene tantos días.'
        : `Sobran ${parsed.overflow} renglones: el mes no tiene tantos días.`,
    )
  }
  return out
}
