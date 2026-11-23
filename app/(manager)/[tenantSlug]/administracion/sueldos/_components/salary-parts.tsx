'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { MoneyField } from '@/components/administracion/money-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { saveEmployeeSalaryParts } from '@/lib/accounting/actions/payroll'
import { monthWord, type PayrollEmployee } from '@/lib/accounting/payroll'
import { formatCentsShort } from '@/lib/money'

/** «En blanco $ 400.000 · En negro $ 300.000»: el renglón chico debajo del sueldo. */
export function salaryPartsWords(
  employee: Pick<PayrollEmployee, 'salaryCents' | 'salaryOffBooksCents'>,
): string | null {
  const offBooks = Math.min(employee.salaryOffBooksCents ?? 0, employee.salaryCents)
  if (offBooks <= 0) return null
  return `En blanco ${formatCentsShort(employee.salaryCents - offBooks)} · En negro ${formatCentsShort(offBooks)}`
}

/**
 * El sueldo en sus dos partes: cuánto va en blanco y cuánto en negro, con el total en vivo (es lo que
 * muestra la planilla). Vale desde ese mes: los siguientes lo heredan, como el sueldo de siempre.
 *
 * Quien no usa «en negro» nunca llega acá: escribe el sueldo en su celda y listo.
 */
export function SalaryPartsDialog({
  employee,
  month,
  onClose,
}: {
  employee: PayrollEmployee
  month: string
  onClose: () => void
}) {
  const { tenantSlug } = useAccounting()
  const router = useRouter()
  const startOffBooks = Math.min(employee.salaryOffBooksCents ?? 0, employee.salaryCents)
  const startDeclared = employee.salaryCents - startOffBooks
  const [declared, setDeclared] = useState<number | null>(startDeclared > 0 ? startDeclared : null)
  const [offBooks, setOffBooks] = useState<number | null>(startOffBooks > 0 ? startOffBooks : null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const total = (declared ?? 0) + (offBooks ?? 0)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setFailure(null)
    start(async () => {
      try {
        const result = await saveEmployeeSalaryParts(tenantSlug, {
          employeeId: employee.id,
          month,
          // Un campo vacío es cero: «todo en blanco» se carga llenando uno solo.
          declaredCents: declared ?? 0,
          offBooksCents: offBooks ?? 0,
        })
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {})
          setFailure(`No se guardó. ${result.message}`.trim())
          return
        }
        toast.success(result.message)
        router.refresh()
        onClose()
      } catch {
        setFailure(ACC_UNREACHABLE.offline)
      }
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sueldo de {employee.name}</DialogTitle>
          <DialogDescription>
            Desde {monthWord(month)}: los meses que siguen lo heredan.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyField
              label="En blanco"
              autoFocus
              align="end"
              decimals="auto"
              value={declared}
              onValueChange={(cents) => {
                setDeclared(cents)
                setErrors({})
              }}
              error={errors.declaredCents ?? null}
            />
            <MoneyField
              label="En negro"
              align="end"
              decimals="auto"
              value={offBooks}
              onValueChange={(cents) => {
                setOffBooks(cents)
                setErrors({})
              }}
              error={errors.offBooksCents ?? null}
            />
          </div>
          <p
            aria-live="polite"
            className="flex items-baseline justify-between gap-3 border-t border-border/70 pt-3"
          >
            <span className="text-sm text-muted-foreground">Sueldo del mes</span>
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatCentsShort(total)}
            </span>
          </p>
          {failure ? (
            <p role="alert" className="text-sm text-destructive text-pretty">
              {failure}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-9"
              disabled={pending}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button type="submit" className="h-11 sm:h-9" disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
