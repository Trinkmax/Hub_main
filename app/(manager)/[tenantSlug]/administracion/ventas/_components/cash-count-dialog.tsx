'use client'

import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { MoneyField } from '@/components/administracion/money-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { saveDailyCash } from '@/lib/accounting/actions/projection'
import { cashDiffText } from '@/lib/accounting/projection'
import type { CashCountTreasury } from '@/lib/accounting/queries/projection'
import { MAX_CENTS } from '@/lib/accounting/schemas'
import { formatCentsShort } from '@/lib/money'
import { useMasterAction } from '../../ajustes/_components/use-master-action'

/**
 * «Entró» de un día (pedido de los socios, 12/10/2026): lo que entró de verdad
 * en cada caja o banco, cargado a mano, para compararlo con lo vendido en el
 * salón. No cambia ningún saldo. Un campo vacío es «sin cargar», que no es lo
 * mismo que cero.
 *
 * El disparador tiene dos formas y nada más cambia: `cell` es la celda de la
 * tabla (el importe con su lápiz) y `button`, el botón de la noche elegida
 * («Anotar lo que entró» / «Cambiar lo que entró», o el `buttonLabel` que le
 * pasen). El diálogo y lo que se guarda son los mismos.
 */
export function CashCountDialog({
  day,
  dayLabel,
  treasuries,
  initial,
  salesCents,
  countedCents,
  trigger = 'cell',
  buttonLabel,
}: {
  /** Cómo se ve lo que abre el diálogo. */
  trigger?: 'cell' | 'button'
  /** El texto del botón, si no es el de siempre: «Anotar lo que entró el lun 05/10». */
  buttonLabel?: string
  day: string
  /** «lunes 05/10». */
  dayLabel: string
  /** Las cajas del día: las activas y las que ya tenían algo cargado. */
  treasuries: readonly CashCountTreasury[]
  /** Lo ya cargado ese día, por caja. */
  initial: Readonly<Record<string, number>>
  /** Lo vendido en el salón según el cierre; `null` si falta el cierre. */
  salesCents: number | null
  /** Σ de lo cargado; `null` si ese día no se cargó nada. */
  countedCents: number | null
}) {
  const { tenantSlug } = useAccounting()
  const { pending, run } = useMasterAction()
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, number | null>>({})
  const [error, setError] = useState<string | null>(null)

  const loaded = treasuries.filter((t) => typeof values[t.id] === 'number')
  const total = loaded.reduce((sum, t) => sum + (values[t.id] ?? 0), 0)

  const openDialog = () => {
    setValues({ ...initial })
    setError(null)
    setOpen(true)
  }

  const submit = () => {
    setError(null)
    run(
      () =>
        saveDailyCash(tenantSlug, {
          day,
          items: treasuries.map((t) => ({
            treasuryAccountId: t.id,
            amountCents: values[t.id] ?? null,
          })),
        }),
      {
        onSuccess: () => setOpen(false),
        onFailure: (state) => setError(state.message),
      },
    )
  }

  return (
    <>
      {trigger === 'button' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 gap-2 md:pointer-fine:h-9"
          onClick={openDialog}
        >
          <Pencil className="size-3.5" aria-hidden />
          {buttonLabel ?? (countedCents === null ? 'Anotar lo que entró' : 'Cambiar lo que entró')}
        </Button>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          aria-label={
            countedCents === null
              ? `Cargar lo que entró el ${dayLabel}`
              : `Entró el ${dayLabel}: ${formatCentsShort(countedCents)}. Cambiar`
          }
          className="-mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm tabular-nums outline-none transition-colors hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
        >
          {countedCents === null ? (
            <span className="text-xs font-medium text-muted-foreground">Cargar</span>
          ) : (
            <span className="whitespace-nowrap">{formatCentsShort(countedCents)}</span>
          )}
          <Pencil className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
        </button>
      )}
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Lo que entró el {dayLabel}</DialogTitle>
            <DialogDescription>
              Cargá lo que entró de verdad ese día en cada caja o banco. No cambia ningún saldo: es
              para comparar con lo vendido en el salón.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            {treasuries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todavía no hay cajas cargadas. Se agregan en Ajustes.
              </p>
            ) : (
              treasuries.map((t) => (
                <MoneyField
                  key={t.id}
                  label={t.active ? t.name : `${t.name} (desactivada)`}
                  value={values[t.id] ?? null}
                  maxCents={MAX_CENTS}
                  onValueChange={(cents) => {
                    setValues((prev) => ({ ...prev, [t.id]: cents }))
                    setError(null)
                  }}
                />
              ))
            )}
            <dl className="grid gap-1 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Entró</dt>
                <dd className="font-medium tabular-nums">
                  {loaded.length === 0 ? 'Sin cargar' : formatCentsShort(total)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Vendido en el salón</dt>
                <dd className="tabular-nums">
                  {salesCents === null ? 'Falta el cierre' : formatCentsShort(salesCents)}
                </dd>
              </div>
              {salesCents !== null && loaded.length > 0 ? (
                <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-1">
                  <dt className="text-muted-foreground">Diferencia</dt>
                  <dd className="font-medium tabular-nums">{cashDiffText(total - salesCents)}</dd>
                </div>
              ) : null}
            </dl>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
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
                type="submit"
                className="h-11 min-w-[120px] md:h-9"
                disabled={pending || treasuries.length === 0}
              >
                {pending ? 'Guardando…' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
