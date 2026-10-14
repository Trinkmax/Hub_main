'use client'

import { ListPlus } from 'lucide-react'
import { useId, useMemo, useState, useTransition } from 'react'
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
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { ensureSuppliers, type SavedParty } from '@/lib/accounting/actions/master'
import { formatCents } from '@/lib/money'
import {
  OPENING_ITEMS_MAX,
  type OpeningImportLine,
  type OpeningImportParty,
  type OpeningImportResult,
  parseOpeningList,
  resolveOpeningLines,
} from '../_lib/opening-import'

/** Una deuda lista para el formulario: ya con su proveedor. */
export type ImportedPayable = OpeningImportLine & { partyId: string }

/**
 * «Pegar la lista de mi planilla»: las deudas con proveedores de los saldos iniciales
 * (pedido de los socios, 12/10/2026): se pegan desde la planilla el proveedor
 * y lo que se le debía (y, si están, el vencimiento y el comprobante) y quedan
 * como renglones del formulario, para revisarlos antes de guardar. Los
 * proveedores que no estaban cargados se crean.
 */
export function OpeningImportDialog({
  tenantSlug,
  parties,
  room,
  onImport,
}: {
  tenantSlug: string
  /** A quiénes se les puede deber (para encontrar cada renglón por el nombre). */
  parties: readonly OpeningImportParty[]
  /** Cuántas deudas más entran en el asiento. */
  room: number
  onImport: (lines: ImportedPayable[], created: SavedParty[]) => void
}) {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const parsed = useMemo(() => parseOpeningList(text, parties, room), [text, parties, room])
  const count = parsed.lines.length

  const submit = () => {
    setError(null)
    if (count === 0) {
      setError('Pegá al menos un renglón con el proveedor y el monto.')
      return
    }
    start(async () => {
      try {
        let lines = parsed.lines
        let created: SavedParty[] = []
        if (parsed.missing.length > 0) {
          const result = await ensureSuppliers(tenantSlug, { names: parsed.missing })
          if (!result.ok) {
            setError(result.message)
            return
          }
          created = result.data
          lines = resolveOpeningLines(lines, created)
        }
        const ready = lines.filter((l): l is ImportedPayable => l.partyId !== null)
        if (ready.length < lines.length) {
          const lost = [...new Set(lines.filter((l) => l.partyId === null).map((l) => l.name))]
          setError(
            `No pudimos cargar a ${lost.join(', ')}. Cargalos en Compras › Proveedores y probá de nuevo.`,
          )
          return
        }
        onImport(ready, created)
        setOpen(false)
        setText('')
      } catch {
        setError(ACC_UNREACHABLE.offline)
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11 gap-2 md:h-9"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        <ListPlus className="size-4" aria-hidden />
        Pegar la lista de mi planilla
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cargar las deudas con una lista</DialogTitle>
            <DialogDescription>
              Copiá de tu planilla la columna del proveedor y la de lo que se le debía, y pegalas
              acá. Si tenés el vencimiento y el comprobante, copialos también. Después las revisás
              antes de guardar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-list`}>Deudas con proveedores</Label>
            <Textarea
              id={`${uid}-list`}
              value={text}
              rows={10}
              placeholder={'Coca Cola     150.000     15/10/2026\nQuilmes     80.500,50'}
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
            {parsed.missing.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {parsed.missing.length === 1
                  ? 'No estaba cargado y se crea como proveedor: '
                  : `No estaban cargados y se crean como proveedores (${parsed.missing.length}): `}
                {parsed.missing.join(', ')}.
              </p>
            ) : null}
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
              {pending ? 'Cargando…' : count === 1 ? 'Cargar 1 deuda' : `Cargar ${count} deudas`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function summary(parsed: OpeningImportResult): string {
  const count = parsed.lines.length
  if (count === 0) return 'Un renglón por deuda: el proveedor y el monto.'
  const debts = count === 1 ? '1 deuda' : `${count} deudas`
  return `${debts} por ${formatCents(parsed.totalCents)}.`
}

/** Lo que no se carga, dicho en una línea por motivo. */
function notes(parsed: OpeningImportResult): string[] {
  const names = (reason: OpeningImportResult['skipped'][number]['reason']) =>
    parsed.skipped
      .filter((s) => s.reason === reason)
      .map((s) => s.name || `renglón ${s.line}`)
      .join(', ')
  const out: string[] = []
  const noAmount = names('no_amount')
  if (noAmount) out.push(`Sin un monto que se entienda (no se cargan): ${noAmount}.`)
  const negative = names('negative')
  if (negative) {
    out.push(`Con saldo a favor (no es una deuda; no se carga acá): ${negative}.`)
  }
  const badName = names('name')
  if (badName) out.push(`Sin un nombre de proveedor que sirva: ${badName}.`)
  if (parsed.zeros > 0) {
    out.push(
      parsed.zeros === 1
        ? '1 renglón en cero no se carga.'
        : `${parsed.zeros} renglones en cero no se cargan.`,
    )
  }
  if (parsed.overflow > 0) {
    out.push(
      `No ${parsed.overflow === 1 ? 'entra 1 deuda' : `entran ${parsed.overflow} deudas`}: el máximo es ${OPENING_ITEMS_MAX}.`,
    )
  }
  return out
}
