'use client'

import { ListPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { Pill } from '@/components/administracion/kit'
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
import { cn } from '@/lib/utils'
import {
  joinNameSources,
  nameKey,
  parseNameList,
  recurringBulkItems,
  suggestAccount,
  TYPICAL_RECURRING,
} from '../_lib/bulk'
import { gastosFijosFillHref } from '../_lib/links'
import { nextDueFrom } from '../_lib/recurring'

type Row = { name: string; accountId: string | null; suggested: boolean }

/**
 * «Pegar una lista» de gastos fijos (pedido de los socios, 09/10/2026), en dos
 * pasos: «¿Cuáles tenés?» (se tildan los típicos de un bar o se pega la lista
 * propia; si viene con varias columnas, vale la primera) y «Revisá» (en qué se
 * gasta cada uno, con la categoría propuesta por el nombre, y el día en que
 * vencen). Se cargan todos de una, sin monto.
 *
 * Manda lo mismo de siempre: `createRecurringBulk({ items: [{ name, accountId,
 * dueDay, nextDueDate }] })`, con el mismo día para todos. Lo que cambia es a
 * dónde va después: a «Completar la planilla», para ponerles el monto.
 *
 * `trigger` es cómo se ve el botón que la abre: `link` (callado, debajo de la
 * planilla) o `primary` (el botón del estado vacío).
 */
export function BulkRecurringDialog({
  tenantSlug,
  today,
  accounts,
  existingNames,
  fallbackAccountId,
  trigger = 'link',
  className,
}: {
  tenantSlug: string
  today: string
  /** Las cuentas que se pueden elegir para un gasto (grupos incluidos para la ruta). */
  accounts: readonly AccountOption[]
  existingNames: readonly string[]
  /** La cuenta para los nombres que no reconocemos («Gastos varios»), si existe. */
  fallbackAccountId: string | null
  trigger?: 'link' | 'primary'
  className?: string
}) {
  const router = useRouter()
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'paste' | 'review'>('paste')
  const [picked, setPicked] = useState<readonly string[]>([])
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [dueDay, setDueDay] = useState(10)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const parsed = useMemo(
    () => parseNameList(joinNameSources(picked, text), { existing: existingNames, maxLength: 80 }),
    [picked, text, existingNames],
  )
  const postable = useMemo(() => accounts.filter((a) => a.postable), [accounts])
  // Lo típico que este bar todavía no tiene: lo que ya está cargado no se ofrece.
  const typical = useMemo(() => {
    const existing = new Set(existingNames.map(nameKey))
    return TYPICAL_RECURRING.filter((name) => !existing.has(nameKey(name)))
  }, [existingNames])

  const toggle = (name: string) => {
    setError(null)
    setPicked((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  const review = () => {
    setError(null)
    if (parsed.names.length === 0) {
      setError(
        parsed.existing.length > 0
          ? 'Todos los de la lista ya están cargados.'
          : 'Tildá o pegá al menos un gasto fijo.',
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
      setError('Elegí en qué se gasta cada uno.')
      return
    }
    const nextDueDate = nextDueFrom(today, dueDay)
    start(async () => {
      try {
        const result = await createRecurringBulk(tenantSlug, {
          items: recurringBulkItems(rows, dueDay, nextDueDate),
        })
        if (!result.ok) {
          setError(result.message)
          return
        }
        const { created } = result.data
        toast.success(
          created === 0
            ? result.message
            : created === 1
              ? 'Listo: se cargó 1. Ahora ponele el monto.'
              : `Listo: se cargaron ${created}. Ahora poneles el monto.`,
        )
        setOpen(false)
        setStep('paste')
        setPicked([])
        setText('')
        // A «Completar la planilla»: ahí se les pone monto y día de corrido.
        router.push(gastosFijosFillHref(tenantSlug))
      } catch {
        setError(ACC_UNREACHABLE.offline)
      }
    })
  }

  const openDialog = () => {
    setError(null)
    setStep('paste')
    setOpen(true)
  }

  return (
    <>
      {trigger === 'primary' ? (
        <Button type="button" className={cn('h-11 gap-2', className)} onClick={openDialog}>
          <ListPlus className="size-4" aria-hidden />
          Pegar una lista
        </Button>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          className={cn(
            'inline-flex min-h-11 cursor-pointer items-center rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0',
            className,
          )}
        >
          Pegar una lista
        </button>
      )}
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cargar varios gastos fijos de una</DialogTitle>
            <DialogDescription>
              {step === 'paste'
                ? 'Paso 1 de 2 · ¿Cuáles tenés? Tildá los que pagás todos los meses o pegá tu lista.'
                : 'Paso 2 de 2 · Revisá en qué se gasta cada uno. El monto lo ponés después, en la planilla.'}
            </DialogDescription>
          </DialogHeader>

          {step === 'paste' ? (
            <div className="grid gap-4">
              {typical.length > 0 ? (
                <fieldset className="m-0 min-w-0 border-0 p-0">
                  <legend className="mb-2 p-0 text-sm font-medium">Lo típico de un bar</legend>
                  <div className="flex flex-wrap gap-2">
                    {typical.map((name) => (
                      <Pill
                        key={name}
                        size="touch"
                        activeTone="brand"
                        active={picked.includes(name)}
                        onClick={() => toggle(name)}
                        className="md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]"
                      >
                        {name}
                      </Pill>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor={`${uid}-names`} className="leading-snug">
                  O pegá tu lista, un gasto por renglón
                </Label>
                <Textarea
                  id={`${uid}-names`}
                  value={text}
                  rows={7}
                  placeholder={'Alarma\nSeguro integral de comercio\nSueldos personal'}
                  aria-describedby={`${uid}-hint ${uid}-summary`}
                  onChange={(e) => {
                    setText(e.target.value)
                    setError(null)
                  }}
                  className="text-base md:text-sm"
                />
                <p id={`${uid}-hint`} className="text-xs text-muted-foreground">
                  Si pegás varias columnas, tomo la primera como nombre.
                </p>
                <p
                  id={`${uid}-summary`}
                  aria-live="polite"
                  className="text-sm font-medium tabular-nums"
                >
                  {parsed.names.length === 0 && parsed.existing.length === 0
                    ? 'Todavía no elegiste ninguno.'
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
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-secondary/50 p-3">
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
                  className="h-11 w-16 text-center text-base tabular-nums md:h-9 md:text-sm"
                />
                <span className="text-sm text-muted-foreground">
                  de cada mes (después lo cambiás en cada uno).
                </span>
              </div>
              <ul className="grid gap-2.5">
                {rows.map((row, index) => (
                  <li
                    key={row.name}
                    className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center sm:gap-3"
                  >
                    <span className="truncate text-sm font-medium" title={row.name}>
                      {row.name}
                    </span>
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
                      placeholder="¿En qué se gasta?"
                      invalid={row.accountId === null && error !== null}
                      aria-label={`En qué se gasta ${row.name}`}
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
