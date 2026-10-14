'use client'

import { useId, useMemo, useState } from 'react'
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
import {
  matchPastedAmounts,
  type PasteMatch,
  type PasteRow,
  pasteSummary,
} from '../../_lib/paste-amounts'

/**
 * «Pegar los montos desde tu planilla»: se pegan las columnas del concepto y
 * del monto (y, si está, la del vencimiento) y cada renglón se junta con el
 * gasto fijo que se llama igual. Mientras se pega dice cuántos encontró, cuáles
 * no vinieron y cuáles sobran.
 *
 * NO guarda: «Completar los N» cierra y deja esos campos completados y
 * resaltados en la pantalla de atrás, para revisarlos antes de guardar.
 */
export function PasteAmountsDialog({
  open,
  onOpenChange,
  rows,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Los gastos fijos activos: contra estos nombres se junta lo pegado. */
  rows: readonly PasteRow[]
  onApply: (matches: PasteMatch[]) => void
}) {
  const uid = useId()
  const [text, setText] = useState('')
  const result = useMemo(() => matchPastedAmounts(text, rows), [text, rows])
  const summary = pasteSummary(result, rows.length)
  const found = result.matches.length
  const empty = text.trim() === ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Pegar los montos desde tu planilla</DialogTitle>
          <DialogDescription>
            Copiá de tu planilla la columna del concepto y la del monto (y, si la tenés, la del
            vencimiento) y pegalas acá. Junto cada renglón con el gasto fijo que se llama igual.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor={`${uid}-text`}>Lo que copiaste</Label>
          <Textarea
            id={`${uid}-text`}
            value={text}
            rows={8}
            placeholder={'Alarma\t45.000\t10/11/2026\nInternet\t35.000\t15/11/2026'}
            aria-describedby={`${uid}-summary`}
            onChange={(event) => setText(event.target.value)}
            className="font-mono text-base md:text-sm"
          />
          <div id={`${uid}-summary`} aria-live="polite" className="grid gap-1.5 text-sm">
            {empty ? (
              <p className="text-muted-foreground">
                Todavía no pegaste nada. Sirve con dos columnas: el nombre y el monto.
              </p>
            ) : (
              <>
                <p className="font-medium">{summary.headline}</p>
                {summary.missing ? (
                  <p className="text-muted-foreground text-pretty">{summary.missing}</p>
                ) : null}
                {summary.extra ? (
                  <p className="text-muted-foreground text-pretty">{summary.extra}</p>
                ) : null}
              </>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="h-11 min-w-[160px] md:h-9"
            disabled={found === 0}
            onClick={() => {
              onApply(result.matches)
              setText('')
              onOpenChange(false)
            }}
          >
            {found === 0 ? 'Completar' : found === 1 ? 'Completar 1' : `Completar los ${found}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
