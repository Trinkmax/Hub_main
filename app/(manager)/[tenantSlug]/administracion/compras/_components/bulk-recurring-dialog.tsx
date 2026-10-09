'use client'

import { ListPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { createRecurringBulk } from '@/lib/accounting/actions/master'
import { parseNameList, suggestAccount } from '../_lib/bulk'
import { nextDueFrom } from '../_lib/recurring'

type Row = { name: string; accountId: string | null; suggested: boolean }

/**
 * «Cargar una lista» de gastos fijos (pedido de los socios, 09/10/2026): se
 * pegan los nombres, se revisa en qué es cada uno (proponemos la cuenta por el
 * nombre) y se cargan todos con el mismo día de vencimiento. Quedan con monto
 * variable: el monto, las cuotas y el detalle se completan en cada uno.
 */
export function BulkRecurringDialog({
  tenantSlug,
  today,
  accounts,
  existingNames,
  fallbackAccountId,
  className,
}: {
  tenantSlug: string
  today: string
  /** Las cuentas que se pueden elegir para un gasto (grupos incluidos para la ruta). */
  accounts: readonly AccountOption[]
  existingNames: readonly string[]
  /** La cuenta para los nombres que no reconocemos («Gastos varios»), si existe. */
  fallbackAccountId: string | null
  className?: string
}) {
  const router = useRouter()
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'paste' | 'review'>('paste')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [dueDay, setDueDay] = useState(10)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const parsed = useMemo(
    () => parseNameList(text, { existing: existingNames, maxLength: 80 }),
    [text, existingNames],
  )
  const postable = useMemo(() => accounts.filter((a) => a.postable), [accounts])

  const review = () => {
    setError(null)
    if (parsed.names.length === 0) {
      setError(
        parsed.existing.length > 0
          ? 'Todos los de la lista ya están cargados.'
          : 'Pegá al menos un gasto fijo, uno por renglón.',
      )
      return
    }
    if (parsed.names.length > 100) {
      setError('Hasta 100 gastos fijos por vez.')
      return
    }
    setRows(
      parsed.names.map((name) => {
        const hit = suggestAccount(name, postable)
        return { name, accountId: hit ?? fallbackAccountId, suggested: hit !== null }
      }),
    )
    setStep('review')
  }

  const submit = () => {
    setError(null)
    if (rows.some((r) => r.accountId === null)) {
      setError('Elegí en qué es cada gasto fijo.')
      return
    }
    const nextDueDate = nextDueFrom(today, dueDay)
    start(async () => {
      try {
        const result = await createRecurringBulk(tenantSlug, {
          items: rows.map((r) => ({ name: r.name, accountId: r.accountId, dueDay, nextDueDate })),
        })
        if (!result.ok) {
          setError(result.message)
          return
        }
        toast.success(result.message)
        setOpen(false)
        setStep('paste')
        setText('')
        router.refresh()
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
        className={className ?? 'h-11 gap-2 md:h-9'}
        onClick={() => {
          setError(null)
          setStep('paste')
          setOpen(true)
        }}
      >
        <ListPlus className="size-4" aria-hidden />
        Cargar una lista
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cargar una lista de gastos fijos</DialogTitle>
            <DialogDescription>
              {step === 'paste'
                ? 'Pegá los nombres, uno por renglón. En el paso siguiente revisás en qué es cada uno.'
                : 'Revisá en qué es cada uno. Quedan con monto variable: el monto, las cuotas y el detalle los completás después en cada uno.'}
            </DialogDescription>
          </DialogHeader>

          {step === 'paste' ? (
            <div className="grid gap-2">
              <Label htmlFor={`${uid}-names`}>Gastos fijos</Label>
              <Textarea
                id={`${uid}-names`}
                value={text}
                rows={10}
                placeholder={'Alarma\nSeguro integral de comercio\nSueldos personal'}
                aria-describedby={`${uid}-summary`}
                onChange={(e) => {
                  setText(e.target.value)
                  setError(null)
                }}
                className="text-base md:text-sm"
              />
              <p id={`${uid}-summary`} aria-live="polite" className="text-xs text-muted-foreground">
                {parsed.names.length === 0 && parsed.existing.length === 0
                  ? 'Un nombre por renglón.'
                  : [
                      parsed.names.length === 1 ? '1 nuevo' : `${parsed.names.length} nuevos`,
                      parsed.existing.length > 0
                        ? `${parsed.existing.length} ya ${parsed.existing.length === 1 ? 'estaba' : 'estaban'} (no se repiten)`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </p>
              {parsed.invalid.length > 0 ? (
                <p className="text-xs text-warning-text">
                  No se cargan (muy cortos o muy largos): {parsed.invalid.join(', ')}.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={`${uid}-due`} className="text-sm font-normal">
                  Vencen el día
                </Label>
                <Input
                  id={`${uid}-due`}
                  value={String(dueDay)}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 2)
                    setDueDay(digits === '' ? 1 : Math.min(31, Math.max(1, Number(digits))))
                  }}
                  className="h-11 w-16 text-base tabular-nums md:h-9 md:text-sm"
                />
                <span className="text-xs text-muted-foreground">
                  de cada mes (después lo cambiás en cada uno).
                </span>
              </div>
              <ul className="grid gap-2">
                {rows.map((row, index) => (
                  <li
                    key={row.name}
                    className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center sm:gap-3"
                  >
                    <span className="truncate text-sm font-medium">{row.name}</span>
                    <AccountCombobox
                      id={`${uid}-acc-${index}`}
                      value={row.accountId}
                      onValueChange={(next) =>
                        setRows((prev) =>
                          prev.map((r, i) =>
                            i === index ? { ...r, accountId: next, suggested: false } : r,
                          ),
                        )
                      }
                      accounts={accounts}
                      placeholder="¿En qué es?"
                      invalid={row.accountId === null && error !== null}
                      aria-label={`En qué es ${row.name}`}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter className="gap-2">
            {step === 'review' ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-9"
                disabled={pending}
                onClick={() => setStep('paste')}
              >
                Volver a la lista
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-9"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
            )}
            {step === 'paste' ? (
              <Button
                type="button"
                className="h-11 min-w-[140px] md:h-9"
                disabled={parsed.names.length === 0}
                onClick={review}
              >
                Revisar
              </Button>
            ) : (
              <Button
                type="button"
                className="h-11 min-w-[160px] md:h-9"
                disabled={pending}
                onClick={submit}
              >
                {pending
                  ? 'Cargando…'
                  : rows.length === 1
                    ? 'Cargar 1 gasto fijo'
                    : `Cargar ${rows.length} gastos fijos`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
